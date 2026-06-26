//! Node.js / JavaScript framework detection.
//!
//! Scans package.json scripts, vite.config.*, tauri.conf.json, and .env files
//! for known framework patterns and port configurations.

use std::path::Path;

use super::DetectedDevServer;
use super::util::{make_start_command, extract_port_from_url, extract_vite_port, extract_port_from_env, extract_port_flag};

/// Try to read a Bun entry file (e.g. `index.ts`) and extract the `port` value.
fn extract_bun_port_from_script(cmd: &str, root: &Path) -> Option<u16> {
    let entry = cmd.split_whitespace()
        .find(|part| {
            part.ends_with(".ts") || part.ends_with(".js")
                || part.ends_with(".tsx") || part.ends_with(".jsx")
        })?;
    let entry_path = root.join(entry);
    let content = std::fs::read_to_string(&entry_path).ok()?;
    let re = regex::Regex::new(r"port\s*[:=]\s*(\d{2,5})").ok()?;
    let caps = re.captures(&content)?;
    caps.get(1)?.as_str().parse::<u16>().ok()
}

/// Detect a dev server from `src-tauri/tauri.conf.json`'s `build.devUrl`.
pub(super) fn detect_from_tauri_conf(root: &Path, pkg_manager: &str) -> Option<DetectedDevServer> {
    let conf_path = root.join("src-tauri").join("tauri.conf.json");
    let content = std::fs::read_to_string(&conf_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let dev_url = json.get("build")?.get("devUrl")?.as_str()?;
    let port = extract_port_from_url(dev_url)?;
    Some(DetectedDevServer {
        framework: "Tauri".to_string(),
        port,
        url: dev_url.to_string(),
        // Run the actual Tauri app (`tauri dev`), not just the web frontend.
        // `tauri dev` runs the `beforeDevCommand` (the frontend) itself AND
        // compiles + launches the native app window — the window that exposes
        // CDP for the sandbox live preview. Running only the frontend (the old
        // `npm run dev`) served the web part but never started the app, so its
        // CDP port had nothing to connect to. One command = no port clash.
        start_command: make_start_command(pkg_manager, "tauri dev"),
        source: "tauri.conf.json".to_string(),
        running: false,
        ..Default::default()
    })
}

/// Detect a dev server from `vite.config.{js,ts,mjs,mts}` server.port.
pub(super) fn detect_from_vite_config(root: &Path, pkg_manager: &str) -> Option<DetectedDevServer> {
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

/// Detect a dev server from a `.env` file (`PORT` or `VITE_PORT`).
pub(super) fn detect_from_env(root: &Path, filename: &str, pkg_manager: &str) -> Option<DetectedDevServer> {
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

/// Detect dev servers from `package.json` scripts (`dev`, `start`, `serve`).
pub(super) fn detect_from_package_json(root: &Path, pkg_manager: &str) -> Vec<DetectedDevServer> {
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
    let script_keys = ["dev", "start", "serve"];
    for key in &script_keys {
        if let Some(cmd) = scripts.get(*key).and_then(|v| v.as_str()) {
            if let Some(mut server) = match_script_pattern(cmd, key, pkg_manager) {
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

/// Match a package.json script command against known framework patterns.
///
/// Returns a `DetectedDevServer` if the command matches a known framework.
/// Checks explicit `--port` / `-p` flags for port overrides.
pub(super) fn match_script_pattern(cmd: &str, script_key: &str, pkg_manager: &str) -> Option<DetectedDevServer> {
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

#[cfg(test)]
mod tests {
    use super::*;

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

        let servers = super::super::detect_dev_servers(dir.to_str().unwrap());
        assert!(!servers.is_empty());
        let vite = &servers[0];
        assert_eq!(vite.framework, "Vite");
        assert_eq!(vite.port, 4444);
        assert_eq!(vite.start_command, "yarn run dev");
        assert_eq!(vite.source, "package.json");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
