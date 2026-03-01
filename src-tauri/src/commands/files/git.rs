use super::super::IpcResponse;
use super::{resolve_root, normalize_git_paths};
use crate::util::find_project_root;
use std::path::PathBuf;
use tracing::{debug, info};

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

    debug!("get_git_changes: {} changes", changes.len());
    IpcResponse::ok(serde_json::json!({ "changes": changes, "branch": branch }))
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

/// Get ahead/behind counts relative to the upstream tracking branch.
///
/// Returns `{ ahead: N, behind: N, hasUpstream: bool }`.
/// If no upstream is configured, returns zeros with `hasUpstream: false`.
#[tauri::command]
pub fn git_ahead_behind(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["rev-list", "--count", "--left-right", "@{upstream}...HEAD"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(_) => {
            return IpcResponse::ok(serde_json::json!({ "ahead": 0, "behind": 0, "hasUpstream": false }));
        }
    };

    if !output.status.success() {
        // No upstream configured or other error
        return IpcResponse::ok(serde_json::json!({ "ahead": 0, "behind": 0, "hasUpstream": false }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Output format: "BEHIND\tAHEAD"
    let parts: Vec<&str> = stdout.split('\t').collect();
    let behind = parts.first().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let ahead = parts.get(1).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);

    IpcResponse::ok(serde_json::json!({ "ahead": ahead, "behind": behind, "hasUpstream": true }))
}

/// Fetch from the remote.
#[tauri::command]
pub fn git_fetch(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["fetch"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git fetch: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git fetch failed: {}", stderr.trim()));
    }

    info!("git_fetch: fetched successfully");
    IpcResponse::ok_empty()
}

/// Pull changes from the remote.
///
/// When `rebase` is true, uses `git pull --rebase` instead of merge.
#[tauri::command]
pub fn git_pull(rebase: Option<bool>, root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let mut args = vec!["pull"];
    if rebase.unwrap_or(false) {
        args.push("--rebase");
    }

    let output = match std::process::Command::new("git")
        .args(&args)
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git pull: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git pull failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    info!("git_pull: pulled successfully (rebase={})", rebase.unwrap_or(false));
    IpcResponse::ok(serde_json::json!({ "message": stdout }))
}

/// Force-push commits to the remote.
#[tauri::command]
pub fn git_force_push(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["push", "--force"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git push --force: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git push --force failed: {}", stderr.trim()));
    }

    info!("git_force_push: force-pushed successfully");
    IpcResponse::ok_empty()
}

/// List all branches (local and remote).
///
/// Returns `{ branches: [{ name, isCurrent, isRemote }], current: "branch-name" }`.
/// Sorted: current branch first, then local branches, then remote branches.
#[tauri::command]
pub fn git_list_branches(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    // Get current branch
    let current = std::process::Command::new("git")
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
        })
        .unwrap_or_default();

    // Get local branches
    let local_output = std::process::Command::new("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&root)
        .output();

    let mut branches: Vec<serde_json::Value> = Vec::new();

    if let Ok(output) = &local_output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim();
                if name.is_empty() { continue; }
                branches.push(serde_json::json!({
                    "name": name,
                    "isCurrent": name == current,
                    "isRemote": false,
                }));
            }
        }
    }

    // Get remote branches
    let remote_output = std::process::Command::new("git")
        .args(["branch", "-r", "--format=%(refname:short)"])
        .current_dir(&root)
        .output();

    if let Ok(output) = &remote_output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim();
                if name.is_empty() || name.contains("HEAD") { continue; }
                // Skip remotes that have a local tracking branch with same short name
                let short = name.split('/').skip(1).collect::<Vec<_>>().join("/");
                if branches.iter().any(|b| b["name"].as_str() == Some(&short)) {
                    continue;
                }
                branches.push(serde_json::json!({
                    "name": name,
                    "isCurrent": false,
                    "isRemote": true,
                }));
            }
        }
    }

    // Sort: current first, then local, then remote
    branches.sort_by(|a, b| {
        let a_current = a["isCurrent"].as_bool().unwrap_or(false);
        let b_current = b["isCurrent"].as_bool().unwrap_or(false);
        let a_remote = a["isRemote"].as_bool().unwrap_or(false);
        let b_remote = b["isRemote"].as_bool().unwrap_or(false);
        b_current.cmp(&a_current)
            .then(a_remote.cmp(&b_remote))
    });

    info!("git_list_branches: {} branches (current={})", branches.len(), current);
    IpcResponse::ok(serde_json::json!({ "branches": branches, "current": current }))
}

/// Switch to a different git branch.
///
/// Runs `git checkout <branch_name>`. For remote branches like `origin/feature`,
/// git will auto-create a local tracking branch.
#[tauri::command]
pub fn git_checkout_branch(branch: String, root: Option<String>) -> IpcResponse {
    if branch.trim().is_empty() {
        return IpcResponse::err("Branch name cannot be empty");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["checkout", branch.trim()])
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

    info!("git_checkout_branch: switched to {}", branch.trim());
    IpcResponse::ok(serde_json::json!({ "branch": branch.trim() }))
}

/// Stash working directory changes.
///
/// Runs `git stash push -m "{message}"`. If no message is provided,
/// git generates an automatic description.
#[tauri::command]
pub fn git_stash_save(message: Option<String>, root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let mut args = vec!["stash", "push"];
    let msg;
    if let Some(ref m) = message {
        if !m.trim().is_empty() {
            msg = m.clone();
            args.push("-m");
            args.push(&msg);
        }
    }

    let output = match std::process::Command::new("git")
        .args(&args)
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git stash push: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git stash push failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    info!("git_stash_save: {}", stdout);
    IpcResponse::ok(serde_json::json!({ "message": stdout }))
}

/// List all stashes.
///
/// Runs `git stash list` and parses output into structured data.
/// Each stash entry has: `index` (number), `branch` (string), `message` (string).
#[tauri::command]
pub fn git_stash_list(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let output = match std::process::Command::new("git")
        .args(["stash", "list"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git stash list: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git stash list failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut stashes: Vec<serde_json::Value> = Vec::new();

    for line in stdout.lines() {
        // Format: "stash@{0}: On branch: message" or "stash@{0}: WIP on branch: hash message"
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Parse index from "stash@{N}"
        let index = line
            .find('{')
            .and_then(|start| {
                line[start + 1..].find('}').map(|end| &line[start + 1..start + 1 + end])
            })
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);

        // Parse branch and message from the rest
        // "stash@{0}: On branch_name: message text"
        // "stash@{0}: WIP on branch_name: hash message text"
        let after_colon = line.find(": ").map(|i| &line[i + 2..]).unwrap_or("");
        let (branch, message) = if after_colon.starts_with("On ") {
            let rest = &after_colon[3..];
            if let Some(colon_pos) = rest.find(": ") {
                (rest[..colon_pos].to_string(), rest[colon_pos + 2..].to_string())
            } else {
                (rest.to_string(), String::new())
            }
        } else if after_colon.starts_with("WIP on ") {
            let rest = &after_colon[7..];
            if let Some(colon_pos) = rest.find(": ") {
                (rest[..colon_pos].to_string(), rest[colon_pos + 2..].to_string())
            } else {
                (rest.to_string(), String::new())
            }
        } else {
            (String::new(), after_colon.to_string())
        };

        stashes.push(serde_json::json!({
            "index": index,
            "branch": branch,
            "message": message,
        }));
    }

    debug!("git_stash_list: {} stashes", stashes.len());
    IpcResponse::ok(serde_json::json!({ "stashes": stashes }))
}

/// Pop a stash entry (apply + remove).
///
/// Runs `git stash pop stash@{index}`. Defaults to index 0 if not specified.
#[tauri::command]
pub fn git_stash_pop(index: Option<u32>, root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let stash_ref = format!("stash@{{{}}}", index.unwrap_or(0));
    let output = match std::process::Command::new("git")
        .args(["stash", "pop", &stash_ref])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git stash pop: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git stash pop failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    info!("git_stash_pop: popped {}", stash_ref);
    IpcResponse::ok(serde_json::json!({ "message": stdout }))
}

/// Apply a stash entry without removing it.
///
/// Runs `git stash apply stash@{index}`. Defaults to index 0 if not specified.
#[tauri::command]
pub fn git_stash_apply(index: Option<u32>, root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let stash_ref = format!("stash@{{{}}}", index.unwrap_or(0));
    let output = match std::process::Command::new("git")
        .args(["stash", "apply", &stash_ref])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git stash apply: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git stash apply failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    info!("git_stash_apply: applied {}", stash_ref);
    IpcResponse::ok(serde_json::json!({ "message": stdout }))
}

/// Drop (delete) a stash entry.
///
/// Runs `git stash drop stash@{index}`.
#[tauri::command]
pub fn git_stash_drop(index: u32, root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let stash_ref = format!("stash@{{{}}}", index);
    let output = match std::process::Command::new("git")
        .args(["stash", "drop", &stash_ref])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git stash drop: {}", e)),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git stash drop failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    info!("git_stash_drop: dropped {}", stash_ref);
    IpcResponse::ok(serde_json::json!({ "message": stdout }))
}

#[cfg(test)]
mod tests {
    use super::*;

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

}
