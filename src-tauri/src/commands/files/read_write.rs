use super::super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

/// Read a file's contents as UTF-8 text.
///
/// `path` is relative to the project root (or the provided `root`).
/// Returns `{ content, path, size }` on success.
#[tauri::command]
pub fn read_file(path: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = root.join(&path);

    // Security: canonicalize both paths and verify target is within root
    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };
    let canon_target = match target.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("File not found: {}", e)),
    };

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    let size = match std::fs::metadata(&canon_target) {
        Ok(m) => m.len(),
        Err(e) => return IpcResponse::err(format!("Failed to get file metadata: {}", e)),
    };

    // Read file bytes and attempt UTF-8 conversion
    let bytes = match std::fs::read(&canon_target) {
        Ok(b) => b,
        Err(e) => return IpcResponse::err(format!("Failed to read file: {}", e)),
    };

    let content = match String::from_utf8(bytes) {
        Ok(c) => c,
        Err(_) => {
            // Return a structured error so the frontend can show "binary file" UI
            return IpcResponse::ok(serde_json::json!({
                "binary": true,
                "path": path,
                "size": size
            }));
        }
    };

    let rel_path = match canon_target.strip_prefix(&canon_root) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(_) => path.clone(),
    };

    info!("read_file: {} ({} bytes)", rel_path, size);
    IpcResponse::ok(serde_json::json!({ "content": content, "path": rel_path, "size": size }))
}

/// Read an external file by absolute path (read-only, no project root restriction).
///
/// Used for viewing type definitions, node_modules files, etc. that are outside
/// the project root. Only supports reading — no writes allowed for external files.
/// Path must be absolute.
#[tauri::command]
pub fn read_external_file(path: String) -> IpcResponse {
    let file_path = PathBuf::from(&path);

    // Must be an absolute path
    if !file_path.is_absolute() {
        return IpcResponse::err("read_external_file requires an absolute path");
    }

    // Canonicalize to resolve symlinks
    let canon = match file_path.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("File not found: {}", e)),
    };

    let size = match std::fs::metadata(&canon) {
        Ok(m) => m.len(),
        Err(e) => return IpcResponse::err(format!("Failed to get file metadata: {}", e)),
    };

    // Cap at 2MB for safety — type definitions can be large but not absurd
    if size > 2 * 1024 * 1024 {
        return IpcResponse::err("File too large for external preview (max 2MB)");
    }

    let bytes = match std::fs::read(&canon) {
        Ok(b) => b,
        Err(e) => return IpcResponse::err(format!("Failed to read file: {}", e)),
    };

    let content = match String::from_utf8(bytes) {
        Ok(c) => c,
        Err(_) => {
            return IpcResponse::ok(serde_json::json!({
                "binary": true,
                "path": path,
                "size": size
            }));
        }
    };

    info!("read_external_file: {} ({} bytes)", path, size);
    IpcResponse::ok(serde_json::json!({ "content": content, "path": path, "size": size, "readOnly": true }))
}

/// Write content to a file using atomic write (temp file + rename).
///
/// `path` is relative to the project root (or the provided `root`).
/// Creates parent directories if they don't exist.
/// Returns `{ path, size }` on success.
#[tauri::command]
pub fn write_file(app: AppHandle, path: String, content: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = root.join(&path);

    // Security: canonicalize root and verify target will be within it.
    // For new files, canonicalize the parent directory instead.
    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return IpcResponse::err(format!("Failed to create parent directories: {}", e));
            }
        }
    }

    // Canonicalize the parent to check path traversal (target file may not exist yet)
    let canon_parent = match target.parent().unwrap_or(&root).canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Parent directory not found: {}", e)),
    };
    let canon_target = canon_parent.join(target.file_name().unwrap_or_default());

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    // Atomic write: write to temp file, then rename
    let tmp_path = canon_target.with_extension("tmp");
    if let Err(e) = std::fs::write(&tmp_path, &content) {
        return IpcResponse::err(format!("Failed to write temp file: {}", e));
    }

    if let Err(e) = std::fs::rename(&tmp_path, &canon_target) {
        // Clean up temp file on rename failure
        let _ = std::fs::remove_file(&tmp_path);
        return IpcResponse::err(format!("Failed to rename temp file: {}", e));
    }

    let rel_path = match canon_target.strip_prefix(&canon_root) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(_) => path.clone(),
    };

    let size = content.len();
    info!("write_file: {} ({} bytes)", rel_path, size);

    // Emit fs-tree-changed for the parent directory
    let parent_rel = match canon_target.parent() {
        Some(p) => p
            .strip_prefix(&canon_root)
            .ok()
            .map(|r| r.to_string_lossy().replace('\\', "/")),
        None => None,
    };
    let parent_is_root = parent_rel.as_ref().map_or(true, |p| p.is_empty());
    let dirs: Vec<&str> = match &parent_rel {
        Some(p) if !p.is_empty() => vec![p.as_str()],
        _ => vec![],
    };
    let _ = app.emit(
        "fs-tree-changed",
        serde_json::json!({ "directories": dirs, "root": parent_is_root }),
    );
    let _ = app.emit(
        "fs-file-changed",
        serde_json::json!({ "files": [rel_path] }),
    );

    IpcResponse::ok(serde_json::json!({ "path": rel_path, "size": size }))
}

/// Create a new file with optional content.
///
/// `path` is relative to the project root (or the provided `root`).
/// Creates parent directories if needed. Errors if file already exists.
#[tauri::command]
pub fn create_file(app: AppHandle, path: String, content: Option<String>, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = root.join(&path);

    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return IpcResponse::err(format!("Failed to create parent directories: {}", e));
            }
        }
    }

    // Canonicalize parent to check path traversal (file doesn't exist yet)
    let canon_parent = match target.parent().unwrap_or(&root).canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Parent directory not found: {}", e)),
    };
    let canon_target = canon_parent.join(target.file_name().unwrap_or_default());

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    if canon_target.exists() {
        return IpcResponse::err("File already exists");
    }

    let file_content = content.unwrap_or_default();
    if let Err(e) = std::fs::write(&canon_target, &file_content) {
        return IpcResponse::err(format!("Failed to create file: {}", e));
    }

    let rel_path = match canon_target.strip_prefix(&canon_root) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(_) => path.clone(),
    };

    info!("create_file: {}", rel_path);

    // Emit fs-tree-changed for the parent directory
    let parent_rel = match canon_target.parent() {
        Some(p) => p
            .strip_prefix(&canon_root)
            .ok()
            .map(|r| r.to_string_lossy().replace('\\', "/")),
        None => None,
    };
    let parent_is_root = parent_rel.as_ref().map_or(true, |p| p.is_empty());
    let dirs: Vec<&str> = match &parent_rel {
        Some(p) if !p.is_empty() => vec![p.as_str()],
        _ => vec![],
    };
    let _ = app.emit(
        "fs-tree-changed",
        serde_json::json!({ "directories": dirs, "root": parent_is_root }),
    );

    IpcResponse::ok(serde_json::json!({ "path": rel_path }))
}
