//! Tauri commands for dependency and system tool detection.
//!
//! Scans the system for CLI tools that Voice Mirror uses as AI providers
//! (claude, opencode, ollama) and supporting tools (ffmpeg, cargo).
//! Also provides npm-based update capabilities for tools installed via npm.

use std::process::Command;

use super::IpcResponse;

/// Information about a single CLI tool.
#[derive(serde::Serialize)]
struct ToolInfo {
    name: String,
    available: bool,
    version: Option<String>,
    path: Option<String>,
}

/// Detect a CLI tool by running `<tool> --version` and `which`/`where`.
fn detect_tool(name: &str) -> ToolInfo {
    let mut info = ToolInfo {
        name: name.to_string(),
        available: false,
        version: None,
        path: None,
    };

    // Detect path using `where` (Windows) or `which` (Unix)
    let path_cmd = if cfg!(target_os = "windows") {
        Command::new("where")
            .arg(name)
            .output()
    } else {
        Command::new("which")
            .arg(name)
            .output()
    };

    if let Ok(output) = path_cmd {
        if output.status.success() {
            let raw_paths = String::from_utf8_lossy(&output.stdout);
            // `where` can return multiple lines; prefer .exe over .cmd shims
            let mut best_path: Option<String> = None;
            for line in raw_paths.lines() {
                let p = line.trim().to_string();
                if p.is_empty() { continue; }
                if p.ends_with(".exe") {
                    best_path = Some(p);
                    break;
                }
                if best_path.is_none() {
                    best_path = Some(p);
                }
            }
            if let Some(p) = best_path {
                info.path = Some(p);
            }
        }
    }

    // Try `--version` to get version info.
    // Some tools need cmd.exe on Windows because they're .cmd/.bat shims.
    // But standalone .exe files should NOT use cmd.exe (it can mask errors).
    let is_exe = info.path.as_ref().map_or(false, |p| p.ends_with(".exe"));
    let needs_shell = cfg!(target_os = "windows") && !is_exe;

    let version_result = if needs_shell {
        Command::new("cmd")
            .args(["/C", &format!("{} --version", name)])
            .output()
    } else if let Some(ref exe_path) = info.path {
        // Use the full path for .exe files to avoid PATH issues
        Command::new(exe_path)
            .arg("--version")
            .output()
    } else {
        Command::new(name)
            .arg("--version")
            .output()
    };

    if let Ok(output) = version_result {
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();

            if !raw.is_empty() {
                let ver = parse_version(&raw);
                // Only mark as available if we got something that looks like a version
                if ver.chars().any(|c| c.is_ascii_digit()) {
                    info.available = true;
                    info.version = Some(ver);
                }
            }
        } else {
            // Some tools output version to stderr (e.g., older cargo)
            let stderr = String::from_utf8_lossy(&output.stderr)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !stderr.is_empty() && stderr.contains(char::is_numeric) {
                info.available = true;
                info.version = Some(parse_version(&stderr));
            }
        }
    }

    // Fallback: if path was found but --version didn't work, try npm package.json
    // This handles tools like opencode that don't support --version.
    if !info.available && info.path.is_some() {
        if let Some(ver) = try_npm_package_version(name) {
            info.available = true;
            info.version = Some(ver);
        } else {
            // Path exists, so the tool is installed even if we can't get version
            info.available = true;
        }
    }

    info
}

/// Try to read version from an npm global package.json for tools installed via npm.
/// Maps tool binary names to their npm package names.
fn try_npm_package_version(tool_name: &str) -> Option<String> {
    let npm_pkg_dir = match tool_name {
        "opencode" => "opencode-ai",
        "claude" => "@anthropic-ai/claude-code",
        _ => return None,
    };

    // On Windows: %APPDATA%\npm\node_modules\<pkg>\package.json
    // On Unix: /usr/local/lib/node_modules/<pkg>/package.json or ~/.npm-global/...
    let npm_root = if cfg!(target_os = "windows") {
        std::env::var("APPDATA").ok().map(|d| {
            std::path::PathBuf::from(d).join("npm").join("node_modules")
        })
    } else {
        // Try common npm global prefix locations
        let output = Command::new("npm").args(["root", "-g"]).output().ok()?;
        if output.status.success() {
            let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Some(std::path::PathBuf::from(root))
        } else {
            None
        }
    };

    let pkg_json = npm_root?.join(npm_pkg_dir).join("package.json");
    let content = std::fs::read_to_string(pkg_json).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json["version"].as_str().map(|s| s.to_string())
}

/// Extract version number from a version string.
/// Handles formats like "cargo 1.75.0 (hash date)", "ollama version is 0.15.6", etc.
fn parse_version(raw: &str) -> String {
    let cleaned = raw
        .trim_start_matches("cargo ")
        .trim_start_matches("ollama version is ")
        .trim_start_matches("ollama version ")
        .trim_start_matches("claude ")
        .trim_start_matches("opencode ")
        .trim_start_matches("ffmpeg version ")
        .trim_start_matches('v')
        .trim();

    // Take up to the first space or parenthesis (some tools append extra info)
    cleaned
        .split([' ', '(', '\t', '-'])
        .next()
        .unwrap_or(cleaned)
        .to_string()
}

/// Scan all known CLI tools and return their status.
///
/// Checks: claude, opencode, ollama, cargo
#[tauri::command]
pub fn scan_cli_tools() -> IpcResponse {
    let tools = vec!["claude", "opencode", "ollama", "cargo"];

    let results: Vec<ToolInfo> = tools
        .into_iter()
        .map(detect_tool)
        .collect();

    IpcResponse::ok(serde_json::json!({
        "tools": results
    }))
}

/// Run an npm command via shell (npm is a .cmd wrapper on Windows).
fn run_npm(args: &[&str]) -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        let cmd_str = format!("npm {}", args.join(" "));
        Command::new("cmd")
            .args(["/C", &cmd_str])
            .output()
    } else {
        Command::new("npm")
            .args(args)
            .output()
    };

    match output {
        Ok(o) if o.status.success() => {
            Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !stdout.is_empty() {
                Ok(stdout)
            } else {
                Err(stderr)
            }
        }
        Err(e) => Err(format!("Failed to run npm: {}", e)),
    }
}

/// Check all system dependencies and return their status.
///
/// Returns a unified view of all external tools the app relies on:
///   - AI providers: Claude Code, OpenCode
///   - Services: Ollama, ffmpeg
/// Also checks npm registry for latest versions of updatable packages.
#[tauri::command]
pub fn check_npm_versions() -> IpcResponse {
    // Detect system tools
    let system_tools = vec![
        ("claude", "claude"),
        ("opencode", "opencode"),
        ("ollama", "ollama"),
        ("ffmpeg", "ffmpeg"),
    ];

    let mut system = serde_json::Map::new();
    for (tool_name, key) in &system_tools {
        let info = detect_tool(tool_name);

        // For npm-installable tools, also check latest version from registry
        let (latest, update_available) = match *tool_name {
            "claude" => {
                let latest = get_npm_registry_version("@anthropic-ai/claude-code");
                let update = match (&info.version, &latest) {
                    (Some(inst), Some(lat)) => inst != lat,
                    _ => false,
                };
                (latest, update)
            }
            "opencode" => {
                let latest = get_npm_registry_version("opencode-ai");
                let update = match (&info.version, &latest) {
                    (Some(inst), Some(lat)) => inst != lat,
                    _ => false,
                };
                (latest, update)
            }
            _ => (None, false),
        };

        system.insert(
            key.to_string(),
            serde_json::json!({
                "version": info.version,
                "installed": info.available,
                "path": info.path,
                "latest": latest,
                "updateAvailable": update_available,
            }),
        );
    }

    IpcResponse::ok(serde_json::json!({
        "system": system,
    }))
}

/// Get the latest version of an npm package from the registry.
fn get_npm_registry_version(package: &str) -> Option<String> {
    let output = run_npm(&["view", package, "version"]).ok()?;
    let version = output.trim().to_string();
    if version.is_empty() { None } else { Some(version) }
}

/// Update a tool via npm global install.
///
/// Maps tool keys to their npm package names and runs `npm install -g <pkg>@latest`.
#[tauri::command]
pub fn update_npm_package(package: String) -> IpcResponse {
    // Map tool keys to npm package names
    let npm_name = match package.as_str() {
        "claude" | "@anthropic-ai/claude-code" => "@anthropic-ai/claude-code",
        "opencode" | "opencode-ai" => "opencode-ai",
        _ => {
            return IpcResponse::err(format!(
                "Package '{}' is not updatable via npm",
                package
            ));
        }
    };

    let install_arg = format!("{}@latest", npm_name);
    match run_npm(&["install", "-g", &install_arg]) {
        Ok(_) => IpcResponse::ok(serde_json::json!({
            "updated": true,
            "package": npm_name,
        })),
        Err(e) => IpcResponse::err(format!("npm install failed: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_version_semver() {
        assert_eq!(parse_version("v20.10.0"), "20.10.0");
        assert_eq!(parse_version("10.2.3"), "10.2.3");
    }

    #[test]
    fn test_parse_version_cargo() {
        assert_eq!(parse_version("cargo 1.75.0 (1d8b05cdd 2023-11-20)"), "1.75.0");
    }

    #[test]
    fn test_parse_version_ollama() {
        assert_eq!(parse_version("ollama version 0.1.24"), "0.1.24");
    }

    #[test]
    fn test_parse_version_ollama_is() {
        assert_eq!(parse_version("ollama version is 0.15.6"), "0.15.6");
    }

    #[test]
    fn test_parse_version_claude() {
        assert_eq!(parse_version("2.1.47 (Claude Code)"), "2.1.47");
    }

    #[test]
    fn test_parse_version_ffmpeg() {
        assert_eq!(parse_version("ffmpeg version 6.1.1"), "6.1.1");
    }

    #[test]
    fn test_detect_tool_returns_struct() {
        let info = detect_tool("ollama");
        assert_eq!(info.name, "ollama");
    }

    #[test]
    fn test_scan_cli_tools_returns_all() {
        let response = scan_cli_tools();
        assert!(response.success);
        let data = response.data.unwrap();
        let tools = data["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 4);

        let names: Vec<&str> = tools
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"claude"));
        assert!(names.contains(&"opencode"));
        assert!(names.contains(&"ollama"));
        assert!(names.contains(&"cargo"));
    }

    #[test]
    fn test_check_npm_versions_returns_system() {
        let response = check_npm_versions();
        assert!(response.success);
        let data = response.data.unwrap();
        let system = data["system"].as_object().unwrap();
        assert!(system.contains_key("claude"));
        assert!(system.contains_key("opencode"));
        assert!(system.contains_key("ollama"));
        assert!(system.contains_key("ffmpeg"));
    }
}
