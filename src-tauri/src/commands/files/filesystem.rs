use super::super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

/// Create a new directory (including parents).
///
/// `path` is relative to the project root (or the provided `root`).
/// Errors if directory already exists.
#[tauri::command]
pub fn create_directory(app: AppHandle, path: String, root: Option<String>) -> IpcResponse {
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

    // For new directories, canonicalize the nearest existing ancestor
    let mut check_path = target.clone();
    while !check_path.exists() {
        if let Some(parent) = check_path.parent() {
            check_path = parent.to_path_buf();
        } else {
            break;
        }
    }
    let canon_check = match check_path.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Parent path not found: {}", e)),
    };

    if !canon_check.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_check.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    if target.exists() {
        return IpcResponse::err("Directory already exists");
    }

    if let Err(e) = std::fs::create_dir_all(&target) {
        return IpcResponse::err(format!("Failed to create directory: {}", e));
    }

    let rel_path = path.replace('\\', "/");
    info!("create_directory: {}", rel_path);

    // Emit fs-tree-changed for the parent directory
    let parent_rel = std::path::Path::new(&rel_path)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"));
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

/// Rename (move) a file or directory within the project root.
///
/// Both `old_path` and `new_path` are relative to the project root.
#[tauri::command]
pub fn rename_entry(app: AppHandle, old_path: String, new_path: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let old_target = root.join(&old_path);
    let new_target = root.join(&new_path);

    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };

    // Validate old path exists and is within root
    let canon_old = match old_target.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Source not found: {}", e)),
    };
    if !canon_old.starts_with(&canon_root) {
        return IpcResponse::err("Source path is outside the project root");
    }

    // Validate new path parent exists and is within root
    if let Some(new_parent) = new_target.parent() {
        if !new_parent.exists() {
            if let Err(e) = std::fs::create_dir_all(new_parent) {
                return IpcResponse::err(format!("Failed to create parent directories: {}", e));
            }
        }
    }
    let canon_new_parent = match new_target.parent().unwrap_or(&root).canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Destination parent not found: {}", e)),
    };
    let canon_new = canon_new_parent.join(new_target.file_name().unwrap_or_default());
    if !canon_new.starts_with(&canon_root) {
        return IpcResponse::err("Destination path is outside the project root");
    }

    if canon_new.exists() {
        return IpcResponse::err("Destination already exists");
    }

    if let Err(e) = std::fs::rename(&canon_old, &canon_new) {
        return IpcResponse::err(format!("Failed to rename: {}", e));
    }

    info!("rename_entry: {} -> {}", old_path, new_path);

    // Emit fs-tree-changed for both old and new parent directories
    let old_rel = old_path.replace('\\', "/");
    let new_rel = new_path.replace('\\', "/");
    let old_parent = std::path::Path::new(&old_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"));
    let new_parent = std::path::Path::new(&new_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"));

    let mut dirs: Vec<String> = Vec::new();
    let mut root_changed = false;

    for parent in [&old_parent, &new_parent] {
        match parent {
            Some(p) if !p.is_empty() => {
                if !dirs.contains(p) {
                    dirs.push(p.clone());
                }
            }
            _ => root_changed = true,
        }
    }

    let _ = app.emit(
        "fs-tree-changed",
        serde_json::json!({ "directories": dirs, "root": root_changed }),
    );
    let _ = app.emit(
        "fs-file-changed",
        serde_json::json!({ "files": [&old_rel, &new_rel] }),
    );

    IpcResponse::ok(serde_json::json!({
        "oldPath": old_rel,
        "newPath": new_rel,
    }))
}

/// Delete a file or directory by moving it to the OS trash.
///
/// Falls back to permanent delete if trash is unavailable.
/// `path` is relative to the project root.
#[tauri::command]
pub fn delete_entry(app: AppHandle, path: String, root: Option<String>) -> IpcResponse {
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
    let canon_target = match target.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Path not found: {}", e)),
    };

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    // Compute parent directory info for event emission (before delete)
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
    let event_payload = serde_json::json!({ "directories": dirs, "root": parent_is_root });

    // Try OS trash first, fall back to permanent delete
    match trash::delete(&canon_target) {
        Ok(()) => {
            info!("delete_entry (trash): {}", path);
            let _ = app.emit("fs-tree-changed", &event_payload);
            IpcResponse::ok(serde_json::json!({ "path": path.replace('\\', "/"), "method": "trash" }))
        }
        Err(trash_err) => {
            warn!("Trash failed for {}: {} — falling back to permanent delete", path, trash_err);
            let result = if canon_target.is_dir() {
                std::fs::remove_dir_all(&canon_target)
            } else {
                std::fs::remove_file(&canon_target)
            };
            match result {
                Ok(()) => {
                    info!("delete_entry (permanent): {}", path);
                    let _ = app.emit("fs-tree-changed", &event_payload);
                    IpcResponse::ok(serde_json::json!({ "path": path.replace('\\', "/"), "method": "permanent" }))
                }
                Err(e) => {
                    error!("Failed to delete {}: {}", path, e);
                    IpcResponse::err(format!("Failed to delete: {}", e))
                }
            }
        }
    }
}

/// Reveal a file or directory in the system file explorer.
///
/// Platform-specific: `explorer /select,` (Windows), `open -R` (macOS), `xdg-open` (Linux).
/// `path` is relative to the project root.
#[tauri::command]
pub fn reveal_in_explorer(path: String, root: Option<String>) -> IpcResponse {
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
    let canon_target = match target.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Path not found: {}", e)),
    };

    if !canon_target.starts_with(&canon_root) {
        return IpcResponse::err("Path is outside the project root");
    }

    let result = {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&canon_target)
                .spawn()
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&canon_target)
                .spawn()
        }

        #[cfg(target_os = "linux")]
        {
            // xdg-open opens the parent directory (can't select a file)
            let parent = canon_target.parent().unwrap_or(&canon_target);
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
        }
    };

    match result {
        Ok(_) => {
            info!("reveal_in_explorer: {}", path);
            IpcResponse::ok(serde_json::json!({ "path": path.replace('\\', "/") }))
        }
        Err(e) => {
            error!("Failed to reveal in explorer: {}", e);
            IpcResponse::err(format!("Failed to reveal in explorer: {}", e))
        }
    }
}
