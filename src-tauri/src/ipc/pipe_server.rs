//! Named pipe server for the Tauri app.
//!
//! Creates a named pipe (Windows) or Unix domain socket (Unix) and listens for
//! MCP binary clients. Incoming `McpToApp` messages are dispatched as Tauri
//! events. Outgoing `AppToMcp` messages (user chat input) are forwarded to the
//! MCP binary for instant delivery to `voice_listen`.
//!
//! The server automatically accepts new connections after a client disconnects,
//! so browser/capture tools keep working across MCP binary restarts.

use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

use super::protocol::{self, AppToMcp, McpToApp};
use crate::services::inbox_watcher::InboxEvent;

// ---------------------------------------------------------------------------
// Pipe name generation
// ---------------------------------------------------------------------------

/// Generate a unique pipe name for this process.
#[cfg(windows)]
pub fn generate_pipe_name() -> String {
    let pid = std::process::id();
    format!(r"\\.\pipe\voice-mirror-{}", pid)
}

#[cfg(unix)]
pub fn generate_pipe_name() -> String {
    let pid = std::process::id();
    let dir = std::env::temp_dir();
    dir.join(format!("voice-mirror-{}.sock", pid))
        .to_string_lossy()
        .to_string()
}

// ---------------------------------------------------------------------------
// PipeServerState (Tauri managed state)
// ---------------------------------------------------------------------------

/// Shared sender slot — swapped on each reconnection.
type TxSlot = Arc<std::sync::Mutex<Option<mpsc::UnboundedSender<AppToMcp>>>>;

/// Tauri-managed state for the pipe server.
///
/// The `tx` sender is swapped on each reconnection — wrapped in a std Mutex
/// so `send()` stays synchronous (unbounded send is non-blocking).
pub struct PipeServerState {
    /// The pipe name (passed to MCP binary via env var).
    pub pipe_name: String,
    /// Channel sender for the current connection (None when disconnected).
    /// Shared with the server loop via Arc.
    tx: TxSlot,
    /// Whether a client is currently connected.
    pub connected: Arc<Mutex<bool>>,
}

impl PipeServerState {
    /// Create a disconnected dummy state (used when pipe server fails to start).
    pub fn disconnected() -> Self {
        Self {
            pipe_name: String::new(),
            tx: Arc::new(std::sync::Mutex::new(None)),
            connected: Arc::new(Mutex::new(false)),
        }
    }

    /// Send a message to the MCP binary (if connected).
    pub fn send(&self, msg: AppToMcp) -> Result<(), String> {
        let guard = self.tx.lock().map_err(|e| format!("Pipe tx lock poisoned: {}", e))?;
        if let Some(tx) = guard.as_ref() {
            tx.send(msg).map_err(|e| format!("Pipe send failed: {}", e))
        } else {
            Err("Pipe not connected".to_string())
        }
    }

    /// Check if a client is connected.
    pub async fn is_connected(&self) -> bool {
        *self.connected.lock().await
    }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/// Start the named pipe server. Returns the managed state.
///
/// Spawns a background tokio task that:
/// 1. Creates the pipe/socket
/// 2. Accepts a client connection
/// 3. Runs read/write loops
/// 4. On disconnect, loops back to accept a new connection
pub fn start_pipe_server(
    app_handle: AppHandle,
    pipe_name: &str,
) -> Result<PipeServerState, String> {
    let connected = Arc::new(Mutex::new(false));
    let tx_slot: TxSlot = Arc::new(std::sync::Mutex::new(None));

    let pipe_name_owned = pipe_name.to_string();
    let connected_clone = Arc::clone(&connected);
    let tx_slot_clone = Arc::clone(&tx_slot);

    // Spawn the server task
    tauri::async_runtime::spawn(async move {
        run_pipe_server_loop(app_handle, &pipe_name_owned, tx_slot_clone, connected_clone).await;
    });

    Ok(PipeServerState {
        pipe_name: pipe_name.to_string(),
        tx: tx_slot,
        connected,
    })
}

/// Internal: run the pipe server loop (reconnects after each disconnect).
async fn run_pipe_server_loop(
    app_handle: AppHandle,
    pipe_name: &str,
    tx_slot: TxSlot,
    connected: Arc<Mutex<bool>>,
) {
    info!("[PipeServer] Starting on: {}", pipe_name);

    loop {
        // Platform-specific accept (blocks until a client connects)
        let stream = match accept_connection(pipe_name).await {
            Ok(s) => s,
            Err(e) => {
                error!("[PipeServer] Accept failed: {} — retrying in 2s", e);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            }
        };

        info!("[PipeServer] Client connected");
        *connected.lock().await = true;

        // Create a per-connection channel and install the sender
        let (tx, rx) = mpsc::unbounded_channel::<AppToMcp>();
        if let Ok(mut guard) = tx_slot.lock() {
            *guard = Some(tx);
        }

        // Split stream for concurrent read/write
        let (reader, writer) = tokio::io::split(stream);

        // Spawn write loop
        let write_handle = tokio::spawn(write_loop(writer, rx));

        // Run read loop (blocking until disconnect)
        read_loop(reader, &app_handle).await;

        // Client disconnected — clean up
        if let Ok(mut guard) = tx_slot.lock() {
            *guard = None;
        }

        // Clear any listener lock the MCP binary held.
        {
            let lock_path = crate::services::inbox_watcher::get_mcp_data_dir()
                .join("listener_lock.json");
            match tokio::fs::remove_file(&lock_path).await {
                Ok(()) => info!("[PipeServer] Cleared listener lock (client disconnected)"),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => warn!("[PipeServer] Failed to clear listener lock: {}", e),
            }
        }

        *connected.lock().await = false;

        // Abort write loop (the rx will be dropped, which closes the channel)
        write_handle.abort();

        info!("[PipeServer] Client disconnected — waiting for new connection...");

        // Small delay before re-listening to avoid tight loop on rapid reconnects
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Read loop: receive McpToApp messages and dispatch as Tauri events.
async fn read_loop<R: AsyncRead + Unpin>(mut reader: R, app_handle: &AppHandle) {
    loop {
        match protocol::read_message::<_, McpToApp>(&mut reader).await {
            Ok(Some(msg)) => dispatch_message(msg, app_handle),
            Ok(None) => {
                info!("[PipeServer] Pipe closed by client (EOF)");
                break;
            }
            Err(e) => {
                warn!("[PipeServer] Read error: {}", e);
                break;
            }
        }
    }
}

/// Write loop: forward AppToMcp messages from the channel to the pipe.
async fn write_loop<W: AsyncWrite + Unpin>(
    mut writer: W,
    mut rx: mpsc::UnboundedReceiver<AppToMcp>,
) {
    while let Some(msg) = rx.recv().await {
        if let Err(e) = protocol::write_message(&mut writer, &msg).await {
            warn!("[PipeServer] Write error: {}", e);
            break;
        }
    }
}

/// Dispatch a received MCP message as a Tauri event.
fn dispatch_message(msg: McpToApp, app_handle: &AppHandle) {
    match msg {
        McpToApp::VoiceSend {
            from,
            message,
            thread_id,
            reply_to,
            message_id,
            timestamp,
        } => {
            // voice_send is always called by an AI provider, never a user.
            // Use "ai_message" regardless of instance_id so all providers
            // (Claude Code, OpenCode, etc.) trigger TTS + chat card.
            let event = InboxEvent {
                kind: "ai_message".to_string(),
                text: message,
                from,
                id: message_id,
                timestamp,
                thread_id,
                reply_to,
            };

            if let Err(e) = app_handle.emit("mcp-inbox-message", &event) {
                warn!("[PipeServer] Failed to emit mcp-inbox-message: {}", e);
            }
        }
        McpToApp::ListenStart {
            instance_id,
            from_sender,
            thread_id,
        } => {
            info!(
                "[PipeServer] AI {} listening for messages from {} (thread: {:?})",
                instance_id, from_sender, thread_id
            );
            // The pipe server doesn't need to act on this — it just means the MCP
            // binary is now waiting for AppToMcp::UserMessage on the pipe.
        }
        McpToApp::Ready => {
            info!("[PipeServer] MCP binary ready (pipe handshake complete)");
            // New Claude session — clear stale inbox messages and notify frontend
            crate::services::inbox_watcher::clear_inbox();
            if let Err(e) = app_handle.emit("mcp-session-start", ()) {
                warn!("[PipeServer] Failed to emit mcp-session-start: {}", e);
            }
        }
        McpToApp::BrowserRequest { request_id, action, args } => {
            info!(
                "[PipeServer] Browser request: id={}, action={}",
                request_id, action
            );

            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let result = crate::services::browser_bridge::handle_browser_action(
                    &app, &action, &args,
                )
                .await;

                let response = match result {
                    Ok(value) => AppToMcp::BrowserResponse {
                        request_id,
                        success: true,
                        result: Some(value),
                        error: None,
                    },
                    Err(e) => AppToMcp::BrowserResponse {
                        request_id,
                        success: false,
                        result: None,
                        error: Some(e),
                    },
                };

                // Send response back through the pipe via PipeServerState
                use tauri::Manager;
                if let Some(pipe_state) = app.try_state::<PipeServerState>() {
                    if let Err(e) = pipe_state.send(response) {
                        warn!("[PipeServer] Failed to send browser response: {}", e);
                    }
                } else {
                    warn!("[PipeServer] PipeServerState not available for browser response");
                }
            });
        }
        McpToApp::CaptureRequest { request_id, action, args } => {
            info!(
                "[PipeServer] Capture request: id={}, action={}",
                request_id, action
            );

            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let result = handle_capture_action(&app, &action, &args).await;

                let response = match result {
                    Ok(value) => AppToMcp::CaptureResponse {
                        request_id,
                        success: true,
                        result: Some(value),
                        error: None,
                    },
                    Err(e) => AppToMcp::CaptureResponse {
                        request_id,
                        success: false,
                        result: None,
                        error: Some(e),
                    },
                };

                use tauri::Manager;
                if let Some(pipe_state) = app.try_state::<PipeServerState>() {
                    if let Err(e) = pipe_state.send(response) {
                        warn!("[PipeServer] Failed to send capture response: {}", e);
                    }
                } else {
                    warn!("[PipeServer] PipeServerState not available for capture response");
                }
            });
        }
        McpToApp::GetLogs { request_id, channel, level, last, search } => {
            info!("[PipeServer] GetLogs request: id={}, channel={:?}", request_id, channel);
            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;
                let text = if let Some(store) = app.try_state::<std::sync::Arc<crate::services::output::OutputStore>>() {
                    match &channel {
                        Some(ch_str) => {
                            if let Some(ch) = crate::services::output::Channel::from_str(ch_str) {
                                let (entries, total) = store.query(
                                    ch,
                                    level.as_deref(),
                                    last.or(Some(100)),
                                    search.as_deref(),
                                );
                                let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                                let count = lines.len();
                                let mut result = lines.join("\n");
                                result.push_str(&format!("\n\n--- {} entries (filtered from {} total) ---", count, total));
                                result
                            } else {
                                // Try project channel
                                let (entries, total) = store.query_project(
                                    ch_str,
                                    level.as_deref(),
                                    last.or(Some(100)),
                                    search.as_deref(),
                                );
                                if total > 0 {
                                    let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                                    let count = lines.len();
                                    let mut result = lines.join("\n");
                                    result.push_str(&format!(
                                        "\n\n--- {} entries (filtered from {} total, project channel) ---",
                                        count, total
                                    ));
                                    result
                                } else {
                                    let project_labels: Vec<String> = store.project_summary()
                                        .iter()
                                        .map(|ps| ps.label.clone())
                                        .collect();
                                    let available = if project_labels.is_empty() {
                                        String::new()
                                    } else {
                                        format!(" Project: {}", project_labels.join(", "))
                                    };
                                    format!(
                                        "Unknown channel: {}. System: app, cli, voice, mcp, browser, frontend.{}",
                                        ch_str, available
                                    )
                                }
                            }
                        }
                        None => {
                            let summaries = store.summary();
                            let mut text = String::from("Output Channels:\n");
                            for s in &summaries {
                                text.push_str(&format!(
                                    "  {:<10} {:>4} entries ({} error, {} warn, {} info)\n",
                                    format!("{}:", s.channel),
                                    s.total, s.error, s.warn, s.info
                                ));
                            }

                            let project_summaries = store.project_summary();
                            if !project_summaries.is_empty() {
                                text.push_str("\nProject Channels:\n");
                                for ps in &project_summaries {
                                    text.push_str(&format!(
                                        "  {} ({} entries, {} error, {} warn)\n",
                                        ps.label, ps.total, ps.error, ps.warn
                                    ));
                                }
                            }
                            text
                        }
                    }
                } else {
                    "OutputStore not available".into()
                };

                if let Some(pipe_state) = app.try_state::<PipeServerState>() {
                    let _ = pipe_state.send(AppToMcp::LogEntries { request_id, text });
                }
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Capture action handler
// ---------------------------------------------------------------------------

/// Handle a window capture action dispatched from the MCP binary.
async fn handle_capture_action(
    app: &AppHandle,
    action: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    match action {
        "list_windows" => {
            let filter = args
                .get("filter")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            tokio::task::spawn_blocking(move || {
                #[cfg(target_os = "windows")]
                {
                    // Use metadata-only variant (no thumbnails/icons) to keep
                    // MCP response under Claude Code's 30KB limit.
                    let mut windows = crate::commands::screenshot::list_visible_windows_metadata()?;
                    if let Some(ref f) = filter {
                        let f_lower = f.to_lowercase();
                        windows.retain(|w| {
                            w.title.to_lowercase().contains(&f_lower)
                                || w.process_name.to_lowercase().contains(&f_lower)
                        });
                    }
                    serde_json::to_value(&windows).map_err(|e| format!("Serialize error: {}", e))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = filter;
                    Err("Window capture is Windows-only".into())
                }
            })
            .await
            .map_err(|e| format!("Task panicked: {}", e))?
        }
        "capture_window" => {
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let hwnd = args.get("hwnd").and_then(|v| v.as_i64());
            tokio::task::spawn_blocking(move || {
                #[cfg(target_os = "windows")]
                {
                    let target_hwnd = if let Some(h) = hwnd {
                        h
                    } else if let Some(ref t) = title {
                        let windows = crate::commands::screenshot::list_visible_windows_metadata()?;
                        let t_lower = t.to_lowercase();
                        windows
                            .iter()
                            .find(|w| w.title.to_lowercase().contains(&t_lower))
                            .map(|w| w.hwnd)
                            .ok_or_else(|| format!("No window found matching: {}", t))?
                    } else {
                        return Err("Either 'title' or 'hwnd' required".into());
                    };
                    let (base64_png, width, height) =
                        crate::commands::screenshot::capture_window_as_base64(target_hwnd)?;
                    Ok(serde_json::json!({
                        "base64": base64_png,
                        "contentType": "image/png",
                        "width": width,
                        "height": height
                    }))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = (title, hwnd);
                    Err("Window capture is Windows-only".into())
                }
            })
            .await
            .map_err(|e| format!("Task panicked: {}", e))?
        }
        "capture_browser" => {
            let (base64_png, width, height) =
                crate::commands::screenshot::capture_lens_viewport(app).await?;
            Ok(serde_json::json!({
                "base64": base64_png,
                "contentType": "image/png",
                "width": width,
                "height": height
            }))
        }
        // Sandbox tools: drive an app being built over CDP. These run here (in the
        // app process) so services::sandbox's @ref store is shared across calls.
        "sandbox_snapshot" => {
            // Route CDP (WebView2/Tauri) vs UIA (native window) — IDENTICAL `@ref`
            // model + JSON shape, so the agent can't tell which engine ran.
            let window = args.get("window").and_then(|v| v.as_str());
            match decide_sandbox_route(args)? {
                SandboxRoute::Cdp(port) => {
                    crate::services::sandbox::snapshot(port, window).await
                }
                SandboxRoute::Uia(hwnd) => crate::services::uia::snapshot(hwnd, window).await,
            }
        }
        "sandbox_screenshot" => {
            // CDP path: prefer the WGC window frame (transparent-safe, live), else
            // CDP Page.captureScreenshot of the active target.
            // UIA path (native, no CDP): WGC frame if the preview is mirroring this
            // window, else a GDI PrintWindow capture of the exact window.
            match decide_sandbox_route(args)? {
                SandboxRoute::Cdp(port) => {
                    crate::services::sandbox_stream::capture_app_window(port).await
                }
                SandboxRoute::Uia(hwnd) => capture_native_window(hwnd),
            }
        }
        "sandbox_click" => {
            let element_ref = args
                .get("element_ref")
                .and_then(|v| v.as_str())
                .ok_or("element_ref parameter required")?;
            match decide_sandbox_route(args)? {
                SandboxRoute::Cdp(port) => {
                    crate::services::sandbox::click(port, element_ref).await
                }
                SandboxRoute::Uia(hwnd) => crate::services::uia::click(hwnd, element_ref).await,
            }
        }
        "sandbox_type" => {
            let element_ref = args
                .get("element_ref")
                .and_then(|v| v.as_str())
                .ok_or("element_ref parameter required")?;
            let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
            match decide_sandbox_route(args)? {
                SandboxRoute::Cdp(port) => {
                    crate::services::sandbox::type_text(port, element_ref, text).await
                }
                SandboxRoute::Uia(hwnd) => {
                    crate::services::uia::type_text(hwnd, element_ref, text).await
                }
            }
        }
        "sandbox_close" => {
            // Works for both backends: closes whatever window the last snapshot
            // resolved (`active_hwnd`), CDP or native. No port/backend needed.
            crate::services::sandbox::close_active_window()
        }
        "sandbox_start" => {
            // The agent's FIRST port of call: launch the app it's building with a
            // SAFE (non-host) CDP port and open the live preview. The actual start
            // is done by the frontend's devServerManager (it injects the safe
            // debug-port env var + registers the active sandbox port); we detect
            // the dev server here, REFUSE to claim a launch on a port conflict, and
            // briefly poll the derived CDP port so the response tells the truth.
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // No explicit path: the frontend resolves the active project. We can't
            // pre-check ports here, so emit and report HONESTLY that it's unconfirmed.
            let Some(path) = path else {
                app.emit("sandbox-start-request", serde_json::json!({ "path": null }))
                    .map_err(|e| format!("Failed to emit sandbox-start-request: {}", e))?;
                return Ok(serde_json::json!({
                    "launching": true,
                    "detected": Vec::<String>::new(),
                    "message": "Kicked off a launch for the active project. A native Tauri build can \
                                take a few minutes — call sandbox_snapshot once the App Preview appears. \
                                If nothing shows, pass an explicit `path`, make sure Voice Mirror is on \
                                the Lens workspace, or launch the app yourself and use sandbox_attach."
                }));
            };

            let detected = {
                let p = path.clone();
                tokio::task::spawn_blocking(move || crate::services::dev_server::detect_dev_servers(&p))
                    .await
                    .map_err(|e| format!("Detection task panicked: {}", e))?
            };

            let frameworks: Vec<String> = detected
                .iter()
                .map(|d| format!("{} :{}", d.framework, d.port))
                .collect();

            // Nothing to launch — say so instead of faking success.
            let Some(target) = detected
                .iter()
                .find(|d| d.framework.eq_ignore_ascii_case("tauri"))
                .or_else(|| detected.first())
            else {
                return Ok(serde_json::json!({
                    "launching": false,
                    "detected": frameworks,
                    "message": format!(
                        "No dev server detected in {}. Nothing was launched. Check the path or add a \
                         dev script (e.g. a Tauri/Vite project with `npm run dev`).",
                        path
                    )
                }));
            };

            let dev_port = target.port;
            let is_tauri = target.framework.eq_ignore_ascii_case("tauri");
            // Mirror the frontend's CDP-port math (dev-server-manager.svelte.js).
            let cdp_port: Option<u16> = if is_tauri { Some(9223 + (dev_port % 1000)) } else { None };

            // Port-in-use conflict: do NOT claim a launch. The dev server can't bind
            // and `beforeDevCommand` will terminate non-zero. (In dev, Voice Mirror
            // itself occupies its own dev port — same symptom.)
            let dev_busy = {
                let p = dev_port;
                tokio::task::spawn_blocking(move || crate::services::dev_server::is_port_listening(p))
                    .await
                    .unwrap_or(false)
            };
            if dev_busy {
                // Name the process holding the port so the agent doesn't have to
                // shell out to PowerShell/netstat to find it.
                let holder = {
                    let p = dev_port;
                    tokio::task::spawn_blocking(move || crate::services::ports::describe_port_holder(p))
                        .await
                        .unwrap_or_default()
                };
                return Ok(serde_json::json!({
                    "launching": false,
                    "detected": frameworks,
                    "message": format!(
                        "Port {} is already in use{}, so {} can't start there — its dev server would \
                         fail with 'Port {} is already in use' and beforeDevCommand would exit non-zero. \
                         Nothing was launched. If your app is ALREADY running on :{} with a debug port, \
                         call sandbox_attach with that --remote-debugging-port. Otherwise stop whatever \
                         is holding :{} (use list_ports to see it) and retry sandbox_start.",
                        dev_port, holder, target.framework, dev_port, dev_port, dev_port
                    )
                }));
            }

            // Port is free — kick off the real launch via the frontend.
            app.emit(
                "sandbox-start-request",
                serde_json::json!({ "path": path.clone() }),
            )
            .map_err(|e| format!("Failed to emit sandbox-start-request: {}", e))?;

            // Briefly poll for a real signal. A cold Tauri build usually exceeds
            // this window (we say so), but a warm rebuild / immediate bind shows up.
            let mut cdp_up = false;
            let mut dev_up = false;
            for _ in 0..20 {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Some(cp) = cdp_port {
                    let up = tokio::task::spawn_blocking(move || {
                        crate::services::dev_server::is_port_listening(cp)
                    })
                    .await
                    .unwrap_or(false);
                    if up {
                        cdp_up = true;
                        break;
                    }
                }
                if !dev_up {
                    let p = dev_port;
                    dev_up = tokio::task::spawn_blocking(move || {
                        crate::services::dev_server::is_port_listening(p)
                    })
                    .await
                    .unwrap_or(false);
                }
            }

            let message = if cdp_up {
                format!(
                    "Launched {} — its debug port (:{}) is up. Call sandbox_snapshot / \
                     sandbox_screenshot to see and drive it.",
                    target.framework,
                    cdp_port.unwrap_or(0)
                )
            } else if dev_up {
                format!(
                    "Launched {} — the dev server is up on :{}. The app window/debug port is still \
                     coming up; call sandbox_snapshot in a few seconds.",
                    target.framework, dev_port
                )
            } else {
                format!(
                    "Kicked off {}. The dev server hasn't bound :{} yet — a native Tauri build can take \
                     a few minutes. Call sandbox_snapshot once the App Preview appears. If nothing happens \
                     after a minute, check the project's dev-server terminal for build errors, or launch \
                     the app yourself and use sandbox_attach.",
                    target.framework, dev_port
                )
            };

            Ok(serde_json::json!({
                "launching": true,
                "ready": cdp_up,
                "detected": frameworks,
                "cdpPort": cdp_port,
                "devPort": dev_port,
                "message": message,
            }))
        }
        "sandbox_attach" => {
            // Register an already-running CDP app (the agent launched it with the
            // debug port) as the active sandbox + open the preview.
            let port = args
                .get("port")
                .and_then(|v| v.as_u64())
                .map(|p| p as u16)
                .ok_or("sandbox_attach requires a `port` (the app's --remote-debugging-port)")?;
            let result = crate::services::sandbox::attach(port).await?;
            // Tell the frontend to open the live preview for this port.
            app.emit("sandbox-attached", serde_json::json!({ "port": port }))
                .map_err(|e| format!("Failed to emit sandbox-attached: {}", e))?;
            Ok(result)
        }
        _ => Err(format!("Unknown capture action: {}", action)),
    }
}

/// Which engine a sandbox action targets — CDP (WebView2/Tauri on a port) or UIA
/// (a native window by HWND).
#[derive(Clone, Copy)]
enum SandboxRoute {
    Cdp(u16),
    Uia(i64),
}

/// Decide the backend for a sandbox action, preserving the CDP behavior exactly:
///   1. explicit `port` → CDP (with the host-renderer guard);
///   2. explicit `hwnd` → UIA (drive a native, non-CDP app);
///   3. `window` title with NO active CDP app → resolve it to a native window (UIA);
///   4. else follow the last snapshot's backend (`active_backend()`);
///   5. else the active CDP port Voice Mirror launched (legacy default).
fn decide_sandbox_route(args: &serde_json::Value) -> Result<SandboxRoute, String> {
    use crate::services::sandbox::{self, ActiveBackend};

    // 1. Explicit CDP port (unchanged) — never the host's own renderer.
    if let Some(p) = args.get("port").and_then(|v| v.as_u64()) {
        let port = p as u16;
        if port == sandbox::host_cdp_port() {
            return Err(format!(
                "Port {} is Voice Mirror's own renderer — not the app you're building. \
                 Launch your app with a different --remote-debugging-port (use sandbox_start), \
                 then retry.",
                port
            ));
        }
        return Ok(SandboxRoute::Cdp(port));
    }

    // 2. Explicit native window handle → UIA.
    if let Some(h) = args.get("hwnd").and_then(|v| v.as_i64()) {
        return Ok(SandboxRoute::Uia(h));
    }

    // 3. `window` title with no active CDP app → treat as a native window name.
    if let Some(win) = args.get("window").and_then(|v| v.as_str()) {
        let no_cdp = sandbox::active_cdp_port().is_none()
            && !matches!(sandbox::active_backend(), Some(ActiveBackend::Cdp(_)));
        if no_cdp {
            if let Some(h) = find_native_window_by_title(win) {
                return Ok(SandboxRoute::Uia(h));
            }
        }
    }

    // 4. Follow the engine the last snapshot used.
    match sandbox::active_backend() {
        Some(ActiveBackend::Cdp(p)) => return Ok(SandboxRoute::Cdp(p)),
        Some(ActiveBackend::Uia(h)) => return Ok(SandboxRoute::Uia(h)),
        None => {}
    }

    // 5. Legacy default: the active CDP port Voice Mirror launched.
    let port = sandbox::active_cdp_port().ok_or_else(|| {
        "No sandbox app is running. Call sandbox_start to launch the app you're building, \
         pass an explicit `port` (a CDP app), or pass an `hwnd` from capture_list_windows \
         (a native app like Notepad/Calculator/Settings)."
            .to_string()
    })?;
    Ok(SandboxRoute::Cdp(port))
}

/// Find a real, non-host OS window whose title matches `title` (case-insensitive
/// substring, either direction). Used to route a `window` name to UIA when no CDP
/// app is active (e.g. the agent says "Calculator").
fn find_native_window_by_title(title: &str) -> Option<i64> {
    #[cfg(windows)]
    {
        let t = title.trim().to_lowercase();
        if t.is_empty() {
            return None;
        }
        let windows = crate::commands::screenshot::list_visible_windows_metadata().ok()?;
        windows
            .into_iter()
            .filter(|w| !crate::services::sandbox::is_host_window(w.hwnd, &w.title))
            .find(|w| {
                let wt = w.title.trim().to_lowercase();
                !wt.is_empty() && (wt == t || wt.contains(&t) || t.contains(&wt))
            })
            .map(|w| w.hwnd)
    }
    #[cfg(not(windows))]
    {
        let _ = title;
        None
    }
}

/// Screenshot a NATIVE window (UIA backend): the live WGC frame if the preview is
/// mirroring exactly this window, else a GDI `PrintWindow` capture of the exact
/// window (focus/occlusion-independent). Mirrors the CDP screenshot's echo fields.
#[cfg(windows)]
fn capture_native_window(hwnd: i64) -> Result<serde_json::Value, String> {
    use crate::services::{sandbox, window_stream};
    let meta = sandbox::active_meta();

    // PATH 1 — the same live WGC frame the user sees, but ONLY when the preview is
    // pointed at THIS window (so the screenshot can't show a different app).
    if window_stream::current_hwnd() == Some(hwnd) {
        if let Some(jpeg) = window_stream::latest_frame() {
            let b64 = crate::voice::tts::crypto::base64_encode(&jpeg);
            return Ok(serde_json::json!({
                "base64": b64,
                "contentType": "image/jpeg",
                "source": "wgc",
                "activeWindow": meta.title,
                "activeLabel": meta.label,
                "activeUrl": meta.url,
                "activeIndex": meta.index,
                "activeWidth": meta.width,
                "activeHeight": meta.height,
            }));
        }
    }

    // PATH 2 — GDI PrintWindow of the exact window (works hidden/occluded too).
    let (b64, w, h) = crate::commands::screenshot::capture_window_as_base64(hwnd)?;
    Ok(serde_json::json!({
        "base64": b64,
        "contentType": "image/png",
        "source": "gdi",
        "activeWindow": meta.title,
        "activeLabel": meta.label,
        "activeUrl": meta.url,
        "activeIndex": meta.index,
        "activeWidth": if meta.width > 0 { meta.width } else { w as i64 },
        "activeHeight": if meta.height > 0 { meta.height } else { h as i64 },
    }))
}

#[cfg(not(windows))]
fn capture_native_window(_hwnd: i64) -> Result<serde_json::Value, String> {
    Err("Native window capture is Windows-only".to_string())
}

// ---------------------------------------------------------------------------
// Platform-specific accept
// ---------------------------------------------------------------------------

/// Unified stream type for cross-platform support.
#[cfg(windows)]
type ServerStream = tokio::net::windows::named_pipe::NamedPipeServer;

#[cfg(unix)]
type ServerStream = tokio::net::UnixStream;

#[cfg(windows)]
async fn accept_connection(pipe_name: &str) -> Result<ServerStream, std::io::Error> {
    use tokio::net::windows::named_pipe::ServerOptions;

    // Note: NOT using first_pipe_instance(true) because this function is called
    // in a reconnection loop. The flag prevents creating a new server after the
    // previous one was dropped. Without it, the OS allows re-creating the pipe.
    let server = ServerOptions::new()
        .create(pipe_name)?;

    info!("[PipeServer] Waiting for client connection on {}", pipe_name);
    server.connect().await?;
    Ok(server)
}

#[cfg(unix)]
async fn accept_connection(socket_path: &str) -> Result<ServerStream, std::io::Error> {
    // Clean up stale socket file
    let _ = std::fs::remove_file(socket_path);

    let listener = tokio::net::UnixListener::bind(socket_path)?;
    info!(
        "[PipeServer] Waiting for client connection on {}",
        socket_path
    );
    let (stream, _) = listener.accept().await?;
    Ok(stream)
}
