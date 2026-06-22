//! Output channel commands for frontend log viewing.

use std::sync::Arc;

use serde::Deserialize;
use tauri::State;

use super::IpcResponse;
use crate::services::output::{Channel, OutputStore};

#[derive(Debug, Deserialize)]
pub struct FrontendErrorParams {
    pub level: String,
    pub message: String,
    pub context: Option<String>,
}

#[tauri::command]
pub fn log_frontend_error(
    params: FrontendErrorParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    let full_message = if let Some(ctx) = &params.context {
        if ctx.is_empty() {
            params.message.clone()
        } else {
            format!("{}\n{}", params.message, ctx)
        }
    } else {
        params.message.clone()
    };

    output_store.inject(
        Channel::Frontend,
        &params.level,
        &full_message,
    );
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct GetLogsParams {
    pub channel: Option<String>,
    pub level: Option<String>,
    pub last: Option<usize>,
    pub search: Option<String>,
}

#[tauri::command]
pub fn get_output_logs(
    params: GetLogsParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> IpcResponse {
    match &params.channel {
        Some(ch_str) => {
            // Try system channel first
            if let Some(channel) = Channel::from_str(ch_str) {
                let (entries, total) = output_store.query(
                    channel,
                    params.level.as_deref(),
                    params.last,
                    params.search.as_deref(),
                );
                return IpcResponse::ok(serde_json::json!({
                    "channel": ch_str,
                    "entries": entries,
                    "total": total,
                    "returned": entries.len(),
                }));
            }

            // Try project channel
            let (entries, total) = output_store.query_project(
                ch_str,
                params.level.as_deref(),
                params.last,
                params.search.as_deref(),
            );
            if total > 0
                || output_store
                    .list_project_channels()
                    .iter()
                    .any(|c| c.label == *ch_str)
            {
                IpcResponse::ok(serde_json::json!({
                    "channel": ch_str,
                    "entries": entries,
                    "total": total,
                    "returned": entries.len(),
                    "type": "project",
                }))
            } else {
                IpcResponse::err(format!("Unknown channel: {}", ch_str))
            }
        }
        None => {
            // Summary mode — include both system and project channels
            let system_summaries = output_store.summary();
            let project_summaries = output_store.project_summary();
            IpcResponse::ok(serde_json::json!({
                "channels": system_summaries,
                "projectChannels": project_summaries,
            }))
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ExportDiagnosticsParams {
    /// How many recent lines to include per channel (default 200).
    pub last: Option<usize>,
}

/// Bundle recent logs from every channel — plus the standalone MCP server's
/// process log (a separate process, file-only) — into one plain-text blob the
/// user can copy from Settings and paste for debugging. This is the only place
/// the MCP binary's logs surface in the app, since it doesn't share the
/// in-memory OutputStore.
#[tauri::command]
pub fn export_diagnostics(
    params: ExportDiagnosticsParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> IpcResponse {
    use std::fmt::Write as _;

    let last = params.last.unwrap_or(200);
    let mut out = String::new();

    let _ = writeln!(out, "=== Voice Mirror Diagnostics ===");
    let _ = writeln!(out, "version: {}", env!("CARGO_PKG_VERSION"));
    let _ = writeln!(out, "os: {} ({})", std::env::consts::OS, std::env::consts::ARCH);
    let _ = writeln!(out, "lines per channel: {}", last);

    // In-memory system channels (the app process).
    let system_channels = [
        Channel::App,
        Channel::Cli,
        Channel::Voice,
        Channel::Mcp,
        Channel::Browser,
        Channel::Frontend,
    ];
    for channel in system_channels {
        let (entries, total) = output_store.query(channel, None, Some(last), None);
        let _ = writeln!(
            out,
            "\n----- {} ({} of {} lines) -----",
            channel.as_str(),
            entries.len(),
            total
        );
        for e in &entries {
            let _ = writeln!(out, "{}", e.format_line());
        }
    }

    // Standalone MCP server process log (file-only — separate process).
    let mcp_path = crate::services::output::mcp_server_log_path();
    let mcp_entries = crate::services::output::read_log_file(&mcp_path, Some(last));
    let _ = writeln!(
        out,
        "\n----- mcp-server [process] ({} lines from {}) -----",
        mcp_entries.len(),
        mcp_path.display()
    );
    for e in &mcp_entries {
        let _ = writeln!(out, "{}", e.format_line());
    }

    // Project channels (dev server / browser console), if any.
    for proj in output_store.list_project_channels() {
        let (entries, total) = output_store.query_project(&proj.label, None, Some(last), None);
        let _ = writeln!(
            out,
            "\n----- project: {} ({} of {} lines) -----",
            proj.label,
            entries.len(),
            total
        );
        for e in &entries {
            let _ = writeln!(out, "{}", e.format_line());
        }
    }

    IpcResponse::ok(serde_json::json!({ "text": out }))
}

// ---------------------------------------------------------------------------
// Project channel commands
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterProjectChannelParams {
    pub label: String,
    pub project_path: String,
    pub framework: Option<String>,
    pub port: Option<u16>,
}

#[tauri::command]
pub fn register_project_channel(
    params: RegisterProjectChannelParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    output_store.register_project_channel(
        params.label,
        params.project_path,
        params.framework,
        params.port,
    );
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct UnregisterProjectChannelParams {
    pub label: String,
}

#[tauri::command]
pub fn unregister_project_channel(
    params: UnregisterProjectChannelParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    output_store.unregister_project_channel(&params.label);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct PushProjectLogParams {
    pub label: String,
    pub level: String,
    pub message: String,
}

#[tauri::command]
pub fn push_project_log(
    params: PushProjectLogParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    output_store.push_project(&params.label, &params.level, &params.message);
    Ok(())
}

#[tauri::command]
pub fn list_project_channels(
    output_store: State<'_, Arc<OutputStore>>,
) -> IpcResponse {
    let channels = output_store.list_project_channels();
    IpcResponse::ok(serde_json::json!({ "channels": channels }))
}
