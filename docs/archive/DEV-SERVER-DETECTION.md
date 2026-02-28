# Dev Server Detection & Workspace Browser Integration

## Overview

When a user opens a workspace (project), Voice Mirror should detect available development servers, probe if they're running, and navigate the Lens browser to the appropriate localhost URL. This replaces the current hardcoded `google.com` default with intelligent, project-aware behavior.

**Goal:** Open a workspace, see your app — no manual URL typing.

**Ties into:**
- [MCP-SERVERS.md](./MCP-SERVERS.md) — "Add server" and server management UI
- [BROWSER-VISION.md](./BROWSER-VISION.md) — Lens live preview as a dev workspace
- [INSTALLER-PLAN.md](./INSTALLER-PLAN.md) — Optional tooling detection

---

## Current State

- Browser tab defaults to `about:blank` (not google.com — changed during dev server integration)
- Dev server detection is **implemented** in `src-tauri/src/services/dev_server.rs`
- StatusDropdown shows real detected servers via `ServersTab.svelte` (extracted from StatusDropdown)
- Port probing (`is_port_listening`) and workspace-aware browser navigation work
- Dev server lifecycle management implemented in `dev-server-manager.svelte.js`
- Workspaces are tracked via `projectStore` (path + name + `preferredServerUrl` + `lastBrowserUrl` + `autoStartServer`)

---

## Architecture

```
Workspace Opened
    │
    ▼
┌─────────────────────────────┐
│  Dev Server Detection       │  Rust: reads project config files
│  (package.json, tauri.conf, │  to identify framework, port, and
│   vite.config, .env, etc.)  │  start command
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Port Probe                 │  Rust: TCP connect to 127.0.0.1:port
│  Is the server running?     │  Quick check, non-blocking
└──────────┬──────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
  Running     Not Running
     │           │
     ▼           ▼
  Navigate    Show "Start Server?"
  browser     button in StatusDropdown
  to URL      (spawns in shell terminal)
```

---

## Detection Sources

### Priority 1: Framework Config Files (exact port)

These files tell us the exact port/URL the dev server uses:

| File | What We Read | Example |
|------|-------------|---------|
| `tauri.conf.json` | `build.devUrl` | `"http://localhost:1420"` |
| `vite.config.js/ts` | `server.port` | `port: 5173` |
| `angular.json` | `projects.*.architect.serve.options.port` | `4200` |
| `.env` / `.env.local` | `PORT=` or `VITE_PORT=` | `PORT=3000` |
| `next.config.js` | Rarely overrides (check `--port` in scripts) | — |
| `vue.config.js` | `devServer.port` | `8080` |
| `nuxt.config.ts` | `devServer.port` | `3000` |

### Priority 2: package.json Scripts (framework + default port)

Read `scripts.dev`, `scripts.start`, `scripts.serve` and match patterns:

| Pattern in Script | Framework | Default Port | Start Command |
|-------------------|-----------|-------------|---------------|
| `vite` | Vite | 5173 | `npm run dev` |
| `tauri dev` | Tauri (Vite) | 1420 | `npm run dev` |
| `next dev` / `next start` | Next.js | 3000 | `npm run dev` |
| `nuxt dev` / `nuxi dev` | Nuxt | 3000 | `npm run dev` |
| `react-scripts start` | Create React App | 3000 | `npm start` |
| `ng serve` | Angular CLI | 4200 | `npm start` |
| `vue-cli-service serve` | Vue CLI | 8080 | `npm run serve` |
| `webpack serve` | Webpack Dev Server | 8080 | `npm run dev` |
| `parcel` / `parcel serve` | Parcel | 1234 | `npm start` |
| `remix dev` | Remix | 3000 | `npm run dev` |
| `astro dev` | Astro | 4321 | `npm run dev` |
| `gatsby develop` | Gatsby | 8000 | `npm run dev` |
| `storybook dev` | Storybook | 6006 | `npm run storybook` |
| `docusaurus start` | Docusaurus | 3000 | `npm start` |
| `eleventy --serve` | Eleventy | 8080 | `npm start` |
| `svelte-kit dev` | SvelteKit | 5173 | `npm run dev` |
| `parcel` / `parcel serve` | Parcel | 1234 | `npm start` |
| `expo start` / `expo start --web` | Expo | 8081 | `npm start` |
| `trunk serve` | Trunk (Rust WASM) | 8080 | `trunk serve` |

**Port override detection:** Also check for `--port NNNN` or `-p NNNN` flags in the script string.

### Priority 3: Non-JS Project Detection (future)

| Marker File | Framework | Default Port | Start Command |
|-------------|-----------|-------------|---------------|
| `manage.py` | Django | 8000 | `python manage.py runserver` |
| `Gemfile` + `bin/rails` | Rails | 3000 | `rails server` |
| `composer.json` + `artisan` | Laravel | 8000 | `php artisan serve` |
| `go.mod` + `main.go` | Go | 8080 | `go run .` |
| `pom.xml` / `build.gradle` | Spring Boot | 8080 | `./mvnw spring-boot:run` |
| `Trunk.toml` | Trunk (Rust) | 8080 | `trunk serve` |
| `docker-compose.yml` | Docker Compose | parse `ports:` | `docker compose up` |

### Priority 4: User-Configured (manual)

From the "Add server" UI in StatusDropdown (see MCP-SERVERS.md):
- User manually adds `http://localhost:9000` with a label
- Stored per-workspace in config
- Highest priority — user intent overrides auto-detection

---

## Detection Result

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedDevServer {
    /// Display name: "Vite", "Next.js", "Django", etc.
    pub framework: String,
    /// The port number
    pub port: u16,
    /// Full URL: "http://localhost:1420"
    pub url: String,
    /// Command to start the server: "npm run dev"
    pub start_command: String,
    /// How we detected it: "tauri.conf.json", "package.json", "manual"
    pub source: String,
    /// Whether the port is currently responding
    pub running: bool,
}
```

---

## Port Probing

Quick TCP connect probe to check if a server is already listening:

```rust
use std::net::TcpStream;
use std::time::Duration;

pub fn is_port_listening(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(200),
    ).is_ok()
}
```

**When to probe:**
- On workspace open (initial detection)
- On StatusDropdown open (refresh status)
- Every 5 seconds while StatusDropdown is open (polling)
- After starting a server (poll until ready, then navigate)

---

## Browser Integration

### Default URL Resolution

When the Lens browser tab is created, instead of hardcoded `google.com`:

```
1. Check workspace config for user-configured server URL
2. Run dev server detection for the project
3. Probe detected port
4. If running → navigate to detected URL
5. If not running → show welcome page (about:blank or custom start page)
```

### Workspace Switching

When the user switches workspaces (clicks a different project in the sidebar):

1. Detect dev server for the new workspace
2. Probe port
3. If running → navigate browser to new URL
4. StatusDropdown updates to show new workspace's servers

### After Server Start

When a dev server is started from the StatusDropdown or terminal:

1. Poll the port every 500ms (up to 30s timeout)
2. When port responds → auto-navigate browser
3. Show "Server ready" toast notification

---

## StatusDropdown Integration

### Servers Tab (Enhanced)

Replace hardcoded "Dev Server (Vite) localhost:1420" with real detected data:

```
┌─ Servers ─────────────────────────────┐
│ ● Claude Code        CLI / PTY    Current │
│ ● Vite Dev Server    :1420     Running    │  ← auto-detected, port probed
│ ○ Storybook          :6006     Stopped    │  ← detected but not running
├───────────────────────────────────────┤
│ [▶ Start]  [Manage servers]           │
└───────────────────────────────────────┘
```

**Start button:** Appears when a detected server isn't running. Spawns the start command in a new shell terminal tab.

**Server states:**
- `● Running` (green) — port responding
- `○ Stopped` (grey) — detected but port not responding
- `◉ Starting...` (yellow, pulse) — start command running, waiting for port
- `✕ Error` (red) — start command failed

### Manage Servers View (Enhanced)

```
┌─ Servers ──────────────────── ✕ ──────┐
│ ← Search servers                       │
├────────────────────────────────────────┤
│ ● Claude Code        CLI / PTY         │
│   Current Server                       │
│                                        │
│ ● Vite Dev Server    localhost:1420     │
│   Auto-detected from tauri.conf.json   │ ← detection source shown
│   [▶ Start] [Open in Browser]    [⋮]  │
│                                        │
│ ○ Storybook          localhost:6006     │
│   Auto-detected from package.json      │
│   [▶ Start]                      [⋮]  │
│                                        │
│ ● My API Server      localhost:9000     │
│   Manually configured                  │ ← user-added
│   [Open in Browser]              [⋮]  │
├────────────────────────────────────────┤
│ [+ Add server]                         │
└────────────────────────────────────────┘
```

**Three-dot menu (⋮):**
- Open in Browser
- Copy URL
- Start / Stop (for detected servers with start commands)
- Edit (for manually configured)
- Remove (for manually configured; auto-detected can't be removed)

---

## Server Lifecycle

### Starting a Dev Server

1. User clicks "Start" on a detected server
2. Spawn the start command (`npm run dev`) in a **new shell terminal tab**
3. Terminal tab shows the server output (Vite startup, etc.)
4. Poll port every 500ms
5. When port responds:
   - Update StatusDropdown dot to green
   - Auto-navigate browser to the URL
   - Show toast: "Vite Dev Server ready on localhost:1420"

### Stopping a Dev Server

1. User clicks "Stop" on a running server (from three-dot menu)
2. Send SIGTERM to the process group
3. Update StatusDropdown dot to grey
4. Browser stays on current URL (don't navigate away)

### Auto-Detection on Workspace Open

1. `projectStore` emits workspace change
2. Backend runs `detect_dev_servers(project_root)`
3. Results stored in workspace-scoped state
4. Frontend receives via Tauri event or command response
5. StatusDropdown + browser URL update

---

## Tauri Commands

| Command | Purpose | Returns |
|---------|---------|---------|
| `detect_dev_servers` | Scan project for dev server configs | `Vec<DetectedDevServer>` |
| `probe_port` | Check if a port is listening | `bool` |
| `start_dev_server` | Spawn start command in shell | Process ID |
| `stop_dev_server` | Kill a running dev server | `()` |
| `get_workspace_servers` | Get cached detection + probe results | `Vec<DetectedDevServer>` |

---

## Config Storage

### Per-Workspace Server Config

Add to workspace/project config:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceServerConfig {
    /// User-configured servers (manual "Add server")
    #[serde(default)]
    pub custom_servers: Vec<CustomServer>,
    /// Whether to auto-navigate browser on workspace open
    #[serde(default = "default_true")]
    pub auto_navigate: bool,
    /// Preferred server URL (if multiple detected, which to open)
    #[serde(default)]
    pub preferred_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomServer {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub start_command: Option<String>,
}
```

---

## Implementation Phases

### Phase 1: Detection Engine (Rust)

**New module:** `src-tauri/src/services/dev_server.rs`

- `detect_dev_servers(project_root: &str) -> Vec<DetectedDevServer>`
- Parse `package.json` scripts for framework patterns
- Parse `tauri.conf.json` for `devUrl`
- Parse `.env` for `PORT`
- `is_port_listening(port: u16) -> bool` TCP probe
- Register as Tauri commands

### Phase 2: Browser Default URL

- Replace hardcoded `google.com` in lens creation
- On workspace open: detect → probe → navigate (or `about:blank`)
- Store last URL per workspace for fast restore

### Phase 3: StatusDropdown Wiring

- Replace hardcoded "Dev Server (Vite)" with real detection results
- Add Start/Stop buttons
- Wire port probe polling
- Show detection source ("from tauri.conf.json")

### Phase 4: Server Lifecycle

- Start button → spawn in shell terminal tab
- Poll port until ready → auto-navigate
- Stop button → kill process
- Toast notifications for state changes

### Phase 5: Workspace Switching

- Listen for `projectStore` changes
- Re-run detection for new workspace
- Update browser URL + StatusDropdown
- Remember preferred server per workspace

### Phase 6: Custom Servers (ties into MCP-SERVERS.md)

- "Add server" inline input in StatusDropdown
- Store in workspace config
- Custom servers override auto-detected ones
- Sync with MCP server management

---

## File Changes

| File | Change | Phase |
|------|--------|-------|
| `src-tauri/src/services/dev_server.rs` | **NEW** — Detection engine + port probe | 1 |
| `src-tauri/src/services/mod.rs` | Register `dev_server` module | 1 |
| `src-tauri/src/commands/lens.rs` | Use detected URL instead of google.com | 2 |
| `src/lib/stores/lens.svelte.js` | Add workspace server state | 2-3 |
| `src/components/lens/StatusDropdown.svelte` | Wire real server data + Start/Stop | 3 |
| `src/lib/api.js` | Add detection + lifecycle commands | 1-4 |
| `src-tauri/src/config/schema.rs` | Add `WorkspaceServerConfig` | 6 |

---

## Detection Examples

### Voice Mirror (this project)

```
tauri.conf.json → devUrl: "http://localhost:1420"
package.json scripts.dev → "tauri dev" (Tauri framework)
Result: Vite Dev Server, port 1420, "npm run dev"
```

### A Next.js Project

```
package.json scripts.dev → "next dev"
.env → PORT=3001
Result: Next.js, port 3001, "npm run dev"
```

### A Django + React Project

```
manage.py exists → Django, port 8000, "python manage.py runserver"
package.json scripts.start → "react-scripts start"
.env → PORT=3000
Result: Two servers detected:
  - Django API, port 8000
  - React Frontend, port 3000
```

### A Docker Compose Project

```
docker-compose.yml → ports: ["3000:3000", "5432:5432"]
Result: Docker services, ports 3000 + 5432, "docker compose up"
```

---

## Future Enhancements

- **Framework logos** — show Vite/Next/Angular icon next to server name
- **Hot reload indicator** — detect HMR WebSocket connection, show "HMR Connected"
- **Multiple servers** — some projects run frontend + backend; show both, let user pick default browser target
- **Server output in StatusDropdown** — small log preview without switching to terminal
- **Auto-start option** — "Always start this server when opening workspace" toggle
- **Network info** — show local IP for testing on mobile devices
- **Shared servers across workspaces** — some servers (like Storybook) might serve multiple projects
