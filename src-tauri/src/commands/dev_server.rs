//! Tauri commands for dev server detection and port probing.
//!
//! Provides two commands:
//! - `detect_dev_servers`: Scan a project directory for dev server configurations
//! - `probe_port`: Check if a specific port is accepting connections

use super::IpcResponse;
use crate::services::dev_server;

/// Scan a project directory and return all detected dev server configurations.
///
/// Checks tauri.conf.json, vite.config.*, .env files, and package.json scripts
/// for known framework patterns (Vite, Next.js, CRA, Angular, SvelteKit, Tauri).
/// Also probes each detected port to see if a server is currently running.
#[tauri::command]
pub fn detect_dev_servers(project_root: String) -> Result<IpcResponse, String> {
    let servers = dev_server::detect_dev_servers(&project_root);
    let pkg_manager = dev_server::detect_package_manager(&project_root);

    Ok(IpcResponse::ok(serde_json::json!({
        "servers": servers,
        "packageManager": pkg_manager,
    })))
}

/// Check if a specific port is accepting TCP connections on localhost.
///
/// Returns `{ listening: true/false }`.
#[tauri::command]
pub fn probe_port(port: u16) -> Result<IpcResponse, String> {
    let listening = dev_server::is_port_listening(port);

    Ok(IpcResponse::ok(serde_json::json!({
        "listening": listening,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_dev_servers_empty_dir() {
        let result = detect_dev_servers("/nonexistent/path".to_string());
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(data["servers"].as_array().unwrap().is_empty());
        assert_eq!(data["packageManager"].as_str().unwrap(), "npm");
    }

    #[test]
    fn test_probe_port_closed() {
        let result = probe_port(1);
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.success);
        assert!(!resp.data.unwrap()["listening"].as_bool().unwrap());
    }
}
