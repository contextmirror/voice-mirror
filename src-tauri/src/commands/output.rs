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
            let channel = Channel::from_str(ch_str)
                .ok_or_else(|| format!("Unknown channel: {}", ch_str))?;
            let (entries, total) = output_store.query(
                channel,
                params.level.as_deref(),
                params.last,
                params.search.as_deref(),
            );
            Ok(serde_json::json!({
                "channel": ch_str,
                "entries": entries,
                "total": total,
                "returned": entries.len(),
            }))
        }
        None => {
            // Summary mode
            let summaries = output_store.summary();
            Ok(serde_json::json!({
                "channels": summaries,
            }))
        }
    }
}
