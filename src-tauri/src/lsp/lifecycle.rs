//! LSP server lifecycle management.
//!
//! Handles spawning language servers, the initialize handshake, stderr
//! monitoring, health checks, idle shutdown, and graceful shutdown.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};
use tracing::{debug, info, warn};

use super::{client, detection, manifest, server_key, types, LspManager, LspManagerState, LspServer};
use super::types::{LspServerStatus, LspServerStatusEvent};

/// Once-per-session flag: emit `lsp-node-not-found` only once.
static NODE_NOT_FOUND_EMITTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Maximum number of stderr lines retained per server for diagnostic display.
const MAX_STDERR_LINES: usize = 50;

impl LspManager {
    /// Ensure a server for the given language is running.
    ///
    /// If already running, returns immediately. Otherwise, detects the binary,
    /// spawns it, performs the initialize handshake, and starts the reader loop.
    pub async fn ensure_server(
        &mut self,
        lang_id: &str,
        project_root: &str,
    ) -> Result<(), String> {
        if self.servers.contains_key(&server_key(lang_id, project_root)) {
            return Ok(());
        }

        // Detect the server binary for this language
        let server_info = detection::detect_for_extension(
            &self.extension_for_language(lang_id),
        )
        .ok_or_else(|| format!("No LSP server configured for language '{}'", lang_id))?;

        self.start_server(lang_id, project_root, server_info).await
    }

    /// Start a server from an already-detected `ServerInfo`.
    ///
    /// Handles auto-install, spawning, initialization, and reader loop setup.
    /// Callers must check `servers.contains_key` before calling.
    pub(crate) async fn start_server(
        &mut self,
        lang_id: &str,
        project_root: &str,
        server_info: detection::ServerInfo,
    ) -> Result<(), String> {

        // If server binary not found, attempt auto-install
        let server_info = if !server_info.installed {
            // Load manifest to get install config
            let manifest = manifest::load_manifest()
                .map_err(|e| format!("Failed to load LSP manifest: {}", e))?;

            let server_id = server_info
                .server_id
                .as_deref()
                .ok_or_else(|| "No server_id for auto-install".to_string())?;

            let entry = manifest
                .servers
                .get(server_id)
                .ok_or_else(|| format!("Server '{}' not found in manifest", server_id))?;

            // Get install directory
            let lsp_dir = super::installer::get_lsp_servers_dir()
                .map_err(|e| format!("Failed to get LSP servers directory: {}", e))?;

            // Install the server using the appropriate method
            info!(
                "Auto-installing LSP server '{}' for language '{}'",
                server_id, lang_id
            );

            match entry.install.install_type.as_str() {
                "npm" => {
                    // Check if Node.js is available (only needed for npm installs)
                    let node_status = super::installer::detect_node();
                    if !node_status.available {
                        // Emit lsp-node-not-found event once per session
                        if NODE_NOT_FOUND_EMITTED
                            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                        {
                            let _ = self.app_handle.emit("lsp-node-not-found", ());
                        }
                        return Err(format!(
                            "LSP server '{}' requires Node.js for installation. Install Node.js from nodejs.org",
                            server_info.binary
                        ));
                    }

                    super::installer::install_server(
                        server_id,
                        &entry.install.packages,
                        &entry.install.version,
                        &lsp_dir,
                        Some(&self.app_handle),
                    )
                    .await?;
                }
                "github-release" => {
                    super::installer::install_github_release(
                        server_id,
                        &entry.install.repo,
                        &entry.install.asset_pattern,
                        &entry.install.version,
                        &lsp_dir,
                        Some(&self.app_handle),
                    )
                    .await?;
                }
                other => {
                    return Err(format!(
                        "Unknown install type '{}' for server '{}'",
                        other, server_id
                    ));
                }
            }

            // Retry detection after install using the server's own extension
            let retry_ext = entry
                .extensions
                .first()
                .map(|e| e.trim_start_matches('.').to_string())
                .unwrap_or_else(|| self.extension_for_language(lang_id));
            detection::detect_for_extension(&retry_ext)
                .ok_or_else(|| format!("Server '{}' still not found after install", server_id))?
        } else {
            server_info
        };

        // Invariant: server_info.installed is always true here
        debug_assert!(server_info.installed, "ServerInfo should have installed=true after detection");

        info!(
            "Starting LSP server '{}' for language '{}'",
            server_info.binary, lang_id
        );

        // Spawn the server process.
        // On Windows, npm-installed servers are .cmd batch wrappers that break
        // stdio piping through cmd.exe. Resolve to `node <script>` directly.
        let (spawn_binary, spawn_args) =
            if let Some((node, args)) = detection::resolve_node_script(&server_info) {
                info!(
                    "LSP '{}' resolved to node script: {} {}",
                    server_info.binary,
                    node,
                    args.first().unwrap_or(&String::new())
                );
                (node, args)
            } else {
                let binary_path = server_info
                    .resolved_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| server_info.binary.clone());
                info!("LSP binary resolved to: {}", binary_path);
                (binary_path, server_info.args.clone())
            };

        let mut cmd = tokio::process::Command::new(&spawn_binary);
        cmd.args(&spawn_args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(project_root)
            .kill_on_drop(true);

        // On Windows, prevent console window from flashing
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let mut process = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn '{}': {}", server_info.binary, e))?;

        // Give the process a moment, then check if it crashed immediately
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if let Some(exit_status) = process.try_wait().ok().flatten() {
            let stderr_msg = if let Some(mut stderr) = process.stderr.take() {
                let mut buf = String::new();
                use tokio::io::AsyncReadExt;
                let _ = stderr.read_to_string(&mut buf).await;
                buf
            } else {
                String::new()
            };
            let detail = if stderr_msg.trim().is_empty() {
                format!("exit code: {}", exit_status)
            } else {
                stderr_msg.trim().to_string()
            };
            return Err(format!(
                "LSP server '{}' exited immediately: {}",
                server_info.binary, detail
            ));
        }

        let stdin = process
            .stdin
            .take()
            .ok_or("Failed to get LSP server stdin")?;
        let stdin = Arc::new(Mutex::new(stdin));
        let stdout = process
            .stdout
            .take()
            .ok_or("Failed to get LSP server stdout")?;

        // Shared buffer for stderr lines
        let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        // Spawn a task to log stderr output (deduped + rate-limited)
        if let Some(stderr) = process.stderr.take() {
            spawn_stderr_reader(stderr, lang_id.to_string(), server_info.binary.clone(), stderr_buf.clone());
        }

        let pending: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let next_id = AtomicI64::new(1);

        // Start the reader loop BEFORE sending initialize
        client::spawn_reader_loop(
            stdout,
            self.app_handle.clone(),
            lang_id.to_string(),
            Arc::clone(&pending),
            Arc::clone(&stdin),
            server_key(lang_id, project_root),
        );

        // Build the root URI for the project
        let root_uri = types::file_uri("", project_root);

        // Load initializationOptions from the manifest entry
        let init_options = manifest::load_manifest()
            .ok()
            .and_then(|m| {
                server_info
                    .server_id
                    .as_deref()
                    .and_then(|id| m.servers.get(id).cloned())
            })
            .map(|entry| entry.initialization_options)
            .unwrap_or(serde_json::Value::Null);

        // Send initialize request
        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "workspaceFolders": [{
                "uri": root_uri,
                "name": std::path::Path::new(project_root)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| project_root.to_string()),
            }],
            "initializationOptions": init_options,
            "capabilities": build_client_capabilities()
        });

        let rx = client::send_request(&mut *stdin.lock().await, &pending, "initialize", init_params, &next_id)
            .await?;

        // Wait for the initialize response (with timeout)
        let response = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| format!("LSP '{}' initialize timed out after 30s", server_info.binary))?
            .map_err(|_| "Initialize response channel closed".to_string())?;

        // Extract server capabilities from the response
        let capabilities = response
            .get("result")
            .and_then(|r| r.get("capabilities"))
            .and_then(|c| serde_json::from_value::<lsp_types::ServerCapabilities>(c.clone()).ok());

        // Extract server name and version from serverInfo in the response
        let server_name = response
            .get("result")
            .and_then(|r| r.get("serverInfo"))
            .and_then(|si| si.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let version = response
            .get("result")
            .and_then(|r| r.get("serverInfo"))
            .and_then(|si| si.get("version"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if let Some(ref name) = server_name {
            if let Some(ref ver) = version {
                info!("LSP serverInfo: {} v{}", name, ver);
            } else {
                info!("LSP serverInfo: {} (no version)", name);
            }
        }

        // Log linked editing support for debugging
        let raw_caps = response
            .get("result")
            .and_then(|r| r.get("capabilities"));
        if let Some(caps) = raw_caps {
            if let Some(le) = caps.get("linkedEditingRangeProvider") {
                info!("[{}] linkedEditingRangeProvider: {}", lang_id, le);
            } else {
                info!("[{}] linkedEditingRangeProvider: NOT advertised", lang_id);
            }
        }

        // Send initialized notification
        client::send_notification(&mut *stdin.lock().await, "initialized", serde_json::json!({})).await?;

        // Send workspace/didChangeConfiguration with settings from the manifest
        let settings = manifest::load_manifest()
            .ok()
            .and_then(|m| {
                server_info
                    .server_id
                    .as_deref()
                    .and_then(|id| m.servers.get(id).cloned())
            })
            .map(|entry| entry.settings)
            .unwrap_or(serde_json::json!({}));
        client::send_notification(
            &mut *stdin.lock().await,
            "workspace/didChangeConfiguration",
            serde_json::json!({ "settings": settings }),
        )
        .await?;

        info!(
            "LSP server '{}' initialized for language '{}'",
            server_info.binary, lang_id
        );

        let health_pending = Arc::clone(&pending);
        let health_key = server_key(lang_id, project_root);

        // Store the server
        self.servers.insert(
            health_key.clone(),
            LspServer {
                language_id: lang_id.to_string(),
                binary: server_info.binary.clone(),
                process,
                next_id,
                open_docs: HashSet::new(),
                background_docs: HashSet::new(),
                stdin,
                capabilities,
                pending_requests: pending,
                crash_count: 0,
                last_crash: None,
                state: types::ServerState::Running,
                project_root: project_root.to_string(),
                last_error: None,
                stderr_lines: stderr_buf,
                idle_cancel: None,
                server_name,
                version,
            },
        );

        // Spawn health check task
        spawn_health_check(
            self.app_handle.clone(),
            health_key,
            health_pending,
            lang_id.to_string(),
        );

        // Emit status update
        self.emit_status();

        // Trigger background project scan (non-blocking)
        let scan_lang = lang_id.to_string();
        let scan_root = project_root.to_string();
        let scan_app = self.app_handle.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let lsp_state: tauri::State<'_, LspManagerState> = scan_app.state();
            let mut manager = lsp_state.0.lock().await;
            if let Err(e) = manager.scan_project_files(&scan_lang, &scan_root).await {
                warn!("Background scan failed for '{}': {}", scan_lang, e);
            }
        });

        Ok(())
    }

    /// Ensure ALL servers matching a file extension are running (primary + supplementary).
    pub async fn ensure_servers_for_extension(
        &mut self,
        ext: &str,
        project_root: &str,
    ) -> Result<Vec<String>, String> {
        let server_infos = detection::detect_all_for_extension(ext);

        if server_infos.is_empty() {
            return Err(format!("No LSP servers configured for .{} files", ext));
        }

        let mut started = Vec::new();
        for info in server_infos {
            let server_id = info.language_id.clone();
            if self.servers.contains_key(&server_key(&server_id, project_root)) {
                started.push(server_id);
                continue;
            }
            if let Err(e) = self.start_server(&server_id, project_root, info).await {
                warn!("Failed to start '{}' server for .{}: {}", server_id, ext, e);
            } else {
                started.push(server_id);
            }
        }
        Ok(started)
    }

    /// Get status information for all servers.
    pub fn get_status(&self) -> Vec<LspServerStatus> {
        self.servers
            .values()
            .map(|s| {
                let recent_stderr = s
                    .stderr_lines
                    .try_lock()
                    .map(|buf| {
                        let len = buf.len();
                        let start = if len > 5 { len - 5 } else { 0 };
                        buf[start..].to_vec()
                    })
                    .unwrap_or_default();

                LspServerStatus {
                    language_id: s.language_id.clone(),
                    binary: s.binary.clone(),
                    state: s.state.clone(),
                    open_docs_count: s.open_docs.len(),
                    crash_count: s.crash_count,
                    project_root: s.project_root.clone(),
                    last_error: s.last_error.clone(),
                    pid: s.process.id(),
                    running: s.state == types::ServerState::Running,
                    stderr_lines: recent_stderr,
                    server_name: s.server_name.clone(),
                    version: s.version.clone(),
                }
            })
            .collect()
    }

    /// Shut down a specific language server.
    pub async fn shutdown_server(&mut self, lang_id: &str, project_root: &str) -> Result<(), String> {
        let key = server_key(lang_id, project_root);
        if let Some(mut server) = self.servers.remove(&key) {
            info!("Shutting down LSP server for '{}'", lang_id);

            let rx = client::send_request(
                &mut *server.stdin.lock().await,
                &server.pending_requests,
                "shutdown",
                Value::Null,
                &server.next_id,
            )
            .await;

            if let Ok(rx) = rx {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await;
            }

            let _ =
                client::send_notification(&mut *server.stdin.lock().await, "exit", Value::Null).await;

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = server.process.kill().await;

            self.emit_status();
            info!("LSP server for '{}' shut down", lang_id);
        }

        Ok(())
    }

    /// Shut down all running LSP servers.
    pub async fn shutdown_all(&mut self) {
        let keys: Vec<String> = self.servers.keys().cloned().collect();
        for key in keys {
            if let Some(mut server) = self.servers.remove(&key) {
                info!("Shutting down LSP server '{}' (key: {})", server.language_id, key);

                let rx = client::send_request(
                    &mut *server.stdin.lock().await,
                    &server.pending_requests,
                    "shutdown",
                    Value::Null,
                    &server.next_id,
                )
                .await;

                if let Ok(rx) = rx {
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await;
                }

                let _ =
                    client::send_notification(&mut *server.stdin.lock().await, "exit", Value::Null).await;

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = server.process.kill().await;
            }
        }
        self.emit_status();
    }

    /// Emit a status update event for all servers.
    pub(crate) fn emit_status(&self) {
        let event = LspServerStatusEvent {
            servers: self.get_status(),
        };
        if let Err(e) = self.app_handle.emit("lsp-server-status", &event) {
            warn!("Failed to emit lsp-server-status event: {}", e);
        }
    }

    /// Map a language ID back to a representative file extension for detection.
    pub(crate) fn extension_for_language(&self, lang_id: &str) -> String {
        match lang_id {
            "typescript" => "ts".to_string(),
            "rust" | "rust-analyzer" => "rs".to_string(),
            "python" => "py".to_string(),
            "css" => "css".to_string(),
            "html" => "html".to_string(),
            "json" => "json".to_string(),
            "markdown" => "md".to_string(),
            other => other.to_string(),
        }
    }
}

// =============================================================================
// Client capabilities (large JSON blob, isolated here to keep lifecycle clean)
// =============================================================================

/// Build the client capabilities JSON sent during the initialize handshake.
fn build_client_capabilities() -> Value {
    serde_json::json!({
        "textDocument": {
            "synchronization": {
                "dynamicRegistration": false,
                "willSave": false,
                "willSaveWaitUntil": false,
                "didSave": true
            },
            "completion": {
                "completionItem": {
                    "snippetSupport": true,
                    "commitCharactersSupport": false,
                    "documentationFormat": ["plaintext"],
                    "deprecatedSupport": false
                }
            },
            "hover": {
                "contentFormat": ["plaintext", "markdown"]
            },
            "signatureHelp": {
                "signatureInformation": {
                    "documentationFormat": ["plaintext", "markdown"],
                    "parameterInformation": {
                        "labelOffsetSupport": true
                    }
                }
            },
            "definition": { "dynamicRegistration": false },
            "documentSymbol": { "hierarchicalDocumentSymbolSupport": true },
            "references": { "dynamicRegistration": false },
            "codeAction": {
                "dynamicRegistration": false,
                "codeActionLiteralSupport": {
                    "codeActionKind": {
                        "valueSet": [
                            "quickfix",
                            "refactor",
                            "refactor.extract",
                            "refactor.inline",
                            "refactor.rewrite",
                            "source",
                            "source.organizeImports"
                        ]
                    }
                }
            },
            "rename": {
                "dynamicRegistration": false,
                "prepareSupport": true
            },
            "formatting": { "dynamicRegistration": false },
            "rangeFormatting": { "dynamicRegistration": false },
            "publishDiagnostics": {
                "relatedInformation": true,
                "versionSupport": true,
                "codeDescriptionSupport": true,
                "tagSupport": { "valueSet": [1, 2] }
            },
            "documentHighlight": { "dynamicRegistration": false },
            "typeDefinition": { "dynamicRegistration": false },
            "declaration": { "dynamicRegistration": false },
            "implementation": { "dynamicRegistration": false },
            "linkedEditingRange": { "dynamicRegistration": true },
            "onTypeFormatting": { "dynamicRegistration": false },
            "codeLens": { "dynamicRegistration": false },
            "colorProvider": { "dynamicRegistration": false },
            "foldingRange": {
                "dynamicRegistration": false,
                "lineFoldingOnly": true
            },
            "inlayHint": { "dynamicRegistration": false },
            "semanticTokens": {
                "dynamicRegistration": false,
                "requests": {
                    "full": { "delta": true },
                    "range": true
                },
                "tokenTypes": [
                    "namespace", "type", "class", "enum", "interface",
                    "struct", "typeParameter", "parameter", "variable",
                    "property", "enumMember", "event", "function",
                    "method", "macro", "keyword", "modifier",
                    "comment", "string", "number", "regexp", "operator",
                    "decorator"
                ],
                "tokenModifiers": [
                    "declaration", "definition", "readonly", "static",
                    "deprecated", "abstract", "async", "modification",
                    "documentation", "defaultLibrary"
                ],
                "formats": ["relative"],
                "multilineTokenSupport": false,
                "overlappingTokenSupport": false
            }
        },
        "workspace": {
            "workspaceFolders": true,
            "symbol": { "dynamicRegistration": false }
        }
    })
}

// =============================================================================
// Stderr reader task
// =============================================================================

/// Spawn a task to read and log stderr output from a language server process.
fn spawn_stderr_reader(
    stderr: tokio::process::ChildStderr,
    lang_id: String,
    binary: String,
    stderr_buf: Arc<Mutex<Vec<String>>>,
) {
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        let mut last_msg = String::new();
        let mut repeat_count: u32 = 0;

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    // Capture the raw line into the shared buffer (capped)
                    {
                        let mut buf = stderr_buf.lock().await;
                        if buf.len() >= MAX_STDERR_LINES {
                            buf.remove(0);
                        }
                        buf.push(trimmed.to_string());
                    }

                    // Strip leading timestamp for dedup comparison
                    let msg_body = if trimmed.len() > 30 && trimmed.as_bytes()[4] == b'-' {
                        trimmed.find("  ").map_or(trimmed, |i| &trimmed[i..]).trim()
                    } else {
                        trimmed
                    };

                    if msg_body == last_msg {
                        repeat_count += 1;
                        continue;
                    }

                    // Flush previous repeated message
                    if repeat_count > 0 {
                        debug!(
                            "[{}/{}] stderr: (repeated {} more times)",
                            lang_id, binary, repeat_count
                        );
                        repeat_count = 0;
                    }

                    // Downgrade known-noisy LSP messages to debug level
                    let is_noise = msg_body.contains("notify error: Input watch path")
                        || msg_body.contains("inference diagnostic in desugared")
                        || msg_body.contains("overly long loop turn");

                    if is_noise {
                        debug!("[{}/{}] stderr: {}", lang_id, binary, msg_body);
                    } else {
                        warn!("[{}/{}] stderr: {}", lang_id, binary, trimmed);
                    }

                    last_msg.clear();
                    last_msg.push_str(msg_body);
                }
                Err(_) => break,
            }
        }
        // Flush any remaining repeats
        if repeat_count > 0 {
            debug!(
                "[{}/{}] stderr: (repeated {} more times)",
                lang_id, binary, repeat_count
            );
        }
    });
}

// =============================================================================
// Health check task
// =============================================================================

/// Spawn a periodic health check task that detects stale (unresponsive) LSP requests.
fn spawn_health_check(
    app_handle: AppHandle,
    server_key: String,
    pending: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>>,
    lang_id: String,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        interval.tick().await; // Skip the first immediate tick

        loop {
            interval.tick().await;

            let lsp_state: tauri::State<'_, LspManagerState> = app_handle.state();
            {
                let manager = lsp_state.0.lock().await;
                if !manager.servers.contains_key(&server_key) {
                    debug!("[{}] Health check stopping — server no longer registered", lang_id);
                    break;
                }
            }

            let now = Instant::now();
            let stale_count = {
                let pending_guard = pending.lock().await;
                pending_guard
                    .values()
                    .filter(|(_sender, sent_at)| now.duration_since(*sent_at).as_secs() > 30)
                    .count()
            };

            if stale_count > 0 {
                warn!(
                    "[{}] Health check: {} stale request(s) older than 30s — server unresponsive",
                    lang_id, stale_count
                );

                {
                    let mut manager = lsp_state.0.lock().await;
                    if let Some(server) = manager.servers.get_mut(&server_key) {
                        server.state = types::ServerState::Unresponsive;
                    }
                    manager.emit_status();
                }

                let _ = app_handle.emit(
                    "lsp-server-unresponsive",
                    serde_json::json!({
                        "languageId": lang_id,
                        "serverKey": server_key,
                        "staleRequests": stale_count,
                    }),
                );
            }
        }

        debug!("[{}] Health check task ended", lang_id);
    });
}
