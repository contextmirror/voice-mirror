//! Tauri commands for AI provider management.
//!
//! These commands are invoked from the frontend via Tauri's IPC bridge.
//! They delegate to the `AiManager` held in Tauri's managed state.

use std::sync::Mutex;

use tauri::State;

use crate::providers::cli::scan_available_providers;
use crate::providers::manager::AiManager;
use crate::providers::{is_cli_provider, ProviderConfig};

use super::IpcResponse;

/// Tauri managed state wrapper for the AI manager.
pub struct AiManagerState(pub Mutex<AiManager>);

/// Helper to lock the AI manager state, returning an IpcResponse error on failure.
macro_rules! lock_manager {
    ($state:expr) => {
        match $state.0.lock() {
            Ok(guard) => guard,
            Err(e) => return IpcResponse::err(format!("Failed to lock AI manager: {}", e)),
        }
    };
}

/// Start the AI provider based on the current configuration.
///
/// Creates and starts the appropriate provider (CLI/PTY or API).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn start_ai(
    state: State<'_, AiManagerState>,
    cols: Option<u16>,
    rows: Option<u16>,
    provider_type: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    context_length: Option<u32>,
    system_prompt: Option<String>,
    cwd: Option<String>,
) -> IpcResponse {
    let mut manager = lock_manager!(state);

    let provider_type = provider_type.unwrap_or_else(|| "claude".to_string());
    let cols = cols.unwrap_or(120);
    let rows = rows.unwrap_or(30);

    let config = ProviderConfig {
        model,
        base_url,
        api_key,
        context_length: context_length.unwrap_or(32768),
        system_prompt,
        cwd,
        ..Default::default()
    };

    match manager.start(&provider_type, cols, rows, config) {
        Ok(()) => IpcResponse::ok(serde_json::json!({
            "provider": provider_type,
            "mode": if is_cli_provider(&provider_type) { "pty" } else { "api" },
        })),
        Err(e) => IpcResponse::err(e),
    }
}

/// Stop the currently active AI provider.
#[tauri::command]
pub fn stop_ai(state: State<'_, AiManagerState>) -> IpcResponse {
    let mut manager = lock_manager!(state);
    let stopped = manager.stop();
    IpcResponse::ok(serde_json::json!({ "stopped": stopped }))
}

/// Get the current AI provider status.
#[tauri::command]
pub fn get_ai_status(state: State<'_, AiManagerState>) -> IpcResponse {
    let manager = lock_manager!(state);
    IpcResponse::ok(serde_json::json!({
        "running": manager.is_running(),
        "provider": manager.provider_type(),
        "displayName": manager.display_name(),
        "mode": manager.mode(),
        "generation": manager.generation(),
    }))
}

/// Send text input to the active AI provider.
///
/// For PTY providers, this writes to the terminal stdin.
/// For API providers, this sends a chat message.
#[tauri::command]
pub fn ai_pty_input(state: State<'_, AiManagerState>, data: String) -> IpcResponse {
    let mut manager = lock_manager!(state);
    if manager.send_input(&data) {
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("No active provider to send input to")
    }
}

/// Send raw bytes to the active AI provider (PTY passthrough).
///
/// Used for special key sequences (Ctrl+C, arrow keys, etc.).
#[tauri::command]
pub fn ai_raw_input(state: State<'_, AiManagerState>, data: String) -> IpcResponse {
    let mut manager = lock_manager!(state);
    if manager.send_raw_input(data.as_bytes()) {
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("No active provider to send raw input to")
    }
}

/// Resize the PTY terminal of the active provider.
#[tauri::command]
pub fn ai_pty_resize(state: State<'_, AiManagerState>, cols: u16, rows: u16) -> IpcResponse {
    let mut manager = lock_manager!(state);
    manager.resize(cols, rows);
    IpcResponse::ok_empty()
}

/// Interrupt the current AI operation.
///
/// For PTY providers: sends Ctrl+C.
/// For API providers: aborts the streaming HTTP request.
#[tauri::command]
pub fn interrupt_ai(state: State<'_, AiManagerState>) -> IpcResponse {
    let mut manager = lock_manager!(state);
    let interrupted = manager.interrupt();
    IpcResponse::ok(serde_json::json!({ "interrupted": interrupted }))
}

/// Send the voice listen loop command to CLI agents.
///
/// Instructs the CLI agent to use MCP tools for voice I/O in a loop.
#[tauri::command]
pub fn send_voice_loop(
    state: State<'_, AiManagerState>,
    sender_name: Option<String>,
) -> IpcResponse {
    let mut manager = lock_manager!(state);
    let name = sender_name.unwrap_or_else(|| "user".to_string());
    manager.send_voice_loop(&name);
    IpcResponse::ok_empty()
}

/// Scan the system for available CLI providers and probe local LLM servers.
///
/// Checks PATH for known CLI tools (claude, opencode, codex, gemini, kimi).
/// Also probes local LLM server endpoints to check online status and fetch models.
/// Returns a combined result.
#[tauri::command]
pub async fn scan_providers() -> IpcResponse {
    let available = scan_available_providers();

    // Probe local LLM servers in parallel
    let local_providers = vec![
        ("ollama", "http://127.0.0.1:11434"),
        ("lmstudio", "http://127.0.0.1:1234"),
        ("jan", "http://127.0.0.1:1337"),
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let mut handles = Vec::new();
    for (provider_type, base_url) in local_providers {
        let c = client.clone();
        let url = format!("{}/v1/models", base_url);
        handles.push(tokio::spawn(async move {
            let result = c.get(&url).send().await;
            match result {
                Ok(resp) if resp.status().is_success() => {
                    let body: serde_json::Value = resp.json().await.unwrap_or_default();
                    let models = parse_model_list(&body);
                    serde_json::json!({
                        "type": provider_type,
                        "online": true,
                        "models": models,
                        "model": models.first().cloned(),
                    })
                }
                _ => {
                    serde_json::json!({
                        "type": provider_type,
                        "online": false,
                        "models": [],
                        "model": null,
                    })
                }
            }
        }));
    }

    let mut local_results = Vec::new();
    for handle in handles {
        if let Ok(result) = handle.await {
            local_results.push(result);
        }
    }

    IpcResponse::ok(serde_json::json!({
        "providers": available,
        "local": local_results,
    }))
}

/// Fetch available models from a local LLM server.
///
/// Calls the OpenAI-compatible `/v1/models` endpoint and returns the model list.
/// Filters out embedding models (not useful for chat).
#[tauri::command]
pub async fn list_models(
    provider_type: String,
    base_url: Option<String>,
) -> IpcResponse {
    let default_endpoints = [
        ("ollama", "http://127.0.0.1:11434"),
        ("lmstudio", "http://127.0.0.1:1234"),
        ("jan", "http://127.0.0.1:1337"),
    ];

    let endpoint = base_url.unwrap_or_else(|| {
        default_endpoints
            .iter()
            .find(|(t, _)| *t == provider_type.as_str())
            .map(|(_, url)| url.to_string())
            .unwrap_or_else(|| "http://127.0.0.1:11434".to_string())
    });

    let url = format!("{}/v1/models", endpoint);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = parse_model_list(&body);
            IpcResponse::ok(serde_json::json!({
                "online": true,
                "models": models,
                "default": models.first().cloned(),
            }))
        }
        Ok(resp) => {
            IpcResponse::err(format!("Server responded with HTTP {}", resp.status()))
        }
        Err(e) => {
            IpcResponse::err(format!("Failed to connect: {}", e))
        }
    }
}

/// Parse model list from OpenAI-compatible `/v1/models` response.
///
/// Supports both modern format (`{ data: [{ id }] }`) and older Ollama format
/// (`{ models: [{ name }] }`). Filters out embedding models.
fn parse_model_list(body: &serde_json::Value) -> Vec<String> {
    let mut models = Vec::new();

    // Modern OpenAI-compatible format: { data: [{ id: "model-name" }] }
    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    }
    // Fallback: older Ollama format { models: [{ name: "model-name" }] }
    else if let Some(data) = body.get("models").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(name) = item
                .get("name")
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str())
            {
                models.push(name.to_string());
            }
        }
    }

    // Filter out embedding models — they can't do chat completions
    models.retain(|m| {
        let lower = m.to_lowercase();
        !lower.contains("embed")
    });

    models
}

/// Switch to a different AI provider.
///
/// Stops the current provider and starts the new one.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn set_provider(
    state: State<'_, AiManagerState>,
    provider_id: String,
    model: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    context_length: Option<u32>,
    system_prompt: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> IpcResponse {
    let mut manager = lock_manager!(state);

    let cols = cols.unwrap_or(120);
    let rows = rows.unwrap_or(30);

    let config = ProviderConfig {
        model,
        base_url,
        api_key,
        context_length: context_length.unwrap_or(32768),
        system_prompt,
        cwd,
        ..Default::default()
    };

    match manager.switch(&provider_id, cols, rows, config) {
        Ok(()) => IpcResponse::ok(serde_json::json!({
            "provider": provider_id,
            "mode": if is_cli_provider(&provider_id) { "pty" } else { "api" },
        })),
        Err(e) => IpcResponse::err(e),
    }
}

/// Write a user message to the MCP inbox.
///
/// This bridges the chat UI to the AI provider. Prefers the named pipe for
/// instant delivery to `voice_listen`, falls back to inbox.json file write.
#[tauri::command]
pub async fn write_user_message(
    message: String,
    from: Option<String>,
    thread_id: Option<String>,
    pipe_state: State<'_, crate::ipc::pipe_server::PipeServerState>,
) -> Result<IpcResponse, ()> {
    let sender = from.unwrap_or_else(|| {
        let config = crate::commands::config::get_config_snapshot();
        config.user.name
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "user".to_string())
    });
    let tid = thread_id.clone().unwrap_or_else(|| "voice-mirror".to_string());

    // Try pipe first for instant delivery
    if pipe_state.is_connected().await {
        let pipe_msg = crate::ipc::protocol::AppToMcp::UserMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from: sender.clone(),
            message: message.clone(),
            thread_id: Some(tid.clone()),
            timestamp: chrono_now_iso(),
        };
        if pipe_state.send(pipe_msg).is_ok() {
            // Also write to inbox.json for persistence/fallback
            let _ = crate::services::inbox_watcher::write_inbox_message(
                &sender, &message, Some(&tid),
            );
            return Ok(IpcResponse::ok_empty());
        }
    }

    // Fallback: file-based inbox
    match crate::services::inbox_watcher::write_inbox_message(&sender, &message, Some(&tid)) {
        Ok(()) => Ok(IpcResponse::ok_empty()),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Simple ISO timestamp without chrono crate.
fn chrono_now_iso() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    // Simplified: just return epoch-based timestamp parseable by JS
    format!("{}.{:03}Z", secs, millis)
}

/// Get information about the current provider.
#[tauri::command]
pub fn get_provider(state: State<'_, AiManagerState>) -> IpcResponse {
    let manager = lock_manager!(state);
    IpcResponse::ok(serde_json::json!({
        "running": manager.is_running(),
        "provider": manager.provider_type(),
        "displayName": manager.display_name(),
        "mode": manager.mode(),
    }))
}
