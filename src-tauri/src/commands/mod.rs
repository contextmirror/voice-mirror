pub mod ai;
pub mod chat;
pub mod config;
pub mod files;
pub mod screenshot;
pub mod shortcuts;
pub mod tools;
pub mod voice;
pub mod window;
pub mod lens;
pub mod shell;
pub mod lsp;

use serde_json::Value;

/// IPC response format matching Voice Mirror convention:
/// { success: bool, data?: any, error?: string }
#[derive(serde::Serialize)]
pub struct IpcResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl IpcResponse {
    pub fn ok(data: Value) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn ok_empty() -> Self {
        Self {
            success: true,
            data: None,
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

// Voice commands are in commands/voice.rs
