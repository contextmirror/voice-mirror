# Browser Control Reference

Voice Mirror's Lens workspace includes a live browser preview panel -- a native
WebView2 window that renders alongside the code editor, file tree, and terminal.
The AI agent can navigate pages, take screenshots, read page structure, click
elements, and fill forms in this browser, making it possible to build and test
web applications entirely through voice commands and AI-driven workflows.

Under the hood, MCP browser tools route through a named pipe to the Tauri app,
which processes actions using the WebView2 COM API and JavaScript evaluation.
Direct HTTP tools (`browser_search`, `browser_fetch`) use `reqwest` without the
webview.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Browser Bridge](#2-browser-bridge)
3. [MCP Browser Tools](#3-mcp-browser-tools)
4. [Browser Actions (via bridge)](#4-browser-actions-via-bridge)
5. [Direct HTTP Tools](#5-direct-http-tools)
6. [Snapshot System](#6-snapshot-system)
7. [Screenshot Capture](#7-screenshot-capture)
8. [Cookies and Storage](#8-cookies-and-storage)
9. [Named Pipe IPC Flow](#9-named-pipe-ipc-flow)

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code / MCP Client                   │
│  browser_navigate({ url: "..." })                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                    stdio JSON-RPC
                         │
┌────────────────────────▼────────────────────────────────────┐
│               voice-mirror-mcp (Rust binary)                 │
│                                                              │
│  src-tauri/src/mcp/handlers/browser.rs                       │
│  Routes: pipe-based actions → PipeRouter                     │
│  Direct: browser_search, browser_fetch → reqwest             │
└────────────────────────┬────────────────────────────────────┘
                         │
                Named pipe (length-prefixed JSON)
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   Tauri Application                           │
│                                                              │
│  src-tauri/src/services/browser_bridge.rs                    │
│  +── handle_browser_action(action, args)                     │
│  │                                                           │
│  ├── navigate    → webview.navigate(url)                     │
│  ├── screenshot  → ICoreWebView2::CapturePreview → PNG      │
│  ├── snapshot    → ExecuteScript(SNAPSHOT_JS) → DOM tree     │
│  ├── act         → ExecuteScript(click/fill/press/eval/...)  │
│  ├── cookies     → ExecuteScript(document.cookie)            │
│  ├── storage     → ExecuteScript(localStorage/sessionStorage)│
│  ├── go_back     → webview.eval("history.back()")            │
│  ├── go_forward  → webview.eval("history.forward()")         │
│  ├── reload      → webview.eval("location.reload()")         │
│  ├── status      → LensState webview label + bounds          │
│  └── tabs        → single-tab model (returns active tab)     │
│                                                              │
│  Native WebView2 (Lens panel)                                │
│  +── ICoreWebView2::ExecuteScript  (JS eval with result)     │
│  +── ICoreWebView2::CapturePreview (screenshot to PNG)       │
└─────────────────────────────────────────────────────────────┘
```

### Key Differences from External Browser Control

Voice Mirror does NOT launch a separate Chrome process or use CDP/Playwright.
Instead, it uses the native Tauri WebView2 child window that renders the Lens
browser preview panel. This means:

- **Single-tab model**: There is one browser webview managed by the Lens panel.
  Tab management tools (`browser_close_tab`, `browser_focus`) are no-ops.
- **No CDP**: All interaction is via WebView2 COM APIs (`ExecuteScript`,
  `CapturePreview`) and Tauri's `webview.navigate()`.
- **Windows-only for screenshots/eval**: The `with_webview()` COM API access
  is only available on Windows. Other platforms get stub responses.
- **Webview must be active**: The Lens tab must be open for browser tools to
  work. `browser_start` checks this and returns guidance if not.

---

## 2. Browser Bridge

**Source**: `src-tauri/src/services/browser_bridge.rs`

The browser bridge is the central dispatcher for all webview-based browser
actions. It receives an action string and args JSON, resolves the active Lens
webview, and executes the appropriate operation.

### JavaScript Evaluation

For actions that need return values from JavaScript, the bridge uses the native
WebView2 `ICoreWebView2::ExecuteScript` COM API:

```rust
async fn evaluate_js_with_result(
    app: &AppHandle,
    webview: &tauri::Webview,
    js_expression: &str,
    timeout: Duration,
) -> Result<Value, String>
```

This bypasses Tauri's fire-and-forget `eval()` and provides direct access to
the JS evaluation result via a `ExecuteScriptCompletedHandler` callback routed
through a oneshot channel.

The result from `ExecuteScript` is a JSON-serialized string. The bridge parses
it back to `serde_json::Value`.

### String Escaping

All user-provided strings inserted into JS expressions are escaped via
`escape_js()` to prevent injection:

```rust
fn escape_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
```

---

## 3. MCP Browser Tools

**Source**: `src-tauri/src/mcp/tools.rs` (tool definitions), `src-tauri/src/mcp/handlers/browser.rs` (handlers)

All browser tools are registered in the `browser` tool group (16 tools total).
The group is loaded on demand or included in tool profiles like `voice-assistant`
and `web-browser`.

### Pipe-Based Tools (require active Lens webview)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `browser_start` | Check if the Lens browser webview is active | -- |
| `browser_stop` | Info: browser lifecycle is managed by Voice Mirror | -- |
| `browser_status` | Get webview active status and bounds | -- |
| `browser_tabs` | List tabs (returns single active tab) | -- |
| `browser_open` | Navigate to a URL (same as navigate for single-tab model) | `url` (required) |
| `browser_close_tab` | No-op (single-tab model) | `targetId` |
| `browser_focus` | No-op (single-tab model) | `targetId` |
| `browser_navigate` | Navigate the webview to a URL | `url` (required) |
| `browser_screenshot` | Capture a PNG screenshot of the page | `fullPage`, `ref` |
| `browser_snapshot` | Take a DOM tree snapshot of the page | `format`, `interactive`, `compact`, `selector` |
| `browser_act` | Execute an interaction on a page element | `request` (required): `{ kind, selector, ref, text, key, expression, ... }` |
| `browser_console` | Get console logs (not yet implemented) | -- |
| `browser_cookies` | Manage browser cookies via document.cookie | `action`: list, clear |
| `browser_storage` | Read/write localStorage or sessionStorage | `type`, `action`, `key`, `value` |

### Direct HTTP Tools (no webview needed)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `browser_search` | Search the web via DuckDuckGo Lite | `query` (required), `max_results` (default: 5, max: 10) |
| `browser_fetch` | Fetch and extract text content from a URL | `url` (required), `timeout`, `max_length` (default: 8000) |

### Timeouts

| Action Type | Timeout |
|-------------|---------|
| `screenshot`, `snapshot`, `act` | 60 seconds |
| All other pipe-based actions | 30 seconds |
| `browser_search` | 30 seconds |
| `browser_fetch` | Configurable (default 30s, max 60s) |

---

## 4. Browser Actions (via bridge)

### navigate / open

Navigates the Lens webview to a URL using Tauri's native `webview.navigate()`.
Emits a `lens-url-changed` event so the frontend URL bar updates.

```json
{ "url": "https://example.com" }
```

### act

Executes interactions on page elements via JavaScript injection. The `request`
object specifies the action kind and parameters.

#### Supported Action Kinds

| Kind | Parameters | Description |
|------|-----------|-------------|
| `click` | `selector` or `ref` | Click an element matching the CSS selector |
| `fill` / `type` | `selector` or `ref`, `text` or `value` | Set an input's value, dispatch input+change events |
| `key` / `press` | `key` | Dispatch keydown+keyup on the focused element |
| `evaluate` / `javascript` | `expression` | Eval arbitrary JavaScript in the page context |
| `scroll` | `x`, `y` | Scroll the window by (x, y) pixels |

Example: Click a button

```json
{
  "request": {
    "kind": "click",
    "selector": "#submit-button"
  }
}
```

Example: Fill a text field

```json
{
  "request": {
    "kind": "fill",
    "selector": "input[name='search']",
    "text": "hello world"
  }
}
```

Example: Evaluate JavaScript

```json
{
  "request": {
    "kind": "evaluate",
    "expression": "document.querySelectorAll('a').length"
  }
}
```

### go_back / go_forward / reload

Navigation history controls using `history.back()`, `history.forward()`, and
`location.reload()` via `webview.eval()`.

### status

Returns whether a browser webview is active and its bounds:

```json
{
  "active": true,
  "bounds": { "x": 100, "y": 50, "width": 800, "height": 600 }
}
```

### tabs

Returns the single active tab in the Lens panel (single-tab model):

```json
[{ "targetId": "lens-browser-xxxx", "type": "page", "active": true }]
```

---

## 5. Direct HTTP Tools

### browser_search

Searches the web using DuckDuckGo Lite's HTML interface via `reqwest`. Parses
result links from the HTML response (no JavaScript rendering).

Results are wrapped in `[UNTRUSTED WEB CONTENT]` markers to prevent prompt
injection from search results.

### browser_fetch

Fetches a URL via `reqwest` and returns the raw text content, truncated to
`max_length` (default 8000 characters). Follows up to 10 redirects.

Results are similarly wrapped in `[UNTRUSTED WEB CONTENT]` markers.

---

## 6. Snapshot System

**Source**: `src-tauri/src/services/browser_bridge.rs` (SNAPSHOT_JS constant)

The snapshot tool injects JavaScript that builds a lightweight DOM tree
representation of the page:

```js
function buildTree(el, depth) {
    // Max depth: 10
    // Captures: tag, role, aria-label, text content (first 100 chars)
    // Marks interactive elements: a, button, input, select, textarea
    // For interactive elements: captures href, type, value, placeholder
    // Returns tree structure as JSON
}
```

The snapshot returns:

```json
{
  "title": "Page Title",
  "url": "https://example.com/page",
  "tree": {
    "tag": "body",
    "children": [
      {
        "tag": "nav",
        "children": [
          { "tag": "a", "interactive": true, "text": "Home", "href": "/home" },
          { "tag": "button", "interactive": true, "label": "Menu" }
        ]
      },
      {
        "tag": "input",
        "interactive": true,
        "type": "text",
        "placeholder": "Search..."
      }
    ]
  }
}
```

**Note**: This is a simplified DOM snapshot, not a full accessibility tree.
Elements are filtered -- non-interactive nodes without text, labels, or
children are excluded.

---

## 7. Screenshot Capture

**Source**: `src-tauri/src/services/browser_bridge.rs` (`capture_screenshot_png`)

Screenshots use the native WebView2 `ICoreWebView2::CapturePreview` COM API:

1. Get the `ICoreWebView2` interface via `webview.with_webview()`.
2. Create an `IStream` on a global memory handle.
3. Call `CapturePreview(FORMAT_PNG, stream, handler)`.
4. In the completion handler, read the PNG bytes from the stream.
5. Base64-encode the PNG and return it.

The MCP handler (`browser.rs`) converts the base64 response into an MCP image
content block for direct display in Claude Code.

Page metadata (title, URL, dimensions) is also captured via a separate
`ExecuteScript` call and included in the response.

**Platform limitation**: Screenshot capture is only available on Windows via the
WebView2 COM API. Other platforms return an error suggesting the
`capture_screen` tool as a fallback.

---

## 8. Cookies and Storage

### Cookies

The `cookies` action uses `document.cookie` via JavaScript evaluation:

- **list**: Returns `document.cookie` string
- **clear**: Iterates over cookies and sets them with expired dates

Limitations: Only accessible cookies (not HttpOnly) can be read/set via JS.

### Storage

The `storage` action accesses `localStorage` or `sessionStorage`:

- **get**: `storage.getItem(key)`
- **set**: `storage.setItem(key, value)`
- **delete**: `storage.removeItem(key)`
- **clear**: `storage.clear()`

The storage type is whitelisted to prevent JS injection (only `localStorage`
and `sessionStorage` are accepted).

---

## 9. Named Pipe IPC Flow

Browser requests flow through the named pipe IPC system:

```
1. MCP tool called (e.g., browser_navigate)
   │
2. browser.rs: generate unique request_id (br-<timestamp>-<counter>)
   │
3. PipeRouter: register oneshot channel for response
   │
4. Send McpToApp::BrowserRequest { request_id, action, args }
   │  (via named pipe to Tauri app)
   │
5. Tauri pipe_server.rs: receive request, dispatch to browser_bridge
   │
6. browser_bridge.rs: handle_browser_action(action, args)
   │  (uses WebView2 APIs)
   │
7. Send AppToMcp::BrowserResponse { request_id, success, result, error }
   │  (via named pipe back to MCP binary)
   │
8. PipeRouter: match request_id, deliver to waiting oneshot channel
   │
9. browser.rs: receive response, convert to McpToolResult
```

The `PipeRouter` uses oneshot channels for browser responses (one-to-one
request/response mapping) and mpsc channels for user messages (one-to-many).
This prevents browser response waits from blocking user message delivery.

Request IDs use a timestamp + atomic counter format (`br-<millis>-<N>`) to
guarantee uniqueness even under concurrent requests.

---

## 10. Known Gaps

### Download Manager (RESOLVED)

WebView2 downloads are now fully handled. The `ICoreWebView2_4::add_DownloadStarting`
COM event is hooked in the browser bridge. Downloads proceed to the system Downloads
folder by default (`SetHandled(false)`), with progress tracked via
`ICoreWebView2DownloadOperation` events.

**Implemented:**
- `lens-download-started` Tauri event emitted when a download begins (DownloadEntry with id, filename, path, url, state)
- `lens-download-progress` Tauri event emitted on progress updates (received, total, state, path)
- `lens_get_downloads`, `lens_clear_downloads`, `lens_open_download`, `lens_open_download_folder` Tauri commands
- Frontend downloads store (`src/lib/stores/downloads.svelte.js`) with toast notification on completion
- Downloads panel (`src/components/lens/DownloadsPanel.svelte`) — hamburger menu overlay with progress bars
- `browser.downloadAskLocation` and `browser.downloadPath` config keys (Rust-side integration deferred)

**Browser hamburger menu features (all wired):**
- Zoom In / Out / Reset (with live percentage display)
- Find on Page (Ctrl+F)
- History panel (browser navigation history)
- Downloads panel (in-progress and completed downloads)
- Download Settings (navigates to app Settings)

### File Open Dialog (Plus Button Enhancement)

Future feature: allow opening local files (spreadsheets, documents) in the browser panel via localhost rendering. The "+" button could offer a file picker that opens the selected file in the Lens browser using Office Online, Google Docs URL, or a local viewer.
