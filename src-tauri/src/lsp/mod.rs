//! LSP (Language Server Protocol) integration module.
//!
//! Manages LSP server processes for code intelligence features:
//! completions, hover information, go-to-definition, and diagnostics.
//!
//! The `LspManager` spawns language servers on demand when files are opened,
//! communicates via JSON-RPC over stdio, and emits Tauri events for
//! diagnostics and server status changes.

pub mod client;
pub mod detection;
pub mod installer;
pub mod manifest;
pub mod types;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Once-per-session flag: emit `lsp-node-not-found` only once.
static NODE_NOT_FOUND_EMITTED: AtomicBool = AtomicBool::new(false);

/// Maximum number of stderr lines retained per server for diagnostic display.
const MAX_STDERR_LINES: usize = 50;

/// Maximum number of files to scan for background diagnostics.
const MAX_SCAN_FILES: usize = 500;

/// Directories to skip during project file scanning.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".svelte-kit",
    "__pycache__",
];

/// Number of didOpen notifications to send per batch during background scanning.
const SCAN_BATCH_SIZE: usize = 10;

/// Delay in milliseconds between batches of background didOpen notifications.
const SCAN_BATCH_DELAY_MS: u64 = 100;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, watch, Mutex};
use tracing::{debug, info, warn};

use types::{LspServerStatus, LspServerStatusEvent};

/// Build a composite key for the server HashMap: "lang_id::project_root"
pub(crate) fn server_key(lang_id: &str, project_root: &str) -> String {
    format!("{}::{}", lang_id, project_root)
}

/// A running LSP server process.
pub struct LspServer {
    pub language_id: String,
    pub binary: String,
    pub process: Child,
    pub next_id: AtomicI64,
    pub open_docs: HashSet<String>,
    /// URIs of files opened via background project scan (not user-opened).
    /// When the user opens one of these files in the editor, it gets promoted
    /// to `open_docs` (didClose + didOpen with fresh editor content).
    pub background_docs: HashSet<String>,
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub capabilities: Option<lsp_types::ServerCapabilities>,
    pub pending_requests: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>>,
    pub crash_count: u32,
    pub last_crash: Option<Instant>,
    pub state: types::ServerState,
    pub project_root: String,
    pub last_error: Option<String>,
    pub stderr_lines: Arc<Mutex<Vec<String>>>,
    /// Cancel sender for idle shutdown timer. When all documents close, a 60s
    /// timer starts; sending on this channel cancels the pending shutdown.
    pub idle_cancel: Option<watch::Sender<bool>>,
    /// Server name from initialize response (serverInfo.name).
    pub server_name: Option<String>,
    /// Server version from initialize response (serverInfo.version).
    pub version: Option<String>,
}

/// Manages all LSP server processes.
pub struct LspManager {
    pub servers: HashMap<String, LspServer>,
    pub app_handle: AppHandle,
}

/// Thread-safe wrapper for the LSP manager (uses tokio Mutex for async access).
pub struct LspManagerState(pub Mutex<LspManager>);

impl LspManagerState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self(Mutex::new(LspManager {
            servers: HashMap::new(),
            app_handle,
        }))
    }
}

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

        // If server binary not found, attempt auto-install via npm
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

            // Check if Node.js is available
            let node_status = installer::detect_node();
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

            // Get install directory
            let lsp_dir = installer::get_lsp_servers_dir()
                .map_err(|e| format!("Failed to get LSP servers directory: {}", e))?;

            // Install the server
            info!(
                "Auto-installing LSP server '{}' for language '{}'",
                server_id, lang_id
            );
            installer::install_server(
                server_id,
                &entry.install.packages,
                &entry.install.version,
                &lsp_dir,
                Some(&self.app_handle),
            )
            .await?;

            // Retry detection after install
            detection::detect_for_extension(&self.extension_for_language(lang_id))
                .ok_or_else(|| format!("Server '{}' still not found after install", server_id))?
        } else {
            server_info
        };

        // Invariant: server_info.installed is always true here because:
        // - the else branch only executes when it was already true
        // - the if branch retries detect_for_extension which only returns Some when binary found
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
        // (e.g., rustup shim for an uninstalled component)
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if let Some(exit_status) = process.try_wait().ok().flatten() {
            // Process already exited — read stderr for the error message
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

        // Shared buffer for stderr lines — cloned into the task below, also
        // stored on LspServer so get_status() can read recent lines.
        let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        // Spawn a task to log stderr output (deduped + rate-limited)
        if let Some(stderr) = process.stderr.take() {
            let lang_id_clone = lang_id.to_string();
            let binary_clone = server_info.binary.clone();
            let stderr_buf_clone = stderr_buf.clone();
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
                                let mut buf = stderr_buf_clone.lock().await;
                                if buf.len() >= MAX_STDERR_LINES {
                                    buf.remove(0);
                                }
                                buf.push(trimmed.to_string());
                            }

                            // Strip leading timestamp for dedup comparison
                            // rust-analyzer format: "2026-02-28T16:49:56.717Z  WARN ..."
                            let msg_body = if trimmed.len() > 30 && trimmed.as_bytes()[4] == b'-' {
                                // Skip past "YYYY-MM-DDTHH:MM:SS.fffffffZ  "
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
                                    lang_id_clone, binary_clone, repeat_count
                                );
                                repeat_count = 0;
                            }

                            // Downgrade known-noisy LSP messages to debug level
                            let is_noise = msg_body.contains("notify error: Input watch path")
                                || msg_body.contains("inference diagnostic in desugared")
                                || msg_body.contains("overly long loop turn");

                            if is_noise {
                                debug!(
                                    "[{}/{}] stderr: {}",
                                    lang_id_clone, binary_clone, msg_body
                                );
                            } else {
                                warn!(
                                    "[{}/{}] stderr: {}",
                                    lang_id_clone, binary_clone, trimmed
                                );
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
                        lang_id_clone, binary_clone, repeat_count
                    );
                }
            });
        }

        let pending: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let next_id = AtomicI64::new(1);

        // Start the reader loop BEFORE sending initialize — it needs to be
        // reading stdout to receive the initialize response.
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

        // Load initializationOptions from the manifest entry (if available).
        // This is critical for servers like Svelte LS that need configuration
        // (e.g., diagnostics enable, TypeScript SDK path) at init time.
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
            "capabilities": {
                "textDocument": {
                    "synchronization": {
                        "dynamicRegistration": false,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "didSave": true
                    },
                    "completion": {
                        "completionItem": {
                            "snippetSupport": false,
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
                    "definition": {
                        "dynamicRegistration": false
                    },
                    "documentSymbol": {
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "references": {
                        "dynamicRegistration": false
                    },
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
                    "formatting": {
                        "dynamicRegistration": false
                    },
                    "rangeFormatting": {
                        "dynamicRegistration": false
                    },
                    "publishDiagnostics": {
                        "relatedInformation": false
                    }
                },
                "workspace": {
                    "workspaceFolders": {
                        "supported": true,
                        "changeNotifications": true
                    }
                }
            }
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

        // Send initialized notification
        client::send_notification(&mut *stdin.lock().await, "initialized", serde_json::json!({})).await?;

        info!(
            "LSP server '{}' initialized for language '{}'",
            server_info.binary, lang_id
        );

        // Clone pending_requests Arc for the health check task
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

        // Spawn health check task to detect stale/unresponsive requests
        spawn_health_check(
            self.app_handle.clone(),
            health_key,
            health_pending,
            lang_id.to_string(),
        );

        // Emit status update
        self.emit_status();

        Ok(())
    }

    /// Open a document in the LSP server.
    pub async fn open_document(
        &mut self,
        uri: &str,
        lang_id: &str,
        content: &str,
        project_root: &str,
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        // Cancel any pending idle shutdown timer
        if let Some(tx) = server.idle_cancel.take() {
            info!("Cancelling idle shutdown timer for '{}' — new document opened", lang_id);
            let _ = tx.send(true);
        }

        // Background → foreground promotion: if the file was opened via background
        // scan, close the stale background version first so we can re-open it with
        // the user's fresh editor content.
        if server.background_docs.contains(uri) {
            info!("Promoting background doc to foreground: {}", uri);
            client::send_notification(
                &mut *server.stdin.lock().await,
                "textDocument/didClose",
                serde_json::json!({
                    "textDocument": { "uri": uri }
                }),
            )
            .await?;
            server.background_docs.remove(uri);
        }

        // Don't re-open if already tracked as a user-opened doc
        if server.open_docs.contains(uri) {
            return Ok(());
        }

        client::send_notification(
            &mut *server.stdin.lock().await,
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": lang_id,
                    "version": 1,
                    "text": content
                }
            }),
        )
        .await?;

        server.open_docs.insert(uri.to_string());
        Ok(())
    }

    /// Close a document in the LSP server.
    ///
    /// If no more documents are open for this language, starts a 60-second idle
    /// shutdown timer. If a new document opens within that window the timer is
    /// cancelled. This avoids expensive server restarts when the user is just
    /// switching between files.
    pub async fn close_document(&mut self, uri: &str, lang_id: &str, project_root: &str) -> Result<(), String> {
        // Send didClose notification
        let key = server_key(lang_id, project_root);
        if let Some(server) = self.servers.get_mut(&key) {
            client::send_notification(
                &mut *server.stdin.lock().await,
                "textDocument/didClose",
                serde_json::json!({
                    "textDocument": { "uri": uri }
                }),
            )
            .await?;

            server.open_docs.remove(uri);
            server.background_docs.remove(uri);

            // If no more open docs (user or background), start the idle shutdown timer
            if server.open_docs.is_empty() && server.background_docs.is_empty() {
                info!(
                    "No more open documents for '{}', starting 60s idle shutdown timer",
                    lang_id
                );

                // Cancel any existing idle timer first
                if let Some(old_tx) = server.idle_cancel.take() {
                    let _ = old_tx.send(true);
                }

                // Create a watch channel for cancellation
                let (tx, mut rx) = watch::channel(false);
                server.idle_cancel = Some(tx);

                // Spawn idle shutdown task
                let app_handle = self.app_handle.clone();
                let idle_lang_id = lang_id.to_string();
                let idle_project_root = project_root.to_string();
                let idle_key = key.clone();

                tokio::spawn(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {
                            // Timer expired — shut down the idle server
                            info!(
                                "Idle shutdown timer expired for '{}' — shutting down server",
                                idle_lang_id
                            );
                            let lsp_state: tauri::State<'_, LspManagerState> = app_handle.state();
                            let mut manager = lsp_state.0.lock().await;

                            // Double-check the server still exists and is still idle
                            let still_idle = manager
                                .servers
                                .get(&idle_key)
                                .map_or(false, |s| s.open_docs.is_empty());

                            if still_idle {
                                if let Err(e) = manager
                                    .shutdown_server(&idle_lang_id, &idle_project_root)
                                    .await
                                {
                                    warn!(
                                        "Failed to idle-shutdown server for '{}': {}",
                                        idle_lang_id, e
                                    );
                                }
                            } else {
                                debug!(
                                    "Idle shutdown for '{}' skipped — server has open docs again",
                                    idle_lang_id
                                );
                            }
                        }
                        _ = rx.changed() => {
                            // Timer was cancelled — a new document was opened
                            debug!(
                                "Idle shutdown timer cancelled for '{}'",
                                idle_lang_id
                            );
                        }
                    }
                });
            }
        }

        Ok(())
    }

    /// Notify the server of document content changes (full sync).
    pub async fn change_document(
        &mut self,
        uri: &str,
        lang_id: &str,
        content: &str,
        version: i32,
        project_root: &str,
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        client::send_notification(
            &mut *server.stdin.lock().await,
            "textDocument/didChange",
            serde_json::json!({
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": [{ "text": content }]
            }),
        )
        .await
    }

    /// Notify the server that a document was saved.
    pub async fn save_document(
        &mut self,
        uri: &str,
        lang_id: &str,
        content: &str,
        project_root: &str,
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        // Include text in didSave if the server asked for it
        let include_text = server
            .capabilities
            .as_ref()
            .and_then(|c| c.text_document_sync.as_ref())
            .map(|sync| match sync {
                lsp_types::TextDocumentSyncCapability::Options(opts) => opts
                    .save
                    .as_ref()
                    .map(|s| match s {
                        lsp_types::TextDocumentSyncSaveOptions::SaveOptions(so) => {
                            so.include_text.unwrap_or(false)
                        }
                        lsp_types::TextDocumentSyncSaveOptions::Supported(_) => false,
                    })
                    .unwrap_or(false),
                _ => false,
            })
            .unwrap_or(false);

        let params = if include_text {
            serde_json::json!({
                "textDocument": { "uri": uri },
                "text": content
            })
        } else {
            serde_json::json!({
                "textDocument": { "uri": uri }
            })
        };

        client::send_notification(&mut *server.stdin.lock().await, "textDocument/didSave", params).await
    }

    /// Request completion items at a position.
    pub async fn request_completion(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/completion",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Completion request timed out".to_string())?
            .map_err(|_| "Completion response channel closed".to_string())?;

        // Extract items from response
        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Result can be CompletionList { items: [...] } or just an array
        let items = if let Some(items) = result.get("items") {
            items.clone()
        } else if result.is_array() {
            result
        } else {
            Value::Array(vec![])
        };

        Ok(serde_json::json!({ "items": items }))
    }

    /// Request hover information at a position.
    pub async fn request_hover(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/hover",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Hover request timed out".to_string())?
            .map_err(|_| "Hover response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Extract hover contents
        let contents = if let Some(contents) = result.get("contents") {
            match contents {
                Value::String(s) => s.clone(),
                Value::Object(obj) => {
                    // MarkupContent: { kind, value }
                    obj.get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string()
                }
                Value::Array(arr) => {
                    // MarkedString[]
                    arr.iter()
                        .filter_map(|item| {
                            if let Value::String(s) = item {
                                Some(s.as_str())
                            } else {
                                item.get("value").and_then(|v| v.as_str())
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n\n")
                }
                _ => String::new(),
            }
        } else {
            String::new()
        };

        Ok(serde_json::json!({ "contents": contents }))
    }

    /// Request signature help at a position.
    pub async fn request_signature_help(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/signatureHelp",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Signature help request timed out".to_string())?
            .map_err(|_| "Signature help response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        if result.is_null() {
            Ok(serde_json::json!({ "signatures": [] }))
        } else {
            Ok(result)
        }
    }

    /// Request go-to-definition at a position.
    pub async fn request_definition(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/definition",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Definition request timed out".to_string())?
            .map_err(|_| "Definition response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Result can be Location | Location[] | LocationLink[]
        let locations: Vec<Value> = if result.is_array() {
            result
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|loc| normalize_location(&loc))
                .collect()
        } else if result.is_object() {
            vec![normalize_location(&result)]
        } else {
            vec![]
        };

        Ok(serde_json::json!({ "locations": locations }))
    }

    /// Request document symbols for a file (outline view).
    pub async fn request_document_symbols(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/documentSymbol",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Document symbols request timed out".to_string())?
            .map_err(|_| "Document symbols response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Result can be DocumentSymbol[] or SymbolInformation[]
        let symbols = if result.is_array() {
            result
        } else {
            Value::Array(vec![])
        };

        Ok(serde_json::json!({ "symbols": symbols }))
    }

    /// Request all references to a symbol at a position.
    pub async fn request_references(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "context": { "includeDeclaration": true }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/references",
            params,
            &server.next_id,
        )
        .await?;

        // References can scan many files — use a longer timeout
        let response = tokio::time::timeout(std::time::Duration::from_secs(15), rx)
            .await
            .map_err(|_| "References request timed out".to_string())?
            .map_err(|_| "References response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        let locations: Vec<Value> = if let Some(arr) = result.as_array() {
            arr.iter().map(|loc| normalize_location(loc)).collect()
        } else {
            vec![]
        };

        Ok(serde_json::json!({ "locations": locations }))
    }

    /// Request code actions for a range in a file.
    pub async fn request_code_actions(
        &mut self,
        uri: &str,
        lang_id: &str,
        range_start_line: u32,
        range_start_char: u32,
        range_end_line: u32,
        range_end_char: u32,
        diagnostics: Value,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": range_start_line, "character": range_start_char },
                "end": { "line": range_end_line, "character": range_end_char }
            },
            "context": {
                "diagnostics": diagnostics
            }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/codeAction",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Code actions request timed out".to_string())?
            .map_err(|_| "Code actions response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Result is (Command | CodeAction)[] or null
        let actions = if result.is_array() {
            result
        } else {
            Value::Array(vec![])
        };

        Ok(serde_json::json!({ "actions": actions }))
    }

    /// Prepare a rename operation (check if symbol is renameable, get range + placeholder).
    pub async fn request_prepare_rename(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/prepareRename",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Prepare rename request timed out".to_string())?
            .map_err(|_| "Prepare rename response channel closed".to_string())?;

        // Check for error response
        if let Some(error) = response.get("error") {
            let msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Cannot rename this symbol");
            return Err(msg.to_string());
        }

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        if result.is_null() {
            return Err("Symbol cannot be renamed".to_string());
        }

        Ok(result)
    }

    /// Perform a rename operation across the workspace.
    pub async fn request_rename(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        new_name: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "newName": new_name
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/rename",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(15), rx)
            .await
            .map_err(|_| "Rename request timed out".to_string())?
            .map_err(|_| "Rename response channel closed".to_string())?;

        // Check for error response
        if let Some(error) = response.get("error") {
            let msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Rename failed");
            return Err(msg.to_string());
        }

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        Ok(serde_json::json!({ "workspaceEdit": result }))
    }

    /// Request document formatting for an entire file.
    pub async fn request_formatting(
        &mut self,
        uri: &str,
        lang_id: &str,
        tab_size: u32,
        insert_spaces: bool,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "options": {
                "tabSize": tab_size,
                "insertSpaces": insert_spaces
            }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/formatting",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Formatting request timed out".to_string())?
            .map_err(|_| "Formatting response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Result is TextEdit[] or null
        let edits = if result.is_array() {
            result
        } else {
            Value::Array(vec![])
        };

        Ok(serde_json::json!({ "edits": edits }))
    }

    /// Request formatting for a range within a file.
    pub async fn request_range_formatting(
        &mut self,
        uri: &str,
        lang_id: &str,
        range_start_line: u32,
        range_start_char: u32,
        range_end_line: u32,
        range_end_char: u32,
        tab_size: u32,
        insert_spaces: bool,
        project_root: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": range_start_line, "character": range_start_char },
                "end": { "line": range_end_line, "character": range_end_char }
            },
            "options": {
                "tabSize": tab_size,
                "insertSpaces": insert_spaces
            }
        });

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            "textDocument/rangeFormatting",
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Range formatting request timed out".to_string())?
            .map_err(|_| "Range formatting response channel closed".to_string())?;

        let result = response.get("result").cloned().unwrap_or(Value::Null);

        // Result is TextEdit[] or null
        let edits = if result.is_array() {
            result
        } else {
            Value::Array(vec![])
        };

        Ok(serde_json::json!({ "edits": edits }))
    }

    /// Scan the project directory for files matching the server's extensions
    /// and send `textDocument/didOpen` for each, enabling project-wide diagnostics.
    ///
    /// Files are tracked in `background_docs` separately from user-opened `open_docs`.
    /// Returns the number of files scanned.
    pub async fn scan_project_files(
        &mut self,
        lang_id: &str,
        project_root: &str,
    ) -> Result<usize, String> {
        // Load the manifest to get extensions for this server
        let manifest = manifest::load_manifest()
            .map_err(|e| format!("Failed to load manifest: {}", e))?;

        let ext = self.extension_for_language(lang_id);
        let (_server_id, entry) = manifest::find_server_for_extension(&manifest, &ext)
            .ok_or_else(|| format!("No manifest entry for language '{}'", lang_id))?;

        // Collect matching files from the project
        let extensions: Vec<String> = entry.extensions.iter()
            .map(|e| e.trim_start_matches('.').to_lowercase())
            .collect();
        let files = collect_matching_files(project_root, &extensions, MAX_SCAN_FILES);

        if files.is_empty() {
            info!("Background scan for '{}': no matching files found", lang_id);
            return Ok(0);
        }

        info!(
            "Background scan for '{}': found {} matching files in '{}'",
            lang_id,
            files.len(),
            project_root
        );

        let key = server_key(lang_id, project_root);
        let mut scanned = 0;

        for (i, file_path) in files.iter().enumerate() {
            let uri = types::file_uri(file_path, project_root);

            // Skip if already open (user-opened or previously background-scanned)
            {
                let server = match self.servers.get(&key) {
                    Some(s) => s,
                    None => return Err("Server no longer running".to_string()),
                };
                if server.open_docs.contains(&uri) || server.background_docs.contains(&uri) {
                    continue;
                }
            }

            // Read the file content
            let content = match tokio::fs::read_to_string(file_path).await {
                Ok(c) => c,
                Err(_) => continue, // Skip unreadable files
            };

            // Determine the LSP languageId for this specific file
            let file_ext = std::path::Path::new(file_path)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let file_lang_id = detection::language_id_for_extension(&file_ext)
                .and_then(|id| {
                    // Look up the actual languageId from the manifest (e.g. "javascript" vs "typescript")
                    let m = manifest::load_manifest().ok()?;
                    let e = m.servers.get(&id)?;
                    // Find which language corresponds to this extension
                    for lang in &e.languages {
                        // Use the first language if the extension matches
                        return Some(lang.clone());
                    }
                    None
                })
                .unwrap_or_else(|| lang_id.to_string());

            // Send didOpen for this background file
            let server = match self.servers.get_mut(&key) {
                Some(s) => s,
                None => return Err("Server no longer running".to_string()),
            };

            if let Err(e) = client::send_notification(
                &mut *server.stdin.lock().await,
                "textDocument/didOpen",
                serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": file_lang_id,
                        "version": 1,
                        "text": content
                    }
                }),
            )
            .await
            {
                warn!("Background scan: failed to open '{}': {}", file_path, e);
                continue;
            }

            server.background_docs.insert(uri);
            scanned += 1;

            // Stagger batches to avoid flooding the LSP server
            if (i + 1) % SCAN_BATCH_SIZE == 0 && (i + 1) < files.len() {
                tokio::time::sleep(std::time::Duration::from_millis(SCAN_BATCH_DELAY_MS)).await;
            }
        }

        info!(
            "Background scan for '{}': opened {} files for diagnostics",
            lang_id, scanned
        );

        Ok(scanned)
    }

    /// Get status information for all servers.
    pub fn get_status(&self) -> Vec<LspServerStatus> {
        self.servers
            .values()
            .map(|s| {
                // Read last 5 stderr lines without blocking (try_lock on tokio Mutex)
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

            // Send shutdown request
            let rx = client::send_request(
                &mut *server.stdin.lock().await,
                &server.pending_requests,
                "shutdown",
                Value::Null,
                &server.next_id,
            )
            .await;

            // Wait up to 2 seconds for shutdown response
            if let Ok(rx) = rx {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await;
            }

            // Send exit notification
            let _ =
                client::send_notification(&mut *server.stdin.lock().await, "exit", Value::Null).await;

            // Give it a moment, then kill if still running
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

                // Send shutdown request
                let rx = client::send_request(
                    &mut *server.stdin.lock().await,
                    &server.pending_requests,
                    "shutdown",
                    Value::Null,
                    &server.next_id,
                )
                .await;

                // Wait up to 2 seconds for shutdown response
                if let Ok(rx) = rx {
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await;
                }

                // Send exit notification
                let _ =
                    client::send_notification(&mut *server.stdin.lock().await, "exit", Value::Null).await;

                // Give it a moment, then kill if still running
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = server.process.kill().await;
            }
        }
        self.emit_status();
    }

    /// Emit a status update event for all servers.
    fn emit_status(&self) {
        let event = LspServerStatusEvent {
            servers: self.get_status(),
        };
        if let Err(e) = self.app_handle.emit("lsp-server-status", &event) {
            warn!("Failed to emit lsp-server-status event: {}", e);
        }
    }

    /// Map a language ID back to a representative file extension for detection.
    fn extension_for_language(&self, lang_id: &str) -> String {
        match lang_id {
            "typescript" => "ts".to_string(),
            "rust" => "rs".to_string(),
            "python" => "py".to_string(),
            "css" => "css".to_string(),
            "html" => "html".to_string(),
            "json" => "json".to_string(),
            "markdown" => "md".to_string(),
            other => other.to_string(),
        }
    }
}

/// Recursively collect files matching the given extensions from a project directory.
///
/// Skips directories in `SKIP_DIRS` and stops once `max_files` are collected.
/// Returns absolute file paths.
fn collect_matching_files(
    project_root: &str,
    extensions: &[String],
    max_files: usize,
) -> Vec<String> {
    let mut result = Vec::new();
    let root = std::path::Path::new(project_root);
    collect_matching_files_recursive(root, extensions, max_files, &mut result);
    result
}

/// Recursive helper for `collect_matching_files`.
fn collect_matching_files_recursive(
    dir: &std::path::Path,
    extensions: &[String],
    max_files: usize,
    result: &mut Vec<String>,
) {
    if result.len() >= max_files {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries {
        if result.len() >= max_files {
            return;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        if path.is_dir() {
            // Skip ignored directories
            let dir_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if SKIP_DIRS.contains(&dir_name.as_str()) || dir_name.starts_with('.') {
                continue;
            }
            collect_matching_files_recursive(&path, extensions, max_files, result);
        } else if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if extensions.contains(&ext_str) {
                    result.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
}

/// Spawn a periodic health check task that detects stale (unresponsive) LSP requests.
///
/// Checks every 10 seconds for pending requests older than 30 seconds.
/// If stale requests are found, marks the server as `Unresponsive` and emits
/// an `lsp-server-unresponsive` event. The task stops when the server is removed
/// from the manager (e.g., after shutdown or crash).
fn spawn_health_check(
    app_handle: AppHandle,
    server_key: String,
    pending: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>>,
    lang_id: String,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        // Skip the first immediate tick
        interval.tick().await;

        loop {
            interval.tick().await;

            // Check if the server is still alive in the manager
            let lsp_state: tauri::State<'_, LspManagerState> = app_handle.state();
            {
                let manager = lsp_state.0.lock().await;
                if !manager.servers.contains_key(&server_key) {
                    debug!("[{}] Health check stopping — server no longer registered", lang_id);
                    break;
                }
            }

            // Scan pending requests for stale entries (>30s old)
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

                // Mark server as Unresponsive
                {
                    let mut manager = lsp_state.0.lock().await;
                    if let Some(server) = manager.servers.get_mut(&server_key) {
                        server.state = types::ServerState::Unresponsive;
                    }
                    manager.emit_status();
                }

                // Emit dedicated event for frontend notification
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

/// Normalize a Location or LocationLink into a simple { uri, range } object.
fn normalize_location(loc: &Value) -> Value {
    // LocationLink has targetUri/targetRange
    if let Some(target_uri) = loc.get("targetUri") {
        let range = loc
            .get("targetSelectionRange")
            .or_else(|| loc.get("targetRange"))
            .cloned()
            .unwrap_or(Value::Null);
        return serde_json::json!({ "uri": target_uri, "range": range });
    }

    // Location has uri/range
    serde_json::json!({
        "uri": loc.get("uri").cloned().unwrap_or(Value::Null),
        "range": loc.get("range").cloned().unwrap_or(Value::Null),
    })
}
