//! Tool Calling — OpenAI-compatible function calling support.
//!
//! Handles three aspects of tool calling for API providers:
//!
//! 1. **Schema conversion** — Converts internal `ToolDefinition`s to the
//!    OpenAI `tools` array format for the request body.
//!
//! 2. **Streaming accumulation** — During SSE streaming, tool call arguments
//!    arrive as partial deltas indexed by position. The `ToolCallAccumulator`
//!    concatenates these fragments into complete tool calls.
//!
//! 3. **Text-parsing fallback** — For local providers (Ollama, LM Studio)
//!    that don't support native function calling, attempts to extract tool
//!    calls from the response text by looking for JSON blocks.
//!
//! The actual tool execution is handled elsewhere (MCP module). This module
//! only deals with the protocol: accumulation, parsing, and event emission.

use serde::{Deserialize, Serialize};
use tracing::warn;
use uuid::Uuid;

/// A tool definition in internal format.
///
/// Mirrors the structure used by the MCP tool system. The `parameters` field
/// is a JSON Schema object describing the tool's arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema describing the tool parameters (type: "object", properties: {...}).
    pub parameters: serde_json::Value,
}

/// A completed tool call ready for execution.
///
/// Produced either by accumulating streaming deltas (native tool calling)
/// or by parsing the response text (fallback path).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletedToolCall {
    /// Unique identifier for this tool call (e.g., "call_abc123").
    /// For native calls, this comes from the API. For text-parsed calls,
    /// we generate a UUID.
    pub id: String,
    /// The tool/function name (e.g., "browser_goto", "memory_search").
    pub name: String,
    /// Parsed arguments as a JSON object.
    pub arguments: serde_json::Value,
}

/// The result of executing a tool, to be injected back into the conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// The tool_call_id this result corresponds to (must match CompletedToolCall::id).
    pub tool_call_id: String,
    /// The result content as a string (formatted for the model to read).
    pub content: String,
}

/// A tool call request emitted via `ProviderEvent::ToolCalls`.
///
/// Bundles the completed tool calls with the metadata needed by the caller
/// to properly update the conversation history after tool execution:
///
/// 1. Execute each tool in `calls`
/// 2. Call `add_assistant_tool_call_message(response_text, raw_tool_calls)` on the provider
/// 3. Call `inject_tool_results(results)` to trigger the follow-up request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRequest {
    /// The completed tool calls to execute.
    pub calls: Vec<CompletedToolCall>,
    /// The assistant's text response (may be empty if the model only called tools).
    pub response_text: String,
    /// The raw tool calls in OpenAI format for conversation history injection.
    /// Pass these to `add_assistant_tool_call_message()`.
    pub raw_tool_calls: Vec<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Schema conversion
// ---------------------------------------------------------------------------

/// Convert internal tool definitions to the OpenAI `tools` array format.
///
/// Each tool becomes:
/// ```json
/// {
///   "type": "function",
///   "function": {
///     "name": "...",
///     "description": "...",
///     "parameters": { ... }
///   }
/// }
/// ```
pub fn to_openai_tools(tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
    tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": &t.name,
                    "description": &t.description,
                    "parameters": &t.parameters
                }
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Streaming tool call accumulation
// ---------------------------------------------------------------------------

/// Internal representation of a tool call being accumulated from streaming deltas.
#[derive(Debug, Clone)]
struct AccumulatedToolCall {
    /// Tool call ID (e.g., "call_abc123"). Set from the first delta that has `id`.
    id: String,
    /// Function name. Concatenated from deltas (usually arrives in one chunk).
    name: String,
    /// Function arguments as a JSON string. Concatenated across multiple deltas.
    arguments: String,
}

/// Accumulates streaming tool call deltas into complete tool calls.
///
/// During SSE streaming, the OpenAI API sends tool calls as incremental deltas:
///
/// ```json
/// {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"browser","arguments":""}}]}}]}
/// {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"url"}}]}}]}
/// {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":\"https://example.com\"}"}}]}}]}
/// ```
///
/// Each delta references a tool call by `index`. The `id` and `function.name` are
/// typically sent in the first delta; `function.arguments` is chunked across many.
///
/// Call `accumulate()` for each delta, then `take_completed()` when the stream
/// ends with `finish_reason: "tool_calls"`.
pub struct ToolCallAccumulator {
    /// Tool calls indexed by their streaming position.
    calls: Vec<AccumulatedToolCall>,
}

impl ToolCallAccumulator {
    /// Create a new empty accumulator.
    pub fn new() -> Self {
        Self { calls: Vec::new() }
    }

    /// Check if any tool calls have been accumulated.
    pub fn has_calls(&self) -> bool {
        !self.calls.is_empty()
    }

    /// Process a streaming delta's `tool_calls` array.
    ///
    /// Each element in `delta_tool_calls` is expected to have:
    /// - `index` (integer): position in the tool calls array
    /// - `id` (string, optional): tool call identifier (usually first delta only)
    /// - `function.name` (string, optional): function name (usually first delta only)
    /// - `function.arguments` (string, optional): partial arguments to concatenate
    ///
    /// Returns `true` if new data was accumulated.
    pub fn accumulate(&mut self, delta_tool_calls: &[serde_json::Value]) -> bool {
        let mut changed = false;

        for delta in delta_tool_calls {
            let idx = delta
                .get("index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            // Grow the vector if needed to accommodate this index
            while self.calls.len() <= idx {
                self.calls.push(AccumulatedToolCall {
                    id: String::new(),
                    name: String::new(),
                    arguments: String::new(),
                });
            }

            let entry = &mut self.calls[idx];

            // Merge ID (usually only present in the first delta for this index)
            if let Some(id) = delta.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    entry.id = id.to_string();
                    changed = true;
                }
            }

            // Merge function name and arguments
            if let Some(function) = delta.get("function") {
                if let Some(name) = function.get("name").and_then(|v| v.as_str()) {
                    if !name.is_empty() {
                        entry.name.push_str(name);
                        changed = true;
                    }
                }
                if let Some(args) = function.get("arguments").and_then(|v| v.as_str()) {
                    if !args.is_empty() {
                        entry.arguments.push_str(args);
                        changed = true;
                    }
                }
            }
        }

        changed
    }

    /// Extract completed tool calls from the accumulator.
    ///
    /// Call this after the stream ends with `finish_reason: "tool_calls"` (or "stop"
    /// when tool calls are present). Parses the accumulated JSON argument strings
    /// into `serde_json::Value` objects.
    ///
    /// Tool calls with invalid JSON arguments are logged and included with
    /// an empty object as fallback.
    pub fn take_completed(&mut self) -> Vec<CompletedToolCall> {
        let calls = std::mem::take(&mut self.calls);

        calls
            .into_iter()
            .filter(|tc| !tc.name.is_empty())
            .map(|tc| {
                let arguments = if tc.arguments.is_empty() {
                    serde_json::json!({})
                } else {
                    match serde_json::from_str(&tc.arguments) {
                        Ok(v) => v,
                        Err(e) => {
                            warn!(
                                "Failed to parse tool call arguments for '{}': {} (raw: {})",
                                tc.name,
                                e,
                                &tc.arguments[..tc.arguments.len().min(200)]
                            );
                            serde_json::json!({})
                        }
                    }
                };

                CompletedToolCall {
                    id: if tc.id.is_empty() {
                        // Generate an ID if the API didn't provide one
                        format!("call_{}", Uuid::new_v4().simple())
                    } else {
                        tc.id
                    },
                    name: tc.name,
                    arguments,
                }
            })
            .collect()
    }

    /// Get the raw accumulated tool calls in OpenAI format for injecting into
    /// the conversation history as the assistant's `tool_calls` field.
    ///
    /// This is needed because the API requires the assistant message that triggered
    /// tool calls to include the `tool_calls` array verbatim.
    pub fn to_openai_format(&self) -> Vec<serde_json::Value> {
        self.calls
            .iter()
            .filter(|tc| !tc.name.is_empty())
            .map(|tc| {
                serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments
                    }
                })
            })
            .collect()
    }
}

impl Default for ToolCallAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Text-parsing fallback for local providers
// ---------------------------------------------------------------------------

/// Try to parse a tool call from AI response text.
///
/// For local providers (Ollama, LM Studio) that don't support native function
/// calling, the model may emit tool calls as JSON blocks in the response text.
///
/// Looks for patterns like:
/// ```json
/// {"tool": "browser_goto", "args": {"url": "https://example.com"}}
/// ```
///
/// Also handles markdown-fenced JSON blocks:
/// ```
/// ```json
/// {"tool": "memory_search", "args": {"query": "hello"}}
/// ```
/// ```
///
/// Returns `None` if no tool call pattern is found.
pub fn parse_tool_call_from_text(text: &str) -> Option<CompletedToolCall> {
    // Try to find a JSON object in the text that looks like a tool call
    let candidates = extract_json_blocks(text);

    for candidate in candidates {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&candidate) {
            // Check for {"tool": "name", "args": {...}} format
            if let Some(tool_name) = parsed.get("tool").and_then(|v| v.as_str()) {
                let args = parsed
                    .get("args")
                    .cloned()
                    .or_else(|| parsed.get("arguments").cloned())
                    .unwrap_or(serde_json::json!({}));

                return Some(CompletedToolCall {
                    id: format!("call_{}", Uuid::new_v4().simple()),
                    name: tool_name.to_string(),
                    arguments: args,
                });
            }

            // Check for {"name": "...", "arguments": {...}} format
            if let Some(tool_name) = parsed.get("name").and_then(|v| v.as_str()) {
                let args = parsed
                    .get("arguments")
                    .cloned()
                    .or_else(|| parsed.get("args").cloned())
                    .unwrap_or(serde_json::json!({}));

                return Some(CompletedToolCall {
                    id: format!("call_{}", Uuid::new_v4().simple()),
                    name: tool_name.to_string(),
                    arguments: args,
                });
            }

            // Check for {"function_call": {"name": "...", "arguments": {...}}} format
            if let Some(fc) = parsed.get("function_call") {
                if let Some(tool_name) = fc.get("name").and_then(|v| v.as_str()) {
                    let args = fc
                        .get("arguments")
                        .and_then(|v| {
                            // arguments might be a string that needs parsing
                            if let Some(s) = v.as_str() {
                                serde_json::from_str(s).ok()
                            } else {
                                Some(v.clone())
                            }
                        })
                        .unwrap_or(serde_json::json!({}));

                    return Some(CompletedToolCall {
                        id: format!("call_{}", Uuid::new_v4().simple()),
                        name: tool_name.to_string(),
                        arguments: args,
                    });
                }
            }
        }
    }

    None
}

/// Extract JSON-like blocks from text.
///
/// Finds:
/// 1. Fenced code blocks (```json ... ```)
/// 2. Bare JSON objects (outermost `{...}`)
fn extract_json_blocks(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();

    // 1. Extract fenced code blocks
    let mut rest = text;
    while let Some(start_idx) = rest.find("```") {
        let after_fence = &rest[start_idx + 3..];
        // Skip optional language tag (e.g., "json")
        let content_start = after_fence.find('\n').map(|i| i + 1).unwrap_or(0);
        let content = &after_fence[content_start..];

        if let Some(end_idx) = content.find("```") {
            let block = content[..end_idx].trim().to_string();
            if block.starts_with('{') {
                blocks.push(block);
            }
            rest = &content[end_idx + 3..];
        } else {
            break;
        }
    }

    // 2. Extract bare JSON objects using brace matching
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '{' {
            let mut depth = 0;
            let start = i;
            let mut in_string = false;
            let mut escape = false;

            while i < chars.len() {
                let c = chars[i];

                if escape {
                    escape = false;
                    i += 1;
                    continue;
                }

                if c == '\\' && in_string {
                    escape = true;
                    i += 1;
                    continue;
                }

                if c == '"' {
                    in_string = !in_string;
                } else if !in_string {
                    if c == '{' {
                        depth += 1;
                    } else if c == '}' {
                        depth -= 1;
                        if depth == 0 {
                            let block: String = chars[start..=i].iter().collect();
                            // Only add if it looks like it could contain a tool call
                            if block.contains("tool")
                                || block.contains("name")
                                || block.contains("function")
                            {
                                blocks.push(block);
                            }
                            i += 1;
                            break;
                        }
                    }
                }
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    blocks
}

/// Check if a provider type supports native OpenAI function calling.
///
/// Cloud providers use the `tools` parameter in the API request.
/// Local providers (Ollama, LM Studio, Jan) fall back to text-parsing.
pub fn supports_native_tools(provider_type: &str) -> bool {
    matches!(
        provider_type,
        "openai" | "gemini" | "groq" | "grok" | "mistral" | "openrouter" | "deepseek"
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_openai_tools_format() {
        let tools = vec![ToolDefinition {
            name: "browser_goto".to_string(),
            description: "Navigate to a URL".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "The URL to navigate to" }
                },
                "required": ["url"]
            }),
        }];

        let result = to_openai_tools(&tools);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["type"], "function");
        assert_eq!(result[0]["function"]["name"], "browser_goto");
        assert_eq!(
            result[0]["function"]["description"],
            "Navigate to a URL"
        );
        assert!(result[0]["function"]["parameters"]["properties"]["url"].is_object());
    }

    #[test]
    fn test_accumulator_basic() {
        let mut acc = ToolCallAccumulator::new();
        assert!(!acc.has_calls());

        // First delta: id + name + start of arguments
        let delta1 = vec![serde_json::json!({
            "index": 0,
            "id": "call_abc123",
            "function": {
                "name": "browser_goto",
                "arguments": "{\"url"
            }
        })];
        assert!(acc.accumulate(&delta1));
        assert!(acc.has_calls());

        // Second delta: more arguments
        let delta2 = vec![serde_json::json!({
            "index": 0,
            "function": {
                "arguments": "\":\"https://example.com\"}"
            }
        })];
        assert!(acc.accumulate(&delta2));

        // Take completed
        let completed = acc.take_completed();
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].id, "call_abc123");
        assert_eq!(completed[0].name, "browser_goto");
        assert_eq!(
            completed[0].arguments,
            serde_json::json!({"url": "https://example.com"})
        );
    }

    #[test]
    fn test_accumulator_multiple_tools() {
        let mut acc = ToolCallAccumulator::new();

        // Two tool calls in parallel
        let delta = vec![
            serde_json::json!({
                "index": 0,
                "id": "call_1",
                "function": { "name": "memory_search", "arguments": "{\"query\":\"test\"}" }
            }),
            serde_json::json!({
                "index": 1,
                "id": "call_2",
                "function": { "name": "browser_goto", "arguments": "{\"url\":\"https://example.com\"}" }
            }),
        ];
        acc.accumulate(&delta);

        let completed = acc.take_completed();
        assert_eq!(completed.len(), 2);
        assert_eq!(completed[0].name, "memory_search");
        assert_eq!(completed[1].name, "browser_goto");
    }

    #[test]
    fn test_accumulator_invalid_json_fallback() {
        let mut acc = ToolCallAccumulator::new();

        let delta = vec![serde_json::json!({
            "index": 0,
            "id": "call_bad",
            "function": {
                "name": "some_tool",
                "arguments": "not valid json{"
            }
        })];
        acc.accumulate(&delta);

        let completed = acc.take_completed();
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].name, "some_tool");
        // Should fall back to empty object
        assert_eq!(completed[0].arguments, serde_json::json!({}));
    }

    #[test]
    fn test_accumulator_generates_id_if_missing() {
        let mut acc = ToolCallAccumulator::new();

        let delta = vec![serde_json::json!({
            "index": 0,
            "function": {
                "name": "some_tool",
                "arguments": "{}"
            }
        })];
        acc.accumulate(&delta);

        let completed = acc.take_completed();
        assert_eq!(completed.len(), 1);
        assert!(completed[0].id.starts_with("call_"));
    }

    #[test]
    fn test_accumulator_to_openai_format() {
        let mut acc = ToolCallAccumulator::new();

        let delta = vec![serde_json::json!({
            "index": 0,
            "id": "call_xyz",
            "function": {
                "name": "browser_goto",
                "arguments": "{\"url\":\"https://example.com\"}"
            }
        })];
        acc.accumulate(&delta);

        let format = acc.to_openai_format();
        assert_eq!(format.len(), 1);
        assert_eq!(format[0]["id"], "call_xyz");
        assert_eq!(format[0]["type"], "function");
        assert_eq!(format[0]["function"]["name"], "browser_goto");
    }

    #[test]
    fn test_parse_tool_call_json_block() {
        let text = r#"I'll search for that.
```json
{"tool": "memory_search", "args": {"query": "hello world"}}
```"#;

        let result = parse_tool_call_from_text(text);
        assert!(result.is_some());
        let tc = result.unwrap();
        assert_eq!(tc.name, "memory_search");
        assert_eq!(tc.arguments["query"], "hello world");
    }

    #[test]
    fn test_parse_tool_call_bare_json() {
        let text =
            r#"Let me check that. {"tool": "browser_goto", "args": {"url": "https://example.com"}}"#;

        let result = parse_tool_call_from_text(text);
        assert!(result.is_some());
        let tc = result.unwrap();
        assert_eq!(tc.name, "browser_goto");
        assert_eq!(tc.arguments["url"], "https://example.com");
    }

    #[test]
    fn test_parse_tool_call_name_format() {
        let text = r#"{"name": "memory_search", "arguments": {"query": "test"}}"#;

        let result = parse_tool_call_from_text(text);
        assert!(result.is_some());
        let tc = result.unwrap();
        assert_eq!(tc.name, "memory_search");
    }

    #[test]
    fn test_parse_tool_call_no_match() {
        let text = "This is just a regular response with no tool calls.";
        let result = parse_tool_call_from_text(text);
        assert!(result.is_none());
    }

    #[test]
    fn test_supports_native_tools() {
        assert!(supports_native_tools("openai"));
        assert!(supports_native_tools("groq"));
        assert!(supports_native_tools("deepseek"));
        assert!(supports_native_tools("gemini"));
        assert!(supports_native_tools("grok"));
        assert!(supports_native_tools("mistral"));
        assert!(supports_native_tools("openrouter"));

        assert!(!supports_native_tools("ollama"));
        assert!(!supports_native_tools("lmstudio"));
        assert!(!supports_native_tools("jan"));
    }
}
