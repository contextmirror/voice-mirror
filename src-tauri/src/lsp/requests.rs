//! LSP request methods (textDocument/* and workspace/*).
//!
//! All methods follow the same pattern: look up the server, build params,
//! send a JSON-RPC request, wait with a timeout, parse the response.
//! The private `send_and_wait` helper deduplicates this boilerplate.

use serde_json::Value;
use tracing::debug;

use super::formatting::normalize_location;
use super::{client, server_key, LspManager};

/// Default timeout for most LSP requests (seconds).
const DEFAULT_TIMEOUT_SECS: u64 = 10;

/// Longer timeout for cross-file operations (references, workspace symbols, rename).
const LONG_TIMEOUT_SECS: u64 = 15;

/// Short timeout for lightweight requests (highlights, inlay hints, linked editing).
const SHORT_TIMEOUT_SECS: u64 = 5;

impl LspManager {
    /// Send a request to a server and wait for the response with a timeout.
    ///
    /// Returns the full JSON-RPC response (caller extracts `result` or `error`).
    async fn send_and_wait(
        &mut self,
        lang_id: &str,
        project_root: &str,
        method: &str,
        params: Value,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        let rx = client::send_request(
            &mut *server.stdin.lock().await,
            &server.pending_requests,
            method,
            params,
            &server.next_id,
        )
        .await?;

        let response = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            rx,
        )
        .await
        .map_err(|_| format!("{} request timed out", method))?
        .map_err(|_| format!("{} response channel closed", method))?;

        Ok(response)
    }

    /// Extract `result` from a response, defaulting to `Value::Null`.
    fn result_or_null(response: &Value) -> Value {
        response.get("result").cloned().unwrap_or(Value::Null)
    }

    // =========================================================================
    // Completion
    // =========================================================================

    /// Request completion items at a position.
    pub async fn request_completion(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/completion", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

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

    /// Resolve a completion item to fill in additional details (documentation, additionalTextEdits).
    pub async fn resolve_completion_item(
        &mut self,
        item: Value,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let response = self.send_and_wait(lang_id, project_root, "completionItem/resolve", item, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    // =========================================================================
    // Hover
    // =========================================================================

    /// Request hover information at a position.
    pub async fn request_hover(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let key = server_key(lang_id, project_root);
        self.standard_hover(uri, line, character, &key).await
    }

    /// Standard LSP textDocument/hover request.
    async fn standard_hover(
        &mut self,
        uri: &str,
        line: u32,
        character: u32,
        skey: &str,
    ) -> Result<Value, String> {
        let server = self
            .servers
            .get_mut(skey)
            .ok_or_else(|| format!("No LSP server running for key '{}'", skey))?;

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

        let response = tokio::time::timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS), rx)
            .await
            .map_err(|_| "Hover request timed out".to_string())?
            .map_err(|_| "Hover response channel closed".to_string())?;

        let result = Self::result_or_null(&response);

        // Extract hover contents, preserving the kind field
        let (contents, kind) = if let Some(contents) = result.get("contents") {
            match contents {
                Value::String(s) => (s.clone(), "plaintext".to_string()),
                Value::Object(obj) => {
                    let kind = obj
                        .get("kind")
                        .and_then(|v| v.as_str())
                        .unwrap_or("markdown")
                        .to_string();
                    let value = obj
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (value, kind)
                }
                Value::Array(arr) => {
                    let text = arr
                        .iter()
                        .filter_map(|item| {
                            if let Value::String(s) = item {
                                Some(s.as_str())
                            } else {
                                item.get("value").and_then(|v| v.as_str())
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n\n");
                    (text, "markdown".to_string())
                }
                _ => (String::new(), "plaintext".to_string()),
            }
        } else {
            (String::new(), "plaintext".to_string())
        };

        Ok(serde_json::json!({ "contents": { "kind": kind, "value": contents } }))
    }

    // =========================================================================
    // Signature Help
    // =========================================================================

    /// Request signature help at a position.
    pub async fn request_signature_help(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/signatureHelp", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        if result.is_null() {
            Ok(serde_json::json!({ "signatures": [] }))
        } else {
            Ok(result)
        }
    }

    // =========================================================================
    // Navigation (definition, type definition, declaration, implementation)
    // =========================================================================

    /// Send a navigation request and normalize the Location/LocationLink response.
    async fn request_location(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
        method: &str,
        timeout: u64,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let response = self.send_and_wait(lang_id, project_root, method, params, timeout).await?;
        let result = Self::result_or_null(&response);

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

    /// Request go-to-definition at a position.
    pub async fn request_definition(
        &mut self, uri: &str, lang_id: &str, line: u32, character: u32, project_root: &str,
    ) -> Result<Value, String> {
        self.request_location(uri, lang_id, line, character, project_root, "textDocument/definition", DEFAULT_TIMEOUT_SECS).await
    }

    /// Request go-to-type-definition at a position.
    pub async fn request_type_definition(
        &mut self, uri: &str, lang_id: &str, line: u32, character: u32, project_root: &str,
    ) -> Result<Value, String> {
        self.request_location(uri, lang_id, line, character, project_root, "textDocument/typeDefinition", DEFAULT_TIMEOUT_SECS).await
    }

    /// Request go-to-declaration at a position.
    pub async fn request_declaration(
        &mut self, uri: &str, lang_id: &str, line: u32, character: u32, project_root: &str,
    ) -> Result<Value, String> {
        self.request_location(uri, lang_id, line, character, project_root, "textDocument/declaration", DEFAULT_TIMEOUT_SECS).await
    }

    /// Request go-to-implementation at a position.
    pub async fn request_implementation(
        &mut self, uri: &str, lang_id: &str, line: u32, character: u32, project_root: &str,
    ) -> Result<Value, String> {
        self.request_location(uri, lang_id, line, character, project_root, "textDocument/implementation", DEFAULT_TIMEOUT_SECS).await
    }

    // =========================================================================
    // Symbols
    // =========================================================================

    /// Request document symbols for a file (outline view).
    pub async fn request_document_symbols(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "textDocument": { "uri": uri } });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/documentSymbol", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let symbols = if result.is_array() { result } else { Value::Array(vec![]) };
        Ok(serde_json::json!({ "symbols": symbols }))
    }

    /// Request workspace symbols matching a query string.
    pub async fn request_workspace_symbols(
        &mut self,
        query: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "query": query });
        let response = self.send_and_wait(lang_id, project_root, "workspace/symbol", params, LONG_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let symbols = if result.is_array() { result } else { Value::Array(vec![]) };
        Ok(serde_json::json!({ "symbols": symbols }))
    }

    // =========================================================================
    // References & Highlights
    // =========================================================================

    /// Request all references to a symbol at a position.
    pub async fn request_references(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "context": { "includeDeclaration": true }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/references", params, LONG_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let locations: Vec<Value> = if let Some(arr) = result.as_array() {
            arr.iter().map(|loc| normalize_location(loc)).collect()
        } else {
            vec![]
        };

        Ok(serde_json::json!({ "locations": locations }))
    }

    /// Request document highlights for a symbol at a position.
    pub async fn request_document_highlight(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/documentHighlight", params, SHORT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let highlights: Vec<Value> = if let Some(arr) = result.as_array() {
            arr.iter()
                .filter_map(|h| {
                    let range = h.get("range")?;
                    Some(serde_json::json!({
                        "range": range,
                        "kind": h.get("kind").and_then(|k| k.as_u64()).unwrap_or(1)
                    }))
                })
                .collect()
        } else {
            vec![]
        };

        Ok(serde_json::json!({ "highlights": highlights }))
    }

    // =========================================================================
    // Inlay Hints
    // =========================================================================

    /// Request inlay hints for a range of lines in a file.
    pub async fn request_inlay_hints(
        &mut self,
        uri: &str,
        lang_id: &str,
        start_line: u32,
        end_line: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": start_line, "character": 0 },
                "end": { "line": end_line, "character": 0 }
            }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/inlayHint", params, SHORT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let hints: Vec<Value> = if let Some(arr) = result.as_array() {
            arr.iter()
                .filter_map(|h| {
                    let position = h.get("position")?;
                    let label = h.get("label")?;
                    let label_text = if let Some(s) = label.as_str() {
                        s.to_string()
                    } else if let Some(parts) = label.as_array() {
                        parts.iter()
                            .filter_map(|p| p.get("value").and_then(|v| v.as_str()))
                            .collect::<Vec<_>>()
                            .join("")
                    } else {
                        return None;
                    };
                    Some(serde_json::json!({
                        "position": position,
                        "label": label_text,
                        "kind": h.get("kind").and_then(|k| k.as_u64()).unwrap_or(0),
                        "paddingLeft": h.get("paddingLeft").and_then(|v| v.as_bool()).unwrap_or(false),
                        "paddingRight": h.get("paddingRight").and_then(|v| v.as_bool()).unwrap_or(false),
                    }))
                })
                .collect()
        } else {
            vec![]
        };

        Ok(serde_json::json!({ "hints": hints }))
    }

    // =========================================================================
    // Code Actions & Rename
    // =========================================================================

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
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": range_start_line, "character": range_start_char },
                "end": { "line": range_end_line, "character": range_end_char }
            },
            "context": { "diagnostics": diagnostics }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/codeAction", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let actions = if result.is_array() { result } else { Value::Array(vec![]) };
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
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/prepareRename", params, DEFAULT_TIMEOUT_SECS).await?;

        // Check for error response
        if let Some(error) = response.get("error") {
            let msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Cannot rename this symbol");
            return Err(msg.to_string());
        }

        let result = Self::result_or_null(&response);
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
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "newName": new_name
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/rename", params, LONG_TIMEOUT_SECS).await?;

        // Check for error response
        if let Some(error) = response.get("error") {
            let msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Rename failed");
            return Err(msg.to_string());
        }

        let result = Self::result_or_null(&response);
        Ok(serde_json::json!({ "workspaceEdit": result }))
    }

    // =========================================================================
    // Formatting
    // =========================================================================

    /// Request document formatting for an entire file.
    pub async fn request_formatting(
        &mut self,
        uri: &str,
        lang_id: &str,
        tab_size: u32,
        insert_spaces: bool,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "options": { "tabSize": tab_size, "insertSpaces": insert_spaces }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/formatting", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let edits = if result.is_array() { result } else { Value::Array(vec![]) };
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
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": range_start_line, "character": range_start_char },
                "end": { "line": range_end_line, "character": range_end_char }
            },
            "options": { "tabSize": tab_size, "insertSpaces": insert_spaces }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/rangeFormatting", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let edits = if result.is_array() { result } else { Value::Array(vec![]) };
        Ok(serde_json::json!({ "edits": edits }))
    }

    /// Request on-type formatting after a trigger character is typed.
    pub async fn request_on_type_formatting(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        trigger_char: &str,
        tab_size: u32,
        insert_spaces: bool,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "ch": trigger_char,
            "options": { "tabSize": tab_size, "insertSpaces": insert_spaces }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/onTypeFormatting", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let edits = if result.is_array() { result } else { Value::Array(vec![]) };
        Ok(serde_json::json!({ "edits": edits }))
    }

    // =========================================================================
    // Linked Editing
    // =========================================================================

    /// Request linked editing ranges at a position in a file.
    pub async fn request_linked_editing_range(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        debug!("[{}] linkedEditingRange uri={} line={} char={}", lang_id, uri, line, character);

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });

        let response = self.send_and_wait(lang_id, project_root, "textDocument/linkedEditingRange", params, SHORT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        if result.is_null() {
            return Ok(serde_json::json!({ "ranges": [] }));
        }

        let ranges = result.get("ranges").cloned().unwrap_or(Value::Array(vec![]));
        let word_pattern = result.get("wordPattern").and_then(|v| v.as_str()).map(|s| s.to_string());

        let mut out = serde_json::json!({ "ranges": ranges });
        if let Some(wp) = word_pattern {
            out["wordPattern"] = Value::String(wp);
        }

        Ok(out)
    }

    // =========================================================================
    // Code Lens
    // =========================================================================

    /// Request code lenses for a document.
    pub async fn request_code_lens(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "textDocument": { "uri": uri } });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/codeLens", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let mut lenses: Vec<Value> = if let Value::Array(arr) = result {
            arr
        } else {
            vec![]
        };

        // Resolve lenses that don't have a command yet
        let server = self
            .servers
            .get_mut(&server_key(lang_id, project_root))
            .ok_or_else(|| format!("No LSP server running for '{}'", lang_id))?;

        for lens in &mut lenses {
            if lens.get("command").is_some() && !lens["command"].is_null() {
                continue;
            }
            let rx = client::send_request(
                &mut *server.stdin.lock().await,
                &server.pending_requests,
                "codeLens/resolve",
                lens.clone(),
                &server.next_id,
            )
            .await;
            if let Ok(rx) = rx {
                if let Ok(Ok(resp)) =
                    tokio::time::timeout(std::time::Duration::from_secs(SHORT_TIMEOUT_SECS), rx).await
                {
                    if let Some(resolved) = resp.get("result") {
                        *lens = resolved.clone();
                    }
                }
            }
        }

        Ok(serde_json::json!({ "lenses": Value::Array(lenses) }))
    }

    // =========================================================================
    // Document Colors & Folding
    // =========================================================================

    /// Request document colors for a file (CSS color values, etc.).
    pub async fn request_document_colors(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "textDocument": { "uri": uri } });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/documentColor", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let colors = if result.is_array() { result } else { Value::Array(vec![]) };
        Ok(serde_json::json!({ "colors": colors }))
    }

    /// Request folding ranges for a document.
    pub async fn request_folding_ranges(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "textDocument": { "uri": uri } });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/foldingRange", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let ranges = if result.is_array() { result } else { Value::Array(vec![]) };
        Ok(serde_json::json!({ "ranges": ranges }))
    }

    // =========================================================================
    // Semantic Tokens
    // =========================================================================

    /// Request semantic tokens for an entire document.
    pub async fn request_semantic_tokens_full(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "textDocument": { "uri": uri } });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/semanticTokens/full", params, DEFAULT_TIMEOUT_SECS).await?;
        let result = Self::result_or_null(&response);

        let data = if let Some(d) = result.get("data") { d.clone() } else { Value::Array(vec![]) };
        let result_id = result.get("resultId").cloned().unwrap_or(Value::Null);

        Ok(serde_json::json!({ "data": data, "resultId": result_id }))
    }

    // =========================================================================
    // Diagnostics (pull)
    // =========================================================================

    /// Request diagnostics for a document on demand (pull diagnostics).
    pub async fn request_diagnostics(
        &mut self,
        uri: &str,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "textDocument": { "uri": uri } });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/diagnostic", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    // =========================================================================
    // Call Hierarchy
    // =========================================================================

    /// Prepare call hierarchy at a position.
    pub async fn prepare_call_hierarchy(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/prepareCallHierarchy", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    /// Request incoming calls for a call hierarchy item.
    pub async fn request_incoming_calls(
        &mut self,
        item: Value,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "item": item });
        let response = self.send_and_wait(lang_id, project_root, "callHierarchy/incomingCalls", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    /// Request outgoing calls for a call hierarchy item.
    pub async fn request_outgoing_calls(
        &mut self,
        item: Value,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "item": item });
        let response = self.send_and_wait(lang_id, project_root, "callHierarchy/outgoingCalls", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    // =========================================================================
    // Type Hierarchy
    // =========================================================================

    /// Prepare type hierarchy at a position.
    pub async fn prepare_type_hierarchy(
        &mut self,
        uri: &str,
        lang_id: &str,
        line: u32,
        character: u32,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/prepareTypeHierarchy", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    /// Request supertypes for a type hierarchy item.
    pub async fn request_supertypes(
        &mut self,
        item: Value,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "item": item });
        let response = self.send_and_wait(lang_id, project_root, "typeHierarchy/supertypes", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    /// Request subtypes for a type hierarchy item.
    pub async fn request_subtypes(
        &mut self,
        item: Value,
        lang_id: &str,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({ "item": item });
        let response = self.send_and_wait(lang_id, project_root, "typeHierarchy/subtypes", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }

    // =========================================================================
    // Selection Range
    // =========================================================================

    /// Request selection ranges for given positions in a document.
    pub async fn request_selection_range(
        &mut self,
        uri: &str,
        lang_id: &str,
        positions: Vec<Value>,
        project_root: &str,
    ) -> Result<Value, String> {
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "positions": positions
        });
        let response = self.send_and_wait(lang_id, project_root, "textDocument/selectionRange", params, DEFAULT_TIMEOUT_SECS).await?;
        Ok(Self::result_or_null(&response))
    }
}
