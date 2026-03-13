//! Dev server detection engine.
//!
//! Scans a project directory for common dev server configurations (Vite, Next.js,
//! CRA, Angular, SvelteKit, Tauri, Python frameworks) and probes whether the
//! detected port is active.
//!
//! Split into sub-modules by ecosystem:
//! - `node` — Node.js/JS framework detection (package.json, vite config, etc.)
//! - `python` — Python framework detection (requirements.txt, pyproject.toml, etc.)
//! - `util` — Shared helpers (port probing, package manager, parsing)

mod node;
mod python;
pub(crate) mod util;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use util::{detect_package_manager, is_port_listening, kill_port_process};

/// A detected dev server configuration from project files.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectedDevServer {
    /// Framework name (e.g. "Vite", "Next.js", "Tauri")
    pub framework: String,
    /// Port number the server listens on
    pub port: u16,
    /// Full URL (e.g. "http://localhost:1420")
    pub url: String,
    /// Command to start the dev server (e.g. "npm run dev")
    pub start_command: String,
    /// Config file that sourced this detection (e.g. "tauri.conf.json")
    pub source: String,
    /// Whether the port is currently accepting connections
    pub running: bool,
    /// Whether the project environment needs to be set up before the server can start
    #[serde(default)]
    pub needs_setup: bool,
    /// Commands to run to set up the environment (e.g. ["python -m venv .venv", "pip install -r requirements.txt"])
    #[serde(default)]
    pub setup_commands: Vec<String>,
}

/// Scan a project directory and return all detected dev servers.
///
/// Detection priority:
/// 1. `tauri.conf.json` — exact devUrl
/// 2. `vite.config.js` / `vite.config.ts` — regex for port
/// 3. `.env` / `.env.local` — PORT or VITE_PORT
/// 4. `package.json` scripts — pattern matching
/// 5. Python project — requirements.txt / pyproject.toml / Pipfile
pub fn detect_dev_servers(project_root: &str) -> Vec<DetectedDevServer> {
    let root = Path::new(project_root);
    let pkg_manager = detect_package_manager(project_root);
    let mut servers: Vec<DetectedDevServer> = Vec::new();
    let mut seen_ports: std::collections::HashSet<u16> = std::collections::HashSet::new();

    // 1. tauri.conf.json
    if let Some(server) = node::detect_from_tauri_conf(root, &pkg_manager) {
        seen_ports.insert(server.port);
        servers.push(server);
    }

    // 2. vite.config.js / vite.config.ts
    if let Some(server) = node::detect_from_vite_config(root, &pkg_manager) {
        if seen_ports.insert(server.port) {
            servers.push(server);
        }
    }

    // 3. .env / .env.local
    for env_file in &[".env", ".env.local"] {
        if let Some(server) = node::detect_from_env(root, env_file, &pkg_manager) {
            if seen_ports.insert(server.port) {
                servers.push(server);
            }
        }
    }

    // 4. package.json scripts
    for server in node::detect_from_package_json(root, &pkg_manager) {
        if seen_ports.insert(server.port) {
            servers.push(server);
        }
    }

    // 5. Python project detection
    for server in python::detect_python_servers(root, &mut seen_ports) {
        servers.push(server);
    }

    // Probe all ports
    for server in &mut servers {
        server.running = is_port_listening(server.port);
    }

    // Self-detection guard: when scanning our own project root, exclude the
    // Tauri dev server entry. During `tauri dev`, Voice Mirror's own Vite
    // dev server on port 1420 is always running — reporting it as a detected
    // "external" dev server is misleading.
    if util::is_own_project(root) {
        if let Some(own_port) = util::own_tauri_dev_port(root) {
            servers.retain(|s| s.port != own_port);
        }
    }

    servers
}
