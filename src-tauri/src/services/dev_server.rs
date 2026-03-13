//! Dev server detection engine.
//!
//! Scans a project directory for common dev server configurations (Vite, Next.js,
//! CRA, Angular, SvelteKit, Tauri) and probes whether the detected port is active.

use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

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

    // 5. Python project detection
    for server in detect_python_servers(root, &mut seen_ports) {
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

    let detected = if root.join("bun.lockb").exists() || root.join("bun.lock").exists() {
        "bun"
    } else if root.join("yarn.lock").exists() {
        "yarn"
    } else if root.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else {
        return "npm".to_string(); // npm is always available with Node.js
    };

    // Verify the detected package manager is actually installed.
    // A project may have a lockfile from its original author (e.g. pnpm-lock.yaml)
    // but the current user may not have that tool installed.
    if is_command_available(detected) {
        detected.to_string()
    } else {
        tracing::info!(
            "[dev-server] Lockfile suggests `{}` but it's not installed, falling back to npm",
            detected
        );
        "npm".to_string()
    }
}

/// Check if a command is available on the system PATH.
fn is_command_available(cmd: &str) -> bool {
    let check = if cfg!(target_os = "windows") {
        std::process::Command::new("where")
            .arg(cmd)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
    } else {
        std::process::Command::new("which")
            .arg(cmd)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
    };
    matches!(check, Ok(status) if status.success())
}

/// Build a start command from the package manager and script name.
fn make_start_command(pkg_manager: &str, script: &str) -> String {
    format!("{} run {}", pkg_manager, script)
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/// Extract the port from a Bun entry file (e.g. `export default { port: 3001, fetch }`).
/// Scans the entry file referenced in the script command for `port: NNNN` or `port = NNNN`.
fn extract_bun_port_from_script(cmd: &str, root: &Path) -> Option<u16> {
    // Find the .ts/.js entry file in the command
    let entry = cmd.split_whitespace()
        .find(|part| {
            part.ends_with(".ts") || part.ends_with(".js")
                || part.ends_with(".tsx") || part.ends_with(".jsx")
        })?;

    let entry_path = root.join(entry);
    let content = std::fs::read_to_string(&entry_path).ok()?;

    // Look for `port: NNNN` or `port = NNNN` patterns
    let re = regex::Regex::new(r"port\s*[:=]\s*(\d{2,5})").ok()?;
    let caps = re.captures(&content)?;
    caps.get(1)?.as_str().parse::<u16>().ok()
}

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
        ..Default::default()
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
                    ..Default::default()
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
        ..Default::default()
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
            if let Some(mut server) = match_script_pattern(cmd, key, pkg_manager) {
                // For Bun servers, try to extract the port from the entry file
                // since Bun defines port in `export default { port: NNNN, fetch }`
                if server.framework == "Bun" {
                    if let Some(port) = extract_bun_port_from_script(cmd, root) {
                        server.port = port;
                        server.url = format!("http://localhost:{}", port);
                    }
                }
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
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
        });
    }

    if cmd.contains("astro dev") || cmd.contains("astro preview") {
        let port = port_override.unwrap_or(4321);
        return Some(DetectedDevServer {
            framework: "Astro".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    if cmd.contains("nuxt dev") || cmd.contains("nuxi dev") {
        let port = port_override.unwrap_or(3000);
        return Some(DetectedDevServer {
            framework: "Nuxt".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    if cmd.contains("remix dev") || (cmd.contains("remix") && cmd.contains("dev")) {
        let port = port_override.unwrap_or(3000);
        return Some(DetectedDevServer {
            framework: "Remix".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    if cmd.contains("gatsby develop") {
        let port = port_override.unwrap_or(8000);
        return Some(DetectedDevServer {
            framework: "Gatsby".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    // Generic webpack-dev-server / webpack serve
    if cmd.contains("webpack-dev-server") || cmd.contains("webpack serve") {
        let port = port_override.unwrap_or(8080);
        return Some(DetectedDevServer {
            framework: "Webpack".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    // Parcel (bundler with built-in dev server)
    if cmd.contains("parcel serve") || cmd.contains("parcel watch") ||
       (cmd.contains("parcel") && !cmd.contains("parcel build")) {
        let port = port_override.unwrap_or(1234);
        return Some(DetectedDevServer {
            framework: "Parcel".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    // Expo (React Native web)
    if cmd.contains("expo start") {
        let port = port_override.unwrap_or(8081);
        return Some(DetectedDevServer {
            framework: "Expo".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: make_start_command(pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    // Bun dev server (bun run --hot, bun --hot, bun --watch)
    if cmd.contains("bun run --hot") || cmd.contains("bun --hot") || cmd.contains("bun --watch") {
        let port = port_override.unwrap_or(3000);
        return Some(DetectedDevServer {
            framework: "Bun".to_string(),
            port,
            url: format!("http://localhost:{}", port),
            start_command: format!("{} run {}", pkg_manager, script_key),
            source: "package.json".to_string(),
            running: false,
            ..Default::default()
        });
    }

    // Bun server entry file (bun run index.ts, bun run src/index.ts, etc.)
    // Bun can serve HTTP by exporting { port, fetch } from the entry file.
    if cmd.starts_with("bun run ") || cmd.starts_with("bun ") {
        // Check if it points to a .ts/.js file (not a script name like "bun run dev")
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        let last = parts.last().unwrap_or(&"");
        if last.ends_with(".ts") || last.ends_with(".js") || last.ends_with(".tsx") || last.ends_with(".jsx") {
            let port = port_override.unwrap_or(3000);
            return Some(DetectedDevServer {
                framework: "Bun".to_string(),
                port,
                url: format!("http://localhost:{}", port),
                start_command: format!("{} run {}", pkg_manager, script_key),
                source: "package.json".to_string(),
                running: false,
                ..Default::default()
            });
        }
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
            ..Default::default()
        });
    }

    None
}

/// Kill the process listening on a given port.
///
/// Platform-specific: uses `netstat` + `taskkill` on Windows, `lsof` + `kill`
/// on Unix. Returns Ok(()) if a process was found and killed, Err otherwise.
pub fn kill_port_process(port: u16) -> Result<(), String> {
    kill_port_process_impl(port)
}

#[cfg(windows)]
fn kill_port_process_impl(port: u16) -> Result<(), String> {
    use std::process::Command;

    // Run netstat directly (no pipe) and parse in Rust — avoids cmd.exe shell issues
    let output = Command::new("netstat")
        .args(["-ano"])
        .output()
        .map_err(|e| format!("Failed to run netstat: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let port_suffix = format!(":{}", port);
    let mut killed = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.contains("LISTENING") {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        // netstat -ano format: "TCP  addr:port  addr:port  LISTENING  PID"
        if parts.len() < 5 {
            continue;
        }

        // Verify the local address ends with our exact port
        let local_addr = parts[1];
        if !local_addr.ends_with(&port_suffix) {
            continue;
        }

        // Parse PID (trim \r from Windows line endings)
        let pid_str = parts[4].trim();
        if let Ok(pid) = pid_str.parse::<u32>() {
            if pid > 0 {
                tracing::info!("[dev-server] Killing PID {} on port {} (addr={})", pid, port, local_addr);
                let kill = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .output()
                    .map_err(|e| format!("Failed to run taskkill: {}", e))?;

                if kill.status.success() {
                    killed = true;
                } else {
                    let stderr = String::from_utf8_lossy(&kill.stderr);
                    tracing::warn!("[dev-server] taskkill PID {} failed: {}", pid, stderr.trim());
                }
            }
        }
    }

    if killed {
        Ok(())
    } else {
        Err(format!("No process found listening on port {}", port))
    }
}

#[cfg(not(windows))]
fn kill_port_process_impl(port: u16) -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("lsof")
        .args(["-ti", &format!(":{}", port)])
        .output()
        .map_err(|e| format!("Failed to run lsof: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pid_str = stdout.trim();

    if pid_str.is_empty() {
        return Err(format!("No process found listening on port {}", port));
    }

    tracing::info!("[dev-server] Killing PID {} on port {}", pid_str, port);
    let kill = Command::new("kill")
        .args(["-9", pid_str])
        .output()
        .map_err(|e| format!("Failed to run kill: {}", e))?;

    if kill.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&kill.stderr);
        Err(format!("Failed to kill PID {}: {}", pid_str, stderr.trim()))
    }
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
// Python detection helpers
// ---------------------------------------------------------------------------

/// Parse requirements.txt content and return normalized (lowercased) package names.
fn parse_requirements_txt(content: &str) -> Vec<String> {
    static PKG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)").unwrap()
    });

    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed.starts_with('#')
                || trimmed.starts_with('-')
                || trimmed.starts_with("http")
                || trimmed.starts_with('/')
                || trimmed.starts_with('.')
            {
                return None;
            }
            let before_comment = trimmed.split('#').next().unwrap_or("").trim();
            let before_extras = before_comment.split('[').next().unwrap_or("");
            PKG_RE.captures(before_extras).map(|caps| {
                caps.get(1).unwrap().as_str().to_lowercase()
            })
        })
        .collect()
}

/// Parse pyproject.toml content and return normalized package names.
///
/// Handles two formats:
/// - PEP 621: `[project] dependencies = ["flask>=2.0", ...]` (may span multiple lines)
/// - Poetry: `[tool.poetry.dependencies] flask = "^2.0"` (key-value per line)
fn parse_pyproject_toml(content: &str) -> Vec<String> {
    static QUOTED_PKG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#""([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)"#).unwrap()
    });

    let mut deps = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // PEP 621: [project] section
        if trimmed == "[project]" {
            i += 1;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.starts_with('[') { break; }
                if line.starts_with("dependencies") && line.contains('=') {
                    let mut array_str = String::new();
                    let after_eq = line.splitn(2, '=').nth(1).unwrap_or("");
                    array_str.push_str(after_eq);
                    if !array_str.contains(']') {
                        i += 1;
                        while i < lines.len() {
                            array_str.push_str(lines[i]);
                            if lines[i].contains(']') { break; }
                            i += 1;
                        }
                    }
                    for caps in QUOTED_PKG_RE.captures_iter(&array_str) {
                        let name = caps.get(1).unwrap().as_str().to_lowercase();
                        let pkg = name.split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_' && c != '.').next().unwrap_or(&name);
                        if !pkg.is_empty() {
                            deps.push(pkg.to_string());
                        }
                    }
                }
                i += 1;
            }
            continue;
        }

        // Poetry: [tool.poetry.dependencies]
        if trimmed == "[tool.poetry.dependencies]" {
            i += 1;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.starts_with('[') { break; }
                if line.is_empty() || line.starts_with('#') {
                    i += 1;
                    continue;
                }
                if let Some(key) = line.split(|c: char| c == '=' || c.is_whitespace()).next() {
                    let name = key.trim().to_lowercase();
                    if !name.is_empty() && name != "python" {
                        deps.push(name);
                    }
                }
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    deps
}

/// Parse Pipfile content and return normalized package names from [packages] section.
fn parse_pipfile(content: &str) -> Vec<String> {
    let mut deps = Vec::new();
    let mut in_packages = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "[packages]" {
            in_packages = true;
            continue;
        }
        if trimmed.starts_with('[') {
            in_packages = false;
            continue;
        }

        if in_packages && !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(key) = trimmed.split('=').next() {
                let name = key.trim().to_lowercase();
                if !name.is_empty() {
                    deps.push(name);
                }
            }
        }
    }

    deps
}

/// Parse Python dependency files from a project root.
/// Tries requirements.txt -> pyproject.toml -> Pipfile in order.
/// Returns None if no Python dependency file is found.
fn parse_python_deps(root: &Path) -> Option<Vec<String>> {
    if let Ok(content) = std::fs::read_to_string(root.join("requirements.txt")) {
        let deps = parse_requirements_txt(&content);
        if !deps.is_empty() {
            return Some(deps);
        }
    }

    if let Ok(content) = std::fs::read_to_string(root.join("pyproject.toml")) {
        let deps = parse_pyproject_toml(&content);
        return Some(deps);
    }

    if let Ok(content) = std::fs::read_to_string(root.join("Pipfile")) {
        let deps = parse_pipfile(&content);
        return Some(deps);
    }

    None
}

// ---------------------------------------------------------------------------
// Python framework identification
// ---------------------------------------------------------------------------

/// A recognized Python web framework and its conventions.
struct PythonFramework {
    /// Framework display name (e.g. "Flask", "Django")
    name: &'static str,
    /// Dependency markers — if any of these appear in deps, this framework is detected
    markers: &'static [&'static str],
    /// Candidate entry files to look for, in priority order
    entry_candidates: &'static [&'static str],
    /// Default port if no port is found in source or .env
    default_port: u16,
}

/// All supported Python frameworks in detection priority order.
const PYTHON_FRAMEWORKS: &[PythonFramework] = &[
    PythonFramework {
        name: "Django",
        markers: &["django"],
        entry_candidates: &["manage.py"],
        default_port: 8000,
    },
    PythonFramework {
        name: "Flask",
        markers: &["flask"],
        entry_candidates: &["app.py", "run_ui.py", "server.py", "wsgi.py"],
        default_port: 5000,
    },
    PythonFramework {
        name: "FastAPI",
        markers: &["fastapi", "uvicorn"],
        entry_candidates: &["main.py", "app.py", "server.py"],
        default_port: 8000,
    },
    PythonFramework {
        name: "Streamlit",
        markers: &["streamlit"],
        entry_candidates: &["app.py", "main.py", "streamlit_app.py"],
        default_port: 8501,
    },
    PythonFramework {
        name: "Gradio",
        markers: &["gradio"],
        entry_candidates: &["app.py", "main.py", "demo.py"],
        default_port: 7860,
    },
];

/// Generic Python fallback entry file candidates (when no framework is identified).
const GENERIC_PYTHON_ENTRIES: &[&str] = &["run_ui.py", "server.py", "app.py", "main.py"];
const GENERIC_PYTHON_PORT: u16 = 8000;

/// Identify the Python web framework from dependency names.
/// Returns the first matching framework in priority order, or None.
fn identify_python_framework(deps: &[String]) -> Option<&'static PythonFramework> {
    for fw in PYTHON_FRAMEWORKS {
        if fw.markers.iter().any(|m| deps.contains(&m.to_string())) {
            return Some(fw);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Python port extraction
// ---------------------------------------------------------------------------

/// Extract a port number from Python source file content.
///
/// Scans for common patterns:
/// - `port = 5000` or `port=5000` (word boundary to avoid "transport", "passport")
/// - `"port": 5000` (JSON-style)
/// - `--port 8080` in uvicorn/streamlit invocations
/// - `os.environ.get("PORT", "5000")` or `os.getenv("PORT", "3000")`
fn extract_python_port_from_source(content: &str) -> Option<u16> {
    static PORT_PATTERNS: std::sync::LazyLock<Vec<regex::Regex>> = std::sync::LazyLock::new(|| {
        vec![
            // port = 5000 or port=5000 (word boundary to avoid matching "transport", "passport")
            regex::Regex::new(r#"\bport\s*=\s*(\d{2,5})"#).unwrap(),
            // "port": 5000
            regex::Regex::new(r#""port"\s*:\s*(\d{2,5})"#).unwrap(),
            // --port 8080
            regex::Regex::new(r#"--port\s+(\d{2,5})"#).unwrap(),
            // os.environ.get("PORT", "5000") or os.getenv("PORT", "3000")
            regex::Regex::new(r#"os\.(?:environ\.get|getenv)\(\s*"[^"]*"\s*,\s*"(\d{2,5})"\s*\)"#).unwrap(),
        ]
    });

    for re in PORT_PATTERNS.iter() {
        if let Some(caps) = re.captures(content) {
            if let Some(port) = caps.get(1).and_then(|m| m.as_str().parse::<u16>().ok()) {
                return Some(port);
            }
        }
    }

    None
}

/// Python-specific .env variable names that indicate a port.
const PYTHON_PORT_ENV_VARS: &[&str] = &[
    "FLASK_RUN_PORT=",
    "UVICORN_PORT=",
    "WEB_UI_PORT=",
    "DJANGO_PORT=",
    "GRADIO_SERVER_PORT=",
    "STREAMLIT_SERVER_PORT=",
];

/// Extract a port from .env content using Python-specific variable names.
///
/// Separate from the existing `extract_port_from_env()` which only handles
/// `PORT` and `VITE_PORT` and creates Vite-labeled servers.
fn extract_python_port_from_env_content(content: &str) -> Option<u16> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        for prefix in PYTHON_PORT_ENV_VARS {
            if let Some(val) = trimmed.strip_prefix(prefix) {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if let Ok(port) = val.parse::<u16>() {
                    return Some(port);
                }
            }
        }
    }
    None
}

/// Extract Python server port using the three-layer strategy:
/// 1. Entry file source parsing
/// 2. .env file scanning (Python-specific vars)
/// 3. Framework default
fn extract_python_port(root: &Path, entry_path: &Path, default_port: u16) -> u16 {
    // Layer 1: entry file source
    if let Ok(content) = std::fs::read_to_string(entry_path) {
        if let Some(port) = extract_python_port_from_source(&content) {
            return port;
        }
    }

    // Layer 2: .env files
    for env_file in &[".env", ".env.local"] {
        if let Ok(content) = std::fs::read_to_string(root.join(env_file)) {
            if let Some(port) = extract_python_port_from_env_content(&content) {
                return port;
            }
        }
    }

    // Layer 3: framework default
    default_port
}

// ---------------------------------------------------------------------------
// Python venv detection
// ---------------------------------------------------------------------------

/// Read the conda environment name from environment.yml content.
fn read_conda_env_name_from_content(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Detect the virtual environment type and return a command prefix.
///
/// Instead of shell-dependent activation commands, returns the path to the
/// venv's executables directly (works in cmd.exe, PowerShell, and bash).
///
/// Returns:
/// - `.venv\Scripts\` or `.venv/bin/` for venv directories
/// - `conda run -n {envname} ` for conda environments
/// - `pipenv run ` for Pipfile projects
/// - `""` if no venv found
fn detect_python_venv(root: &Path) -> String {
    // Check .venv/ and venv/ directories
    for venv_dir in &[".venv", "venv"] {
        let venv_path = root.join(venv_dir);
        if venv_path.is_dir() {
            if cfg!(windows) {
                return format!(r"{}\Scripts\", venv_dir);
            } else {
                return format!("{}/bin/", venv_dir);
            }
        }
    }

    // Check conda: environment.yml
    let env_yml = root.join("environment.yml");
    if env_yml.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_yml) {
            if let Some(name) = read_conda_env_name_from_content(&content) {
                return format!("conda run -n {} ", name);
            }
        }
    }

    // Check conda: .conda/ directory (fallback — use project dir name)
    if root.join(".conda").is_dir() {
        let dir_name = root.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("env");
        return format!("conda run -n {} ", dir_name);
    }

    // Check pipenv: Pipfile present
    if root.join("Pipfile").exists() {
        return "pipenv run ".to_string();
    }

    String::new()
}

// ---------------------------------------------------------------------------
// Python start command + full detection pipeline
// ---------------------------------------------------------------------------

/// Build the start command for a Python server, applying venv prefix.
///
/// For venv directories, replaces `python`/tool names with the venv path.
/// For conda/pipenv, prepends the runner prefix.
fn build_python_start_command(
    framework_name: &str,
    entry: &str,
    port: u16,
    venv_prefix: &str,
) -> String {
    match framework_name {
        "Django" => {
            format!("{}python manage.py runserver 0.0.0.0:{}", venv_prefix, port)
        }
        "FastAPI" => {
            let module = entry.strip_suffix(".py").unwrap_or(entry);
            format!("{}uvicorn {}:app --host 0.0.0.0 --port {}", venv_prefix, module, port)
        }
        "Streamlit" => {
            format!("{}streamlit run {} --server.port {}", venv_prefix, entry, port)
        }
        _ => {
            // Flask, Gradio, Generic Python
            format!("{}python {}", venv_prefix, entry)
        }
    }
}

/// Detect Python dev servers in a project directory.
///
/// Scans for requirements.txt/pyproject.toml/Pipfile, identifies framework,
/// locates entry file, extracts port, and builds venv-aware start command.
fn detect_python_servers(
    root: &Path,
    seen_ports: &mut std::collections::HashSet<u16>,
) -> Vec<DetectedDevServer> {
    let mut servers = Vec::new();

    // Step 1: Parse dependency files
    let deps = match parse_python_deps(root) {
        Some(d) => d,
        None => return servers,
    };

    // Determine which dep file was found (for source field)
    let source = if root.join("requirements.txt").exists() {
        "requirements.txt"
    } else if root.join("pyproject.toml").exists() {
        "pyproject.toml"
    } else {
        "Pipfile"
    };

    // Step 2: Identify framework
    let (framework_name, entry_candidates, default_port) =
        if let Some(fw) = identify_python_framework(&deps) {
            (fw.name, fw.entry_candidates.to_vec(), fw.default_port)
        } else {
            ("Python", GENERIC_PYTHON_ENTRIES.to_vec(), GENERIC_PYTHON_PORT)
        };

    // Step 3: Locate entry file
    let entry = match entry_candidates.iter().find(|f| root.join(f).exists()) {
        Some(e) => *e,
        None => return servers,
    };

    // Step 4: Extract port
    let port = extract_python_port(root, &root.join(entry), default_port);

    // Port dedup
    if !seen_ports.insert(port) {
        return servers;
    }

    // Step 5: Detect venv and build start command
    let venv_prefix = detect_python_venv(root);
    let start_command = build_python_start_command(framework_name, entry, port, &venv_prefix);

    servers.push(DetectedDevServer {
        framework: framework_name.to_string(),
        port,
        url: format!("http://localhost:{}", port),
        start_command,
        source: source.to_string(),
        running: false,
        ..Default::default()
    });

    servers
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
    fn test_match_script_parcel() {
        let server = match_script_pattern("parcel serve src/index.html", "dev", "npm").unwrap();
        assert_eq!(server.framework, "Parcel");
        assert_eq!(server.port, 1234);
    }

    #[test]
    fn test_match_script_parcel_custom_port() {
        let server = match_script_pattern("parcel serve src/index.html --port 3000", "dev", "npm").unwrap();
        assert_eq!(server.framework, "Parcel");
        assert_eq!(server.port, 3000);
    }

    #[test]
    fn test_match_script_parcel_no_build() {
        // "parcel build" should NOT be detected as a dev server
        assert!(match_script_pattern("parcel build src/index.html", "build", "npm").is_none());
    }

    #[test]
    fn test_match_script_expo() {
        let server = match_script_pattern("expo start", "start", "npm").unwrap();
        assert_eq!(server.framework, "Expo");
        assert_eq!(server.port, 8081);
    }

    #[test]
    fn test_match_script_expo_web() {
        let server = match_script_pattern("expo start --web", "start", "npm").unwrap();
        assert_eq!(server.framework, "Expo");
        assert_eq!(server.port, 8081);
    }

    #[test]
    fn test_match_script_bun_hot() {
        let server = match_script_pattern("bun run --hot index.ts", "dev", "bun").unwrap();
        assert_eq!(server.framework, "Bun");
        assert_eq!(server.port, 3000);
    }

    #[test]
    fn test_match_script_bun_entry_file() {
        let server = match_script_pattern("bun run src/server.ts", "start", "bun").unwrap();
        assert_eq!(server.framework, "Bun");
        assert_eq!(server.port, 3000);
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
    fn test_is_command_available_finds_node() {
        // Node should be installed on any dev machine running these tests
        assert!(is_command_available("node"));
    }

    #[test]
    fn test_is_command_available_rejects_bogus() {
        assert!(!is_command_available("totally_not_a_real_command_xyz_123"));
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

    #[test]
    fn test_parse_requirements_txt_basic() {
        let content = "flask==2.0.0\nuvicorn>=0.18\nrequests\n";
        let deps = parse_requirements_txt(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
        assert!(deps.contains(&"requests".to_string()));
    }

    #[test]
    fn test_parse_requirements_txt_extras_and_comments() {
        let content = "# comment\nFlask[async]>=2.0\n-r other.txt\n\nDjango>=4.0  # inline comment\n";
        let deps = parse_requirements_txt(content);
        assert!(deps.contains(&"flask".to_string()), "Should lowercase");
        assert!(deps.contains(&"django".to_string()));
        assert!(!deps.iter().any(|d| d.contains("-r")), "Should skip -r lines");
        assert_eq!(deps.len(), 2);
    }

    #[test]
    fn test_parse_requirements_txt_empty() {
        let deps = parse_requirements_txt("");
        assert!(deps.is_empty());
    }

    #[test]
    fn test_parse_pyproject_toml_pep621() {
        let content = "[project]\nname = \"myapp\"\ndependencies = [\n    \"flask>=2.0\",\n    \"uvicorn\",\n]\n";
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
    }

    #[test]
    fn test_parse_pyproject_toml_pep621_single_line() {
        let content = "[project]\ndependencies = [\"django>=4.0\", \"gunicorn\"]\n";
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"django".to_string()));
        assert!(deps.contains(&"gunicorn".to_string()));
    }

    #[test]
    fn test_parse_pyproject_toml_poetry() {
        let content = "[tool.poetry.dependencies]\npython = \"^3.12\"\nflask = \"^2.0\"\ngradio = {version = \"^4.0\"}\n";
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"gradio".to_string()));
        assert!(!deps.contains(&"python".to_string()), "Should skip python itself");
    }

    #[test]
    fn test_parse_pipfile() {
        let content = "[packages]\nflask = \"*\"\nuvicorn = \">=0.18\"\n\n[dev-packages]\npytest = \"*\"\n";
        let deps = parse_pipfile(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
        assert!(!deps.contains(&"pytest".to_string()), "Should skip dev-packages");
    }

    // --- Task 4: Framework identification tests ---

    #[test]
    fn test_identify_python_framework_django() {
        let deps = vec!["django".to_string(), "gunicorn".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Django");
    }

    #[test]
    fn test_identify_python_framework_flask() {
        let deps = vec!["flask".to_string(), "requests".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Flask");
    }

    #[test]
    fn test_identify_python_framework_fastapi() {
        let deps = vec!["fastapi".to_string(), "pydantic".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "FastAPI");
    }

    #[test]
    fn test_identify_python_framework_uvicorn_implies_fastapi() {
        let deps = vec!["uvicorn".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "FastAPI");
    }

    #[test]
    fn test_identify_python_framework_streamlit() {
        let deps = vec!["streamlit".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Streamlit");
    }

    #[test]
    fn test_identify_python_framework_gradio() {
        let deps = vec!["gradio".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Gradio");
    }

    #[test]
    fn test_identify_python_framework_priority_django_over_flask() {
        let deps = vec!["django".to_string(), "flask".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Django", "Django should win over Flask");
    }

    #[test]
    fn test_identify_python_framework_none() {
        let deps = vec!["requests".to_string(), "numpy".to_string()];
        assert!(identify_python_framework(&deps).is_none());
    }

    // --- Task 5: Port extraction tests ---

    #[test]
    fn test_extract_python_port_assignment() {
        assert_eq!(extract_python_port_from_source("port = 5000\n"), Some(5000));
        assert_eq!(extract_python_port_from_source("port=8080\n"), Some(8080));
    }

    #[test]
    fn test_extract_python_port_json_style() {
        assert_eq!(extract_python_port_from_source(r#""port": 5000,"#), Some(5000));
    }

    #[test]
    fn test_extract_python_port_flask_run() {
        assert_eq!(extract_python_port_from_source("app.run(port=8080)\n"), Some(8080));
    }

    #[test]
    fn test_extract_python_port_environ_default() {
        assert_eq!(
            extract_python_port_from_source(r#"os.environ.get("PORT", "5000")"#),
            Some(5000)
        );
        assert_eq!(
            extract_python_port_from_source(r#"os.getenv("PORT", "3000")"#),
            Some(3000)
        );
    }

    #[test]
    fn test_extract_python_port_cli_flag() {
        assert_eq!(
            extract_python_port_from_source("subprocess.run(['uvicorn', '--port', '9000'])"),
            Some(9000)
        );
    }

    #[test]
    fn test_extract_python_port_no_false_positive() {
        assert_eq!(extract_python_port_from_source("transport = 8080\n"), None);
        assert_eq!(extract_python_port_from_source("passport = 1234\n"), None);
    }

    #[test]
    fn test_extract_python_port_not_found() {
        assert_eq!(extract_python_port_from_source("print('hello')"), None);
    }

    #[test]
    fn test_extract_python_port_from_env_flask() {
        assert_eq!(extract_python_port_from_env_content("FLASK_RUN_PORT=5001\n"), Some(5001));
    }

    #[test]
    fn test_extract_python_port_from_env_uvicorn() {
        assert_eq!(extract_python_port_from_env_content("UVICORN_PORT=8001\n"), Some(8001));
    }

    #[test]
    fn test_extract_python_port_from_env_web_ui() {
        assert_eq!(extract_python_port_from_env_content("WEB_UI_PORT=5555\n"), Some(5555));
    }

    #[test]
    fn test_extract_python_port_from_env_streamlit() {
        assert_eq!(extract_python_port_from_env_content("STREAMLIT_SERVER_PORT=8502\n"), Some(8502));
    }

    #[test]
    fn test_extract_python_port_from_env_gradio() {
        assert_eq!(extract_python_port_from_env_content("GRADIO_SERVER_PORT=7861\n"), Some(7861));
    }

    #[test]
    fn test_extract_python_port_from_env_django() {
        assert_eq!(extract_python_port_from_env_content("DJANGO_PORT=8001\n"), Some(8001));
    }

    #[test]
    fn test_extract_python_port_from_env_none() {
        assert_eq!(extract_python_port_from_env_content("OTHER_VAR=123\n"), None);
    }

    // --- Task 6: Venv detection tests ---

    #[test]
    fn test_detect_python_venv_dot_venv() {
        let dir = std::env::temp_dir().join("vm_test_venv_dot");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join(".venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join(".venv").join("bin"));

        let prefix = detect_python_venv(&dir);
        if cfg!(windows) {
            assert!(prefix.contains(r".venv\Scripts\"), "Windows: {}", prefix);
        } else {
            assert!(prefix.contains(".venv/bin/"), "Unix: {}", prefix);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_venv() {
        let dir = std::env::temp_dir().join("vm_test_venv_plain");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join("venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join("venv").join("bin"));

        let prefix = detect_python_venv(&dir);
        if cfg!(windows) {
            assert!(prefix.contains(r"venv\Scripts\"), "Windows: {}", prefix);
        } else {
            assert!(prefix.contains("venv/bin/"), "Unix: {}", prefix);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_conda() {
        let dir = std::env::temp_dir().join("vm_test_venv_conda");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("environment.yml"), "name: myenv\ndependencies:\n  - flask\n").unwrap();

        let prefix = detect_python_venv(&dir);
        assert!(prefix.contains("conda run -n myenv"), "Conda: {}", prefix);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_pipenv() {
        let dir = std::env::temp_dir().join("vm_test_venv_pipenv");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("Pipfile"), "[packages]\nflask = \"*\"\n").unwrap();

        let prefix = detect_python_venv(&dir);
        assert_eq!(prefix, "pipenv run ");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_none() {
        let dir = std::env::temp_dir().join("vm_test_venv_none");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        let prefix = detect_python_venv(&dir);
        assert_eq!(prefix, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_conda_env_name() {
        let content = "name: myproject\ndependencies:\n  - python=3.12\n";
        assert_eq!(read_conda_env_name_from_content(content), Some("myproject".to_string()));
    }

    #[test]
    fn test_read_conda_env_name_missing() {
        assert_eq!(read_conda_env_name_from_content("dependencies:\n  - flask\n"), None);
    }

    // --- Task 7: Python detection pipeline integration tests ---

    #[test]
    fn test_detect_python_servers_flask() {
        let dir = std::env::temp_dir().join("vm_test_py_flask");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "flask==2.0\nrequests\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\napp = Flask(__name__)\napp.run(port=5001)\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].framework, "Flask");
        assert_eq!(servers[0].port, 5001);
        assert!(servers[0].start_command.contains("app.py"));
        assert_eq!(servers[0].source, "requirements.txt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_django() {
        let dir = std::env::temp_dir().join("vm_test_py_django");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "django>=4.0\n").unwrap();
        std::fs::write(dir.join("manage.py"), "#!/usr/bin/env python\nimport os\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].framework, "Django");
        assert_eq!(servers[0].port, 8000);
        assert!(servers[0].start_command.contains("manage.py"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_with_env_port() {
        let dir = std::env::temp_dir().join("vm_test_py_env_port");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "flask\n").unwrap();
        std::fs::write(dir.join("run_ui.py"), "# main entry\n").unwrap();
        std::fs::write(dir.join(".env"), "WEB_UI_PORT=5555\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].port, 5555, "Should pick up WEB_UI_PORT from .env");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_generic_fallback() {
        let dir = std::env::temp_dir().join("vm_test_py_generic");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "requests\nnumpy\n").unwrap();
        std::fs::write(dir.join("run_ui.py"), "# server code\nport = 9000\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].framework, "Python");
        assert_eq!(servers[0].port, 9000);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_no_entry_file() {
        let dir = std::env::temp_dir().join("vm_test_py_no_entry");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "requests\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert!(servers.is_empty(), "No entry file should mean no detection");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_port_dedup() {
        let dir = std::env::temp_dir().join("vm_test_py_dedup");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "flask\n").unwrap();
        std::fs::write(dir.join("app.py"), "app.run(port=3000)\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        seen.insert(3000u16);

        let servers = detect_python_servers(&dir, &mut seen);
        assert!(servers.is_empty(), "Should be skipped due to port dedup");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_with_venv() {
        let dir = std::env::temp_dir().join("vm_test_py_venv_int");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join(".venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join(".venv").join("bin"));

        std::fs::write(dir.join("requirements.txt"), "flask\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        if cfg!(windows) {
            assert!(servers[0].start_command.contains(r".venv\Scripts\"), "Windows cmd: {}", servers[0].start_command);
        } else {
            assert!(servers[0].start_command.contains(".venv/bin/"), "Unix cmd: {}", servers[0].start_command);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_needs_setup_no_venv() {
        let dir = std::env::temp_dir().join("vm_test_py_needs_setup");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        // Create requirements.txt with flask
        std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
        // Create entry file
        std::fs::write(dir.join("app.py"), "from flask import Flask\napp = Flask(__name__)\n").unwrap();
        // NO .venv directory

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert!(servers[0].needs_setup, "Should need setup when no venv exists");
        assert!(!servers[0].setup_commands.is_empty(), "Should have setup commands");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_no_setup_with_venv() {
        let dir = std::env::temp_dir().join("vm_test_py_no_setup_venv");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();
        // Create .venv directory
        if cfg!(target_os = "windows") {
            std::fs::create_dir_all(dir.join(".venv").join("Scripts")).unwrap();
            std::fs::write(dir.join(".venv").join("Scripts").join("python.exe"), "").unwrap();
        } else {
            std::fs::create_dir_all(dir.join(".venv").join("bin")).unwrap();
            std::fs::write(dir.join(".venv").join("bin").join("python"), "").unwrap();
        }

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert!(!servers[0].needs_setup, "Should NOT need setup when venv exists");
        assert!(servers[0].setup_commands.is_empty(), "Should have no setup commands");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
