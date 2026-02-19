# Browser Control Architecture Reference

> Deep-dive into Clawdbot's browser control system, reverse-engineered from source.
> This document serves as the implementation spec for Voice Mirror's browser control feature.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Chrome Launch & Profile System](#chrome-launch--profile-system)
4. [CDP (Chrome DevTools Protocol) Layer](#cdp-chrome-devtools-protocol-layer)
5. [Playwright Session Management](#playwright-session-management)
6. [Snapshot System](#snapshot-system)
7. [Role Reference System](#role-reference-system)
8. [Action Execution](#action-execution)
9. [Extension Relay](#extension-relay)
10. [Chrome Extension](#chrome-extension)
11. [Configuration & Profiles](#configuration--profiles)
12. [Server Context & Tab Management](#server-context--tab-management)
13. [Agent Tool Schema](#agent-tool-schema)
14. [Implementation Plan for Voice Mirror](#implementation-plan-for-voice-mirror)

---

## System Overview

Clawdbot's browser system gives an AI agent full control of a web browser through two modes:

1. **Managed browser ("clawd")** - Launches an isolated Chromium instance owned by the agent
2. **Extension relay ("chrome")** - Attaches to the user's existing browser tabs via a Chrome extension

The agent interacts through a pipeline:

```
Agent request (e.g., "click Submit button")
  → Tool resolver (action + params)
    → Control server (HTTP API)
      → Profile context (tab resolution)
        → Playwright (persistent CDP session)
          → Browser (actual DOM interaction)
```

### Key Source Files (Clawdbot)

| File | Lines | Purpose |
|------|-------|---------|
| `src/browser/cdp.ts` | 425 | Raw CDP protocol: screenshot, eval, ARIA/DOM snapshot, querySelector |
| `src/browser/cdp.helpers.ts` | ~150 | WebSocket management, auth headers, URL normalization |
| `src/browser/chrome.ts` | 321 | Chrome launch, lifecycle, executable detection |
| `src/browser/chrome.executables.ts` | 416 | Browser discovery (Win/Mac/Linux) |
| `src/browser/chrome.profile-decoration.ts` | 207 | Profile color/prefs |
| `src/browser/extension-relay.ts` | 672 | WebSocket relay server for Chrome extension |
| `src/browser/pw-session.ts` | 533 | Playwright persistent sessions, page state, role ref caching |
| `src/browser/pw-tools-core.snapshot.ts` | 206 | Snapshot generation (ARIA, AI, role) |
| `src/browser/pw-tools-core.interactions.ts` | 531 | All actions: click, type, drag, hover, fill, wait, evaluate, screenshot |
| `src/browser/pw-role-snapshot.ts` | 368 | Role ref parsing, building, stats |
| `src/browser/config.ts` | 275 | Config parsing, profile resolution |
| `src/browser/server-context.ts` | 634 | Profile-scoped operations (tabs, launch, relay) |
| `src/agents/tools/browser-tool.schema.ts` | 115 | TypeBox schema for all browser actions |
| `assets/chrome-extension/background.js` | 439 | Extension service worker |
| `assets/chrome-extension/manifest.json` | 26 | Manifest v3 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent / Voice                         │
│  "Click submit" → browser.act({ kind: "click", ref: "e1" })│
└────────────────────────┬────────────────────────────────────┘
                         │
                    HTTP REST API
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   Control Server                             │
│  Routes: /tabs, /snapshot, /screenshot, /act, /navigate      │
│  Profile resolution: clawd | chrome | remote                 │
└────────────────────────┬────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
    ┌─────────▼──────────┐  ┌──────▼──────────────┐
    │  Managed Browser   │  │  Extension Relay     │
    │  (clawd profile)   │  │  (chrome profile)    │
    │                    │  │                      │
    │  Chrome launched   │  │  WebSocket server    │
    │  with CDP port     │  │  ↕ Chrome Extension  │
    │  --remote-debug    │  │  ↕ CDP bridge        │
    └─────────┬──────────┘  └──────┬──────────────┘
              │                     │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │    Playwright       │
              │  connectOverCDP()   │
              │  Persistent session │
              │  Page state cache   │
              │  Role ref LRU (50)  │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Browser Actions    │
              │  click, type, drag  │
              │  snapshot, screenshot│
              │  navigate, evaluate │
              └─────────────────────┘
```

---

## Chrome Launch & Profile System

### How Chrome is Launched (`chrome.ts`)

```javascript
// Key launch arguments
const args = [
  `--remote-debugging-port=${cdpPort}`,  // CDP port for control
  `--user-data-dir=${userDataDir}`,       // Isolated profile directory
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-features=Translate,MediaRouter',
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--password-store=basic',
  // Linux-specific:
  '--disable-dev-shm-usage',
  // Optional:
  '--headless=new',      // if headless mode
  '--no-sandbox',        // if noSandbox
  'about:blank'          // Always open a blank tab
];

const proc = spawn(executablePath, args, { stdio: 'pipe' });
```

### Profile Bootstrap Flow

1. Check if profile directory exists (`~/.clawdbot/browser/<profileName>/user-data`)
2. If first run: spawn Chrome briefly to create `Local State` + `Preferences` files, then kill it
3. Decorate profile (color tint, clean-exit prefs)
4. Spawn Chrome for real
5. Poll `http://127.0.0.1:<cdpPort>/json/version` for up to 15 seconds
6. Verify WebSocket connectivity

### Browser Executable Detection

Searches in order: **Chrome → Brave → Edge → Chromium** across platform-specific paths.

### CDP Readiness Check

```javascript
// Two-step check:
// 1. HTTP: GET /json/version → extract webSocketDebuggerUrl
// 2. WebSocket: Open connection to confirm WS is alive
async function isChromeCdpReady(cdpUrl, timeoutMs, handshakeTimeoutMs) {
  const wsUrl = await getChromeWebSocketUrl(cdpUrl, timeoutMs);
  if (!wsUrl) return false;
  return await canOpenWebSocket(wsUrl, handshakeTimeoutMs);
}
```

---

## CDP (Chrome DevTools Protocol) Layer

### Raw CDP Functions (`cdp.ts`)

All functions use `withCdpSocket()` which opens a raw WebSocket to the CDP endpoint:

#### Screenshot

```javascript
async function captureScreenshot({ wsUrl, fullPage, format, quality }) {
  return await withCdpSocket(wsUrl, async (send) => {
    await send('Page.enable');

    let clip;
    if (fullPage) {
      const metrics = await send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize ?? metrics.contentSize;
      clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
    }

    const result = await send('Page.captureScreenshot', {
      format: format ?? 'png',
      quality,             // jpeg only, 0-100
      fromSurface: true,
      captureBeyondViewport: true,
      ...(clip ? { clip } : {}),
    });
    return Buffer.from(result.data, 'base64');
  });
}
```

#### JavaScript Evaluation

```javascript
async function evaluateJavaScript({ wsUrl, expression, awaitPromise, returnByValue }) {
  return await withCdpSocket(wsUrl, async (send) => {
    await send('Runtime.enable');
    return await send('Runtime.evaluate', {
      expression,
      awaitPromise: Boolean(awaitPromise),
      returnByValue: returnByValue ?? true,
      userGesture: true,
      includeCommandLineAPI: true,
    });
  });
}
```

#### ARIA Snapshot (via CDP)

```javascript
async function snapshotAria({ wsUrl, limit }) {
  return await withCdpSocket(wsUrl, async (send) => {
    await send('Accessibility.enable');
    const res = await send('Accessibility.getFullAXTree');
    return { nodes: formatAriaSnapshot(res.nodes, limit) }; // max 2000 nodes
  });
}
```

The ARIA tree is walked depth-first, producing nodes like:
```javascript
{ ref: 'ax1', role: 'button', name: 'Submit', depth: 2 }
```

#### DOM Snapshot (via Runtime.evaluate)

Injects JavaScript that walks `document.documentElement`, capturing up to 800 nodes:
```javascript
{ ref: 'n1', tag: 'div', id: 'app', role: 'main', text: '...', depth: 0 }
```

#### Create Tab (via CDP)

```javascript
async function createTargetViaCdp({ cdpUrl, url }) {
  const version = await fetchJson(`${cdpUrl}/json/version`);
  const wsUrl = normalizeCdpWsUrl(version.webSocketDebuggerUrl, cdpUrl);
  return await withCdpSocket(wsUrl, async (send) => {
    return await send('Target.createTarget', { url });
    // Returns: { targetId: '...' }
  });
}
```

---

## Playwright Session Management

### Persistent Connection (`pw-session.ts`)

A single cached `Browser` instance is maintained per CDP URL:

```javascript
let cached = null;   // { browser: Browser, cdpUrl: string }
let connecting = null; // Promise

async function connectBrowser(cdpUrl) {
  if (cached?.cdpUrl === cdpUrl) return cached;

  // Retry up to 3 times with increasing timeouts
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeout = 5000 + attempt * 2000;
    const wsUrl = await getChromeWebSocketUrl(cdpUrl, timeout);
    const browser = await chromium.connectOverCDP(wsUrl ?? cdpUrl, { timeout, headers });
    cached = { browser, cdpUrl };

    browser.on('disconnected', () => {
      if (cached?.browser === browser) cached = null;
    });
    return cached;
  }
}
```

### Page State Tracking

Every Page gets a state object tracking console messages, errors, network requests, and role refs:

```javascript
type PageState = {
  console: BrowserConsoleMessage[];    // Last 500
  errors: BrowserPageError[];          // Last 200
  requests: BrowserNetworkRequest[];   // Last 500
  roleRefs?: Record<string, RoleRef>; // e1, e2, etc.
  roleRefsMode?: 'role' | 'aria';
  roleRefsFrameSelector?: string;
};
```

Event listeners are installed once per page:
- `page.on('console', ...)` - log messages
- `page.on('pageerror', ...)` - uncaught exceptions
- `page.on('request', ...)` / `page.on('response', ...)` - network activity

### Page-to-Target Resolution

```javascript
async function getPageForTargetId({ cdpUrl, targetId }) {
  const { browser } = await connectBrowser(cdpUrl);
  const pages = browser.contexts().flatMap(c => c.pages());

  if (!targetId) return pages[0]; // Default to first page

  // Match by CDP targetId
  for (const page of pages) {
    const session = await page.context().newCDPSession(page);
    const info = await session.send('Target.getTargetInfo');
    if (info.targetInfo.targetId === targetId) return page;
  }

  // Fallback: if only one page, use it
  if (pages.length === 1) return pages[0];
  throw new Error('tab not found');
}
```

---

## Snapshot System

Three snapshot formats serve different purposes:

### 1. ARIA Snapshot

Raw accessibility tree via CDP `Accessibility.getFullAXTree`:

```
ax1: RootWebArea "My Page" (depth 0)
ax2: banner (depth 1)
ax3: navigation (depth 2)
ax4: link "Home" (depth 3)
ax5: button "Menu" (depth 3)
```

### 2. AI Snapshot

Playwright's internal `page._snapshotForAI()` - optimized XML-like format for LLMs:

```javascript
const result = await page._snapshotForAI({ timeout: 5000, track: 'response' });
// result.full contains the AI-optimized page representation
```

### 3. Role Snapshot (primary format for agent interaction)

Built from ARIA snapshot, generates `e1, e2, ...` refs:

```
- navigation
  - link "Home" [ref=e1]
  - link "About" [ref=e2]
  - button "Menu" [ref=e3]
- main
  - heading "Welcome" [ref=e4]
  - textbox "Search" [ref=e5]
  - button "Submit" [ref=e6]
```

#### Building Role Snapshots (`pw-role-snapshot.ts`)

```javascript
function buildRoleSnapshotFromAriaSnapshot(ariaSnapshot, options) {
  const lines = ariaSnapshot.split('\n');
  const refs = {};
  let counter = 0;

  for (const line of lines) {
    // Parse: "  - button "Submit" ..."
    const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
    const role = match[2].toLowerCase();
    const name = match[3];

    // Only ref interactive elements
    if (INTERACTIVE_ROLES.has(role)) {
      counter++;
      const ref = `e${counter}`;
      refs[ref] = { role, name, nth };
      // Output: '- button "Submit" [ref=e6]'
    }
  }

  return { snapshot, refs };
}
```

#### Interactive Roles (get refs)

```javascript
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio',
  'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'searchbox', 'slider',
  'spinbutton', 'switch', 'tab', 'treeitem',
]);
```

#### Snapshot Options

```javascript
type RoleSnapshotOptions = {
  interactive?: boolean;  // Only interactive elements (flat list)
  maxDepth?: number;      // Tree depth limit
  compact?: boolean;      // Remove unnamed structural elements
};
```

---

## Role Reference System

### How Refs Work

1. Agent requests a snapshot
2. System generates `e1, e2, ...` refs for interactive elements
3. Refs are cached in `PageState` AND in an LRU map (`roleRefsByTarget`, max 50 entries)
4. Agent uses refs in actions: `{ kind: "click", ref: "e3" }`
5. `refLocator()` resolves the ref to a Playwright locator

### Ref Resolution (`pw-session.ts`)

```javascript
function refLocator(page, ref) {
  // Normalize: "@e1" → "e1", "ref=e1" → "e1"
  const normalized = ref.replace(/^@|^ref=/, '');

  if (/^e\d+$/.test(normalized)) {
    const state = pageStates.get(page);

    // Mode "aria": use Playwright's built-in aria-ref
    if (state?.roleRefsMode === 'aria') {
      return page.locator(`aria-ref=${normalized}`);
    }

    // Mode "role": use getByRole with cached role+name
    const info = state?.roleRefs?.[normalized];
    if (!info) throw new Error(`Unknown ref "${normalized}". Run a new snapshot.`);

    const locator = info.name
      ? page.getByRole(info.role, { name: info.name, exact: true })
      : page.getByRole(info.role);

    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  // Fallback: raw aria-ref
  return page.locator(`aria-ref=${normalized}`);
}
```

### Ref Caching

Refs are cached at two levels:
1. **Page-level**: `pageStates WeakMap<Page, PageState>` (cleared on page close)
2. **Target-level**: `roleRefsByTarget Map` keyed by `${cdpUrl}::${targetId}` (LRU, max 50)

When Playwright returns a different `Page` object for the same target, `restoreRoleRefsForTarget()` copies cached refs back:

```javascript
function restoreRoleRefsForTarget({ cdpUrl, targetId, page }) {
  const cached = roleRefsByTarget.get(`${cdpUrl}::${targetId}`);
  if (!cached) return;
  const state = ensurePageState(page);
  if (state.roleRefs) return; // Already has refs
  state.roleRefs = cached.refs;
  state.roleRefsMode = cached.mode;
}
```

---

## Action Execution

### All Supported Actions (`pw-tools-core.interactions.ts`)

Every action follows the same pattern:
1. Get page via `getPageForTargetId()`
2. Initialize page state via `ensurePageState()`
3. Restore cached refs via `restoreRoleRefsForTarget()`
4. Resolve ref to locator via `refLocator()`
5. Execute Playwright action
6. Wrap errors with `toAIFriendlyError()`

#### Click

```javascript
async function clickViaPlaywright({ cdpUrl, targetId, ref, doubleClick, button, modifiers, timeoutMs }) {
  const page = await getPageForTargetId({ cdpUrl, targetId });
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl, targetId, page });

  const locator = refLocator(page, ref);
  const timeout = clamp(timeoutMs ?? 8000, 500, 60000);

  if (doubleClick) {
    await locator.dblclick({ timeout, button, modifiers });
  } else {
    await locator.click({ timeout, button, modifiers });
  }
}
```

#### Type / Fill

```javascript
async function typeViaPlaywright({ cdpUrl, targetId, ref, text, submit, slowly, timeoutMs }) {
  const locator = refLocator(page, ref);

  if (slowly) {
    await locator.click({ timeout });       // Focus first
    await locator.type(text, { delay: 75 }); // Character by character
  } else {
    await locator.fill(text, { timeout });   // Instant fill
  }

  if (submit) {
    await locator.press('Enter', { timeout });
  }
}
```

#### Fill Form (multiple fields)

```javascript
async function fillFormViaPlaywright({ cdpUrl, targetId, fields, timeoutMs }) {
  for (const field of fields) {
    const locator = refLocator(page, field.ref);

    if (field.type === 'checkbox' || field.type === 'radio') {
      await locator.setChecked(Boolean(field.value), { timeout });
    } else {
      await locator.fill(String(field.value), { timeout });
    }
  }
}
```

#### Other Actions

| Action | Method | Key Details |
|--------|--------|-------------|
| **hover** | `locator.hover()` | 8s default timeout |
| **drag** | `locator.dragTo(endLocator)` | Two refs: startRef, endRef |
| **select** | `locator.selectOption(values)` | Array of option values |
| **press** | `page.keyboard.press(key)` | Global keyboard, no ref needed |
| **evaluate** | `page.evaluate(fn)` or `locator.evaluate(fn, ref)` | Arbitrary JS |
| **wait** | Various | text/textGone/selector/url/loadState/fn/timeMs |
| **resize** | `page.setViewportSize()` | width + height |
| **screenshot** | `page.screenshot()` or `locator.screenshot()` | Optional ref/element/fullPage |
| **navigate** | `page.goto(url)` | 20s default timeout |
| **upload** | `locator.setInputFiles(paths)` | Dispatches input+change events |
| **scrollIntoView** | `locator.scrollIntoViewIfNeeded()` | 20s default timeout |

#### Screenshot with Labels

A special function overlays orange `e1, e2, ...` labels on elements before taking a screenshot:

```javascript
async function screenshotWithLabelsViaPlaywright({ cdpUrl, targetId, refs, maxLabels, type }) {
  // 1. Get bounding boxes for all refs (max 150)
  // 2. Filter to visible-in-viewport elements
  // 3. Inject overlay DOM: orange boxes + ref labels
  // 4. Take screenshot
  // 5. Remove overlay DOM (cleanup)
  return { buffer, labels: count, skipped: count };
}
```

---

## Extension Relay

### Architecture (`extension-relay.ts`, 672 lines)

```
┌──────────────────┐     WebSocket      ┌──────────────────┐
│ Chrome Extension │ ──── /extension ──→ │  Relay Server    │
│ (background.js)  │ ←── CDP events ──── │  (Node.js HTTP)  │
└──────────────────┘                     │                  │
                                         │  WebSocket       │
┌──────────────────┐     /cdp           │  /cdp endpoint   │
│ Playwright /     │ ←──────────────────→│                  │
│ Agent            │     CDP commands    │  HTTP REST       │
└──────────────────┘                     │  /json/version   │
                                         │  /json/list      │
                                         │  /json/activate  │
                                         │  /json/close     │
                                         └──────────────────┘
```

### Relay Server Implementation

The relay creates an HTTP server with two WebSocket endpoints:

```javascript
async function ensureChromeExtensionRelayServer({ cdpUrl }) {
  // Parse cdpUrl, verify loopback
  // Create HTTP server with REST endpoints
  // Create two WebSocket servers (noServer mode):
  //   /extension - single connection from Chrome extension
  //   /cdp       - multiple connections from agents/Playwright

  server.on('upgrade', (req, socket, head) => {
    // Only allow loopback connections
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    if (pathname === '/extension') {
      if (extensionWs) { rejectUpgrade(socket, 409, 'Already connected'); return; }
      wssExtension.handleUpgrade(req, socket, head, ws => { ... });
    }

    if (pathname === '/cdp') {
      if (!extensionWs) { rejectUpgrade(socket, 503, 'Extension not connected'); return; }
      wssCdp.handleUpgrade(req, socket, head, ws => { ... });
    }
  });
}
```

### CDP Command Routing

When a CDP client sends a command, the relay either handles it locally or forwards to the extension:

```javascript
async function routeCdpCommand(cmd) {
  switch (cmd.method) {
    case 'Browser.getVersion':
      return { product: 'Chrome/Extension-Relay', ... };

    case 'Target.setAutoAttach':
    case 'Target.setDiscoverTargets':
      return {}; // No-op, relay manages targets

    case 'Target.getTargets':
      return { targetInfos: Array.from(connectedTargets.values()).map(t => t.targetInfo) };

    case 'Target.attachToTarget':
      // Find in connectedTargets map by targetId
      return { sessionId: target.sessionId };

    default:
      // Forward everything else to extension
      return await sendToExtension({
        id: nextId++,
        method: 'forwardCDPCommand',
        params: { method: cmd.method, sessionId: cmd.sessionId, params: cmd.params },
      });
  }
}
```

### Target Tracking

The relay maintains a `connectedTargets` map:

```javascript
const connectedTargets = new Map(); // sessionId → { sessionId, targetId, targetInfo }

// Updated when extension sends:
// - Target.attachedToTarget → add/update target
// - Target.detachedFromTarget → remove target
// - Target.targetInfoChanged → update URL/title metadata
```

### REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /` | GET/HEAD | Health check |
| `GET /extension/status` | GET | `{ connected: boolean }` |
| `GET /json/version` | GET | CDP version info (includes `webSocketDebuggerUrl` if extension connected) |
| `GET /json/list` | GET | List connected targets with metadata |
| `GET/PUT /json/activate/<targetId>` | GET/PUT | Focus tab |
| `GET/PUT /json/close/<targetId>` | GET/PUT | Close tab |

### Message Protocol

```javascript
// Extension → Relay (events)
{ method: 'forwardCDPEvent', params: { method, sessionId, params } }
{ method: 'pong' }

// Extension → Relay (responses to commands)
{ id: number, result?: any, error?: string }

// Relay → Extension (commands)
{ id: number, method: 'forwardCDPCommand', params: { method, sessionId, params } }
{ method: 'ping' }

// Relay → CDP clients (events, broadcast)
{ method: 'Target.attachedToTarget', params: { sessionId, targetInfo } }
{ method: 'Target.detachedFromTarget', params: { sessionId, targetId } }
// Plus all forwarded CDP events
```

---

## Chrome Extension

### Manifest (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "Browser Relay",
  "version": "0.1.0",
  "permissions": ["debugger", "tabs", "activeTab", "storage"],
  "host_permissions": ["http://127.0.0.1/*", "http://localhost/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "Browser Relay (click to attach/detach)" },
  "options_ui": { "page": "options.html", "open_in_tab": true }
}
```

### Key: `debugger` Permission

This is the critical permission. It allows `chrome.debugger.attach()` which gives full CDP access to a tab.

### Extension Lifecycle (`background.js`)

**Click handler** (toggle attach/detach):
```javascript
chrome.action.onClicked.addListener(() => {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tabs.has(active.id) && tabs.get(active.id).state === 'connected') {
    await detachTab(active.id, 'toggle');
  } else {
    await ensureRelayConnection();
    await attachTab(active.id);
  }
});
```

**Attach flow**:
```javascript
async function attachTab(tabId) {
  // 1. Attach Chrome debugger
  await chrome.debugger.attach({ tabId }, '1.3');
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

  // 2. Get target info
  const info = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo');
  const targetId = info.targetInfo.targetId;

  // 3. Create session ID
  const sessionId = `cb-tab-${nextSession++}`;
  tabs.set(tabId, { state: 'connected', sessionId, targetId });

  // 4. Notify relay
  sendToRelay({
    method: 'forwardCDPEvent',
    params: {
      method: 'Target.attachedToTarget',
      params: { sessionId, targetInfo: { ...info.targetInfo, attached: true } },
    },
  });

  setBadge(tabId, 'on'); // Orange badge
}
```

**Command forwarding** (relay → extension → Chrome debugger):
```javascript
async function handleForwardCdpCommand(msg) {
  const { method, params, sessionId } = msg.params;

  // Find tab by sessionId or targetId
  const tabId = resolveTabId(sessionId, params?.targetId);

  // Special cases
  if (method === 'Target.createTarget') {
    const tab = await chrome.tabs.create({ url: params.url, active: false });
    const attached = await attachTab(tab.id);
    return { targetId: attached.targetId };
  }

  if (method === 'Target.closeTarget') {
    await chrome.tabs.remove(tabId);
    return { success: true };
  }

  if (method === 'Target.activateTarget') {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return {};
  }

  // Default: forward via chrome.debugger
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}
```

**Event forwarding** (Chrome debugger → relay):
```javascript
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tab = tabs.get(source.tabId);
  if (!tab?.sessionId) return;

  sendToRelay({
    method: 'forwardCDPEvent',
    params: { sessionId: tab.sessionId, method, params },
  });
});
```

### Badge States

| State | Text | Color | Meaning |
|-------|------|-------|---------|
| Off | (empty) | - | Not attached |
| On | `ON` | Orange | Attached and working |
| Connecting | `…` | Yellow | Connecting to relay |
| Error | `!` | Red | Connection failed |

### Relay Connection

```javascript
async function ensureRelayConnection() {
  const port = await getRelayPort(); // From chrome.storage.local, default 18792

  // Preflight: HEAD http://127.0.0.1:<port>/
  await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });

  // Connect WebSocket
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  // 5s connect timeout
  // Set up message/close/error handlers

  // Install debugger listeners (once)
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);
}
```

---

## Configuration & Profiles

### Config Structure (`config.ts`)

```javascript
// In ~/.clawdbot/moltbot.json
{
  browser: {
    enabled: true,
    controlUrl: 'http://127.0.0.1:18791',
    defaultProfile: 'chrome',  // or 'clawd'
    color: '#FF4500',
    headless: false,
    noSandbox: false,
    attachOnly: false,
    executablePath: '/usr/bin/google-chrome',  // optional override
    remoteCdpTimeoutMs: 1500,
    remoteCdpHandshakeTimeoutMs: 3000,
    profiles: {
      clawd: {
        cdpPort: 18800,
        color: '#FF4500'
      },
      chrome: {
        driver: 'extension',
        cdpUrl: 'http://127.0.0.1:18792',
        color: '#00AA00'
      }
    }
  }
}
```

### Port Derivation

```
Gateway port (e.g., 18790)
  → Control port = Gateway + 1 = 18791
    → Extension relay port = Control + 1 = 18792
    → Profile CDP ports start at: Control + 10 = 18801
```

### Profile Types

| Type | Driver | How it works |
|------|--------|-------------|
| **Managed** | `clawd` | Launches isolated Chrome, owns CDP port |
| **Extension** | `extension` | Relay server on cdpUrl, Chrome extension bridges |
| **Remote** | `clawd` | Non-loopback cdpUrl, no local launch |

### Resolved Profile

```typescript
type ResolvedBrowserProfile = {
  name: string;           // 'clawd', 'chrome', 'work', etc.
  cdpPort: number;        // 18800
  cdpUrl: string;         // 'http://127.0.0.1:18800'
  cdpHost: string;        // '127.0.0.1'
  cdpIsLoopback: boolean; // true
  color: string;          // '#FF4500'
  driver: 'clawd' | 'extension';
};
```

---

## Server Context & Tab Management

### Profile Context (`server-context.ts`)

Each profile gets a context object with these operations:

```javascript
const ctx = {
  profile,                    // ResolvedBrowserProfile
  ensureBrowserAvailable(),   // Launch/connect browser
  ensureTabAvailable(targetId), // Find or create a tab
  isReachable(timeoutMs),     // CDP WebSocket check
  isHttpReachable(timeoutMs), // HTTP /json/version check
  listTabs(),                 // List all tabs
  openTab(url),               // Create new tab
  focusTab(targetId),         // Bring tab to front
  closeTab(targetId),         // Close tab
  stopRunningBrowser(),       // Kill browser process
  resetProfile(),             // Delete profile data
};
```

### Tab Listing

Two strategies depending on profile type:

```javascript
async function listTabs() {
  if (!profile.cdpIsLoopback) {
    // Remote: use Playwright persistent connection
    return await listPagesViaPlaywright({ cdpUrl: profile.cdpUrl });
  }

  // Local: use CDP REST endpoint
  const raw = await fetch(`${profile.cdpUrl}/json/list`);
  return raw.map(t => ({
    targetId: t.id,
    title: t.title,
    url: t.url,
    wsUrl: t.webSocketDebuggerUrl,
    type: t.type,
  }));
}
```

### Tab Creation (with fallbacks)

```javascript
async function openTab(url) {
  // Try 1: CDP Target.createTarget via WebSocket
  const created = await createTargetViaCdp({ cdpUrl, url });
  if (created) return waitForTabInList(created.targetId);

  // Try 2: HTTP PUT /json/new?url=...
  const tab = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return tab;
}
```

### Browser Availability (extension profile)

```javascript
async function ensureBrowserAvailable() {
  if (profile.driver === 'extension') {
    if (!await isHttpReachable()) {
      // Start relay server if not running
      await ensureChromeExtensionRelayServer({ cdpUrl: profile.cdpUrl });
    }
    if (!await isReachable()) {
      // Relay is up but no tab attached
      throw new Error('Click the extension icon on a tab to attach it.');
    }
    return;
  }

  // Managed: launch Chrome if not running
  if (!await isHttpReachable()) {
    const launched = await launchClawdChrome(config, profile);
    attachRunning(launched);
  }
}
```

---

## Agent Tool Schema

### Actions (`browser-tool.schema.ts`)

```typescript
const BROWSER_TOOL_ACTIONS = [
  'status',      // Check browser status
  'start',       // Start browser
  'stop',        // Stop browser
  'profiles',    // List profiles
  'tabs',        // List tabs
  'open',        // Open new tab
  'focus',       // Focus tab
  'close',       // Close tab
  'snapshot',    // Take page snapshot
  'screenshot',  // Take screenshot
  'navigate',    // Go to URL
  'console',     // Get console logs
  'pdf',         // Export as PDF
  'upload',      // Upload file
  'dialog',      // Handle dialog
  'act',         // Execute interaction
];

const BROWSER_ACT_KINDS = [
  'click',       // Click element
  'type',        // Type into input
  'press',       // Press keyboard key
  'hover',       // Hover over element
  'drag',        // Drag from A to B
  'select',      // Select dropdown option
  'fill',        // Fill multiple form fields
  'resize',      // Resize viewport
  'wait',        // Wait for condition
  'evaluate',    // Run JavaScript
  'close',       // Close page
];
```

### Full Tool Schema

```typescript
{
  action: 'status' | 'start' | 'stop' | 'profiles' | 'tabs' | 'open' | 'focus' |
          'close' | 'snapshot' | 'screenshot' | 'navigate' | 'console' | 'pdf' |
          'upload' | 'dialog' | 'act',
  profile?: string,          // Profile name
  targetId?: string,         // Tab target ID
  targetUrl?: string,        // URL for open/navigate
  // Snapshot options
  snapshotFormat?: 'aria' | 'ai',
  refs?: 'role' | 'aria',
  interactive?: boolean,
  compact?: boolean,
  depth?: number,
  selector?: string,
  frame?: string,
  limit?: number,
  maxChars?: number,
  // Screenshot options
  fullPage?: boolean,
  type?: 'png' | 'jpeg',
  labels?: boolean,
  ref?: string,
  element?: string,
  // Act sub-schema
  request?: {
    kind: 'click' | 'type' | 'press' | 'hover' | 'drag' | 'select' | 'fill' |
          'resize' | 'wait' | 'evaluate' | 'close',
    ref?: string,
    text?: string,           // type
    submit?: boolean,        // type
    slowly?: boolean,        // type
    key?: string,            // press
    doubleClick?: boolean,   // click
    button?: string,         // click
    modifiers?: string[],    // click
    startRef?: string,       // drag
    endRef?: string,         // drag
    values?: string[],       // select
    fields?: object[],       // fill
    width?: number,          // resize
    height?: number,         // resize
    timeMs?: number,         // wait
    textGone?: string,       // wait
    fn?: string,             // evaluate
  }
}
```

---

## Implementation Plan for Voice Mirror

### What Voice Mirror Has Today

- Headless Playwright for web search + fetch (no tab control)
- `desktopCapturer` screenshots (desktop, not browser pages)
- File-based IPC with MCP server
- No CDP, no snapshots, no interactions, no extension

### Phase 1: CDP + Tab Control

**Goal**: Launch a managed Chromium instance and control tabs.

**New files to create**:
```
electron/browser/
  cdp-client.js          # Raw CDP WebSocket: screenshot, eval, createTarget
  chrome-launcher.js     # Launch Chrome with --remote-debugging-port
  browser-controller.js  # Tab management: list, open, close, focus
```

**New MCP tools**:
```
browser_start      - Launch managed browser
browser_stop       - Stop browser
browser_tabs       - List open tabs
browser_open       - Open URL in new tab
browser_close      - Close tab by targetId
browser_focus      - Focus tab
browser_navigate   - Navigate tab to URL
browser_screenshot - Screenshot of browser page (not desktop)
```

**Key implementation details**:
- Use `child_process.spawn` to launch Chrome with `--remote-debugging-port=19222`
- User data dir at `~/.voice-mirror/browser/default/user-data`
- Poll `/json/version` for readiness
- Connect Playwright via `chromium.connectOverCDP()`
- Use persistent cached connection (singleton pattern)

### Phase 2: Snapshots + Actions

**Goal**: Enable the agent to "see" and interact with web pages.

**New files**:
```
electron/browser/
  snapshot.js          # ARIA + role snapshot generation
  role-refs.js         # e1/e2 ref system with caching
  actions.js           # click, type, hover, drag, fill, wait, evaluate
```

**New MCP tools**:
```
browser_snapshot   - Get page snapshot (role format with refs)
browser_act        - Execute action: click/type/hover/drag/select/fill/press/wait/evaluate
```

**Key implementation details**:
- Port `buildRoleSnapshotFromAriaSnapshot()` - parse ARIA tree, assign `e1, e2, ...` refs
- Port `refLocator()` - resolve refs to Playwright `getByRole()` locators
- Cache refs in a Map keyed by `cdpUrl::targetId` (LRU 50)
- All actions: get page → ensure state → restore refs → resolve locator → execute

### Phase 3: Extension Relay

**Goal**: Control the user's actual browser tabs, not just a headless instance.

**New files**:
```
electron/browser/
  extension-relay.js   # WebSocket relay server (Node.js)
chrome-extension/      # New directory at project root
  manifest.json
  background.js
  options.html
  icons/
```

**Key implementation details**:
- Relay server: HTTP + two WebSocket endpoints (`/extension`, `/cdp`)
- Extension: Manifest v3, `debugger` permission, click-to-attach
- CDP command routing: some handled locally (Target.*), rest forwarded
- Single extension connection enforced
- Loopback-only security

### Phase 4: Voice Integration

**Goal**: Natural voice commands for browser control.

**Voice command mappings**:
```
"Open Google"           → browser_open({ url: 'https://google.com' })
"Click the search box"  → browser_snapshot() → find textbox → browser_act({ kind: 'click', ref })
"Type hello world"      → browser_act({ kind: 'type', ref: lastFocused, text: 'hello world' })
"Go back"               → browser_act({ kind: 'press', key: 'Alt+ArrowLeft' })
"What's on the page?"   → browser_snapshot() → describe to user via TTS
"Scroll down"           → browser_act({ kind: 'press', key: 'PageDown' })
"Take a screenshot"     → browser_screenshot() → send to vision model → describe
"Close this tab"        → browser_close({ targetId: current })
"Search for flights"    → browser_open({ url: 'google.com' }) → type → click
```

**Integration points**:
- MCP tools registered in `mcp-server/index.js`
- Voice commands parsed by LLM (Claude/Ollama) which decides tool calls
- Results spoken back via TTS
- Screen context: snapshot descriptions fed back as conversation context

---

## Key Design Decisions to Replicate

1. **Persistent Playwright connection** - Don't connect/disconnect per request. Cache the Browser instance.

2. **Role refs (e1, e2, ...)** - This is what makes agent interaction practical. CSS selectors are too brittle.

3. **Two-level ref caching** - Page-level WeakMap + target-level LRU Map. Refs survive page reconnections.

4. **Extension relay as CDP proxy** - The relay speaks standard CDP protocol, so Playwright connects to it identically to a real Chrome instance.

5. **Graceful fallbacks** - Tab creation: CDP createTarget → /json/new. Tab listing: Playwright → /json/list. Always have a backup path.

6. **AI-friendly errors** - Wrap Playwright errors into messages the LLM can act on ("element not found, run a new snapshot").

7. **Loopback security** - Relay only accepts connections from 127.0.0.1. Treat CDP URLs as secrets.

---

*Reference source: `/home/nayballs/Project/clawdbot/src/browser/` (January 2026)*
*Target project: Voice Mirror Electron*
*Author: Nathan + Claude*
