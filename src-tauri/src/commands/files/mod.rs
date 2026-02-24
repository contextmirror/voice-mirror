// Sub-modules must be pub so that #[tauri::command] generated items
// (__cmd__*, __cmd__*_future) are reachable via glob re-exports.
pub mod directory;
pub mod read_write;
pub mod filesystem;
pub mod git;
pub mod search;

use super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;

/// Resolve project root from optional override or auto-detection.
pub(crate) fn resolve_root(root: Option<String>) -> Result<PathBuf, IpcResponse> {
    match root {
        Some(r) => Ok(PathBuf::from(r)),
        None => find_project_root().ok_or_else(|| IpcResponse::err("Could not find project root")),
    }
}

/// Normalize backslashes to forward slashes for git paths.
pub(crate) fn normalize_git_paths(paths: &[String]) -> Vec<String> {
    paths.iter().map(|p| p.replace('\\', "/")).collect()
}

/// Truncate a string at a safe UTF-8 character boundary.
#[allow(dead_code)]
pub(crate) fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    // Walk backwards from max_bytes to find a valid char boundary
    let mut idx = max_bytes;
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    &s[..idx]
}

// Re-export all public commands (and their __cmd__* generated items)
// so lib.rs can use `files_cmds::function_name` without changes.
pub use directory::*;
pub use read_write::*;
pub use filesystem::*;
pub use git::*;
pub use search::*;
