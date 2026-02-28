# Unified Server Implementation Plan

## Scope

Three features share the StatusDropdown UI (3 tabs: Servers, MCP, LSP):

| Tab | Feature | Status |
|-----|---------|--------|
| **LSP** | Language server status | **95% done** — fully functional |
| **Servers** | Dev server detection + lifecycle | **~80% done** — detection, lifecycle, and UI wired |
| **MCP** | External MCP server management | **0%** — built-in only, "Add server" not yet functional |

This plan covers the **Servers** and **MCP** tabs. LSP only needs minor polish (crash recovery, error toasts).

---

## What Exists Today

### StatusDropdown (`src/components/lens/StatusDropdown.svelte`, ~506 lines)
- 3 tabs refactored into sub-components: `ServersTab.svelte`, `McpTab.svelte`, `LspTab.svelte`
- **Servers tab**: Wired to real detection data from `lensStore.devServers`, Start/Stop/Restart lifecycle
- **MCP tab**: Shows built-in `voice-mirror`, "Add server" not yet functional
- **LSP tab**: Fully wired — green/grey dots, document counts, event-driven updates

### Built-in MCP Server
- `src-tauri/src/bin/mcp.rs` — separate binary, JSON-RPC over stdio
- `src-tauri/src/mcp/server.rs` — protocol handler
- `src-tauri/src/mcp/tools.rs` — ~60 tools in 11 groups, dynamic load/unload
- `src-tauri/src/providers/cli/mcp_config.rs` — writes config for Claude Code / OpenCode

### Config Schema (`src-tauri/src/config/schema.rs`)
- `AiConfig` has provider, model, endpoints, apiKeys, toolProfiles — **no `mcpServers` field**
- `WorkspaceConfig` is layout-only (panel ratios) — **no server config**
- `ProjectsConfig` tracks path/name/color — **no server associations**

### Frontend Stores
- `lens.svelte.js` — browser URL, loading, history, `devServers` state, `devServerLoading`
- `project.svelte.js` — project entries, activeIndex, `preferredServerUrl`, `lastBrowserUrl`, `autoStartServer`
- `dev-server-manager.svelte.js` — **NEW** — full dev server lifecycle store (start/stop/restart, crash detection, idle timeout)
- `terminal-tabs.svelte.js` — extended with `dev-server` tab type, `hideTab`/`unhideTab`
- `toast.svelte.js` — extended with `actions` array (multi-button toasts)
- No `mcp-servers.svelte.js` yet (planned for external MCP server management)

### API Wrappers (`src/lib/api.js`)
- 102 functions covering config, window, voice, AI, chat, files, lens, shell, LSP, dev-server
- Dev server functions: `detectDevServers()`, `probePort()`, `lensHardRefresh()`
- **Zero** MCP management functions (planned)

### Project/Workspace System (Left Sidebar)

The project system is the **trigger** for dev server detection. It's already well-built:

**Data flow when user switches projects:**
```
ProjectStrip click → projectStore.setActive(i)
    ├── SessionPanel: ✅ filters sessions by projectPath
    ├── FileTree: ✅ reloads with new project root ($effect on activeIndex)
    ├── LensWorkspace: ✅ restarts file watcher for new project
    └── LensPreview/Browser: ✅ detects dev server → probes port → navigates (or about:blank)
```

**Key files:**
- `src/lib/stores/project.svelte.js` — `activeProject` getter returns `{ path, name, color }`
- `src/components/sidebar/ProjectStrip.svelte` — circular avatars, click → `setActive(i)`
- `src/components/sidebar/SessionPanel.svelte` — sessions filtered by `activeProject.path`
- `src/components/lens/FileTree.svelte` — `$effect` on `projectStore.activeIndex` triggers `loadRoot()`
- `src/components/lens/LensWorkspace.svelte` — `$effect` on `projectStore.activeProject.path` starts file watcher
- `src/components/lens/LensPreview.svelte` — creates webview with `about:blank`, `$effect` watches `projectStore.activeProject` for detect → probe → navigate

**This gap has been closed.** LensPreview now watches `projectStore.activeProject` changes with a 300ms debounce and triggers detection → port probe → browser navigation. The DEFAULT_URL is `about:blank` (no longer google.com).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  StatusDropdown (3 tabs)                                     │
│  ┌─────────┐ ┌─────────┐ ┌──────┐                          │
│  │ Servers  │ │   MCP   │ │ LSP  │  ← tab bar              │
│  └────┬────┘ └────┬────┘ └──┬───┘                          │
│       │           │         │                               │
│  Dev servers  External   Language                           │
│  (auto-detect MCP servers servers                           │
│   + manual)  (add/remove) (auto)                            │
└───────┼───────────┼─────────┼───────────────────────────────┘
        │           │         │
    ┌───┴───┐   ┌───┴───┐  ┌─┴──────┐
    │api.js │   │api.js │  │api.js  │  ← frontend API layer
    └───┬───┘   └───┬───┘  └─┬──────┘
        │           │        │
  ┌─────┴─────┐ ┌──┴────┐ ┌─┴──────┐
  │commands/  │ │cmds/  │ │cmds/  │   ← Tauri commands
  │dev_server │ │mcp    │ │lsp    │
  └─────┬─────┘ └──┬────┘ └─┬──────┘
        │           │        │
  ┌─────┴─────┐ ┌──┴────┐ ┌─┴──────┐
  │services/  │ │mcp/   │ │lsp/   │   ← Rust modules
  │dev_server │ │client │ │mod    │
  └───────────┘ │manager│ └────────┘
                └───────┘
```

---

## Part 1: Dev Server Detection (Servers Tab)

### Phase 1.1: Detection Engine (Rust)

**New file: `src-tauri/src/services/dev_server.rs`**

```rust
pub struct DetectedDevServer {
    pub framework: String,      // "Vite", "Next.js", etc.
    pub port: u16,
    pub url: String,            // "http://localhost:1420"
    pub start_command: String,  // "npm run dev"
    pub source: String,         // "tauri.conf.json", "package.json"
    pub running: bool,          // port probe result
}

pub fn detect_dev_servers(project_root: &str) -> Vec<DetectedDevServer>;
pub fn is_port_listening(port: u16) -> bool;
```

**Detection priority:**
1. `tauri.conf.json` → `build.devUrl` (exact URL)
2. `vite.config.js/ts` → `server.port`
3. `.env` / `.env.local` → `PORT=` or `VITE_PORT=`
4. `package.json` scripts → framework pattern matching
5. `--port NNNN` / `-p NNNN` flag parsing in script strings

**Phase 1 framework scope (top 6, covers ~90% of projects):**
- Vite (port 5173)
- Tauri + Vite (port 1420, from `tauri.conf.json` devUrl)
- Next.js (port 3000)
- Create React App (port 3000)
- Angular CLI (port 4200)
- SvelteKit (port 5173)

More frameworks added incrementally — the detection engine is just pattern matching on
`package.json` scripts, so adding new entries is trivial.

**Package manager detection:**

Don't hardcode `npm run dev`. Detect the correct runner:

| Lockfile | Runner |
|----------|--------|
| `bun.lockb` or `bun.lock` | `bun run dev` |
| `yarn.lock` | `yarn dev` |
| `pnpm-lock.yaml` | `pnpm run dev` |
| `package-lock.json` (or none) | `npm run dev` |

Check lockfiles in project root. First match wins.

**Self-detection guard:**

Voice Mirror itself runs Vite on :1420 during development. If the user opens the
Voice Mirror project folder, don't navigate the browser to the app's own dev server.

Detection: compare `detected_port` against the Tauri dev server port (read from
`tauri.conf.json` at app startup, or check if the detected URL matches the app's
own window URL). If match → skip auto-navigate, mark as "(this app)" in StatusDropdown.

**Port probe:** `TcpStream::connect_timeout("127.0.0.1:{port}", 200ms)`

**Port probe intervals:**

| Context | Interval |
|---------|----------|
| Waiting for server startup | 500ms (max 30s) |
| StatusDropdown is open | 5s |
| Background (dropdown closed) | 30s — detects crashes within half a minute |

**Register in `services/mod.rs`.**

### Phase 1.2: Tauri Commands

**New file: `src-tauri/src/commands/dev_server.rs`**

| Command | Purpose |
|---------|---------|
| `detect_dev_servers(project_root)` | Scan project, return `Vec<DetectedDevServer>` |
| `probe_port(port)` | TCP connect check → bool |

Register in `commands/mod.rs` + `lib.rs`.

### Phase 1.3: Frontend Wiring

**`src/lib/api.js`** — add:
```js
export async function detectDevServers(projectRoot) { ... }
export async function probePort(port) { ... }
```

**`src/lib/stores/lens.svelte.js`** — add dev server state:
```js
let devServers = $state([]);
let devServerLoading = $state(false);
```

### Phase 1.4: StatusDropdown Refactor + Servers Tab

**First: extract tabs into sub-components.** StatusDropdown is already 769 lines. Adding
full server management would push it past 1000+. Split before adding:

| Component | Purpose |
|-----------|---------|
| `StatusDropdown.svelte` | Shell: tab bar, popover open/close, status badge (slim) |
| `ServersTab.svelte` | **NEW** — dev server list, start/stop/restart, crash recovery |
| `McpTab.svelte` | **NEW** — external MCP server management |
| `LspTab.svelte` | **EXTRACT** — already works, just move out of StatusDropdown |

This makes each tab independently testable and prevents merge conflicts when
the team works on different tabs in parallel.

**Then wire ServersTab with real detection results:**
- Call `detectDevServers(projectRoot)` when Servers tab opens
- Show detected servers with running/stopped/crashed status dots
- Show detection source ("from tauri.conf.json")
- Show framework + port + actions (Start/Stop/Restart/Show Terminal/Open in Browser)
- Poll port status every 5s while dropdown is open
- Auto-start toggle per server

### Phase 1.5: Workspace ↔ Browser Integration (Core Flow)

This is the **heart of the feature** — the project sidebar drives everything.

**The vision:** Pick a workspace → see your app. Switch workspaces → see the other app.
No manual URL typing, no manual server starting.

**Current gap:** `LensPreview.svelte` always creates webview with `DEFAULT_URL` (google.com).
`projectStore.activeProject` changes trigger file tree + file watcher but NOT the browser.

#### The Full Automatic Flow

```
User picks workspace "Voice Mirror"
    │
    ▼
projectStore.setActive(i)
    │
    ├── FileTree reloads with project files         (already works)
    ├── SessionPanel filters chat sessions          (already works)
    ├── File watcher restarts for new project       (already works)
    │
    ├── NEW: detectDevServers("E:/Projects/Voice Mirror")
    │       → finds Vite on port 1420 (from tauri.conf.json)
    │
    ├── NEW: probePort(1420)
    │       ├── If RUNNING → navigate browser to http://localhost:1420
    │       └── If NOT RUNNING → auto-start "npm run dev" in terminal
    │               → poll port every 500ms
    │               → when port responds → navigate browser
    │               → toast: "Vite Dev Server ready on :1420"
    │
    └── NEW: StatusDropdown updates with server status
```

```
User switches to workspace "My Next App"
    │
    ▼
    ├── Save current browser URL for "Voice Mirror" (lastBrowserUrl)
    ├── detectDevServers("E:/Projects/My Next App")
    │       → finds Next.js on port 3000
    ├── probePort(3000)
    │       → RUNNING → navigate browser to http://localhost:3000
    └── StatusDropdown now shows Next.js server
```

```
User switches BACK to "Voice Mirror"
    │
    ▼
    ├── Restore lastBrowserUrl for Voice Mirror (http://localhost:1420)
    │   OR re-probe port 1420 → navigate
    └── StatusDropdown shows Vite server again
```

#### Auto-Start Behavior (Toast-Driven Consent)

When detection finds a server but port isn't responding, **don't silently start it**.
Ask via toast notification first, then remember the user's choice.

**First time (no flag set):**
```
┌──────────────────────────────────────────────────────┐
│  🔍 Dev server detected                              │
│  Vite on localhost:1420 (from tauri.conf.json)       │
│                                                       │
│  [Always start]   [Start once]          [Dismiss ✕]  │
└──────────────────────────────────────────────────────┘
```

- **"Always start"** → sets `autoStartServer: true` for this project
  → starts the server now → remembers for next time
- **"Start once"** → starts the server now, but doesn't save the flag
  → asks again next workspace open
- **Dismiss / ✕** → nothing happens, server stays stopped
  → user can manually start from StatusDropdown "▶ Start" button

**Subsequent opens (flag saved):**
- If `autoStartServer: true` → auto-start immediately, no toast
  → show brief toast: "Starting Vite on :1420..."
  → when port responds: "Vite ready on :1420 ✓"
- If `autoStartServer: false` (or unset) → show the consent toast again

**If server is already running (port responds):**
- No toast needed — just navigate browser to the URL
- Brief status toast: "Connected to Vite on :1420 ✓"

**StatusDropdown as the Server Manager:**

The StatusDropdown Servers tab is the **central control panel** for all dev servers.
Not just a status display — it owns the full lifecycle: start, stop, restart, crash recovery.

```
┌─ Servers ─────────────────────────────────────┐
│                                                │
│  ● Vite Dev Server     :1420    Running  2m    │
│    Auto-start: ON                              │
│    [Open in Browser]  [Show Terminal]  [Stop]  │
│                                                │
│  ✕ Express API         :3001    Crashed        │
│    Error: EADDRINUSE port 3001                 │
│    [Restart]  [Show Terminal]                   │
│                                                │
│  ○ Storybook           :6006    Stopped        │
│    [Start]                                     │
│                                                │
│  ● Next.js (My App)    :3000    Idle 3m        │
│    Different project — stopping in 2m          │
│    [Keep Running]  [Stop Now]                  │
│                                                │
├────────────────────────────────────────────────┤
│  [+ Add server]   Auto-start toggle per server │
└────────────────────────────────────────────────┘
```

**Server states managed by StatusDropdown:**

| State | Dot | Actions available |
|-------|-----|-------------------|
| Running | ● green | Open in Browser, Show Terminal, Stop |
| Idle (other project, timer counting) | ● yellow | Keep Running, Stop Now |
| Stopped | ○ grey | Start |
| Crashed | ✕ red | Restart, Show Terminal (see error output) |
| Starting... | ◉ yellow pulse | Show Terminal (watch startup) |

**Crash handling flow:**
1. Port probe detects server no longer responding
2. Verify PTY process actually exited (not just a slow response)
3. StatusDropdown updates to "Crashed" state with red dot
4. Show last few lines of terminal output as error context
5. Toast notification: "Vite on :1420 crashed — manage in Status"
6. [Restart] button: kills old PTY, spawns fresh shell, re-runs start command
7. If crash happens 3+ times in 5 minutes: stop auto-restarting,
   show "Server keeps crashing — check terminal for errors"

#### Per-Workspace Browser State

Each project remembers its browser context:

**`src/lib/stores/project.svelte.js`** — extend project entries:
```js
{
    path: "E:/Projects/MyApp",
    name: "MyApp",
    color: "#3b82f6",
    preferredServerUrl: null,   // user override (e.g., custom port)
    lastBrowserUrl: null,       // restore on switch-back
    autoStartServer: null,      // null = ask via toast, true = always start, false = never start
}
```

**Priority for browser URL on workspace switch:**
1. `preferredServerUrl` (user explicitly chose this)
2. `lastBrowserUrl` (restore where they left off)
3. Auto-detected running server URL
4. `about:blank` (no server, nothing saved)

Never `google.com`. That's gone.

#### Changes Needed

**`src/components/lens/LensPreview.svelte`** (or `LensWorkspace.svelte`):
```js
$effect(() => {
    const project = projectStore.activeProject;
    if (!project) return;

    // Save current URL for the previous project before switching
    // Then detect + navigate for the new project
    detectAndNavigate(project);
});

async function detectAndNavigate(project) {
    lensStore.setDevServerLoading(true);

    const servers = await detectDevServers(project.path);
    lensStore.setDevServers(servers);

    const running = servers.find(s => s.running);
    if (project.preferredServerUrl) {
        lensStore.navigate(project.preferredServerUrl);
    } else if (running) {
        lensStore.navigate(running.url);
    } else if (project.lastBrowserUrl) {
        lensStore.navigate(project.lastBrowserUrl);
    } else if (servers.length > 0) {
        // Server detected but not running — check auto-start flag
        if (project.autoStartServer === true) {
            // Flag set: auto-start silently
            await startDevServer(servers[0].start_command, project.path);
            // Poll until port responds, then navigate
        } else if (project.autoStartServer === null) {
            // No flag: show toast asking user
            showDevServerToast(servers[0], project);
        }
        // autoStartServer === false: do nothing, user uses StatusDropdown
    }

    lensStore.setDevServerLoading(false);
}
```

**`src/lib/stores/lens.svelte.js`** — add:
```js
let devServers = $state([]);
let devServerLoading = $state(false);
// Getters + setters for StatusDropdown to consume
```

### Phase 1.6: Live Reload & Cache Busting

**This is critical.** When Claude (or any AI) writes code into the project, the browser
MUST show updated code immediately. WebView2 aggressively caches localhost assets —
JS, CSS, HTML can all go stale. Without this, the user sees old code after AI edits.

#### The Problem

WebView2 (Chromium-based) caches aggressively for localhost:
- Static assets (JS/CSS bundles) cached by filename
- HTML pages cached by URL
- Even with Vite HMR, WebView2 may hold stale assets after a full page reload
- Standard `location.reload()` uses cache — only Ctrl+Shift+R (hard reload) bypasses it

#### Solution: Multi-Layer Cache Defense

**Layer 1: Disable disk cache for localhost (WebView2 environment)**

When creating the child WebView2 in `lens_create_webview`, set browser arguments:
```rust
// In WebviewBuilder or via WebView2 environment options
// Disable disk cache entirely for the child webview
// --disk-cache-size=0 or --aggressive-cache-discard
```

Or use `ICoreWebView2Profile::ClearBrowsingDataAsync()` on navigation.

**Layer 2: Hard refresh on file changes**

The file watcher (`notify` crate) already runs in LensWorkspace when a project is open.
When it detects file changes (`.js`, `.ts`, `.svelte`, `.css`, `.html`):

```
File watcher detects change → emit Tauri event "fs-tree-changed"
    │
    ├── FileTree: already handles this (reloads tree)
    │
    └── NEW: Browser hard refresh
        → If dev server has HMR (Vite, Next, etc.): do nothing, HMR handles it
        → If no HMR or HMR fails: inject cache-busting reload script
```

**Implementation in `browser_bridge.rs` (or new command):**
```rust
// Hard refresh that bypasses cache
// Uses location.reload(true) which is deprecated but still works in Chromium
// Or navigates to same URL with cache-bust query param
pub async fn hard_refresh(webview: &Webview) {
    evaluate_js_with_result(webview,
        "location.href = location.href.split('?')[0] + '?_cb=' + Date.now()",
        Duration::from_secs(5)
    ).await;
}
```

**Layer 3: Initialization script — disable caching headers**

Inject via `WebviewBuilder::initialization_script()`:
```js
// Override fetch to add cache-bust headers for localhost
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    const originalFetch = window.fetch;
    window.fetch = function(url, opts = {}) {
        opts.cache = 'no-store';
        return originalFetch.call(this, url, opts);
    };
}
```

**Layer 4: WebView2 ClearBrowsingData API (nuclear option)**

For when everything else fails — "Hard Refresh" button in LensToolbar:
```rust
// Access ICoreWebView2Profile via with_webview()
// Call ClearBrowsingDataAsync(COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE)
// Then reload
```

**Layer 5: Dev server HMR awareness**

Most modern frameworks (Vite, Next, Webpack) have Hot Module Replacement (HMR) via
WebSocket. When HMR is active, file changes automatically update the page without a
full reload. Voice Mirror should:
- Detect if HMR WebSocket is connected (check `__vite_ws` or similar)
- If HMR is active: trust it, don't force reload
- If HMR disconnects or is absent: fall back to hard refresh
- Show "HMR Connected" indicator in StatusDropdown (future enhancement)

#### Cache Strategy Summary

| Situation | Action |
|-----------|--------|
| Dev server has HMR (Vite, Next, etc.) | Trust HMR, no intervention needed |
| File changes but no HMR | Hard refresh with cache bust |
| User clicks Refresh in LensToolbar | Standard reload (HMR-friendly) |
| User clicks "Hard Refresh" (Ctrl+Shift+R) | Clear WebView2 cache + reload |
| Stale content persists | Nuclear: ClearBrowsingData API |
| All localhost requests | Initialization script: `cache: 'no-store'` on fetch |

---

### Phase 1.7: Terminal Integration for Dev Servers

When a dev server starts (auto or manual), it runs in a **dedicated terminal tab**.

**Current terminal system:**
- `shellSpawn({ cwd })` → creates PTY with working directory → returns `shellId`
- `shellInput(id, data)` → sends keystrokes to the shell
- `terminalTabsStore.addShellTab()` → creates a UI tab
- Tabs are renamable (double-click), closable, auto-numbered
- `manager.kill_all()` runs on app close → all shells killed (no orphan processes)

**Dev server start flow:**
```
1. shellSpawn({ cwd: projectRoot })  → get shellId
2. terminalTabsStore.addShellTab({
       shellId,
       title: "Vite :1420",         ← auto-labeled with framework + port
       type: 'dev-server',          ← new type to distinguish from user shells
       projectPath: project.path,   ← tie to project for cleanup
   })
3. shellInput(shellId, "npm run dev\n")  ← send the start command
4. Poll probePort(1420) every 500ms (max 30s)
5. When port responds → navigate browser → toast "Vite ready ✓"
6. If timeout → toast "Server didn't start — check terminal"
```

**Server ↔ terminal tab lifecycle:**

| Event | Behavior |
|-------|----------|
| **App closes** | `kill_all()` kills everything (already works) |
| **User closes server's terminal tab** | **Confirmation:** "Stop Vite on :1420?" → [Stop Server] / [Hide Tab]. Hide = tab disappears but process keeps running (reconnect via StatusDropdown). Stop = kills process + removes tab. |
| **User closes project** (removes from sidebar) | Kill server tab if it has matching `projectPath` |
| **Switch to different project** | **Keep old server running.** User might switch back. Multiple localhost ports can coexist. |
| **Server crashes** (process exits) | StatusDropdown detects (port probe fails), shows "Crashed" state with [Restart] button + last error. Toast: "Vite crashed — restart from Status." |
| **User wants hidden server's output** | StatusDropdown → "Show Terminal" button → re-creates tab attached to existing PTY |

**Hidden server tabs:**

When user clicks "Hide Tab" on a dev-server terminal, the tab is removed from the UI but
the `shellId` and PTY process stay alive. The dev server manager tracks it:

```js
// In lens store or dev-server state
hiddenServers: Map<shellId, { projectPath, framework, port, startedAt }>
```

StatusDropdown shows hidden servers with a "Show Terminal" action that re-creates
the tab and reconnects to the existing PTY output stream. This means users can freely
manage their terminal tabs without worrying about accidentally killing their dev server.

**Key distinction:**
- Regular shell tabs (`type: 'shell'`): close = kill immediately (existing behavior, fine)
- Dev server tabs (`type: 'dev-server'`): close = confirmation dialog with Hide option
| **User clicks "Stop" in StatusDropdown** | `shellKill(shellId)` → kills PTY → terminal tab shows exit |

**Server eviction on project switch — idle timeout + LRU cap:**

Keeping ALL servers running isn't sustainable (10 projects = 10 Node processes eating RAM/CPU).
Killing immediately on switch is too aggressive (switching back would be slow).

**Strategy: idle timeout with max concurrent cap.**

```
Switch away from Project A → start 5-minute idle timer
    ├── Switch back before 5 min? → cancel timer, server stays warm (instant)
    ├── Timer expires? → graceful stop (shellKill), port freed
    └── Hit max concurrent (3)? → stop oldest idle server immediately
```

| Setting | Default | Stored in |
|---------|---------|-----------|
| `devServerIdleTimeout` | 300000 (5 min) | `config.advanced` |
| `devServerMaxConcurrent` | 3 | `config.advanced` |

**Implementation:** `src/lib/stores/lens.svelte.js` manages a `Map<projectPath, { shellId, timer, startedAt }>`.
When a project is switched away from, `setTimeout(stopServer, idleTimeout)` begins.
When a new server starts and count exceeds `maxConcurrent`, the oldest idle one is stopped first.

**StatusDropdown visibility:** Shows ALL running servers across all projects, not just the
active one. User can manually Stop any server. Shows idle countdown: "Stopping in 3m..."
(optional, could be noisy — maybe just show "Idle" badge).

### Phase 1.8: Toast System Enhancement

The current toast supports a single `action: { label, callback }`. Dev server detection
needs **multiple actions** in one toast.

**Extend `src/lib/stores/toast.svelte.js`:**
```js
// Current:  action: { label, callback } | null       (single button)
// New:      actions: [{ label, callback }, ...] | null (multiple buttons)
```

**Extend `src/components/shared/Toast.svelte`** (or wherever toasts render):
```html
{#if toast.actions}
    {#each toast.actions as action}
        <button onclick={action.callback}>{action.label}</button>
    {/each}
{/if}
```

Keep backward compat: existing `action` (singular) still works, `actions` (plural) is new.
Duration should be longer for actionable toasts (15s instead of 5s) or `0` (no auto-dismiss)
so user has time to read and decide.

### Phase 1.9: Multi-Server & Edge Cases

**Multiple servers per project:**

Some projects have frontend + backend (Vite :5173 + Express :3001). Detection may find both.

- Return all detected servers in the array
- **Primary server** = first in priority order (tauri.conf.json > vite.config > package.json)
- Browser navigates to the primary server
- StatusDropdown shows ALL detected servers — user can click any to navigate browser to it
- Toast only asks about the primary server

**Port conflicts:**

Two projects might both default to port 3000 (e.g., two Next.js apps).

- If Project A's server is running on :3000 and user opens Project B which also wants :3000:
  - Detection shows "Next.js :3000" but probe says "Running" (it's Project A's server!)
  - **Don't navigate** — the wrong project's content would show
  - Toast: "Port 3000 is in use by another project. Stop it first or use a different port."

**Race conditions on fast project switching:**

User rapidly clicks between projects → multiple detect/start flows race.

- **Debounce** the `$effect` in LensPreview — 300ms delay before triggering detection
- Cancel in-flight detection if project changes again before it completes
- Use an `AbortController`-style pattern or generation counter

---

## Part 2: External MCP Server Management (MCP Tab)

### Phase 2.1: Config Schema

**`src-tauri/src/config/schema.rs`** — add:
```rust
pub struct ExternalMcpServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub transport: String,    // "http" | "stdio" | "sse"
    pub enabled: bool,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
}
```

Add `mcp_servers: Vec<ExternalMcpServer>` to `AiConfig`.

**`src/lib/stores/config.svelte.js`** — add `mcpServers: []` to `DEFAULT_CONFIG.ai`.

### Phase 2.2: MCP Client (Rust)

**New file: `src-tauri/src/mcp/client.rs`**

HTTP transport MCP client:
```rust
pub struct McpClient {
    url: String,
    tools: Vec<ToolDefinition>,
    status: ConnectionStatus,
    server_info: Option<ServerInfo>,
}

impl McpClient {
    pub async fn connect(url: &str) -> Result<Self, McpError>;
    pub async fn initialize(&mut self) -> Result<ServerInfo, McpError>;
    pub async fn list_tools(&mut self) -> Result<Vec<ToolDefinition>, McpError>;
    pub async fn call_tool(&self, name: &str, args: Value) -> Result<McpResult, McpError>;
    pub async fn health_check(&self) -> Result<bool, McpError>;
}
```

### Phase 2.3: Connection Manager (Rust)

**New file: `src-tauri/src/mcp/manager.rs`**

```rust
pub struct McpConnectionManager {
    clients: HashMap<String, McpClient>,
}

impl McpConnectionManager {
    pub async fn connect_all_enabled(&mut self);
    pub async fn connect(&mut self, id: &str) -> Result<(), McpError>;
    pub async fn disconnect(&mut self, id: &str);
    pub fn get_all_tools(&self) -> Vec<(String, ToolDefinition)>;
    pub fn get_status(&self, id: &str) -> ConnectionStatus;
}
```

Health polling: ping connected servers every 30s, emit `mcp-server-status` event.

### Phase 2.4: Tauri Commands

**New file: `src-tauri/src/commands/mcp.rs`**

| Command | Purpose |
|---------|---------|
| `list_mcp_servers` | List configured servers with status |
| `add_mcp_server(name, url, transport)` | Add + save to config |
| `remove_mcp_server(id)` | Remove + save |
| `update_mcp_server(id, updates)` | Toggle enabled, rename |
| `test_mcp_server(url)` | Health-check URL |
| `connect_mcp_server(id)` | Connect + discover tools |
| `disconnect_mcp_server(id)` | Disconnect |

### Phase 2.5: Frontend Store + API

**New file: `src/lib/stores/mcp-servers.svelte.js`**
```js
export const mcpServersStore = createMcpServersStore();
```

**`src/lib/api.js`** — add 7 MCP server functions.

### Phase 2.6: StatusDropdown MCP Tab

Wire the MCP tab:
- List external servers with status dots + tool counts
- "Add server" inline input → health check → add
- Three-dot menu: toggle, reconnect, copy URL, remove
- Show tools grouped by server

### Phase 2.7: CLI Provider Integration

**`src-tauri/src/providers/cli/mcp_config.rs`** — extend `write_mcp_config()`:
- Include enabled external servers alongside built-in `voice-mirror`
- Write to Claude Code `settings.json` and OpenCode config

---

## Part 3: LSP Polish (Minimal)

- [ ] **Crash recovery**: Exponential backoff retry (1s → 2s → 4s → 8s, max 4 attempts)
- [ ] **Error toast**: Listen for `lsp-server-error` event → show toast notification
- [ ] **Diagnostic caching**: Restore diagnostics when switching back to a previously-open tab

---

## Implementation Priority

**Recommended order** (most user-visible impact first):

```
1. Dev Server Detection Engine (Phase 1.1-1.2)   ← Rust detection + port probe
2. Workspace ↔ Browser (Phase 1.3-1.5)           ← Kill google.com, auto-detect + navigate
3. Live Reload & Cache Busting (Phase 1.6)        ← CRITICAL for AI coding workflow
4. StatusDropdown Servers Tab (Phase 1.4)          ← Mini dashboard with start/stop
5. MCP Config Schema (Phase 2.1)                  ← Foundation for external MCP
6. MCP Client + Manager (Phase 2.2-2.3)           ← Core MCP client
7. MCP Commands + Frontend (Phase 2.4-2.6)        ← Wire up MCP UI
8. CLI Provider Integration (Phase 2.7)            ← Propagate to Claude Code
9. LSP Polish (Phase 3)                            ← Minor improvements
```

**Rationale:**
- Dev server detection + workspace integration is the #1 priority — it transforms
  Lens from "a browser showing google.com" to "your live development environment".
- Cache busting is #3 because without it, AI-written code won't appear in the browser,
  which defeats the entire purpose of the live preview.
- MCP external servers are important but fewer users need them right now.
- LSP is already working, just needs polish.

---

## File Change Summary

### New Files (12)

| File | Purpose |
|------|---------|
| `src-tauri/src/services/dev_server.rs` | Detection engine + port probe + package manager detection |
| `src-tauri/src/commands/dev_server.rs` | 2 Tauri commands |
| `src-tauri/src/mcp/client.rs` | MCP client (HTTP transport) |
| `src-tauri/src/mcp/manager.rs` | Connection manager |
| `src-tauri/src/commands/mcp.rs` | 7 Tauri commands |
| `src/components/lens/ServersTab.svelte` | Dev server manager tab (extracted from StatusDropdown) |
| `src/components/lens/McpTab.svelte` | MCP server manager tab (extracted from StatusDropdown) |
| `src/components/lens/LspTab.svelte` | LSP status tab (extracted from StatusDropdown) |
| `src/lib/stores/mcp-servers.svelte.js` | MCP servers store |
| `test/stores/mcp-servers.test.cjs` | Store tests |
| `test/api/api-dev-server.test.cjs` | Dev server API tests |
| `test/api/api-mcp-servers.test.cjs` | MCP server API tests |

### Modified Files (16)

| File | Change |
|------|--------|
| `src-tauri/src/services/mod.rs` | Register `dev_server` module |
| `src-tauri/src/services/browser_bridge.rs` | Add `hard_refresh()` cache-busting reload |
| `src-tauri/src/mcp/mod.rs` | Register `client` and `manager` modules |
| `src-tauri/src/commands/mod.rs` | Register `dev_server` and `mcp` modules |
| `src-tauri/src/commands/lens.rs` | Add cache-disable init script for localhost webviews |
| `src-tauri/src/lib.rs` | Register 9+ new commands, managed state |
| `src-tauri/src/config/schema.rs` | Add `ExternalMcpServer`, `mcp_servers` field, project server prefs |
| `src/lib/stores/config.svelte.js` | Add `mcpServers: []` to DEFAULT_CONFIG, project entry fields |
| `src/lib/stores/lens.svelte.js` | Add dev server state (devServers, loading, setters) |
| `src/lib/stores/project.svelte.js` | Add `preferredServerUrl`, `lastBrowserUrl`, `autoStartServer` |
| `src/lib/stores/toast.svelte.js` | Extend to support multiple action buttons (`actions` array) |
| `src/lib/stores/terminal-tabs.svelte.js` | Add `dev-server` tab type, `projectPath` field |
| `src/lib/api.js` | Add 9+ API wrappers (2 dev server + 7 MCP + hard refresh) |
| `src/components/lens/LensPreview.svelte` | Workspace-aware URL + project switch $effect (debounced) |
| `src/components/lens/LensToolbar.svelte` | Add "Hard Refresh" (Ctrl+Shift+R) button |
| `src/components/lens/StatusDropdown.svelte` | Wire both tabs with real data, start/stop toggles |
| `src-tauri/src/providers/cli/mcp_config.rs` | Include external servers |

### Test Updates (3)

| File | Change |
|------|--------|
| `test/api/api-signatures.test.cjs` | Add 9 new commands |
| `test/stores/config.test.cjs` | Assert `mcpServers` in DEFAULT_CONFIG |
| `test/components/status-dropdown.test.cjs` | Update for dynamic server data |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| **Config migration** — adding `mcpServers` to AiConfig | `serde(default)` + `Vec::new()` — old configs just get empty array |
| **Port probe blocks** — TCP connect on main thread | 200ms timeout, run on tokio blocking thread |
| **StatusDropdown complexity** — 769 lines already | Consider extracting tab content to sub-components |
| **MCP client errors** — network failures, protocol mismatches | Connection manager handles retries, status events update UI |
| **Testing** — new Rust modules need cargo test coverage | Add unit tests for detection patterns + port probe mock |
| **Breaking existing UI** — StatusDropdown changes | Source-inspection tests catch structural regressions |

---

## Dependencies

No new crate dependencies needed:
- `tokio` (already) — async TCP connect, spawn_blocking
- `serde_json` (already) — parse package.json, tauri.conf.json
- `reqwest` (already) — HTTP transport for MCP client
- `uuid` (already) — generate IDs for external servers
- `regex` (already) — pattern matching in package.json scripts
