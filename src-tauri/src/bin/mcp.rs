//! Standalone MCP server binary for Voice Mirror.
//!
//! This binary is spawned by Claude Code as an MCP tool server. It communicates:
//! - With Claude Code via **stdio** (JSON-RPC 2.0)
//! - With the Tauri app via **named pipe** (length-prefixed JSON) for fast IPC
//!
//! Environment variables:
//! - `VOICE_MIRROR_DATA_DIR` — path to the MCP data directory (inbox.json, status.json, etc.)
//! - `VOICE_MIRROR_PIPE` — named pipe path for fast IPC (optional; falls back to file-based)
//! - `ENABLED_GROUPS` — comma-separated tool groups to load on startup

use std::path::PathBuf;

use voice_mirror_lib::ipc::pipe_client;
use voice_mirror_lib::mcp::pipe_router::PipeRouter;
use voice_mirror_lib::mcp::server::run_server;

#[tokio::main]
async fn main() {
    // Initialize logging to stderr (stdout is reserved for JSON-RPC).
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Resolve data directory
    let data_dir = std::env::var("VOICE_MIRROR_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_data_dir());

    // Try to connect to the named pipe for fast IPC.
    // If connected, wrap in PipeRouter which runs a background dispatch loop
    // to route BrowserResponse and UserMessage to different channels.
    let pipe_name = std::env::var("VOICE_MIRROR_PIPE").ok();
    let router = if let Some(ref name) = pipe_name {
        match pipe_client::connect_to_pipe(name, 10).await {
            Ok(client) => {
                eprintln!("[MCP] Connected to pipe: {}", name);
                let router = PipeRouter::new(client);
                router.start_dispatch();
                Some(router)
            }
            Err(e) => {
                eprintln!("[MCP] Pipe connection failed: {}. Falling back to file IPC.", e);
                None
            }
        }
    } else {
        eprintln!("[MCP] No VOICE_MIRROR_PIPE env var — using file-based IPC.");
        None
    };

    // Read enabled groups from env (set by Tauri app via .mcp.json / settings.json)
    let enabled_groups = std::env::var("ENABLED_GROUPS").ok();

    // Run the MCP server (blocks until stdin closes)
    if let Err(e) = run_server(data_dir, router, enabled_groups).await {
        eprintln!("[MCP] Server error: {}", e);
        std::process::exit(1);
    }
}

/// Default data directory (matches the Tauri app's data directory).
fn default_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror")
        .join("data")
}
