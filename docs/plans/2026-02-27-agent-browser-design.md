# Agent-Browser Integration Design

## Goal

Replace Voice Mirror's 16 individual browser MCP tools with a single `browser_action` tool inspired by [agent-browser](https://github.com/vercel-labs/agent-browser), adding ref-based element identification (@e1, @e2), annotated screenshots, and encrypted auth vault — all implemented in Rust using our existing WebView2 COM APIs.

## Architecture

```
Claude Code ──stdio──▶ voice-mirror-mcp ──pipe──▶ Tauri App
                           │                          │
                    browser_action()           BrowserBridge (Rust)
                    parses action+ref          ├── ref_map: HashMap<String, RefEntry>
                           │                  ├── auth_vault: AES-256-GCM profiles
                    PipeRouter                ├── CDP: Accessibility.getFullAXTree
                    (oneshot channels)        └── WebView2 COM APIs
                                                   ├── ExecuteScript (JS eval)
                                                   ├── CapturePreview (screenshot)
                                                   └── CallDevToolsProtocolMethodAsync (CDP)
```

### Data Flow

```
User/Claude calls: browser_action(action="click", ref="@e3")
  ↓
MCP binary (server.rs): dispatches to browser handler
  ↓
browser handler: sends BrowserRequest via named pipe {action: "click", ref: "@e3"}
  ↓
Tauri app (browser_bridge.rs): receives request
  ↓
BrowserBridge.handle_browser_action():
  1. Resolves "@e3" → RefEntry { selector: "[role='button'][aria-label='Submit']", ... }
  2. Generates JS: document.querySelector(selector).click()
  3. ExecuteScript(js) → result
  ↓
Response back via pipe → MCP binary → Claude
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Command scope** | ~35 core actions + auth | 95% of dev workflow coverage without bloat |
| **MCP surface** | Single `browser_action` tool | Reduces tool clutter from 16 to 1 |
| **Ref system** | CDP `Accessibility.getFullAXTree()` | Same Chromium API Playwright uses — full parity |
| **Ref state** | Rust-side `HashMap<String, RefEntry>` | Survives page JS context changes, single source of truth |
| **Annotated screenshots** | DOM injection (agent-browser approach) | Proven, pixel-perfect, ~30 lines JS |
| **Auth vault** | AES-256-GCM in Rust (`aes-gcm` crate) | Encrypted credential storage for site logins |
| **Window screenshots** | Keep existing `CapturePreview` | WebView2-specific, captures native window at GPU DPI |

## Command Set (~35 actions)

### Navigation
- `navigate` — Go to URL
- `back` — Browser back
- `forward` — Browser forward
- `reload` — Refresh page

### Interaction
- `click` — Click element (by @ref or CSS selector)
- `dblclick` — Double-click element
- `fill` — Set input value (focus + value + input/change events)
- `type` — Type text character-by-character
- `hover` — Mouse hover
- `focus` — Focus element
- `scroll` — Scroll page or element
- `drag` — Drag element to target
- `select` — Select dropdown option
- `check` / `uncheck` — Toggle checkboxes

### Observation
- `screenshot` — Capture viewport (with optional `annotate: true` for numbered @eN overlays)
- `snapshot` — Get accessibility tree with @eN refs
- `gettext` — Get element text content
- `content` — Get page/element HTML
- `boundingbox` — Get element x/y/width/height
- `isvisible` — Check element visibility
- `url` — Get current page URL
- `title` — Get page title

### JavaScript
- `evaluate` — Execute JS, return result
- `addscript` — Inject script tag

### Tabs
- `tab_new` — Create new tab
- `tab_list` — List all tabs
- `tab_switch` — Switch to tab by index
- `tab_close` — Close tab

### Wait
- `wait` — Wait for element/URL/state
- `waitforurl` — Wait for URL pattern match
- `waitforloadstate` — Wait for load/DOMContentLoaded/networkidle

### State
- `cookies_get` — Read cookies
- `cookies_set` — Set cookie
- `cookies_clear` — Clear all cookies
- `storage_get` — Read localStorage/sessionStorage
- `storage_set` — Write to storage

### Auth (encrypted vault)
- `auth_save` — Save encrypted credentials (site URL + username + password)
- `auth_login` — Auto-fill login form from vault profile
- `auth_list` — List saved auth profiles (metadata only, no passwords)
- `auth_delete` — Delete auth profile

### HTTP (direct, no webview)
- `search` — Web search via DuckDuckGo Lite (reqwest)
- `fetch` — Fetch URL content (reqwest)

## Ref System (@eN) — Technical Design

### CDP Accessibility Tree

```rust
// Call via WebView2 COM API
core_webview.CallDevToolsProtocolMethodAsync(
    "Accessibility.getFullAXTree",
    "{}",
    &handler
) -> JSON AX node tree

// AX node structure (from Chromium)
{
  "nodes": [
    {
      "nodeId": "1",
      "role": { "type": "role", "value": "button" },
      "name": { "type": "computedString", "value": "Submit" },
      "properties": [...],
      "childIds": ["2", "3"],
      "backendDOMNodeId": 42
    },
    ...
  ]
}
```

### Ref Assignment Logic

1. Parse AX tree from CDP response
2. Walk nodes, assign @eN refs to interactive + content roles:
   - **Interactive** (always get refs): button, link, textbox, checkbox, radio, combobox, listbox, menuitem, option, searchbox, slider, switch, tab, treeitem
   - **Content** (get refs if named): heading, cell, listitem, article, region, main, navigation
3. Build CSS/JS selector for each ref (role + name → query strategy)
4. Store in `ref_map: HashMap<String, RefEntry>`
5. Handle duplicates with nth-index disambiguation

### RefEntry Structure

```rust
struct RefEntry {
    role: String,
    name: String,
    selector: String,     // JS query to locate element
    backend_node_id: u32, // CDP node ID for direct targeting
    nth: Option<u32>,     // Disambiguation for duplicate role+name
}
```

### Selector Strategy

For each ref, generate a JS expression that finds the element:
1. **Primary**: `document.querySelector('[role="button"][aria-label="Submit"]')`
2. **Fallback**: Use `TreeWalker` with role + textContent matching
3. **CDP direct**: Use `DOM.resolveNode(backendNodeId)` for guaranteed match

## Annotated Screenshots

```
1. Call snapshot(interactive=true) to get current refs
2. For each ref, get bounding box via JS: el.getBoundingClientRect()
3. Inject overlay divs via ExecuteScript:
   - Red 2px border box at element position
   - White number label (1, 2, 3...) above/below box
   - z-index: 2147483647
4. CapturePreview → PNG with overlays visible
5. Remove overlay divs via ExecuteScript
6. Return: { base64, annotations: [{ref, number, role, name, box}] }
```

## Auth Vault

```rust
// Stored at: %APPDATA%/voice-mirror/auth/{profile-name}.json
struct AuthProfile {
    name: String,
    url: String,
    username: Vec<u8>,  // AES-256-GCM encrypted
    password: Vec<u8>,  // AES-256-GCM encrypted
    nonce: Vec<u8>,
    selectors: Option<AuthSelectors>,  // CSS selectors for form fields
    created_at: String,
    last_login_at: Option<String>,
}

// Encryption key: %APPDATA%/voice-mirror/auth/.key (256-bit, 0o600)
// Crate: aes-gcm (pure Rust, no OpenSSL dependency)
```

## MCP Tool Definition

```json
{
  "name": "browser_action",
  "description": "Control the browser. Actions: navigate, back, forward, reload, click, fill, type, hover, scroll, screenshot (with annotate option for numbered element overlays), snapshot (accessibility tree with @eN refs), evaluate, tab_new/list/switch/close, wait, cookies, storage, auth_login/save/list/delete, search, fetch. Use snapshot first to get element refs, then click/fill by ref.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["navigate", "back", "forward", "reload", "click", "dblclick", "fill", "type", "hover", "focus", "scroll", "drag", "select", "check", "uncheck", "screenshot", "snapshot", "gettext", "content", "boundingbox", "isvisible", "url", "title", "evaluate", "addscript", "tab_new", "tab_list", "tab_switch", "tab_close", "wait", "waitforurl", "waitforloadstate", "cookies_get", "cookies_set", "cookies_clear", "storage_get", "storage_set", "auth_save", "auth_login", "auth_list", "auth_delete", "search", "fetch"],
        "description": "The browser action to perform"
      },
      "ref": {
        "type": "string",
        "description": "Element reference from snapshot (e.g. '@e1', '@e3')"
      },
      "selector": {
        "type": "string",
        "description": "CSS selector (alternative to ref)"
      },
      "url": {
        "type": "string",
        "description": "URL for navigate/fetch/search"
      },
      "value": {
        "type": "string",
        "description": "Value for fill/type/storage_set/cookies_set"
      },
      "annotate": {
        "type": "boolean",
        "description": "For screenshot: add numbered element overlay boxes"
      },
      "interactive": {
        "type": "boolean",
        "description": "For snapshot: only show interactive elements"
      },
      "expression": {
        "type": "string",
        "description": "JavaScript expression for evaluate"
      },
      "options": {
        "type": "object",
        "description": "Additional action-specific parameters"
      }
    },
    "required": ["action"]
  }
}
```

## What Gets Removed

**16 MCP tools removed:**
- `browser_start`, `browser_stop`, `browser_status`, `browser_tabs`
- `browser_open`, `browser_close_tab`, `browser_focus`, `browser_navigate`
- `browser_screenshot`, `browser_snapshot`, `browser_act`, `browser_console`
- `browser_search`, `browser_fetch`, `browser_cookies`, `browser_storage`

**Replaced by:** Single `browser_action` tool with 35+ actions.

**Code removed:**
- All individual `handle_browser_*` functions in `mcp/handlers/browser.rs`
- Current `SNAPSHOT_JS` IIFE (replaced by CDP accessibility tree)

**Code kept/enhanced:**
- `evaluate_js_with_result()` — still used for JS eval, interaction commands
- `capture_screenshot_png()` — still used for screenshots (with annotation layer on top)
- `pipe_browser_request()` + `PipeRouter` — IPC mechanism unchanged
- `handle_browser_search()` / `handle_browser_fetch()` — direct HTTP tools remain

## Files Modified

### Rust (Tauri app side)
- `src-tauri/src/services/browser_bridge.rs` — Major rewrite: add CDP accessibility tree, ref map, annotation system, auth vault integration, expanded action dispatch
- `src-tauri/Cargo.toml` — Add `aes-gcm` crate for auth vault encryption

### Rust (MCP binary side)
- `src-tauri/src/mcp/handlers/browser.rs` — Replace 16 handler functions with single `handle_browser_action` dispatcher
- `src-tauri/src/mcp/tools.rs` — Replace 16 tool definitions with single `browser_action` tool
- `src-tauri/src/mcp/server.rs` — Update dispatch table (16 entries → 1)

### New Files
- `src-tauri/src/services/auth_vault.rs` — AES-256-GCM encrypted credential storage
- `src-tauri/src/services/cdp.rs` — Chrome DevTools Protocol helpers (accessibility tree parsing, ref assignment)

### Tests
- `test/components/browser-action.cjs` — Source-inspection tests for new tool
- Rust unit tests in modified files
