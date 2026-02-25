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

| Feature | VS Code | Zed | Voice Mirror | Gap |
|---------|---------|-----|-------------|-----|
| Editor (syntax, save) | Full | Full | Full | None |
| LSP (diagnostics, hover, completion) | Full (29/29) | Full (26/29) | 12/29 features | See LSP table below |
| Go-to-definition | Full | Full | Full | None |
| Find references | Full | Full | Full | None |
| Rename symbol | Full | Full | Full | None |
| Code actions | Full | Full | Full | None |
| Document outline | Full | Full | Full | None |
| Git status + diff | Full | Full | Stage/Commit/Push + AI | Minor gaps |
| Global text search | Full | Full | Full | None |
| Split editor | Full (40+ commands) | Full | Core + drag-to-split | See split table below |
| Multi-cursor | Full | Full | Full | None |
| Debug adapter (DAP) | Full | Partial | None | Low priority |
| Extensions/plugins | Massive | Growing | None | Not planned |
| Command palette (commands) | Full | Full | 6 commands | Medium |
| Terminal | Full | Partial | Rich (tabs) | Minor gaps |
| Minimap | Full | Full | Diff only | Low |
| Breadcrumbs | Full | Full | None | Low |
| Find & replace (in file) | Full | Full | Full | None |

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

### 3. Split Editor — CORE DONE ✓ (gaps remain)

**Status:** Core split editor system is fully implemented with a recursive binary tree layout. Users can split, resize, drag tabs between groups, and drag files from the tree to create splits. Missing VS Code's advanced features (group locking, arrangement presets, split-in-group, etc.).

#### Split Editor Feature Comparison

| Feature | VS Code | Zed | Voice Mirror | Status |
|---------|---------|-----|-------------|--------|
| **Basic Splitting** | | | | |
| Split right (horizontal) | Ctrl+\\ | Ctrl+\\ | Ctrl+\\ | Done |
| Split down (vertical) | Cmd+K Cmd+\\ | — | Right-click menu | Done |
| Split left / up | Commands | — | Drag-to-split zones | Done |
| Arbitrary nesting (3+ groups) | Full (recursive grid) | Full | Full (binary tree) | Done |
| Close group | Full | Full | Full (auto-collapses tree) | Done |
| **Drag & Drop** | | | | |
| Drag tab between groups | Full | Full | Full | Done |
| Drag tab to split (4 edges + center) | Full (configurable thresholds) | Full | Full (22% edge threshold) | Done |
| Drag file from tree to split | Full | Full | Full (5 zones: center/L/R/T/B) | Done |
| Visual drop zone overlay | Blue highlight regions | Highlight regions | Dashed accent overlay | Done |
| Ghost drag image | Tab preview | Tab preview | Filename pill | Done |
| Copy editor on drag (modifier key) | Ctrl/Cmd modifier | — | None | Gap |
| Drag editor to new window | Full | — | None | Not planned |
| **Panel Resizing** | | | | |
| Drag resize between groups | Full | Full | Full (SplitPanel + ratio) | Done |
| Even widths (reset sizes) | Full (command) | Full | None | Gap |
| Maximize group (toggle) | Cmd+K Cmd+M | — | None | Gap |
| Expand active group | Full | — | None | Gap |
| Min/max size constraints | Full (per-group) | Full | 10%-90% ratio clamp | Done |
| **Focus Navigation** | | | | |
| Focus group 1 / 2 | Ctrl+1/2/3/.../8 | Ctrl+1/2 | Ctrl+1 / Ctrl+2 | Partial (2 only) |
| Focus left/right/up/down | Cmd+K Cmd+Arrow | — | None | Gap |
| Cycle focus (next/prev group) | Full | Full | None | Gap |
| Focus without wrapping | Full | — | None | Gap |
| **Move/Copy Editor** | | | | |
| Move editor to left/right/up/down | Full (commands) | Full | Drag only | Partial |
| Move editor to first/last group | Full | — | None | Gap |
| Move editor to specific group (by index) | Full | — | None | Gap |
| Copy editor to another group | Full | — | None | Gap |
| **Group Management** | | | | |
| Join two groups (merge) | Full | — | None | Gap |
| Join all groups | Full | — | reset() collapses all | Partial |
| Lock group (prevent editor placement) | Full | — | None | Gap |
| Move entire group | Full | — | None | Gap |
| Copy entire group | Full | — | None | Gap |
| **Split In Group** | | | | |
| Side-by-side within single group | Cmd+K Cmd+Shift+\\ | — | None | Gap |
| Toggle split-in-group layout | Full | — | None | Gap |
| Focus primary/secondary side | Full | — | None | Gap |
| **Layout Presets** | | | | |
| 2x2 grid preset | Full (layoutEditorGroups) | — | Manual nesting only | Gap |
| Apply custom layout | Full (public API) | — | None | Gap |
| Get/serialize current layout | Full | — | None | Gap |
| Persist layout across sessions | Full | Full | None | Gap |
| **Context Menu** | | | | |
| Split Right / Down from tab menu | Full | Full | Full (Split Right, Split Down) | Done |
| Open to the Side | Full (Ctrl+Enter) | Full | Full (Ctrl+Enter) | Done |
| Close Others / Close to Right | Full | Full | Full | Done |
| Move to Group (submenu) | Full | — | None | Gap |

#### Summary

| Category | VS Code | Zed | Voice Mirror |
|----------|---------|-----|-------------|
| **Basic splitting** | 40+ commands | ~15 commands | 6 commands |
| **Drag & drop** | Full (copy, cross-window) | Full | Full (same-window) |
| **Resize** | Full (maximize, even, expand) | Full | Basic (drag only) |
| **Focus nav** | 12+ shortcuts | ~4 shortcuts | 2 shortcuts |
| **Editor move/copy** | 8+ directional commands | ~4 | Drag only |
| **Group management** | Full (join, lock, move) | Basic | Basic (close only) |
| **Layout presets** | Full (API + persistence) | Persistence | None |

#### What We Have (working today)

1. **Recursive binary tree** — `editor-groups.svelte.js` manages `GridLeaf`/`GridBranch` nodes. Unlimited nesting depth.
2. **Split directions** — Horizontal (right/left) and vertical (down/up). `splitGroup()`, `swapChildren()`, `closeGroup()`.
3. **Drag-to-split from file tree** — 5 zones (center, left, right, top, bottom) with `DropZoneOverlay.svelte`. 22% edge threshold.
4. **Tab drag between groups** — `moveTab()` in tabs store. Cross-group moves auto-close empty groups.
5. **Resizable panels** — `SplitPanel.svelte` with `bind:ratio`. Clamped 10%-90%.
6. **Focus shortcuts** — Ctrl+1 (group 1), Ctrl+2 (group 2). Click-to-focus with accent border indicator.
7. **Context menu** — Split Right, Split Down, Open to the Side, Close Split (right-click on tab or split button).
8. **Preview vs pinned tabs** — Single-click = preview (auto-replaced), double-click = pinned.
9. **Auto-cleanup** — Closing last tab in a group closes the group. `closeGroup()` collapses the branch.

#### What's Missing (worth adding)

**High value:**
1. **Focus directional** — Ctrl+K Ctrl+Arrow to move between groups. Currently only Ctrl+1/2.
2. **Even widths** — Reset all groups to equal size. Simple: walk tree, set all ratios to 0.5.
3. **Maximize group** — Toggle active group to fill entire editor area. Needs grid-level expand/collapse.
4. **Move editor commands** — Keyboard-driven "Move editor to right/left/up/down group". Currently drag-only.
5. **Persist layout** — Save grid tree + ratios to config. Restore on next session.

**Nice to have:**
6. **Layout presets** — "2 columns", "2x2 grid", "3 columns" via command palette.
7. **Join groups** — Merge two groups' tabs into one.
8. **Ctrl+3...8** — Focus more than 2 groups by number.
9. **Copy editor** — Open same file in two groups (currently only move).

**Skip:**
- Lock group — niche feature, rarely used
- Split in group — VS Code-only feature, minimal adoption
- Drag to new window — Voice Mirror is single-window by design
- Layout serialization API — no extension system needs it

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

### 6. Command Palette (Full Commands) — MEDIUM

**What real IDEs have:** Ctrl+Shift+P opens a command palette that lists **every available command** — hundreds of them. Theme switching, format document, toggle word wrap, restart LSP, run test, etc. Extensions register their own commands too.

**What we have:** `CommandPalette.svelte` with:
- Fuzzy file search (via `fuzzysort`)
- 6 hardcoded commands: Open Lens, New Session (TODO), Toggle Terminal, Toggle Chat, Toggle File Tree, Settings

**Why it matters:** The command palette is the discovery mechanism for IDE features. Users find features by typing what they want. Without it, features are hidden behind menus or unknown shortcuts.

**What's needed:**
- Command registry system (array of `{ id, label, category, handler, keybinding }`)
- Register all existing actions (LSP commands, editor actions, view toggles, settings)
- Show keybinding hints next to commands
- Category grouping in results

**Estimated scope:** Medium — the palette UI exists, it just needs a command registry and more commands registered.

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
| ~~4~~ | ~~Split editor~~ | ~~High~~ | ~~Large~~ | ~~Core done. Binary tree grid, drag-to-split, tab drag between groups.~~ ✓ |
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

The strategy: close the top gaps so Lens is **comfortable enough** for real coding, then double down on the voice+AI features no one else has. Done: ~~find/replace~~ ✓, ~~multi-cursor~~ ✓, ~~global search~~ ✓, ~~git stage+commit~~ ✓, ~~document formatting~~ ✓, ~~signature help~~ ✓, ~~split editor~~ ✓. Remaining: split editor polish (focus nav, maximize, persist layout), command palette expansion.
