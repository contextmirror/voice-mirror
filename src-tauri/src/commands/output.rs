//! Output channel commands for frontend log viewing.

use std::sync::Arc;

use serde::Deserialize;
use tauri::State;

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
) -> Result<serde_json::Value, String> {
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
                return Ok(serde_json::json!({
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
                Ok(serde_json::json!({
                    "channel": ch_str,
                    "entries": entries,
                    "total": total,
                    "returned": entries.len(),
                    "type": "project",
                }))
            } else {
                Err(format!("Unknown channel: {}", ch_str))
            }
        }
        None => {
            // Summary mode — include both system and project channels
            let system_summaries = output_store.summary();
            let project_summaries = output_store.project_summary();
            Ok(serde_json::json!({
                "channels": system_summaries,
                "projectChannels": project_summaries,
            }))
        }
    }
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
) -> Result<serde_json::Value, String> {
    let channels = output_store.list_project_channels();
    Ok(serde_json::json!({ "channels": channels }))
}
