# Voice Mirror Code Audit

Last updated: 2026-03-02

Systematic audit of duplication, file sizing, naming, and organization issues.
Work items are grouped by priority and area. Check items off as they're resolved.

---

## Frontend Duplication

### High Priority

- [x] **`path.split(/[/\\]/).pop()` basename extraction** (19 sites) — DONE (commit 36162901)
  - `basename(path)` in `src/lib/utils.js`, 19 call sites replaced across 12 files

- [x] **`projectStore.activeProject?.path || null`** (62 sites) — DONE (commit 50891dd4)
  - `get root()` getter on `projectStore`, 62 expressions replaced across 17 files

- [x] **`result?.data || result` API response unwrapping** (29 sites) — DONE (commit 87f64b83)
  - `unwrapResult(result, fallback)` in `src/lib/utils.js`, 29 patterns replaced across 20 files

- [x] **Context menu viewport clamping `$effect`** (7 sites) — DONE (commit 538b1a03)
  - `clampToViewport(el, pad)` in `src/lib/clamp-to-viewport.js`, 7 $effect blocks simplified

- [x] **Click-outside-to-close popup — Pattern B** (4 sites) — DONE (commit 91342997)
  - `setupClickOutside(el, onClose)` in `src/lib/popup-utils.js`, 4 capture-phase patterns replaced
  - Pattern A (setTimeout delay, 5 sites) left as-is due to variance in guards/events

- [ ] **`PROVIDER_NAMES` + `CLI_PROVIDERS` divergent copies** (correctness risk)
  - `providers.js` has 6 entries; `ai-status.svelte.js` has 11 entries with extra providers
  - `CLI_PROVIDERS` differs: `['claude', 'opencode']` vs `['claude', 'opencode', 'codex', 'gemini-cli', 'kimi-cli']`
  - Consolidate to single source of truth in `providers.js`

### Medium Priority

- [ ] **LSP severity normalization** (6+ sites)
  - Create `lspSeverityName(sev)` and `lspSeverityNum(sev)` helpers
  - Sites: `lsp-diagnostics.svelte.js` (2x), `ProblemsPanel.svelte` (4x), `TerminalTabs.svelte` (1x)
  - Currently inconsistent: `getTotals()` uses catch-all, `ProblemsPanel` enumerates explicitly

- [ ] **`formatTime` with 3 different semantics** (4 sites)
  - `utils.js:34` — locale time (`"2:34 PM"`)
  - `OutputPanel.svelte:41` — log time (`"HH:MM:SS"`)
  - `StatusBar.svelte:89` — relative time (`"3m ago"`)
  - `TerminalTabs.svelte:229` — inline, same as OutputPanel
  - Add `formatLogTime()` and `formatRelativeTime()` to `utils.js`

- [ ] **Duplicate `getTabIcon()`** (2 sites)
  - `TabBar.svelte:31-43` and `GroupTabBar.svelte:147-158` — identical
  - Move to `src/lib/tab-utils.js` or `file-icons.js`

- [ ] **Context menu CSS** (6+ components)
  - Nearly identical `.context-menu` / `.context-menu-item` CSS in: `TabContextMenu`, `FileContextMenu`, `ChatList`, `SessionPanel`, `ProjectStrip`, `TerminalTabs`
  - Extract to `src/styles/context-menu.css` or a shared `ContextMenu.svelte`

- [ ] **Copy full path to clipboard** (3 sites)
  - `FileContextMenu`, `EditorContextMenu`, `TabContextMenu` — identical path building + clipboard write
  - Add `copyFullPathToClipboard()` to `utils.js`

- [ ] **Diff tab badge CSS + markup** (2 sites)
  - `TabBar.svelte` and `GroupTabBar.svelte` — identical badge rendering + CSS
  - Extract `TabDiffBadge.svelte`

### Low Priority

- [ ] **Settings save try/catch/toast boilerplate** (5 settings components)
  - Same `saving` flag + try/catch + toast pattern in all settings panels
  - Create `saveSettings(patchFn, { successMsg, errorMsg })` wrapper

---

## Rust Backend Duplication

### High Priority

- [ ] **Git command execution pattern** (20+ repetitions in `commands/files/git.rs`)
  - Same `Command::new("git")` + args + `current_dir` + error handling
  - Extract `run_git(args, root) -> Result<Output, IpcResponse>`

- [ ] **LSP command preamble** (12 commands in `commands/lsp.rs`)
  - Same 10-line extension → lang_id → uri → lock pattern
  - Extract `resolve_lsp_context(path, root, state)` helper (~100 lines saved)

- [ ] **Time utilities duplicated** (`mcp/handlers/core.rs` + `memory.rs`)
  - `now_iso()`, `now_ms()`, `days_to_date()`, `date_to_days()`, `parse_iso_to_ms()` — identical in both files
  - Extract to `mcp/handlers/time_utils.rs`

### Medium Priority

- [ ] **`generate_request_id` + static counter** (3 files)
  - `browser.rs` ("br-"), `capture.rs` ("cap-"), `core.rs` ("logs-")
  - Single fn with prefix param in `handlers/mod.rs`

- [ ] **`require_pipe` helper** (2 files)
  - `browser.rs` and `capture.rs` — identical except error string
  - Move to `handlers/mod.rs` with `tool_category` param

- [ ] **`pipe_browser_request` / `pipe_capture_request`** (2 files)
  - Near-identical async pipe request pattern
  - Abstract with generic `pipe_request()` helper

- [ ] **Listener lock path + `get_mcp_data_dir`** (5 files)
  - `get_mcp_data_dir()` and `get_mcp_data_dir_for_env()` compute the same path
  - Single `get_listener_lock_path()` in `inbox_watcher.rs`

- [ ] **Screenshots dir setup** (4 commands in `screenshot.rs`)
  - Same dir creation + cleanup + filename pattern
  - Extract `prepare_screenshot_path() -> Result<PathBuf>`

- [ ] **`InboxMessage` struct defined twice**
  - `services/inbox_watcher.rs` (pub) and `mcp/handlers/core.rs` (private)
  - Binary split constraint — at minimum add cross-reference comments

### Low Priority

- [ ] **PNG → base64 data URL** (4 files)
  - `read_as_data_url` already exists in `screenshot.rs` but is private
  - Move to `util.rs` as public

- [ ] **`which`/`where` binary check** (2 files)
  - `providers/cli/mod.rs` and `commands/tools.rs`
  - Shared `find_binary_path()` in `util.rs`

---

## Large Files to Split

### High Priority (1000+ lines, multiple responsibilities)

- [ ] **`src-tauri/src/lsp/mod.rs`** (1809 lines)
  - Split into: `mod.rs` (struct + lifecycle), `requests.rs` (12 LSP request methods), `documents.rs` (open/close/change/save), `scanner.rs` (file collection)

- [ ] **`src-tauri/src/services/output.rs`** (1774 lines)
  - Split at `LogFileWriter` boundary → `output.rs` (~560 lines) + `log_file.rs` (~1200 lines)

- [ ] **`src/components/terminal/TerminalTabs.svelte`** (1328 lines)
  - Extract: `ProblemsFilterBar.svelte`, `VoiceAgentTabMenu.svelte`

- [ ] **`src/components/lens/GitCommitPanel.svelte`** (1170 lines)
  - Extract: `BranchPicker.svelte`, `RemoteSyncMenu.svelte`, `StashManager.svelte`

### Medium Priority

- [ ] **`src-tauri/src/services/browser_bridge.rs`** (1606 lines)
  - Extract screenshot capture section (~160 lines) to `browser_screenshot.rs`

- [ ] **`src-tauri/src/commands/screenshot.rs`** (1364 lines)
  - Extract `mod win32` (~800 lines) to `commands/screenshot_win32.rs`

- [ ] **`src/styles/settings.css`** (1706 lines)
  - Split into per-section CSS or migrate scoped blocks into `.svelte` files

- [ ] **`src/components/lens/FileTree.svelte`** (1053 lines)
  - Extract git status diffusion logic and drag-and-drop handlers

- [ ] **`src/components/lens/FileEditor.svelte`** (1174 lines)
  - Extract markdown preview (~100 lines), conflict detection (~60 lines)

---

## Naming Issues

- [ ] `StatusDropdown.svelte` → `SystemStatusPanel.svelte` (it's a multi-tab health panel)
- [ ] `LensPreview.svelte` → `LensBrowser.svelte` (manages full browser lifecycle)
- [ ] `Terminal.svelte` → `ShellTerminal.svelte` (ambiguous next to `AiTerminal.svelte`)
- [ ] `commands.svelte.js` → `command-registry.svelte.js` (it's the command palette registry)
- [ ] `cdp.rs` → `ax_tree.rs` (parses AX trees, doesn't dispatch CDP)
- [ ] `providers.js` → `provider-metadata.js` (static data, not provider logic)

---

## Directory Organization

- [ ] **`src/components/lens/`** (44 files flat) → create subdirs:
  - `editor/` — FileEditor, DiffViewer, EditorPane, EditorContextMenu
  - `file-tree/` — FileTree, FileTreeNode, FileContextMenu, GitChangesPanel
  - `git/` — GitCommitPanel
  - `lsp/` — OutlinePanel, ReferencesPanel, CodeActionsMenu, RenameInput, SignatureHelp, LspTab, ProblemsPanel
  - `browser/` — LensPreview, BrowserTabBar, DevicePreview, DevicePreviewStrip, DevicePickerMenu, DesignToolbar
  - `layout/` — GroupTabBar, TabBar, TabContextMenu, LensToolbar, LensWorkspace
  - `panels/` — OutputPanel, StatusDropdown, ServersTab, McpTab, SearchPanel, CommandPalette

- [ ] **`src/lib/`** (20 files flat) → group:
  - `lib/editor/` — editor-extensions, editor-git-gutter, editor-lsp, editor-theme, codemirror-languages
  - `lib/terminal/` — terminal-links, terminal-link-overlay, terminal-search
  - `lib/presets/` — avatar-presets, device-presets, orb-presets, voice-adapters
