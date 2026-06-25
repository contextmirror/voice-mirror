pub mod ai;
pub mod chat;
pub mod config;
pub mod dev_server;
pub mod files;
pub mod screenshot;
pub mod shortcuts;
pub mod tools;
pub mod voice;
pub mod window;
pub mod lens;
pub mod terminal;
pub mod lsp;
pub mod design;
pub mod output;
pub mod project;
pub mod workspace_state;
pub mod mcp;
pub mod onboarding;
pub mod sandbox;

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

/// Stable FNV-1a hash of a string to a hex filename.
/// Deterministic across Rust versions and platforms.
pub fn hash_filename(source: &str) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in source.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{:x}", hash)
}

// Voice commands are in commands/voice.rs
