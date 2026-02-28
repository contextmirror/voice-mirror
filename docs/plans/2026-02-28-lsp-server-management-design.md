# LSP Server Management — Design Document

> Auto-download, lifecycle management, and multi-server support for Language Server Protocol integration.

**Date:** 2026-02-28

---

## Goal

Replace Voice Mirror's hardcoded language server detection with a manifest-driven system that auto-downloads, installs, and manages LSP servers on demand. Open a `.svelte` file → Svelte Language Server downloads and starts automatically → correct diagnostics appear. No manual setup, no bogus errors from wrong servers.

## Approach

**Approach C + npm downloads** — a declarative JSON manifest (like Zed's extension registry) defines all supported servers. npm handles installation for Node.js-based servers. PATH detection respects user's global installs. The manifest ships with the app; user overrides are stored in Voice Mirror's config system.

Both VS Code and Zed use this pattern: a registry/manifest as the foundation, with npm (or binary download) as the install mechanism.

## Constraints

- **Node.js required on PATH.** Most developers already have it. Same requirement as Zed. We detect its absence early and show a clear notification.
- **Phase 1 languages:** Svelte, TypeScript/JavaScript, CSS, HTML, JSON (web stack focus).
- **On-demand download.** Servers install when a file of that type is first opened. No upfront bulk download.
- **Svelte server is primary for `.svelte` files.** CSS/JS/TS servers are excluded from `.svelte` via `excludeExtensions`. Eliminates bogus parse errors.

---

## Architecture

### Server Registry Manifest

The app ships with `lsp-servers.json` embedded in the Rust binary (via `include_str!`). Each entry defines everything needed to install, configure, and run a language server.

```json
{
  "servers": {
    "svelte": {
      "name": "Svelte Language Server",
      "languages": ["svelte"],
      "extensions": [".svelte"],
      "excludeExtensions": [],
      "install": {
        "type": "npm",
        "packages": ["svelte-language-server", "typescript"],
        "version": "^0.17"
      },
      "command": "svelteserver",
      "args": ["--stdio"],
      "priority": "primary",
      "enabled": true,
      "restartPolicy": "on-crash",
      "initializationOptions": {},
      "settings": {
        "svelte.plugin.typescript.tsdk": "./node_modules/typescript/lib"
      }
    },
    "typescript": {
      "name": "TypeScript Language Server",
      "languages": ["typescript", "javascript", "typescriptreact", "javascriptreact"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      "excludeExtensions": [".svelte"],
      "install": {
        "type": "npm",
        "packages": ["typescript-language-server", "typescript"],
        "version": "^4.0"
      },
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "priority": "primary",
      "enabled": true,
      "restartPolicy": "on-crash",
      "initializationOptions": {
        "preferences": {
          "importModuleSpecifierPreference": "relative"
        }
      },
      "settings": {
        "typescript.tsdk": "./node_modules/typescript/lib"
      }
    },
    "css": {
      "name": "CSS Language Server",
      "languages": ["css", "scss", "less"],
      "extensions": [".css", ".scss", ".less"],
      "excludeExtensions": [".svelte"],
      "install": {
        "type": "npm",
        "packages": ["vscode-langservers-extracted"],
        "version": "^4.0"
      },
      "command": "vscode-css-language-server",
      "args": ["--stdio"],
      "priority": "primary",
      "enabled": true,
      "restartPolicy": "on-crash",
      "initializationOptions": {},
      "settings": {}
    },
    "html": {
      "name": "HTML Language Server",
      "languages": ["html"],
      "extensions": [".html", ".htm"],
      "excludeExtensions": [".svelte"],
      "install": {
        "type": "npm",
        "packages": ["vscode-langservers-extracted"],
        "version": "^4.0"
      },
      "command": "vscode-html-language-server",
      "args": ["--stdio"],
      "priority": "primary",
      "enabled": true,
      "restartPolicy": "on-crash",
      "initializationOptions": {},
      "settings": {}
    },
    "json": {
      "name": "JSON Language Server",
      "languages": ["json", "jsonc"],
      "extensions": [".json", ".jsonc"],
      "excludeExtensions": [],
      "install": {
        "type": "npm",
        "packages": ["vscode-langservers-extracted"],
        "version": "^4.0"
      },
      "command": "vscode-json-language-server",
      "args": ["--stdio"],
      "priority": "primary",
      "enabled": true,
      "restartPolicy": "on-crash",
      "initializationOptions": {},
      "settings": {}
    }
  }
}
```

**Manifest fields:**

| Field | Purpose |
|-------|---------|
| `extensions` | File extensions this server handles |
| `excludeExtensions` | File extensions this server must NOT handle (prevents bogus diagnostics) |
| `install.packages` | npm packages to install (supports multiple — TypeScript SDK as peer dep) |
| `install.version` | Semver range for the primary package |
| `command` | Binary name to spawn (resolved from PATH or `node_modules/.bin/`) |
| `priority` | `"primary"` (Phase 1) or `"supplementary"` (Phase 3 — diagnostics only) |
| `enabled` | Default state. Users can override in config to disable specific servers |
| `restartPolicy` | `"on-crash"` (auto-restart with backoff) or `"manual"` |
| `initializationOptions` | Sent to server during LSP `initialize` handshake |
| `settings` | Sent via `workspace/configuration` responses when the server requests them |

**Shared installs:** CSS, HTML, and JSON servers all come from `vscode-langservers-extracted`. The installer deduplicates — if the package is already installed (by another server entry), it skips the download.

**User config overlay:** The manifest defines defaults. Users can override per-server settings (enabled, initializationOptions, settings) via Voice Mirror's config system. On load: merge manifest + user overrides. App updates ship new manifests without clobbering user customizations.

---

### Download & Install Mechanism

**Storage:** `%APPDATA%/voice-mirror/lsp-servers/`

```
lsp-servers/
├── node_modules/           ← shared npm install root
│   ├── typescript-language-server/
│   ├── typescript/
│   ├── svelte-language-server/
│   └── vscode-langservers-extracted/
├── package.json            ← generated, tracks installed packages
└── install.lock            ← prevents concurrent installs
```

**Binary resolution order:**

1. User's PATH (global install — respect user's choice)
2. `lsp-servers/node_modules/.bin/` (our managed install)
3. Not found → trigger npm install → retry step 2

**Install flow:**

```
File opened → detect extension → manifest lookup → server needed?
  ├── Already running?      → attach file to existing server
  ├── Binary found?         → spawn immediately
  └── Not found?            → trigger install:
        1. Acquire install.lock (skip if another install running)
        2. Emit "lsp-server-status" event: { server, status: "installing" }
        3. Notify user via notification system (persistent toast with spinner)
        4. Run: npm install --ignore-scripts --prefix <dir> <packages>
        5. Verify binary exists in node_modules/.bin/
        6. Emit "lsp-server-status" event: { server, status: "installed" }
        7. Notify user: "Svelte Language Server ready"
        8. Spawn the server
```

**Key decisions:**

- **PATH takes priority.** If the user has a globally installed server, use it. Don't download a duplicate.
- **Non-blocking install.** File opens immediately. LSP features appear when server is ready. No modal dialogs.
- **`--ignore-scripts` flag.** Prevents postinstall scripts from running. Language server packages don't need them. Mitigates supply chain attack vector.
- **`install.lock`** prevents race conditions when multiple files of the same type open simultaneously.
- **No auto-update in Phase 1.** Installs the version from the manifest. Users can manually reinstall from LSP tab. Auto-update is Phase 2.
- **Offline resilience.** If npm fails, log warning, show notification, move on. Editor works — just no LSP features for that language.

**Node.js detection:** On first LSP-requiring file open, check if `node` and `npm` are on PATH. If not, show a persistent notification: "Language server features require Node.js. Install from nodejs.org." Check once per session, not per file.

---

### Server Lifecycle

**States:**

```
Stopped → Installing → Starting → Running → Stopping → Stopped
                                      ↓
                                   Crashed ──(restart)──→ Starting
```

**Phase 1 (basic):**
- **Start:** Lazy — spawned when first file of that type opens
- **Stop:** When all files of that type close, kill server after 30-second grace period
- **Crash:** Log error, notify user via notification system. No auto-restart.

**Phase 2 (robust):**
- **Crash recovery:** `restartPolicy: "on-crash"` — exponential backoff (1s, 2s, 4s, 8s, max 30s). After 5 consecutive crashes, stop and notify user.
- **Graceful shutdown:** `shutdown` request → `exit` notification → `SIGTERM` after 5s → `SIGKILL` after 10s.
- **Health monitoring:** If no response to any request for >30s, mark unresponsive, attempt restart.
- **Idle shutdown:** 30-second grace period before killing servers with no open files.

**Phase 3 (multi-server):**
- **Primary vs supplementary:** Primary owns completions, hover, go-to-def. Supplementary provides diagnostics and code actions only.
- **Request routing:** Completions/hover/definition → primary server. Diagnostics/code-actions → merge from all servers for that file.
- **Example:** TypeScript (primary) + ESLint (supplementary) on a `.ts` file.

**State tracking:**

```rust
struct ManagedServer {
    id: String,                    // "svelte", "typescript", etc.
    config: ServerConfig,          // from manifest + user overrides
    status: ServerStatus,          // Stopped | Installing | Starting | Running | Crashed
    process: Option<Child>,        // OS process handle
    open_files: HashSet<String>,   // files using this server
    crash_count: u32,              // consecutive crashes (for backoff)
    last_crash: Option<Instant>,   // for backoff timing
    installed_version: Option<String>, // npm package version
}

enum ServerStatus {
    Stopped,
    Installing,
    Starting,
    Running,
    Crashed { message: String },
}
```

**Status events:** Every state transition emits a `lsp-server-status` Tauri event so the frontend can update reactively without polling:

```json
{ "server": "svelte", "status": "running", "version": "0.17.1" }
{ "server": "typescript", "status": "installing", "message": "Installing TypeScript Language Server..." }
{ "server": "css", "status": "crashed", "message": "Server exited with code 1" }
```

---

### Integration with Existing LspManager

**What changes:**

| Component | Current | New |
|-----------|---------|-----|
| `detection.rs` — `LANGUAGE_SERVERS` | Hardcoded 7 entries | **Deleted.** Replaced by manifest lookup |
| `detection.rs` — `detect_for_extension()` | Scans hardcoded array | **Rewritten.** Reads manifest, respects `excludeExtensions` |
| `detection.rs` — `find_binary()` | `which::which()` on PATH | **Extended.** PATH first, then `node_modules/.bin/` |
| `client.rs` — `ensure_server()` | Detect + spawn | **Extended.** Detect → install if needed → spawn |
| `client.rs` — init handshake | No `initializationOptions` | **Reads from manifest** `initializationOptions` field |
| `client.rs` — configuration requests | Not handled | **New.** Respond to `workspace/configuration` with manifest `settings` |
| New: `installer.rs` | N/A | npm install logic, lock file, Node.js detection |
| New: `manifest.rs` | N/A | Parse `lsp-servers.json`, query by extension, merge user overrides |

**What stays the same:**
- JSON-RPC protocol layer (all request/response handling in `client.rs`)
- All 7 Tauri commands in `commands/lsp.rs`
- All frontend LSP code (`editor-lsp.svelte.js`, CodeMirror extensions)
- `lsp-diagnostics.svelte.js` store
- `LspManager` public API — callers don't change

**The key principle:** The `LspManager.ensure_server()` API doesn't change its signature. Internally it now consults the manifest and may trigger an install, but all callers (Tauri commands, frontend) are unaware. Small blast radius.

---

### Frontend / UI Changes

**All changes happen in existing components. No new Svelte files for Phase 1.**

#### Status Bar (`StatusBar.svelte`)

Extend the existing LSP health indicator:

| State | Display |
|-------|---------|
| Installing | `⟳ Installing Svelte LS...` (spinner) |
| Running | `✓ svelte` (current behavior) |
| Crashed | `⚠ svelte` in `--danger` color |
| No server for file type | `─ No LS` (dimmed) |

Clicking the LSP status opens the LSP tab (same pattern as diagnostics → Problems panel).

#### LSP Tab (`LspTab.svelte`) — Phase 2

Full management UI showing per-server: status icon, name, version, open file count, restart/stop buttons. Not-installed servers show Install button. Disabled servers show Enable button.

#### Notifications

Use the existing notification system (toast + notification center):

| Event | Notification |
|-------|-------------|
| First install | Persistent toast with spinner: "Installing Svelte Language Server... This happens once." |
| Install complete | Toast: "Svelte Language Server ready." |
| Install failed | Danger toast: "Failed to install Svelte LS. Check your network connection." |
| Node.js not found | Persistent notification: "Language servers require Node.js. Install from nodejs.org" |
| Server crashed | Warning toast: "Svelte Language Server crashed." (Phase 2 adds "Restarting...") |

---

### Gotchas & Design Notes

**TypeScript SDK dependency.** `typescript-language-server` and `svelte-language-server` both need `typescript` as a peer dependency. The manifest's `install.packages` array includes both: `["typescript-language-server", "typescript"]`. Without this, servers start but provide degraded/no features.

**Security: `--ignore-scripts`.** npm postinstall scripts are a supply chain attack vector. We use `npm install --ignore-scripts` since language server packages don't need postinstall hooks. Their binaries are plain Node.js scripts.

**`workspace/configuration` responses.** LSP servers actively request client settings via `workspace/configuration`. Our client must handle this request and respond with the `settings` from the manifest (merged with user overrides). Without this, servers fall back to their own defaults which may not match user expectations. This is why VS Code passes extensive per-server configuration.

**Shared npm packages.** `vscode-langservers-extracted` bundles CSS, HTML, JSON, and ESLint servers in one package. The installer deduplicates: if the package is already in `node_modules/` (installed by another server entry), skip the download. The `install.lock` file prevents concurrent npm processes.

**Windows `.cmd` wrappers.** npm creates `.cmd` batch files in `node_modules/.bin/` on Windows. The existing `detection.rs` already handles this by resolving `.cmd` wrappers to their underlying `node <script>` commands. This logic is preserved.

---

## Data Flow

```
File opened (.svelte)
  → detect_for_extension(".svelte")
  → manifest lookup: svelte server (primary)
  → check excludeExtensions: typescript server excluded ✓, css server excluded ✓
  → find_binary("svelteserver"): not on PATH, not in node_modules/.bin/
  → installer.install("svelte"): npm install --ignore-scripts svelte-language-server typescript
  → emit "lsp-server-status" { installing }
  → npm completes → binary now in node_modules/.bin/svelteserver
  → spawn process, JSON-RPC init with initializationOptions from manifest
  → server requests workspace/configuration → respond with manifest settings
  → server sends textDocument/publishDiagnostics → lsp-diagnostics store → Problems panel
  → emit "lsp-server-status" { running, version: "0.17.1" }
```

---

## Phase Summary

| Phase | Goal | Scope | Effort |
|-------|------|-------|--------|
| **1** | Auto-download + correct routing | Manifest, installer, detection rewrite, 5 servers, init options, workspace/configuration | Medium |
| **2** | Robust lifecycle + management UI | Crash recovery, graceful shutdown, health monitoring, LSP tab redesign, native binary support (rust-analyzer) | Medium |
| **3** | Multi-server + extensibility | Supplementary servers, diagnostic merging, user-defined servers, per-project overrides, ESLint/Tailwind | Large |

---

## Files Changed

| File | Phase | Change |
|------|-------|--------|
| `src-tauri/src/lsp/lsp-servers.json` | 1 | **New** — server registry manifest |
| `src-tauri/src/lsp/manifest.rs` | 1 | **New** — parse manifest, query by extension, merge user overrides |
| `src-tauri/src/lsp/installer.rs` | 1 | **New** — npm install logic, lock file, Node.js detection, status events |
| `src-tauri/src/lsp/detection.rs` | 1 | **Rewrite** — manifest-based routing, `excludeExtensions`, extended binary resolution |
| `src-tauri/src/lsp/client.rs` | 1 | **Modify** — install-if-missing in `ensure_server()`, `initializationOptions`, `workspace/configuration` handler |
| `src-tauri/src/lsp/mod.rs` | 1 | **Modify** — export new modules |
| `src-tauri/src/commands/lsp.rs` | 1 | **Modify** — new commands: server list, install status, enable/disable |
| `src-tauri/src/config/schema.rs` | 1 | **Modify** — `lsp_servers` user override field |
| `src/lib/api.js` | 1 | **Modify** — new invoke wrappers for server management |
| `src/lib/stores/config.svelte.js` | 1 | **Modify** — `lspServers` user overrides in DEFAULT_CONFIG |
| `src/components/shared/StatusBar.svelte` | 1 | **Modify** — install progress indicator, click to open LSP tab |
| `src-tauri/src/lsp/client.rs` | 2 | **Modify** — crash recovery, graceful shutdown, health checks |
| `src-tauri/src/lsp/installer.rs` | 2 | **Modify** — binary download support (rust-analyzer) |
| `src/components/lens/LspTab.svelte` | 2 | **Modify** — full server management UI |
| `src-tauri/src/lsp/client.rs` | 3 | **Modify** — multi-server routing, diagnostic merging |
| `src-tauri/src/lsp/manifest.rs` | 3 | **Modify** — supplementary servers, user custom servers |

## References

- Zed LSP: `crates/project/src/lsp_store.rs` — declarative manifest, auto-download, LspAdapter trait
- VS Code extensions: built-in language servers bundled as extensions with `package.json` manifests
- LSP spec: `workspace/configuration` request handling
- Current LSP client: `src-tauri/src/lsp/` (4 files, ~1,525 lines)
- LSP config gaps: `docs/implementation/LSP-CONFIG-GAPS.md`
- IDE gaps: `docs/source-of-truth/IDE-GAPS.md` §LSP
