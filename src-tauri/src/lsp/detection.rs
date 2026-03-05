//! LSP server discovery and detection.
//!
//! Maps file extensions to language servers using the embedded manifest
//! (lsp-servers.json) and checks whether the server binary is available
//! on PATH or in the managed lsp-servers/ directory.

/// Information about a known language server.
#[derive(Debug, Clone)]
pub struct ServerInfo {
    pub language_id: String,
    pub binary: String,
    pub args: Vec<String>,
    pub installed: bool,
    /// The full resolved path from `which` or managed dir (may be a .cmd on Windows).
    pub resolved_path: Option<std::path::PathBuf>,
    /// The server ID from the manifest (e.g., "typescript", "svelte").
    pub server_id: Option<String>,
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

    let bin_dir = resolved.parent()?;
    let binary_name = resolved.file_stem()?.to_string_lossy().to_string();

    // The .cmd file can be in two locations:
    // 1. Global npm prefix: C:\Users\...\npm\svelteserver.cmd
    //    → node_modules is at npm_dir/node_modules/
    // 2. Managed lsp-servers: .../lsp-servers/node_modules/.bin/svelteserver.cmd
    //    → node_modules is the parent of .bin/ (i.e., bin_dir's parent)
    let node_modules = if bin_dir.ends_with("node_modules/.bin")
        || bin_dir.ends_with(std::path::Path::new("node_modules").join(".bin"))
    {
        // Case 2: .bin/ is inside node_modules — go up one level
        bin_dir.parent()?.to_path_buf()
    } else {
        // Case 1: global npm prefix — node_modules is a child
        bin_dir.join("node_modules")
    };

    if !node_modules.is_dir() {
        return None;
    }

    // Walk node_modules packages, read package.json bin field
    for entry in std::fs::read_dir(&node_modules).ok()? {
        let pkg_dir = entry.ok()?.path();

        // Handle scoped packages (@scope/package) — descend one level
        if pkg_dir
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('@'))
            .unwrap_or(false)
        {
            if let Ok(scoped_entries) = std::fs::read_dir(&pkg_dir) {
                for scoped_entry in scoped_entries.flatten() {
                    if let Some(result) =
                        try_resolve_bin(&scoped_entry.path(), &binary_name, &info.args)
                    {
                        return Some(result);
                    }
                }
            }
            continue;
        }

        if let Some(result) = try_resolve_bin(&pkg_dir, &binary_name, &info.args) {
            return Some(result);
        }
    }

    None
}

/// Try to resolve a binary name from a package directory's package.json bin field.
fn try_resolve_bin(
    pkg_dir: &std::path::Path,
    binary_name: &str,
    extra_args: &[String],
) -> Option<(String, Vec<String>)> {
    let pkg_json = pkg_dir.join("package.json");
    if !pkg_json.exists() {
        return None;
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
            map.get(binary_name).and_then(|v| v.as_str()).map(|s| s.to_string())
        }
        _ => None,
    };

    if let Some(rel_path) = script_rel {
        let script = pkg_dir.join(&rel_path);
        if script.exists() {
            let node = which::which("node").ok()?;
            let mut args = vec![script.to_string_lossy().to_string()];
            args.extend(extra_args.iter().cloned());
            return Some((node.to_string_lossy().to_string(), args));
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
pub fn resolve_node_script(_info: &ServerInfo) -> Option<(String, Vec<String>)> {
    None
}

/// Detect the language server for a given file extension.
///
/// Uses the embedded manifest to find the best server, then checks
/// if the binary exists on PATH or in the managed lsp-servers/ directory.
/// Returns `None` if no server is configured for the extension.
pub fn detect_for_extension(ext: &str) -> Option<ServerInfo> {
    let manifest = super::manifest::load_manifest().ok()?;
    let lsp_dir = super::installer::get_lsp_servers_dir().ok();
    if lsp_dir.is_none() {
        tracing::warn!("Could not determine lsp-servers dir; managed installs will not be detected");
    }
    let (id, mut entry) = super::manifest::find_server_for_extension(&manifest, ext)?;

    // Apply user config overrides (e.g. enabled: false)
    if let Ok(guard) = crate::commands::config::CONFIG.lock() {
        if let Some(overrides) = guard.lsp_servers.get(&id) {
            super::manifest::apply_overrides(&mut entry, overrides);
        }
    }
    if !entry.enabled {
        return None;
    }

    // Try to find the binary: 1) PATH, 2) managed lsp-servers/
    let resolved = if let Some(ref dir) = lsp_dir {
        super::manifest::find_binary_path(&entry.command, dir)
    } else {
        which::which(&entry.command).ok()
    };

    let installed = resolved.is_some();

    // Use the server ID as the language_id (e.g., "typescript", "css").
    // This matches the keys used in LspManager.servers and extension_for_language().
    // Note: entry.languages contains LSP languageIds (e.g., "javascript", "typescript")
    // which are used in textDocument/didOpen, but we need the server key here.
    let language_id = id.clone();

    Some(ServerInfo {
        language_id,
        binary: entry.command.clone(),
        args: entry.args.clone(),
        installed,
        resolved_path: resolved,
        server_id: Some(id),
    })
}

/// Look up just the language ID (server key) for a file extension, without checking PATH.
///
/// Returns the server ID from the manifest (e.g., "typescript", "css", "svelte").
/// Returns `None` if no server is configured for the extension.
pub fn language_id_for_extension(ext: &str) -> Option<String> {
    let manifest = super::manifest::load_manifest().ok()?;
    let (id, _) = super::manifest::find_server_for_extension(&manifest, ext)?;
    Some(id)
}

/// Detect ALL language servers for a given file extension (primary + supplementary).
///
/// Uses the embedded manifest to find all matching servers, then checks
/// if each binary exists on PATH or in the managed lsp-servers/ directory.
/// Returns an empty vec if no server is configured for the extension.
pub fn detect_all_for_extension(ext: &str) -> Vec<ServerInfo> {
    let manifest = match super::manifest::load_manifest() {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    let lsp_dir = super::installer::get_lsp_servers_dir().ok();

    let entries = super::manifest::find_servers_for_extension(&manifest, ext);

    let mut results = Vec::new();
    for (id, mut entry) in entries {
        // Apply user config overrides (e.g. enabled: false)
        if let Ok(guard) = crate::commands::config::CONFIG.lock() {
            if let Some(overrides) = guard.lsp_servers.get(&id) {
                super::manifest::apply_overrides(&mut entry, overrides);
            }
        }
        if !entry.enabled {
            continue;
        }

        let resolved = if let Some(ref dir) = lsp_dir {
            super::manifest::find_binary_path(&entry.command, dir)
        } else {
            which::which(&entry.command).ok()
        };

        let installed = resolved.is_some();
        let language_id = id.clone();

        results.push(ServerInfo {
            language_id,
            binary: entry.command.clone(),
            args: entry.args.clone(),
            installed,
            resolved_path: resolved,
            server_id: Some(id),
        });
    }
    results
}

/// Look up ALL server IDs (lang_ids) for a file extension, without checking PATH.
///
/// Returns all matching server IDs from the manifest sorted by priority
/// (primary first, then supplementary). Used for multi-server file operations.
pub fn language_ids_for_extension(ext: &str) -> Vec<String> {
    let manifest = match super::manifest::load_manifest() {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    super::manifest::find_servers_for_extension(&manifest, ext)
        .into_iter()
        .map(|(id, _)| id)
        .collect()
}

/// Check all known language servers and report which are installed.
///
/// Iterates all enabled servers from the manifest and checks binary availability.
pub fn detect_all() -> Vec<ServerInfo> {
    let manifest = match super::manifest::load_manifest() {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    let lsp_dir = super::installer::get_lsp_servers_dir().ok();

    // Load user overrides from config
    let overrides = crate::commands::config::CONFIG
        .lock()
        .ok()
        .map(|guard| guard.lsp_servers.clone())
        .unwrap_or_default();

    let mut results = Vec::new();
    // Sort by server ID for deterministic ordering (HashMap iteration is random)
    let mut entries: Vec<(String, super::manifest::ServerEntry)> = manifest.servers.into_iter().collect();
    entries.sort_by(|(a, _), (b, _)| a.cmp(b));
    for (id, mut entry) in entries {
        // Apply user config overrides (e.g. enabled: false)
        if let Some(ov) = overrides.get(&id) {
            super::manifest::apply_overrides(&mut entry, ov);
        }
        if !entry.enabled {
            continue;
        }

        let resolved = if let Some(ref dir) = lsp_dir {
            super::manifest::find_binary_path(&entry.command, dir)
        } else {
            which::which(&entry.command).ok()
        };
        let installed = resolved.is_some();
        let language_id = id.clone();

        results.push(ServerInfo {
            language_id,
            binary: entry.command.clone(),
            args: entry.args.clone(),
            installed,
            resolved_path: resolved,
            server_id: Some(id.clone()),
        });
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
            assert_eq!(info.binary, "vtsls");
            assert_eq!(info.args, vec!["--stdio"]);
            assert_eq!(info.server_id.as_deref(), Some("typescript"));
        }
    }

    #[test]
    fn test_css_extensions() {
        for ext in &["css", "scss"] {
            let info = detect_for_extension(ext).unwrap();
            assert_eq!(info.language_id, "css");
            assert_eq!(info.server_id.as_deref(), Some("css"));
        }
    }

    #[test]
    fn test_svelte_extension() {
        let info = detect_for_extension("svelte").unwrap();
        assert_eq!(info.language_id, "svelte");
        assert_eq!(info.server_id.as_deref(), Some("svelte"));
        assert_eq!(info.binary, "svelteserver");
    }

    #[test]
    fn test_html_extension() {
        let info = detect_for_extension("html").unwrap();
        assert_eq!(info.language_id, "html");
        assert_eq!(info.server_id.as_deref(), Some("html"));
    }

    #[test]
    fn test_json_extension() {
        let info = detect_for_extension("json").unwrap();
        assert_eq!(info.language_id, "json");
        assert_eq!(info.server_id.as_deref(), Some("json"));
    }

    #[test]
    fn test_rust_extension() {
        let info = detect_for_extension("rs").unwrap();
        assert_eq!(info.language_id, "rust-analyzer");
        assert_eq!(info.server_id.as_deref(), Some("rust-analyzer"));
        assert_eq!(info.binary, "rust-analyzer");
    }

    #[test]
    fn test_unknown_extension() {
        assert!(detect_for_extension("xyz").is_none());
        assert!(detect_for_extension("").is_none());
    }

    #[test]
    fn test_case_insensitive() {
        // Extensions in the manifest are lowercase, but lookup should be
        // case-insensitive (find_server_for_extension lowercases the input).
        let info = detect_for_extension("CSS").unwrap();
        assert_eq!(info.language_id, "css");

        let info = detect_for_extension("Json").unwrap();
        assert_eq!(info.language_id, "json");
    }

    #[test]
    fn test_language_id_for_extension() {
        assert_eq!(language_id_for_extension("ts"), Some("typescript".to_string()));
        assert_eq!(language_id_for_extension("css"), Some("css".to_string()));
        assert_eq!(language_id_for_extension("svelte"), Some("svelte".to_string()));
        assert_eq!(language_id_for_extension("rs"), Some("rust-analyzer".to_string()));
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

    #[test]
    fn test_detect_all_has_server_ids() {
        let all = detect_all();
        for info in &all {
            assert!(info.server_id.is_some(), "All detect_all entries should have server_id");
        }
    }

    #[test]
    fn test_detect_all_covers_manifest_servers() {
        let all = detect_all();
        let ids: Vec<&str> = all.iter().filter_map(|s| s.server_id.as_deref()).collect();
        // All enabled manifest servers should appear
        assert!(ids.contains(&"typescript"), "Should include typescript");
        assert!(ids.contains(&"svelte"), "Should include svelte");
        assert!(ids.contains(&"css"), "Should include css");
        assert!(ids.contains(&"html"), "Should include html");
        assert!(ids.contains(&"json"), "Should include json");
        assert!(ids.contains(&"eslint"), "Should include eslint");
        assert!(ids.contains(&"rust-analyzer"), "Should include rust-analyzer");
    }

    #[test]
    fn test_primary_preferred_over_supplementary() {
        // For .js, both typescript (primary) and eslint (supplementary) match.
        // find_server_for_extension should return the primary server.
        let info = detect_for_extension("js").unwrap();
        assert_eq!(info.language_id, "typescript", "Primary server should be preferred for .js");
    }
}
