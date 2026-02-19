//! API Provider — OpenAI-compatible HTTP streaming provider.
//!
//! Supports local providers (Ollama, LM Studio, Jan) and cloud providers
//! (OpenAI, Anthropic, Gemini, Groq, Grok/xAI, Mistral, OpenRouter, DeepSeek)
//! via the OpenAI-compatible `/v1/chat/completions` API.
//!
//! Unlike CLI providers, this does NOT use a PTY terminal — it communicates
//! via HTTP API calls with SSE streaming.
//!
//! ## Tool Calling
//!
//! When tools are set via `set_tools()`, the provider supports two paths:
//!
//! 1. **Native function calling** (cloud providers) — Tools are sent in the API
//!    request body. The model's streaming deltas include `tool_calls` which are
//!    accumulated and emitted as `ProviderEvent::ToolCalls`.
//!
//! 2. **Text-parsing fallback** (local providers) — The model's text response
//!    is scanned for JSON tool call patterns. If found, emitted as `ToolCalls`.
//!
//! The actual tool execution is handled by the caller (MCP module). After
//! execution, the caller calls `inject_tool_results()` to add the results
//! to the conversation and trigger a follow-up API call.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use reqwest::Client;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{debug, info, warn};

use super::tool_calling::{
    self, ToolCallAccumulator, ToolCallRequest, ToolDefinition, ToolResult,
};
use super::{Provider, ProviderConfig, ProviderEvent};

/// Default endpoints for known providers.
fn default_endpoint(provider_type: &str) -> &'static str {
    match provider_type {
        "ollama" => "http://127.0.0.1:11434",
        "lmstudio" => "http://127.0.0.1:1234",
        "jan" => "http://127.0.0.1:1337",
        "openai" => "https://api.openai.com/v1",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai",
        "groq" => "https://api.groq.com/openai/v1",
        "grok" => "https://api.x.ai/v1",
        "mistral" => "https://api.mistral.ai/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "deepseek" => "https://api.deepseek.com/v1",
        _ => "http://127.0.0.1:11434",
    }
}

/// Default model for known providers.
fn default_model(provider_type: &str) -> Option<&'static str> {
    match provider_type {
        "openai" => Some("gpt-4o-mini"),
        "gemini" => Some("gemini-2.0-flash"),
        "groq" => Some("llama-3.3-70b-versatile"),
        "grok" => Some("grok-2"),
        "mistral" => Some("mistral-small-latest"),
        "openrouter" => Some("meta-llama/llama-3.3-70b-instruct"),
        "deepseek" => Some("deepseek-chat"),
        // Local providers auto-detect from the server
        _ => None,
    }
}

/// Human-readable display name for known providers.
fn provider_display_name(provider_type: &str) -> &'static str {
    match provider_type {
        "ollama" => "Ollama",
        "lmstudio" => "LM Studio",
        "jan" => "Jan",
        "openai" => "OpenAI",
        "gemini" => "Gemini",
        "groq" => "Groq",
        "grok" => "Grok (xAI)",
        "mistral" => "Mistral",
        "openrouter" => "OpenRouter",
        "deepseek" => "DeepSeek",
        _ => "API Provider",
    }
}

/// Maximum number of messages to keep in conversation history.
const MAX_HISTORY_MESSAGES: usize = 20;

/// Maximum number of tool call iterations per user message.
/// Prevents infinite loops if the model keeps calling tools.
const MAX_TOOL_ITERATIONS: usize = 10;

/// The result of a streaming HTTP request.
///
/// Contains both the accumulated text response and any tool call data
/// from the streaming deltas.
struct StreamResult {
    /// The full text content accumulated from `delta.content` tokens.
    full_response: String,
    /// Tool call request, if the model requested tool execution.
    /// Contains the completed calls, response text, and raw data for history.
    tool_call_request: Option<ToolCallRequest>,
}

/// The API provider implementation.
///
/// Communicates with OpenAI-compatible APIs using SSE streaming.
/// Maintains conversation history, supports tool calling, and
/// supports interruption via abort.
pub struct ApiProvider {
    /// The provider type identifier (e.g., "ollama", "openai").
    provider_type_id: String,
    /// Human-readable display name.
    display_name_str: String,
    /// Base URL for the API.
    base_url: String,
    /// Chat completions endpoint path.
    chat_endpoint: String,
    /// API key (if required).
    api_key: Option<String>,
    /// Model name.
    model: Option<String>,
    /// Context window size in tokens.
    context_length: u32,
    /// System prompt.
    system_prompt: Option<String>,
    /// Channel for sending events to the frontend.
    event_tx: UnboundedSender<ProviderEvent>,
    /// Whether the provider is running.
    running: Arc<AtomicBool>,
    /// Conversation history as JSON values.
    ///
    /// Uses `serde_json::Value` instead of a typed struct to support the
    /// varied message shapes needed for tool calling:
    /// - `{role: "user", content: "..."}` — user messages
    /// - `{role: "assistant", content: "...", tool_calls: [...]}` — assistant with tool calls
    /// - `{role: "tool", tool_call_id: "...", content: "..."}` — tool results
    messages: Vec<serde_json::Value>,
    /// HTTP client.
    client: Client,
    /// Abort flag for the current streaming request.
    abort_flag: Arc<AtomicBool>,
    /// Handle to the active streaming task.
    _stream_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Tool definitions for function calling. Empty = tools disabled.
    tools: Vec<ToolDefinition>,
    /// Current tool iteration counter (reset on each user message).
    current_tool_iteration: usize,
}

impl ApiProvider {
    /// Create a new API provider.
    pub fn new(
        provider_type: &str,
        event_tx: UnboundedSender<ProviderEvent>,
        config: ProviderConfig,
    ) -> Self {
        let base_url = config
            .base_url
            .clone()
            .unwrap_or_else(|| default_endpoint(provider_type).to_string());

        let model = config
            .model
            .clone()
            .or_else(|| default_model(provider_type).map(String::from));

        let display_name_str = match &model {
            Some(m) => {
                let short = m.split(':').next().unwrap_or(m);
                format!("{} ({})", provider_display_name(provider_type), short)
            }
            None => provider_display_name(provider_type).to_string(),
        };

        Self {
            provider_type_id: provider_type.to_string(),
            display_name_str,
            base_url,
            chat_endpoint: "/v1/chat/completions".to_string(),
            api_key: config.api_key,
            model,
            context_length: config.context_length,
            system_prompt: config.system_prompt,
            event_tx,
            running: Arc::new(AtomicBool::new(false)),
            messages: Vec::new(),
            client: Client::new(),
            abort_flag: Arc::new(AtomicBool::new(false)),
            _stream_handle: None,
            tools: Vec::new(),
            current_tool_iteration: 0,
        }
    }

    /// Set the tool definitions for function calling.
    ///
    /// When tools are set and the provider supports them, tool calling is
    /// enabled automatically. Pass an empty slice to disable tools.
    pub fn set_tools(&mut self, tools: Vec<ToolDefinition>) {
        info!(
            "Tools {} for {} ({} definitions)",
            if tools.is_empty() {
                "disabled"
            } else {
                "enabled"
            },
            self.display_name_str,
            tools.len()
        );
        self.tools = tools;
    }

    /// Check if this provider supports native OpenAI function calling.
    ///
    /// Cloud providers (OpenAI, Groq, etc.) use the `tools` parameter in the
    /// API request. Local providers (Ollama, LM Studio) fall back to text parsing.
    pub fn supports_native_tools(&self) -> bool {
        tool_calling::supports_native_tools(&self.provider_type_id)
    }

    /// Check if tools are enabled and available.
    fn tools_enabled(&self) -> bool {
        !self.tools.is_empty()
    }

    /// Inject tool results into the conversation and trigger a follow-up API call.
    ///
    /// This is called by the MCP module after executing the tool calls that were
    /// emitted via `ProviderEvent::ToolCalls`. It:
    ///
    /// 1. Adds `role: "tool"` messages with the results to the conversation
    /// 2. Triggers a new streaming request so the model can respond with the results
    ///
    /// For native tool calling, results use the standard `role: "tool"` format.
    /// For text-parsing fallback, results are injected as `role: "user"` messages.
    pub fn inject_tool_results(&mut self, results: Vec<ToolResult>) {
        if !self.running.load(Ordering::SeqCst) {
            let _ = self
                .event_tx
                .send(ProviderEvent::Error("Provider not running".to_string()));
            return;
        }

        if self.supports_native_tools() {
            // Native path: add role:"tool" messages with tool_call_id
            for result in &results {
                self.messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": result.tool_call_id,
                    "content": result.content
                }));
            }
        } else {
            // Text-parsing fallback: inject as user message with results
            let mut combined = String::new();
            for result in &results {
                combined.push_str(&format!("[Tool Result]\n{}\n\n", result.content));
            }
            combined.push_str(
                "[INSTRUCTION] The above is REAL, CURRENT data. Read it carefully \
                 and answer my original question using ONLY facts from this data. \
                 Respond in plain natural language. No JSON. No markdown.",
            );

            self.messages.push(serde_json::json!({
                "role": "user",
                "content": combined
            }));
        }

        info!(
            "Injected {} tool results, sending follow-up request",
            results.len()
        );

        // Trigger follow-up request (empty text = tool follow-up, no new user message)
        self.send_message_internal(true);
    }

    /// Send a message and stream the response.
    ///
    /// This is the core API interaction method. It:
    /// 1. Adds the user message to history (unless tool follow-up)
    /// 2. Sends a streaming request to the API
    /// 3. Parses SSE `data:` lines, accumulating tool calls
    /// 4. Emits StreamToken events for each content token
    /// 5. Emits StreamEnd + Response when complete (no tool calls)
    /// 6. Emits ToolCalls when the model requests tool execution
    fn send_message(&mut self, text: String) {
        if !self.running.load(Ordering::SeqCst) {
            let _ = self
                .event_tx
                .send(ProviderEvent::Error("Provider not running".to_string()));
            return;
        }

        // Add user message to history
        if !text.is_empty() {
            // Per-message reinforcement for small local models.
            // System prompts alone are often "forgotten" after a few turns.
            // A brief interleaved system reminder keeps the model on track.
            if self.system_prompt.is_some() && self.messages.len() > 1 {
                self.messages.push(serde_json::json!({
                    "role": "system",
                    "content": "Remember: answer only what was asked. Stay on topic."
                }));
            }
            self.messages.push(serde_json::json!({
                "role": "user",
                "content": text
            }));
            // Reset tool iteration counter for new user input
            self.current_tool_iteration = 0;
        }

        self.send_message_internal(false);
    }

    /// Internal message sending — shared by `send_message()` and `inject_tool_results()`.
    fn send_message_internal(&mut self, _is_tool_follow_up: bool) {
        // Limit history to prevent context overflow
        self.limit_message_history();

        // Build the request body
        let url = format!("{}{}", self.base_url, self.chat_endpoint);

        let model = match &self.model {
            Some(m) => m.clone(),
            None => {
                let _ = self.event_tx.send(ProviderEvent::Error(
                    "No model specified. Please select a model in Settings.".to_string(),
                ));
                return;
            }
        };

        debug!(
            msg_count = self.messages.len(),
            has_system = self.messages.first().is_some_and(|m| m["role"] == "system"),
            "Sending {} messages to API",
            self.messages.len()
        );

        let mut body = serde_json::json!({
            "model": model,
            "messages": self.messages,
            "stream": true,
        });

        // Ollama: set context window size
        if self.provider_type_id == "ollama" {
            body["options"] = serde_json::json!({ "num_ctx": self.context_length });
        }

        // Add native tool definitions for cloud providers
        let use_native_tools = self.tools_enabled() && self.supports_native_tools();
        if use_native_tools {
            body["tools"] = serde_json::json!(tool_calling::to_openai_tools(&self.tools));
            body["tool_choice"] = serde_json::json!("auto");
        }

        // Reset abort flag
        self.abort_flag.store(false, Ordering::SeqCst);
        let abort_flag = self.abort_flag.clone();
        let event_tx = self.event_tx.clone();
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let running = self.running.clone();
        let provider_type = self.provider_type_id.clone();
        let tools_enabled = self.tools_enabled();
        let native_tools = use_native_tools;

        // Spawn an async task to handle the streaming response.
        // Use `tauri::async_runtime::spawn` instead of bare `tokio::spawn` —
        // Tauri's spawn uses a globally-stored runtime handle that works from
        // any thread, whereas `tokio::spawn` panics when called from Tauri's
        // sync command handlers (which run outside the tokio reactor context).
        let handle = tauri::async_runtime::spawn(async move {
            let result = Self::stream_request(
                &client,
                &url,
                api_key.as_deref(),
                body,
                &event_tx,
                &abort_flag,
                native_tools,
            )
            .await;

            match result {
                Ok(stream_result) => {
                    // --- Native tool calling path ---
                    if let Some(tc_request) = stream_result.tool_call_request {
                        info!(
                            "Native tool calls detected: {} calls",
                            tc_request.calls.len()
                        );
                        let _ = event_tx.send(ProviderEvent::ToolCalls(tc_request));
                        return;
                    }

                    // --- Text-parsing fallback path (local providers) ---
                    if tools_enabled
                        && !tool_calling::supports_native_tools(&provider_type)
                        && !stream_result.full_response.is_empty()
                    {
                        if let Some(parsed_call) =
                            tool_calling::parse_tool_call_from_text(&stream_result.full_response)
                        {
                            info!(
                                "Text-parsed tool call detected: {}",
                                parsed_call.name
                            );
                            let tc_request = ToolCallRequest {
                                calls: vec![parsed_call],
                                response_text: stream_result.full_response.clone(),
                                raw_tool_calls: Vec::new(),
                            };
                            let _ = event_tx.send(ProviderEvent::ToolCalls(tc_request));
                            return;
                        }
                    }

                    // --- Normal response (no tool calls) ---
                    if !stream_result.full_response.is_empty() {
                        let _ = event_tx.send(ProviderEvent::StreamEnd(
                            stream_result.full_response.clone(),
                        ));
                        let _ =
                            event_tx.send(ProviderEvent::Response(stream_result.full_response));
                    }
                }
                Err(e) => {
                    if abort_flag.load(Ordering::SeqCst) {
                        let _ = event_tx.send(ProviderEvent::Output("[Cancelled]\n".to_string()));
                    } else if running.load(Ordering::SeqCst) {
                        let _ = event_tx.send(ProviderEvent::Error(e));
                    }
                }
            }
        });

        self._stream_handle = Some(handle);
    }

    /// Execute the streaming HTTP request and parse SSE events.
    ///
    /// Accumulates both text content and tool call deltas from the stream.
    /// Returns a `StreamResult` with the full response and any tool calls.
    async fn stream_request(
        client: &Client,
        url: &str,
        api_key: Option<&str>,
        body: serde_json::Value,
        event_tx: &UnboundedSender<ProviderEvent>,
        abort_flag: &AtomicBool,
        accumulate_tools: bool,
    ) -> Result<StreamResult, String> {
        let mut request = client
            .post(url)
            .header("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(120));

        if let Some(key) = api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let response = request
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("HTTP {}: {}", status, error_text));
        }

        // Read the streaming response
        let mut full_response = String::new();
        let mut tool_accumulator = ToolCallAccumulator::new();
        let mut finish_reason: Option<String> = None;
        let mut stream = response.bytes_stream();

        use futures_util::StreamExt;
        let mut leftover = String::new();

        while let Some(chunk_result) = stream.next().await {
            // Check abort
            if abort_flag.load(Ordering::SeqCst) {
                return Err("Aborted".to_string());
            }

            let chunk = chunk_result.map_err(|e| format!("Stream read error: {}", e))?;
            let text = String::from_utf8_lossy(&chunk);

            // Prepend any leftover from the previous chunk
            let combined = format!("{}{}", leftover, text);
            leftover.clear();

            let lines: Vec<&str> = combined.split('\n').collect();

            // The last element might be an incomplete line
            if !combined.ends_with('\n') {
                if let Some(last) = lines.last() {
                    leftover = last.to_string();
                }
            }

            let line_count = if leftover.is_empty() {
                lines.len()
            } else {
                lines.len().saturating_sub(1)
            };

            for line in &lines[..line_count] {
                let line = line.trim();
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        let choice = parsed.get("choices").and_then(|c| c.get(0));

                        // Extract text content
                        if let Some(content) = choice
                            .and_then(|c| c.get("delta"))
                            .and_then(|d| d.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            full_response.push_str(content);
                            let _ =
                                event_tx.send(ProviderEvent::StreamToken(content.to_string()));
                        }

                        // Accumulate native tool call deltas
                        if accumulate_tools {
                            if let Some(delta_tool_calls) = choice
                                .and_then(|c| c.get("delta"))
                                .and_then(|d| d.get("tool_calls"))
                                .and_then(|tc| tc.as_array())
                            {
                                tool_accumulator.accumulate(delta_tool_calls);
                            }
                        }

                        // Track finish reason
                        if let Some(reason) = choice
                            .and_then(|c| c.get("finish_reason"))
                            .and_then(|r| r.as_str())
                        {
                            finish_reason = Some(reason.to_string());
                        }
                    } else {
                        // Log non-empty chunks that fail to parse
                        let trimmed_data = data.trim();
                        if !trimmed_data.is_empty() {
                            debug!("Malformed SSE chunk: {}", &trimmed_data[..trimmed_data.len().min(100)]);
                        }
                    }
                }
            }
        }

        // Build tool call request if the model requested tool execution
        let has_native_tool_calls = tool_accumulator.has_calls()
            && matches!(
                finish_reason.as_deref(),
                Some("tool_calls") | Some("stop")
            );

        let tool_call_request = if has_native_tool_calls {
            let raw = tool_accumulator.to_openai_format();
            let completed = tool_accumulator.take_completed();
            Some(ToolCallRequest {
                calls: completed,
                response_text: full_response.clone(),
                raw_tool_calls: raw,
            })
        } else {
            None
        };

        Ok(StreamResult {
            full_response,
            tool_call_request,
        })
    }

    /// Limit message history to prevent context overflow.
    ///
    /// Keeps system messages + last N non-system messages.
    /// Ensures we don't start with an orphaned `role: "tool"` message
    /// (which would cause API errors).
    fn limit_message_history(&mut self) {
        if self.messages.len() <= MAX_HISTORY_MESSAGES {
            return;
        }

        // Count system messages at the start
        let system_end = self
            .messages
            .iter()
            .take_while(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"))
            .count();

        let non_system_count = self.messages.len() - system_end;
        let keep = MAX_HISTORY_MESSAGES.min(non_system_count);
        let mut start_idx = self.messages.len() - keep;

        // Ensure we don't start with an orphaned role:"tool" message
        while start_idx < self.messages.len()
            && self.messages[start_idx]
                .get("role")
                .and_then(|r| r.as_str())
                == Some("tool")
        {
            start_idx += 1;
        }

        let mut trimmed: Vec<serde_json::Value> = Vec::new();

        // Keep system messages
        for msg in &self.messages[..system_end] {
            trimmed.push(msg.clone());
        }

        // Keep recent non-system messages
        for msg in &self.messages[start_idx..] {
            trimmed.push(msg.clone());
        }

        self.messages = trimmed;
    }

    /// Add the assistant message with tool calls to the conversation history.
    ///
    /// This must be called before `inject_tool_results()` so the conversation
    /// history is correct (the API requires the assistant's tool_calls message
    /// to precede the tool result messages).
    pub fn add_assistant_tool_call_message(
        &mut self,
        content: &str,
        tool_calls_raw: Vec<serde_json::Value>,
    ) {
        let mut msg = serde_json::json!({
            "role": "assistant",
        });

        // Content can be null/empty when the model only calls tools
        if content.is_empty() {
            msg["content"] = serde_json::Value::Null;
        } else {
            msg["content"] = serde_json::json!(content);
        }

        if !tool_calls_raw.is_empty() {
            msg["tool_calls"] = serde_json::json!(tool_calls_raw);
        }

        self.messages.push(msg);
    }

    /// Check if the max tool iteration limit has been reached.
    pub fn check_tool_iteration_limit(&mut self) -> bool {
        self.current_tool_iteration += 1;
        if self.current_tool_iteration > MAX_TOOL_ITERATIONS {
            warn!(
                "Max tool iterations ({}) reached",
                MAX_TOOL_ITERATIONS
            );
            let _ = self.event_tx.send(ProviderEvent::Output(
                "\n[Max tool iterations reached]\n".to_string(),
            ));
            return true;
        }
        false
    }
}

impl Provider for ApiProvider {
    fn start(&mut self, _cols: u16, _rows: u16) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err(format!("{} is already running", self.display_name_str));
        }

        self.running.store(true, Ordering::SeqCst);
        self.messages.clear();
        self.current_tool_iteration = 0;

        // Add system prompt if configured
        if let Some(ref prompt) = self.system_prompt {
            tracing::info!(
                length = prompt.len(),
                preview = %&prompt[..prompt.len().min(80)],
                "Injecting system prompt into API provider"
            );
            self.messages.push(serde_json::json!({
                "role": "system",
                "content": prompt
            }));
        } else {
            tracing::warn!("No system prompt configured for API provider");
        }

        let _ = self.event_tx.send(ProviderEvent::Output(format!(
            "[{}] Ready\n",
            self.display_name_str
        )));
        let _ = self.event_tx.send(ProviderEvent::Ready);

        Ok(())
    }

    fn stop(&mut self) {
        self.abort_flag.store(true, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
        self.messages.clear();
        self.tools.clear();
        self.current_tool_iteration = 0;

        // Abort any in-flight request
        if let Some(handle) = self._stream_handle.take() {
            handle.abort();
        }
    }

    fn send_input(&mut self, data: &str) {
        self.send_message(data.to_string());
    }

    fn send_raw_input(&mut self, _data: &[u8]) {
        // Raw input not supported for API providers.
        // In the future, could implement input buffering (accumulate until Enter).
    }

    fn resize(&mut self, _cols: u16, _rows: u16) {
        // No terminal to resize for API providers.
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn provider_type(&self) -> &str {
        &self.provider_type_id
    }

    fn display_name(&self) -> &str {
        &self.display_name_str
    }

    fn interrupt(&mut self) {
        self.abort_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self._stream_handle.take() {
            handle.abort();
        }
    }
}
