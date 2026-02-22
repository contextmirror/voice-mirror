//! LSP server discovery and detection.
//!
//! Maps file extensions to known language servers and checks
//! whether the server binary is available on PATH.

/// Information about a known language server.
#[derive(Debug, Clone)]
pub struct ServerInfo {
    pub language_id: String,
    pub binary: String,
    pub args: Vec<String>,
    pub installed: bool,
    /// The full resolved path from `which` (may be a .cmd on Windows).
    pub resolved_path: Option<std::path::PathBuf>,
}

/// On Windows, npm-installed servers are `.cmd` batch wrappers that break
/// stdio piping. Resolve the actual Node.js entry script and return
/// `("node", [script_path, ...original_args])` instead.
///
/// Reads each package's `package.json` `bin` field to find the correct
/// entry script (e.g. `lib/cli.mjs` for typescript-language-server,
/// `bin/vscode-json-language-server` for vscode-langservers-extracted).
#[cfg(target_os = "windows")]
pub fn resolve_node_script(info: &ServerInfo) -> Option<(String, Vec<String>)> {
    let resolved = info.resolved_path.as_ref()?;

    // Only handle .cmd wrappers
    if resolved
        .extension()
        .map(|ext| !ext.eq_ignore_ascii_case("cmd"))
        .unwrap_or(true)
    {
        return None;
    }

    let npm_dir = resolved.parent()?;
    let binary_name = resolved.file_stem()?.to_string_lossy().to_string();
    let node_modules = npm_dir.join("node_modules");

    if !node_modules.is_dir() {
        return None;
    }

    // Walk node_modules packages, read package.json bin field
    for entry in std::fs::read_dir(&node_modules).ok()? {
        let pkg_dir = entry.ok()?.path();
        let pkg_json = pkg_dir.join("package.json");
        if !pkg_json.exists() {
            continue;
        }

        let content = std::fs::read_to_string(&pkg_json).ok()?;
        let json: serde_json::Value = serde_json::from_str(&content).ok()?;

        // bin can be a string (single binary) or an object (multiple)
        let script_rel = match &json["bin"] {
            serde_json::Value::String(s) => {
                // Single binary: package name must match
                let pkg_name = json["name"].as_str().unwrap_or("");
                if pkg_name == binary_name {
                    Some(s.clone())
                } else {
                    None
                }
            }
            serde_json::Value::Object(map) => {
                map.get(&binary_name).and_then(|v| v.as_str()).map(|s| s.to_string())
            }
            _ => None,
        };

        if let Some(rel_path) = script_rel {
            let script = pkg_dir.join(&rel_path);
            if script.exists() {
                let node = which::which("node").ok()?;
                let mut args = vec![script.to_string_lossy().to_string()];
                args.extend(info.args.iter().cloned());
                return Some((node.to_string_lossy().to_string(), args));
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
pub fn resolve_node_script(_info: &ServerInfo) -> Option<(String, Vec<String>)> {
    None
}

/// Known language servers: (extensions, language_id, binary, args).
const LANGUAGE_SERVERS: &[(&[&str], &str, &str, &[&str])] = &[
    (
        &["js", "jsx", "mjs", "cjs", "ts", "tsx"],
        "typescript",
        "typescript-language-server",
        &["--stdio"],
    ),
    (&["rs"], "rust", "rust-analyzer", &[]),
    (
        &["py"],
        "python",
        "pyright-langserver",
        &["--stdio"],
    ),
    (
        &["css", "scss"],
        "css",
        "vscode-css-language-server",
        &["--stdio"],
    ),
    (
        &["html", "svelte"],
        "html",
        "vscode-html-language-server",
        &["--stdio"],
    ),
    (
        &["json"],
        "json",
        "vscode-json-language-server",
        &["--stdio"],
    ),
    (&["md", "markdown"], "markdown", "marksman", &[]),
];

/// Detect the language server for a given file extension.
///
/// Checks if the server binary exists on PATH via `which::which()`.
/// Returns `None` if no server is configured for the extension.
pub fn detect_for_extension(ext: &str) -> Option<ServerInfo> {
    let ext_lower = ext.to_lowercase();
    for &(extensions, language_id, binary, args) in LANGUAGE_SERVERS {
        if extensions.contains(&ext_lower.as_str()) {
            let resolved = which::which(binary).ok();
            let installed = resolved.is_some();
            return Some(ServerInfo {
                language_id: language_id.to_string(),
                binary: binary.to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                installed,
                resolved_path: resolved,
            });
        }
    }
    None
}

/// Look up just the language ID for a file extension, without checking PATH.
pub fn language_id_for_extension(ext: &str) -> Option<&'static str> {
    let ext_lower = ext.to_lowercase();
    for &(extensions, language_id, _, _) in LANGUAGE_SERVERS {
        if extensions.contains(&ext_lower.as_str()) {
            return Some(language_id);
        }
    }
    None
}

/// Check all known language servers and report which are installed.
pub fn detect_all() -> Vec<ServerInfo> {
    // Deduplicate by language_id (each server appears once)
    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();

    for &(_, language_id, binary, args) in LANGUAGE_SERVERS {
        if seen.insert(language_id) {
            let resolved = which::which(binary).ok();
            let installed = resolved.is_some();
            results.push(ServerInfo {
                language_id: language_id.to_string(),
                binary: binary.to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                installed,
                resolved_path: resolved,
            });
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_typescript_extensions() {
        for ext in &["js", "jsx", "mjs", "cjs", "ts", "tsx"] {
            let info = detect_for_extension(ext);
            assert!(info.is_some(), "Should detect server for .{}", ext);
            let info = info.unwrap();
            assert_eq!(info.language_id, "typescript");
            assert_eq!(info.binary, "typescript-language-server");
            assert_eq!(info.args, vec!["--stdio"]);
        }
    }

    #[test]
    fn test_rust_extension() {
        let info = detect_for_extension("rs").unwrap();
        assert_eq!(info.language_id, "rust");
        assert_eq!(info.binary, "rust-analyzer");
        assert!(info.args.is_empty());
    }

    #[test]
    fn test_python_extension() {
        let info = detect_for_extension("py").unwrap();
        assert_eq!(info.language_id, "python");
        assert_eq!(info.binary, "pyright-langserver");
    }

    #[test]
    fn test_css_extensions() {
        for ext in &["css", "scss"] {
            let info = detect_for_extension(ext).unwrap();
            assert_eq!(info.language_id, "css");
        }
    }

    #[test]
    fn test_html_extensions() {
        for ext in &["html", "svelte"] {
            let info = detect_for_extension(ext).unwrap();
            assert_eq!(info.language_id, "html");
        }
    }

    #[test]
    fn test_json_extension() {
        let info = detect_for_extension("json").unwrap();
        assert_eq!(info.language_id, "json");
    }

    #[test]
    fn test_markdown_extensions() {
        for ext in &["md", "markdown"] {
            let info = detect_for_extension(ext).unwrap();
            assert_eq!(info.language_id, "markdown");
            assert_eq!(info.binary, "marksman");
        }
    }

    #[test]
    fn test_unknown_extension() {
        assert!(detect_for_extension("xyz").is_none());
        assert!(detect_for_extension("").is_none());
    }

    #[test]
    fn test_case_insensitive() {
        let info = detect_for_extension("RS").unwrap();
        assert_eq!(info.language_id, "rust");

        let info = detect_for_extension("Py").unwrap();
        assert_eq!(info.language_id, "python");
    }

    #[test]
    fn test_language_id_for_extension() {
        assert_eq!(language_id_for_extension("rs"), Some("rust"));
        assert_eq!(language_id_for_extension("ts"), Some("typescript"));
        assert_eq!(language_id_for_extension("py"), Some("python"));
        assert_eq!(language_id_for_extension("xyz"), None);
    }

    #[test]
    fn test_detect_all_no_duplicates() {
        let all = detect_all();
        let mut ids: Vec<&str> = all.iter().map(|s| s.language_id.as_str()).collect();
        let before = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), before, "detect_all should not have duplicate language IDs");
    }
}
