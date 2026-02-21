//! File system watcher service for live file tree updates.
//!
//! Watches a project root recursively for filesystem changes and emits
//! Tauri events (`fs-tree-changed`, `fs-git-changed`) so the frontend
//! FileTree component can refresh affected directories.
//!
//! Follows the same lifecycle pattern as `inbox_watcher.rs`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info, warn};

use crate::commands::IpcResponse;

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/// Emitted when directories in the project tree have changed.
#[derive(Debug, Clone, Serialize)]
pub struct FsTreeChanged {
    /// Directory paths (relative to project root) that need refreshing.
    pub directories: Vec<String>,
    /// `true` when a file was created/deleted at the project root level.
    pub root: bool,
}

/// Emitted when individual files change (for live editor sync).
#[derive(Debug, Clone, Serialize)]
pub struct FsFileChanged {
    /// File paths (relative to project root) that were modified.
    pub files: Vec<String>,
}

/// Emitted when `.git/index` is modified (git add, commit, checkout, etc.).
#[derive(Debug, Clone, Serialize)]
pub struct FsGitChanged {
    /// Unix timestamp (seconds) when the change was detected.
    pub timestamp: u64,
}

// ---------------------------------------------------------------------------
// Watcher handle + managed state
// ---------------------------------------------------------------------------

/// Handle for controlling the file watcher lifecycle.
pub struct FileWatcherHandle {
    /// Set to `false` to signal the processing thread to stop.
    running: Arc<Mutex<bool>>,
    /// The notify watcher (kept alive to maintain the OS watch).
    _watcher: Option<RecommendedWatcher>,
}

impl FileWatcherHandle {
    /// Check if the watcher is still running.
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Stop the watcher and drop the OS handle.
    pub fn stop(&mut self) {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        *running = false;
        self._watcher = None;
        info!("File watcher stopped");
    }
}

/// Managed Tauri state for the file watcher.
pub struct FileWatcherState {
    pub handle: Mutex<Option<FileWatcherHandle>>,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Directories that produce high-churn events and should always be skipped.
const SKIP_SEGMENTS: &[&str] = &["node_modules", ".git/objects", "target/debug", "target/release"];

/// Returns `true` if the path contains any of the high-churn directory segments.
fn is_high_churn(path: &Path) -> bool {
    let s = path.to_string_lossy();
    // Normalise Windows backslashes for comparison
    let normalised = s.replace('\\', "/");
    SKIP_SEGMENTS.iter().any(|seg| normalised.contains(seg))
}

/// Build a gitignore matcher from the project root's `.gitignore`.
fn build_gitignore(project_root: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(project_root);
    let gitignore_path = project_root.join(".gitignore");
    if gitignore_path.exists() {
        builder.add(&gitignore_path);
    }
    builder.build().unwrap_or_else(|e| {
        warn!("Failed to build gitignore matcher: {}", e);
        Gitignore::empty()
    })
}

/// Check whether a path is the `.git/index` file.
fn is_git_index(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let normalised = s.replace('\\', "/");
    normalised.ends_with(".git/index")
}

/// Check whether a path is a `.gitignore` file.
fn is_gitignore_file(path: &Path) -> bool {
    path.file_name()
        .map(|f| f == ".gitignore")
        .unwrap_or(false)
}

/// Check whether a path is inside the `.git` directory.
fn is_inside_dot_git(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let normalised = s.replace('\\', "/");
    normalised.contains("/.git/")
}

// ---------------------------------------------------------------------------
// Core: start_watching
// ---------------------------------------------------------------------------

/// Start watching `project_root` for filesystem changes.
///
/// Returns a `FileWatcherHandle` to control the lifecycle.
pub fn start_watching(
    project_root: String,
    app_handle: AppHandle,
) -> Result<FileWatcherHandle, String> {
    // Canonicalize to resolve symlinks / relative segments
    let root = std::fs::canonicalize(&project_root)
        .map_err(|e| format!("Failed to canonicalize project root '{}': {}", project_root, e))?;

    info!("Starting file watcher on {:?}", root);

    // Build gitignore matcher (wrapped in Arc<Mutex> so the thread can rebuild it)
    let gitignore = Arc::new(Mutex::new(build_gitignore(&root)));

    let running = Arc::new(Mutex::new(true));

    // Channel for funnelling notify events to the processing thread
    let (tx, rx) = std::sync::mpsc::channel::<Vec<PathBuf>>();

    // Create the OS file watcher
    let tx_clone = tx.clone();
    let watcher_result =
        notify::recommended_watcher(move |res: Result<Event, notify::Error>| match res {
            Ok(event) => {
                let dominated = matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                );
                if !dominated {
                    return;
                }
                if !event.paths.is_empty() {
                    let _ = tx_clone.send(event.paths);
                }
            }
            Err(e) => {
                error!("File watcher error: {}", e);
            }
        });

    let mut watcher =
        watcher_result.map_err(|e| format!("Failed to create file watcher: {}", e))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch project root: {}", e))?;

    // Spawn debounce + processing thread
    let running_clone = Arc::clone(&running);
    let gitignore_clone = Arc::clone(&gitignore);
    let root_clone = root.clone();

    std::thread::Builder::new()
        .name("file-watcher".into())
        .spawn(move || {
            info!("File watcher thread started for {:?}", root_clone);

            loop {
                // Block until the first event arrives (with timeout for shutdown check)
                let first_paths = match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                    Ok(paths) => paths,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        // Check if we should stop
                        let is_running = *running_clone
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        if !is_running {
                            info!("File watcher stopping (running=false)");
                            break;
                        }
                        continue;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        info!("File watcher channel disconnected, stopping");
                        break;
                    }
                };

                // Coalescing window: collect burst events
                std::thread::sleep(std::time::Duration::from_millis(150));

                // Collect all paths into a HashSet for deduplication
                let mut all_paths: HashSet<PathBuf> = HashSet::new();
                for p in first_paths {
                    all_paths.insert(p);
                }
                while let Ok(paths) = rx.try_recv() {
                    for p in paths {
                        all_paths.insert(p);
                    }
                }

                // Check running flag after waking up
                let is_running = *running_clone
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if !is_running {
                    info!("File watcher stopping (running=false)");
                    break;
                }

                // Track whether we need to rebuild gitignore
                let mut gitignore_changed = false;
                let mut git_index_changed = false;
                let mut affected_dirs: HashSet<String> = HashSet::new();
                let mut affected_files: Vec<String> = Vec::new();
                let mut root_changed = false;

                // Get a snapshot of the gitignore matcher
                let gi = gitignore_clone
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();

                for path in &all_paths {
                    // Skip high-churn directories
                    if is_high_churn(path) {
                        continue;
                    }

                    // Detect .gitignore changes
                    if is_gitignore_file(path) {
                        gitignore_changed = true;
                        // Still process this path (it's a real file change)
                    }

                    // Detect .git/index changes (git status changes)
                    if is_git_index(path) {
                        git_index_changed = true;
                        continue; // Don't emit tree-changed for .git/index
                    }

                    // Skip other .git internal files (except .git/index handled above)
                    if is_inside_dot_git(path) {
                        continue;
                    }

                    // Apply gitignore filter
                    let is_dir = path.is_dir();
                    if gi.matched(path, is_dir).is_ignore() {
                        continue;
                    }

                    // Compute file path relative to project root (for editor sync)
                    if let Ok(file_rel) = path.strip_prefix(&root_clone) {
                        let file_rel_str = file_rel.to_string_lossy().replace('\\', "/");
                        if !file_rel_str.is_empty() {
                            affected_files.push(file_rel_str);
                        }
                    }

                    // Compute parent directory relative to project root
                    let parent = path.parent().unwrap_or(path);
                    match parent.strip_prefix(&root_clone) {
                        Ok(rel) => {
                            let rel_str = rel.to_string_lossy().replace('\\', "/");
                            if rel_str.is_empty() {
                                root_changed = true;
                            } else {
                                affected_dirs.insert(rel_str);
                            }
                        }
                        Err(_) => {
                            // Path is outside project root (shouldn't happen)
                            debug!("Path outside project root: {:?}", path);
                        }
                    }
                }

                // Rebuild gitignore matcher if .gitignore changed
                if gitignore_changed {
                    let new_gi = build_gitignore(&root_clone);
                    let mut gi_lock = gitignore_clone
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    *gi_lock = new_gi;
                    info!("Rebuilt gitignore matcher after .gitignore change");
                }

                // Emit fs-tree-changed if any directories were affected
                if !affected_dirs.is_empty() || root_changed {
                    let dirs: Vec<String> = affected_dirs.into_iter().collect();
                    let payload = FsTreeChanged {
                        directories: dirs,
                        root: root_changed,
                    };
                    debug!("Emitting fs-tree-changed: {:?}", payload);
                    if let Err(e) = app_handle.emit("fs-tree-changed", &payload) {
                        warn!("Failed to emit fs-tree-changed: {}", e);
                    }
                }

                // Emit fs-file-changed for live editor sync
                if !affected_files.is_empty() {
                    let payload = FsFileChanged {
                        files: affected_files,
                    };
                    debug!("Emitting fs-file-changed: {:?}", payload);
                    if let Err(e) = app_handle.emit("fs-file-changed", &payload) {
                        warn!("Failed to emit fs-file-changed: {}", e);
                    }
                }

                // Emit fs-git-changed if .git/index was modified
                if git_index_changed {
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    let payload = FsGitChanged { timestamp };
                    debug!("Emitting fs-git-changed: {:?}", payload);
                    if let Err(e) = app_handle.emit("fs-git-changed", &payload) {
                        warn!("Failed to emit fs-git-changed: {}", e);
                    }
                }
            }

            info!("File watcher thread exited");
        })
        .map_err(|e| format!("Failed to spawn file watcher thread: {}", e))?;

    info!("File watcher started, watching {:?}", root);

    Ok(FileWatcherHandle {
        running,
        _watcher: Some(watcher),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start watching a project directory for filesystem changes.
///
/// Stops any existing watcher before starting a new one.
#[tauri::command]
pub fn start_file_watching(
    project_root: String,
    state: State<FileWatcherState>,
    app: AppHandle,
) -> IpcResponse {
    // Stop existing watcher if running
    {
        let mut handle_guard = state
            .handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut h) = *handle_guard {
            if h.is_running() {
                h.stop();
            }
        }
        *handle_guard = None;
    }

    match start_watching(project_root, app) {
        Ok(handle) => {
            let mut handle_guard = state
                .handle
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *handle_guard = Some(handle);
            IpcResponse::ok_empty()
        }
        Err(e) => {
            error!("Failed to start file watcher: {}", e);
            IpcResponse::err(e)
        }
    }
}

/// Stop watching the current project directory.
#[tauri::command]
pub fn stop_file_watching(state: State<FileWatcherState>) -> IpcResponse {
    let mut handle_guard = state
        .handle
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if let Some(ref mut h) = *handle_guard {
        h.stop();
    }
    *handle_guard = None;

    IpcResponse::ok_empty()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_high_churn() {
        assert!(is_high_churn(Path::new("/project/node_modules/foo/bar.js")));
        assert!(is_high_churn(Path::new("/project/.git/objects/ab/cd1234")));
        assert!(is_high_churn(Path::new("/project/target/debug/build/something")));
        assert!(is_high_churn(Path::new("/project/target/release/voice-mirror")));
        assert!(!is_high_churn(Path::new("/project/src/main.rs")));
        assert!(!is_high_churn(Path::new("/project/.gitignore")));
    }

    #[test]
    fn test_is_high_churn_windows_paths() {
        assert!(is_high_churn(Path::new("C:\\project\\node_modules\\foo\\bar.js")));
        assert!(is_high_churn(Path::new("C:\\project\\.git\\objects\\ab\\cd")));
        assert!(!is_high_churn(Path::new("C:\\project\\src\\main.rs")));
    }

    #[test]
    fn test_is_git_index() {
        assert!(is_git_index(Path::new("/project/.git/index")));
        assert!(is_git_index(Path::new("C:\\project\\.git\\index")));
        assert!(!is_git_index(Path::new("/project/.git/config")));
        assert!(!is_git_index(Path::new("/project/index.html")));
    }

    #[test]
    fn test_is_gitignore_file() {
        assert!(is_gitignore_file(Path::new("/project/.gitignore")));
        assert!(is_gitignore_file(Path::new("/project/src/.gitignore")));
        assert!(!is_gitignore_file(Path::new("/project/.git/config")));
        assert!(!is_gitignore_file(Path::new("/project/src/main.rs")));
    }

    #[test]
    fn test_is_inside_dot_git() {
        assert!(is_inside_dot_git(Path::new("/project/.git/refs/heads/main")));
        assert!(is_inside_dot_git(Path::new("/project/.git/config")));
        assert!(!is_inside_dot_git(Path::new("/project/src/main.rs")));
        assert!(!is_inside_dot_git(Path::new("/project/.gitignore")));
    }

    #[test]
    fn test_build_gitignore_missing_file() {
        // Should not panic even when .gitignore doesn't exist
        let gi = build_gitignore(Path::new("/nonexistent/project"));
        // Should not match anything (empty matcher)
        assert!(!gi.matched("src/main.rs", false).is_ignore());
    }
}
