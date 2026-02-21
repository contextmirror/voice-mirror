use super::IpcResponse;
use crate::util::find_project_root;
use tracing::{info, warn};

/// List the contents of a directory within the project root.
///
/// If `path` is None, lists the project root. Otherwise, lists the subdirectory
/// relative to the project root. Returns entries sorted: directories first, then
/// files, alphabetical within each group.
#[tauri::command]
pub fn list_directory(path: Option<String>) -> IpcResponse {
    let root = match find_project_root() {
        Some(r) => r,
        None => return IpcResponse::err("Could not find project root"),
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
#[tauri::command]
pub fn get_git_changes() -> IpcResponse {
    let root = match find_project_root() {
        Some(r) => r,
        None => return IpcResponse::err("Could not find project root"),
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
        let path_part = line[3..].trim();

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
        } else {
            path_part
        };

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
