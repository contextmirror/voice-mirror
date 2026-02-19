//! MCP tool handler implementations.
//!
//! Each module implements a group of related tools:
//! - `core`        -- Voice I/O tools (voice_send, voice_inbox, voice_listen, voice_status)
//! - `memory`      -- Memory system (search, remember, forget, get, stats, flush)
//! - `screen`      -- Screen capture (capture_screen)
//! - `browser`     -- Browser CDP control (16 tools, file-based IPC)
//! - `n8n`         -- n8n REST API integration (22 tools)
//! - `diagnostic`  -- Pipeline tracing (trace_pipeline)
//! - `facades`     -- Combined tools for voice mode (memory_manage, n8n_manage, browser_manage)
//! - `voice_clone` -- Voice cloning tools (clone_voice, clear_voice_clone, list_voice_clones)

pub mod core;
pub mod memory;
pub mod screen;
pub mod browser;
pub mod n8n;
pub mod diagnostic;
pub mod facades;
pub mod voice_clone;

use serde::{Deserialize, Serialize};

/// Result type returned by all MCP tool handlers.
///
/// Matches the MCP protocol's tool result format:
/// ```json
/// {
///   "content": [{ "type": "text", "text": "..." }],
///   "isError": false
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    /// Content items (text, image, etc.)
    pub content: Vec<McpContent>,
    /// Whether this result represents an error.
    #[serde(rename = "isError", default)]
    pub is_error: bool,
}

/// A single content item in an MCP tool result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpContent {
    /// Text content.
    #[serde(rename = "text")]
    Text {
        text: String,
    },
    /// Base64-encoded image content.
    #[serde(rename = "image")]
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
}

impl McpToolResult {
    /// Create a successful text result.
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            content: vec![McpContent::Text {
                text: text.into(),
            }],
            is_error: false,
        }
    }

    /// Create an error text result.
    pub fn error(text: impl Into<String>) -> Self {
        Self {
            content: vec![McpContent::Text {
                text: text.into(),
            }],
            is_error: true,
        }
    }

    /// Create a result with a base64-encoded image.
    pub fn image(data: String, mime_type: String) -> Self {
        Self {
            content: vec![
                McpContent::Image { data, mime_type },
                McpContent::Text {
                    text: "Screenshot captured.".into(),
                },
            ],
            is_error: false,
        }
    }

    /// Create a result with multiple text items.
    pub fn multi_text(texts: Vec<String>) -> Self {
        Self {
            content: texts
                .into_iter()
                .map(|t| McpContent::Text { text: t })
                .collect(),
            is_error: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_tool_result_text() {
        let result = McpToolResult::text("hello");
        assert!(!result.is_error);
        assert_eq!(result.content.len(), 1);
        match &result.content[0] {
            McpContent::Text { text } => assert_eq!(text, "hello"),
            _ => panic!("Expected text content"),
        }
    }

    #[test]
    fn test_mcp_tool_result_error() {
        let result = McpToolResult::error("something failed");
        assert!(result.is_error);
        assert_eq!(result.content.len(), 1);
        match &result.content[0] {
            McpContent::Text { text } => assert_eq!(text, "something failed"),
            _ => panic!("Expected text content"),
        }
    }

    #[test]
    fn test_mcp_tool_result_image() {
        let result = McpToolResult::image("base64data".into(), "image/png".into());
        assert!(!result.is_error);
        assert_eq!(result.content.len(), 2);
        match &result.content[0] {
            McpContent::Image { data, mime_type } => {
                assert_eq!(data, "base64data");
                assert_eq!(mime_type, "image/png");
            }
            _ => panic!("Expected image content"),
        }
    }

    #[test]
    fn test_mcp_tool_result_serialize() {
        let result = McpToolResult::text("test");
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"test\""));
        assert!(json.contains("\"isError\":false"));
    }
}
