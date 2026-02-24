use super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};
use regex::Regex;

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
            return IpcResponse::ok(serde_json::json!({ "changes": [], "branch": null }));
        }
    };

    if !output.status.success() {
        info!("git status returned non-zero (may not be a git repo)");
        return IpcResponse::ok(serde_json::json!({ "changes": [], "branch": null }));
    }

    // Get the current branch name
    let branch = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&root)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes: Vec<serde_json::Value> = Vec::new();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }

        let x = line.as_bytes()[0] as char;
        let y = line.as_bytes()[1] as char;
        // Git wraps paths with spaces/special chars in double quotes — strip them
        let path_part = line[3..].trim().trim_matches('"');

        let is_untracked = x == '?' && y == '?';

        let staged_status = match x {
            'M' => Some("modified"),
            'A' => Some("added"),
            'D' => Some("deleted"),
            'R' => Some("renamed"),
            _ => None,
        };
        let unstaged_status = if is_untracked {
            Some("added")
        } else {
            match y {
                'M' => Some("modified"),
                'D' => Some("deleted"),
                _ => None,
            }
        };

        let staged = staged_status.is_some();
        let unstaged = unstaged_status.is_some() || is_untracked;

        // Backward-compat: pick most relevant status
        let status = if is_untracked {
            "added"
        } else if let Some(s) = staged_status {
            s
        } else if let Some(s) = unstaged_status {
            s
        } else {
            "modified"
        };

        // For renames (R_), extract the new path after " -> "
        let file_path = if x == 'R' {
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
                                    "staged": false,
                                    "unstaged": true,
                                    "stagedStatus": null,
                                    "unstagedStatus": "added",
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
            "staged": staged,
            "unstaged": unstaged,
            "stagedStatus": staged_status,
            "unstagedStatus": unstaged_status,
        }));
    }

    info!("get_git_changes: {} changes", changes.len());
    IpcResponse::ok(serde_json::json!({ "changes": changes, "branch": branch }))
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

/// Build a regex from search parameters.
///
/// - Plain text queries are escaped. Regex queries are compiled as-is.
/// - `whole_word` wraps in `\b...\b`.
/// - `case_sensitive` controls the case-insensitive flag (default: insensitive).
fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    is_regex: bool,
    whole_word: bool,
) -> Result<Regex, String> {
    let pattern = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let pattern = if whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };

    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))
}

/// Check if a relative path matches a comma-separated glob pattern list.
///
/// Each pattern is trimmed. Patterns like `*.rs` match the file extension.
/// Patterns like `src/**` match path prefixes. Uses simple matching:
/// - `*.ext` matches files ending with `.ext`
/// - `dir/*` or `dir/**` matches paths starting with `dir/`
/// - Exact name matches anywhere in the path
fn matches_glob_list(rel_path: &str, pattern_list: &str) -> bool {
    let lower_path = rel_path.to_lowercase();
    for raw_pattern in pattern_list.split(',') {
        let pat = raw_pattern.trim();
        if pat.is_empty() {
            continue;
        }
        let lower_pat = pat.to_lowercase();
        // *.ext — extension match
        if let Some(ext) = lower_pat.strip_prefix("*.") {
            if lower_path.ends_with(&format!(".{}", ext)) {
                return true;
            }
        }
        // dir/* or dir/** — prefix match
        else if let Some(prefix) = lower_pat.strip_suffix("/**") {
            if lower_path.starts_with(&format!("{}/", prefix)) {
                return true;
            }
        } else if let Some(prefix) = lower_pat.strip_suffix("/*") {
            if lower_path.starts_with(&format!("{}/", prefix)) {
                return true;
            }
        }
        // Exact segment match (e.g. "node_modules" matches any path containing it)
        else if lower_path == lower_pat
            || lower_path.starts_with(&format!("{}/", lower_pat))
            || lower_path.contains(&format!("/{}/", lower_pat))
            || lower_path.ends_with(&format!("/{}", lower_pat))
        {
            return true;
        }
    }
    false
}

/// Search file contents across the project using regex.
///
/// Walks the project tree (gitignore-aware), reads each text file, and
/// finds all lines matching the query. Results are grouped by file with
/// line number, column range, and trimmed text for each match.
///
/// Caps: 200 files with matches, 5000 total matches. If either cap is hit,
/// `truncated` is set to true in the response.
#[tauri::command]
pub fn search_content(
    query: String,
    root: Option<String>,
    case_sensitive: Option<bool>,
    is_regex: Option<bool>,
    whole_word: Option<bool>,
    include_pattern: Option<String>,
    exclude_pattern: Option<String>,
) -> IpcResponse {
    if query.is_empty() {
        return IpcResponse::err("Search query cannot be empty");
    }

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

    let re = match build_search_regex(
        &query,
        case_sensitive.unwrap_or(false),
        is_regex.unwrap_or(false),
        whole_word.unwrap_or(false),
    ) {
        Ok(r) => r,
        Err(e) => return IpcResponse::err(e),
    };

    const MAX_FILES: usize = 200;
    const MAX_MATCHES: usize = 5000;
    const MAX_LINE_LEN: usize = 300;

    let mut file_results: Vec<serde_json::Value> = Vec::new();
    let mut total_matches: usize = 0;
    let mut truncated = false;

    let walker = ignore::WalkBuilder::new(&canon_root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build();

    for entry in walker.flatten() {
        if truncated {
            break;
        }

        // Skip directories
        if entry.file_type().map_or(true, |ft| ft.is_dir()) {
            continue;
        }

        let path = entry.path();
        let rel_path = match path.strip_prefix(&canon_root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        // Skip .git internals
        if rel_path.starts_with(".git/") || rel_path == ".git" {
            continue;
        }

        // Apply include pattern filter
        if let Some(ref include) = include_pattern {
            if !include.trim().is_empty() && !matches_glob_list(&rel_path, include) {
                continue;
            }
        }

        // Apply exclude pattern filter
        if let Some(ref exclude) = exclude_pattern {
            if !exclude.trim().is_empty() && matches_glob_list(&rel_path, exclude) {
                continue;
            }
        }

        // Read file, skip binary
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let content = match String::from_utf8(bytes) {
            Ok(c) => c,
            Err(_) => continue, // Skip binary files
        };

        let mut line_matches: Vec<serde_json::Value> = Vec::new();

        for (line_idx, line) in content.lines().enumerate() {
            if total_matches >= MAX_MATCHES {
                truncated = true;
                break;
            }

            for mat in re.find_iter(line) {
                if total_matches >= MAX_MATCHES {
                    truncated = true;
                    break;
                }

                // Trim long lines, keeping match visible.
                // Use char boundaries to avoid panicking on multi-byte UTF-8.
                let (display_text, col_start, col_end) = if line.len() > MAX_LINE_LEN {
                    // Center the trim window around the match
                    let match_mid = (mat.start() + mat.end()) / 2;
                    let window_start = match_mid.saturating_sub(MAX_LINE_LEN / 2);
                    let window_end = (window_start + MAX_LINE_LEN).min(line.len());
                    let window_start = if window_end == line.len() {
                        window_end.saturating_sub(MAX_LINE_LEN)
                    } else {
                        window_start
                    };

                    // Snap to char boundaries to avoid slicing mid-character
                    let safe_start = if line.is_char_boundary(window_start) {
                        window_start
                    } else {
                        line.ceil_char_boundary(window_start)
                    };
                    let safe_end = if line.is_char_boundary(window_end) {
                        window_end
                    } else {
                        line.floor_char_boundary(window_end)
                    };

                    let trimmed = &line[safe_start..safe_end];
                    let adj_start = mat.start().saturating_sub(safe_start);
                    let adj_end = mat.end().saturating_sub(safe_start).min(trimmed.len());
                    (trimmed.to_string(), adj_start as u32, adj_end as u32)
                } else {
                    (line.to_string(), mat.start() as u32, mat.end() as u32)
                };

                line_matches.push(serde_json::json!({
                    "line": (line_idx + 1) as u32,
                    "text": display_text,
                    "col_start": col_start,
                    "col_end": col_end,
                }));

                total_matches += 1;
            }
        }

        if !line_matches.is_empty() {
            if file_results.len() >= MAX_FILES {
                truncated = true;
                break;
            }

            file_results.push(serde_json::json!({
                "path": rel_path,
                "matches": line_matches,
            }));
        }
    }

    info!(
        "search_content: '{}' → {} matches in {} files{}",
        query,
        total_matches,
        file_results.len(),
        if truncated { " (truncated)" } else { "" }
    );

    IpcResponse::ok(serde_json::json!({
        "matches": file_results,
        "totalMatches": total_matches,
        "truncated": truncated,
    }))
}

// ============ Git staging, committing, and push commands ============

/// Normalize backslashes to forward slashes for git paths.
fn normalize_git_paths(paths: &[String]) -> Vec<String> {
    paths.iter().map(|p| p.replace('\\', "/")).collect()
}

/// Truncate a string at a safe UTF-8 character boundary.
fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
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

/// Resolve project root from optional override or auto-detection.
fn resolve_root(root: Option<String>) -> Result<PathBuf, IpcResponse> {
    match root {
        Some(r) => Ok(PathBuf::from(r)),
        None => find_project_root().ok_or_else(|| IpcResponse::err("Could not find project root")),
    }
}

/// Stage files in the git index.
///
/// `paths` are relative to the project root. Errors if paths is empty.
#[tauri::command]
pub fn git_stage(paths: Vec<String>, root: Option<String>) -> IpcResponse {
    if paths.is_empty() {
        return IpcResponse::err("No paths provided to stage");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let normalized = normalize_git_paths(&paths);
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(normalized);

    let output = match std::process::Command::new("git")
        .args(&args)
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git add: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git add failed: {}", stderr.trim()));
    }

    info!("git_stage: staged {} files", paths.len());
    IpcResponse::ok_empty()
}

/// Unstage files from the git index.
///
/// `paths` are relative to the project root. Errors if paths is empty.
#[tauri::command]
pub fn git_unstage(paths: Vec<String>, root: Option<String>) -> IpcResponse {
    if paths.is_empty() {
        return IpcResponse::err("No paths provided to unstage");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let normalized = normalize_git_paths(&paths);
    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(normalized);

    let output = match std::process::Command::new("git")
        .args(&args)
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git reset: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git reset failed: {}", stderr.trim()));
    }

    info!("git_unstage: unstaged {} files", paths.len());
    IpcResponse::ok_empty()
}

/// Stage all changes (tracked and untracked).
#[tauri::command]
pub fn git_stage_all(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git add -A: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git add -A failed: {}", stderr.trim()));
    }

    info!("git_stage_all: staged all changes");
    IpcResponse::ok_empty()
}

/// Unstage all staged changes.
#[tauri::command]
pub fn git_unstage_all(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["reset", "HEAD"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git reset HEAD: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git reset HEAD failed: {}", stderr.trim()));
    }

    info!("git_unstage_all: unstaged all changes");
    IpcResponse::ok_empty()
}

/// Commit staged changes with a message.
///
/// Returns the short hash of the new commit on success.
#[tauri::command]
pub fn git_commit(message: String, root: Option<String>) -> IpcResponse {
    if message.trim().is_empty() {
        return IpcResponse::err("Commit message cannot be empty");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git commit: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git commit failed: {}", stderr.trim()));
    }

    // Get the short hash of the new commit
    let hash = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(&root)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    info!("git_commit: committed {}", hash);
    IpcResponse::ok(serde_json::json!({ "hash": hash }))
}

/// Discard changes to tracked files (checkout from HEAD).
///
/// Only works on tracked files. Errors if paths is empty.
#[tauri::command]
pub fn git_discard(paths: Vec<String>, root: Option<String>) -> IpcResponse {
    if paths.is_empty() {
        return IpcResponse::err("No paths provided to discard");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let normalized = normalize_git_paths(&paths);
    let mut args = vec!["checkout".to_string(), "--".to_string()];
    args.extend(normalized);

    let output = match std::process::Command::new("git")
        .args(&args)
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git checkout: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git checkout failed: {}", stderr.trim()));
    }

    info!("git_discard: discarded {} files", paths.len());
    IpcResponse::ok_empty()
}

/// Push commits to the remote.
#[tauri::command]
pub fn git_push(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["push"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git push: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git push failed: {}", stderr.trim()));
    }

    info!("git_push: pushed successfully");
    IpcResponse::ok_empty()
}

/// Get the staged diff (git diff --staged).
///
/// Returns the diff output capped at 32KB.
#[tauri::command]
pub fn git_diff_staged(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["diff", "--staged"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git diff --staged: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git diff --staged failed: {}", stderr.trim()));
    }

    const MAX_DIFF_SIZE: usize = 32 * 1024;
    let diff = String::from_utf8_lossy(&output.stdout);
    let diff = if diff.len() > MAX_DIFF_SIZE {
        format!("{}...\n[diff truncated at 32KB]", truncate_utf8(&diff, MAX_DIFF_SIZE))
    } else {
        diff.to_string()
    };

    IpcResponse::ok(serde_json::json!({ "diff": diff }))
}

/// Generate a commit message from staged changes using an AI provider.
///
/// Reads the staged diff and file list, finds an available AI provider from
/// config (local first, then cloud), and makes a one-shot API call.
#[tauri::command]
pub async fn generate_commit_message(root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    // Get staged diff (cap at 16KB for the prompt)
    let diff_output = match std::process::Command::new("git")
        .args(["diff", "--staged"])
        .current_dir(&root)
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return IpcResponse::err("Failed to get staged diff"),
    };

    if diff_output.trim().is_empty() {
        return IpcResponse::err("No staged changes to generate a commit message for");
    }

    const MAX_PROMPT_DIFF: usize = 16 * 1024;
    let diff_for_prompt = if diff_output.len() > MAX_PROMPT_DIFF {
        format!("{}...\n[truncated]", truncate_utf8(&diff_output, MAX_PROMPT_DIFF))
    } else {
        diff_output
    };

    // Get staged file list
    let files_output = std::process::Command::new("git")
        .args(["diff", "--staged", "--name-status"])
        .current_dir(&root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Read config to find an available AI provider
    let config = crate::commands::config::get_config_snapshot();
    let ai = &config.ai;

    // Build ordered list of candidate providers: local first (no key needed), then cloud
    let local_providers = ["ollama", "lmstudio", "jan"];
    let cloud_providers = ["openai", "gemini", "groq", "grok", "mistral", "openrouter", "deepseek"];

    // (name, endpoint, model, api_key)
    let mut candidates: Vec<(&str, String, String, Option<String>)> = Vec::new();

    for provider in &local_providers {
        if let Some(endpoint) = ai.endpoints.get(*provider) {
            if !endpoint.is_empty() {
                let model = default_commit_model(provider);
                candidates.push((provider, endpoint.clone(), model, None));
            }
        }
    }

    for provider in &cloud_providers {
        if let Some(Some(key)) = ai.api_keys.get(*provider) {
            if !key.is_empty() {
                let endpoint = ai.endpoints.get(*provider)
                    .cloned()
                    .unwrap_or_else(|| default_cloud_endpoint(provider).to_string());
                let model = default_commit_model(provider);
                candidates.push((provider, endpoint, model, Some(key.clone())));
            }
        }
    }

    if candidates.is_empty() {
        return IpcResponse::err(
            "No AI provider configured. Add an API key or start a local LLM in Settings."
        );
    }

    // Build the prompt
    let prompt = format!(
        "Generate a concise git commit message for these changes.\n\
         Use conventional commit format: type(scope): description\n\
         Types: feat, fix, refactor, docs, chore, test, style\n\
         Max 72 characters for the first line.\n\
         Return ONLY the commit message, nothing else.\n\n\
         Files changed:\n{}\n\nDiff:\n{}",
        files_output.trim(),
        diff_for_prompt.trim()
    );

    // Try each candidate provider in order, falling back on connection errors
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut last_error = String::new();

    for (name, endpoint, model, api_key) in &candidates {
        info!("generate_commit_message: trying provider '{}'", name);

        // Build the chat completions URL
        let trimmed = endpoint.trim_end_matches('/');
        let url = if trimmed.ends_with("/v1") || trimmed.ends_with("/openai") {
            format!("{}/chat/completions", trimmed)
        } else if trimmed.contains("/v1/") || trimmed.ends_with("/chat/completions") {
            trimmed.to_string()
        } else {
            format!("{}/v1/chat/completions", trimmed)
        };

        let mut request = client.post(&url)
            .header("Content-Type", "application/json");

        if let Some(key) = api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": prompt }],
            "max_tokens": 200,
            "temperature": 0.3,
        });

        let response = match request.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                warn!("generate_commit_message: provider '{}' failed to connect: {}", name, e);
                last_error = format!("{}: {}", name, e);
                continue; // Try next provider
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            warn!("generate_commit_message: provider '{}' returned {}: {}", name, status, body_text);
            last_error = format!("{} returned {}", name, status);
            continue; // Try next provider
        }

        let json: serde_json::Value = match response.json().await {
            Ok(j) => j,
            Err(e) => {
                warn!("generate_commit_message: provider '{}' returned invalid JSON: {}", name, e);
                last_error = format!("{}: invalid response", name);
                continue;
            }
        };

        let message = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .trim()
            .trim_matches('`')
            .trim()
            .to_string();

        if message.is_empty() {
            warn!("generate_commit_message: provider '{}' returned empty message", name);
            last_error = format!("{}: empty response", name);
            continue;
        }

        info!("generate_commit_message: provider '{}' generated '{}'", name, message);
        return IpcResponse::ok(serde_json::json!({ "message": message }));
    }

    // All providers failed
    IpcResponse::err(format!(
        "All AI providers failed. Last error: {}. Check Settings to verify your API keys or start a local LLM.",
        last_error
    ))
}

/// Default model for commit message generation per provider.
fn default_commit_model(provider: &str) -> String {
    match provider {
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.3-70b-versatile".to_string(),
        "grok" => "grok-2".to_string(),
        "mistral" => "mistral-small-latest".to_string(),
        "openrouter" => "anthropic/claude-3.5-haiku".to_string(),
        "deepseek" => "deepseek-chat".to_string(),
        // Local providers: empty string uses whatever is loaded
        _ => String::new(),
    }
}

/// Default cloud endpoint for commit message generation.
fn default_cloud_endpoint(provider: &str) -> &'static str {
    match provider {
        "openai" => "https://api.openai.com/v1",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai",
        "groq" => "https://api.groq.com/openai/v1",
        "grok" => "https://api.x.ai/v1",
        "mistral" => "https://api.mistral.ai/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "deepseek" => "https://api.deepseek.com/v1",
        _ => "http://127.0.0.1:11434",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_search_regex_literal() {
        let re = build_search_regex("hello", false, false, false).unwrap();
        assert!(re.is_match("say Hello world"));
        assert!(re.is_match("say hello world"));
    }

    #[test]
    fn test_build_search_regex_case_sensitive() {
        let re = build_search_regex("Hello", true, false, false).unwrap();
        assert!(re.is_match("say Hello world"));
        assert!(!re.is_match("say hello world"));
    }

    #[test]
    fn test_build_search_regex_whole_word() {
        let re = build_search_regex("test", false, false, true).unwrap();
        assert!(re.is_match("run test now"));
        assert!(!re.is_match("testing123"));
    }

    #[test]
    fn test_build_search_regex_regex_mode() {
        let re = build_search_regex(r"fn\s+\w+", false, true, false).unwrap();
        assert!(re.is_match("fn main() {"));
        assert!(!re.is_match("function main"));
    }

    #[test]
    fn test_build_search_regex_invalid() {
        let result = build_search_regex("[invalid", false, true, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid regex"));
    }

    #[test]
    fn test_build_search_regex_special_chars_escaped() {
        // In literal mode, regex special chars should be escaped
        let re = build_search_regex("foo.bar()", false, false, false).unwrap();
        assert!(re.is_match("foo.bar()"));
        assert!(!re.is_match("fooXbar!!"));
    }

    #[test]
    fn test_matches_glob_extension() {
        assert!(matches_glob_list("src/main.rs", "*.rs"));
        assert!(matches_glob_list("src/lib/utils.js", "*.js,*.ts"));
        assert!(!matches_glob_list("src/main.rs", "*.js"));
    }

    #[test]
    fn test_matches_glob_directory() {
        assert!(matches_glob_list("node_modules/foo/bar.js", "node_modules"));
        assert!(matches_glob_list("src/lib/test.js", "src/**"));
        assert!(!matches_glob_list("other/test.js", "src/**"));
    }

    #[test]
    fn test_matches_glob_empty() {
        assert!(!matches_glob_list("anything.rs", ""));
        assert!(!matches_glob_list("anything.rs", "  , ,"));
    }

    // ============ Git command validation tests ============

    #[test]
    fn test_git_stage_empty_paths_returns_error() {
        let result = git_stage(vec![], None);
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("No paths provided"));
    }

    #[test]
    fn test_git_unstage_empty_paths_returns_error() {
        let result = git_unstage(vec![], None);
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("No paths provided"));
    }

    #[test]
    fn test_git_discard_empty_paths_returns_error() {
        let result = git_discard(vec![], None);
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("No paths provided"));
    }

    #[test]
    fn test_git_commit_empty_message_returns_error() {
        let result = git_commit("".to_string(), None);
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("empty"));
    }

    #[test]
    fn test_git_commit_whitespace_message_returns_error() {
        let result = git_commit("   ".to_string(), None);
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("empty"));
    }

    #[test]
    fn test_normalize_git_paths() {
        let paths = vec!["src\\lib\\api.js".to_string(), "src/main.rs".to_string()];
        let normalized = normalize_git_paths(&paths);
        assert_eq!(normalized, vec!["src/lib/api.js", "src/main.rs"]);
    }

    #[test]
    fn test_default_commit_model() {
        assert_eq!(default_commit_model("openai"), "gpt-4o-mini");
        assert_eq!(default_commit_model("gemini"), "gemini-2.0-flash");
        assert_eq!(default_commit_model("groq"), "llama-3.3-70b-versatile");
        assert_eq!(default_commit_model("ollama"), "");
        assert_eq!(default_commit_model("unknown"), "");
    }

    #[test]
    fn test_default_cloud_endpoint() {
        assert_eq!(default_cloud_endpoint("openai"), "https://api.openai.com/v1");
        assert_eq!(default_cloud_endpoint("deepseek"), "https://api.deepseek.com/v1");
        assert_eq!(default_cloud_endpoint("unknown"), "http://127.0.0.1:11434");
    }

    #[test]
    fn test_truncate_utf8_ascii() {
        let s = "hello world";
        assert_eq!(truncate_utf8(s, 5), "hello");
        assert_eq!(truncate_utf8(s, 100), s);
    }

    #[test]
    fn test_truncate_utf8_multibyte() {
        // Each emoji is 4 bytes
        let s = "ab\u{1F600}cd"; // "ab😀cd" — 8 bytes total
        assert_eq!(truncate_utf8(s, 3), "ab"); // 3 is mid-emoji, snap back to 2
        assert_eq!(truncate_utf8(s, 6), "ab\u{1F600}"); // 6 = after emoji (2+4)
    }
}
