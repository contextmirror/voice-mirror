# Terminal High-Priority Features Design

> **Date:** 2026-02-27
> **Branch:** feature/lens
> **Status:** Approved
> **Scope:** 5 high-priority terminal features from gap analysis

## Features

1. Tab close button
2. Grid splits (H + V, unlimited, replaces 2-pane hardcode)
3. Terminal persistence (layout + config, fresh PTYs on restart)
4. Find in terminal (Ctrl+F search with canvas overlay)
5. Clickable URLs and file paths (link providers)

## Implementation Order

Features are ordered by dependency and risk. Each builds on the previous.

### Feature 1: Tab Close Button

**Scope:** `TerminalTabStrip.svelte`

Add an X button to each group tab. Appears on hover only (like VS Code). Clicking kills all instances in the group. Middle-click on tab also closes. Dev-server terminals show confirmation toast before killing.

**Last-group safety:** When closing the last group, auto-create a fresh terminal.

**Tests:** Source-inspection tests — button element exists, click handler wired, middle-click handler present.

### Feature 2: Grid Splits (H + V, Recursive Tree)

**Scope:** New `split-tree.js`, modified `terminal-tabs.svelte.js`, modified `TerminalPanel.svelte`, modified `TerminalSidebar.svelte`, modified `TerminalContextMenu.svelte`, modified `TerminalActionBar.svelte`

Replace the flat `instanceIds[]` array per group with a recursive split tree:

```
SplitNode =
  | { type: 'leaf', instanceId: string }
  | { type: 'split', direction: 'horizontal' | 'vertical', ratio: 0.5, children: [SplitNode, SplitNode] }
```

**New module: `src/lib/split-tree.js`** (pure JS, no Svelte runes)

Pure functions for all tree operations:
- `createLeaf(instanceId)` → leaf node
- `splitLeaf(tree, targetInstanceId, newInstanceId, direction)` → new tree with split
- `removeLeaf(tree, instanceId)` → new tree with node removed, rebalanced
- `findLeaf(tree, instanceId)` → leaf node or null
- `getAllInstanceIds(tree)` → string[] of all instance IDs in tree order
- `serialize(tree)` → JSON-safe object
- `deserialize(data)` → SplitNode
- `getDepth(tree)` → number
- `MAX_DEPTH = 3` (cap ~8 panes per group)

**Split commands:**
- "Split Right" → vertical split alongside focused instance
- "Split Down" → horizontal split below focused instance
- Context menu and action bar get both options
- Keyboard: Ctrl+Shift+5 = split right, Ctrl+Shift+- = split down

**TerminalPanel rendering:** Recursive component or recursive function that renders each SplitNode. Split nodes render a SplitPanel with two children. Leaf nodes render a Terminal instance.

**Store migration:** `terminal-tabs.svelte.js` group shape changes from `{ id, instanceIds }` to `{ id, splitTree }`. Legacy compat: if a group has `instanceIds` but no `splitTree`, convert on load.

**Tests:** Direct-import unit tests for every `split-tree.js` function. Edge cases: split at max depth (rejected), remove last leaf (returns null), remove from 2-node split (promotes sibling), deep nested removal, serialize/deserialize round-trip.

### Feature 3: Terminal Persistence

**Scope:** `terminal-tabs.svelte.js`, `config.svelte.js` / Rust config schema

Save terminal layout state to the config system. Restore on app startup.

**What's persisted:**
- Groups: order, active group ID
- Per-instance: title, custom name, color, icon, profile ID
- Split tree per group (serialized)
- Active instance per group

**What's NOT persisted:** PTY sessions, scrollback, running processes.

**Storage:** New `terminalLayout` key in config. Shape:

```json
{
  "terminalLayout": {
    "groups": [
      {
        "id": "g1",
        "splitTree": { "type": "leaf", "instanceId": "i1" },
        "instances": {
          "i1": { "title": "Terminal 1", "color": null, "icon": null, "profileId": "git-bash" }
        }
      }
    ],
    "activeGroupId": "g1"
  }
}
```

**Save triggers:** Structural changes (add/remove group, add/remove instance, rename, recolor, re-icon, move, split, unsplit). Debounced 500ms to avoid rapid-fire saves.

**Restore flow:** On startup, read `terminalLayout` from config. For each group, for each instance in the split tree, spawn a fresh shell with the saved profile ID. Apply saved name, color, icon. If a saved profile ID no longer exists, fall back to the default profile.

**Rust schema:** Add `terminal_layout` field to config schema (serde `camelCase`). Type: `Option<Value>` (opaque JSON — frontend owns the shape).

**Tests:** Round-trip serialize/deserialize tests. Restore with missing profile (fallback). Restore empty layout (creates fresh terminal). Migration from pre-persistence config (no `terminalLayout` key).

### Feature 4: Find in Terminal (Ctrl+F)

**Scope:** New `TerminalSearch.svelte`, new `src/lib/terminal-search.js`, modified `Terminal.svelte`, modified `AiTerminal.svelte`

**Search logic: `src/lib/terminal-search.js`** (pure JS, no Svelte runes)

Functions:
- `searchBuffer(getLine, lineCount, query, options)` → `{ matches: [{row, startCol, endCol}], total }`
  - `getLine(y)` callback abstracts over ghostty-web buffer access
  - `options`: `{ caseSensitive: boolean, regex: boolean }`
- `getMatchIndex(matches, currentRow, currentCol)` → index of nearest match
- `nextMatch(matches, currentIndex)` → next index (wraps)
- `prevMatch(matches, currentIndex)` → prev index (wraps)

**Search bar: `TerminalSearch.svelte`**

Floating overlay positioned at top-right of terminal container. Contains:
- Text input (auto-focused on open)
- Match count display ("X of Y")
- Previous / Next buttons (up/down arrows)
- Case sensitivity toggle (Aa button)
- Regex toggle (.\* button)
- Close button (X)

**Keyboard shortcuts:**
- Ctrl+F → open search (or focus input if already open)
- Escape → close search
- Enter → next match
- Shift+Enter → previous match
- Alt+C → toggle case sensitivity (while search focused)
- Alt+R → toggle regex (while search focused)

**Highlight rendering:** Canvas overlay drawn on top of ghostty-web's canvas.

After each search, compute pixel rectangles for each match using terminal cell dimensions (`cellWidth`, `cellHeight` from ghostty-web font metrics). Draw semi-transparent rectangles:
- All matches: yellow at 30% opacity
- Current match: orange at 50% opacity

The overlay canvas is positioned absolutely over the terminal canvas. Redrawn on: search query change, scroll, terminal resize, terminal output.

**Alternate screen:** Search works in alt screen mode but only searches visible rows (no scrollback in alt screen).

**Scroll to match:** When navigating to a match in scrollback, scroll the terminal viewport to bring the match row into view.

**Tests:** Direct-import unit tests for `terminal-search.js`:
- Basic string search, case sensitive/insensitive
- Regex search, invalid regex handling
- Multiple matches on same line
- Matches across scrollback + viewport
- Empty query returns no matches
- Unicode/emoji in search terms
- Next/prev wrapping
- `getMatchIndex` nearest-match logic

### Feature 5: Clickable URLs and File Paths

**Scope:** New `src/lib/terminal-links.js`, modified `Terminal.svelte`, modified `AiTerminal.svelte`

**Link detection: `src/lib/terminal-links.js`** (pure JS)

Two detection functions:
- `detectURLs(text)` → `[{ start, end, url }]`
  - Matches `https?://` URLs, handles parens, strips trailing punctuation
- `detectFilePaths(text, cwd)` → `[{ start, end, path, line, col }]`
  - Matches patterns: `path:line:col`, `path:line`, `path(line,col)`, `path(line)`
  - Windows paths: `C:\foo\bar.rs:42`, `.\src\App.svelte`
  - Unix paths: `./src/App.svelte:42:5`, `/home/user/file.js`
  - Relative paths resolved against `cwd`

**Integration with ghostty-web:** Register `ILinkProvider` instances on each terminal:
- `URLLinkProvider` — calls `detectURLs()` per line
- `FileLinkProvider` — calls `detectFilePaths()` per line

Links show underline on hover. Ctrl+Click activates (configurable — some users prefer single-click).

**Link actions:**
- URL → open in system default browser via Tauri `shell.open()`
- File path → open in Lens file editor at line:col via `lensStore.openFile(path, line, col)`
  - If file doesn't exist, no-op (don't error)

**Tests:** Direct-import unit tests for both detection functions:
- URL: basic http/https, query strings, fragments, parentheses in URLs, markdown-style `[text](url)`, trailing comma/period stripping, IP addresses, ports
- File paths: relative Unix, relative Windows, absolute Unix, absolute Windows, with line, with line:col, with (line,col), paths with spaces (quoted), paths inside ANSI output (stripped), no false positives on common English words

## Testing Summary

| Feature | Test Type | Test File | Count (est.) |
|---------|-----------|-----------|-------------|
| Tab close | Source-inspection | `test/components/terminal-tab-strip.cjs` | ~8 |
| Split tree | Direct-import unit | `test/unit/split-tree.mjs` | ~25 |
| Persistence | Direct-import unit + source-inspection | `test/unit/terminal-persistence.mjs`, `test/stores/terminal-tabs.cjs` | ~15 |
| Find in terminal | Direct-import unit | `test/unit/terminal-search.mjs` | ~20 |
| Clickable links | Direct-import unit | `test/unit/terminal-links.mjs` | ~30 |
| **Total** | | | **~98 new tests** |

## Risk Assessment

| Feature | Risk | Mitigation |
|---------|------|------------|
| Grid splits | **High** — replaces core data model | Pure-JS module with 25+ unit tests. Legacy compat layer. |
| Find in terminal | **Medium** — canvas overlay timing | Search logic fully testable. Overlay is visual-only. |
| Persistence | **Medium** — config schema change | Opaque JSON value (frontend owns shape). Graceful fallback on missing data. |
| Clickable links | **Low** — additive, no existing code changes | Link providers are opt-in. Regex edge cases covered by tests. |
| Tab close button | **Low** — small UI addition | Source-inspection tests. Last-group safety net. |

## Files Changed (Estimated)

**New files (7):**
- `src/lib/split-tree.js`
- `src/lib/terminal-search.js`
- `src/lib/terminal-links.js`
- `src/components/terminal/TerminalSearch.svelte`
- `test/unit/split-tree.mjs`
- `test/unit/terminal-search.mjs`
- `test/unit/terminal-links.mjs`

**Modified files (~10):**
- `src/components/terminal/TerminalTabStrip.svelte` — close button
- `src/components/terminal/TerminalPanel.svelte` — recursive split rendering
- `src/components/terminal/TerminalSidebar.svelte` — tree from splitTree
- `src/components/terminal/TerminalContextMenu.svelte` — split direction options
- `src/components/terminal/TerminalActionBar.svelte` — split direction dropdown
- `src/components/terminal/Terminal.svelte` — search overlay, link providers
- `src/components/terminal/AiTerminal.svelte` — search overlay, link providers
- `src/lib/stores/terminal-tabs.svelte.js` — split tree model, persistence
- `src-tauri/src/config/schema.rs` — terminal_layout field
- `test/components/terminal-tab-strip.cjs` — new tests
- `test/stores/terminal-tabs.cjs` — updated tests
