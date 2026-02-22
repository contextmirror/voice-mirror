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
pub mod types;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicI64;
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};
use tracing::{info, warn};

use types::{LspServerStatus, LspServerStatusEvent};

/// A running LSP server process.
pub struct LspServer {
    pub language_id: String,
    pub binary: String,
    pub process: Child,
    pub next_id: AtomicI64,
    pub open_docs: HashSet<String>,
    pub stdin: ChildStdin,
    pub capabilities: Option<lsp_types::ServerCapabilities>,
    pub pending_requests: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    pub crash_count: u32,
    pub last_crash: Option<Instant>,
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
        if self.servers.contains_key(lang_id) {
            return Ok(());
        }

        // Detect the server binary for this language
        let server_info = detection::detect_for_extension(
            &self.extension_for_language(lang_id),
        )
        .ok_or_else(|| format!("No LSP server configured for language '{}'", lang_id))?;

        if !server_info.installed {
            return Err(format!(
                "LSP server '{}' for '{}' is not installed (not found on PATH)",
                server_info.binary, lang_id
            ));
        }

        info!(
            "Starting LSP server '{}' for language '{}'",
            server_info.binary, lang_id
        );

        // Spawn the server process
        let mut cmd = tokio::process::Command::new(&server_info.binary);
        cmd.args(&server_info.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(project_root);

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

        let mut stdin = process
            .stdin
            .take()
            .ok_or("Failed to get LSP server stdin")?;
        let stdout = process
            .stdout
            .take()
            .ok_or("Failed to get LSP server stdout")?;

        // Spawn a task to log stderr output for debugging
        if let Some(stderr) = process.stderr.take() {
            let lang_id_clone = lang_id.to_string();
            let binary_clone = server_info.binary.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                warn!(
                                    "[{}/{}] stderr: {}",
                                    lang_id_clone, binary_clone, trimmed
                                );
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let next_id = AtomicI64::new(1);

        // Start the reader loop BEFORE sending initialize — it needs to be
        // reading stdout to receive the initialize response.
        client::spawn_reader_loop(
            stdout,
            self.app_handle.clone(),
            lang_id.to_string(),
            Arc::clone(&pending),
        );

        // Build the root URI for the project
        let root_uri = types::file_uri("", project_root);

        // Send initialize request
        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
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
                    "definition": {
                        "dynamicRegistration": false
                    },
                    "publishDiagnostics": {
                        "relatedInformation": false
                    }
                }
            }
        });

        let rx = client::send_request(&mut stdin, &pending, "initialize", init_params, &next_id)
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

        // Send initialized notification
        client::send_notification(&mut stdin, "initialized", serde_json::json!({})).await?;

        info!(
            "LSP server '{}' initialized for language '{}'",
            server_info.binary, lang_id
        );

        // Store the server
        self.servers.insert(
            lang_id.to_string(),
            LspServer {
                language_id: lang_id.to_string(),
                binary: server_info.binary.clone(),
                process,
                next_id,
                open_docs: HashSet::new(),
                stdin,
                capabilities,
                pending_requests: pending,
                crash_count: 0,
                last_crash: None,
            },
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
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(lang_id)
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        // Don't re-open if already tracked
        if server.open_docs.contains(uri) {
            return Ok(());
        }

        client::send_notification(
            &mut server.stdin,
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
    /// If no more documents are open for this language, shuts down the server.
    pub async fn close_document(&mut self, uri: &str, lang_id: &str) -> Result<(), String> {
        // Send didClose notification
        if let Some(server) = self.servers.get_mut(lang_id) {
            client::send_notification(
                &mut server.stdin,
                "textDocument/didClose",
                serde_json::json!({
                    "textDocument": { "uri": uri }
                }),
            )
            .await?;

            server.open_docs.remove(uri);

            // If no more open docs, shut down the server
            if server.open_docs.is_empty() {
                info!(
                    "No more open documents for '{}', shutting down server",
                    lang_id
                );
                // We need to remove the server to shut it down
                // (can't call shutdown_server while borrowing servers)
            } else {
                return Ok(());
            }
        }

        // Shutdown server if no docs remain (done outside the borrow above)
        if self
            .servers
            .get(lang_id)
            .map_or(false, |s| s.open_docs.is_empty())
        {
            self.shutdown_server(lang_id).await?;
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
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(lang_id)
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        client::send_notification(
            &mut server.stdin,
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
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(lang_id)
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

        client::send_notification(&mut server.stdin, "textDocument/didSave", params).await
    }

    /// Request completion items at a position.
    pub async fn request_completion(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(lang_id)
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut server.stdin,
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
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(lang_id)
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut server.stdin,
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

    /// Request go-to-definition at a position.
    pub async fn request_definition(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(lang_id)
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let rx = client::send_request(
            &mut server.stdin,
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

    /// Get status information for all servers.
    pub fn get_status(&self) -> Vec<LspServerStatus> {
        self.servers
            .values()
            .map(|s| LspServerStatus {
                language_id: s.language_id.clone(),
                binary: s.binary.clone(),
                running: true,
                open_docs_count: s.open_docs.len(),
            })
            .collect()
    }

    /// Shut down a specific language server.
    pub async fn shutdown_server(&mut self, lang_id: &str) -> Result<(), String> {
        if let Some(mut server) = self.servers.remove(lang_id) {
            info!("Shutting down LSP server for '{}'", lang_id);

            // Send shutdown request
            let rx = client::send_request(
                &mut server.stdin,
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
                client::send_notification(&mut server.stdin, "exit", Value::Null).await;

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
        let lang_ids: Vec<String> = self.servers.keys().cloned().collect();
        for lang_id in lang_ids {
            if let Err(e) = self.shutdown_server(&lang_id).await {
                warn!("Error shutting down LSP server '{}': {}", lang_id, e);
            }
        }
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
