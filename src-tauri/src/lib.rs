pub mod commands;
pub mod config;
pub mod ipc;
pub mod mcp;
pub mod providers;
pub mod services;
pub mod util;
pub mod voice;
pub mod terminal;
pub mod lsp;

use commands::ai as ai_cmds;
use commands::chat as chat_cmds;
use commands::config as config_cmds;
use commands::screenshot as screenshot_cmds;
use commands::shortcuts as shortcut_cmds;
use commands::tools as tools_cmds;
use commands::voice as voice_cmds;
use commands::window as window_cmds;
use commands::files as files_cmds;
use commands::lens as lens_cmds;
use commands::terminal as terminal_cmds;
use commands::dev_server as dev_server_cmds;
use commands::lsp as lsp_cmds;
use commands::design as design_cmds;
use commands::output as output_cmds;

use providers::manager::AiManager;
use providers::ProviderEvent;
use voice::VoiceEngine;

use tauri::{Emitter, Manager};
use tracing::{info, warn};

/// Pre-loaded TTS engine state. Populated during app startup in a background
/// task so the voice pipeline can use it immediately without cold-start delay.
pub type PreloadedTtsState = std::sync::Mutex<Option<Box<dyn voice::tts::TtsEngine>>>;


/// Rotate the current log session directory to a timestamped archive,
/// then prune archives beyond the retention limit.
fn rotate_log_sessions() {
    let logs_dir = services::platform::get_log_dir();
    let current_dir = logs_dir.join("current");

    // If current/ exists and has files, rotate it
    if current_dir.exists() {
        let has_files = std::fs::read_dir(&current_dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);

        if has_files {
            // Use epoch seconds for a unique, sortable archive name
            let epoch_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            let archive_name = format!("session-{}", epoch_secs);
            let archive_dir = logs_dir.join(&archive_name);

            if let Err(e) = std::fs::rename(&current_dir, &archive_dir) {
                warn!("Failed to rotate log session: {}", e);
            } else {
                info!("Rotated log session to {}", archive_name);
            }
        }
    }

    // Create fresh current/
    let _ = std::fs::create_dir_all(&current_dir);

    // Prune old sessions (keep 5 most recent)
    let max_sessions = 5;
    let mut sessions: Vec<_> = std::fs::read_dir(&logs_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with("session-"))
                .unwrap_or(false)
        })
        .collect();

    // Sort by name (epoch seconds sort lexicographically)
    sessions.sort_by_key(|e| e.file_name());

    if sessions.len() > max_sessions {
        let to_remove = sessions.len() - max_sessions;
        for entry in &sessions[..to_remove] {
            if let Err(e) = std::fs::remove_dir_all(entry.path()) {
                warn!("Failed to prune old log session {:?}: {}", entry.file_name(), e);
            } else {
                info!("Pruned old log session: {:?}", entry.file_name());
            }
        }
    }
}

/// Check if a window at (x, y) with given dimensions fits entirely within any monitor.
fn position_fits_monitor(window: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> bool {
    window.available_monitors().unwrap_or_default().iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        x >= mp.x
            && y >= mp.y
            && x + w as i32 <= mp.x + ms.width as i32
            && y + h as i32 <= mp.y + ms.height as i32
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize structured logging (file + console + output ring buffers)
    let output_store = services::logger::init();
    rotate_log_sessions();

    tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // If user tries to launch a second instance, focus the existing window
            info!("Second instance detected, focusing existing window");
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Custom URI scheme for forwarding keyboard shortcuts from the lens
        // child webview back to the app.  Child WebView2 instances are separate
        // processes (NOT iframes), so window.top.postMessage() doesn't work.
        // Instead the injected JS fires `new Image().src` to this scheme,
        // Rust intercepts it here and emits a Tauri event the frontend listens to.
        .register_uri_scheme_protocol("lens-shortcut", |ctx, request| {
            let uri = request.uri().to_string();
            // URL format — Windows: https://lens-shortcut.localhost/{key}?query...
            //               macOS/Linux: lens-shortcut://localhost/{key}?query...
            let path = uri
                .split("localhost")
                .nth(1)
                .unwrap_or("")
                .trim_start_matches('/')
                .trim_start_matches(':');
            let key = path
                .split('?')
                .next()
                .unwrap_or("")
                .trim_matches('/');

            if key == "hard-refresh" {
                info!("[lens-shortcut] Hard refresh requested");
                let _ = ctx.app_handle().emit("lens-hard-refresh", serde_json::json!({}));
            } else if key == "url-changed" {
                // Back/forward navigation reports the new URL via query param
                let query = path.split('?').nth(1).unwrap_or("");
                let url_param = query
                    .split('&')
                    .find_map(|pair| pair.strip_prefix("url="))
                    .unwrap_or("");
                let decoded_url = percent_encoding::percent_decode_str(url_param)
                    .decode_utf8_lossy()
                    .to_string();
                info!("[lens-shortcut] URL changed: {}", decoded_url);
                let _ = ctx.app_handle().emit(
                    "lens-url-changed",
                    serde_json::json!({ "url": decoded_url }),
                );
            } else if !key.is_empty() {
                info!("[lens-shortcut] Forwarding shortcut key: {}", key);
                let _ = ctx.app_handle().emit("lens-shortcut", serde_json::json!({ "key": key }));
            }

            // Return 1×1 transparent GIF so the Image() load succeeds silently
            tauri::http::Response::builder()
                .status(200)
                .header("content-type", "image/gif")
                .header("access-control-allow-origin", "*")
                .body(vec![
                    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
                    0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
                    0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
                    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
                    0x01, 0x00, 0x3b,
                ])
                .unwrap()
        })
        // Custom URI scheme for capturing browser console output from the lens
        // child webview.  The injected `CONSOLE_HOOK_SCRIPT` patches
        // console.log/warn/error/info/debug and fires `new Image().src` to this
        // scheme with the level and URL-encoded message.  Rust parses the URL and
        // emits a `lens-console-message` Tauri event for the frontend to route to
        // the appropriate project output channel.
        .register_uri_scheme_protocol("lens-console", |ctx, request| {
            let uri = request.uri().to_string();
            // URL format — Windows: https://lens-console.localhost/{level}?m={msg}&t=...
            //               macOS/Linux: lens-console://localhost/{level}?m={msg}&t=...
            let path = uri
                .split("localhost")
                .nth(1)
                .unwrap_or("")
                .trim_start_matches('/')
                .trim_start_matches(':');

            let level_part = path
                .split('?')
                .next()
                .unwrap_or("")
                .trim_matches('/');

            let query = path.split('?').nth(1).unwrap_or("");
            let encoded_msg = query
                .split('&')
                .find_map(|pair| pair.strip_prefix("m="))
                .unwrap_or("");
            let message = percent_encoding::percent_decode_str(encoded_msg)
                .decode_utf8_lossy()
                .to_string();

            if !message.is_empty() {
                let log_level = match level_part {
                    "error" => "ERROR",
                    "warn" => "WARN",
                    "debug" => "DEBUG",
                    "info" => "INFO",
                    _ => "INFO", // "log" maps to INFO
                };

                let _ = ctx.app_handle().emit(
                    "lens-console-message",
                    serde_json::json!({
                        "level": log_level,
                        "message": message,
                    }),
                );
            }

            // Return 1×1 transparent GIF so the Image() load succeeds silently
            tauri::http::Response::builder()
                .status(200)
                .header("content-type", "image/gif")
                .header("access-control-allow-origin", "*")
                .body(vec![
                    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
                    0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
                    0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
                    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
                    0x01, 0x00, 0x3b,
                ])
                .unwrap()
        })
        .manage(ai_cmds::AiManagerState(std::sync::Mutex::new(
            AiManager::new(),
        )))
        .manage(std::sync::Mutex::new(VoiceEngine::new()) as voice_cmds::VoiceEngineState)
        .manage(shortcut_cmds::ShortcutManagerState(
            std::sync::Mutex::new(shortcut_cmds::ShortcutManager::new()),
        ))
        .manage(std::sync::Mutex::new(sysinfo::System::new()) as window_cmds::PerfMonitorState)
        .manage(std::sync::Mutex::new(None::<Box<dyn voice::tts::TtsEngine>>) as PreloadedTtsState)
        .manage(lens_cmds::LensState {
            tabs: std::sync::Mutex::new(std::collections::HashMap::new()),
            active_tab_id: std::sync::Mutex::new(None),
            bounds: std::sync::Mutex::new(None),
            device_webviews: std::sync::Mutex::new(Vec::new()),
        })
        .manage(services::file_watcher::FileWatcherState {
            handle: std::sync::Mutex::new(None),
        })
        .manage(terminal_cmds::TerminalManagerState(std::sync::Mutex::new(
            crate::terminal::TerminalManager::new(),
        )))
        .manage(output_store)
        .invoke_handler(tauri::generate_handler![
            // Config
            config_cmds::get_config,
            config_cmds::set_config,
            config_cmds::reset_config,
            config_cmds::get_platform_info,
            // Window
            window_cmds::get_window_position,
            window_cmds::set_window_position,
            window_cmds::save_window_bounds,
            window_cmds::minimize_window,
            window_cmds::maximize_window,
            window_cmds::set_window_size,
            window_cmds::set_always_on_top,
            window_cmds::set_resizable,
            window_cmds::show_window,
            window_cmds::quit_app,
            // Screenshot / screen capture
            screenshot_cmds::take_screenshot,
            screenshot_cmds::list_monitors,
            screenshot_cmds::list_windows,
            screenshot_cmds::capture_monitor,
            screenshot_cmds::capture_window,
            screenshot_cmds::lens_capture_browser,
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
            voice_cmds::ensure_stt_model,
            voice_cmds::restart_voice,
            voice_cmds::detect_gpu,
            voice_cmds::list_stt_models,
            voice_cmds::delete_stt_model,
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
            // Lens (embedded browser)
            lens_cmds::lens_create_webview,
            lens_cmds::lens_create_tab,
            lens_cmds::lens_close_tab,
            lens_cmds::lens_switch_tab,
            lens_cmds::lens_close_all_tabs,
            lens_cmds::lens_navigate,
            lens_cmds::lens_go_back,
            lens_cmds::lens_go_forward,
            lens_cmds::lens_reload,
            lens_cmds::lens_resize_webview,
            lens_cmds::lens_close_webview,
            lens_cmds::lens_set_visible,
            lens_cmds::lens_hard_refresh,
            lens_cmds::lens_clear_cache,
            // Device Preview
            lens_cmds::lens_create_device_webview,
            lens_cmds::lens_close_device_webview,
            lens_cmds::lens_close_all_device_webviews,
            lens_cmds::lens_resize_device_webview,
            lens_cmds::lens_eval_device_js,
            lens_cmds::lens_set_device_emulation,
            // File tree
            files_cmds::list_directory,
            files_cmds::get_git_changes,
            files_cmds::get_project_root,
            files_cmds::read_file,
            files_cmds::read_external_file,
            files_cmds::write_file,
            files_cmds::get_file_git_content,
            files_cmds::create_file,
            files_cmds::create_directory,
            files_cmds::rename_entry,
            files_cmds::delete_entry,
            files_cmds::reveal_in_explorer,
            files_cmds::search_files,
            files_cmds::search_content,
            files_cmds::git_stage,
            files_cmds::git_unstage,
            files_cmds::git_stage_all,
            files_cmds::git_unstage_all,
            files_cmds::git_commit,
            files_cmds::git_discard,
            files_cmds::git_push,
            files_cmds::git_ahead_behind,
            files_cmds::git_fetch,
            files_cmds::git_pull,
            files_cmds::git_force_push,
            files_cmds::git_list_branches,
            files_cmds::git_checkout_branch,
            files_cmds::git_stash_save,
            files_cmds::git_stash_list,
            files_cmds::git_stash_pop,
            files_cmds::git_stash_apply,
            files_cmds::git_stash_drop,
            // Terminal sessions
            terminal_cmds::terminal_spawn,
            terminal_cmds::terminal_input,
            terminal_cmds::terminal_resize,
            terminal_cmds::terminal_kill,
            terminal_cmds::terminal_list,
            terminal_cmds::terminal_detect_profiles,
            // File watcher
            services::file_watcher::start_file_watching,
            services::file_watcher::stop_file_watching,
            // LSP
            lsp_cmds::lsp_open_file,
            lsp_cmds::lsp_close_file,
            lsp_cmds::lsp_change_file,
            lsp_cmds::lsp_save_file,
            lsp_cmds::lsp_request_completion,
            lsp_cmds::lsp_request_hover,
            lsp_cmds::lsp_request_signature_help,
            lsp_cmds::lsp_request_definition,
            lsp_cmds::lsp_request_type_definition,
            lsp_cmds::lsp_request_declaration,
            lsp_cmds::lsp_request_implementation,
            lsp_cmds::lsp_request_document_symbols,
            lsp_cmds::lsp_request_workspace_symbols,
            lsp_cmds::lsp_request_references,
            lsp_cmds::lsp_request_document_highlight,
            lsp_cmds::lsp_request_inlay_hints,
            lsp_cmds::lsp_request_code_actions,
            lsp_cmds::lsp_prepare_rename,
            lsp_cmds::lsp_rename,
            lsp_cmds::lsp_request_formatting,
            lsp_cmds::lsp_request_range_formatting,
            lsp_cmds::lsp_request_on_type_formatting,
            lsp_cmds::lsp_request_linked_editing_range,
            lsp_cmds::lsp_request_code_lens,
            lsp_cmds::lsp_request_document_colors,
            lsp_cmds::lsp_request_folding_ranges,
            lsp_cmds::lsp_request_semantic_tokens_full,
            lsp_cmds::lsp_resolve_completion_item,
            lsp_cmds::lsp_request_diagnostics,
            lsp_cmds::lsp_prepare_call_hierarchy,
            lsp_cmds::lsp_request_incoming_calls,
            lsp_cmds::lsp_request_outgoing_calls,
            lsp_cmds::lsp_prepare_type_hierarchy,
            lsp_cmds::lsp_request_supertypes,
            lsp_cmds::lsp_request_subtypes,
            lsp_cmds::lsp_request_selection_range,
            lsp_cmds::lsp_apply_workspace_edit,
            lsp_cmds::lsp_scan_project,
            lsp_cmds::lsp_get_server_list,
            lsp_cmds::lsp_install_server,
            lsp_cmds::lsp_set_server_enabled,
            lsp_cmds::lsp_restart_server,
            lsp_cmds::lsp_get_server_detail,
            lsp_cmds::lsp_get_status,
            lsp_cmds::lsp_shutdown,
            // Dev server detection + management
            dev_server_cmds::detect_dev_servers,
            dev_server_cmds::probe_port,
            dev_server_cmds::kill_port_process,
            // Design canvas overlay
            design_cmds::design_command,
            design_cmds::design_get_element,
            // Output / diagnostics
            output_cmds::get_output_logs,
            output_cmds::log_frontend_error,
            output_cmds::register_project_channel,
            output_cmds::unregister_project_channel,
            output_cmds::push_project_log,
            output_cmds::list_project_channels,
        ])
        .setup(|app| {
            // Set app handle on OutputStore for live event emission
            {
                let output_store = app.state::<std::sync::Arc<crate::services::output::OutputStore>>();
                output_store.set_app_handle(app.handle().clone());
            }

            // Initialize LSP manager state (needs AppHandle)
            app.manage(lsp::LspManagerState::new(app.handle().clone()));

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

            // Terminal event forwarding loop
            {
                let terminal_state = app.state::<terminal_cmds::TerminalManagerState>();
                let terminal_event_rx = {
                    let mut manager = terminal_state
                        .0
                        .lock()
                        .map_err(|e| format!("Failed to lock terminal manager during setup: {}", e))?;
                    manager.take_event_rx()
                };

                if let Some(mut rx) = terminal_event_rx {
                    let app_handle_terminal = app.handle().clone();
                    info!("Starting terminal event forwarding loop");

                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            if app_handle_terminal.emit("terminal-output", &event).is_err() {
                                warn!("Failed to emit terminal-output event, stopping loop");
                                break;
                            }
                        }
                        info!("Terminal event forwarding loop ended");
                    });
                }
            }

            // Ensure WebView2 background is fully transparent on Windows
            // (transparent: true in config handles the window, but WebView2 needs this too)
            if let Some(window) = app.get_webview_window("main") {
                use tauri::window::Color;
                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));

                // Create native overlay titlebar (Windows: native min/max/close buttons)
                #[cfg(windows)]
                {
                    use tauri_plugin_decorum::WebviewWindowExt;
                    let _ = window.create_overlay_titlebar();
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

            // Restore saved window size, position, and mode from config.
            // The window starts hidden (visible: false in tauri.conf.json)
            // so the user never sees the wrong size/mode flash.
            // Orb and dashboard positions are stored independently.
            if let Some(window) = app.get_webview_window("main") {
                let cfg = commands::config::get_config_snapshot();
                let is_dashboard = cfg.window.expanded;

                if is_dashboard {
                    // Dashboard mode: restore panelWidth × panelHeight
                    let pw = cfg.appearance.panel_width;
                    let ph = cfg.appearance.panel_height;
                    if pw >= 300 && ph >= 300 {
                        let size = tauri::PhysicalSize::new(pw, ph);
                        let _ = window.set_size(tauri::Size::Physical(size));
                        info!("Restored dashboard size: {}x{}", pw, ph);
                    }

                    // Restore dashboard position (dashboardX/Y), fall back to orbX/Y for migration
                    let pos_x = cfg.window.dashboard_x.or(cfg.window.orb_x);
                    let pos_y = cfg.window.dashboard_y.or(cfg.window.orb_y);
                    if let (Some(x), Some(y)) = (pos_x, pos_y) {
                        let win_w = if pw >= 300 { pw } else { 900 };
                        let win_h = if ph >= 300 { ph } else { 800 };
                        if position_fits_monitor(&window, x as i32, y as i32, win_w, win_h) {
                            let pos = tauri::PhysicalPosition::new(x as i32, y as i32);
                            let _ = window.set_position(tauri::Position::Physical(pos));
                            info!("Restored dashboard position: ({}, {})", x, y);
                        } else {
                            let _ = window.center();
                            info!("Dashboard position ({},{}) off-screen, centering", x, y);
                        }
                    }

                    // Restore maximized state (after position/size so unmaximize has correct bounds)
                    if cfg.window.maximized {
                        let _ = window.maximize();
                        info!("Restored maximized state");
                    }
                } else {
                    // Orb mode: restore 120×120, always-on-top, not resizable
                    let size = tauri::PhysicalSize::new(120u32, 120u32);
                    let _ = window.set_size(tauri::Size::Physical(size));
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_resizable(false);
                    info!("Restored orb mode: 120x120, always-on-top");

                    if let (Some(x), Some(y)) = (cfg.window.orb_x, cfg.window.orb_y) {
                        if position_fits_monitor(&window, x as i32, y as i32, 120, 120) {
                            let pos = tauri::PhysicalPosition::new(x as i32, y as i32);
                            let _ = window.set_position(tauri::Position::Physical(pos));
                            info!("Restored orb position: ({}, {})", x, y);
                        } else {
                            let _ = window.center();
                            info!("Orb position ({},{}) off-screen, centering", x, y);
                        }
                    }
                }

                // Window stays hidden until the frontend calls show_window
                // after Svelte has mounted and set the correct mode (overlay vs
                // dashboard). This prevents the black-square flash that occurs
                // when the window is shown before CSS/HTML has loaded.
                // See: window_cmds::show_window, called from App.svelte.
                if cfg.behavior.start_minimized {
                    info!("Config: start_minimized=true (will minimize after frontend show)");
                }
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            // Save window bounds when the window is about to close.
            // Mode-aware: dashboard saves to dashboardX/Y + panelWidth/Height,
            // orb saves to orbX/Y only (preserving dashboard dimensions).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill all terminal sessions
                if let Some(state) = _window.try_state::<terminal_cmds::TerminalManagerState>() {
                    if let Ok(mut manager) = state.0.lock() {
                        manager.kill_all();
                    }
                }

                // LSP servers are cleaned up automatically when the process exits.
                // The tokio::process::Child handles are dropped, which kills the servers.

                use crate::config::persistence;
                use crate::services::platform;

                let is_maximized = _window.is_maximized().unwrap_or(false);

                if let Ok(pos) = _window.outer_position() {
                    if let Ok(size) = _window.outer_size() {
                        let config_dir = platform::get_config_dir();
                        // Use in-memory config (always current) instead of disk read
                        let current_config = commands::config::get_config_snapshot();
                        let is_dashboard = current_config.window.expanded;

                        // Always save maximized state.
                        // When maximized, skip saving position/size (they reflect the
                        // maximized dimensions, not the user's chosen window bounds).
                        let patch = if is_dashboard {
                            if is_maximized {
                                serde_json::json!({
                                    "window": { "maximized": true }
                                })
                            } else {
                                serde_json::json!({
                                    "window": {
                                        "dashboardX": pos.x as f64,
                                        "dashboardY": pos.y as f64,
                                        "maximized": false,
                                    },
                                    "appearance": {
                                        "panelWidth": size.width,
                                        "panelHeight": size.height,
                                    }
                                })
                            }
                        } else {
                            serde_json::json!({
                                "window": {
                                    "orbX": pos.x as f64,
                                    "orbY": pos.y as f64,
                                    "maximized": false,
                                }
                            })
                        };

                        let current_val = serde_json::to_value(&current_config).unwrap_or_default();
                        let merged = persistence::deep_merge(current_val, patch);
                        if let Ok(updated) = serde_json::from_value::<crate::config::schema::AppConfig>(merged) {
                            let _ = persistence::save_config(&config_dir, &updated);
                            info!(
                                "Saved {} bounds on close: pos=({},{}) size={}x{} maximized={}",
                                if is_dashboard { "dashboard" } else { "orb" },
                                pos.x, pos.y, size.width, size.height, is_maximized
                            );
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Voice Mirror");
}
