use super::super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use tracing::{info, warn};

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
