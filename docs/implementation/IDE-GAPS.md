# IDE Gap Analysis — Voice Mirror Lens vs Real IDEs

> Internal doc. Tracks what Voice Mirror's Lens workspace has vs what VS Code / Zed / Cursor offer.
>
> Last updated: 2026-02-25

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
| LSP (diagnostics, hover, completion) | Full (29/29) | Full (26/29) | 12/29 features | See LSP table below |
| Go-to-definition | Full | Full | Full | **Feature Compete** |
| Find references | Full | Full | Full | **Feature Compete** |
| Rename symbol | Full | Full | Full | **Feature Compete** |
| Code actions | Full | Full | Full | **Feature Compete** |
| Document outline | Full | Full | Full | **Feature Compete** |
| Git status + diff | Full | Full | Stage/Commit/Push + AI | Minor gaps |
| Global text search | Full | Full | Full | **Feature Compete** |
| Split editor | Full (40+ commands) | Full | 20+ features, drag-to-split + seam splits | **Feature Compete** |
| Multi-cursor | Full | Full | Full | **Feature Compete** |
| Debug adapter (DAP) | Full | Partial | None | Low priority |
| Extensions/plugins | Massive | Growing | None | Not planned |
| Command palette (commands) | Full | Full | 6 commands | Medium gap |
| Terminal | Full | Partial | Rich (tabs, AI, dev-server) | Minor gaps |
| Minimap | Full | Full | Diff only | Low |
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
| Multi-server per file | Full | Full (primary + supplementary) | Full | None | Low |
| Remote LSP (SSH) | Full | Full (SshLspAdapter) | Full | None | Not planned |
| Crash recovery (auto-restart) | Full (backoff) | Full | Full | None | Low |
| Pull diagnostics (refresh) | Full | Full | Full | None | Low |

### Summary

| Category | VS Code | Zed | Cursor | Voice Mirror |
|----------|---------|-----|--------|-------------|
| **Features implemented** | 29/29 | 26/29 | 29/29 | 12/29 |
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
- Multi-server — only matters for CSS-in-JS and similar edge cases
- Remote LSP — Voice Mirror is a local desktop app
- Selection range — CodeMirror has built-in smart selection

**Voice Mirror's LSP advantage:** AI handles what LSP can't. "What does this function do?" is answered by the chat terminal, not hover tooltips. "Refactor this module" goes through Claude Code, not LSP code actions. Our LSP needs to cover the basics that users expect from a code editor — the AI handles everything above that.

---

## Gap Details

### 1. Global Text Search (Ctrl+Shift+F) — DONE ✓

**Status:** Fully implemented. Ctrl+Shift+F opens Search tab in FileTree panel.

**Backend:** `search_content` command in `files.rs` — uses `ignore::WalkBuilder` (gitignore-aware) + `regex::Regex` for content search. Supports case sensitivity, regex mode, whole-word matching, include/exclude glob filters. Caps at 200 files / 5000 matches.

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

**Status:** Fully working. `basicSetup` bundles `searchKeymap` which includes `selectNextOccurrence` and `selectSelectionMatches`. Custom vertical cursor keybindings added in FileEditor.svelte.

**Keybindings:**
- **Ctrl+D** → select next occurrence (via `searchKeymap`)
- **Ctrl+Shift+L** → select all occurrences (via `searchKeymap`)
- **Ctrl+Alt+Up** → add cursor on line above (custom)
- **Ctrl+Alt+Down** → add cursor on line below (custom)
- **Alt+Click** → add cursor at click position (CodeMirror default)
- **Escape** → collapse to single cursor

---

### 5. Git Integration (Stage + Commit + Push) — DONE ✓

**Status:** Core git workflow implemented. Changes tab shows staged/unstaged groups with stage/unstage/discard actions, commit panel with branch indicator, and push support.

**Backend:** 7 Rust commands (`git_stage`, `git_unstage`, `git_stage_all`, `git_unstage_all`, `git_commit`, `git_discard`, `git_push`). Modified `get_git_changes` to parse staged vs unstaged status separately + return branch name.

**Frontend:** `GitCommitPanel.svelte` with branch indicator (read-only), commit textarea, Commit and Commit & Push buttons. FileTree Changes tab overhauled with staged/unstaged groups and hover-reveal action buttons.

**Still missing (future):** Branch switching (clickable branch indicator → dropdown picker, needs `git branch --list`, dirty worktree warnings, file tree refresh), pull, merge conflict resolution, inline blame, commit history, hunk staging.

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

### 9. Terminal Gaps — MINOR

**What real IDEs have:** Split terminals (side by side), search in scrollback, drag-to-reorder tabs, send text to terminal programmatically, terminal profiles (bash, zsh, PowerShell), link detection (clickable URLs/file paths).

**What we have (solid):**
- Multiple terminal tabs (AI + shell + dev-server)
- Rename tabs
- Close tabs
- Reorder tabs (`.moveTab()`)
- Dev-server tabs with framework metadata
- 5000-line scrollback
- Full PTY support via ghostty-web WASM

**What's missing:**
- Split terminals (two side by side) — would need layout work
- Search in scrollback (Ctrl+Shift+F in terminal)
- Clickable links/file paths
- Terminal profiles (let user pick default shell)

**Estimated scope:** Small to medium per feature. None are critical.

---

### 10. Code Minimap — LOW

**What real IDEs have:** A miniature overview of the entire file on the right side of the editor. Shows your position. Clickable to jump to a section. Highlighted search results, git changes, errors.

**What we have:** `DiffMinimap.svelte` — but only in the diff viewer, showing change locations. No minimap in the regular editor.

**Why it matters:** Helpful for orientation in large files (500+ lines). Less important with AI navigation ("go to the save function").

**What's needed:**
- CodeMirror doesn't have a built-in minimap (unlike Monaco/VS Code)
- Would need a custom extension or canvas-based renderer
- Alternative: use document outline (already implemented) for navigation

**Estimated scope:** Large for a proper minimap. Skip in favor of the existing outline panel.

---

## Priority Ranking

| Priority | Feature | Impact | Effort | Rationale |
|----------|---------|--------|--------|-----------|
| ~~1~~ | ~~Find & Replace (in-file)~~ | ~~High~~ | ~~Tiny~~ | ~~Already works via basicSetup.~~ ✓ |
| ~~1~~ | ~~Multi-cursor~~ | ~~High~~ | ~~Small~~ | ~~Done. Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+Up/Down.~~ ✓ |
| ~~2~~ | ~~Global text search~~ | ~~Critical~~ | ~~Medium~~ | ~~Done. Ctrl+Shift+F, Rust regex backend, SearchPanel in FileTree.~~ ✓ |
| 3 | Command palette expansion | Medium | Medium | Discovery mechanism for all features. |
| ~~4~~ | ~~Split editor~~ | ~~High~~ | ~~Large~~ | ~~Feature compete. Full grid, drag-to-split, seam splits, maximize, even sizes.~~ ✓ |
| ~~5~~ | ~~Git stage + commit~~ | ~~Medium~~ | ~~Medium~~ | ~~Done. Stage/unstage, commit, push, AI commit messages.~~ ✓ |
| 6 | Terminal search | Low | Small | Nice-to-have for scrollback. |
| 7 | Breadcrumbs | Low | Small | File path context in editor. |
| 8 | Code minimap | Low | Large | Outline panel is a good substitute. |
| 9 | Debug adapter | Low | Massive | AI terminal handles this better. |
| -- | Extensions | None | Massive | MCP servers are our extension model. |

---

## Voice Mirror's Unique Angle

The gap list above looks daunting, but Voice Mirror doesn't need to close every gap to be compelling. The features no other IDE has:

1. **Voice as first-class input** — "rename this function to handleSubmit" works via AI + LSP rename
2. **Persistent AI memory** — Claude remembers your codebase across sessions
3. **Always-on-top overlay** — code while referencing other apps
4. **MCP tool ecosystem** — browser control, n8n workflows, memory system
5. **AI-native terminal** — Claude Code is embedded, not a bolt-on extension

The strategy: close the top gaps so Lens is **comfortable enough** for real coding, then double down on the voice+AI features no one else has. Done: ~~find/replace~~ ✓, ~~multi-cursor~~ ✓, ~~global search~~ ✓, ~~git stage+commit~~ ✓, ~~document formatting~~ ✓, ~~signature help~~ ✓, ~~split editor~~ ✓, ~~command palette~~ ✓. Remaining: split editor polish (persist layout), workspace symbols (feeds into command palette).
