use super::super::IpcResponse;
use super::{resolve_root, normalize_git_paths, truncate_utf8};
use crate::util::find_project_root;
use std::path::PathBuf;
use tracing::info;

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
