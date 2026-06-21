//! Background project file scanning for LSP diagnostics.
//!
//! Walks the project directory, finds files matching a language server's
//! extensions, and sends `textDocument/didOpen` notifications in batches
//! so the server can produce project-wide diagnostics.

use tracing::{info, warn};

use super::{client, lsp_language_id, server_key, types, LspManager};

/// Maximum number of files to scan for background diagnostics.
pub(crate) const MAX_SCAN_FILES: usize = 500;

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

impl LspManager {
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
        // Load the manifest to get extensions for this server.
        // Look up directly by server ID first (handles supplementary servers like "eslint"
        // whose key doesn't map back to a file extension).
        let manifest = super::manifest::load_manifest()
            .map_err(|e| format!("Failed to load manifest: {}", e))?;

        let entry = if let Some(e) = manifest.servers.get(lang_id) {
            e.clone()
        } else {
            let ext = self.extension_for_language(lang_id);
            super::manifest::find_server_for_extension(&manifest, &ext)
                .map(|(_, e)| e)
                .ok_or_else(|| format!("No manifest entry for language '{}'", lang_id))?
        };

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
            let file_lang_id = lsp_language_id(&file_ext).to_string();

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
}

/// Recursively collect files matching the given extensions from a project directory.
///
/// Skips directories in `SKIP_DIRS` and stops once `max_files` are collected.
/// Returns absolute file paths.
pub(crate) fn collect_matching_files(
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
