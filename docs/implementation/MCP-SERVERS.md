# External MCP Server Management

## Overview

Add support for connecting to external MCP (Model Context Protocol) servers from the StatusDropdown's "Add server" button. This enables users to bring their own MCP tool servers alongside the built-in `voice-mirror` MCP server.

**Reference:** OpenCode Desktop's server management UI (add/remove/health-check servers).

---

## Current Architecture

### Built-in MCP Server

Voice Mirror runs its **own** MCP server (`voice-mirror-mcp`) as a subprocess:

```
CLI Provider (Claude Code / OpenCode)
    ↕ JSON-RPC 2.0 over stdio
voice-mirror-mcp binary (4 groups, 48 tools)
    ↕ Named pipe IPC (fast path)
Tauri main app
```

- **Binary:** `src-tauri/src/bin/mcp.rs` (separate `[[bin]]` target)
- **Server:** `src-tauri/src/mcp/server.rs` — JSON-RPC 2.0 protocol handler
- **Tools:** `src-tauri/src/mcp/tools.rs` — Registry with 4 groups (core, memory, browser, n8n)
- **IPC:** `src-tauri/src/ipc/` — Named pipes (Windows) / Unix domain sockets

### What We Don't Have

- **No MCP client** — the app only runs a server, never connects TO external servers
- **No external server config** — config schema has no `mcpServers` field
- **No health checking** — no way to ping/verify external server status

---

## Implementation Plan

### Phase 1: Config & Persistence

**Add to config schema** (`src-tauri/src/config/schema.rs`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalMcpServer {
    pub id: String,              // Unique ID (uuid or slug)
    pub name: String,            // Display name
    pub url: String,             // Server URL (http://localhost:4096)
    pub transport: String,       // "http" | "stdio" | "sse"
    pub enabled: bool,           // Toggle on/off
    #[serde(default)]
    pub command: Option<String>, // For stdio: binary path
    #[serde(default)]
    pub args: Option<Vec<String>>, // For stdio: arguments
    #[serde(default)]
    pub env: Option<HashMap<String, String>>, // Environment variables
}
```

**Add to `AiConfig`:**
```rust
#[serde(default)]
pub mcp_servers: Vec<ExternalMcpServer>,
```

**Frontend DEFAULT_CONFIG** (`src/lib/stores/config.svelte.js`):
```js
ai: {
  // ... existing fields ...
  mcpServers: [],
}
```

### Phase 2: Tauri Commands

**New file:** `src-tauri/src/commands/mcp.rs`

| Command | Purpose | Params |
|---------|---------|--------|
| `list_mcp_servers` | List configured servers with status | — |
| `add_mcp_server` | Add new server to config | `name`, `url`, `transport` |
| `remove_mcp_server` | Remove server from config | `id` |
| `update_mcp_server` | Toggle enabled, rename, etc. | `id`, `updates` |
| `test_mcp_server` | Health-check a server URL | `url` |
| `connect_mcp_server` | Connect and discover tools | `id` |
| `disconnect_mcp_server` | Disconnect from server | `id` |

**Register in `lib.rs`** — add all commands to `invoke_handler![]`.

**Why granular commands?** The config `deep_merge` replaces arrays wholesale. Granular commands let the backend manage the list safely without race conditions.

### Phase 3: MCP Client

**New module:** `src-tauri/src/mcp/client.rs`

Implements the client side of the MCP protocol to connect TO external servers:

```rust
pub struct McpClient {
    url: String,
    transport: Transport,
    tools: Vec<ToolDefinition>,   // Discovered tools
    status: ConnectionStatus,     // Connected, Disconnected, Error
    server_info: Option<ServerInfo>, // Name, version from initialize
}

impl McpClient {
    pub async fn connect(url: &str) -> Result<Self, McpError>;
    pub async fn initialize(&mut self) -> Result<ServerInfo, McpError>;
    pub async fn list_tools(&mut self) -> Result<Vec<ToolDefinition>, McpError>;
    pub async fn call_tool(&self, name: &str, args: Value) -> Result<McpResult, McpError>;
    pub async fn health_check(&self) -> Result<bool, McpError>;
    pub fn disconnect(&mut self);
}
```

**Transport support:**
- **HTTP/SSE** (priority): `POST /` with JSON-RPC body. Most common for remote servers.
- **Stdio** (future): Spawn subprocess, communicate via stdin/stdout. For local tool servers.

**Protocol flow:**
```
Client → Server: { "method": "initialize", "params": { "protocolVersion": "2024-11-05", "capabilities": {} } }
Server → Client: { "result": { "serverInfo": { "name": "...", "version": "..." }, "capabilities": { "tools": {} } } }
Client → Server: { "method": "notifications/initialized" }
Client → Server: { "method": "tools/list" }
Server → Client: { "result": { "tools": [...] } }
```

### Phase 4: Connection Manager

**New module:** `src-tauri/src/mcp/manager.rs`

Manages connections to all configured external MCP servers:

```rust
pub struct McpConnectionManager {
    clients: HashMap<String, McpClient>,  // id → client
    config: Arc<Mutex<AppConfig>>,
}

impl McpConnectionManager {
    pub fn new() -> Self;
    pub async fn connect_all_enabled(&mut self);
    pub async fn connect(&mut self, id: &str) -> Result<(), McpError>;
    pub async fn disconnect(&mut self, id: &str);
    pub fn get_all_tools(&self) -> Vec<(String, ToolDefinition)>; // (server_id, tool)
    pub async fn call_tool(&self, server_id: &str, tool: &str, args: Value) -> Result<McpResult, McpError>;
    pub fn get_status(&self, id: &str) -> ConnectionStatus;
}
```

**State management:** Store as `McpConnectionManager` in Tauri's managed state (same pattern as `LensState`, `PipeState`).

**Health polling:** Background task that pings connected servers every 30s, emits `mcp-server-status` Tauri event on changes.

### Phase 5: Frontend Store

**New file:** `src/lib/stores/mcp-servers.svelte.js`

```js
function createMcpServersStore() {
  let servers = $state([]);       // Array of { id, name, url, transport, enabled, status, toolCount }
  let loading = $state(false);

  return {
    get servers() { return servers; },
    get loading() { return loading; },

    async refresh() { ... },       // Fetch from backend
    async add(name, url) { ... },  // Add + connect
    async remove(id) { ... },      // Disconnect + remove
    async toggle(id) { ... },      // Enable/disable
    async test(url) { ... },       // Health check before adding
  };
}

export const mcpServersStore = createMcpServersStore();
```

### Phase 6: API Wrappers

**Add to `src/lib/api.js`:**

```js
// ============ MCP Servers ============

export async function listMcpServers() {
  return invoke('list_mcp_servers');
}

export async function addMcpServer(name, url, transport = 'http') {
  return invoke('add_mcp_server', { name, url, transport });
}

export async function removeMcpServer(id) {
  return invoke('remove_mcp_server', { id });
}

export async function updateMcpServer(id, updates) {
  return invoke('update_mcp_server', { id, updates });
}

export async function testMcpServer(url) {
  return invoke('test_mcp_server', { url });
}

export async function connectMcpServer(id) {
  return invoke('connect_mcp_server', { id });
}

export async function disconnectMcpServer(id) {
  return invoke('disconnect_mcp_server', { id });
}
```

### Phase 7: StatusDropdown UI Integration

**"Add server" flow:**
1. Click "+ Add server" → inline input appears (replaces the button)
2. User types URL (e.g., `http://localhost:4096`)
3. Press Enter → calls `testMcpServer(url)` for health check
4. If healthy → calls `addMcpServer(name, url)` → server appears in list
5. If error → shows error inline (red text, retry option)

**Server list (manage view):**
```
┌─ Servers ──────────────┐ [✕]
│ ← Search servers       │
├────────────────────────┤
│ ● Claude Code          │ CLI / PTY    [Current Server]
│ ● Dev Server (Vite)    │ localhost    [⋮]
│ ● my-tools             │ :4096  3 tools [⋮]
│ ○ backup-server        │ :8080  Error   [⋮]
├────────────────────────┤
│ [+ Add server]         │
│ ┌──────────────────┐   │  ← inline input (shown after click)
│ │ http://...       │   │
│ └──────────────────┘   │
└────────────────────────┘
```

**Three-dot menu (⋮) options:**
- Toggle enabled/disabled
- Reconnect
- Copy URL
- Remove server

**Servers tab (normal view):**
- Shows built-in servers + external servers from `mcpServersStore`
- Each external server shows: status dot, name, URL, tool count, checkmark if connected

**MCP tab enhancement:**
- Shows tools from built-in `voice-mirror` MCP + tools from external servers
- Group tools by server name

### Phase 8: CLI Provider Integration

When an external MCP server is added, also write it to the CLI provider's MCP config:

**For Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "voice-mirror": { "command": "...", "env": { ... } },
    "my-tools": { "type": "http", "url": "http://localhost:4096" }
  }
}
```

**For OpenCode** (`~/.config/opencode/opencode.json`):
```json
{
  "mcpServers": {
    "voice-mirror": { ... },
    "my-tools": { "type": "http", "url": "http://localhost:4096" }
  }
}
```

This means the CLI provider (Claude Code, OpenCode) can natively use the external MCP tools alongside the built-in voice-mirror tools.

**Implementation:** Extend `write_mcp_config()` in `src-tauri/src/providers/cli/mcp_config.rs` to include external servers from config.

---

## File Changes Summary

| File | Change | Phase |
|------|--------|-------|
| `src-tauri/src/config/schema.rs` | Add `ExternalMcpServer` struct + `mcp_servers` to `AiConfig` | 1 |
| `src/lib/stores/config.svelte.js` | Add `mcpServers: []` to `DEFAULT_CONFIG.ai` | 1 |
| `src-tauri/src/commands/mcp.rs` | **NEW** — 7 Tauri commands | 2 |
| `src-tauri/src/commands/mod.rs` | Register `mcp` module | 2 |
| `src-tauri/src/lib.rs` | Register commands in `invoke_handler![]` | 2 |
| `src-tauri/src/mcp/client.rs` | **NEW** — MCP client (JSON-RPC over HTTP) | 3 |
| `src-tauri/src/mcp/manager.rs` | **NEW** — Connection manager + health polling | 4 |
| `src-tauri/src/mcp/mod.rs` | Register new modules | 3-4 |
| `src/lib/stores/mcp-servers.svelte.js` | **NEW** — Reactive server list store | 5 |
| `src/lib/api.js` | Add 7 MCP server API wrappers | 6 |
| `src/components/lens/StatusDropdown.svelte` | Wire up "Add server" + external server list | 7 |
| `src-tauri/src/providers/cli/mcp_config.rs` | Extend `write_mcp_config()` for external servers | 8 |

## Tests

| File | Type |
|------|------|
| `test/api/api-signatures.test.cjs` | Update — add 7 MCP commands |
| `test/stores/mcp-servers.test.cjs` | **NEW** — store exports, state, methods |
| `test/stores/config.test.cjs` | Update — assert `mcpServers` in DEFAULT_CONFIG |
| `test/components/status-dropdown.test.cjs` | Update — external server rendering |

---

## Implementation Order

1. Config schema + defaults (Rust + JS)
2. Tauri commands (Rust)
3. MCP client module (Rust)
4. Connection manager (Rust)
5. API wrappers (JS)
6. Frontend store (Svelte)
7. StatusDropdown UI wiring (Svelte)
8. CLI provider config integration (Rust)
9. Tests (JS)
10. `npm test` + manual verification

---

## Future Enhancements

- **Stdio transport:** Spawn local MCP server binaries (not just HTTP)
- **SSE transport:** Server-Sent Events for streaming tool results
- **Tool profiles:** Include/exclude specific tools from external servers
- **Auto-discovery:** Scan for MCP servers on common ports
- **Import from Claude:** Read existing `~/.claude/settings.json` MCP config on first launch
