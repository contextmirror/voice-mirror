# electron/services/

Electron main-process services. Each service is a self-contained module
that manages one concern (logging, AI, voice backend, etc.).

## Conventions

**Factory pattern** -- most services export a `createXxx()` function that
accepts an options object and returns a plain object with methods:

```js
const svc = createFooService({ dataDir, log });
svc.start();          // begin work
svc.stop();           // tear down
svc.isRunning();      // boolean
```

**Singletons** -- a few modules (logger, uiohook-shared, diagnostic-collector,
diagnostic-watcher) export functions directly because they keep global state.

**Orchestration** -- all services are created and wired together in
`electron/main.js`. See the "Service Initialization Order" comment at the
top of that file for the exact startup sequence.

## Service index

| Module | Factory / Export | Description |
|---|---|---|
| `logger.js` | `createLogger()` | File + console logger with color-coded categories |
| `ai-manager.js` | `createAIManager()` | Manages Claude Code PTY and OpenAI-compatible providers |
| `python-backend.js` | `createPythonBackend()` | Spawns/manages Python subprocess (STT, TTS, VAD) |
| `hotkey-manager.js` | `createHotkeyManager()` | Dual-layer hotkeys: uiohook-napi + Electron globalShortcut |
| `uiohook-shared.js` | singleton | Shared uiohook-napi instance with health monitoring |
| `screen-capture-watcher.js` | `createScreenCaptureWatcher()` | Watches for MCP screen-capture requests and fulfills them |
| `browser-watcher.js` | `createBrowserWatcher()` | Watches for MCP browser requests (search, fetch, webview) |
| `inbox-watcher.js` | `createInboxWatcher()` | Watches MCP inbox for messages; routes to non-Claude providers |
| `perf-monitor.js` | `createPerfMonitor()` | Samples CPU/memory every 3 s, sends to renderer, logs CSV |
| `update-checker.js` | `createUpdateChecker()` | Git-based update checker (compares HEAD vs origin/main) |
| `wayland-orb.js` | `createWaylandOrb()` | Native Rust layer-shell overlay orb (Linux/Wayland only) |
| `provider-detector.js` | `providerDetector()` | Auto-detects running LLM servers and API keys |
| `diagnostic-watcher.js` | `start()` / `stop()` | Watches for pipeline-trace requests from MCP |
| `diagnostic-collector.js` | singleton | Accumulates pipeline trace data across stages |
| `platform-paths.js` | `getDataDir()` | Cross-platform data directory resolution |
| `font-manager.js` | `init()` / `addFont()` / ... | Manages user-uploaded custom fonts (TTF, OTF, WOFF, WOFF2) |
