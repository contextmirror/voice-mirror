//! Document synchronization methods for LSP.
//!
//! Handles `textDocument/didOpen`, `didClose`, `didChange`, and `didSave`
//! notifications, plus idle-shutdown timers when all documents close.

use tracing::{debug, info};

use tauri::Manager;

use super::{client, lsp_language_id, server_key, LspManager, LspManagerState};

impl LspManager {
    /// Open a document in the LSP server.
    ///
    /// `server_id` is the manifest key (e.g. `"typescript"`) used for the
    /// HashMap lookup.  The actual LSP `languageId` sent in `textDocument/didOpen`
    /// is derived from the file extension so that tsserver sees `.js` as
    /// `"javascript"`, not `"typescript"`.
    pub async fn open_document(
        &mut self,
        uri: &str,
        server_id: &str,
        content: &str,
        project_root: &str,
    ) -> Result<(), String> {
        let server = self
            .servers
            .get_mut(&server_key(server_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", server_id))?;

        // Cancel any pending idle shutdown timer
        if let Some(tx) = server.idle_cancel.take() {
            info!("Cancelling idle shutdown timer for '{}' — new document opened", server_id);
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

        // Resolve the correct LSP languageId from the file extension.
        // The server_id ("typescript") differs from the LSP languageId
        // ("javascript" for .js files). Using the wrong ID prevents tsserver
        // from applying JS-specific inference like JSDoc type expansion.
        let file_language_id = uri
            .rsplit('.')
            .next()
            .map(|ext| lsp_language_id(ext).to_string())
            .unwrap_or_else(|| server_id.to_string());

        client::send_notification(
            &mut *server.stdin.lock().await,
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": file_language_id,
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
                let (tx, mut rx) = tokio::sync::watch::channel(false);
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
                                    tracing::warn!(
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

    /// Notify the server of incremental document changes.
    ///
    /// Unlike `change_document` which sends the full file content,
    /// this method sends an array of incremental text edits (each with
    /// a range and replacement text). This is more efficient for small
    /// edits in large files when the server supports incremental sync.
    ///
    /// Each entry in `changes` should be a JSON object with:
    /// - `range`: `{ start: { line, character }, end: { line, character } }`
    /// - `text`: the replacement string
    pub async fn change_document_incremental(
        &mut self,
        uri: &str,
        lang_id: &str,
        version: i32,
        changes: Vec<serde_json::Value>,
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
                "contentChanges": changes
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
}
