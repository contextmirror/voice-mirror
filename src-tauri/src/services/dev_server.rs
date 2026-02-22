//! Dev server detection engine.
//!
//! Scans a project directory for common dev server configurations (Vite, Next.js,
//! CRA, Angular, SvelteKit, Tauri) and probes whether the detected port is active.

use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// A detected dev server configuration from project files.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

/// Scan a project directory and return all detected dev servers.
///
/// Detection priority:
/// 1. `tauri.conf.json` — exact devUrl
/// 2. `vite.config.js` / `vite.config.ts` — regex for port
/// 3. `.env` / `.env.local` — PORT or VITE_PORT
/// 4. `package.json` scripts — pattern matching
pub fn detect_dev_servers(project_root: &str) -> Vec<DetectedDevServer> {
    let root = Path::new(project_root);
    let pkg_manager = detect_package_manager(project_root);
    let mut servers: Vec<DetectedDevServer> = Vec::new();
    let mut seen_ports: std::collections::HashSet<u16> = std::collections::HashSet::new();

    // 1. tauri.conf.json
    if let Some(server) = detect_from_tauri_conf(root, &pkg_manager) {
        seen_ports.insert(server.port);
        servers.push(server);
    }

    // 2. vite.config.js / vite.config.ts
    if let Some(server) = detect_from_vite_config(root, &pkg_manager) {
        if seen_ports.insert(server.port) {
            servers.push(server);
        }
    }

    // 3. .env / .env.local
    for env_file in &[".env", ".env.local"] {
        if let Some(server) = detect_from_env(root, env_file, &pkg_manager) {
            if seen_ports.insert(server.port) {
                servers.push(server);
            }
        }
    }

    // 4. package.json scripts
    for server in detect_from_package_json(root, &pkg_manager) {
        if seen_ports.insert(server.port) {
            servers.push(server);
        }
    }

    // Probe all ports
    for server in &mut servers {
        server.running = is_port_listening(server.port);
    }

    // Self-detection guard: when scanning our own project root, exclude the
    // Tauri dev server entry. During `tauri dev`, Voice Mirror's own Vite
    // dev server on port 1420 is always running — reporting it as a detected
    // "external" dev server is misleading.
    if is_own_project(root) {
        if let Some(own_port) = own_tauri_dev_port(root) {
            servers.retain(|s| s.port != own_port);
        }
    }

    servers
}

/// Check if a TCP port is accepting connections on localhost.
///
/// Tries IPv4 (`127.0.0.1`) first, then falls back to IPv6 (`[::1]`)
/// since some dev servers bind only to one address family.
pub fn is_port_listening(port: u16) -> bool {
    let timeout = Duration::from_millis(200);
    // Try IPv4 first
    if std::net::TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        timeout,
    )
    .is_ok()
    {
        return true;
    }
    // Fallback to IPv6
    std::net::TcpStream::connect_timeout(
        &SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
        timeout,
    )
    .is_ok()
}

/// Detect the package manager from lockfiles in the project root.
///
/// Returns "bun", "yarn", "pnpm", or "npm" (default).
pub fn detect_package_manager(project_root: &str) -> String {
    let root = Path::new(project_root);

    if root.join("bun.lockb").exists() || root.join("bun.lock").exists() {
        "bun".to_string()
    } else if root.join("yarn.lock").exists() {
        "yarn".to_string()
    } else if root.join("pnpm-lock.yaml").exists() {
        "pnpm".to_string()
    } else {
        "npm".to_string()
    }
}

/// Build a start command from the package manager and script name.
fn make_start_command(pkg_manager: &str, script: &str) -> String {
    format!("{} run {}", pkg_manager, script)
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/// Parse `tauri.conf.json` and extract `build.devUrl`.
fn detect_from_tauri_conf(root: &Path, pkg_manager: &str) -> Option<DetectedDevServer> {
    let conf_path = root.join("src-tauri").join("tauri.conf.json");
    let content = std::fs::read_to_string(&conf_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let dev_url = json
        .get("build")?
        .get("devUrl")?
        .as_str()?;

    let port = extract_port_from_url(dev_url)?;

    Some(DetectedDevServer {
        framework: "Tauri".to_string(),
        port,
        url: dev_url.to_string(),
        start_command: make_start_command(pkg_manager, "dev"),
        source: "tauri.conf.json".to_string(),
        running: false,
    })
}

/// Scan `vite.config.js` or `vite.config.ts` for a port declaration.
fn detect_from_vite_config(root: &Path, pkg_manager: &str) -> Option<DetectedDevServer> {
    let candidates = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"];
    for filename in &candidates {
        let path = root.join(filename);
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Some(port) = extract_vite_port(&content) {
                return Some(DetectedDevServer {
                    framework: "Vite".to_string(),
                    port,
                    url: format!("http://localhost:{}", port),
                    start_command: make_start_command(pkg_manager, "dev"),
                    source: filename.to_string(),
                    running: false,
                });
            }
        }
    }
    None
}

/// Look for `PORT=NNNN` or `VITE_PORT=NNNN` in an env file.
fn detect_from_env(root: &Path, filename: &str, pkg_manager: &str) -> Option<DetectedDevServer> {
    let content = std::fs::read_to_string(root.join(filename)).ok()?;
    let port = extract_port_from_env(&content)?;

    Some(DetectedDevServer {
        framework: "Vite".to_string(),
        port,
        url: format!("http://localhost:{}", port),
        start_command: make_start_command(pkg_manager, "dev"),
        source: filename.to_string(),
        running: false,
    })
}

/// Inspect `package.json` scripts for known framework patterns.
fn detect_from_package_json(root: &Path, pkg_manager: &str) -> Vec<DetectedDevServer> {
    let mut results = Vec::new();
    let pkg_path = root.join("package.json");
    let content = match std::fs::read_to_string(&pkg_path) {
        Ok(c) => c,
        Err(_) => return results,
    };
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return results,
    };

    let scripts = match json.get("scripts").and_then(|s| s.as_object()) {
        Some(s) => s,
        None => return results,
    };

    // Check dev, start, serve scripts
    let script_keys = ["dev", "start", "serve"];
    for key in &script_keys {
        if let Some(cmd) = scripts.get(*key).and_then(|v| v.as_str()) {
            if let Some(server) = match_script_pattern(cmd, key, pkg_manager) {
                results.push(server);
            }
        }
    }

    results
}

/// Match a package.json script against known framework patterns.
fn match_script_pattern(cmd: &str, script_key: &str, pkg_manager: &str) -> Option<DetectedDevServer> {
    // Extract explicit --port or -p flag (overrides default)
    let port_override = extract_port_flag(cmd);

    // Pattern matching order matters — more specific patterns first
    if cmd.contains("tauri dev") {
        let port = port_override.unwrap_or(1420);
        return Some(DetectedDevServer {
            framework: "Tauri".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
        });
    }

    if cmd.contains("next dev") || cmd.contains("next start") {
        let port = port_override.unwrap_or(3000);
        return Some(DetectedDevServer {
            framework: "Next.js".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
        });
    }

    if cmd.contains("react-scripts start") {
        let port = port_override.unwrap_or(3000);
        return Some(DetectedDevServer {
            framework: "Create React App".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
        });
    }

    if cmd.contains("ng serve") {
        let port = port_override.unwrap_or(4200);
        return Some(DetectedDevServer {
            framework: "Angular".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
        });
    }

    if cmd.contains("svelte-kit dev") || (cmd.contains("svelte-kit") && cmd.contains("dev")) {
        let port = port_override.unwrap_or(5173);
        return Some(DetectedDevServer {
            framework: "SvelteKit".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
        });
    }

    // Generic vite (must be after framework-specific checks that use vite internally)
    if cmd.contains("vite") {
        let port = port_override.unwrap_or(5173);
        return Some(DetectedDevServer {
            framework: "Vite".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
        });
    }

    None
}

// ---------------------------------------------------------------------------
// Self-detection helpers
// ---------------------------------------------------------------------------

/// Check if the current running binary lives under the project's `src-tauri/target/` directory.
/// This indicates we're a Tauri app built from and running inside this project.
fn is_own_project(project_root: &Path) -> bool {
    let target_dir = project_root.join("src-tauri").join("target");
    if let Ok(exe) = std::env::current_exe() {
        // Canonicalize both to resolve symlinks / UNC prefixes on Windows
        let exe_canon = std::fs::canonicalize(&exe).unwrap_or(exe);
        let target_canon = std::fs::canonicalize(&target_dir).unwrap_or(target_dir);
        exe_canon.starts_with(&target_canon)
    } else {
        false
    }
}

/// Read the Tauri devUrl port from the project's `tauri.conf.json`.
fn own_tauri_dev_port(project_root: &Path) -> Option<u16> {
    let conf_path = project_root.join("src-tauri").join("tauri.conf.json");
    let content = std::fs::read_to_string(conf_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let dev_url = json.get("build")?.get("devUrl")?.as_str()?;
    extract_port_from_url(dev_url)
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Extract a port number from a URL like "http://localhost:1420".
fn extract_port_from_url(url: &str) -> Option<u16> {
    // Try to find :PORT at the end or before a path
    let after_host = url
        .strip_prefix("http://localhost:")
        .or_else(|| url.strip_prefix("https://localhost:"))?;

    // Take digits until non-digit
    let port_str: String = after_host.chars().take_while(|c| c.is_ascii_digit()).collect();
    port_str.parse().ok()
}

/// Extract port from vite config content using regex.
fn extract_vite_port(content: &str) -> Option<u16> {
    static VITE_PORT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?s)server\s*:?\s*\{[\s\S]*?port\s*:\s*(\d+)").unwrap()
    });
    let caps = VITE_PORT_RE.captures(content)?;
    caps.get(1)?.as_str().parse().ok()
}

/// Extract `PORT=NNNN` or `VITE_PORT=NNNN` from env file content.
fn extract_port_from_env(content: &str) -> Option<u16> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        // Match PORT=NNNN or VITE_PORT=NNNN
        if let Some(val) = trimmed
            .strip_prefix("VITE_PORT=")
            .or_else(|| trimmed.strip_prefix("PORT="))
        {
            let val = val.trim().trim_matches('"').trim_matches('\'');
            if let Ok(port) = val.parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}

/// Extract `--port NNNN` or `-p NNNN` from a script command string.
fn extract_port_flag(cmd: &str) -> Option<u16> {
    static PORT_FLAG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?:--port|-p)\s+(\d+)").unwrap()
    });
    let caps = PORT_FLAG_RE.captures(cmd)?;
    caps.get(1)?.as_str().parse().ok()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_port_from_url_http() {
        assert_eq!(extract_port_from_url("http://localhost:1420"), Some(1420));
    }

    #[test]
    fn test_extract_port_from_url_with_path() {
        assert_eq!(
            extract_port_from_url("http://localhost:3000/"),
            Some(3000)
        );
    }

    #[test]
    fn test_extract_port_from_url_https() {
        assert_eq!(
            extract_port_from_url("https://localhost:8443"),
            Some(8443)
        );
    }

    #[test]
    fn test_extract_port_from_url_no_port() {
        assert_eq!(extract_port_from_url("http://localhost"), None);
    }

    #[test]
    fn test_extract_vite_port() {
        let config = r#"
            export default defineConfig({
                server: {
                    port: 1420,
                    strictPort: true,
                },
            })
        "#;
        assert_eq!(extract_vite_port(config), Some(1420));
    }

    #[test]
    fn test_extract_vite_port_no_server() {
        let config = "export default defineConfig({})";
        assert_eq!(extract_vite_port(config), None);
    }

    #[test]
    fn test_extract_port_from_env() {
        let env = "# comment\nVITE_PORT=3000\nOTHER=foo";
        assert_eq!(extract_port_from_env(env), Some(3000));
    }

    #[test]
    fn test_extract_port_from_env_plain_port() {
        let env = "PORT=8080";
        assert_eq!(extract_port_from_env(env), Some(8080));
    }

    #[test]
    fn test_extract_port_from_env_comment_ignored() {
        let env = "# PORT=9999\nPORT=3000";
        assert_eq!(extract_port_from_env(env), Some(3000));
    }

    #[test]
    fn test_extract_port_from_env_empty() {
        assert_eq!(extract_port_from_env(""), None);
    }

    #[test]
    fn test_extract_port_flag_long() {
        assert_eq!(extract_port_flag("vite --port 8080"), Some(8080));
    }

    #[test]
    fn test_extract_port_flag_short() {
        assert_eq!(extract_port_flag("vite -p 9090"), Some(9090));
    }

    #[test]
    fn test_extract_port_flag_none() {
        assert_eq!(extract_port_flag("vite dev"), None);
    }

    #[test]
    fn test_match_script_vite() {
        let server = match_script_pattern("vite dev", "dev", "npm").unwrap();
        assert_eq!(server.framework, "Vite");
        assert_eq!(server.port, 5173);
        assert_eq!(server.start_command, "npm run dev");
    }

    #[test]
    fn test_match_script_vite_custom_port() {
        let server = match_script_pattern("vite --port 4000", "dev", "npm").unwrap();
        assert_eq!(server.framework, "Vite");
        assert_eq!(server.port, 4000);
    }

    #[test]
    fn test_match_script_next() {
        let server = match_script_pattern("next dev", "dev", "bun").unwrap();
        assert_eq!(server.framework, "Next.js");
        assert_eq!(server.port, 3000);
        assert_eq!(server.start_command, "bun run dev");
    }

    #[test]
    fn test_match_script_next_custom_port() {
        let server = match_script_pattern("next dev -p 4000", "dev", "npm").unwrap();
        assert_eq!(server.framework, "Next.js");
        assert_eq!(server.port, 4000);
    }

    #[test]
    fn test_match_script_cra() {
        let server = match_script_pattern("react-scripts start", "start", "yarn").unwrap();
        assert_eq!(server.framework, "Create React App");
        assert_eq!(server.port, 3000);
        assert_eq!(server.start_command, "yarn run start");
    }

    #[test]
    fn test_match_script_angular() {
        let server = match_script_pattern("ng serve", "serve", "npm").unwrap();
        assert_eq!(server.framework, "Angular");
        assert_eq!(server.port, 4200);
    }

    #[test]
    fn test_match_script_angular_custom_port() {
        let server = match_script_pattern("ng serve --port 5000", "serve", "npm").unwrap();
        assert_eq!(server.framework, "Angular");
        assert_eq!(server.port, 5000);
    }

    #[test]
    fn test_match_script_sveltekit() {
        let server = match_script_pattern("svelte-kit dev", "dev", "pnpm").unwrap();
        assert_eq!(server.framework, "SvelteKit");
        assert_eq!(server.port, 5173);
        assert_eq!(server.start_command, "pnpm run dev");
    }

    #[test]
    fn test_match_script_tauri() {
        let server = match_script_pattern("tauri dev", "dev", "npm").unwrap();
        assert_eq!(server.framework, "Tauri");
        assert_eq!(server.port, 1420);
    }

    #[test]
    fn test_match_script_unknown() {
        assert!(match_script_pattern("node server.js", "start", "npm").is_none());
    }

    #[test]
    fn test_detect_package_manager_npm_default() {
        // Non-existent path → no lockfiles → "npm" default
        let pm = detect_package_manager("/this/path/does/not/exist");
        assert_eq!(pm, "npm");
    }

    #[test]
    fn test_is_port_listening_closed() {
        // Port 1 should not be listening on any sane system
        assert!(!is_port_listening(1));
    }

    #[test]
    fn test_detect_from_tauri_conf_parses_correctly() {
        let dir = std::env::temp_dir().join("vm_test_tauri_conf");
        let tauri_dir = dir.join("src-tauri");
        let _ = std::fs::create_dir_all(&tauri_dir);

        std::fs::write(
            tauri_dir.join("tauri.conf.json"),
            r#"{ "build": { "devUrl": "http://localhost:1420" } }"#,
        )
        .unwrap();

        let server = detect_from_tauri_conf(&dir, "npm").unwrap();
        assert_eq!(server.framework, "Tauri");
        assert_eq!(server.port, 1420);
        assert_eq!(server.url, "http://localhost:1420");
        assert_eq!(server.source, "tauri.conf.json");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_dev_servers_integration() {
        let dir = std::env::temp_dir().join("vm_test_detect_servers");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        // Write a minimal package.json with a vite script
        std::fs::write(
            dir.join("package.json"),
            r#"{ "scripts": { "dev": "vite --port 4444" } }"#,
        )
        .unwrap();

        // Write a yarn.lock to test package manager detection
        std::fs::write(dir.join("yarn.lock"), "").unwrap();

        let servers = detect_dev_servers(dir.to_str().unwrap());
        assert!(!servers.is_empty());
        let vite = &servers[0];
        assert_eq!(vite.framework, "Vite");
        assert_eq!(vite.port, 4444);
        assert_eq!(vite.start_command, "yarn run dev");
        assert_eq!(vite.source, "package.json");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_own_tauri_dev_port() {
        let dir = std::env::temp_dir().join("vm_test_own_tauri_port");
        let tauri_dir = dir.join("src-tauri");
        let _ = std::fs::create_dir_all(&tauri_dir);

        std::fs::write(
            tauri_dir.join("tauri.conf.json"),
            r#"{ "build": { "devUrl": "http://localhost:1420" } }"#,
        )
        .unwrap();

        assert_eq!(own_tauri_dev_port(&dir), Some(1420));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_own_tauri_dev_port_missing_file() {
        let dir = std::env::temp_dir().join("vm_test_own_tauri_port_missing");
        let _ = std::fs::create_dir_all(&dir);
        assert_eq!(own_tauri_dev_port(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_is_own_project_different_dir() {
        // A temp dir won't contain our exe, so this should return false
        let dir = std::env::temp_dir().join("vm_test_is_own_project");
        let _ = std::fs::create_dir_all(&dir);
        assert!(!is_own_project(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_is_port_listening_closed_ipv6() {
        // Port 1 should not be listening on IPv6 either
        assert!(!is_port_listening(1));
    }
}
