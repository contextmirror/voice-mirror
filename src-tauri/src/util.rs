use std::path::PathBuf;
use tracing::{info, warn};

/// Check if a directory looks like the Voice Mirror project root.
pub fn is_project_root(path: &std::path::Path) -> bool {
    path.join("src-tauri").join("tauri.conf.json").exists()
}

/// Resolve the Voice Mirror project root directory.
///
/// Search order:
/// 1. `VOICE_MIRROR_ROOT` env var (explicit override — always wins)
/// 2. Walk up from executable path (works in dev: target/debug → project root)
/// 3. Walk up from current working directory
/// 4. Common dev path: walk up from exe looking for `package.json` with "voice-mirror"
///
/// Validates by checking for `src-tauri/tauri.conf.json`.
pub fn find_project_root() -> Option<PathBuf> {
    // 1. Explicit env var override
    if let Ok(root) = std::env::var("VOICE_MIRROR_ROOT") {
        let path = PathBuf::from(&root);
        if is_project_root(&path) {
            info!("Project root from VOICE_MIRROR_ROOT: {}", path.display());
            return Some(path);
        }
        warn!(
            "VOICE_MIRROR_ROOT={} does not contain src-tauri/tauri.conf.json",
            root
        );
    }

    // 2. Walk up from executable path (dev: target/debug/release, up to 8 levels)
    if let Ok(exe) = std::env::current_exe() {
        let mut path = exe.clone();
        for _ in 0..8 {
            if !path.pop() {
                break;
            }
            if is_project_root(&path) {
                info!("Project root from exe walk-up: {}", path.display());
                return Some(path);
            }
        }
    }

    // 3. Walk up from current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.clone();
        for _ in 0..4 {
            if is_project_root(&path) {
                info!("Project root from cwd walk-up: {}", path.display());
                return Some(path);
            }
            if !path.pop() {
                break;
            }
        }
    }

    warn!(
        "Could not find project root (src-tauri/tauri.conf.json). \
         MCP tools will NOT be available. Set VOICE_MIRROR_ROOT env var \
         or run from the project directory."
    );
    None
}
