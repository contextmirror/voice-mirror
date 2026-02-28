# LSP Phase 2 + 3 Design: Lifecycle, Project-Wide Diagnostics, Multi-Server

## Goal

Make the LSP system production-grade: robust server lifecycle, project-aware scoping, full-project diagnostic scanning, management UI, and multi-server support per file.

## Build Order

Phase 2 (robustness + project-scoping) → Project-wide diagnostics → Phase 3 (multi-server + extensibility)

Each phase is stable before the next builds on it.

---

## Phase 2: Server Lifecycle + Project-Aware Servers

### Project-Scoped Servers (Foundation)

**Problem:** Servers are currently keyed by `language_id` only. If the user switches projects in the file tree, the LSP server keeps its original `rootUri`. Opening files in a new project sends them to a server rooted at the wrong project — wrong diagnostics, wrong symbol search, wrong go-to-definition.

**Fix:**
- Key servers by `(language_id, project_root)` instead of just `language_id`
- When the user switches projects in the file tree, shut down all servers for the old project
- Servers lazy-start for the new project when files are opened
- Add `lsp_shutdown_all()` Tauri command, called from `LensWorkspace.svelte`'s project-switch `$effect`
- Send `workspaceFolders` array in `initialize` request alongside `rootUri` (one entry matching the root). Future-proofs for multi-root workspaces.

### Crash Recovery with Exponential Backoff

- Reader loop EOF (server exited unexpectedly) → increment `crash_count`, record `last_crash`
- If `crash_count < 5`, auto-restart after backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
- Reset `crash_count` to 0 after 60s of stable running
- After 5 consecutive crashes → `Failed` state, notification: "Svelte Language Server crashed 5 times. Check Output for details."
- Emit `lsp-server-status` event on every state change

### Server State Machine

```
Stopped → Starting → Running → Restarting → Stopping → Failed
                        ↑                       |
                        └───────────────────────┘ (auto-restart with backoff)
```

States:
- **Stopped** — not running, no resources
- **Starting** — process spawned, waiting for `initialize` response
- **Running** — healthy, processing requests
- **Restarting** — crashed, waiting for backoff timer before re-spawn
- **Stopping** — graceful shutdown in progress
- **Failed** — too many crashes, requires manual restart

### Graceful Shutdown (improve existing)

Current: shutdown request (2s timeout) → exit notification → 500ms wait → kill

Improved:
- `shutdown` request → wait up to 5s for response
- `exit` notification
- Wait 2s for process to exit
- `kill()` if still running
- Proper state tracking through `Stopping` state

### Health Monitoring

- Track send timestamp per pending request
- Every 10s, a background task scans for requests older than 30s
- If found → mark server as `Unresponsive`
- Notification: "TypeScript Language Server is not responding. Restart?"
- User can restart from notification or LSP Tab
- Unresponsive state auto-clears if server responds

### Idle Shutdown

- When all documents for a server close, start a 60s timer
- If no new document opens within 60s, gracefully shut down the server
- Cancel timer if a new matching file opens
- Saves resources when switching between file types

### LSP Management Panel (LspTab)

**Per-server row:**
- Status indicator (green = running, yellow = starting/restarting, red = failed, gray = stopped)
- Server name + language ID
- Version (from npm `package.json` in managed dir, or "system" for PATH installs)
- Open file count
- Project root (abbreviated)
- Action buttons: Restart | Stop (when running), Install (when not installed), Enable/Disable toggle

**Expandable detail section:**
- Last crash time + crash count
- Error log (last 5 stderr lines)
- Binary path (global vs managed)
- Initialization options (read-only JSON)

**Top-level actions:**
- "Restart All" button
- "Install All Missing" button (batch install)

---

## Project-Wide Diagnostics

### How It Works

1. When a server reaches `Running` state, scan the project directory for matching files (using the manifest's `extensions` list)
2. Send `textDocument/didOpen` for each file (with content read from disk)
3. Collect diagnostics as they stream back via `publishDiagnostics`
4. Track these as "background" files — they don't create editor tabs
5. When user opens a file in the editor, promote from background to foreground (diagnostics already available)

### File Tree Integration

- Error/warning badges from Phase 1 already work
- Project-wide scan means badges appear on ALL files with issues, not just open ones
- Directory aggregation already works (`getForDirectory()` prefix matching)

### Performance Guardrails

- Cap at 500 files per server per scan (configurable)
- Stagger `didOpen` calls: batch of 10 every 100ms to avoid flooding
- Skip directories: `node_modules/`, `.git/`, `dist/`, `build/`, `target/`
- Only send `didOpen` — background files are read-only snapshots, no `didChange`
- On project switch, clear all background diagnostics

### File Watcher Integration

- When a file changes on disk (detected by file watcher):
  - If file is open in editor → normal `didChange` flow (already works)
  - If file has background diagnostics → re-read from disk, send `didChange` to refresh
  - If file is new (created) → send `didOpen` if extension matches a running server
  - If file is deleted → send `didClose`, remove diagnostics

---

## Phase 3: Multi-Server Per File

### Server Priority System

- `"priority": "primary"` — owns completions, hover, go-to-def, rename, formatting
- `"priority": "supplementary"` — provides diagnostics + code actions only

Example: TypeScript (primary) + ESLint (supplementary) on `.ts` files.

### Request Routing

| Request | Routing |
|---------|---------|
| Completions | Primary only |
| Hover | Primary only |
| Go-to-definition | Primary only |
| Rename | Primary only |
| Formatting | Primary only |
| Diagnostics | Merge from all (already per-URI, works naturally) |
| Code actions | Merge from all, deduplicate by title |

### Manifest Changes

- Add ESLint, Prettier as supplementary servers in `lsp-servers.json`
- Supplementary servers share `extensions` with their primary
- `excludeExtensions` still respected
- Same auto-install mechanism (npm)

### Diagnostic Source Labels

- Each diagnostic has a `source` field from the server ("ts", "svelte", "eslint")
- Problems panel groups/filters by source
- File tree badges aggregate across all servers for the same file

### Native Binary Support (rust-analyzer)

- New install type: `"install.type": "github-release"` in manifest
- Download pre-built binary from GitHub releases API
- Store in `lsp-servers/bin/` (separate from npm `node_modules/`)
- Platform detection: download correct binary for OS + arch
- No Node.js dependency for native servers

---

## Files Modified (Expected)

| File | Changes |
|------|---------|
| `src-tauri/src/lsp/mod.rs` | Project-scoped server keys, state machine, crash recovery, health monitoring, idle shutdown, background file tracking |
| `src-tauri/src/lsp/client.rs` | Request timestamp tracking, crash detection triggers restart |
| `src-tauri/src/lsp/detection.rs` | No changes expected |
| `src-tauri/src/lsp/manifest.rs` | Priority field parsing, supplementary server support |
| `src-tauri/src/lsp/installer.rs` | GitHub release download support, version reading |
| `src-tauri/src/lsp/lsp-servers.json` | ESLint, Prettier, rust-analyzer entries |
| `src-tauri/src/commands/lsp.rs` | New commands: shutdown_all, restart_server, get_server_detail, scan_project |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/lib/api.js` | New API wrappers |
| `src/components/lens/LspTab.svelte` | Full management panel rewrite |
| `src/components/lens/LensWorkspace.svelte` | Project-switch LSP shutdown effect |
| `src/lib/stores/lsp-diagnostics.svelte.js` | Background file tracking, project-wide diagnostic state |
| `src/lib/stores/project.svelte.js` | Emit project-change event for LSP |

---

## Decisions Made

- **Build order:** Phase 2 → Project-wide diagnostics → Phase 3
- **Project scoping:** Servers keyed by (language_id, project_root), shutdown on project switch
- **Crash policy:** 5 consecutive crashes with exponential backoff before giving up
- **Scan scope:** Full project scan on server start (cap at 500 files)
- **LSP Tab:** Full management panel with per-server controls
- **Multi-server routing:** Primary owns intellisense, supplementary adds diagnostics + code actions
- **Native binaries:** GitHub release download for non-Node servers (rust-analyzer)
