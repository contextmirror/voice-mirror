//! Tauri commands for dev server detection, port probing, and process management.
//!
//! Provides three commands:
//! - `detect_dev_servers`: Scan a project directory for dev server configurations
//! - `probe_port`: Check if a specific port is accepting connections
//! - `kill_port_process`: Kill the process listening on a specific port

use super::IpcResponse;
use crate::services::dev_server;

/// Scan a project directory and return all detected dev server configurations.
///
/// Checks tauri.conf.json, vite.config.*, .env files, and package.json scripts
/// for known framework patterns (Vite, Next.js, CRA, Angular, SvelteKit, Tauri).
/// Also probes each detected port to see if a server is currently running.
#[tauri::command]
pub fn detect_dev_servers(project_root: String) -> IpcResponse {
    let servers = dev_server::detect_dev_servers(&project_root);
    let pkg_manager = dev_server::detect_package_manager(&project_root);

    tracing::info!(
        "[dev-server] detect_dev_servers root={} found={} pkg_manager={}",
        project_root,
        servers.len(),
        pkg_manager
    );
    for s in &servers {
        tracing::info!(
            "[dev-server]   {} :{} running={} source={}",
            s.framework, s.port, s.running, s.source
        );
    }

    IpcResponse::ok(serde_json::json!({
        "servers": servers,
        "packageManager": pkg_manager,
    }))
}

/// Check if a specific port is accepting TCP connections on localhost.
///
/// Returns `{ listening: true/false }`.
#[tauri::command]
pub fn probe_port(port: u16) -> IpcResponse {
    let listening = dev_server::is_port_listening(port);

    IpcResponse::ok(serde_json::json!({
        "listening": listening,
    }))
}

/// Kill the process listening on a specific port.
///
/// Uses platform-specific commands (netstat+taskkill on Windows, lsof+kill on Unix).
/// Returns `{ killed: true }` on success.
#[tauri::command]
pub fn kill_port_process(port: u16) -> IpcResponse {
    tracing::info!("[dev-server] kill_port_process port={}", port);

    match dev_server::kill_port_process(port) {
        Ok(()) => IpcResponse::ok(serde_json::json!({
            "killed": true,
        })),
        Err(e) => {
            tracing::warn!("[dev-server] kill_port_process failed: {}", e);
            IpcResponse::err(&e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_dev_servers_empty_dir() {
        let resp = detect_dev_servers("/nonexistent/path".to_string());
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(data["servers"].as_array().unwrap().is_empty());
        assert_eq!(data["packageManager"].as_str().unwrap(), "npm");
    }

    #[test]
    fn test_probe_port_closed() {
        let resp = probe_port(1);
        assert!(resp.success);
        assert!(!resp.data.unwrap()["listening"].as_bool().unwrap());
    }
}
