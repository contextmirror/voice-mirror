//! LSP (Language Server Protocol) integration module.
//!
//! Manages LSP server processes for code intelligence features:
//! completions, hover information, go-to-definition, and diagnostics.
//!
//! The `LspManager` spawns language servers on demand when files are opened,
//! communicates via JSON-RPC over stdio, and emits Tauri events for
//! diagnostics and server status changes.
//!
//! ## Module structure
//!
//! - `lifecycle` — server spawning, initialization, shutdown, health checks
//! - `documents` — textDocument/didOpen, didClose, didChange, didSave
//! - `requests` — all LSP request methods (completion, hover, definition, etc.)
//! - `scanning` — background project file scanning for diagnostics
//! - `formatting` — response normalization helpers and quickinfo formatting
//! - `client` — low-level JSON-RPC transport (send/receive over stdio)
//! - `detection` — language server binary detection
//! - `installer` — auto-installation of language servers
//! - `manifest` — LSP server manifest (lsp-servers.json) parsing
//! - `types` — shared types (ServerState, file_uri, etc.)

pub mod client;
pub mod detection;
mod documents;
mod formatting;
pub mod installer;
mod lifecycle;
pub mod manifest;
mod requests;
mod scanning;
pub mod types;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicI64;
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tauri::AppHandle;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, watch, Mutex};

/// Build a composite key for the server HashMap: "lang_id::project_root"
pub(crate) fn server_key(lang_id: &str, project_root: &str) -> String {
    format!("{}::{}", lang_id, project_root)
}

/// Map a file extension (without dot) to the correct LSP `languageId`.
///
/// The server key in the manifest (e.g. `"typescript"`) is NOT the same as the
/// LSP language ID sent in `textDocument/didOpen`. For example, `.js` files
/// must use `"javascript"`, not `"typescript"`, so tsserver applies
/// JavaScript-specific inference (JSDoc type expansion, etc.).
pub(crate) fn lsp_language_id(ext: &str) -> &str {
    match ext {
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "typescriptreact",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "html" | "htm" => "html",
        "json" => "json",
        "jsonc" => "jsonc",
        "svelte" => "svelte",
        "rs" => "rust",
        "md" => "markdown",
        "py" => "python",
        _ => ext,
    }
}

/// A running LSP server process.
pub struct LspServer {
    pub language_id: String,
    pub binary: String,
    pub process: Child,
    pub next_id: AtomicI64,
    pub open_docs: HashSet<String>,
    /// URIs of files opened via background project scan (not user-opened).
    /// When the user opens one of these files in the editor, it gets promoted
    /// to `open_docs` (didClose + didOpen with fresh editor content).
    pub background_docs: HashSet<String>,
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub capabilities: Option<lsp_types::ServerCapabilities>,
    pub pending_requests: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>>,
    pub crash_count: u32,
    pub last_crash: Option<Instant>,
    pub state: types::ServerState,
    pub project_root: String,
    pub last_error: Option<String>,
    pub stderr_lines: Arc<Mutex<Vec<String>>>,
    /// Cancel sender for idle shutdown timer. When all documents close, a 60s
    /// timer starts; sending on this channel cancels the pending shutdown.
    pub idle_cancel: Option<watch::Sender<bool>>,
    /// Server name from initialize response (serverInfo.name).
    pub server_name: Option<String>,
    /// Server version from initialize response (serverInfo.version).
    pub version: Option<String>,
}

/// Manages all LSP server processes.
pub struct LspManager {
    pub servers: HashMap<String, LspServer>,
    pub app_handle: AppHandle,
}

/// Thread-safe wrapper for the LSP manager (uses tokio Mutex for async access).
pub struct LspManagerState(pub Mutex<LspManager>);

impl LspManagerState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self(Mutex::new(LspManager {
            servers: HashMap::new(),
            app_handle,
        }))
    }
}
