# LSP Server Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded language server detection with a manifest-driven system that auto-downloads LSP servers via npm and routes file types correctly (eliminating bogus .svelte diagnostics).

**Architecture:** A JSON manifest defines supported servers. On file open, the manifest is consulted to find the right server. If not installed, npm downloads it into `%APPDATA%/voice-mirror/lsp-servers/`. The existing `LspManager` API is preserved — callers don't change.

**Tech Stack:** Rust (serde_json for manifest parsing, tokio::process::Command for npm, std::fs for lock files), npm (package installation), existing Tauri event system for status notifications.

**Design doc:** `docs/plans/2026-02-28-lsp-server-management-design.md`

---

## Progress Checklist

> Update this checklist as tasks are completed. Any agent can see at a glance what's done and what's left.

### Phase 1: Registry + Auto-Download + Routing
- [x] Task 1: Create server registry manifest (`lsp-servers.json`)
- [x] Task 2: Create manifest parser (`manifest.rs`)
- [x] Task 3: Create Node.js detection utility
- [x] Task 4: Create npm installer module (`installer.rs`)
- [x] Task 5: Rewrite detection module to use manifest
- [x] Task 6: Wire installer into `ensure_server()` flow
- [x] Task 7: Pass `initializationOptions` from manifest on server init
- [x] Task 8: Handle `workspace/configuration` requests from servers
- [x] Task 9: Add `lsp_servers` config field for user overrides
- [x] Task 10: Frontend — API wrappers for server management
- [x] Task 11: Frontend — Status bar install progress indicator
- [x] Task 12: Frontend — Notifications for install lifecycle
- [x] Task 13: Integration verification — full flow test
- [x] Task 14: Update docs (IDE-GAPS.md, CLAUDE.md)

### Phase 2: Lifecycle Management + LSP Tab UI _(plan after Phase 1)_
- [ ] Crash recovery with exponential backoff
- [ ] Graceful shutdown sequence (shutdown → exit → SIGTERM → SIGKILL)
- [ ] Idle server shutdown (30s grace period)
- [ ] Health monitoring (response timeout detection)
- [ ] LSP Tab redesign — full management UI
- [ ] Auto-update check (compare installed vs manifest version)
- [ ] Native binary download support (rust-analyzer)

### Phase 3: Multi-Server + Extensibility _(plan after Phase 2)_
- [ ] `priority: "supplementary"` server support
- [ ] Diagnostic merging from multiple servers per file
- [ ] Request routing (completions → primary, diagnostics → all)
- [ ] User-defined custom servers in config
- [ ] Per-project `.voicemirror/lsp.json` overrides
- [ ] ESLint + Tailwind CSS language server support

---

## Context for Implementers

**Current LSP files:**
- `src-tauri/src/lsp/mod.rs` (1168 lines) — `LspManager`, `ensure_server()`, all request methods
- `src-tauri/src/lsp/detection.rs` (279 lines) — `LANGUAGE_SERVERS` constant, `detect_for_extension()`, `find_binary()`
- `src-tauri/src/lsp/client.rs` (360 lines) — JSON-RPC protocol, reader loop, diagnostic handling
- `src-tauri/src/lsp/types.rs` (166 lines) — serializable types, URI utilities
- `src-tauri/src/commands/lsp.rs` (665 lines) — 27 Tauri commands

**Key patterns:**
- Server spawning happens in `ensure_server()` (mod.rs:64-372)
- Windows .cmd wrapper resolution in `resolve_node_script()` (detection.rs:25-90)
- `LANGUAGE_SERVERS` constant (detection.rs:93-126) maps extensions → server binaries — **this is what we're replacing**
- Initialize handshake at mod.rs:256-326 sends hardcoded capabilities — we need to add `initializationOptions`
- Reader loop (client.rs:114-166) handles diagnostics push and request-response correlation

**Testing patterns:**
- Rust: `cargo check --tests` for compilation, `cargo test --bin voice-mirror-mcp` for MCP tests
- JS: `npm test` — source-inspection pattern (read .rs/.svelte/.js files, assert patterns)
- `cargo test --lib` fails on Windows (WebView2 DLL) — avoid for this work

---

## Phase 1 Tasks

### Task 1: Create server registry manifest

**Files:**
- Create: `src-tauri/src/lsp/lsp-servers.json`
- Test: `test/lsp/lsp-server-manifest.test.cjs` (new)

**Step 1: Write the failing test**

Create `test/lsp/lsp-server-manifest.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../src-tauri/src/lsp/lsp-servers.json'),
    'utf-8'
  )
);

describe('lsp-servers.json: structure', () => {
  it('has servers object', () => {
    assert.ok(manifest.servers, 'Should have servers object');
    assert.ok(typeof manifest.servers === 'object', 'servers should be an object');
  });

  it('has all Phase 1 servers', () => {
    const ids = Object.keys(manifest.servers);
    assert.ok(ids.includes('svelte'), 'Should have svelte server');
    assert.ok(ids.includes('typescript'), 'Should have typescript server');
    assert.ok(ids.includes('css'), 'Should have css server');
    assert.ok(ids.includes('html'), 'Should have html server');
    assert.ok(ids.includes('json'), 'Should have json server');
  });
});

describe('lsp-servers.json: server entries', () => {
  for (const [id, server] of Object.entries(manifest.servers)) {
    describe(id, () => {
      it('has required fields', () => {
        assert.ok(server.name, `${id}: should have name`);
        assert.ok(Array.isArray(server.languages), `${id}: should have languages array`);
        assert.ok(Array.isArray(server.extensions), `${id}: should have extensions array`);
        assert.ok(Array.isArray(server.excludeExtensions), `${id}: should have excludeExtensions array`);
        assert.ok(server.install, `${id}: should have install object`);
        assert.ok(server.install.type === 'npm', `${id}: install type should be npm`);
        assert.ok(Array.isArray(server.install.packages), `${id}: should have install.packages array`);
        assert.ok(server.command, `${id}: should have command`);
        assert.ok(Array.isArray(server.args), `${id}: should have args array`);
        assert.ok(['primary', 'supplementary'].includes(server.priority), `${id}: should have valid priority`);
        assert.ok(typeof server.enabled === 'boolean', `${id}: should have enabled boolean`);
      });
    });
  }
});

describe('lsp-servers.json: svelte excludes', () => {
  it('typescript excludes .svelte', () => {
    assert.ok(
      manifest.servers.typescript.excludeExtensions.includes('.svelte'),
      'TypeScript should exclude .svelte'
    );
  });

  it('css excludes .svelte', () => {
    assert.ok(
      manifest.servers.css.excludeExtensions.includes('.svelte'),
      'CSS should exclude .svelte'
    );
  });

  it('html excludes .svelte', () => {
    assert.ok(
      manifest.servers.html.excludeExtensions.includes('.svelte'),
      'HTML should exclude .svelte'
    );
  });

  it('svelte does not exclude .svelte', () => {
    assert.ok(
      !manifest.servers.svelte.excludeExtensions.includes('.svelte'),
      'Svelte should NOT exclude .svelte'
    );
  });
});

describe('lsp-servers.json: typescript dependency', () => {
  it('typescript server installs typescript SDK', () => {
    assert.ok(
      manifest.servers.typescript.install.packages.includes('typescript'),
      'TypeScript server should install typescript SDK'
    );
  });

  it('svelte server installs typescript SDK', () => {
    assert.ok(
      manifest.servers.svelte.install.packages.includes('typescript'),
      'Svelte server should install typescript SDK'
    );
  });
});

describe('lsp-servers.json: shared packages', () => {
  it('css, html, json use vscode-langservers-extracted', () => {
    for (const id of ['css', 'html', 'json']) {
      assert.ok(
        manifest.servers[id].install.packages.includes('vscode-langservers-extracted'),
        `${id} should use vscode-langservers-extracted`
      );
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "lsp-servers.json"`
Expected: FAIL — file doesn't exist yet

**Step 3: Create the manifest file**

Create `src-tauri/src/lsp/lsp-servers.json` with the full manifest from the design doc (all 5 servers: svelte, typescript, css, html, json). Use the exact JSON from the design doc's "Server Registry Manifest" section.

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "lsp-servers.json"`
Expected: PASS — all structure and content tests pass

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/lsp-servers.json test/lsp/lsp-server-manifest.test.cjs
git commit -m "feat(lsp): add server registry manifest with 5 Phase 1 servers"
```

---

### Task 2: Create manifest parser module

**Files:**
- Create: `src-tauri/src/lsp/manifest.rs`
- Modify: `src-tauri/src/lsp/mod.rs` (add `pub mod manifest;`)
- Test: `test/lsp/lsp-manifest-parser.test.cjs` (new)

**Step 1: Write the failing test**

Create `test/lsp/lsp-manifest-parser.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/manifest.rs'),
  'utf-8'
);

describe('manifest.rs: structures', () => {
  it('defines ServerManifest struct', () => {
    assert.ok(src.includes('struct ServerManifest'), 'Should define ServerManifest');
  });

  it('defines ServerEntry struct', () => {
    assert.ok(src.includes('struct ServerEntry'), 'Should define ServerEntry');
  });

  it('defines InstallConfig struct', () => {
    assert.ok(src.includes('struct InstallConfig'), 'Should define InstallConfig');
  });

  it('derives Deserialize for all structs', () => {
    assert.ok(src.includes('Deserialize'), 'Should derive Deserialize');
  });
});

describe('manifest.rs: core functions', () => {
  it('has load_manifest function', () => {
    assert.ok(src.includes('fn load_manifest'), 'Should have load_manifest');
  });

  it('embeds lsp-servers.json via include_str', () => {
    assert.ok(src.includes('include_str!'), 'Should embed manifest via include_str');
    assert.ok(src.includes('lsp-servers.json'), 'Should reference lsp-servers.json');
  });

  it('has find_server_for_extension function', () => {
    assert.ok(src.includes('fn find_server_for_extension'), 'Should have extension lookup');
  });

  it('respects excludeExtensions', () => {
    assert.ok(src.includes('exclude_extensions'), 'Should handle excludeExtensions field');
  });

  it('has find_binary_path function', () => {
    assert.ok(src.includes('fn find_binary_path'), 'Should have binary path resolution');
  });

  it('checks node_modules/.bin/', () => {
    assert.ok(src.includes('node_modules'), 'Should check node_modules/.bin/ path');
  });
});

describe('manifest.rs: user override support', () => {
  it('has merge_user_overrides or apply_overrides function', () => {
    assert.ok(
      src.includes('merge_overrides') || src.includes('apply_overrides') || src.includes('with_overrides'),
      'Should support merging user overrides'
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "manifest.rs"`
Expected: FAIL — file doesn't exist

**Step 3: Implement manifest.rs**

Create `src-tauri/src/lsp/manifest.rs`:

```rust
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
    pub packages: Vec<String>,
    #[serde(default)]
    pub version: String,
}

fn default_priority() -> String { "primary".to_string() }
fn default_true() -> bool { true }
fn default_restart_policy() -> String { "on-crash".to_string() }

/// The embedded manifest JSON (compiled into the binary).
const MANIFEST_JSON: &str = include_str!("lsp-servers.json");

/// Load and parse the embedded manifest.
pub fn load_manifest() -> Result<ServerManifest, String> {
    serde_json::from_str(MANIFEST_JSON)
        .map_err(|e| format!("Failed to parse LSP manifest: {}", e))
}

/// Find the best server for a file extension.
/// Returns (server_id, server_entry) or None if no server handles this extension.
/// Respects `excludeExtensions` — a server won't be returned if the extension is excluded.
pub fn find_server_for_extension(
    manifest: &ServerManifest,
    ext: &str,
) -> Option<(String, ServerEntry)> {
    let dot_ext = if ext.starts_with('.') {
        ext.to_lowercase()
    } else {
        format!(".{}", ext.to_lowercase())
    };

    for (id, entry) in &manifest.servers {
        if !entry.enabled {
            continue;
        }
        if entry.exclude_extensions.iter().any(|e| e.to_lowercase() == dot_ext) {
            continue;
        }
        if entry.extensions.iter().any(|e| e.to_lowercase() == dot_ext) {
            return Some((id.clone(), entry.clone()));
        }
    }
    None
}

/// Resolve the binary path for a server.
/// Checks: 1) user PATH, 2) managed lsp-servers/node_modules/.bin/
pub fn find_binary_path(
    command: &str,
    lsp_servers_dir: &Path,
) -> Option<PathBuf> {
    // 1. Check user PATH
    if let Ok(path) = which::which(command) {
        return Some(path);
    }

    // 2. Check managed node_modules/.bin/
    let bin_dir = lsp_servers_dir.join("node_modules").join(".bin");
    let bin_path = bin_dir.join(command);
    if bin_path.exists() {
        return Some(bin_path);
    }

    // On Windows, check .cmd wrapper
    #[cfg(windows)]
    {
        let cmd_path = bin_dir.join(format!("{}.cmd", command));
        if cmd_path.exists() {
            return Some(cmd_path);
        }
    }

    None
}

/// Apply user overrides to a server entry.
/// User overrides can change: enabled, initializationOptions, settings.
pub fn apply_overrides(
    entry: &mut ServerEntry,
    overrides: &serde_json::Value,
) {
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
}
```

**Step 4: Add module to mod.rs**

In `src-tauri/src/lsp/mod.rs`, add `pub mod manifest;` near the top with the other module declarations.

**Step 5: Verify compilation and tests**

Run: `cd src-tauri && cargo check --tests`
Expected: Clean compilation

Run: `npm test -- --test-name-pattern "manifest.rs"`
Expected: PASS

**Step 6: Run Rust tests**

Run: `cd src-tauri && cargo test manifest --lib 2>&1 || echo "(lib test may fail on Windows — check output)"`

If `cargo test --lib` fails due to WebView2, verify the tests compile with `cargo check --tests` and rely on the JS source-inspection tests.

**Step 7: Commit**

```bash
git add src-tauri/src/lsp/manifest.rs src-tauri/src/lsp/mod.rs test/lsp/lsp-manifest-parser.test.cjs
git commit -m "feat(lsp): add manifest parser with extension lookup and user overrides"
```

---

### Task 3: Create Node.js detection utility

**Files:**
- Modify: `src-tauri/src/lsp/installer.rs` (create)
- Modify: `src-tauri/src/lsp/mod.rs` (add `pub mod installer;`)
- Test: `test/lsp/lsp-installer.test.cjs` (new)

**Step 1: Write the failing test**

Create `test/lsp/lsp-installer.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/installer.rs'),
  'utf-8'
);

describe('installer.rs: Node.js detection', () => {
  it('has detect_node function', () => {
    assert.ok(src.includes('fn detect_node'), 'Should have detect_node function');
  });

  it('checks for node on PATH', () => {
    assert.ok(src.includes('which::which') || src.includes('"node"'), 'Should check for node binary');
  });

  it('checks for npm on PATH', () => {
    assert.ok(src.includes('"npm"'), 'Should check for npm binary');
  });

  it('returns NodeStatus with version info', () => {
    assert.ok(
      src.includes('NodeStatus') || src.includes('node_version'),
      'Should return version info'
    );
  });
});

describe('installer.rs: npm install', () => {
  it('has install_server function', () => {
    assert.ok(src.includes('fn install_server'), 'Should have install_server function');
  });

  it('uses --ignore-scripts flag', () => {
    assert.ok(src.includes('--ignore-scripts'), 'Should use --ignore-scripts for security');
  });

  it('uses --prefix flag for install directory', () => {
    assert.ok(src.includes('--prefix'), 'Should use --prefix for install location');
  });

  it('has install lock mechanism', () => {
    assert.ok(
      src.includes('install.lock') || src.includes('install_lock'),
      'Should have install lock file'
    );
  });

  it('has get_lsp_servers_dir function', () => {
    assert.ok(src.includes('fn get_lsp_servers_dir'), 'Should have directory helper');
  });
});

describe('installer.rs: status events', () => {
  it('emits lsp-server-status events', () => {
    assert.ok(
      src.includes('lsp-server-install-status') || src.includes('lsp-server-status'),
      'Should emit status events'
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "installer.rs"`
Expected: FAIL — file doesn't exist

**Step 3: Implement installer.rs**

Create `src-tauri/src/lsp/installer.rs`:

```rust
//! installer.rs -- Download and install LSP servers via npm.
//!
//! Handles Node.js detection, npm install with security flags,
//! lock-file based concurrency control, and Tauri event emission.

use std::path::{Path, PathBuf};
use std::fs;
use tracing::{info, warn, error};

/// Result of Node.js detection.
#[derive(Debug, Clone)]
pub struct NodeStatus {
    pub available: bool,
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub node_path: Option<PathBuf>,
    pub npm_path: Option<PathBuf>,
}

/// Get the lsp-servers directory under app data.
pub fn get_lsp_servers_dir() -> Result<PathBuf, String> {
    let app_data = dirs::config_dir()
        .ok_or_else(|| "Could not determine app data directory".to_string())?;
    let dir = app_data.join("voice-mirror").join("lsp-servers");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create lsp-servers directory: {}", e))?;
    }
    Ok(dir)
}

/// Detect whether Node.js and npm are available on PATH.
pub fn detect_node() -> NodeStatus {
    let node_path = which::which("node").ok();
    let npm_path = which::which("npm").ok();

    let node_version = node_path.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    });

    let npm_version = npm_path.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    });

    let available = node_path.is_some() && npm_path.is_some();

    if !available {
        warn!("Node.js or npm not found on PATH. LSP server auto-install unavailable.");
    } else {
        info!(
            "Node.js detected: node={} npm={}",
            node_version.as_deref().unwrap_or("unknown"),
            npm_version.as_deref().unwrap_or("unknown")
        );
    }

    NodeStatus {
        available,
        node_version,
        npm_version,
        node_path,
        npm_path,
    }
}

/// Acquire the install lock. Returns a guard that releases on drop.
/// Returns None if another install is already in progress.
fn acquire_install_lock(lsp_dir: &Path) -> Option<InstallLockGuard> {
    let lock_path = lsp_dir.join("install.lock");
    if lock_path.exists() {
        // Check if lock is stale (older than 5 minutes)
        if let Ok(metadata) = fs::metadata(&lock_path) {
            if let Ok(modified) = metadata.modified() {
                if modified.elapsed().unwrap_or_default().as_secs() > 300 {
                    // Stale lock — remove and proceed
                    let _ = fs::remove_file(&lock_path);
                } else {
                    return None; // Active lock
                }
            }
        }
    }
    // Create lock file
    if fs::write(&lock_path, std::process::id().to_string()).is_ok() {
        Some(InstallLockGuard { lock_path })
    } else {
        None
    }
}

struct InstallLockGuard {
    lock_path: PathBuf,
}

impl Drop for InstallLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock_path);
    }
}

/// Install an LSP server's npm packages into the managed directory.
///
/// Uses `npm install --ignore-scripts --prefix <dir> <packages>` for security.
/// Returns Ok(()) on success or Err with a message on failure.
pub async fn install_server(
    server_id: &str,
    packages: &[String],
    version: &str,
    lsp_dir: &Path,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    // Emit installing status
    if let Some(app) = app_handle {
        let _ = app.emit("lsp-server-status", serde_json::json!({
            "server": server_id,
            "status": "installing",
            "message": format!("Installing {}...", server_id)
        }));
    }

    info!("Installing LSP server '{}': packages={:?}", server_id, packages);

    // Acquire lock
    let _lock = acquire_install_lock(lsp_dir)
        .ok_or_else(|| "Another LSP server install is in progress".to_string())?;

    // Ensure package.json exists (npm requires it)
    let pkg_json = lsp_dir.join("package.json");
    if !pkg_json.exists() {
        fs::write(&pkg_json, r#"{"name":"voice-mirror-lsp-servers","private":true}"#)
            .map_err(|e| format!("Failed to create package.json: {}", e))?;
    }

    // Build npm install command
    let npm_cmd = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let mut args = vec![
        "install".to_string(),
        "--ignore-scripts".to_string(),
        "--prefix".to_string(),
        lsp_dir.to_string_lossy().to_string(),
    ];

    // Add packages with version constraint
    for pkg in packages {
        if !version.is_empty() && pkg == &packages[0] {
            args.push(format!("{}@{}", pkg, version));
        } else {
            args.push(pkg.clone());
        }
    }

    // Run npm install
    let output = tokio::process::Command::new(npm_cmd)
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("npm install failed for '{}': {}", server_id, stderr);

        if let Some(app) = app_handle {
            let _ = app.emit("lsp-server-status", serde_json::json!({
                "server": server_id,
                "status": "install_failed",
                "message": format!("Failed to install {}", server_id)
            }));
        }

        return Err(format!("npm install failed: {}", stderr));
    }

    info!("Successfully installed LSP server '{}'", server_id);

    if let Some(app) = app_handle {
        let _ = app.emit("lsp-server-status", serde_json::json!({
            "server": server_id,
            "status": "installed",
            "message": format!("{} installed successfully", server_id)
        }));
    }

    Ok(())
}

/// Check if a server's packages are already installed.
pub fn is_server_installed(command: &str, lsp_dir: &Path) -> bool {
    let bin_dir = lsp_dir.join("node_modules").join(".bin");
    let bin_path = bin_dir.join(command);

    if bin_path.exists() {
        return true;
    }

    #[cfg(windows)]
    {
        let cmd_path = bin_dir.join(format!("{}.cmd", command));
        if cmd_path.exists() {
            return true;
        }
    }

    false
}
```

**Step 4: Add module to mod.rs**

In `src-tauri/src/lsp/mod.rs`, add `pub mod installer;` near the top.

**Step 5: Verify compilation and run tests**

Run: `cd src-tauri && cargo check --tests`
Expected: Clean compilation

Run: `npm test -- --test-name-pattern "installer.rs"`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/lsp/installer.rs src-tauri/src/lsp/mod.rs test/lsp/lsp-installer.test.cjs
git commit -m "feat(lsp): add npm installer with Node.js detection and install lock"
```

---

### Task 4: Rewrite detection module to use manifest

**Files:**
- Modify: `src-tauri/src/lsp/detection.rs` (rewrite)
- Modify: `test/lsp/lsp-detection.test.cjs` (update existing or create)

**Step 1: Write the failing test**

Create or update `test/lsp/lsp-detection.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/detection.rs'),
  'utf-8'
);

describe('detection.rs: manifest-based routing', () => {
  it('imports manifest module', () => {
    assert.ok(src.includes('use super::manifest'), 'Should import manifest module');
  });

  it('no longer has hardcoded LANGUAGE_SERVERS constant', () => {
    assert.ok(!src.includes('const LANGUAGE_SERVERS'), 'Should NOT have hardcoded LANGUAGE_SERVERS');
  });

  it('detect_for_extension uses manifest lookup', () => {
    assert.ok(src.includes('find_server_for_extension'), 'Should use manifest find_server_for_extension');
  });

  it('checks managed install directory for binaries', () => {
    assert.ok(src.includes('find_binary_path') || src.includes('lsp_servers_dir'), 'Should check managed install dir');
  });

  it('preserves resolve_node_script for Windows', () => {
    assert.ok(src.includes('resolve_node_script'), 'Should keep Windows .cmd resolution');
  });

  it('preserves detect_all function', () => {
    assert.ok(src.includes('fn detect_all'), 'Should keep detect_all for LSP status tab');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "detection.rs: manifest"`
Expected: FAIL — detection.rs still has `LANGUAGE_SERVERS`

**Step 3: Rewrite detection.rs**

Replace the `LANGUAGE_SERVERS` constant and `detect_for_extension()` with manifest-based lookup. Preserve `resolve_node_script()` (Windows .cmd resolution) and `detect_all()`. The new `detect_for_extension()` should:

1. Call `manifest::load_manifest()`
2. Call `manifest::find_server_for_extension(manifest, ext)`
3. Call `manifest::find_binary_path(entry.command, lsp_servers_dir)` to resolve the binary
4. Fall back to `which::which()` for PATH lookup
5. Return `ServerInfo` (preserve the existing return type)

Keep `resolve_node_script()` unchanged — it's still needed for Windows .cmd wrapper resolution.

Update `detect_all()` to iterate the manifest's servers instead of the hardcoded array.

**Step 4: Verify compilation and tests**

Run: `cd src-tauri && cargo check --tests`
Expected: Clean compilation

Run: `npm test -- --test-name-pattern "detection.rs"`
Expected: PASS

Run: `npm test` (full suite)
Expected: All pass (existing detection tests may need updates)

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/detection.rs test/lsp/lsp-detection.test.cjs
git commit -m "feat(lsp): rewrite detection to use manifest-based routing"
```

---

### Task 5: Wire installer into ensure_server() flow

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:64-372` (ensure_server method)
- Test: `test/lsp/lsp-ensure-server.test.cjs` (new)

**Step 1: Write the failing test**

Create `test/lsp/lsp-ensure-server.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'),
  'utf-8'
);

describe('mod.rs: ensure_server install-if-missing', () => {
  it('imports installer module', () => {
    assert.ok(
      src.includes('installer::') || src.includes('use super::installer'),
      'Should use installer module'
    );
  });

  it('calls install_server when binary not found', () => {
    assert.ok(src.includes('install_server'), 'Should call install_server');
  });

  it('checks is_server_installed before spawning', () => {
    assert.ok(
      src.includes('is_server_installed') || src.includes('find_binary_path'),
      'Should check if server is installed'
    );
  });

  it('imports manifest module', () => {
    assert.ok(
      src.includes('manifest::') || src.includes('use super::manifest'),
      'Should use manifest module'
    );
  });

  it('loads manifest for server config', () => {
    assert.ok(src.includes('load_manifest'), 'Should load manifest');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "ensure_server install"`
Expected: FAIL — mod.rs doesn't import installer yet

**Step 3: Modify ensure_server()**

In `src-tauri/src/lsp/mod.rs`, modify the `ensure_server()` method (lines 64-372):

1. After detecting the server info via the rewritten `detection.rs`, check if the binary was found
2. If not found, check if Node.js is available via `installer::detect_node()`
3. If Node.js available, load the manifest entry and call `installer::install_server()`
4. After install completes, retry binary detection
5. If still not found, return an error

The flow becomes:
```
ensure_server(lang_id, root):
  1. detect_for_extension(ext) → ServerInfo
  2. if ServerInfo.resolved_path is Some → proceed to spawn (existing code)
  3. if None → load manifest → get install config
  4. detect_node() → if unavailable, return Err("Node.js not found")
  5. install_server(id, packages, version, lsp_dir, app_handle).await
  6. retry detect_for_extension(ext) → if still None, return Err
  7. proceed to spawn with the now-resolved path
```

**Step 4: Verify compilation and tests**

Run: `cd src-tauri && cargo check --tests`
Expected: Clean compilation

Run: `npm test -- --test-name-pattern "ensure_server"`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-ensure-server.test.cjs
git commit -m "feat(lsp): wire installer into ensure_server for auto-download"
```

---

### Task 6: Pass initializationOptions from manifest on server init

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:256-326` (initialize handshake)
- Test: `test/lsp/lsp-init-options.test.cjs` (new)

**Step 1: Write the failing test**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'),
  'utf-8'
);

describe('mod.rs: initializationOptions', () => {
  it('passes initializationOptions in initialize request', () => {
    assert.ok(src.includes('initializationOptions'), 'Should include initializationOptions in init');
  });

  it('reads initialization_options from manifest entry', () => {
    assert.ok(
      src.includes('initialization_options') && src.includes('ServerEntry'),
      'Should read options from manifest ServerEntry'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Modify the initialize request**

In `mod.rs`, the initialize request (around line 260) currently sends capabilities but no `initializationOptions`. Add the field from the manifest entry:

Find the initialize request JSON construction and add:
```rust
"initializationOptions": entry.initialization_options,
```

This requires passing the `ServerEntry` into the server initialization flow (from the manifest lookup done in `ensure_server()`).

**Step 4: Verify compilation + tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-init-options.test.cjs
git commit -m "feat(lsp): pass initializationOptions from manifest during server init"
```

---

### Task 7: Handle workspace/configuration requests from servers

**Files:**
- Modify: `src-tauri/src/lsp/client.rs:114-166` (reader loop)
- Test: `test/lsp/lsp-workspace-config.test.cjs` (new)

**Step 1: Write the failing test**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/client.rs'),
  'utf-8'
);

describe('client.rs: workspace/configuration handler', () => {
  it('handles workspace/configuration requests', () => {
    assert.ok(src.includes('workspace/configuration'), 'Should handle workspace/configuration');
  });

  it('responds with server settings', () => {
    assert.ok(
      src.includes('send_response') || src.includes('write_message'),
      'Should send a response back'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement workspace/configuration handler**

In the reader loop (`client.rs:114-166`), add handling for `workspace/configuration` requests from the server. These are requests (have both "id" and "method") where the server asks the client for configuration values.

The reader loop currently handles:
- Responses (has "id", no "method") → route to pending_requests
- Notifications (has "method", no "id") → handle diagnostics, log others

Add a third case:
- Requests from server (has both "id" and "method") → handle `workspace/configuration`

For `workspace/configuration`, the server sends `params.items[]` — each with a `section` string. Respond with an array of settings values, one per item. Read from the server's manifest `settings` field.

The response format: `{"id": request_id, "result": [setting1, setting2, ...]}` sent via `write_message()`.

**Step 4: Verify compilation + tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/client.rs test/lsp/lsp-workspace-config.test.cjs
git commit -m "feat(lsp): handle workspace/configuration requests with manifest settings"
```

---

### Task 8: Add lsp_servers config field for user overrides

**Files:**
- Modify: `src-tauri/src/config/schema.rs` (add lsp_servers field)
- Modify: `src/lib/stores/config.svelte.js` (add DEFAULT_CONFIG.lspServers)
- Test: `test/stores/config.test.cjs` (add test)

**Step 1: Write the failing test**

Add to `test/stores/config.test.cjs`:

```javascript
describe('config.svelte.js: LSP server overrides', () => {
  it('has lspServers in DEFAULT_CONFIG', () => {
    assert.ok(src.includes('lspServers'), 'Should have lspServers config field');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Add config field**

In `schema.rs`, add an `lsp_servers` field to `AppConfig` (HashMap<String, serde_json::Value>) with `#[serde(rename = "lspServers", default)]`.

In `config.svelte.js`, add `lspServers: {}` to `DEFAULT_CONFIG`.

**Step 4: Verify compilation + tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/config/schema.rs src/lib/stores/config.svelte.js test/stores/config.test.cjs
git commit -m "feat(lsp): add lspServers config field for user overrides"
```

---

### Task 9: Frontend — API wrappers for server management

**Files:**
- Modify: `src-tauri/src/commands/lsp.rs` (add new commands)
- Modify: `src-tauri/src/lib.rs` (register new commands)
- Modify: `src/lib/api.js` (add invoke wrappers)
- Test: `test/api/api.test.cjs` (add tests)

**Step 1: Write the failing test**

Add to `test/api/api.test.cjs`:

```javascript
it('has lspGetServerList function', () => {
  assert.ok(src.includes('lspGetServerList') || src.includes('lsp_get_server_list'),
    'Should have server list function');
});

it('has lspInstallServer function', () => {
  assert.ok(src.includes('lspInstallServer') || src.includes('lsp_install_server'),
    'Should have install server function');
});

it('has lspSetServerEnabled function', () => {
  assert.ok(src.includes('lspSetServerEnabled') || src.includes('lsp_set_server_enabled'),
    'Should have enable/disable function');
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

Add 3 new Tauri commands to `commands/lsp.rs`:
- `lsp_get_server_list()` — returns all servers from manifest with install status
- `lsp_install_server(server_id)` — manually trigger install for a specific server
- `lsp_set_server_enabled(server_id, enabled)` — toggle server in user config

Register in `lib.rs` invoke handler chain. Add wrappers in `api.js`.

**Step 4: Verify — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/commands/lsp.rs src-tauri/src/lib.rs src/lib/api.js test/api/api.test.cjs
git commit -m "feat(lsp): add server management Tauri commands and API wrappers"
```

---

### Task 10: Frontend — Status bar install progress indicator

**Files:**
- Modify: `src/components/shared/StatusBar.svelte`
- Test: `test/components/status-bar.test.cjs` (add tests)

**Step 1: Write the failing test**

```javascript
describe('StatusBar.svelte: LSP install status', () => {
  it('listens for lsp-server-status events', () => {
    assert.ok(src.includes('lsp-server-status'), 'Should listen for install status events');
  });

  it('shows installing state', () => {
    assert.ok(src.includes('installing') || src.includes('Installing'), 'Should show installing state');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

In `StatusBar.svelte`, listen for `lsp-server-status` Tauri events. When a server is installing, show a spinner icon and server name in the LSP status area. When installed/running, show the existing green check. When failed, show warning icon.

**Step 4: Verify — PASS**

**Step 5: Commit**

```bash
git add src/components/shared/StatusBar.svelte test/components/status-bar.test.cjs
git commit -m "feat(lsp): status bar install progress indicator"
```

---

### Task 11: Frontend — Notifications for install lifecycle

**Files:**
- Modify: `src/components/shared/StatusBar.svelte` or create listener in `App.svelte`
- Test: `test/components/` (add tests)

**Step 1: Write the failing test**

Test that the frontend has notification dispatching for LSP install events.

**Step 2: Run test — FAIL**

**Step 3: Implement**

Add a Tauri event listener (in `App.svelte` or a shared location) that listens for `lsp-server-status` events and dispatches to the notification system:
- `"installing"` → persistent toast with spinner
- `"installed"` → success toast
- `"install_failed"` → danger toast with message
- Node.js not found → persistent notification

**Step 4: Verify — PASS**

**Step 5: Commit**

```bash
git commit -m "feat(lsp): notification system integration for LSP server install lifecycle"
```

---

### Task 12: Node.js not-found detection and notification

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (detect once per session)
- Modify: frontend listener

**Step 1: Write the failing test**

Test that ensure_server emits a specific event when Node.js is not found.

**Step 2: Run test — FAIL**

**Step 3: Implement**

In `ensure_server()`, when `detect_node()` returns unavailable AND the server needs npm install, emit a `lsp-node-not-found` Tauri event. The frontend listener shows a persistent notification: "Language server features require Node.js. Install from nodejs.org."

Only emit once per session (use a static AtomicBool flag).

**Step 4: Verify — PASS**

**Step 5: Commit**

```bash
git commit -m "feat(lsp): Node.js not-found detection with user notification"
```

---

### Task 13: Integration verification — full flow test

**Files:**
- All modified files
- Run full test suite

**Step 1: Run npm test**

Run: `npm test`
Expected: All tests pass (5273+ tests)

**Step 2: Verify Rust compilation**

Run: `cd src-tauri && cargo check --tests`
Expected: Clean compilation, no warnings

**Step 3: Manual smoke test**

1. Launch the app with `npm run dev`
2. Open a `.js` file — TypeScript LS should activate (or download if not on PATH)
3. Open a `.svelte` file — Svelte LS should activate; no bogus CSS/JS errors
4. Check Problems panel — only real diagnostics from the correct server
5. Check status bar — shows correct LSP server name
6. Check notification center — install notifications visible

**Step 4: Commit any fixups**

---

### Task 14: Update documentation

**Files:**
- Modify: `docs/source-of-truth/IDE-GAPS.md` (update LSP section)
- Modify: `CLAUDE.md` (update LSP description)
- Update: progress checklist at top of this file

**Step 1: Update IDE-GAPS.md**

Mark auto-download and manifest routing as completed. Note server lifecycle (Phase 2) and multi-server (Phase 3) as upcoming.

**Step 2: Update CLAUDE.md**

Update the LSP section to reflect the new manifest-based system, the lsp-servers directory, and the install flow.

**Step 3: Update progress checklist**

Mark all Phase 1 tasks as `[x]` in this plan document.

**Step 4: Commit**

```bash
git commit -m "docs: update IDE-GAPS, CLAUDE.md for LSP server management Phase 1"
```

---

## Phase 2 Tasks _(skeleton — plan in detail after Phase 1)_

### Task P2-1: Crash recovery with exponential backoff
- Modify `mod.rs` — use `crash_count` and `last_crash` fields (already exist but unused)
- Implement backoff: 1s, 2s, 4s, 8s, max 30s; stop after 5 consecutive crashes

### Task P2-2: Graceful shutdown sequence
- Modify `shutdown_server()` in `mod.rs:1081-1113`
- Sequence: `shutdown` request → `exit` notification → 5s wait → SIGTERM → 5s wait → SIGKILL

### Task P2-3: Idle server shutdown
- Track open file count per server; when count reaches 0, start 30s timer
- If no new files open within 30s, call `shutdown_server()`

### Task P2-4: Health monitoring
- Periodic ping or track response times
- If no response for >30s, mark unresponsive, attempt restart

### Task P2-5: LSP Tab redesign
- Full management UI: status, version, file count, restart/stop/install buttons
- Per-server enable/disable toggles

### Task P2-6: Auto-update check
- Compare installed package version vs manifest version
- Notify user if update available; manual trigger from LSP tab

### Task P2-7: Native binary download (rust-analyzer)
- Add `"install.type": "binary"` support to manifest and installer
- Download from GitHub releases API, platform-specific

---

## Phase 3 Tasks _(skeleton — plan in detail after Phase 2)_

### Task P3-1: Supplementary server support
- `priority: "supplementary"` in manifest
- Spawn alongside primary; only send/receive diagnostics and code actions

### Task P3-2: Diagnostic merging
- Merge diagnostics from multiple servers for same file
- Deduplicate by range + message

### Task P3-3: Request routing
- Completions, hover, definition → primary only
- Diagnostics, code actions → all servers for file

### Task P3-4: User-defined custom servers
- Allow custom server entries in user config
- Validate required fields, warn on conflicts

### Task P3-5: Per-project LSP overrides
- `.voicemirror/lsp.json` in project root
- Merged on top of global config

### Task P3-6: ESLint + Tailwind CSS servers
- Add entries to manifest
- ESLint as supplementary alongside TypeScript
- Tailwind CSS as supplementary alongside CSS
