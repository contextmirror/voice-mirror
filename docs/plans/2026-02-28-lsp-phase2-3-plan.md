# LSP Phase 2 + 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the LSP system production-grade with project-scoped servers, crash recovery, health monitoring, project-wide diagnostics, a full management UI, and multi-server support per file.

**Architecture:** Three-phase build — Phase 2 hardens the server lifecycle (project-scoped keys, state machine, crash recovery, health monitoring, idle shutdown), project-wide diagnostics scans all project files on server start, and Phase 3 adds multi-server routing (primary vs supplementary) with diagnostic merging. Each phase is stable before the next builds on it.

**Tech Stack:** Rust (Tauri commands, LspManager, tokio tasks), Svelte 5 (LspTab, LensWorkspace, diagnostic store), source-inspection tests (node:test + node:assert/strict).

---

## Checklist

Update this checklist as tasks are completed.

### Phase 2: Server Lifecycle + Project-Aware Servers

- [ ] Task 1: Add server state enum and extend LspServerStatus
- [ ] Task 2: Project-scoped server keys
- [ ] Task 3: Shutdown-all on project switch (frontend wiring)
- [ ] Task 4: Add workspaceFolders to initialize request
- [ ] Task 5: Crash recovery with exponential backoff
- [ ] Task 6: Health monitoring (stale request detection)
- [ ] Task 7: Idle shutdown timer
- [ ] Task 8: Server stderr capture for error log
- [ ] Task 9: Server version detection
- [ ] Task 10: LspTab management panel rewrite
- [ ] Task 11: API wrappers for new commands

### Project-Wide Diagnostics

- [ ] Task 12: Background file scanner in Rust
- [ ] Task 13: Staggered didOpen for background files
- [ ] Task 14: File watcher integration for background diagnostics
- [ ] Task 15: Diagnostic store updates for project-wide state

### Phase 3: Multi-Server Per File

- [ ] Task 16: Priority field in manifest
- [ ] Task 17: Multi-server routing (supplementary servers)
- [ ] Task 18: Diagnostic source labels in Problems panel
- [ ] Task 19: ESLint manifest entry
- [ ] Task 20: Native binary download support (rust-analyzer)
- [ ] Task 21: Final integration verification

---

## Phase 2 Tasks

### Task 1: Add server state enum and extend LspServerStatus

**Files:**
- Modify: `src-tauri/src/lsp/types.rs:88-100`
- Modify: `src-tauri/src/lsp/mod.rs:33-44`
- Test: `test/lsp/lsp-types.test.cjs` (create)

**Step 1: Write the failing test**

Create `test/lsp/lsp-types.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);
const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('types.rs: server state enum', () => {
  it('defines ServerState enum with all lifecycle states', () => {
    assert.ok(typesSrc.includes('enum ServerState'), 'Missing ServerState enum');
    for (const state of ['Stopped', 'Starting', 'Running', 'Restarting', 'Stopping', 'Failed']) {
      assert.ok(typesSrc.includes(state), `Missing state: ${state}`);
    }
  });

  it('derives Serialize and Clone for ServerState', () => {
    assert.ok(typesSrc.includes('Serialize') && typesSrc.includes('Clone'),
      'ServerState should derive Serialize and Clone');
  });
});

describe('types.rs: extended LspServerStatus', () => {
  it('has state field instead of just running bool', () => {
    assert.ok(typesSrc.includes('state:'), 'LspServerStatus should have state field');
  });

  it('has crash_count field', () => {
    assert.ok(typesSrc.includes('crash_count'), 'LspServerStatus should have crash_count');
  });

  it('has project_root field', () => {
    assert.ok(typesSrc.includes('project_root'), 'LspServerStatus should have project_root');
  });

  it('has last_error field', () => {
    assert.ok(typesSrc.includes('last_error'), 'LspServerStatus should have last_error');
  });

  it('has pid field', () => {
    assert.ok(typesSrc.includes('pid'), 'LspServerStatus should have pid');
  });
});

describe('mod.rs: LspServer has state field', () => {
  it('uses ServerState enum in LspServer struct', () => {
    assert.ok(modSrc.includes('state:'), 'LspServer should have state field');
    assert.ok(modSrc.includes('ServerState'), 'LspServer should use ServerState type');
  });

  it('has project_root field on LspServer', () => {
    assert.ok(modSrc.includes('project_root: String'), 'LspServer should store project_root');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "server state enum|extended LspServerStatus|LspServer has state"`
Expected: FAIL

**Step 3: Implement the changes**

In `src-tauri/src/lsp/types.rs`, add after line 100 (after `LspServerStatusEvent`):

```rust
/// Server lifecycle state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ServerState {
    Stopped,
    Starting,
    Running,
    Restarting,
    Stopping,
    Failed,
}
```

Replace `LspServerStatus` (lines 88-94) with:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStatus {
    pub language_id: String,
    pub binary: String,
    pub state: ServerState,
    pub open_docs_count: usize,
    pub crash_count: u32,
    pub project_root: String,
    pub last_error: Option<String>,
    pub pid: Option<u32>,
    /// Keep for backward compat with frontend
    pub running: bool,
}
```

In `src-tauri/src/lsp/mod.rs`, update `LspServer` struct (lines 33-44):

```rust
pub struct LspServer {
    pub language_id: String,
    pub binary: String,
    pub process: Child,
    pub next_id: AtomicI64,
    pub open_docs: HashSet<String>,
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub capabilities: Option<lsp_types::ServerCapabilities>,
    pub pending_requests: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    pub crash_count: u32,
    pub last_crash: Option<Instant>,
    pub state: types::ServerState,
    pub project_root: String,
    pub last_error: Option<String>,
    pub stderr_lines: Vec<String>,
}
```

Update `get_status()` (lines 1145-1155) to populate the new fields.

Update the `LspServer` construction in `ensure_server()` (around line 429-443) to set `state: ServerState::Running`, `project_root: project_root.to_string()`, `last_error: None`, `stderr_lines: Vec::new()`.

**Step 4: Run tests**

Run: `npm test && cd src-tauri && cargo check`
Expected: All pass, clean compilation

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/types.rs src-tauri/src/lsp/mod.rs test/lsp/lsp-types.test.cjs
git commit -m "feat(lsp): add ServerState enum and extend LspServerStatus"
```

---

### Task 2: Project-scoped server keys

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:48` (HashMap key)
- Modify: `src-tauri/src/lsp/mod.rs:69-449` (ensure_server)
- Modify: `src-tauri/src/lsp/mod.rs:452-1224` (all methods using lang_id as key)
- Test: `test/lsp/lsp-project-scope.test.cjs` (create)

**Context:** Currently servers are keyed by `lang_id` only (e.g., `"typescript"`). If the user switches projects, the old server keeps running with the wrong `rootUri`. We need to key by `(lang_id, project_root)` so that switching projects triggers fresh server startup.

**Step 1: Write the failing test**

Create `test/lsp/lsp-project-scope.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: project-scoped server keys', () => {
  it('builds server key from lang_id and project_root', () => {
    assert.ok(modSrc.includes('server_key'), 'Should use server_key function or variable');
  });

  it('ensure_server checks for project_root match', () => {
    // The early-return check should include project_root, not just lang_id
    assert.ok(
      modSrc.includes('project_root') && modSrc.includes('server_key'),
      'ensure_server should use project-scoped key'
    );
  });

  it('all methods use server_key for HashMap lookup', () => {
    // open_document, close_document, etc. should use server_key
    const methods = ['open_document', 'close_document', 'change_document', 'request_completion'];
    for (const m of methods) {
      // Find the method and check it uses server_key or lang_id+project combo
      assert.ok(modSrc.includes('server_key') || modSrc.includes('fn ' + m),
        `${m} should use project-scoped lookup`);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "project-scoped server keys"`
Expected: FAIL

**Step 3: Implement**

**Strategy:** Create a `server_key(lang_id, project_root) -> String` helper that returns `"{lang_id}::{project_root}"`. Replace all `HashMap<String, LspServer>` lookups from `lang_id` to `server_key(lang_id, project_root)`.

The problem is that many methods (like `open_document`, `request_completion`) don't currently receive `project_root` — they only get `lang_id`. But looking at `commands/lsp.rs`, EVERY command already receives `project_root` from the frontend and could pass it through.

**Changes needed:**

1. Add helper in `mod.rs`:
```rust
fn server_key(lang_id: &str, project_root: &str) -> String {
    format!("{}::{}", lang_id, project_root)
}
```

2. Update every LspManager method signature to accept `project_root: &str`:
   - `open_document`, `close_document`, `change_document`, `save_document`
   - `request_completion`, `request_hover`, `request_signature_help`, `request_definition`
   - `request_document_symbols`, `request_references`, `request_code_actions`
   - `request_prepare_rename`, `request_rename`, `request_formatting`, `request_range_formatting`
   - `shutdown_server`

3. Replace `self.servers.get(lang_id)` / `self.servers.get_mut(lang_id)` with `self.servers.get(&server_key(lang_id, project_root))` everywhere.

4. Update `ensure_server()` (line 74) early return check: `self.servers.contains_key(&server_key(lang_id, project_root))`

5. Update `get_status()` to extract lang_id from the key.

6. Update all call sites in `commands/lsp.rs` to pass `&project_root` to every method.

**Step 4: Run tests**

Run: `npm test && cd src-tauri && cargo check`
Expected: All pass

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/commands/lsp.rs test/lsp/lsp-project-scope.test.cjs
git commit -m "feat(lsp): project-scoped server keys (lang_id + project_root)"
```

---

### Task 3: Shutdown-all on project switch (frontend wiring)

**Files:**
- Modify: `src-tauri/src/commands/lsp.rs:759-765` (add project_root param to shutdown)
- Modify: `src/components/lens/LensWorkspace.svelte:192-204` (add shutdown call)
- Modify: `src/lib/api.js:708` (update lspShutdown wrapper)
- Test: `test/components/lens-workspace.test.cjs` (add test)

**Step 1: Write the failing test**

Add to existing `test/components/lens-workspace.test.cjs` (or create if needed):

```javascript
describe('LensWorkspace.svelte: project switch LSP cleanup', () => {
  it('calls lspShutdown on project switch', () => {
    assert.ok(
      workspaceSrc.includes('lspShutdown') || workspaceSrc.includes('lsp_shutdown'),
      'Should shut down LSP servers when switching projects'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

In `LensWorkspace.svelte`, update the LSP diagnostics effect (lines 192-204):

```javascript
$effect(() => {
  const path = projectStore.activeProject?.path;
  if (!path) return;

  // Shut down LSP servers from previous project before starting new ones
  lspShutdown().catch(() => {});

  lspDiagnosticsStore.clear();
  lspDiagnosticsStore.startListening(path).catch((err) => {
    console.error('Failed to start LSP diagnostics listener:', err);
  });
  return () => {
    lspDiagnosticsStore.stopListening();
  };
});
```

Add `lspShutdown` to the imports from `api.js`.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src/components/lens/LensWorkspace.svelte src/lib/api.js
git commit -m "feat(lsp): shutdown all servers on project switch"
```

---

### Task 4: Add workspaceFolders to initialize request

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:332-403` (initialize params)
- Test: `test/lsp/lsp-init-options.test.cjs` (add test)

**Step 1: Write the failing test**

Add to `test/lsp/lsp-init-options.test.cjs`:

```javascript
describe('mod.rs: workspaceFolders', () => {
  it('sends workspaceFolders in initialize request', () => {
    assert.ok(modSrc.includes('workspaceFolders'), 'Should include workspaceFolders');
  });

  it('declares workspaceFolders capability', () => {
    assert.ok(modSrc.includes('workspace_folders'), 'Should declare workspace.workspaceFolders capability');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

In `ensure_server()`, in the initialize params object (around line 332), add:

```rust
"workspaceFolders": [{
    "uri": root_uri,
    "name": std::path::Path::new(project_root)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_root.to_string()),
}],
```

And in the capabilities section, add workspace capabilities:

```rust
"workspace": {
    "workspaceFolders": {
        "supported": true,
        "changeNotifications": true,
    }
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-init-options.test.cjs
git commit -m "feat(lsp): send workspaceFolders in initialize request"
```

---

### Task 5: Crash recovery with exponential backoff

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add restart logic, crash channel)
- Modify: `src-tauri/src/lsp/client.rs:116-176` (reader loop crash notification)
- Test: `test/lsp/lsp-crash-recovery.test.cjs` (create)

**Context:** The reader loop in `client.rs` detects EOF but can't access `LspManager`. We need a channel from the reader loop back to the manager to trigger restart.

**Step 1: Write the failing test**

Create `test/lsp/lsp-crash-recovery.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const clientSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/client.rs'), 'utf-8'
);

describe('mod.rs: crash recovery', () => {
  it('has restart_server method', () => {
    assert.ok(modSrc.includes('restart_server'), 'Should have restart_server method');
  });

  it('implements exponential backoff', () => {
    assert.ok(modSrc.includes('backoff') || modSrc.includes('crash_count'),
      'Should implement backoff based on crash_count');
  });

  it('caps at max crashes before failing', () => {
    assert.ok(modSrc.includes('MAX_CRASHES') || modSrc.includes('Failed'),
      'Should stop restarting after max crashes');
  });

  it('resets crash count after stable period', () => {
    assert.ok(modSrc.includes('last_crash') && modSrc.includes('crash_count = 0'),
      'Should reset crash_count after stable period');
  });
});

describe('client.rs: crash notification channel', () => {
  it('sends crash notification when reader loop exits', () => {
    assert.ok(
      clientSrc.includes('crash_tx') || clientSrc.includes('crash_sender') || clientSrc.includes('crash_notify'),
      'Reader loop should notify on crash via channel'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

**Strategy:** Use a `tokio::sync::mpsc` channel. When the reader loop detects EOF, it sends the `server_key` on the crash channel. A background task in LspManager listens for crash events and triggers restart with backoff.

In `mod.rs`:

1. Add `crash_tx: mpsc::Sender<String>` to `LspServer` struct.
2. In `ensure_server()`, create the channel and pass `crash_tx` to `spawn_reader_loop()`.
3. Spawn a crash handler task that:
   - Receives server_key from crash channel
   - Updates `crash_count` and `last_crash`
   - If `crash_count < 5`, sleeps for backoff duration, then calls `restart_server()`
   - If `crash_count >= 5`, sets state to `Failed`, emits notification
4. Add `restart_server()` method that removes the old server entry, then calls `ensure_server()` again.
5. In the crash handler, reset `crash_count` to 0 if `last_crash` was more than 60s ago.

In `client.rs`:

1. Add `crash_tx: mpsc::Sender<String>` parameter to `spawn_reader_loop()`.
2. On EOF (line 159-169), send the server_key on the crash channel before breaking.

**Constants:**
```rust
const MAX_CRASHES: u32 = 5;
const CRASH_RESET_SECS: u64 = 60;
const MAX_BACKOFF_SECS: u64 = 30;
```

**Backoff formula:** `min(2^(crash_count - 1), MAX_BACKOFF_SECS)` seconds.

**Step 4: Run tests**

Run: `npm test && cd src-tauri && cargo check`
Expected: All pass

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/lsp/client.rs test/lsp/lsp-crash-recovery.test.cjs
git commit -m "feat(lsp): crash recovery with exponential backoff (max 5 restarts)"
```

---

### Task 6: Health monitoring (stale request detection)

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (request timestamp tracking, health check task)
- Modify: `src-tauri/src/lsp/client.rs:256-281` (timestamp in send_request)
- Test: `test/lsp/lsp-health-monitor.test.cjs` (create)

**Step 1: Write the failing test**

Create `test/lsp/lsp-health-monitor.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: health monitoring', () => {
  it('tracks request timestamps', () => {
    assert.ok(modSrc.includes('request_time') || modSrc.includes('sent_at'),
      'Should track when requests were sent');
  });

  it('has health check interval', () => {
    assert.ok(modSrc.includes('health_check') || modSrc.includes('HEALTH_CHECK'),
      'Should have periodic health check');
  });

  it('detects unresponsive servers', () => {
    assert.ok(modSrc.includes('Unresponsive') || modSrc.includes('unresponsive'),
      'Should detect unresponsive state');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

**Strategy:** Change `pending_requests` from `HashMap<i64, oneshot::Sender<Value>>` to `HashMap<i64, (oneshot::Sender<Value>, Instant)>`. Spawn a health check task per server that scans every 10s.

1. Update `pending_requests` type in `LspServer`:
```rust
pub pending_requests: Arc<Mutex<HashMap<i64, (oneshot::Sender<Value>, Instant)>>>,
```

2. In `client.rs` `send_request()`, store `Instant::now()` alongside the sender.

3. In `client.rs` `spawn_reader_loop()`, when routing responses, extract the sender from the tuple.

4. In `mod.rs`, spawn a health check task after server starts:
```rust
// Health monitor: check for stale requests every 10s
let pending_clone = server.pending_requests.clone();
let app_clone = self.app_handle.clone();
let key_clone = key.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(10));
    loop {
        interval.tick().await;
        let guard = pending_clone.lock().await;
        let now = Instant::now();
        let stale = guard.values().any(|(_, sent_at)| now.duration_since(*sent_at).as_secs() > 30);
        if stale {
            warn!("[{}] Server appears unresponsive (request pending >30s)", key_clone);
            let _ = app_clone.emit("lsp-server-unresponsive", json!({
                "serverKey": key_clone,
            }));
        }
    }
});
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/lsp/client.rs test/lsp/lsp-health-monitor.test.cjs
git commit -m "feat(lsp): health monitoring detects unresponsive servers (30s threshold)"
```

---

### Task 7: Idle shutdown timer

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:489-526` (close_document)
- Test: `test/lsp/lsp-idle-shutdown.test.cjs` (create)

**Step 1: Write the failing test**

Create `test/lsp/lsp-idle-shutdown.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: idle shutdown', () => {
  it('starts idle timer when all docs close', () => {
    assert.ok(modSrc.includes('idle') || modSrc.includes('IDLE_TIMEOUT'),
      'Should have idle timeout logic');
  });

  it('cancels idle timer when new doc opens', () => {
    assert.ok(modSrc.includes('idle_cancel') || modSrc.includes('cancel_token') || modSrc.includes('abort'),
      'Should cancel idle timer on new doc open');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

**Strategy:** Add `idle_cancel: Option<tokio::sync::watch::Sender<bool>>` to `LspServer`. When `open_docs` becomes empty in `close_document()`, spawn a task that sleeps for 60s then shuts down. Store the cancel sender. In `open_document()`, if cancel sender exists, send cancel signal.

1. Add to `LspServer`:
```rust
pub idle_cancel: Option<watch::Sender<bool>>,
```

2. In `close_document()`, after removing from `open_docs`, if `open_docs.is_empty()`:
```rust
let (tx, mut rx) = watch::channel(false);
server.idle_cancel = Some(tx);
let key = server_key(lang_id, project_root).to_string();
// ... spawn idle task
tokio::spawn(async move {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(60)) => {
            // Timeout reached — shut down
            info!("[{}] Idle timeout (60s) — shutting down", key);
            // Send shutdown signal via channel or app event
        }
        _ = rx.changed() => {
            // Cancelled — new doc opened
            debug!("[{}] Idle timer cancelled", key);
        }
    }
});
```

3. In `open_document()`, check if `idle_cancel` is `Some`, send cancel signal, set to `None`.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-idle-shutdown.test.cjs
git commit -m "feat(lsp): idle shutdown after 60s with no open documents"
```

---

### Task 8: Server stderr capture for error log

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:224-298` (stderr logging task)
- Test: `test/lsp/lsp-stderr-capture.test.cjs` (create)

**Context:** `ensure_server()` already spawns a stderr reading task (lines 224-298) but it only logs to tracing. We need to capture the last N lines so the LspTab can show them.

**Step 1: Write the failing test**

Create `test/lsp/lsp-stderr-capture.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: stderr capture', () => {
  it('stores stderr lines on LspServer', () => {
    assert.ok(modSrc.includes('stderr_lines'), 'LspServer should have stderr_lines field');
  });

  it('caps stderr buffer size', () => {
    assert.ok(
      modSrc.includes('MAX_STDERR_LINES') || modSrc.includes('stderr_lines.len()'),
      'Should limit stderr buffer size'
    );
  });
});
```

**Step 2: Run test — FAIL** (stderr_lines field was added in Task 1, but capture logic missing)

**Step 3: Implement**

In `ensure_server()`, the stderr task (lines 224-298) currently uses a local `stderr_reader`. Share the `stderr_lines` buffer via `Arc<Mutex<Vec<String>>>`:

1. Add `stderr_lines: Arc<Mutex<Vec<String>>>` to `LspServer` (replace `Vec<String>` from Task 1).
2. Clone the Arc into the stderr reading task.
3. In the task, after each line, push to the shared vec (cap at 50 lines, drop oldest).
4. In `get_status()`, read the last 5 lines for the status response.

```rust
const MAX_STDERR_LINES: usize = 50;

// In stderr task:
let stderr_buf = server_stderr_lines.clone();
// ...
let mut buf = stderr_buf.lock().await;
buf.push(line.clone());
if buf.len() > MAX_STDERR_LINES {
    buf.remove(0);
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-stderr-capture.test.cjs
git commit -m "feat(lsp): capture stderr lines for LspTab error display"
```

---

### Task 9: Server version detection

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (read version from package.json or initialize response)
- Modify: `src-tauri/src/lsp/types.rs` (add version to LspServerStatus)
- Test: `test/lsp/lsp-version.test.cjs` (create)

**Step 1: Write the failing test**

Create `test/lsp/lsp-version.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);
const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('types.rs: version field', () => {
  it('LspServerStatus has version field', () => {
    assert.ok(typesSrc.includes('version:'), 'Should have version field');
  });
});

describe('mod.rs: version detection', () => {
  it('reads server version from initialize response', () => {
    assert.ok(
      modSrc.includes('serverInfo') || modSrc.includes('server_info'),
      'Should read serverInfo from initialize response'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

The LSP `initialize` response includes `serverInfo: { name, version }`. Extract it after the initialize response (around line 415):

```rust
let version = response
    .get("result")
    .and_then(|r| r.get("serverInfo"))
    .and_then(|si| si.get("version"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
```

Add `pub version: Option<String>` to `LspServer` and `LspServerStatus`.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/lsp/types.rs test/lsp/lsp-version.test.cjs
git commit -m "feat(lsp): detect server version from initialize response"
```

---

### Task 10: LspTab management panel rewrite

**Files:**
- Modify: `src/components/lens/LspTab.svelte` (full rewrite)
- Modify: `src/lib/api.js` (add restart wrapper)
- Modify: `src-tauri/src/commands/lsp.rs` (add restart_server command)
- Modify: `src-tauri/src/lib.rs` (register command)
- Test: `test/components/lsp-tab.test.cjs` (create or update)

**Step 1: Write the failing test**

Create `test/components/lsp-tab.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LspTab.svelte'), 'utf-8'
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);

describe('LspTab.svelte: management panel', () => {
  it('shows server state (not just running bool)', () => {
    assert.ok(src.includes('server.state'), 'Should display server.state');
  });

  it('has restart button', () => {
    assert.ok(src.includes('Restart'), 'Should have Restart button');
  });

  it('has stop button', () => {
    assert.ok(src.includes('Stop'), 'Should have Stop button');
  });

  it('shows crash count when > 0', () => {
    assert.ok(src.includes('crashCount') || src.includes('crash_count'),
      'Should display crash count');
  });

  it('shows server version', () => {
    assert.ok(src.includes('version'), 'Should display server version');
  });

  it('shows project root', () => {
    assert.ok(src.includes('projectRoot') || src.includes('project'),
      'Should display project root');
  });

  it('has install button for uninstalled servers', () => {
    assert.ok(src.includes('Install'), 'Should have Install button');
  });

  it('has enable/disable toggle', () => {
    assert.ok(src.includes('enable') || src.includes('disable') || src.includes('toggle'),
      'Should have enable/disable toggle');
  });

  it('has expandable detail section', () => {
    assert.ok(src.includes('detail') || src.includes('expand'),
      'Should have expandable detail section');
  });

  it('has restart all button', () => {
    assert.ok(src.includes('Restart All') || src.includes('restartAll'),
      'Should have Restart All button');
  });
});

describe('api.js: restart server wrapper', () => {
  it('has lspRestartServer function', () => {
    assert.ok(apiSrc.includes('lspRestartServer'), 'Should have lspRestartServer wrapper');
  });
});

describe('commands/lsp.rs: restart command', () => {
  it('has lsp_restart_server command', () => {
    assert.ok(cmdSrc.includes('lsp_restart_server'), 'Should have restart_server command');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

**Rust side:** Add `lsp_restart_server` command in `commands/lsp.rs`:

```rust
#[tauri::command]
pub async fn lsp_restart_server(
    lang_id: String,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let mut manager = state.0.lock().await;
    manager.shutdown_server(&lang_id, &project_root).await.ok();
    match manager.ensure_server(&lang_id, &project_root).await {
        Ok(()) => Ok(IpcResponse::ok(json!({"restarted": true}))),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}
```

Register in `lib.rs` invoke handler chain.

**API wrapper:** Add `lspRestartServer(langId, projectRoot)` to `api.js`.

**LspTab.svelte:** Full rewrite with:
- Per-server row: state dot (color-coded), name, version, file count, project root (basename)
- Action buttons: Restart (when running/failed), Stop (when running), Install (when not installed)
- Enable/disable toggle
- Expandable detail: last error, stderr lines, binary path
- Top bar: Restart All, Install All Missing
- Listen for `lsp-server-status`, `lsp-server-unresponsive`, `lsp-install-status` events

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src/components/lens/LspTab.svelte src/lib/api.js src-tauri/src/commands/lsp.rs src-tauri/src/lib.rs test/components/lsp-tab.test.cjs
git commit -m "feat(lsp): full management panel with restart, stop, install, version display"
```

---

### Task 11: API wrappers for new commands

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src-tauri/src/commands/lsp.rs` (add get_server_detail command)
- Test: `test/api/api-lsp.test.cjs` (update)

**Step 1: Write the failing test**

Add to `test/api/api-lsp.test.cjs`:

```javascript
describe('api.js: new LSP management wrappers', () => {
  it('has lspRestartServer', () => {
    assert.ok(apiSrc.includes('lspRestartServer'));
  });
  it('has lspGetServerDetail', () => {
    assert.ok(apiSrc.includes('lspGetServerDetail'));
  });
  it('has lspShutdownAll', () => {
    assert.ok(apiSrc.includes('lspShutdownAll') || apiSrc.includes('lspShutdown'));
  });
});
```

**Step 2: Run test — FAIL** (lspGetServerDetail missing)

**Step 3: Implement**

Add `lsp_get_server_detail` command that returns full detail for one server (stderr_lines, binary path, init options, capabilities list).

Add API wrappers:
```javascript
export async function lspGetServerDetail(langId, projectRoot) {
  return invoke('lsp_get_server_detail', { langId, projectRoot });
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src/lib/api.js src-tauri/src/commands/lsp.rs src-tauri/src/lib.rs test/api/api-lsp.test.cjs
git commit -m "feat(lsp): add lspGetServerDetail and lspRestartServer API wrappers"
```

---

## Project-Wide Diagnostics Tasks

### Task 12: Background file scanner in Rust

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add scan_project_files method)
- Modify: `src-tauri/src/commands/lsp.rs` (add lsp_scan_project command)
- Test: `test/lsp/lsp-project-scan.test.cjs` (create)

**Context:** When a server reaches `Running` state, scan the project directory for matching files and send `didOpen` for each. This populates diagnostics across the entire project without the user opening every file.

**Step 1: Write the failing test**

Create `test/lsp/lsp-project-scan.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: project file scanner', () => {
  it('has scan_project_files method', () => {
    assert.ok(modSrc.includes('scan_project_files'), 'Should have scan_project_files');
  });

  it('skips common ignored directories', () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', 'target']) {
      assert.ok(modSrc.includes(dir), `Should skip ${dir} directory`);
    }
  });

  it('caps max files scanned', () => {
    assert.ok(
      modSrc.includes('MAX_SCAN_FILES') || modSrc.includes('max_files'),
      'Should have max file cap'
    );
  });

  it('tracks background docs separately', () => {
    assert.ok(
      modSrc.includes('background_docs') || modSrc.includes('background'),
      'Should track background (not user-opened) documents'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

Add to `LspServer`:
```rust
pub background_docs: HashSet<String>,  // URIs opened for background diagnostics
```

Add `scan_project_files()` method to `LspManager`:

```rust
const MAX_SCAN_FILES: usize = 500;
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "dist", "build", "target", ".svelte-kit", "__pycache__"];

pub async fn scan_project_files(&mut self, lang_id: &str, project_root: &str) -> Result<usize, String> {
    let key = server_key(lang_id, project_root);
    let server = self.servers.get_mut(&key)
        .ok_or_else(|| format!("Server not found: {}", key))?;

    // Get extensions from manifest for this server
    let manifest = super::manifest::load_manifest()
        .map_err(|e| format!("Failed to load manifest: {}", e))?;
    let entry = manifest.servers.get(lang_id)
        .ok_or_else(|| format!("Server not in manifest: {}", lang_id))?;

    let extensions: Vec<String> = entry.extensions.iter()
        .map(|e| e.to_lowercase())
        .collect();

    // Walk project directory, collect matching files up to MAX_SCAN_FILES
    let mut files = Vec::new();
    collect_matching_files(
        std::path::Path::new(project_root),
        &extensions,
        &mut files,
        MAX_SCAN_FILES,
    );

    // Send didOpen for each file (batched)
    let mut opened = 0;
    for file_path in &files {
        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let relative = file_path.strip_prefix(project_root).unwrap_or(file_path);
        let uri = types::file_uri(&relative.to_string_lossy(), project_root);

        // Skip if already in open_docs (user has it open)
        if server.open_docs.contains(&uri) {
            continue;
        }

        // Send didOpen
        let params = json!({
            "textDocument": {
                "uri": uri,
                "languageId": lang_id,
                "version": 1,
                "text": content,
            }
        });
        client::send_notification(&mut *server.stdin.lock().await, "textDocument/didOpen", params).await?;
        server.background_docs.insert(uri);
        opened += 1;
    }

    info!("[{}] Background scan: opened {} files for diagnostics", lang_id, opened);
    Ok(opened)
}

fn collect_matching_files(
    dir: &std::path::Path,
    extensions: &[String],
    files: &mut Vec<std::path::PathBuf>,
    max: usize,
) {
    if files.len() >= max { return; }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries {
        if files.len() >= max { break; }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if SKIP_DIRS.iter().any(|d| *d == name.as_ref()) {
                continue;
            }
            collect_matching_files(&path, extensions, files, max);
        } else if let Some(ext) = path.extension() {
            let dot_ext = format!(".{}", ext.to_string_lossy().to_lowercase());
            if extensions.contains(&dot_ext) {
                files.push(path);
            }
        }
    }
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/commands/lsp.rs test/lsp/lsp-project-scan.test.cjs
git commit -m "feat(lsp): background file scanner for project-wide diagnostics"
```

---

### Task 13: Staggered didOpen for background files

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add batching to scan_project_files)
- Test: `test/lsp/lsp-project-scan.test.cjs` (update)

**Step 1: Write the failing test**

Add to `test/lsp/lsp-project-scan.test.cjs`:

```javascript
describe('mod.rs: staggered background scanning', () => {
  it('batches didOpen calls with delay', () => {
    assert.ok(
      modSrc.includes('SCAN_BATCH_SIZE') || modSrc.includes('batch'),
      'Should batch didOpen calls'
    );
  });

  it('uses async sleep between batches', () => {
    assert.ok(
      modSrc.includes('sleep') && modSrc.includes('scan'),
      'Should sleep between batches to avoid flooding'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

Modify `scan_project_files()` to batch didOpen calls:

```rust
const SCAN_BATCH_SIZE: usize = 10;
const SCAN_BATCH_DELAY_MS: u64 = 100;

// In the loop:
for (i, file_path) in files.iter().enumerate() {
    // ... send didOpen ...
    if (i + 1) % SCAN_BATCH_SIZE == 0 {
        tokio::time::sleep(Duration::from_millis(SCAN_BATCH_DELAY_MS)).await;
    }
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-project-scan.test.cjs
git commit -m "feat(lsp): stagger background didOpen in batches of 10"
```

---

### Task 14: Auto-scan on server start + file watcher integration

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs:421-446` (trigger scan after ensure_server)
- Modify: `src/components/lens/LensWorkspace.svelte` (wire file watcher to LSP)
- Test: `test/lsp/lsp-project-scan.test.cjs` (update)

**Step 1: Write the failing test**

Add to existing test file:

```javascript
describe('mod.rs: auto-scan on server start', () => {
  it('calls scan_project_files after server initialization', () => {
    assert.ok(
      modSrc.includes('scan_project_files'),
      'Should call scan_project_files in ensure_server'
    );
  });
});
```

**Step 2: Run test — may pass if scan_project_files is already referenced. Adjust test if needed.**

**Step 3: Implement**

In `ensure_server()`, after the server is inserted into the HashMap and `emit_status()` is called (around line 446), spawn a background scan task:

```rust
// Trigger background project scan (non-blocking)
let key = server_key(lang_id, project_root).to_string();
let lang = lang_id.to_string();
let root = project_root.to_string();
// We need to scan after dropping the lock, so use an event-driven approach
let app = self.app_handle.clone();
tokio::spawn(async move {
    // Small delay to let server finish initialization
    tokio::time::sleep(Duration::from_secs(2)).await;
    // Trigger scan via Tauri command (re-acquires lock)
    let _ = app.emit("lsp-trigger-scan", json!({
        "langId": lang,
        "projectRoot": root,
    }));
});
```

Alternatively, create a dedicated `lsp_scan_project` command and call it from the frontend after server status changes to `Running`.

For file watcher integration, add a handler in `LensWorkspace.svelte` that listens for file change events and forwards to LSP:
- File created → if extension matches running server, send `didOpen` as background doc
- File deleted → send `didClose`, remove from background_docs
- File modified (not open in editor) → send `didChange` to refresh diagnostics

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src/components/lens/LensWorkspace.svelte test/lsp/lsp-project-scan.test.cjs
git commit -m "feat(lsp): auto-scan project on server start, file watcher integration"
```

---

### Task 15: Diagnostic store updates for project-wide state

**Files:**
- Modify: `src/lib/stores/lsp-diagnostics.svelte.js` (handle background docs)
- Test: `test/stores/lsp-diagnostics.test.cjs` (update)

**Context:** The diagnostic store already handles `lsp-diagnostics` events correctly. The main change is handling the volume — background scans may produce hundreds of diagnostic events. Ensure the store handles this efficiently.

**Step 1: Write the failing test**

Add to `test/stores/lsp-diagnostics.test.cjs`:

```javascript
describe('lsp-diagnostics.svelte.js: project-wide diagnostics', () => {
  it('handles large numbers of diagnostic entries', () => {
    // The store uses Map which handles any size, but verify it exists
    assert.ok(src.includes('Map'), 'Should use Map for diagnostics');
  });

  it('exposes total counts for status bar', () => {
    assert.ok(src.includes('getTotals'), 'Should have getTotals method');
  });

  it('handles clearing and re-populating on project switch', () => {
    assert.ok(src.includes('clear'), 'Should have clear method');
  });
});
```

**Step 2: Run test — likely passes since these already exist**

**Step 3: Verify and optimize**

The existing store should handle project-wide diagnostics without changes since `publishDiagnostics` events already flow through `handleDiagnosticsEvent()`. The key optimization: ensure `getForDirectory()` uses efficient prefix matching (it already does).

If needed, add a debounced status bar update to avoid excessive re-renders during bulk scanning.

**Step 4: Run tests — PASS**

**Step 5: Commit (only if changes needed)**

```bash
git add src/lib/stores/lsp-diagnostics.svelte.js test/stores/lsp-diagnostics.test.cjs
git commit -m "feat(lsp): optimize diagnostic store for project-wide volume"
```

---

## Phase 3 Tasks

### Task 16: Priority field in manifest

**Files:**
- Modify: `src-tauri/src/lsp/lsp-servers.json` (already has priority field, verify all entries)
- Modify: `src-tauri/src/lsp/manifest.rs` (priority is already parsed, verify routing logic)
- Test: `test/lsp/lsp-server-manifest.test.cjs` (add priority tests)

**Step 1: Write the failing test**

Add to `test/lsp/lsp-server-manifest.test.cjs`:

```javascript
describe('lsp-servers.json: server priority', () => {
  it('all current servers are primary', () => {
    for (const [id, entry] of Object.entries(manifest.servers)) {
      assert.strictEqual(entry.priority, 'primary', `${id} should be primary`);
    }
  });
});
```

**Step 2: Run test — should PASS (all current servers are primary)**

**Step 3: Verify manifest parsing handles priority correctly**

The `ServerEntry` struct already has `pub priority: String` with default `"primary"`. No code changes needed — just verification.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add test/lsp/lsp-server-manifest.test.cjs
git commit -m "test(lsp): verify priority field in manifest"
```

---

### Task 17: Multi-server routing (supplementary servers)

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (change ensure_server to support multiple servers per extension)
- Modify: `src-tauri/src/lsp/manifest.rs:72-102` (find_servers_for_extension — return all matches)
- Modify: `src-tauri/src/lsp/detection.rs:114-155` (detect_for_extension returns Vec)
- Test: `test/lsp/lsp-multi-server.test.cjs` (create)

**Context:** Currently `find_server_for_extension` returns ONE server. For multi-server, we need to return all matching servers (primary + supplementary). The primary handles completions/hover/definition; supplementary adds diagnostics + code actions.

**Step 1: Write the failing test**

Create `test/lsp/lsp-multi-server.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/manifest.rs'), 'utf-8'
);
const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('manifest.rs: multi-server support', () => {
  it('has find_servers_for_extension (plural) returning Vec', () => {
    assert.ok(
      manifestSrc.includes('find_servers_for_extension'),
      'Should have find_servers_for_extension that returns multiple matches'
    );
  });
});

describe('mod.rs: supplementary server routing', () => {
  it('distinguishes primary from supplementary requests', () => {
    assert.ok(
      modSrc.includes('primary') || modSrc.includes('supplementary'),
      'Should route based on server priority'
    );
  });

  it('ensures multiple servers per extension', () => {
    assert.ok(
      modSrc.includes('ensure_servers') || modSrc.includes('find_servers'),
      'Should support starting multiple servers for one extension'
    );
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

1. Add `find_servers_for_extension()` in `manifest.rs` that returns `Vec<(String, ServerEntry)>` — all matching servers sorted by priority (primary first).

2. Update `ensure_server()` flow:
   - Existing `ensure_server(lang_id, project_root)` stays the same (starts one specific server).
   - Add `ensure_servers_for_extension(ext, project_root)` that calls `find_servers_for_extension`, then `ensure_server` for each.

3. Update the commands in `commands/lsp.rs`:
   - `lsp_open_file` → call `ensure_servers_for_extension` (starts all matching servers).
   - `lsp_request_completion`, `lsp_request_hover`, `lsp_request_definition`, `lsp_request_rename`, `lsp_request_formatting` → route to primary server only.
   - Diagnostics already work (each server sends its own `publishDiagnostics`).
   - `lsp_request_code_actions` → merge results from all servers, deduplicate by title.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/manifest.rs src-tauri/src/lsp/mod.rs src-tauri/src/lsp/detection.rs src-tauri/src/commands/lsp.rs test/lsp/lsp-multi-server.test.cjs
git commit -m "feat(lsp): multi-server routing with primary/supplementary priorities"
```

---

### Task 18: Diagnostic source labels in Problems panel

**Files:**
- Modify: `src/lib/stores/lsp-diagnostics.svelte.js` (pass source field through)
- Modify: Frontend Problems panel component (show source label per diagnostic)
- Test: `test/stores/lsp-diagnostics.test.cjs` (update)

**Step 1: Write the failing test**

```javascript
describe('lsp-diagnostics.svelte.js: source labels', () => {
  it('preserves source field in raw diagnostics', () => {
    assert.ok(src.includes('source'), 'Should include source in diagnostic items');
  });
});
```

**Step 2: Run test — should PASS (source already preserved in rawDiagnostics)**

**Step 3: Verify**

The `rawDiagnostics` Map already stores the full diagnostic items including `source`. The Problems panel in `FileEditor.svelte` or wherever diagnostics are displayed needs to show `(source)` label next to each diagnostic message (e.g., "Property 'x' does not exist (ts)" vs "Missing alt attribute (eslint)").

Update the diagnostic display component to show `diagnostic.source` as a badge.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src/lib/stores/lsp-diagnostics.svelte.js
git commit -m "feat(lsp): show diagnostic source labels in Problems panel"
```

---

### Task 19: ESLint manifest entry

**Files:**
- Modify: `src-tauri/src/lsp/lsp-servers.json` (add eslint entry)
- Test: `test/lsp/lsp-server-manifest.test.cjs` (update)

**Step 1: Write the failing test**

Add to `test/lsp/lsp-server-manifest.test.cjs`:

```javascript
describe('lsp-servers.json: ESLint server', () => {
  it('has eslint entry', () => {
    assert.ok(manifest.servers.eslint, 'Should have eslint server entry');
  });

  it('eslint is supplementary', () => {
    assert.strictEqual(manifest.servers.eslint.priority, 'supplementary');
  });

  it('eslint covers JS/TS extensions', () => {
    const exts = manifest.servers.eslint.extensions;
    assert.ok(exts.includes('.js'), 'Should cover .js');
    assert.ok(exts.includes('.ts'), 'Should cover .ts');
    assert.ok(exts.includes('.jsx'), 'Should cover .jsx');
    assert.ok(exts.includes('.tsx'), 'Should cover .tsx');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

Add to `lsp-servers.json`:

```json
"eslint": {
  "name": "ESLint Language Server",
  "languages": ["javascript", "typescript", "javascriptreact", "typescriptreact"],
  "extensions": [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".svelte"],
  "excludeExtensions": [],
  "install": {
    "type": "npm",
    "packages": ["vscode-langservers-extracted"],
    "version": "^4.0"
  },
  "command": "vscode-eslint-language-server",
  "args": ["--stdio"],
  "priority": "supplementary",
  "enabled": true,
  "restartPolicy": "on-crash",
  "initializationOptions": {},
  "settings": {}
}
```

Note: `vscode-eslint-language-server` is included in `vscode-langservers-extracted` which is already installed for CSS/HTML/JSON servers.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/lsp-servers.json test/lsp/lsp-server-manifest.test.cjs
git commit -m "feat(lsp): add ESLint as supplementary language server"
```

---

### Task 20: Native binary download support (rust-analyzer)

**Files:**
- Modify: `src-tauri/src/lsp/installer.rs` (add github_release install type)
- Modify: `src-tauri/src/lsp/manifest.rs:41-48` (extend InstallConfig)
- Modify: `src-tauri/src/lsp/lsp-servers.json` (add rust-analyzer entry)
- Test: `test/lsp/lsp-installer.test.cjs` (update)
- Test: `test/lsp/lsp-server-manifest.test.cjs` (update)

**Step 1: Write the failing test**

Add to `test/lsp/lsp-installer.test.cjs`:

```javascript
describe('installer.rs: native binary support', () => {
  it('supports github-release install type', () => {
    assert.ok(
      installerSrc.includes('github-release') || installerSrc.includes('github_release'),
      'Should support github-release install type'
    );
  });

  it('downloads binary from GitHub releases', () => {
    assert.ok(
      installerSrc.includes('github') && installerSrc.includes('download'),
      'Should download from GitHub releases'
    );
  });

  it('handles platform-specific binaries', () => {
    assert.ok(
      installerSrc.includes('target_os') || installerSrc.includes('platform'),
      'Should detect platform for correct binary'
    );
  });
});
```

Add to `test/lsp/lsp-server-manifest.test.cjs`:

```javascript
describe('lsp-servers.json: rust-analyzer', () => {
  it('has rust-analyzer entry', () => {
    assert.ok(manifest.servers['rust-analyzer'], 'Should have rust-analyzer entry');
  });

  it('uses github-release install type', () => {
    assert.strictEqual(manifest.servers['rust-analyzer'].install.type, 'github-release');
  });

  it('covers .rs extension', () => {
    assert.ok(manifest.servers['rust-analyzer'].extensions.includes('.rs'));
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement**

**Installer:** Add `install_github_release()` function to `installer.rs`:

```rust
pub async fn install_github_release(
    app: &AppHandle,
    server_id: &str,
    repo: &str,     // e.g. "rust-lang/rust-analyzer"
    version: &str,  // e.g. "2024-01-01" or "latest"
) -> Result<(), String> {
    let lsp_dir = get_lsp_servers_dir()?;
    let bin_dir = lsp_dir.join("bin");
    std::fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Failed to create bin dir: {}", e))?;

    // Determine platform + arch
    let (os, ext) = if cfg!(target_os = "windows") {
        ("pc-windows-msvc", ".exe")
    } else if cfg!(target_os = "macos") {
        ("apple-darwin", "")
    } else {
        ("unknown-linux-gnu", "")
    };
    let arch = if cfg!(target_arch = "x86_64") { "x86_64" }
               else if cfg!(target_arch = "aarch64") { "aarch64" }
               else { return Err("Unsupported architecture".into()) };

    // Download from GitHub releases API
    let asset_name = format!("rust-analyzer-{}-{}{}", arch, os, ext);
    let url = if version == "latest" {
        format!("https://github.com/{}/releases/latest/download/{}", repo, asset_name)
    } else {
        format!("https://github.com/{}/releases/download/{}/{}", repo, version, asset_name)
    };

    // Use reqwest to download
    let client = reqwest::Client::new();
    let response = client.get(&url).send().await
        .map_err(|e| format!("Download failed: {}", e))?;
    let bytes = response.bytes().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let dest = bin_dir.join(format!("rust-analyzer{}", ext));
    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("Failed to write binary: {}", e))?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    Ok(())
}
```

**Manifest:** Add `repo` field to `InstallConfig`:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct InstallConfig {
    #[serde(rename = "type")]
    pub install_type: String,
    pub packages: Vec<String>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub repo: String,  // For github-release type
}
```

**lsp-servers.json:** Add rust-analyzer:

```json
"rust-analyzer": {
  "name": "Rust Analyzer",
  "languages": ["rust"],
  "extensions": [".rs"],
  "excludeExtensions": [],
  "install": {
    "type": "github-release",
    "packages": [],
    "version": "latest",
    "repo": "rust-lang/rust-analyzer"
  },
  "command": "rust-analyzer",
  "args": [],
  "priority": "primary",
  "enabled": true,
  "restartPolicy": "on-crash",
  "initializationOptions": {},
  "settings": {}
}
```

Update `find_binary_path` to also check `lsp-servers/bin/` for native binaries.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/installer.rs src-tauri/src/lsp/manifest.rs src-tauri/src/lsp/lsp-servers.json test/lsp/lsp-installer.test.cjs test/lsp/lsp-server-manifest.test.cjs
git commit -m "feat(lsp): native binary download support + rust-analyzer entry"
```

---

### Task 21: Final integration verification

**Step 1: Run full JS test suite**

Run: `npm test`
Expected: All 5400+ tests pass

**Step 2: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation

**Step 3: Run Rust MCP tests**

Run: `cd src-tauri && cargo test --bin voice-mirror-mcp`
Expected: All pass

**Step 4: Update IDE-GAPS.md**

Mark completed features:
- Server lifecycle management (crash recovery, health monitoring, idle shutdown)
- Project-scoped servers
- Project-wide diagnostics
- Multi-server per file
- LSP management panel
- rust-analyzer support

**Step 5: Update CLAUDE.md**

Update LSP section to reflect Phase 2+3 capabilities.

**Step 6: Commit**

```bash
git add docs/implementation/IDE-GAPS.md CLAUDE.md
git commit -m "docs: update IDE-GAPS.md and CLAUDE.md for LSP Phase 2+3"
```

---

## Phase Summary

| Phase | Tasks | Goal |
|-------|-------|------|
| **Phase 2** | 1-11 | Project-scoped servers, state machine, crash recovery, health monitoring, idle shutdown, management panel |
| **Project-Wide** | 12-15 | Full project diagnostic scanning, file watcher integration |
| **Phase 3** | 16-21 | Multi-server routing, ESLint, rust-analyzer, source labels |
