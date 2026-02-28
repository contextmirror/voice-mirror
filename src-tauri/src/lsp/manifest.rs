//! manifest.rs -- Parse and query the LSP server registry manifest.
//!
//! The manifest (lsp-servers.json) defines all supported language servers,
//! how to install them, and their configuration. Embedded at compile time.

use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The full manifest file structure.
#[derive(Debug, Clone, Deserialize)]
pub struct ServerManifest {
    pub servers: HashMap<String, ServerEntry>,
}

/// A single language server entry in the manifest.
#[derive(Debug, Clone, Deserialize)]
pub struct ServerEntry {
    pub name: String,
    pub languages: Vec<String>,
    pub extensions: Vec<String>,
    #[serde(rename = "excludeExtensions", default)]
    pub exclude_extensions: Vec<String>,
    pub install: InstallConfig,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(rename = "restartPolicy", default = "default_restart_policy")]
    pub restart_policy: String,
    #[serde(rename = "initializationOptions", default)]
    pub initialization_options: serde_json::Value,
    #[serde(default)]
    pub settings: serde_json::Value,
}

/// How to install this server.
#[derive(Debug, Clone, Deserialize)]
pub struct InstallConfig {
    #[serde(rename = "type")]
    pub install_type: String,
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub version: String,
    /// GitHub repo for github-release type (e.g., "rust-lang/rust-analyzer").
    #[serde(default)]
    pub repo: String,
    /// Asset name pattern for github-release (e.g., "rust-analyzer-{arch}-{os}.gz").
    #[serde(default, rename = "assetPattern")]
    pub asset_pattern: String,
}

fn default_priority() -> String {
    "primary".to_string()
}
fn default_true() -> bool {
    true
}
fn default_restart_policy() -> String {
    "on-crash".to_string()
}

/// The embedded manifest JSON (compiled into the binary).
const MANIFEST_JSON: &str = include_str!("lsp-servers.json");

/// Load and parse the embedded manifest.
pub fn load_manifest() -> Result<ServerManifest, String> {
    serde_json::from_str(MANIFEST_JSON)
        .map_err(|e| format!("Failed to parse LSP manifest: {}", e))
}

/// Find the best server for a file extension.
/// Returns (server_id, server_entry) or None if no server handles this extension.
/// Respects `excludeExtensions` -- a server won't be returned if the extension is excluded.
/// Prefers `primary` servers over `supplementary` ones when multiple servers match.
pub fn find_server_for_extension(
    manifest: &ServerManifest,
    ext: &str,
) -> Option<(String, ServerEntry)> {
    let dot_ext = if ext.starts_with('.') {
        ext.to_lowercase()
    } else {
        format!(".{}", ext.to_lowercase())
    };

    let mut best: Option<(String, ServerEntry)> = None;

    for (id, entry) in &manifest.servers {
        if !entry.enabled {
            continue;
        }
        if entry
            .exclude_extensions
            .iter()
            .any(|e| e.to_lowercase() == dot_ext)
        {
            continue;
        }
        if entry
            .extensions
            .iter()
            .any(|e| e.to_lowercase() == dot_ext)
        {
            // Primary servers always win over supplementary
            if entry.priority == "primary" {
                return Some((id.clone(), entry.clone()));
            }
            // Keep the first supplementary match as fallback
            if best.is_none() {
                best = Some((id.clone(), entry.clone()));
            }
        }
    }
    best
}

/// Find ALL servers matching a file extension.
/// Returns all matching servers sorted: primary first, then supplementary.
/// Unlike `find_server_for_extension` (which returns only the best match),
/// this returns every enabled server whose extensions list includes the given ext.
pub fn find_servers_for_extension(
    manifest: &ServerManifest,
    ext: &str,
) -> Vec<(String, ServerEntry)> {
    let dot_ext = if ext.starts_with('.') {
        ext.to_lowercase()
    } else {
        format!(".{}", ext.to_lowercase())
    };

    let mut results = Vec::new();
    for (id, entry) in &manifest.servers {
        if !entry.enabled {
            continue;
        }
        if entry
            .exclude_extensions
            .iter()
            .any(|e| e.to_lowercase() == dot_ext)
        {
            continue;
        }
        if entry
            .extensions
            .iter()
            .any(|e| e.to_lowercase() == dot_ext)
        {
            results.push((id.clone(), entry.clone()));
        }
    }
    // Sort: primary first, then supplementary (stable within each group)
    results.sort_by(|(_, a), (_, b)| match (a.priority.as_str(), b.priority.as_str()) {
        ("primary", "supplementary") => std::cmp::Ordering::Less,
        ("supplementary", "primary") => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Equal,
    });
    results
}

/// Resolve the binary path for a server.
/// Checks: 1) user PATH, 2) managed lsp-servers/node_modules/.bin/
///
/// On Windows, prefers `.cmd` wrappers over extensionless bash scripts
/// in node_modules/.bin/ because `resolve_node_script` needs the `.cmd`
/// extension to locate the actual Node.js entry script.
pub fn find_binary_path(command: &str, lsp_servers_dir: &Path) -> Option<PathBuf> {
    // 1. Check user PATH
    if let Ok(path) = which::which(command) {
        return Some(path);
    }

    // 2. Check managed bin/ directory (for native binaries like rust-analyzer)
    let native_bin_dir = lsp_servers_dir.join("bin");
    #[cfg(windows)]
    {
        let exe_path = native_bin_dir.join(format!("{}.exe", command));
        if exe_path.exists() {
            return Some(exe_path);
        }
    }
    let native_path = native_bin_dir.join(command);
    if native_path.exists() {
        return Some(native_path);
    }

    // 3. Check managed node_modules/.bin/
    let bin_dir = lsp_servers_dir.join("node_modules").join(".bin");

    // On Windows, prefer .cmd wrapper — the extensionless file is a bash script
    // that can't run natively. resolve_node_script() needs the .cmd extension
    // to find the actual Node.js entry script for proper stdio piping.
    #[cfg(windows)]
    {
        let cmd_path = bin_dir.join(format!("{}.cmd", command));
        if cmd_path.exists() {
            return Some(cmd_path);
        }
    }

    let bin_path = bin_dir.join(command);
    if bin_path.exists() {
        return Some(bin_path);
    }

    None
}

/// Apply user overrides to a server entry.
/// User overrides can change: enabled, initializationOptions, settings.
pub fn apply_overrides(entry: &mut ServerEntry, overrides: &serde_json::Value) {
    if let Some(enabled) = overrides.get("enabled").and_then(|v| v.as_bool()) {
        entry.enabled = enabled;
    }
    if let Some(init_opts) = overrides.get("initializationOptions") {
        entry.initialization_options = init_opts.clone();
    }
    if let Some(settings) = overrides.get("settings") {
        entry.settings = settings.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_manifest() {
        let manifest = load_manifest().expect("Manifest should parse");
        assert!(manifest.servers.contains_key("svelte"));
        assert!(manifest.servers.contains_key("typescript"));
        assert!(manifest.servers.contains_key("css"));
        assert!(manifest.servers.contains_key("html"));
        assert!(manifest.servers.contains_key("json"));
    }

    #[test]
    fn test_find_server_for_svelte() {
        let manifest = load_manifest().unwrap();
        let result = find_server_for_extension(&manifest, "svelte");
        assert!(result.is_some());
        let (id, _) = result.unwrap();
        assert_eq!(id, "svelte");
    }

    #[test]
    fn test_typescript_excluded_from_svelte() {
        let manifest = load_manifest().unwrap();
        // .svelte should NOT match typescript (excludeExtensions)
        let ts = &manifest.servers["typescript"];
        assert!(ts.exclude_extensions.contains(&".svelte".to_string()));
    }

    #[test]
    fn test_find_server_for_js() {
        let manifest = load_manifest().unwrap();
        let result = find_server_for_extension(&manifest, "js");
        assert!(result.is_some());
        let (id, _) = result.unwrap();
        assert_eq!(id, "typescript");
    }

    #[test]
    fn test_find_server_for_unknown() {
        let manifest = load_manifest().unwrap();
        let result = find_server_for_extension(&manifest, "xyz");
        assert!(result.is_none());
    }

    #[test]
    fn test_apply_overrides_disabled() {
        let manifest = load_manifest().unwrap();
        let mut entry = manifest.servers["typescript"].clone();
        assert!(entry.enabled);
        apply_overrides(&mut entry, &serde_json::json!({"enabled": false}));
        assert!(!entry.enabled);
    }

    #[test]
    fn test_eslint_in_manifest() {
        let manifest = load_manifest().unwrap();
        assert!(manifest.servers.contains_key("eslint"), "Manifest should contain eslint");
        let eslint = &manifest.servers["eslint"];
        assert_eq!(eslint.priority, "supplementary");
        assert_eq!(eslint.command, "vscode-eslint-language-server");
        assert!(eslint.extensions.contains(&".js".to_string()));
        assert!(eslint.extensions.contains(&".ts".to_string()));
        assert!(eslint.exclude_extensions.contains(&".svelte".to_string()));
    }

    #[test]
    fn test_primary_preferred_over_supplementary() {
        let manifest = load_manifest().unwrap();
        // Both typescript (primary) and eslint (supplementary) match .js
        let result = find_server_for_extension(&manifest, "js");
        assert!(result.is_some());
        let (id, _) = result.unwrap();
        assert_eq!(id, "typescript", "Primary server should be preferred over supplementary");
    }

    #[test]
    fn test_rust_analyzer_in_manifest() {
        let manifest = load_manifest().unwrap();
        assert!(manifest.servers.contains_key("rust-analyzer"), "Manifest should contain rust-analyzer");
        let ra = &manifest.servers["rust-analyzer"];
        assert_eq!(ra.install.install_type, "github-release");
        assert_eq!(ra.install.repo, "rust-lang/rust-analyzer");
        assert!(!ra.install.asset_pattern.is_empty(), "asset_pattern should not be empty");
        assert!(ra.extensions.contains(&".rs".to_string()));
        assert_eq!(ra.command, "rust-analyzer");
        assert_eq!(ra.priority, "primary");
    }

    #[test]
    fn test_find_server_for_rs() {
        let manifest = load_manifest().unwrap();
        let result = find_server_for_extension(&manifest, "rs");
        assert!(result.is_some(), "Should find a server for .rs files");
        let (id, _) = result.unwrap();
        assert_eq!(id, "rust-analyzer");
    }

    #[test]
    fn test_github_release_install_config_fields() {
        let manifest = load_manifest().unwrap();
        let ra = &manifest.servers["rust-analyzer"];
        assert!(ra.install.packages.is_empty(), "github-release should have empty packages");
        assert!(ra.install.asset_pattern.contains("{arch}"), "assetPattern should contain {{arch}} placeholder");
        assert!(ra.install.asset_pattern.contains("{os}"), "assetPattern should contain {{os}} placeholder");
    }

    #[test]
    fn test_find_servers_for_extension_returns_all() {
        let manifest = load_manifest().unwrap();
        let results = find_servers_for_extension(&manifest, "js");
        assert!(results.len() >= 2, "Should return at least 2 servers for .js");
        let ids: Vec<&str> = results.iter().map(|(id, _)| id.as_str()).collect();
        assert!(ids.contains(&"typescript"), "Should include typescript");
        assert!(ids.contains(&"eslint"), "Should include eslint");
    }

    #[test]
    fn test_find_servers_sorts_primary_first() {
        let manifest = load_manifest().unwrap();
        let results = find_servers_for_extension(&manifest, "js");
        assert!(!results.is_empty());
        assert_eq!(results[0].1.priority, "primary", "First result should be primary");
        if results.len() > 1 {
            let first_supp = results.iter().position(|(_, e)| e.priority == "supplementary");
            let last_primary = results.iter().rposition(|(_, e)| e.priority == "primary");
            if let (Some(supp_idx), Some(prim_idx)) = (first_supp, last_primary) {
                assert!(prim_idx < supp_idx, "All primary servers should come before supplementary");
            }
        }
    }

    #[test]
    fn test_find_servers_respects_exclude() {
        let manifest = load_manifest().unwrap();
        let results = find_servers_for_extension(&manifest, "svelte");
        let ids: Vec<&str> = results.iter().map(|(id, _)| id.as_str()).collect();
        assert!(!ids.contains(&"typescript"), "typescript should be excluded for .svelte");
        assert!(!ids.contains(&"eslint"), "eslint should be excluded for .svelte");
        assert!(ids.contains(&"svelte"), "svelte server should match .svelte");
    }

    #[test]
    fn test_find_servers_empty_for_unknown() {
        let manifest = load_manifest().unwrap();
        let results = find_servers_for_extension(&manifest, "xyz");
        assert!(results.is_empty(), "No servers should match .xyz");
    }
}
