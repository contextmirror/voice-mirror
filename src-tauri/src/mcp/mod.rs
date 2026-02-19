//! MCP (Model Context Protocol) server implementation.
//!
//! Provides a JSON-RPC over stdio server that exposes tools for Claude Code
//! and other MCP clients. Replaces the Node.js `mcp-server/` with a native
//! Rust implementation that runs as part of the Tauri app (or as a standalone binary).
//!
//! Architecture:
//! - `server.rs` -- JSON-RPC protocol handler (stdin/stdout)
//! - `tools.rs`  -- Tool registry with dynamic group loading/unloading
//! - `handlers/` -- Tool handler implementations (core, memory, ...)

pub mod handlers;
pub mod server;
pub mod tools;
