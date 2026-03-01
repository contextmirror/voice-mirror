# Voice Mirror

Voice-controlled AI agent overlay for your desktop. Tauri 2 + Rust backend (STT/TTS/VAD/MCP) + Svelte 5 frontend.

## Rules

### Working Style

- **You are the expert -- act like it.** Always give recommendations. If you see a better approach, a potential bug, or a risk -- say so proactively.
- **Propose, don't just ask.** Instead of "what do you want?", say "I'd recommend X because Y. Want me to proceed?"
- **Use your resources.** The user has high usage limits. Spin up teams when tasks benefit -- coders, reviewers, testers. Quality matters more than token savings.
- **Always run `npm test` after making changes.** 3400+ tests catch structural regressions. Don't skip this.

### Session-Start Diagnostic Check

At the start of each session, **proactively read the runtime diagnostics log** to catch bugs the user may not have noticed:

1. Read `%APPDATA%/voice-mirror/logs/current/frontend.jsonl` (use `Read` tool)
2. Look for:
   - `ERROR` entries → crashes or unhandled exceptions since last session
   - `[UNHEALTHY]` entries → subsystems that reported health failures
   - `[AUDIT]` entries at `DEBUG` level → user interaction timeline (useful context)
3. If errors are found, **proactively report them** to the user: "I noticed X errors in the runtime log since last session. Want me to investigate?"
4. If the file doesn't exist or is empty, the app hasn't been run yet — skip silently.

This creates a closed loop: runtime errors are captured automatically → next Claude session reads them → bugs get found and fixed without the user needing to describe them.

### Development Workflow (SuperPowers Skills)

**Use the SuperPowers skill system for all development workflows.** SuperPowers provides structured skills for brainstorming, planning, TDD, parallel agents, code review, debugging, and verification. Invoke the relevant skill before starting work -- the skills enforce discipline and quality gates.

| Scale | When | Approach |
|-------|------|----------|
| **Large** | New features, new systems, large refactors, >5 files | `brainstorming` → `writing-plans` → `subagent-driven-development` or `dispatching-parallel-agents` → `requesting-code-review` → `verification-before-completion` |
| **Medium** | 3-5 files | `brainstorming` → `writing-plans` → implement → `verification-before-completion` |
| **Solo** | Bug fixes, small tweaks, <3 files | `systematic-debugging` (if bug) or direct fix → run tests |

**Key skills:**
- `superpowers:brainstorming` -- before any creative/feature work
- `superpowers:writing-plans` -- multi-step implementation planning
- `superpowers:test-driven-development` -- write tests before implementation
- `superpowers:subagent-driven-development` -- parallel agent execution
- `superpowers:using-git-worktrees` -- isolated feature branches
- `superpowers:systematic-debugging` -- structured bug investigation
- `superpowers:requesting-code-review` -- review completed work
- `superpowers:verification-before-completion` -- verify before claiming done

#### IDE Gap Tracker (Source of Truth)

**`docs/source-of-truth/IDE-GAPS.md`** is the single source of truth for what Voice Mirror's Lens workspace has vs what's missing compared to VS Code/Zed. It tracks every feature by category (Editor, Source Control, Diff, File Tree, Terminal, LSP) with status and priority.

**Mandatory updates:**
- **After implementing any feature** that appears in IDE-GAPS.md: move it to the Completed table, update the relevant category section (change ❌ to ✅), and update the "What We Have" tables.
- **During brainstorming**: read IDE-GAPS.md to see what gaps exist and their priorities before proposing new work.
- **During planning**: reference the ranked gap list when choosing what to build next.

#### Voice Mirror Wiring Checklist

When adding new features, always verify the full wiring chain:

- Rust command registered in `lib.rs` `.invoke_handler()` chain?
- API wrapper exists in `api.js` with correct `invoke()` call?
- Store exports are present and named correctly?
- Component imports resolve to existing files/exports?
- Config schema fields added to `schema.rs` if needed?
- Tauri events registered if used?
- Health contract registered in `src/lib/health-contracts.js` + name added to `EXPECTED_SUBSYSTEMS` in `diagnostics.svelte.js`?

**Data flow trace** for each new user-facing feature:
> User action → Component handler → API wrapper → `invoke()` → Rust command → Backend logic → Response → Frontend state update → UI render

Every arrow must be verified by reading the actual code at both ends.

#### Logging & Output Channels

All Rust backend logging uses `tracing` (`info!`, `warn!`, `error!`, `debug!`, `trace!`). Logs are automatically routed to Output panel channels based on module path:

| Module path prefix | Output Channel |
|-------------------|----------------|
| `providers::cli`, `providers::manager` | **CLI Provider** |
| `voice::` | **Voice Pipeline** |
| `mcp::` | **MCP Server** |
| `services::browser` | **Browser Bridge** |
| Everything else | **App** |

**When adding new features:**
- Just use `tracing::info!()` etc. in your Rust code -- routing is automatic
- If adding a **major new subsystem** (not a submodule of an existing one), consider adding a new `Channel` variant in `src-tauri/src/services/output.rs`
- The `get_logs` MCP tool lets Claude Code query these logs programmatically
- **Terminal Claude Code** (outside the app) can use `get_logs` via JSONL file fallback -- no pipe needed. The Tauri app writes logs to `%APPDATA%/voice-mirror/logs/current/{channel}.jsonl` and the MCP binary reads them directly from disk. Always use this to diagnose issues.
- Session logs rotate on app startup (keeps last 5 sessions)
- Debug Mode toggle (Settings → Advanced) controls whether DEBUG/TRACE entries are captured

**Project Output Channels (dynamic):**

When the user is building a project in Lens (e.g., a Discord clone, a portfolio site), dynamic project channels capture that project's build logs and runtime errors. This gives Claude full debugging visibility without the user needing to copy-paste terminal output or describe console errors.

- **Created automatically** when a dev server starts via `dev-server-manager.svelte.js`
- **Channel naming:** `{folderName} ({framework} :{port})` -- e.g., `contextmirror.com (Astro :4321)`
- **Two data sources merged into one channel:**
  - **Build logs:** Dev server terminal PTY stdout is mirrored (ANSI-stripped, level-classified)
  - **Runtime logs:** Browser console output (log/warn/error/info/debug) captured via `lens-console://` URI scheme
- **Query via MCP:** `get_logs` with no channel lists project channels; `get_logs` with `channel="contextmirror.com (Astro :4321)"` returns project logs. Works on both pipe and file fallback paths.
- **Proactive debugging:** When working on a user's project, use `get_logs` to check for build errors and runtime exceptions. You can spot issues (React hook errors, missing routes, type errors) before the user notices them.
- **Output panel UI:** Project channels appear above a separator in the dropdown, system channels below. Error badge shows on Output tab when project has errors.
- **Key files:** `services/output.rs` (ProjectChannel registry), `commands/output.rs` (4 Tauri commands), `ipc/pipe_server.rs` (pipe get_logs), `output.svelte.js` (store), `dev-server-manager.svelte.js` (lifecycle)

### Runtime Diagnostics

Three-layer self-diagnostic system for catching bugs Claude Code can read:

- **Layer 1 (Error Capture):** `window.onerror`, `window.onunhandledrejection`, and `console.error/warn` intercepts in `main.js` forward to `Frontend` output channel → `%APPDATA%/voice-mirror/logs/current/frontend.jsonl`
- **Layer 2 (Health Monitors):** Subsystems register health contracts in `src/lib/health-contracts.js`. Central `diagnostics.svelte.js` store runs checks every 30s and logs unhealthy states. Meta-check catches missing contracts.
- **Layer 3 (Interaction Audit):** Key user actions are logged at DEBUG level with `[AUDIT]` prefix via `src/lib/audit-log.js`. Provides timeline for debugging.

**When adding new subsystems:** Register a health contract in `health-contracts.js` and add the subsystem name to `EXPECTED_SUBSYSTEMS` in `diagnostics.svelte.js`.

### Git Workflow

- Work on `dev` or `feature/*` branches. Only merge to `main` when the user explicitly says to.
- Push after commits. Don't push to `main` directly.

### Release Workflow

Releases follow a 3-step process:

1. **Develop on `dev`/`feature/*`** -- commit all changes here
2. **Merge to `main`** -- `git checkout main && git merge dev --no-ff && git checkout dev`
   - This triggers `ci.yml` (Rust checks, clippy, tests on Ubuntu + cross-platform builds)
3. **Tag and push** -- `git tag vX.Y.Z && git push origin main vX.Y.Z`
   - This triggers `release.yml` which builds on Windows/macOS/Linux
   - Creates a GitHub Release with installers
   - Tauri updater checks GitHub Releases for auto-updates

**Version numbering:**
- **Patch** (0.1.0 -> 0.1.1): bugfixes, small improvements
- **Minor** (0.1.x -> 0.2.0): new features
- **Major** (0.x -> 1.0): breaking changes

Remember to bump `version` in both `package.json` and `src-tauri/tauri.conf.json` before tagging.

### CI & GitHub Actions

- **`ci.yml`** -- push to main + PRs. Runs cargo check, clippy, cargo test, npm test, and Tauri build on all platforms.
- **`release.yml`** -- tag push (`v*`) + manual dispatch. Builds Tauri app, creates GitHub Release.
- **`codeql.yml`** -- SAST for JS/TS. Weekly + push/PR to main.
- **`scorecard.yml`** -- OpenSSF supply chain security. Weekly + push to main.
- **All GitHub Action versions are pinned to commit SHAs** for supply chain security. When updating, pin to the full SHA with a `# vX` comment.
- **Skip CI for trivial changes.** Add `[skip ci]` to commit messages for docs-only or config-only changes.

### Technical Rules

- **Svelte 5 runes:** `$state`, `$derived`, `$effect`, `$props` only work in `.svelte` and `.svelte.js`/`.svelte.ts` files. Plain `.js` files are NOT processed by the Svelte compiler.
- **Store files using runes** MUST be named `*.svelte.js` (e.g. `config.svelte.js`).
- **Frameless Tauri windows:** Interactive overlays need `-webkit-app-region: no-drag` and `z-index: 10001` (above resize edges).
- **When moving files, update ALL relative paths.** CSS `url()` resolves relative to the CSS file.
- **Never remove "unused" code without tracing all callers.** Check for dynamic `import()` and string-based references.
- **Empty string is falsy in JS -- use explicit checks.** `if (response)` fails for `''`. Use `response !== null` or `response.length > 0`.
- **Tauri commands** return `Result<T, String>` in Rust, surfaced via `invoke()` in the frontend.

## Quick Reference

```bash
npm install          # install frontend dependencies
npm run dev          # Tauri dev mode with hot reload (also rebuilds MCP binary)
npm run build        # build production Tauri app (also rebuilds MCP binary)
npm test             # run all JS tests (node:test, 4400+ tests)
npm run test:rust    # run Rust tests (cd src-tauri && cargo test)
npm run test:all     # run both JS and Rust tests
npm run check        # Svelte type checking
```

**Note:** `npm run dev` and `npm run build` automatically rebuild `voice-mirror-mcp` binary first via `cargo build --bin voice-mirror-mcp`.

## Architecture

```
Tauri 2 desktop app (transparent, always-on-top, frameless)
  |
  +-- Rust backend (src-tauri/)
  |     Commands: 131 commands across 15 modules (AI, chat, config, design,
  |               dev_server, files, lens, LSP, output, screenshot, shortcuts,
  |               terminal, tools, voice, window)
  |     Voice: STT (Whisper), TTS (Kokoro/Edge/Piper), VAD
  |     MCP server: 50 tools, 5 groups (native Rust binary, stdio JSON-RPC)
  |     Providers: CLI PTY (Claude Code, OpenCode) + API (OpenAI-compatible)
  |     IPC: Named pipe (length-prefixed JSON) between MCP binary and Tauri app
  |     Services: browser bridge, file watcher, inbox watcher, input hook,
  |               logger, platform, text injector, dev server
  |
  +-- Svelte 5 frontend (src/)
  |     Components: 80 .svelte files across 7 directories
  |     Stores: 22 reactive stores (*.svelte.js)
  |     Libraries: 13 utility modules (api.js with 116 invoke wrappers)
  |     Styles: design tokens + 9 CSS modules
  |
  +-- Vite build system
        Dev server on port 1420, ghostty-web WASM for terminal
```

### MCP Binary Architecture

The MCP server is a separate Rust binary (`voice-mirror-mcp`) in the same Cargo crate:
- **`src-tauri/src/bin/mcp.rs`** -- binary entry point (reads env vars, connects pipe, calls `run_server()`)
- **`src-tauri/src/mcp/server.rs`** -- JSON-RPC protocol handler (stdin/stdout, tool dispatch)
- **`src-tauri/src/mcp/tools.rs`** -- tool registry (50 tools, 5 groups, dynamic load/unload)
- **`src-tauri/src/mcp/pipe_router.rs`** -- concurrent pipe message routing (oneshot for browser responses, mpsc for user messages)
- **`src-tauri/src/mcp/handlers/`** -- 5 handler modules (core, memory, browser, n8n, capture)

Communication flow: `Claude Code ↔ stdio JSON-RPC ↔ voice-mirror-mcp ↔ named pipe ↔ Tauri app`

**Stale binary pitfall:** `tauri dev` does NOT rebuild the MCP binary -- only the Tauri app binary. The `npm run dev` script handles this, but if you run `tauri dev` directly, you get a stale MCP binary. Serde silently drops unknown fields, so new features vanish without errors.

### IPC (Named Pipe)

- **Protocol:** Length-prefixed JSON frames over Windows named pipes
- **`protocol.rs`** defines `McpToApp` and `AppToMcp` message enums
- **`pipe_server.rs`** (Tauri side) dispatches incoming requests to handlers
- **`pipe_client.rs`** (MCP side) connects and sends/receives frames
- **`pipe_router.rs`** (MCP side) routes responses to waiters by `request_id`

### Browser Bridge

MCP browser tools route through the named pipe to the Tauri app's native WebView2:
- **`services/browser_bridge.rs`** -- dispatches browser actions (navigate, click, fill, screenshot, snapshot, evaluate JS)
- **`lens-bridge` URI scheme** -- workaround for Tauri 2's fire-and-forget `eval()`: JS calls `fetch('lens-bridge://...')` to return values, Tauri routes results via `BridgeState`
- Direct HTTP tools (`browser_search`, `browser_fetch`) use `reqwest` without the pipe

## Key Conventions

- **Tests:** `node:test` + `node:assert/strict`, source-inspection style (read file text, assert patterns exist). No Jest, no Mocha, no external test frameworks.
- **Config:** `src/lib/stores/config.svelte.js` has `DEFAULT_CONFIG`, backed by Tauri IPC to Rust persistence layer.
- **Theme system:** 8 built-in presets + custom themes, default is 'colorblind'. All presets require 10 color keys (bg, bgElevated, text, textStrong, muted, accent, ok, warn, danger, orbCore) + 2 font keys.
- **Commit style:** conventional commits (feat:, fix:, chore:, docs:, refactor:, test:, security:).
- **Tauri commands:** defined in `src-tauri/src/commands/*.rs`, invoked via `src/lib/api.js` wrappers (116 functions).
- **MCP tool responses:** return `{ ok: boolean, action: string, result?: any, error?: string }`.
- **Logging:** Rust uses `tracing` crate. MCP binary logs to stderr (stdout is JSON-RPC). Frontend uses `console.*`.

## File Layout

### Frontend (src/)

| Path | Purpose |
|------|---------|
| `src/App.svelte` | Root component |
| `src/main.js` | Entry point |
| `src/components/chat/` | Chat panel, messages, input |
| `src/components/lens/` | 23 components: workspace, file editor, file tree, tabs, preview, toolbar, context menus, command palette, diff viewer, outline, references, browser tabs, design toolbar |
| `src/components/overlay/` | Always-on-top overlay, orb |
| `src/components/settings/` | Settings panels + appearance sub-panels |
| `src/components/shared/` | Reusable: SplitPanel, ResizeEdges, etc. |
| `src/components/sidebar/` | Navigation sidebar |
| `src/components/terminal/` | Terminal system: AiTerminal (AI provider), Terminal (user terminals), TerminalTabs (3-tab outer strip), TerminalPanel (VS Code-style inner panel), TerminalTabStrip (group tabs), TerminalSidebar (instance tree), TerminalActionBar (+ dropdown, overflow), TerminalContextMenu (right-click), TerminalColorPicker, TerminalIconPicker |
| `src/lib/stores/` | 22 Svelte 5 reactive stores (*.svelte.js) |
| `src/lib/api.js` | 116 Tauri invoke() wrappers -- all frontend-to-backend communication |
| `src/lib/utils.js` | Shared utilities (deepMerge, formatTime, uid) |
| `src/lib/editor-theme.js` | CodeMirror theme (Voice Mirror custom) |
| `src/lib/editor-lsp.svelte.js` | LSP integration for CodeMirror editor |
| `src/lib/file-icons.js` | File type icon mapping |
| `src/lib/markdown.js` | Markdown rendering with DOMPurify |
| `src/lib/orb-presets.js` | Orb animation preset system |
| `src/lib/providers.js` | AI provider definitions |
| `src/lib/voice-adapters.js` | Voice engine adapters |
| `src/styles/` | 9 CSS files (base, tokens, animations, panel, sidebar, settings, terminal, notifications, orb) |
| `src/assets/` | Provider icons (SVG + WebP), file-icons sprite (MIT from OpenCode) |

### Backend (src-tauri/)

| Path | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | Tauri app setup, plugin registration, command registration, lens-bridge URI scheme |
| `src-tauri/src/bin/mcp.rs` | MCP binary entry point |
| `src-tauri/src/commands/` | 15 command modules (131 total commands) |
| `src-tauri/src/config/` | Schema, persistence (atomic writes), Electron migration |
| `src-tauri/src/providers/` | AI providers: API HTTP, dictation, manager, tool calling |
| `src-tauri/src/lsp/` | LSP client, server management (manifest, detection, installer), JSON-RPC protocol, types |
| `src-tauri/src/voice/` | Voice pipeline (STT, TTS, VAD) |
| `src-tauri/src/mcp/` | MCP server, tool registry (50 tools, 5 groups), handlers (5 modules), pipe router |
| `src-tauri/src/ipc/` | Named pipe IPC (protocol, server, client) |
| `src-tauri/src/services/` | 8 services: browser bridge, file watcher, inbox watcher, input hook, logger, platform, text injector, dev server |
| `src-tauri/tauri.conf.json` | App config (frameless, transparent, 900x800, native-ml features) |
| `src-tauri/Cargo.toml` | Rust dependencies |

### Tests (test/)

| Path | Purpose |
|------|---------|
| `test/unit/` | Direct-import tests for pure JS functions (.mjs) |
| `test/stores/` | Source-inspection tests for Svelte stores (.cjs) |
| `test/api/` | Source-inspection tests for API invoke wrappers (.cjs) |
| `test/components/` | Source-inspection tests for Svelte components (.cjs) |
| `test/lib/` | Source-inspection tests for lib utilities (.cjs) |

### Docs (docs/)

| Path | Purpose |
|------|---------|
| `docs/source-of-truth/` | Living decision docs: IDE gaps, UX audit, architecture, browser control, LSP design |
| `docs/guides/` | User-facing docs: getting started, configuration, voice pipeline, theme system |
| `docs/plans/` | Brainstorming designs and implementation plans for upcoming work |
| `docs/archive/` | Historical designs, completed plans, research (terminal gap analysis, MCP servers, etc.) |

## Reference Repos

Cloned locally for reference (read-only, not modified):

| Path | Repo | Purpose |
|------|------|---------|
| `E:\Projects\references\OpenCode Desktop\` | `anomalyco/opencode` | Tauri 2 + Solid.js desktop app. File icons SVG sprite adapted from here (MIT). |
| `E:\Projects\references\OpenCode Terminal\` | `opencode-ai/opencode` | Go + Bubble Tea terminal TUI. |
| `E:\Projects\references\VSCode\` | `microsoft/vscode` | Electron + TypeScript editor. |
| `E:\Projects\ghostty-web\` | `contextmirror/ghostty-web` | Our fork of `coder/ghostty-web`. WASM VT100 parser + TS renderer. |

## Config System

- `src/lib/stores/config.svelte.js` manages reactive config with `DEFAULT_CONFIG` defaults
- Rust backend at `src-tauri/src/config/` handles persistence (atomic writes: temp + rename)
- Config stored in platform app data directory (`~/.config/voice-mirror` or equivalent)
- Frontend sends patches via `invoke('set_config', { patch })`, backend merges and persists
- Schema defined in `src-tauri/src/config/schema.rs` with serde `camelCase` rename

## Testing Pattern

Two testing approaches based on module type:

**Pure JS functions** (.mjs tests) -- direct ES module import:
```js
import { deepMerge } from '../../src/lib/utils.js';
it('merges objects', () => {
    assert.deepStrictEqual(deepMerge({a:1}, {b:2}), {a:1, b:2});
});
```

**Svelte stores/components** (.cjs tests) -- source-inspection (runes can't run in Node.js):
```js
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/stores/config.svelte.js'), 'utf-8');
it('exports configStore', () => {
    assert.ok(src.includes('export const configStore'));
});
```

**Rust tests:** `cargo test --bin voice-mirror-mcp` for MCP binary tests. `cargo test --lib` fails on Windows due to WebView2 DLL issues in test harness -- use `cargo check --tests` for compilation verification.

## Active Work: Lens Workspace

The **Lens** tab is a multi-panel workspace (like VS Code/OpenCode Desktop). It contains: Chat (left) + Live Preview/Browser (center) + File Tree (right) + Terminal (bottom) + Action Bar (top).

**Key docs to read before working on Lens:**
- `docs/source-of-truth/LSP-DESIGN.md` -- LSP integration plan
- `docs/source-of-truth/BROWSER-CONTROL.md` -- browser control via native WebView2 bridge

**Lens components (23 files):**
- `LensWorkspace.svelte` -- layout orchestrator (SplitPanel nesting)
- `LensToolbar.svelte` -- browser URL bar (back/forward/refresh/URL)
- `LensPreview.svelte` -- native Tauri child webview container
- `FileEditor.svelte` -- CodeMirror 6 editor (JS, TS, Rust, CSS, HTML, JSON, Markdown, Python)
- `FileTree.svelte` -- project file browser
- `TabBar.svelte` -- editor tab strip
- `TabContextMenu.svelte` -- tab right-click menu
- `FileContextMenu.svelte` -- file tree right-click menu
- `EditorContextMenu.svelte` -- editor right-click menu
- `CommandPalette.svelte` -- Ctrl+P file search
- `DiffViewer.svelte` -- file diff viewer
- `DiffMinimap.svelte` -- diff minimap sidebar
- `DiffToolbar.svelte` -- diff toolbar controls
- `StatusDropdown.svelte` -- status bar dropdown
- `OutlinePanel.svelte` -- document symbol outline (LSP)
- `ReferencesPanel.svelte` -- find references panel (LSP)
- `CodeActionsMenu.svelte` -- code actions menu (LSP)
- `RenameInput.svelte` -- inline rename input (LSP)
- `BrowserTabBar.svelte` -- browser tab strip
- `DesignToolbar.svelte` -- design toolbar
- `McpTab.svelte` -- MCP server status tab
- `LspTab.svelte` -- LSP server status tab
- `ServersTab.svelte` -- server management tab

**Supporting stores:**
- `lens.svelte.js` -- lens navigation state
- `tabs.svelte.js` -- editor tab management
- `project.svelte.js` -- project path + file tree
- `terminal-tabs.svelte.js` -- terminal tab management
- `terminal-profiles.svelte.js` -- terminal profile detection and management
- `browser-tabs.svelte.js` -- browser tab management
- `dev-server-manager.svelte.js` -- dev server detection and management
- `lsp-diagnostics.svelte.js` -- LSP diagnostic state

**Native webview gotcha:** The browser preview is a native WebView2 child window positioned via absolute pixel coordinates -- it renders ABOVE all DOM elements. Panel resizing must sync bounds via ResizeObserver. The 6px margins on `.workspace-content` prevent it from covering the ResizeEdges handles.

### File Editor Features

- **CodeMirror 6** with lazy-loaded language support (JS, TS, Rust, CSS, HTML/Svelte, JSON, Markdown, Python)
- **Custom theme** (`editor-theme.js`) synced with Voice Mirror's theme system
- **Autocomplete** enabled with `activateOnTyping: true`
- **Dirty tracking** with conflict detection (file-changed-on-disk banner)
- **Go-to-definition** navigation with external file support (read-only mode)
- **Context menu** with gutter fallback (CodeMirror's `domEventHandlers` don't cover gutter/tooltip DOM layers)
- **LSP integration** (Tier 1 implemented) -- see `docs/source-of-truth/LSP-DESIGN.md`
- **LSP server management** -- manifest-driven registry (`lsp-servers.json`, 5 servers: Svelte, TS, CSS, HTML, JSON), npm auto-install to `%APPDATA%/voice-mirror/lsp-servers/`, `initializationOptions` + `workspace/configuration` from manifest, user overrides via `lspServers` config field

## Common Pitfalls

- **Svelte 5 runes** (`$state`, `$effect`, `$derived`) only work in `.svelte` and `.svelte.js` files. A store in plain `.js` will throw `ReferenceError`.
- **ghostty-web** WASM file is gitignored and downloaded/copied at build time via the Vite plugin in `vite.config.js`.
- **ES modules in Svelte stores** can't be imported in Node.js tests -- use the source-inspection pattern.
- **Theme presets** require all 10 color keys + 2 font keys. Missing keys break `deriveTheme()`.
- **Tauri command names** use snake_case in Rust (`get_config`) and are invoked as snake_case strings from JS too (`invoke('get_config')`). The `api.js` file wraps all 116 commands.
- **Voice engine** features (`whisper`, `onnx`) are behind Cargo feature flags. Default builds exclude them; production builds use `native-ml` feature.
- **Config migration** from Electron is handled in `src-tauri/src/config/migration.rs` -- reads old Electron config on first launch.
- **MCP binary staleness:** `tauri dev` does NOT rebuild `voice-mirror-mcp`. Always use `npm run dev` which rebuilds it first. Serde silently drops unknown fields, making stale binaries lose features without errors.
- **Cargo test on Windows:** `cargo test --lib` fails with `STATUS_ENTRYPOINT_NOT_FOUND` (WebView2 DLL issue). Use `cargo check --tests` for compilation verification and `cargo test --bin voice-mirror-mcp` for MCP tests.
- **Named pipe concurrent recv:** The MCP binary can receive both `BrowserResponse` and `UserMessage` on the same pipe. `PipeRouter` dispatches these to separate channels (oneshot vs mpsc) to avoid blocking.
