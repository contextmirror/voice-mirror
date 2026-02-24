# IDE Gap Analysis — Voice Mirror Lens vs Real IDEs

> Internal doc. Tracks what Voice Mirror's Lens workspace has vs what VS Code / Zed / Cursor offer.
>
> Last updated: 2026-02-23

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
| LSP (diagnostics, hover, completion) | Full | Full | Tier 1 done | Tier 2 pending |
| Go-to-definition | Full | Full | Full | None |
| Find references | Full | Full | Full | None |
| Rename symbol | Full | Full | Full | None |
| Code actions | Full | Full | Full | None |
| Document outline | Full | Full | Full | None |
| Git status + diff | Full | Full | Stage/Commit/Push + AI | Minor gaps |
| Global text search | Full | Full | Full | None |
| Split editor | Full | Full | None | High |
| Multi-cursor | Full | Full | Full | None |
| Debug adapter (DAP) | Full | Partial | None | Low priority |
| Extensions/plugins | Massive | Growing | None | Not planned |
| Command palette (commands) | Full | Full | 6 commands | Medium |
| Terminal | Full | Partial | Rich (tabs) | Minor gaps |
| Minimap | Full | Full | Diff only | Low |
| Breadcrumbs | Full | Full | None | Low |
| Find & replace (in file) | Full | Full | Full | None |

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

### 3. Split Editor (Side-by-Side Files) — HIGH

**What real IDEs have:** Drag a tab to the side to split the editor area. View two files simultaneously. Essential for comparing implementations, writing tests alongside code, or referencing an interface while implementing it.

**What we have:** Single editor view. Only one tab's content is visible at a time. The layout is a fixed 3-panel split (Chat | Editor/Preview | FileTree) with terminal below.

**Why it matters:** Comparing two files requires flipping between tabs, which breaks flow. Writing a test file while looking at the implementation is a core workflow.

**What's needed:**
- Editor area needs to support 1-2 editor panes (horizontal or vertical split)
- Tab drag-to-split gesture or a "Split Right" command
- Each pane maintains its own active tab
- `SplitPanel.svelte` already exists and could be reused

**Estimated scope:** Large — requires rethinking the editor area layout in LensWorkspace.svelte and managing two independent editor instances with their own tab bars.

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

**Status:** Core git workflow implemented. Changes tab shows staged/unstaged groups with stage/unstage/discard actions, commit panel with AI-powered message generation, branch indicator, and push support.

**Backend:** 9 new Rust commands (`git_stage`, `git_unstage`, `git_stage_all`, `git_unstage_all`, `git_commit`, `git_discard`, `git_push`, `git_diff_staged`, `generate_commit_message`). Modified `get_git_changes` to parse staged vs unstaged status separately + return branch name.

**Frontend:** `GitCommitPanel.svelte` with branch indicator, commit textarea, AI sparkle button (provider-agnostic — works with any configured API/local LLM), Commit and Commit & Push buttons. FileTree Changes tab overhauled with staged/unstaged groups and hover-reveal action buttons.

**Still missing (future):** Branch switching, pull, merge conflict resolution, inline blame, commit history, hunk staging.

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
| 4 | Split editor | High | Large | Key workflow for test+implementation. |
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

The strategy: close the top gaps so Lens is **comfortable enough** for real coding, then double down on the voice+AI features no one else has. Done: ~~find/replace~~ ✓, ~~multi-cursor~~ ✓, ~~global search~~ ✓, ~~git stage+commit~~ ✓. Remaining: split editor, command palette expansion.
