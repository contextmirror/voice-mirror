# IDE Gap Analysis — Voice Mirror Lens vs Real IDEs

> Internal doc. Tracks what Voice Mirror's Lens workspace has vs what VS Code / Zed / Cursor offer.
>
> Last updated: 2026-02-28

---

## Current Status: "Capable Editor with AI Terminal"

Someone **can** code in Lens today. The core loop works:

1. Open project in file tree
2. Open files in tabs (CodeMirror 6 editor)
3. Edit with syntax highlighting, autocomplete, LSP diagnostics
4. Save with Ctrl+S
5. Open a shell tab, run `npm test` or `cargo build`
6. See git changes, open diffs
7. AI terminal (Claude Code) is always available for voice-driven development

What's missing is everything that makes a "real IDE" feel seamless — the gaps below.

---

## Feature Comparison

| Feature | VS Code | Zed | Voice Mirror | Status |
|---------|---------|-----|-------------|--------|
| Editor (syntax, save) | Full | Full | Full | **Feature Compete** |
| LSP (diagnostics, hover, completion) | Full (29/29) | Full (26/29) | 14/29 features | See LSP table below |
| Go-to-definition | Full | Full | Full | **Feature Compete** |
| Find references | Full | Full | Full | **Feature Compete** |
| Rename symbol | Full | Full | Full | **Feature Compete** |
| Code actions | Full | Full | Full | **Feature Compete** |
| Document outline | Full | Full | Full | **Feature Compete** |
| Git status + diff | Full | Full | Stage/Commit/Push/Pull + AI | Minor gaps — see §11-13 |
| Global text search | Full | Full | Full | **Feature Compete** |
| Split editor | Full (40+ commands) | Full | 20+ features, drag-to-split (file + tab) + seam splits | **Feature Compete** |
| Multi-cursor | Full | Full | Full | **Feature Compete** |
| Debug adapter (DAP) | Full | Partial | None | Low priority |
| Extensions/plugins | Massive | Growing | None | Not planned |
| Command palette (commands) | Full | Full | 48 commands, 4 modes, MRU | **Feature Compete** |
| Terminal | Full | Partial | Rich (tabs, splits, search, links, persistence) | Minor gaps — see §14 |
| Minimap | Full | Full | Full (@replit/codemirror-minimap + diff minimap) | **Feature Compete** |
| Status bar | Full | Full | Full (git, diagnostics, cursor, language, encoding, EOL, LSP, dev server) | **Feature Compete** |
| Notifications | Full | Full | Full (toast system + notification center + bell) | **Feature Compete** |
| Breadcrumbs | Full | Full | None | Low |
| Find & replace (in file) | Full | Full | Full | **Feature Compete** |

> **Feature Compete** = Voice Mirror's implementation is close to or better than VS Code for real-world usage. May lack niche/power-user commands, but the core workflows work. Users won't feel like something is "missing."

---

## LSP Feature Comparison

> Detailed comparison of Language Server Protocol support. Voice Mirror implements core LSP (Tier 1). VS Code and Zed implement nearly everything.
> Data sourced from reference repos: `E:\Projects\references\VSCode\` and `E:\Projects\references\Zed\`.

| LSP Feature | VS Code | Zed | Cursor | Voice Mirror | Priority |
|-------------|---------|-----|--------|-------------|----------|
| **Core (Tier 0 — baseline)** | | | | | |
| Diagnostics (errors/warnings) | Full | Full | Full | Full | Done |
| Completions | Full (resolve + snippets) | Full (resolve + snippets) | Full | Basic (no resolve/snippets) | Low |
| Hover tooltips | Full (markdown, grace period) | Full (markdown, keyboard grace) | Full | Full | Done |
| Go-to-definition | Full | Full | Full | Full | Done |
| Document sync (open/change/save/close) | Full | Full | Full | Full (full sync, not incremental) | Done |
| **Navigation (Tier 1 — shipped)** | | | | | |
| Find all references | Full | Full (multi-server) | Full | Full | Done |
| Rename symbol | Full (prepare + workspace edit) | Full (prepare) | Full | Full (prepare + multi-file) | Done |
| Code actions / quick fixes | Full (resolve + filtering) | Full (resolve + filtering) | Full | Basic (no resolve) | Low |
| Document symbols / outline | Full | Full (+ tree-sitter fallback) | Full | Full | Done |
| Document highlight | Full | Full | Full | None | Low |
| **Navigation (Tier 2 — not implemented)** | | | | | |
| Type definition | Full | Full | Full | None | Low |
| Go-to-declaration | Full | Full | Full | None | Low |
| Go-to-implementation | Full | Full (multi-server) | Full | None | Low |
| Call hierarchy (incoming/outgoing) | Full | None | Full | None | Very low |
| Type hierarchy | Full | None | Full | None | Very low |
| Workspace symbols (cross-project) | Full | Full (multi-server) | Full | None | Medium |
| **Inline Assistance** | | | | | |
| Signature help (parameter hints) | Full (auto on `(`) | Full | Full | Full (auto on `(` `,` + Ctrl+Shift+Space) | Done |
| Inlay hints (inline types) | Full (resolve on hover) | Full (50-row chunking) | Full | None | Medium |
| Code lens (inline annotations) | Full | Full (resolve + refresh) | Full | None | Low |
| **Formatting & Editing** | | | | | |
| Document formatting | Full | Full | Full | Full (Shift+Alt+F + format-on-save) | Done |
| Range formatting | Full | Full | Full | None (backend ready, no UI) | Low |
| On-type formatting | Full | Full | Full | None | Low |
| Linked editing (HTML tag pairs) | Full | Full | Full | None | Low |
| Selection range (smart select) | Full | None | Full | None | Very low |
| **Visual Enhancements** | | | | | |
| Semantic tokens (token highlighting) | Full (delta encoding) | Full (delta, augments syntax) | Full | None | Low |
| Document colors (CSS color picker) | Full | Full | Full | None | Low |
| Folding ranges (LSP-aware) | Full | Full (kind support) | Full | None | Low |
| **Infrastructure** | | | | | |
| Manifest-driven server registry | N/A (built-in) | N/A (built-in) | N/A | Full (lsp-servers.json, 5 servers) | Done |
| Auto-download LSP servers (npm) | Full (built-in) | Full (extensions) | Full | Full (npm install with --ignore-scripts) | Done |
| Server config (initOptions + workspace/config) | Full | Full | Full | Full (manifest-driven) | Done |
| Multi-server per file | Full | Full (primary + supplementary) | Full | None | Low (Phase 3) |
| Remote LSP (SSH) | Full | Full (SshLspAdapter) | Full | None | Not planned |
| Crash recovery (auto-restart) | Full (backoff) | Full | Full | None | Medium (Phase 2) |
| Pull diagnostics (refresh) | Full | Full | Full | None | Low |

### Summary

| Category | VS Code | Zed | Cursor | Voice Mirror |
|----------|---------|-----|--------|-------------|
| **Features implemented** | 29/29 | 26/29 | 29/29 | 14/29 |
| **Core editing** | Complete | Complete | Complete | Complete |
| **Navigation** | Complete | Near-complete | Complete | Tier 1 done |
| **Inline assistance** | Complete | Complete | Complete | Signature help done |
| **Formatting** | Complete | Complete | Complete | Document formatting done |
| **Visual** | Complete | Complete | Complete | None |

### LSP Priorities for Voice Mirror

**Worth doing (high value/effort ratio):**
1. ~~**Signature help** — Shows parameter info on `(`. Users expect this. Medium effort (new Rust handler + CM tooltip).~~ ✓ Done (auto on `(` `,` + Ctrl+Shift+Space)
2. ~~**Document formatting** — Format on save / format selection. Users expect this. Medium effort.~~ ✓ Done (Shift+Alt+F + format-on-save)
3. **Workspace symbols** — Cross-project symbol search. Feeds into Command Palette expansion.
4. **Inlay hints** — Inline type annotations. Nice for TS/Rust. Medium effort (chunking optional).

**Nice but not critical:**
5. Linked editing — HTML tag pair editing. Small scope.
6. On-type formatting — Auto-indent. Small scope.
7. Type/declaration/implementation navigation — More "go-to" targets. Small per feature.
8. Code lens — "N references" above functions. Medium effort.
9. **Incremental document sync** — Currently we send the full file content on every `didChange` (full sync). VS Code/Zed send only the changed characters + position (incremental sync). Negligible for normal files, but adds serialization overhead on very large files (10K+ lines). Requires converting CodeMirror change descriptions into LSP `TextDocumentContentChangeEvent` ranges. Small-medium effort.
10. **Range formatting** — Format selection (Ctrl+K Ctrl+F). Backend ready (Rust command + API wrapper), just needs a `formatSelection()` frontend method + keybinding. Small effort.

**Skip for now:**
- Semantic tokens — marginal visual improvement over syntax highlighting
- Document colors — niche (CSS-only)
- Call/type hierarchy — complex UI for rare use cases
- Multi-server — planned for Phase 3 (supplementary server support, diagnostic merging)
- Remote LSP — Voice Mirror is a local desktop app
- Selection range — CodeMirror has built-in smart selection

**Voice Mirror's LSP advantage:** AI handles what LSP can't. "What does this function do?" is answered by the chat terminal, not hover tooltips. "Refactor this module" goes through Claude Code, not LSP code actions. Our LSP needs to cover the basics that users expect from a code editor — the AI handles everything above that.

---

## Gap Details

### 1. Global Text Search (Ctrl+Shift+F) — DONE ✓

**Status:** Fully implemented. Ctrl+Shift+F opens Search tab in FileTree panel.

**Backend:** `search_content` command in `files/search.rs` — uses `ignore::WalkBuilder` (gitignore-aware) + `regex::Regex` for content search. Supports case sensitivity, regex mode, whole-word matching, include/exclude glob filters. Caps at 200 files / 5000 matches.

**Frontend:** `SearchPanel.svelte` in FileTree's 4th tab — search input, Aa/regex/word toggles, include/exclude filters, results grouped by file with icons, match highlighting via `<mark>`, 300ms debounce. Click result navigates to file + line.

**Store:** `search.svelte.js` — reactive state with `searchId` counter to discard stale async responses.

**Keybinding:** Ctrl+Shift+F (works from any context including inputs/editors).

---

### 2. Find & Replace (In-File) — DONE ✓

**Status:** Already works. `basicSetup` from the `codemirror` package bundles `@codemirror/search` with `searchKeymap` and `highlightSelectionMatches`. The editor theme already styles `.cm-panels`, `.cm-searchMatch`, and `.cm-searchMatch-selected`.

**Keybindings:** Ctrl+F (find), Ctrl+H (find & replace), F3/Shift+F3 (next/prev), Alt+Enter (select all matches). Supports match case, regex, and whole-word toggles.

---

### 3. Split Editor — FEATURE COMPETE ✓

**Status:** Feature compete with VS Code for real-world usage. Users can split in any direction, drag files from the tree with smart snap zones, drag between seams for full-width splits, resize panels, navigate directionally, maximize groups, and reset sizes. The remaining gaps are power-user features that most developers never use.

#### What's Done

- **Basic splitting** — Right, down, left, up via keyboard (Ctrl+\\), context menu, and drag-to-split
- **Arbitrary nesting** — Recursive binary tree (3+ groups, unlimited depth)
- **Drag tab between groups** — Cross-group tab moves with auto-close on empty groups
- **Drag tab to split zones** — Custom MIME type, DropZoneOverlay detects tab drags, 5-zone split on drop (Wave 2)
- **Drag file from tree to split** — 5 zones (center/L/R/T/B) with `DropZoneOverlay.svelte`, 22% edge threshold
- **Full-width seam splits** — Drag to the divider between two panes for ancestor-level splits spanning all columns/rows
- **Panel resizing** — SplitPanel with drag ratio (clamped 10%-90%)
- **Focus group 1/2** — Ctrl+1, Ctrl+2
- **Focus directional** — Ctrl+K Ctrl+Arrow (left/right/up/down) via tree-walking neighbor detection
- **Even sizes** — Ctrl+K Ctrl+= resets all branch ratios to 0.5
- **Maximize toggle** — Ctrl+K Ctrl+M shows only focused group, auto-restores on split/close
- **Context menu** — Split Right, Split Down, Open to the Side, Close Split, Close Others, Close to Right
- **Close group** — Auto-collapses parent branch, shifts focus to sibling
- **Preview vs pinned tabs** — Single-click = preview (auto-replaced), double-click = pinned
- **Auto-cleanup** — Closing last tab in a group closes the group

#### What's Missing

**High value (small scope):**
1. **Move editor by keyboard** — Ctrl+K Ctrl+Shift+Arrow to move a tab to the neighboring group without dragging
2. **Persist layout** — Save grid tree + ratios to config, restore on next session

**Nice to have:**
3. **Layout presets** — "2 columns", "2x2 grid", "3 columns" via command palette
4. **Join groups** — Merge two groups' tabs into one
5. **Ctrl+3...8** — Focus more than 2 groups by number
6. **Copy editor** — Open same file in two groups (currently only move)

**Skip:**
- Lock group — niche feature, rarely used
- Split in group — VS Code-only feature, minimal adoption
- Drag to new window — Voice Mirror is single-window by design
- Layout serialization API — no extension system needs it
- Cycle focus / focus without wrapping — directional focus covers the use case
- Move/copy entire group — drag covers this
- Expand active group — maximize covers this

---

### 4. Multi-Cursor Editing — DONE ✓

**Status:** Fully working. `basicSetup` bundles `searchKeymap` which includes `selectNextOccurrence` and `selectSelectionMatches`. Custom vertical cursor keybindings added in `editor-extensions.js`.

**Keybindings:**
- **Ctrl+D** → select next occurrence (via `searchKeymap`)
- **Ctrl+Shift+L** → select all occurrences (via `searchKeymap`)
- **Ctrl+Alt+Up** → add cursor on line above (custom)
- **Ctrl+Alt+Down** → add cursor on line below (custom)
- **Alt+Click** → add cursor at click position (CodeMirror default)
- **Escape** → collapse to single cursor

---

### 5. Git Integration — DONE ✓ (core workflow complete)

**Status:** Full staging/commit/push/pull cycle implemented with branch management and remote sync.

**Backend:** 14 Rust commands — `git_stage`, `git_unstage`, `git_stage_all`, `git_unstage_all`, `git_commit`, `git_discard`, `git_push`, `git_ahead_behind`, `git_fetch`, `git_pull`, `git_force_push`, `git_list_branches`, `git_checkout_branch`, `get_git_changes`.

**Frontend:**
- `GitCommitPanel.svelte` — commit textarea, Commit / Commit & Push buttons, Ctrl+Enter shortcut
- Branch picker dropdown — local + remote branches, filterable, keyboard navigable, checkout with confirmation
- Dynamic sync button — "Pull N" / "Push N" / "Fetch" / "Publish" based on `git_ahead_behind` counts
- Zed-style fetch dropdown — Fetch, Pull, Pull (Rebase), Push, Force Push (with confirmation)
- `GitChangesPanel.svelte` — staged/unstaged groups, per-file stage/unstage/discard, status badges (A/M/D/R) with tooltips

**Remaining gaps:** See §11 (Source Control), §12 (Diff Viewer), §13 (File Tree) for detailed gap analysis.

---

### ~~6. Command Palette (Full Commands) — DONE~~ ✓

**What real IDEs have:** Ctrl+Shift+P opens a command palette that lists **every available command** — hundreds of them. Theme switching, format document, toggle word wrap, restart LSP, run test, etc. Extensions register their own commands too.

**What we have now:**
- Central command registry (`src/lib/commands.svelte.js`) with 48 commands across 10 categories (View, Editor, File, Search, LSP, Git, Terminal, Chat, Voice, System)
- Prefix-based modes matching VS Code: `>` commands, `:` go-to-line, `@` go-to-symbol, no prefix = file search
- Opening shortcuts: Ctrl+P (files), Ctrl+Shift+P/F1 (commands), Ctrl+G (go-to-line), Ctrl+Shift+O (go-to-symbol)
- MRU (Most Recently Used) history with localStorage persistence — recently used commands appear first
- Category grouping with section headers, keybinding badges (`<kbd>`), category tags
- Fuzzy search via `fuzzysort` for files, commands, and symbols
- Symbol mode uses LSP `documentSymbols` with kind badges (function, class, variable, etc.)
- Go-to-line dispatches `lens-goto-position` to the focused editor group
- Registry API: `register()`, `registerMany()`, `unregister()`, `execute()`, `search()`, `getAll()`
- Component-level commands (save, format) via `CustomEvent` dispatch pattern

---

### 7. Debug Adapter Protocol (DAP) — LOW PRIORITY

**What real IDEs have:** Set breakpoints by clicking the gutter. Press F5 to start debugging. Step through code line by line. Inspect variables, call stack, watch expressions. Conditional breakpoints.

**What we have:** Nothing. Zero debug infrastructure.

**Why it matters (less than you'd think):** With AI-driven development, `console.log` debugging + asking Claude "why does this fail?" is often faster than traditional debugging. Most Voice Mirror users will lean on the AI terminal for debugging rather than a visual debugger.

**What's needed (if ever):**
- DAP client in Rust (like the LSP client)
- Breakpoint UI in the editor gutter
- Debug panel (variables, call stack, watch)
- Launch configuration system
- Language-specific debug adapters (Node.js, Python, LLDB for Rust)

**Estimated scope:** Massive — this is one of the most complex IDE features. VS Code's debugger is thousands of files. Zed's is still limited.

**Recommendation:** Defer indefinitely. Let the AI terminal handle debugging via voice commands. Revisit if users specifically request it.

---

### 8. Extensions / Plugins — NOT PLANNED

**What real IDEs have:** VS Code has 50,000+ extensions. Zed has a growing extension system. Cursor inherited VS Code's extensions. Extensions add languages, themes, debuggers, linters, formatters, and entirely new features.

**What we have:** Nothing. All features are built-in.

**Why it matters (debatable):** Extensions are what made VS Code dominant. But they also bring:
- Performance overhead
- Security risks (supply chain)
- Maintenance burden (API stability promises)
- Complexity for users (which extension? conflicts?)

**Recommendation:** Don't build a VS Code-style extension system. Instead, lean into:
- **MCP servers** as the "extension" mechanism — users add capabilities via MCP
- **Built-in language support** via LSP (already working)
- **Theme customization** (already working)
- **Tool profiles** for different workflows (already working)

Voice Mirror's extension story is: "Add an MCP server" — not "install a VS Code extension."

---

### 9. Terminal — SEE §14 FOR FULL ANALYSIS

**Status:** Rich terminal system with split panes, sidebar tree, tab coloring/icons, dev-server integration, AI terminal, shell profiles, and drag-to-reorder. See §14 below and `docs/archive/TERMINAL-GAP-ANALYSIS.md` for the full 33-item gap analysis.

---

### 10. Code Minimap — DONE ✓

**Status:** Fully implemented. The regular file editor uses `@replit/codemirror-minimap` (^0.5.2) applied unconditionally in `editor-extensions.js`. The diff viewer also has its own `DiffMinimap.svelte` showing change locations with proportional chunk markers.

---

## Detailed Gap Analysis by Category

### 11. Source Control (Changes Panel + Commit + Remote Ops)

> Compared against VS Code's Source Control panel and Zed's Git Panel.

#### What We Have

| Feature | Status | Notes |
|---------|--------|-------|
| Staged / unstaged groups | ✅ | Two sections with file counts |
| Stage / unstage per file | ✅ | Hover-reveal +/- buttons |
| Stage all / unstage all | ✅ | Group header buttons |
| Discard changes (per file) | ✅ | With confirmation dialog, hidden for untracked |
| Status badges (A/M/D/R) | ✅ | Color-coded (A=green, M=accent, D=red; R uses default), with hover tooltips |
| File type icons | ✅ | SVG sprite (chooseIconName) |
| Commit with message | ✅ | Textarea, Ctrl+Enter shortcut |
| Commit & Push | ✅ | Single button for combined action |
| Branch display | ✅ | Current branch name with icon |
| Branch switching | ✅ | Filterable dropdown, local + remote, checkout with confirmation |
| Dynamic sync button | ✅ | "Pull N" / "Push N" / "Fetch" / "Publish" (Zed-style) |
| Fetch / Pull / Push dropdown | ✅ | 5 operations including Pull (Rebase) and Force Push (with confirm) |
| Ahead/behind tracking | ✅ | Queries upstream, auto-refreshes on branch change |
| Click to view diff | ✅ | Single-click opens diff in editor |
| Context menu on changes | ✅ | Open Diff, Copy Path, Copy Relative Path, Reveal in File Explorer |

#### Gaps vs VS Code / Zed

| Feature | VS Code | Zed | Voice Mirror | Priority |
|---------|---------|-----|-------------|----------|
| **Hunk-level staging** | ✅ Stage individual hunks in diff gutter | ✅ Via diff hunks | ❌ Whole-file only | **High** |
| **Inline change indicators (editor gutter)** | ✅ Green/blue/red bars showing add/modify/delete | ✅ Same | ✅ Green/blue/red bars + peek + revert | Done ✓ |
| **Commit history / log** | ✅ Git Graph extension, Timeline view | ✅ Basic log | ❌ | Medium |
| **Stash support** | ✅ Stash/pop/apply from SCM panel | ❌ | ❌ | Medium |
| **Merge conflict resolution** | ✅ 3-way merge editor | ✅ Inline markers | ❌ | Medium |
| **Inline blame (git blame)** | ✅ Via GitLens extension | ✅ Native inline blame | ❌ | Medium |
| **Amend last commit** | ✅ Checkbox in commit panel | ✅ | ❌ | Low |
| **Sign-off / GPG signing** | ✅ | ❌ | ❌ | Low |
| **Multi-select files for batch stage** | ✅ Shift/Ctrl+click | ❌ | ❌ | Low |
| **Tree view for changes** | ✅ Toggle between flat list and tree | ✅ | ❌ Flat list only | Low |
| **Undo last commit** | ✅ `git reset HEAD~1` from UI | ❌ | ❌ | Low |
| **Cherry-pick / rebase UI** | ✅ | ❌ | ❌ | Very low |

**Highest-value next steps:**
1. Hunk-level staging (stage individual diff chunks) — this is what power users expect
2. ~~Editor gutter change indicators (green/blue/red bars) — instant visual feedback while editing~~ ✓ Done

---

### 12. Diff Viewer

> Compared against VS Code's diff editor and Zed's buffer diff.

#### What We Have

| Feature | Status | Notes |
|---------|--------|-------|
| Unified diff view | ✅ | CodeMirror `unifiedMergeView` |
| Side-by-side (split) diff | ✅ | CodeMirror `MergeView`, toggle on toolbar |
| Syntax highlighting in diff | ✅ | Same language packs as editor |
| Collapsed unchanged regions | ✅ | Click to expand, 3-line context margin |
| Chunk navigation (prev/next) | ✅ | Toolbar arrows + Alt+Up/Down keyboard shortcuts |
| Chunk counter ("X of N") | ✅ | In toolbar |
| Word wrap toggle | ✅ | Toolbar button |
| Whitespace normalization | ✅ | Toggle to trim trailing whitespace |
| Addition/deletion stats (+N / -N) | ✅ | Shown in tab bar and toolbar |
| Diff minimap | ✅ | Vertical strip with proportional chunk markers |
| Binary file detection | ✅ | Shows placeholder for binary files |
| Context menu | ✅ | Copy, Select All, Open File, Copy Path, Reveal |
| Added/deleted file support | ✅ | Empty string for missing side |
| Word-level inline highlights | ✅ | Green/red word-level diff within changed lines |

#### Gaps vs VS Code / Zed

| Feature | VS Code | Zed | Voice Mirror | Priority |
|---------|---------|-----|-------------|----------|
| **Hunk-level stage/unstage buttons** | ✅ Gutter buttons per hunk in diff | ✅ | ❌ | **High** |
| **Inline gutter +/- indicators** | ✅ Red/green markers per line in diff gutter | ✅ | ❌ | Medium |
| **3-way merge diff** | ✅ Current/incoming/result panes | ❌ | ❌ | Medium |
| **Navigate to next/prev file in diff** | ✅ Alt+F5 cycle through changed files | ✅ | ❌ | Medium |
| **Clickable minimap** | ✅ Click minimap to jump to chunk | ❌ | ❌ Decorative only (`pointer-events: none`) | Low |
| **Inline comments / review** | ✅ Via PR extension | ❌ | ❌ | Low |
| **Ignore whitespace in diff** | ✅ Robust (ignores leading/trailing/all) | ✅ | ⚠️ Trim trailing only | Low |
| **Move to unchanged region** | ✅ Jump to next/prev collapsed region | ❌ | ❌ | Low |
| **Compare with clipboard** | ✅ | ❌ | ❌ | Very low |
| **Compare arbitrary files** | ✅ | ❌ | ❌ | Very low |

**Assessment:** Our diff viewer is solid — unified + split modes, chunk navigation, stats, minimap, word-level highlighting, and keyboard shortcuts. The main gap is hunk-level staging (shared with §11) and interactive minimap.

---

### 13. File Tree

> Compared against VS Code's Explorer and Zed's Project Panel.

#### What We Have

| Feature | Status | Notes |
|---------|--------|-------|
| Lazy directory expansion | ✅ | Load children on first expand |
| Collapse all | ✅ | Toolbar button |
| Refresh | ✅ | Toolbar button |
| New file / new folder | ✅ | Toolbar buttons + context menu, inline input |
| Inline rename | ✅ | Context menu or F2, pre-selects name without extension |
| Delete file/folder | ✅ | Context menu with confirmation |
| Reveal in Explorer | ✅ | Context menu |
| Copy path / relative path | ✅ | Context menu |
| File type icons | ✅ | SVG sprite (~216 JS mappings, 1089 symbols in sprite, from OpenCode) |
| Git status decorations | ✅ | Color-coded: green (added), yellow (modified), red+strikethrough (deleted) |
| Git status propagation to folders | ✅ | VS Code rules: deleted doesn't propagate, modified wins over added |
| LSP diagnostic decorations | ✅ | Error (red) / warning (yellow) text + badge counts |
| LSP overrides git colors | ✅ | Diagnostics take priority over git status |
| Search tab (Ctrl+Shift+F) | ✅ | Full content search with regex, case, word, include/exclude |
| Outline tab | ✅ | LSP document symbols with kind badges |
| Changes tab | ✅ | Staged/unstaged groups with commit panel |
| Drag file to editor | ✅ | Opens file in editor, supports drop zones for splits |
| Live filesystem watcher | ✅ | Auto-reloads affected directories on fs changes |
| Live git status refresh | ✅ | Auto-refreshes on `fs-git-changed` event |
| Double-click header | ✅ | Reveals project folder in system explorer |

#### Gaps vs VS Code / Zed

| Feature | VS Code | Zed | Voice Mirror | Priority |
|---------|---------|-----|-------------|----------|
| **Drag to reorder / move files** | ✅ Drag files between folders | ✅ | ❌ Drag only opens in editor | Medium |
| **Multi-select files** | ✅ Shift/Ctrl+click for batch operations | ✅ | ❌ | Medium |
| **Keyboard navigation (arrow keys)** | ✅ Full tree keyboard nav (up/down/left/right) | ✅ | ❌ Click only | Medium |
| **Filter / focus mode** | ✅ Type to filter visible tree | ✅ Quick filter | ❌ | Low |
| **Tree view vs flat list toggle** | ✅ Toggle in Changes panel | ❌ | ❌ | Low |
| **Compact folders** | ✅ Collapse single-child folders (a/b/c → a/b/c) | ✅ | ❌ | Low |
| **Custom file nesting rules** | ✅ `.ts` nests under `.js`, etc. | ❌ | ❌ | Low |
| **File decorations (badges)** | ✅ Extensions add custom badges | ❌ | ❌ N/A (no extensions) | N/A |
| **Breadcrumbs above editor** | ✅ File path segments, click to navigate | ✅ | ❌ | Low |
| **Sticky scroll (tree headers)** | ✅ Parent folders stick to top | ❌ | ❌ | Very low |

**Assessment:** Our file tree is comprehensive — 4-tab layout (files/changes/outline/search), full CRUD, git + LSP decorations, drag-to-editor, live watchers. The main gaps are keyboard-only navigation and drag-to-move files between folders.

---

### 14. Terminal — DETAILED ANALYSIS

> Full terminal gap analysis lives in `docs/archive/TERMINAL-GAP-ANALYSIS.md` (373 lines, 15 categories).

#### Summary of What We Have

| Feature | Status |
|---------|--------|
| PTY spawn/kill/resize | ✅ |
| Shell profile detection | ✅ |
| Grid splits (H + V, recursive tree, up to ~8 panes) | ✅ |
| Tab close button (hover X, middle-click) | ✅ |
| Find in terminal (Ctrl+F, regex, case toggle) | ✅ |
| Clickable URL detection (balanced parens, trailing punct) | ✅ |
| File path detection (Unix/Windows, :line:col) | ✅ |
| Terminal persistence (layout, names, colors, icons) | ✅ |
| Sidebar tree with drag-to-reorder | ✅ |
| Tab coloring (9 colors) + icons (15) | ✅ |
| Tab renaming, context menus | ✅ |
| Dev server integration (framework detection, crash protection) | ✅ |
| AI terminal (dedicated Claude Code PTY) | ✅ |
| ghostty-web WASM renderer | ✅ |
| 5000-line scrollback | ✅ |

#### Recently Closed Terminal Gaps (2026-02-27)

All 5 high-priority terminal gaps from the gap analysis have been implemented:

| # | Feature | Implementation | Tests |
|---|---------|---------------|-------|
| 1 | **Tab close button** | Hover-reveal X button, middle-click, last-group safety, dev-server confirmation | 30 source-inspection |
| 2 | **Grid splits (H + V)** | Recursive split tree (`split-tree.js`), Split Right / Split Down, max depth 3 (~8 panes) | 23 unit + 33 source-inspection |
| 3 | **Terminal persistence** | Layout saved to config (debounced 500ms), fresh PTYs on restore, profile fallback | 11 unit + source-inspection in split tests |
| 4 | **Find in terminal** | `terminal-search.js` + `TerminalSearch.svelte`, Ctrl+F, regex, case toggle, match navigation | 19 unit + 64 source-inspection |
| 5 | **Clickable links** | `terminal-links.js` — URL detection (balanced parens) + file path detection (Unix/Windows, :line:col) | 23 unit |

#### Remaining Terminal Gaps

See `docs/archive/TERMINAL-GAP-ANALYSIS.md` for the complete 33-item gap list. The top 5 high-priority items are now closed. Remaining gaps are medium/low priority (shell integration, broadcast input, font zoom, etc.).

---

### 15. Editor (CodeMirror)

> Non-LSP editor features compared against VS Code and Zed.

#### What We Have

| Feature | Status |
|---------|--------|
| Syntax highlighting (8 languages) | ✅ |
| Autocomplete (activateOnTyping) | ✅ |
| Find & replace (Ctrl+F, Ctrl+H) | ✅ |
| Multi-cursor (Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+Up/Down) | ✅ |
| Word wrap toggle | ❌ (only in DiffViewer + OutputPanel, not in file editor) |
| Go-to-line (Ctrl+G) | ✅ |
| Bracket matching | ✅ |
| Auto-indent | ✅ |
| Dirty tracking + conflict detection | ✅ |
| Read-only mode for external files | ✅ |
| Markdown preview/edit toggle | ✅ |
| Custom theme (synced with app theme) | ✅ |
| Format document (Shift+Alt+F) | ✅ |
| Format on save | ✅ |

#### Gaps

| Feature | VS Code | Zed | Voice Mirror | Priority |
|---------|---------|-----|-------------|----------|
| **Inline gutter change indicators** | ✅ Green/blue/red bars (add/modify/delete) | ✅ | ✅ Green/blue/red bars + peek + revert | Done ✓ |
| **Word wrap toggle** | ✅ Toggle line wrapping | ✅ | ❌ (only in DiffViewer + OutputPanel) | Small |
| **Indent guides** | ✅ Colored lines showing nesting depth | ✅ | ❌ | Medium |
| **Bracket pair colorization** | ✅ Rainbow brackets | ✅ | ❌ | Low |
| **Sticky scroll** | ✅ Pin scope headers (function/class) at top | ✅ | ❌ | Low |
| **Code folding UI** | ✅ Gutter fold markers, fold/unfold all | ✅ | ⚠️ CM has folding but no visible gutter markers | Low |
| **Emmet abbreviation expansion** | ✅ HTML/CSS shorthand | ❌ | ❌ | Low |
| **Snippet system** | ✅ User-defined snippets | ✅ | ❌ | Low |
| **Image preview in editor** | ✅ | ✅ | ❌ | Very low |

**Assessment:** Core editing is feature-complete. Inline gutter change indicators are now implemented (green/blue/red bars + peek widget + hunk revert). The file editor is missing a word wrap toggle (exists in DiffViewer and OutputPanel but not the main editor). The next biggest editor gaps are word wrap toggle, indent guides, and bracket pair colorization.

---

## Priority Ranking

### Completed ✓

| Feature | Category | Notes |
|---------|----------|-------|
| Find & Replace (in-file) | Editor | Via `basicSetup` |
| Multi-cursor | Editor | Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+Up/Down |
| Global text search | File Tree | Ctrl+Shift+F, regex, SearchPanel |
| Split editor | Editor | Full grid, drag-to-split, seam splits, maximize |
| Git stage + commit + push | Source Control | Stage/unstage, commit, push, branch switch, sync |
| Document formatting | LSP | Shift+Alt+F + format on save |
| Signature help | LSP | Auto on `(` `,` + Ctrl+Shift+Space |
| Command palette | Editor | 48 commands, 4 modes, fuzzy search, MRU |
| Git decorations in file tree | File Tree | Color-coded added/modified/deleted with folder propagation |
| Dynamic sync button | Source Control | Zed-style Pull N / Push N / Fetch / Publish |
| Inline gutter change indicators | Editor + Git | Green/blue/red bars + peek widget + hunk revert |
| Code minimap | Editor | `@replit/codemirror-minimap` in file editor + `DiffMinimap.svelte` |
| Tab close button | Terminal | Hover X, middle-click, last-group safety, dev-server confirm |
| Grid splits (H + V) | Terminal | Recursive split tree, Split Right/Down, max ~8 panes |
| Find in terminal (Ctrl+F) | Terminal | Search with regex, case toggle, match navigation |
| Clickable URLs/file paths | Terminal | URL detection + file path detection (Unix/Windows, :line:col) |
| Terminal persistence | Terminal | Layout/names/colors/icons saved to config, fresh PTYs on restore |
| Status bar | Editor | Git branch, diagnostics, cursor pos, language, encoding, EOL, indentation, LSP health, dev server |
| Notification system | Editor | Toast notifications + notification center + bell icon with unread count |
| Closed tab history + Ctrl+Shift+T | Tabs | closedTabs stack (max 20), reopenClosedTab, context menu item, shortcut |
| Mouse wheel scroll on tab bar | Tabs | onwheel handler converts deltaY to scrollLeft |
| Back/forward navigation (Alt+Left/Right) | Editor | navigation-history store, Alt+Left/Right CodeMirror keybindings |
| Ctrl+hover definition underline | Editor | ViewPlugin with Ctrl key tracking, word detection, Decoration.mark |
| Ctrl+PageUp/PageDown tab cycling | Tabs | prev/next editor tab shortcuts with wrap-around |
| Tab drag to split zones | Drag | Custom MIME type, DropZoneOverlay for tab drags, 5-zone split on drop |
| Problems panel (Ctrl+Shift+M) | LSP + Terminal | VS Code-style tree view grouped by file, severity/text filters, click-to-navigate, status bar click opens panel, tab badge |
| LSP server management (Phase 1) | LSP | Manifest-driven registry (5 servers), npm auto-download, initOptions + workspace/config, user overrides, status bar install indicator |

### Open Gaps — Ranked by Impact

| Rank | Feature | Category | Impact | Effort | Rationale |
|------|---------|----------|--------|--------|-----------|
| ~~1~~ | ~~Inline gutter change indicators~~ | ~~Editor + Git~~ | ~~High~~ | ~~Medium~~ | ✅ Done — green/blue/red bars + peek widget + revert. §11, §15 |
| 2 | **Hunk-level staging** | Source Control + Diff | High | Medium | Stage individual chunks, not whole files. Hunk-level *revert* done (via gutter peek). §11, §12 |
| 3 | **Keyboard tree navigation** | File Tree | Medium | Medium | Arrow keys to navigate file tree. §13 |
| 4 | **Merge conflict resolution** | Source Control | Medium | Large | 3-way merge or inline markers. §11 |
| 5 | **Commit history / log** | Source Control | Medium | Medium | View past commits. §11 |
| 6 | **Inline blame (git blame)** | Source Control | Medium | Medium | Per-line author/date annotations. §11 |
| 7 | **Stash support** | Source Control | Medium | Small | Stash/pop/apply from UI. §11 |
| 8 | **Drag-to-move files in tree** | File Tree | Medium | Medium | Drag files between folders. §13 |
| 9 | **Indent guides** | Editor | Medium | Small | Colored lines showing nesting depth. §15 |
| 10 | **Navigate to next/prev diff file** | Diff | Medium | Small | Alt+F5 cycle through changed files. §12 |
| 11 | **Interactive diff minimap** | Diff | Low | Small | Click minimap to jump to chunk. §12 |
| 12 | **Workspace symbols** | LSP | Medium | Medium | Cross-project symbol search in command palette |
| 13 | **Inlay hints** | LSP | Medium | Medium | Inline type annotations for TS/Rust |
| 14 | **Breadcrumbs** | Editor | Low | Small | File path segments above editor |
| ~~15~~ | ~~**Code minimap**~~ | ~~Editor~~ | ~~Low~~ | ~~Large~~ | ✅ Done — `@replit/codemirror-minimap` in file editor + `DiffMinimap.svelte` |
| 16 | **Debug adapter (DAP)** | Editor | Low | Massive | AI terminal handles debugging better |
| -- | **Extensions / Plugins** | System | None | Massive | MCP servers are our extension model |

---

## Voice Mirror's Unique Angle

The gap list above looks daunting, but Voice Mirror doesn't need to close every gap to be compelling. The features no other IDE has:

1. **Voice as first-class input** — "rename this function to handleSubmit" works via AI + LSP rename
2. **Persistent AI memory** — Claude remembers your codebase across sessions
3. **Always-on-top overlay** — code while referencing other apps
4. **MCP tool ecosystem** — browser control, n8n workflows, memory system
5. **AI-native terminal** — Claude Code is embedded, not a bolt-on extension

The strategy: close the top gaps so Lens is **comfortable enough** for real coding, then double down on the voice+AI features no one else has.

**Done:** find/replace ✓, multi-cursor ✓, global search ✓, git stage+commit+push ✓, branch management ✓, dynamic sync ✓, document formatting ✓, signature help ✓, split editor ✓, command palette ✓, file tree git decorations ✓, LSP diagnostics in tree ✓, code minimap ✓, terminal tab close ✓, terminal grid splits (H+V) ✓, terminal find (Ctrl+F) ✓, clickable terminal links ✓, terminal persistence ✓, inline gutter change indicators ✓, closed tab history + Ctrl+Shift+T ✓, mouse wheel scroll on tab bar ✓, back/forward navigation (Alt+Left/Right) ✓, Ctrl+hover definition underline ✓, Ctrl+PageUp/PageDown tab cycling ✓, tab drag to split zones ✓, Problems panel (Ctrl+Shift+M) ✓, LSP server management Phase 1 (manifest registry + auto-download) ✓.

**Next wave:** hunk-level staging (stage individual diff chunks from the gutter). This is the remaining high-impact gap that separates "usable" from "daily driver." The terminal is now feature-compete with VS Code for core workflows.
