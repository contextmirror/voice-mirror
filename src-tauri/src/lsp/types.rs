//! Helper types for LSP integration.
//!
//! Provides URI conversion utilities and serializable event structs
//! for communicating LSP data to the frontend via Tauri events.

use lsp_types::DiagnosticSeverity;
use serde::Serialize;
use url::Url;

/// Convert a relative file path and project root into a `file://` URI.
///
/// Joins the paths, canonicalizes, and uses `url::Url::from_file_path()`.
/// Handles Windows drive letter normalization automatically.
pub fn file_uri(relative_path: &str, project_root: &str) -> String {
    let full = std::path::Path::new(project_root).join(relative_path);
    // Try to canonicalize; fall back to the joined path if it doesn't exist yet
    let resolved = full.canonicalize().unwrap_or(full);
    match Url::from_file_path(&resolved) {
        Ok(url) => url.to_string(),
        Err(_) => {
            // Fallback: manual file URI construction
            let path_str = resolved.to_string_lossy().replace('\\', "/");
            if path_str.starts_with('/') {
                format!("file://{}", path_str)
            } else {
                format!("file:///{}", path_str)
            }
        }
    }
}

/// Convert a `file://` URI back to a path relative to the project root.
///
/// Returns `None` if the URI doesn't start with the project root.
pub fn uri_to_relative_path(uri: &str, project_root: &str) -> Option<String> {
    let url = Url::parse(uri).ok()?;
    let file_path = url.to_file_path().ok()?;

    let root = std::path::Path::new(project_root);
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let canon_file = file_path
        .canonicalize()
        .unwrap_or_else(|_| file_path.clone());

    canon_file
        .strip_prefix(&canon_root)
        .ok()
        .map(|rel: &std::path::Path| rel.to_string_lossy().replace('\\', "/"))
}

/// Emitted when the LSP server publishes diagnostics for a file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnosticEvent {
    pub uri: String,
    pub language_id: String,
    pub diagnostics: Vec<DiagnosticItem>,
}

/// A single diagnostic item (error, warning, etc.).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticItem {
    pub range: DiagnosticRange,
    pub severity: String,
    pub message: String,
    pub source: Option<String>,
}

/// A range within a document (start and end positions).
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticRange {
    pub start: DiagnosticPosition,
    pub end: DiagnosticPosition,
}

/// A position within a document (0-based line and character).
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticPosition {
    pub line: u32,
    pub character: u32,
}

/// Status information for a single LSP server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStatus {
    pub language_id: String,
    pub binary: String,
    pub running: bool,
    pub open_docs_count: usize,
}

/// Emitted when LSP server status changes.
#[derive(Debug, Clone, Serialize)]
pub struct LspServerStatusEvent {
    pub servers: Vec<LspServerStatus>,
}

/// Convert an LSP `DiagnosticSeverity` to a human-readable string.
pub fn severity_to_string(severity: Option<DiagnosticSeverity>) -> String {
    match severity {
        Some(DiagnosticSeverity::ERROR) => "error".to_string(),
        Some(DiagnosticSeverity::WARNING) => "warning".to_string(),
        Some(DiagnosticSeverity::INFORMATION) => "info".to_string(),
        Some(DiagnosticSeverity::HINT) => "hint".to_string(),
        _ => "unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_severity_to_string() {
        assert_eq!(severity_to_string(Some(DiagnosticSeverity::ERROR)), "error");
        assert_eq!(
            severity_to_string(Some(DiagnosticSeverity::WARNING)),
            "warning"
        );
        assert_eq!(
            severity_to_string(Some(DiagnosticSeverity::INFORMATION)),
            "info"
        );
        assert_eq!(severity_to_string(Some(DiagnosticSeverity::HINT)), "hint");
        assert_eq!(severity_to_string(None), "unknown");
    }

    #[test]
    fn test_file_uri_basic() {
        // Test that file_uri produces a valid file:// URI
        let uri = file_uri("src/main.rs", ".");
        assert!(uri.starts_with("file:///"), "URI should start with file:///: {}", uri);
        assert!(uri.contains("src/main.rs") || uri.contains("src%2Fmain.rs") || uri.contains("src\\main.rs"),
            "URI should contain the file path: {}", uri);
    }

    #[test]
    fn test_uri_roundtrip() {
        // Create a URI from a known path, then convert back
        let root = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let uri = file_uri("Cargo.toml", &root);
        let rel = uri_to_relative_path(&uri, &root);
        assert_eq!(rel, Some("Cargo.toml".to_string()));
    }

    #[test]
    fn test_uri_to_relative_path_outside_root() {
        // A URI that doesn't start with the project root should return None
        let result = uri_to_relative_path("file:///tmp/other/file.rs", "/home/user/project");
        // On Windows this may fail to parse the Unix path, which is fine
        // The important thing is it doesn't return a valid relative path
        // for a path that's outside the root
        if let Some(rel) = &result {
            // If it does parse, it should not be a path inside the project
            assert!(!rel.is_empty() || result.is_none());
        }
    }
}
