pub mod commands;
pub mod config;
pub mod ipc;
pub mod mcp;
pub mod providers;
pub mod services;
pub mod voice;

use commands::ai as ai_cmds;
use commands::chat as chat_cmds;
use commands::config as config_cmds;
use commands::screenshot as screenshot_cmds;
use commands::shortcuts as shortcut_cmds;
use commands::tools as tools_cmds;
use commands::voice as voice_cmds;
use commands::window as window_cmds;

use providers::manager::AiManager;
use providers::ProviderEvent;
use voice::VoiceEngine;

use tauri::{Emitter, Manager};
use tracing::{info, warn};

/// Pre-loaded TTS engine state. Populated during app startup in a background
/// task so the voice pipeline can use it immediately without cold-start delay.
pub type PreloadedTtsState = std::sync::Mutex<Option<Box<dyn voice::tts::TtsEngine>>>;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize structured logging (file + console)
    services::logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // If user tries to launch a second instance, focus the existing window
            info!("Second instance detected, focusing existing window");
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(ai_cmds::AiManagerState(std::sync::Mutex::new(
            AiManager::new(),
        )))
        .manage(std::sync::Mutex::new(VoiceEngine::new()) as voice_cmds::VoiceEngineState)
        .manage(shortcut_cmds::ShortcutManagerState(
            std::sync::Mutex::new(shortcut_cmds::ShortcutManager::new()),
        ))
        .manage(std::sync::Mutex::new(sysinfo::System::new()) as window_cmds::PerfMonitorState)
        .manage(std::sync::Mutex::new(None::<Box<dyn voice::tts::TtsEngine>>) as PreloadedTtsState)
        .invoke_handler(tauri::generate_handler![
            // Config
            config_cmds::get_config,
            config_cmds::set_config,
            config_cmds::reset_config,
            config_cmds::get_platform_info,
            config_cmds::migrate_electron_config,
            // Window
            window_cmds::get_window_position,
            window_cmds::set_window_position,
            window_cmds::save_window_bounds,
            window_cmds::minimize_window,
            window_cmds::maximize_window,
            window_cmds::set_window_size,
            window_cmds::set_always_on_top,
            window_cmds::set_resizable,
            window_cmds::quit_app,
            // Screenshot / screen capture
            screenshot_cmds::take_screenshot,
            screenshot_cmds::list_monitors,
            screenshot_cmds::list_windows,
            screenshot_cmds::capture_monitor,
            screenshot_cmds::capture_window,
            // Voice
            voice_cmds::start_voice,
            voice_cmds::stop_voice,
            voice_cmds::get_voice_status,
            voice_cmds::set_voice_mode,
            voice_cmds::list_audio_devices,
            voice_cmds::stop_speaking,
            voice_cmds::speak_text,
            voice_cmds::ptt_press,
            voice_cmds::ptt_release,
            voice_cmds::configure_ptt_key,
            voice_cmds::configure_dictation_key,
            voice_cmds::inject_text,
            // AI (real implementations)
            ai_cmds::start_ai,
            ai_cmds::stop_ai,
            ai_cmds::get_ai_status,
            ai_cmds::ai_pty_input,
            ai_cmds::ai_raw_input,
            ai_cmds::ai_pty_resize,
            ai_cmds::interrupt_ai,
            ai_cmds::send_voice_loop,
            ai_cmds::scan_providers,
            ai_cmds::list_models,
            ai_cmds::set_provider,
            ai_cmds::get_provider,
            ai_cmds::write_user_message,
            // Chat persistence
            chat_cmds::chat_list,
            chat_cmds::chat_load,
            chat_cmds::chat_save,
            chat_cmds::chat_delete,
            chat_cmds::chat_rename,
            chat_cmds::export_chat_to_file,
            // CLI tool detection
            tools_cmds::scan_cli_tools,
            tools_cmds::check_npm_versions,
            tools_cmds::update_npm_package,
            // Global shortcuts
            shortcut_cmds::register_shortcut,
            shortcut_cmds::unregister_shortcut,
            shortcut_cmds::list_shortcuts,
            shortcut_cmds::unregister_all_shortcuts,
            // Performance stats
            window_cmds::get_process_stats,
        ])
        .setup(|app| {
            // Clear stale listener locks from previous sessions.
            // When the app starts fresh, any lock left by a prior MCP binary is stale.
            {
                let lock_path = services::inbox_watcher::get_mcp_data_dir()
                    .join("listener_lock.json");
                if lock_path.exists() {
                    match std::fs::remove_file(&lock_path) {
                        Ok(()) => info!("Cleared stale listener lock from previous session"),
                        Err(e) => warn!("Failed to clear stale listener lock: {}", e),
                    }
                }
            }

            // Take the event receiver from the AI manager and spawn a forwarding loop.
            // This bridges provider events (terminal output, stream tokens, errors, etc.)
            // to the frontend via Tauri's event system.
            let ai_state = app.state::<ai_cmds::AiManagerState>();
            let event_rx = {
                let mut manager = ai_state
                    .0
                    .lock()
                    .map_err(|e| format!("Failed to lock AI manager during setup: {}", e))?;
                manager.take_event_rx()
            };

            if let Some(mut rx) = event_rx as Option<tokio::sync::mpsc::UnboundedReceiver<ProviderEvent>> {
                let app_handle = app.handle().clone();
                info!("Starting AI provider event forwarding loop");

                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        // Route events. Terminal-related events (Output, Exit, Ready)
                        // are folded into "ai-output" with { type, text/code } payload
                        // to match what Terminal.svelte expects.
                        let emissions: Vec<(&str, serde_json::Value)> = match &event {
                            ProviderEvent::Output(data) => {
                                vec![("ai-output", serde_json::json!({ "type": "stdout", "text": data }))]
                            }
                            ProviderEvent::Exit(code) => {
                                vec![
                                    ("ai-output", serde_json::json!({ "type": "exit", "code": code })),
                                    ("ai-status-change", serde_json::json!({ "running": false, "code": code })),
                                ]
                            }
                            ProviderEvent::Ready => {
                                vec![
                                    ("ai-output", serde_json::json!({ "type": "clear" })),
                                    ("ai-output", serde_json::json!({ "type": "start", "text": "Provider ready" })),
                                    ("ai-status-change", serde_json::json!({ "running": true })),
                                ]
                            }
                            ProviderEvent::Error(msg) => {
                                vec![
                                    ("ai-output", serde_json::json!({ "type": "stderr", "text": msg })),
                                    ("ai-error", serde_json::json!({ "error": msg })),
                                ]
                            }
                            ProviderEvent::StreamToken(token) => {
                                vec![("ai-stream-token", serde_json::json!({ "token": token }))]
                            }
                            ProviderEvent::StreamEnd(text) => {
                                vec![("ai-stream-end", serde_json::json!({ "text": text }))]
                            }
                            ProviderEvent::Response(text) => {
                                vec![("ai-response", serde_json::json!({ "text": text }))]
                            }
                            ProviderEvent::ToolCalls(calls) => {
                                vec![("ai-tool-calls", serde_json::json!({ "calls": calls }))]
                            }
                        };

                        // Best-effort emit — if the window is gone, stop the loop
                        let mut failed = false;
                        for (event_name, payload) in emissions {
                            if app_handle.emit(event_name, payload).is_err() {
                                warn!("Failed to emit AI event '{}', stopping forwarding loop", event_name);
                                failed = true;
                                break;
                            }
                        }
                        if failed { break; }
                    }

                    info!("AI provider event forwarding loop ended");
                });
            } else {
                warn!("AI manager event receiver was already taken — event forwarding not started");
            }

            // Ensure WebView2 background is fully transparent on Windows
            // (transparent: true in config handles the window, but WebView2 needs this too)
            if let Some(window) = app.get_webview_window("main") {
                use tauri::window::Color;
                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));

                // Apply start_minimized from config
                let cfg = commands::config::get_config_snapshot();
                if cfg.behavior.start_minimized {
                    info!("Config: start_minimized=true, minimizing window");
                    let _ = window.minimize();
                }
            }

            // Pre-load TTS engine in background so it's ready for the first message.
            // This avoids the cold-start "No TTS engine available" error.
            {
                let app_handle_tts = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match tokio::task::spawn_blocking(|| {
                        voice::tts::create_tts_engine("kokoro", Some("af_bella"), Some(1.0))
                    })
                    .await
                    {
                        Ok(Ok(engine)) => {
                            info!("TTS engine pre-loaded: {}", engine.name());
                            let state = app_handle_tts.state::<PreloadedTtsState>();
                            let mut guard = state.lock().expect("PreloadedTtsState poisoned");
                            *guard = Some(engine);
                            drop(guard);
                        }
                        Ok(Err(e)) => {
                            warn!("TTS pre-load failed: {} — pipeline will create its own", e);
                        }
                        Err(e) => {
                            warn!("TTS pre-load task panicked: {} — pipeline will create its own", e);
                        }
                    }
                });
            }

            // Start unified input hook for PTT and dictation keybindings.
            // Installs both WH_KEYBOARD_LL and WH_MOUSE_LL hooks.
            // Keyboard keys from mouse side buttons are suppressed + emitted as events.
            services::input_hook::start_input_hook(app.handle().clone());

            // Start named pipe server for fast MCP IPC
            let pipe_name = ipc::pipe_server::generate_pipe_name();
            match ipc::pipe_server::start_pipe_server(app.handle().clone(), &pipe_name) {
                Ok(state) => {
                    info!("Named pipe server started: {}", pipe_name);
                    ipc::set_pipe_name(pipe_name.clone());
                    app.manage(state);
                }
                Err(e) => {
                    warn!("Failed to start pipe server: {} — falling back to file IPC", e);
                    // Create a dummy state with a disconnected channel so commands don't panic
                    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
                    app.manage(ipc::pipe_server::PipeServerState {
                        pipe_name: String::new(),
                        tx,
                        connected: std::sync::Arc::new(tokio::sync::Mutex::new(false)),
                    });
                }
            }

            // Start inbox watcher for MCP message bridge (file-based fallback)
            match services::inbox_watcher::start_inbox_watcher(app.handle().clone()) {
                Ok(handle) => {
                    info!("Inbox watcher started successfully");
                    // The watcher should live for the app's lifetime.
                    // Leak the handle to keep it alive without managed state overhead.
                    std::mem::forget(handle);
                }
                Err(e) => {
                    warn!("Failed to start inbox watcher: {}", e);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Voice Mirror");
}
