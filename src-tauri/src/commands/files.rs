use super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

/// List the contents of a directory within the project root.
///
/// If `path` is None, lists the project root. Otherwise, lists the subdirectory
/// relative to the project root. Returns entries sorted: directories first, then
/// files, alphabetical within each group.
///
/// When `root` is provided, uses that path instead of auto-detecting the project root.
#[tauri::command]
pub fn list_directory(path: Option<String>, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = match &path {
        Some(p) => root.join(p),
        None => root.clone(),
    };

    // Security: canonicalize both paths and verify target is within root
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

    // Build gitignore matcher from project root .gitignore
    let mut gitignore_builder = ignore::gitignore::GitignoreBuilder::new(&root);
    let gitignore_path = root.join(".gitignore");
    if gitignore_path.exists() {
        gitignore_builder.add(&gitignore_path);
    }
    let gitignore = gitignore_builder.build().unwrap_or_else(|e| {
        warn!("Failed to parse .gitignore: {}", e);
        ignore::gitignore::GitignoreBuilder::new(&root)
            .build()
            .unwrap()
    });

    // Read directory entries
    let entries = match std::fs::read_dir(&canon_target) {
        Ok(e) => e,
        Err(e) => return IpcResponse::err(format!("Failed to read directory: {}", e)),
    };

    let mut dirs: Vec<serde_json::Value> = Vec::new();
    let mut files: Vec<serde_json::Value> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip .git and .DS_Store
        if name == ".git" || name == ".DS_Store" {
            continue;
        }

        let full_path = entry.path();
        let is_dir = full_path.is_dir();

        // Compute path relative to project root
        let rel_path = match full_path.strip_prefix(&canon_root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => name.clone(),
        };

        // Check if ignored by .gitignore
        let ignored = gitignore
            .matched_path_or_any_parents(&rel_path, is_dir)
            .is_ignore();

        let entry_type = if is_dir { "directory" } else { "file" };

        let entry_json = serde_json::json!({
            "name": name,
            "path": rel_path,
            "type": entry_type,
            "ignored": ignored,
        });

        if is_dir {
            dirs.push(entry_json);
        } else {
            files.push(entry_json);
        }
    }

    // Sort alphabetically within each group (case-insensitive)
    dirs.sort_by(|a, b| {
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.to_lowercase().cmp(&b_name.to_lowercase())
    });
    files.sort_by(|a, b| {
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.to_lowercase().cmp(&b_name.to_lowercase())
    });

    // Directories first, then files
    let mut result = dirs;
    result.append(&mut files);

    info!(
        "list_directory: {} ({} entries)",
        path.as_deref().unwrap_or("/"),
        result.len()
    );

    IpcResponse::ok(serde_json::json!(result))
}

/// Get git status changes (added, modified, deleted files).
///
/// Returns `{ "changes": [...] }` where each change has a `path` and `status`.
/// If git is not available or the project is not a git repo, returns empty changes.
///
/// When `root` is provided, uses that path as CWD for git instead of auto-detecting.
#[tauri::command]
pub fn get_git_changes(root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let output = match std::process::Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            info!("git status failed (git may not be installed): {}", e);
            return IpcResponse::ok(serde_json::json!({ "changes": [] }));
        }
    };

    if !output.status.success() {
        info!("git status returned non-zero (may not be a git repo)");
        return IpcResponse::ok(serde_json::json!({ "changes": [] }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes: Vec<serde_json::Value> = Vec::new();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }

        let xy = &line[..2];
        // Git wraps paths with spaces/special chars in double quotes — strip them
        let path_part = line[3..].trim().trim_matches('"');

        let status = match xy {
            "??" => "added",
            "A " | "AM" => "added",
            "D " | " D" => "deleted",
            "M " | " M" | "MM" => "modified",
            _ if xy.starts_with('R') => "modified",
            _ => "modified",
        };

        // For renames (R_), extract the new path after " -> "
        let file_path = if xy.starts_with('R') {
            path_part
                .split(" -> ")
                .last()
                .unwrap_or(path_part)
                .trim_matches('"')
        } else {
            path_part
        };

        // Untracked directories end with "/" — enumerate their files instead
        if file_path.ends_with('/') {
            let dir_path = root.join(file_path.trim_end_matches('/'));
            if dir_path.is_dir() {
                fn walk_dir(dir: &std::path::Path, root: &std::path::Path, changes: &mut Vec<serde_json::Value>) {
                    if let Ok(entries) = std::fs::read_dir(dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.is_dir() {
                                walk_dir(&path, root, changes);
                            } else if let Ok(rel) = path.strip_prefix(root) {
                                changes.push(serde_json::json!({
                                    "path": rel.to_string_lossy().replace('\\', "/"),
                                    "status": "added",
                                }));
                            }
                        }
                    }
                }
                walk_dir(&dir_path, &root, &mut changes);
                continue;
            }
        }

        changes.push(serde_json::json!({
            "path": file_path,
            "status": status,
        }));
    }

    info!("get_git_changes: {} changes", changes.len());
    IpcResponse::ok(serde_json::json!({ "changes": changes }))
}

/// Get the project root directory path.
#[tauri::command]
pub fn get_project_root() -> IpcResponse {
    match find_project_root() {
        Some(root) => {
            let root_str = root.to_string_lossy().to_string();
            IpcResponse::ok(serde_json::json!({ "root": root_str }))
        }
        None => IpcResponse::err("Could not find project root"),
    }
}

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

/// Get a file's content as it exists in git HEAD.
///
/// Runs `git show HEAD:<path>` in the project root.
/// For new (untracked) files, returns empty content with `isNew: true`.
/// `path` is relative to the project root.
#[tauri::command]
pub fn get_file_git_content(path: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    // Normalize path separators for git (always forward slashes)
    let git_path = path.replace('\\', "/");

    let output = match std::process::Command::new("git")
        .args(["show", &format!("HEAD:{}", git_path)])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            info!("git show failed: {}", e);
            return IpcResponse::ok(serde_json::json!({
                "content": "",
                "path": path,
                "isNew": true
            }));
        }
    };

    if !output.status.success() {
        return IpcResponse::ok(serde_json::json!({
            "content": "",
            "path": path,
            "isNew": true
        }));
    }

    match String::from_utf8(output.stdout) {
        Ok(content) => IpcResponse::ok(serde_json::json!({
            "content": content,
            "path": path,
            "isNew": false
        })),
        Err(_) => IpcResponse::ok(serde_json::json!({
            "binary": true,
            "path": path
        })),
    }
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

/// Recursively list all files in the project, respecting .gitignore.
///
/// Uses the `ignore` crate (same engine as ripgrep) for fast, gitignore-aware
/// directory walking. Returns relative paths with forward slashes, capped at
/// 10,000 files.
#[tauri::command]
pub fn search_files(root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };

    const MAX_FILES: usize = 10_000;
    let mut files: Vec<String> = Vec::with_capacity(2048);

    let walker = ignore::WalkBuilder::new(&canon_root)
        .hidden(false) // Don't skip hidden files (let .gitignore decide)
        .git_ignore(true) // Respect .gitignore
        .git_global(true) // Respect global gitignore
        .git_exclude(true) // Respect .git/info/exclude
        .build();

    for entry in walker.flatten() {
        if files.len() >= MAX_FILES {
            break;
        }

        // Skip directories — only return files
        if entry.file_type().map_or(true, |ft| ft.is_dir()) {
            continue;
        }

        if let Ok(rel) = entry.path().strip_prefix(&canon_root) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            // Skip .git internals (WalkBuilder may still surface some)
            if rel_str.starts_with(".git/") || rel_str == ".git" {
                continue;
            }
            files.push(rel_str);
        }
    }

    files.sort_unstable();
    info!("search_files: found {} files in {}", files.len(), canon_root.display());

    IpcResponse::ok(serde_json::json!(files))
}
