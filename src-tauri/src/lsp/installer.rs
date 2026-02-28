//! installer.rs -- Download and install LSP servers via npm.
//!
//! Handles Node.js detection, npm install with security flags,
//! lock-file based concurrency control, and Tauri event emission.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use tauri::Emitter;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

/// In-process mutex to prevent concurrent install_server calls (TOCTOU guard for file lock).
static INSTALL_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Result of Node.js detection.
#[derive(Debug, Clone, serde::Serialize)]
pub struct NodeStatus {
    pub available: bool,
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub node_path: Option<PathBuf>,
    pub npm_path: Option<PathBuf>,
}

/// Get the lsp-servers directory under app data.
pub fn get_lsp_servers_dir() -> Result<PathBuf, String> {
    let app_data =
        dirs::config_dir().ok_or_else(|| "Could not determine app data directory".to_string())?;
    let dir = app_data.join("voice-mirror").join("lsp-servers");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create lsp-servers directory: {}", e))?;
    }
    Ok(dir)
}

/// Detect whether Node.js and npm are available on PATH.
pub fn detect_node() -> NodeStatus {
    let node_path = which::which("node").ok();
    let npm_path = which::which("npm").ok();

    let node_version = node_path.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    });

    let npm_version = npm_path.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    });

    let available = node_path.is_some() && npm_path.is_some();

    if !available {
        warn!("Node.js or npm not found on PATH. LSP server auto-install unavailable.");
    } else {
        info!(
            "Node.js detected: node={} npm={}",
            node_version.as_deref().unwrap_or("unknown"),
            npm_version.as_deref().unwrap_or("unknown")
        );
    }

    NodeStatus {
        available,
        node_version,
        npm_version,
        node_path,
        npm_path,
    }
}

/// Acquire the install lock. Returns a guard that releases on drop.
/// Returns None if another install is already in progress.
fn acquire_install_lock(lsp_dir: &Path) -> Option<InstallLockGuard> {
    let lock_path = lsp_dir.join("install.lock");
    if lock_path.exists() {
        // Check if lock is stale (older than 5 minutes)
        if let Ok(metadata) = fs::metadata(&lock_path) {
            if let Ok(modified) = metadata.modified() {
                if modified.elapsed().unwrap_or_default().as_secs() > 300 {
                    // Stale lock -- remove and proceed
                    let _ = fs::remove_file(&lock_path);
                } else {
                    return None; // Active lock
                }
            }
        }
    }
    // Create lock file
    if fs::write(&lock_path, std::process::id().to_string()).is_ok() {
        Some(InstallLockGuard { lock_path })
    } else {
        None
    }
}

struct InstallLockGuard {
    lock_path: PathBuf,
}

impl Drop for InstallLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock_path);
    }
}

/// Install an LSP server's npm packages into the managed directory.
///
/// Uses `npm install --ignore-scripts --prefix <dir> <packages>` for security.
/// Returns Ok(()) on success or Err with a message on failure.
pub async fn install_server(
    server_id: &str,
    packages: &[String],
    version: &str,
    lsp_dir: &Path,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    // Emit installing status
    if let Some(app) = app_handle {
        let _ = app.emit(
            "lsp-install-status",
            serde_json::json!({
                "server": server_id,
                "status": "installing",
                "message": format!("Installing {}...", server_id)
            }),
        );
    }

    info!(
        "Installing LSP server '{}': packages={:?}",
        server_id, packages
    );

    // Acquire in-process mutex first, then file lock (dual-layer concurrency control)
    let _mutex_guard = INSTALL_MUTEX.lock().await;
    let _lock = acquire_install_lock(lsp_dir)
        .ok_or_else(|| "Another LSP server install is in progress".to_string())?;

    // Ensure package.json exists (npm requires it)
    let pkg_json = lsp_dir.join("package.json");
    if !pkg_json.exists() {
        fs::write(
            &pkg_json,
            r#"{"name":"voice-mirror-lsp-servers","private":true}"#,
        )
        .map_err(|e| format!("Failed to create package.json: {}", e))?;
    }

    // Build npm install command
    let npm_cmd = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let mut args = vec![
        "install".to_string(),
        "--ignore-scripts".to_string(),
        "--prefix".to_string(),
        lsp_dir.to_string_lossy().to_string(),
    ];

    // Add packages with version constraint.
    // Version pin applies only to the primary package (packages[0]).
    // Peer dependencies (e.g., typescript SDK) install at their latest compatible version.
    for pkg in packages {
        if !version.is_empty() && pkg == &packages[0] {
            args.push(format!("{}@{}", pkg, version));
        } else {
            args.push(pkg.clone());
        }
    }

    // Run npm install
    let output = tokio::process::Command::new(npm_cmd)
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("npm install failed for '{}': {}", server_id, stderr);

        if let Some(app) = app_handle {
            let _ = app.emit(
                "lsp-install-status",
                serde_json::json!({
                    "server": server_id,
                    "status": "install_failed",
                    "message": format!("Failed to install {}", server_id)
                }),
            );
        }

        return Err(format!("npm install failed: {}", stderr));
    }

    info!("Successfully installed LSP server '{}'", server_id);

    if let Some(app) = app_handle {
        let _ = app.emit(
            "lsp-install-status",
            serde_json::json!({
                "server": server_id,
                "status": "installed",
                "message": format!("{} installed successfully", server_id)
            }),
        );
    }

    Ok(())
}

/// Check if a server's packages are already installed.
pub fn is_server_installed(command: &str, lsp_dir: &Path) -> bool {
    let bin_dir = lsp_dir.join("node_modules").join(".bin");
    let bin_path = bin_dir.join(command);

    if bin_path.exists() {
        return true;
    }

    #[cfg(windows)]
    {
        let cmd_path = bin_dir.join(format!("{}.cmd", command));
        if cmd_path.exists() {
            return true;
        }
    }

    false
}
