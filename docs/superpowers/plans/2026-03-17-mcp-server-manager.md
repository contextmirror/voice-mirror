# MCP Server Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full CRUD MCP Server Manager as a new Settings tab — list, add, edit, delete, and test MCP server connections.

**Architecture:** Three new Rust commands (`mcp_test_connection`, `mcp_write_server`, `mcp_delete_server`) + two new Svelte components (`McpServerSettings.svelte` for the tab, `McpServerModal.svelte` for add/edit). Reuses the existing `discover_mcp_servers` command for listing.

**Tech Stack:** Rust (Tauri commands, std::process::Command for MCP handshake, serde_json), Svelte 5 (reactive state, modal pattern), existing IPC/CSS patterns.

**Spec:** `docs/superpowers/specs/2026-03-17-mcp-server-manager-design.md`

---

### Task 1: Rust — `mcp_write_server` and `mcp_delete_server` Commands

**Files:**
- Create: `src-tauri/src/commands/mcp.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `mcp.rs` with write and delete commands**

Create `src-tauri/src/commands/mcp.rs`:

```rust
//! MCP server management commands — write, delete, test connection.

use super::IpcResponse;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use tracing::{info, warn};

// ── Write/upsert an MCP server to a config file ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpWriteParams {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
    /// "global" or an absolute project path
    pub scope: String,
}

#[tauri::command]
pub fn mcp_write_server(params: McpWriteParams) -> IpcResponse {
    let path = resolve_config_path(&params.scope);

    // Read existing or start fresh
    let mut config = match read_config_file(&path) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(e),
    };

    // Ensure mcpServers object exists
    if !config["mcpServers"].is_object() {
        config["mcpServers"] = serde_json::json!({});
    }

    // Build server entry
    let mut entry = serde_json::json!({
        "command": params.command,
    });
    if !params.args.is_empty() {
        entry["args"] = serde_json::json!(params.args);
    }
    if let Some(ref env) = params.env {
        if !env.is_empty() {
            entry["env"] = serde_json::json!(env);
        }
    }

    // Insert/update
    config["mcpServers"][&params.name] = entry;

    // Write back
    match write_config_file(&path, &config) {
        Ok(()) => {
            info!("Wrote MCP server '{}' to {}", params.name, path.display());
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(e),
    }
}

// ── Delete an MCP server from a config file ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDeleteParams {
    pub name: String,
    /// "global" or an absolute project path
    pub scope: String,
}

#[tauri::command]
pub fn mcp_delete_server(params: McpDeleteParams) -> IpcResponse {
    let path = resolve_config_path(&params.scope);

    if !path.exists() {
        return IpcResponse::err(format!("Config file not found: {}", path.display()));
    }

    let mut config = match read_config_file(&path) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(e),
    };

    if let Some(servers) = config["mcpServers"].as_object_mut() {
        if servers.remove(&params.name).is_none() {
            return IpcResponse::err(format!("Server '{}' not found in {}", params.name, path.display()));
        }
    } else {
        return IpcResponse::err(format!("No mcpServers in {}", path.display()));
    }

    match write_config_file(&path, &config) {
        Ok(()) => {
            info!("Deleted MCP server '{}' from {}", params.name, path.display());
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(e),
    }
}

// ── Helpers ──

/// Resolve "global" to ~/.claude/settings.json, or a project path to {path}/.mcp.json.
fn resolve_config_path(scope: &str) -> std::path::PathBuf {
    if scope == "global" {
        dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(".claude")
            .join("settings.json")
    } else {
        Path::new(scope).join(".mcp.json")
    }
}

/// Read and parse a JSON config file. Returns empty object if file doesn't exist.
/// Returns Err if the file exists but cannot be parsed (don't overwrite malformed files).
fn read_config_file(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Could not parse {}. Please fix it manually: {}", path.display(), e))
}

/// Write a JSON value to a config file with pretty-printing.
fn write_config_file(path: &Path, config: &serde_json::Value) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
        }
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(path, &json)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(())
}
```

- [ ] **Step 2: Register module in `mod.rs`**

In `src-tauri/src/commands/mod.rs`, add after the last `pub mod` line:

```rust
pub mod mcp;
```

- [ ] **Step 3: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `generate_handler!` macro. Add after the project commands:

```rust
            // MCP management
            mcp_cmds::mcp_write_server,
            mcp_cmds::mcp_delete_server,
```

Also add the `use` alias near the other command aliases at the top of the `run()` function:

```rust
use commands::mcp as mcp_cmds;
```

- [ ] **Step 4: Verify compilation**

Run: `cd "E:/Projects/Voice Mirror/src-tauri" && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mcp.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(mcp): add mcp_write_server and mcp_delete_server Tauri commands"
```

---

### Task 2: Rust — `mcp_test_connection` Command

**Files:**
- Modify: `src-tauri/src/commands/mcp.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the async test connection command**

At the top of `src-tauri/src/commands/mcp.rs`, add to imports:

```rust
use serde::Serialize;
```

Add the test connection command at the end of the file (before the helpers section):

```rust
// ── Test MCP server connection ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestParams {
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpTestResult {
    success: bool,
    tool_count: Option<u32>,
    server_name: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn mcp_test_connection(params: McpTestParams) -> IpcResponse {
    use std::io::{BufRead, Write};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    // Spawn server process
    let mut cmd = Command::new(&params.command);
    cmd.args(&params.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref env) = params.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    // Prevent window popup on Windows
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let result = McpTestResult {
                success: false,
                tool_count: None,
                server_name: None,
                error: Some(format!("Failed to start '{}': {}", params.command, e)),
            };
            return IpcResponse::ok(serde_json::to_value(result).unwrap());
        }
    };

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    // Run handshake in a blocking thread with timeout
    let handle = std::thread::spawn(move || -> McpTestResult {
        let mut stdin = stdin;
        let mut reader = std::io::BufReader::new(stdout);

        // Helper: send a JSON-RPC message
        let send = |stdin: &mut dyn Write, msg: &serde_json::Value| -> Result<(), String> {
            let s = serde_json::to_string(msg).map_err(|e| e.to_string())?;
            stdin.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
            stdin.write_all(b"\n").map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
            Ok(())
        };

        // Helper: read a JSON-RPC response line
        let recv = |reader: &mut std::io::BufReader<std::process::ChildStdout>| -> Result<serde_json::Value, String> {
            let mut line = String::new();
            reader.read_line(&mut line).map_err(|e| e.to_string())?;
            if line.is_empty() {
                return Err("Server closed stdout".to_string());
            }
            serde_json::from_str(&line).map_err(|e| format!("Invalid JSON: {}", e))
        };

        // 1. Send initialize
        let init_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "voice-mirror-test", "version": "1.0" }
            }
        });
        if let Err(e) = send(&mut stdin, &init_req) {
            return McpTestResult { success: false, tool_count: None, server_name: None, error: Some(format!("Send initialize failed: {}", e)) };
        }

        // 2. Read initialize response
        let init_resp = match recv(&mut reader) {
            Ok(v) => v,
            Err(e) => return McpTestResult { success: false, tool_count: None, server_name: None, error: Some(format!("Read initialize response failed: {}", e)) },
        };

        let server_name = init_resp["result"]["serverInfo"]["name"]
            .as_str()
            .map(|s| s.to_string());

        // 3. Send initialized notification
        let initialized = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        if let Err(e) = send(&mut stdin, &initialized) {
            return McpTestResult { success: false, tool_count: None, server_name, error: Some(format!("Send initialized failed: {}", e)) };
        }

        // 4. Send tools/list
        let tools_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        });
        if let Err(e) = send(&mut stdin, &tools_req) {
            return McpTestResult { success: false, tool_count: None, server_name, error: Some(format!("Send tools/list failed: {}", e)) };
        }

        // 5. Read tools/list response
        let tools_resp = match recv(&mut reader) {
            Ok(v) => v,
            Err(e) => return McpTestResult { success: false, tool_count: None, server_name, error: Some(format!("Read tools/list response failed: {}", e)) },
        };

        let tool_count = tools_resp["result"]["tools"]
            .as_array()
            .map(|a| a.len() as u32);

        McpTestResult {
            success: true,
            tool_count,
            server_name,
            error: None,
        }
    });

    // Wait with timeout
    let timeout = Duration::from_secs(5);
    let start = std::time::Instant::now();

    loop {
        if handle.is_finished() {
            break;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let result = McpTestResult {
                success: false,
                tool_count: None,
                server_name: None,
                error: Some("Server did not respond within 5 seconds".to_string()),
            };
            return IpcResponse::ok(serde_json::to_value(result).unwrap());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let _ = child.kill();
    let result = handle.join().unwrap_or_else(|_| McpTestResult {
        success: false,
        tool_count: None,
        server_name: None,
        error: Some("Test thread panicked".to_string()),
    });

    IpcResponse::ok(serde_json::to_value(result).unwrap())
}
```

- [ ] **Step 2: Register command in `lib.rs`**

Add to the MCP management section in `generate_handler!`:

```rust
            mcp_cmds::mcp_test_connection,
```

- [ ] **Step 3: Verify compilation**

Run: `cd "E:/Projects/Voice Mirror/src-tauri" && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/mcp.rs src-tauri/src/lib.rs
git commit -m "feat(mcp): add mcp_test_connection command with MCP handshake"
```

---

### Task 3: Frontend — API Wrappers

**Files:**
- Modify: `src/lib/api.js`

- [ ] **Step 1: Add three API wrappers**

In `src/lib/api.js`, add after the existing `discoverMcpServers` function:

```javascript
export async function mcpTestConnection(command, args, env) {
  return invoke('mcp_test_connection', { params: { command, args, env: env || null } });
}

export async function mcpWriteServer(name, command, args, env, scope) {
  return invoke('mcp_write_server', { params: { name, command, args, env: env || null, scope } });
}

export async function mcpDeleteServer(name, scope) {
  return invoke('mcp_delete_server', { params: { name, scope } });
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js
git commit -m "feat(mcp): add API wrappers for MCP server management commands"
```

---

### Task 4: Frontend — `McpServerModal.svelte`

**Files:**
- Create: `src/components/settings/McpServerModal.svelte`

- [ ] **Step 1: Create the modal component**

Create `src/components/settings/McpServerModal.svelte`:

```svelte
<script>
  import { mcpWriteServer, mcpTestConnection } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { onMount } from 'svelte';

  let { mode = 'add', server = null, onClose, onSave } = $props();

  // Freeze WebView2 while modal is open (airspace problem)
  onMount(() => {
    lensStore.freeze();
    return () => lensStore.unfreeze();
  });

  // Form state
  let name = $state(server?.name || '');
  let command = $state(server?.config?.command || '');
  let args = $state((server?.config?.args || []).join('\n'));
  let envVars = $state(
    server?.config?.env
      ? Object.entries(server.config.env).map(([k, v]) => ({ key: k, value: v }))
      : []
  );
  let scope = $state(server?.source === 'project' ? (server?._projectPath || 'global') : 'global');
  let saving = $state(false);
  let nameError = $state('');

  // Test state
  let testing = $state(false);
  let testResult = $state(null);

  // Scope options
  const scopeOptions = $derived.by(() => {
    const opts = [{ value: 'global', label: 'Global' }];
    for (const p of projectStore.entries) {
      opts.push({ value: p.path, label: `Project: ${p.name}` });
    }
    return opts;
  });

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }

  function addEnvVar() {
    envVars = [...envVars, { key: '', value: '' }];
  }

  function removeEnvVar(index) {
    envVars = envVars.filter((_, i) => i !== index);
  }

  function parseArgs() {
    return args.split('\n').map(a => a.trim()).filter(Boolean);
  }

  function buildEnv() {
    const env = {};
    for (const { key, value } of envVars) {
      const k = key.trim();
      if (k) env[k] = value;
    }
    return Object.keys(env).length > 0 ? env : null;
  }

  async function handleTest() {
    testing = true;
    testResult = null;
    try {
      const result = await mcpTestConnection(command, parseArgs(), buildEnv());
      const data = unwrapResult(result);
      testResult = data;
    } catch (err) {
      testResult = { success: false, error: String(err) };
    } finally {
      testing = false;
    }
  }

  async function handleSave() {
    nameError = '';

    const trimmedName = name.trim();
    if (!trimmedName) { nameError = 'Name is required'; return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) { nameError = 'Only letters, numbers, hyphens, underscores'; return; }
    if (!command.trim()) { nameError = 'Command is required'; return; }

    saving = true;
    try {
      const result = await mcpWriteServer(
        trimmedName,
        command.trim(),
        parseArgs(),
        buildEnv(),
        scope,
      );
      const data = unwrapResult(result);
      if (data === null && result?.error) {
        nameError = result.error;
        return;
      }
      onSave?.();
      onClose();
    } catch (err) {
      nameError = String(err);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal mcp-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="{mode === 'add' ? 'Add' : 'Edit'} MCP Server">
    <h3 class="modal-title">{mode === 'add' ? 'Add MCP Server' : 'Edit MCP Server'}</h3>

    <!-- Name -->
    <label class="field-label">
      Name
      <input class="field-input" type="text" bind:value={name} disabled={mode === 'edit'} placeholder="my-server" />
    </label>
    {#if nameError}
      <div class="field-error">{nameError}</div>
    {/if}

    <!-- Command -->
    <label class="field-label">
      Command
      <input class="field-input" type="text" bind:value={command} placeholder="npx" />
    </label>

    <!-- Args -->
    <label class="field-label">
      Arguments <span class="field-hint">(one per line)</span>
      <textarea class="field-textarea" bind:value={args} rows="3" placeholder="-y&#10;@anthropic/mcp-fs"></textarea>
    </label>

    <!-- Env vars -->
    <div class="field-label">Environment Variables</div>
    {#each envVars as env, i}
      <div class="env-row">
        <input class="field-input env-key" type="text" bind:value={env.key} placeholder="KEY" />
        <span class="env-eq">=</span>
        <input class="field-input env-val" type="text" bind:value={env.value} placeholder="value" />
        <button class="env-remove" onclick={() => removeEnvVar(i)} title="Remove">×</button>
      </div>
    {/each}
    <button class="env-add-btn" onclick={addEnvVar}>+ Add Variable</button>

    <!-- Scope -->
    <label class="field-label">
      Scope
      {#if mode === 'edit'}
        <input class="field-input" type="text" value={scope === 'global' ? 'Global' : `Project: ${scope}`} disabled />
      {:else}
        <select class="field-select" bind:value={scope}>
          {#each scopeOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {/if}
    </label>

    <!-- Test result -->
    {#if testResult}
      <div class="test-result" class:success={testResult.success} class:failure={!testResult.success}>
        {#if testResult.success}
          Connected{testResult.serverName ? ` to ${testResult.serverName}` : ''} — {testResult.toolCount ?? '?'} tools available
        {:else}
          {testResult.error || 'Connection failed'}
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-actions">
      <button class="btn-cancel" onclick={onClose}>Cancel</button>
      <button class="btn-test" onclick={handleTest} disabled={testing || !command.trim()}>
        {testing ? 'Testing...' : 'Test'}
      </button>
      <button class="btn-save" onclick={handleSave} disabled={saving || !name.trim() || !command.trim()}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mcp-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-title {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    margin-top: 12px;
  }

  .field-hint {
    opacity: 0.6;
    font-weight: normal;
  }

  .field-input, .field-textarea, .field-select {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    outline: none;
    box-sizing: border-box;
  }

  .field-input:focus, .field-textarea:focus, .field-select:focus {
    border-color: var(--accent);
  }

  .field-textarea {
    resize: vertical;
    min-height: 60px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  .field-error {
    font-size: 12px;
    color: var(--danger, #ef4444);
    margin-top: 4px;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
  }

  .env-key { flex: 2; font-family: var(--font-mono, monospace); font-size: 12px; }
  .env-eq { color: var(--muted); font-size: 13px; }
  .env-val { flex: 3; font-family: var(--font-mono, monospace); font-size: 12px; }

  .env-remove {
    background: none;
    border: none;
    color: var(--danger, #ef4444);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .env-remove:hover { background: var(--bg-hover); }

  .env-add-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    padding: 4px 0;
    margin-top: 4px;
    font-family: var(--font-family);
  }

  .env-add-btn:hover { text-decoration: underline; }

  .test-result {
    font-size: 12px;
    padding: 8px 10px;
    border-radius: var(--radius);
    margin-top: 12px;
  }

  .test-result.success {
    color: var(--ok, #22c55e);
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .test-result.failure {
    color: var(--danger, #ef4444);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .btn-cancel, .btn-test, .btn-save {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-cancel:hover { background: var(--bg-hover); }

  .btn-test {
    background: var(--bg);
    border: 1px solid var(--accent);
    color: var(--accent);
  }

  .btn-test:hover { background: var(--bg-hover); }

  .btn-save {
    background: var(--accent);
    color: #fff;
  }

  .btn-save:hover { filter: brightness(1.1); }

  .btn-test:disabled, .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/McpServerModal.svelte
git commit -m "feat(mcp): add McpServerModal component for add/edit MCP servers"
```

---

### Task 5: Frontend — `McpServerSettings.svelte`

**Files:**
- Create: `src/components/settings/McpServerSettings.svelte`

- [ ] **Step 1: Create the settings tab component**

Create `src/components/settings/McpServerSettings.svelte`:

```svelte
<script>
  import { discoverMcpServers } from '../../lib/api.js';
  import { mcpTestConnection, mcpDeleteServer } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import McpServerModal from './McpServerModal.svelte';

  let servers = $state([]);
  let loading = $state(true);
  let showModal = $state(false);
  let modalMode = $state('add');
  let modalServer = $state(null);
  let confirmDelete = $state(null); // { name, scope }
  let testingServer = $state(null); // server name being tested
  let testResult = $state(null);

  // Overflow menu state
  let openMenu = $state(null); // server name

  async function loadServers() {
    loading = true;
    try {
      const project = projectStore.activeProject;
      const path = project?.path || '';
      // Skip discovery if no valid workspace path (will error on empty string)
      if (!path) {
        // Still discover global servers by reading ~/.claude/settings.json
        // The Rust command needs a valid path — use the app's own directory as fallback
        const result = await discoverMcpServers('.', null);
        const all = unwrapResult(result) || [];
        servers = all.filter(s => !s.isOwn);
      } else {
        const prefs = project?.mcpServers || null;
        const result = await discoverMcpServers(path, prefs);
        const all = unwrapResult(result) || [];
        servers = all.filter(s => !s.isOwn);
      }
    } catch (err) {
      console.error('[mcp-settings] Discovery failed:', err);
      servers = [];
    } finally {
      loading = false;
    }
  }

  // Load on mount and re-load when active project changes
  $effect(() => {
    // Track reactive dependency on activeProject
    const _project = projectStore.activeProject;
    loadServers();
  });

  function openAdd() {
    modalMode = 'add';
    modalServer = null;
    showModal = true;
  }

  function openEdit(server) {
    modalMode = 'edit';
    // Attach project path for scope resolution in modal
    modalServer = { ...server, _projectPath: server.source === 'project' ? (projectStore.activeProject?.path || '') : 'global' };
    showModal = true;
    openMenu = null;
  }

  async function handleTest(server) {
    openMenu = null;
    testingServer = server.name;
    testResult = null;
    try {
      const cmd = server.config?.command || '';
      const args = server.config?.args || [];
      const env = server.config?.env || null;
      const result = await mcpTestConnection(cmd, args, env);
      const data = unwrapResult(result);
      testResult = { name: server.name, ...data };
    } catch (err) {
      testResult = { name: server.name, success: false, error: String(err) };
    } finally {
      testingServer = null;
    }
  }

  function promptDelete(server) {
    openMenu = null;
    const scope = server.source === 'project' ? (projectStore.activeProject?.path || '') : 'global';
    confirmDelete = { name: server.name, scope, label: server.source === 'global' ? 'global config' : `project config` };
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await mcpDeleteServer(confirmDelete.name, confirmDelete.scope);
      await loadServers();
    } catch (err) {
      console.error('[mcp-settings] Delete failed:', err);
    }
    confirmDelete = null;
  }

  function toggleMenu(name) {
    openMenu = openMenu === name ? null : name;
  }

  function truncate(str, len = 40) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  function commandPreview(server) {
    const cmd = server.config?.command || '';
    const args = (server.config?.args || []).join(' ');
    return truncate(`${cmd} ${args}`.trim());
  }
</script>

<div class="settings-section">
  <div class="mcp-header">
    <h3>MCP Servers</h3>
    <button class="mcp-add-btn" onclick={openAdd}>+ Add Server</button>
  </div>

  {#if loading}
    <div class="mcp-loading">Discovering servers...</div>
  {:else if servers.length === 0}
    <div class="mcp-empty">No MCP servers configured. Click + Add Server to get started.</div>
  {:else}
    <div class="mcp-list">
      {#each servers as server}
        <div class="mcp-card">
          <div class="mcp-card-info">
            <span class="mcp-card-name">{server.name}</span>
            <span class="mcp-card-cmd">{commandPreview(server)}</span>
          </div>
          <span class="mcp-card-scope">{server.source}</span>
          {#if testingServer === server.name}
            <span class="mcp-card-testing">Testing...</span>
          {/if}
          <div class="mcp-card-menu-wrap">
            <button class="mcp-card-menu-btn" onclick={(e) => { e.stopPropagation(); toggleMenu(server.name); }} title="Actions">⋮</button>
            {#if openMenu === server.name}
              <div class="mcp-card-dropdown">
                <button onclick={() => openEdit(server)}>Edit</button>
                <button onclick={() => handleTest(server)}>Test Connection</button>
                <button class="danger" onclick={() => promptDelete(server)}>Delete</button>
              </div>
            {/if}
          </div>
        </div>
        {#if testResult?.name === server.name}
          <div class="mcp-test-inline" class:success={testResult.success} class:failure={!testResult.success}>
            {#if testResult.success}
              Connected{testResult.serverName ? ` to ${testResult.serverName}` : ''} — {testResult.toolCount ?? '?'} tools
            {:else}
              {testResult.error || 'Connection failed'}
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<!-- Delete confirmation -->
{#if confirmDelete}
  <div class="modal-overlay" onclick={() => confirmDelete = null} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <p>Delete <strong>{confirmDelete.name}</strong> from {confirmDelete.label}?</p>
      <div class="confirm-actions">
        <button class="btn-cancel" onclick={() => confirmDelete = null}>Cancel</button>
        <button class="btn-delete" onclick={handleDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add/Edit modal -->
{#if showModal}
  <McpServerModal
    mode={modalMode}
    server={modalServer}
    onClose={() => showModal = false}
    onSave={loadServers}
  />
{/if}

<!-- Click-outside handler for overflow menu -->
<svelte:window onclick={() => { openMenu = null; }} />

<style>
  .mcp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .mcp-header h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .mcp-add-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    padding: 4px 12px;
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
  }

  .mcp-add-btn:hover { filter: brightness(1.1); }

  .mcp-loading, .mcp-empty {
    font-size: 13px;
    color: var(--muted);
    padding: 16px 0;
  }

  .mcp-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mcp-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--card-highlight);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 10px 14px;
  }

  .mcp-card-info {
    flex: 1;
    min-width: 0;
  }

  .mcp-card-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    display: block;
  }

  .mcp-card-cmd {
    font-size: 11px;
    color: var(--muted);
    font-family: var(--font-mono, monospace);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mcp-card-scope {
    font-size: 10px;
    color: var(--muted);
    padding: 2px 6px;
    background: var(--bg);
    border-radius: 3px;
    white-space: nowrap;
  }

  .mcp-card-testing {
    font-size: 11px;
    color: var(--accent);
  }

  .mcp-card-menu-wrap {
    position: relative;
  }

  .mcp-card-menu-btn {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 18px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    line-height: 1;
  }

  .mcp-card-menu-btn:hover { background: var(--bg-hover); color: var(--text); }

  .mcp-card-dropdown {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 100;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 140px;
    padding: 4px 0;
  }

  .mcp-card-dropdown button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: none;
    border: none;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-family);
  }

  .mcp-card-dropdown button:hover { background: var(--bg-hover); }
  .mcp-card-dropdown button.danger { color: var(--danger, #ef4444); }
  .mcp-card-dropdown button.danger:hover { background: rgba(239, 68, 68, 0.1); }

  .mcp-test-inline {
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    margin-top: -5px;
    border: 1px solid var(--border);
    border-top: none;
  }

  .mcp-test-inline.success {
    color: var(--ok, #22c55e);
    background: rgba(34, 197, 94, 0.05);
  }

  .mcp-test-inline.failure {
    color: var(--danger, #ef4444);
    background: rgba(239, 68, 68, 0.05);
  }

  /* Confirmation dialog */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .confirm-dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 360px;
    max-width: 90vw;
  }

  .confirm-dialog p {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--text);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-cancel, .btn-delete {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    cursor: pointer;
    border: none;
    font-family: var(--font-family);
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-delete {
    background: var(--danger, #ef4444);
    color: #fff;
  }

  .btn-delete:hover { filter: brightness(1.1); }
</style>
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/McpServerSettings.svelte
git commit -m "feat(mcp): add McpServerSettings tab component with server list and actions"
```

---

### Task 6: Register Tab in Settings Panel

**Files:**
- Modify: `src/components/settings/SettingsPanel.svelte`

- [ ] **Step 1: Import and register the MCP tab**

Read `src/components/settings/SettingsPanel.svelte`. Then:

Add import at the top:
```javascript
import McpServerSettings from './McpServerSettings.svelte';
```

In the `TABS` array, add after `{ id: 'ai', label: 'AI & Tools' }`:
```javascript
  { id: 'mcp', label: 'MCP Servers' },
```

In the tab content section (the if/else blocks), add a new block for the `mcp` tab:
```svelte
{:else if activeTab === 'mcp'}
  <div class="settings-tab-content" id="settings-tab-mcp" role="tabpanel">
    <McpServerSettings />
  </div>
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/SettingsPanel.svelte
git commit -m "feat(mcp): register MCP Servers as 3rd tab in Settings panel"
```

---

### Task 7: Integration Test — Manual Verification

**Files:** None (manual testing)

- [ ] **Step 1: Build and run the app**

Run: `npm run dev`

- [ ] **Step 2: Test server list**

1. Open Settings → MCP Servers tab
2. Verify discovered servers appear with name, command preview, scope badge
3. Verify `voice-mirror` is NOT in the list

- [ ] **Step 3: Test add server**

1. Click "+ Add Server"
2. Fill in: Name = `test-server`, Command = `echo`, Args = `hello`
3. Select Scope = Global
4. Click Save
5. Verify the server appears in the list
6. Check `~/.claude/settings.json` — verify `test-server` entry exists

- [ ] **Step 4: Test edit server**

1. Click ⋮ → Edit on `test-server`
2. Change Args to `world`
3. Click Save
4. Verify the change persists

- [ ] **Step 5: Test connection**

1. Click ⋮ → Test Connection on a real MCP server (e.g., one you have configured)
2. Verify "Connected — N tools available" appears inline
3. Test with a bad command — verify error message appears

- [ ] **Step 6: Test delete**

1. Click ⋮ → Delete on `test-server`
2. Verify confirmation dialog appears
3. Click Delete
4. Verify server removed from list and from `~/.claude/settings.json`

- [ ] **Step 7: Commit any fixes**

```bash
git add -A && git commit -m "fix(mcp): integration test fixes for MCP Server Manager"
```
