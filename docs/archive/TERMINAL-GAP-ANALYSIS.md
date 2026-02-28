# Terminal Gap Analysis: Voice Mirror vs VS Code

> **Date:** 2026-02-27
> **Branch:** feature/lens
> **Scope:** Comparison of Voice Mirror's terminal system against VS Code's integrated terminal

## Executive Summary

Voice Mirror's terminal system implements the **core essentials** well — PTY management, split panes, sidebar tree, tab coloring/icons, drag-to-reorder, profile detection, and dev-server integration. However, VS Code's terminal has **90+ commands** and **35+ feature categories** built over 10+ years. This document identifies every gap, categorized by priority.

**Legend:**
- ✅ Implemented (feature parity or close)
- ⚠️ Partial (basic version exists, missing depth)
- ❌ Missing (not implemented at all)

---

## What We Have (Working Features)

| Feature | Status | Notes |
|---------|--------|-------|
| PTY spawn/kill/resize | ✅ | Full lifecycle via Rust backend |
| Shell profile detection | ✅ | Git Bash, PowerShell, CMD auto-detected |
| Split panes (horizontal) | ✅ | SplitPanel with draggable divider |
| Sidebar tree view | ✅ | Box-drawing chars (┌├└), instance tree |
| Drag-to-reorder | ✅ | Within group + cross-group moves |
| Tab coloring (9 colors) | ✅ | Theme-aware color picker |
| Tab icons (15 icons) | ✅ | Semantic icon picker |
| Tab renaming | ✅ | Via prompt dialog or F2 |
| Context menus | ✅ | Right-click on sidebar items + tabs |
| Action bar with dropdown | ✅ | New, Split, profile list, overflow menu |
| Theme integration | ✅ | ANSI colors mapped from design tokens |
| Dev server integration | ✅ | Type tracking, kill confirmation, auto-hide |
| ghostty-web WASM renderer | ✅ | Canvas-based, high performance |
| AI terminal (separate) | ✅ | Dedicated PTY for Claude Code/OpenCode |
| 3-tab outer strip | ✅ | Voice Agent / Output / Terminal |
| Scrollback buffer | ✅ | 5000 lines |
| Ctrl+C/V in terminal | ✅ | Copy selection / paste |
| Panel tab cycling | ✅ | Ctrl+Tab / Ctrl+Shift+Tab |

---

## Gap Analysis by Category

### 1. Terminal Creation & Locations

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Terminal in editor area (as tab) | ✅ Opens terminal as editor tab alongside files | ❌ Terminals only in bottom panel | Medium |
| New terminal with specific CWD | ✅ `NewWithCwd` command | ❌ Always uses project root | Low |
| New terminal in new window | ✅ `NewInNewWindow` | ❌ Single window app | N/A |
| Quick terminal picker | ✅ `Select` — fuzzy search all terminals | ❌ No search/filter | Medium |
| Relaunch terminated terminal | ✅ `Relaunch` — restart with same config | ❌ Must create new | Low |

### 2. Splits & Panes

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Max split count | ✅ Unlimited panes per group | ⚠️ **Max 2 per group** (hardcoded) | High |
| Vertical splits | ✅ Both horizontal and vertical | ❌ Horizontal only | Medium |
| Resize panes by keyboard | ✅ `ResizePaneLeft/Right/Up/Down` (4-cell increments) | ❌ Mouse drag only | Medium |
| Size to content width | ✅ Auto-fit terminal width to content | ❌ Not implemented | Low |
| Set exact dimensions | ✅ `SetDimensions` (cols × rows) | ❌ Not implemented | Low |
| Join/unsplit commands | ✅ `Join`, `Unsplit`, `JoinActiveTab` | ✅ `unsplitGroup` (keeps active, moves rest to own groups) | Low |

### 3. Tabs & Sidebar

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Tab close button | ✅ X button on each tab | ❌ Close only via context menu or sidebar hover | High |
| Multi-select tabs | ✅ Shift/Ctrl+click for batch operations | ❌ Single selection only | Low |
| Detailed/simple view toggle | ✅ Switch between compact and detailed sidebar | ❌ Single view | Low |
| Tab visibility settings | ✅ `never`, `singleTerminal`, `singleGroup` | ❌ Always visible | Low |
| Focus mode (single/double click) | ✅ Configurable | ❌ Always single-click | Low |
| Kill all terminals | ✅ `KillAll`, `KillOthers` | ❌ One at a time only | Medium |
| Sidebar auto-show threshold | ⚠️ Always visible | ✅ Auto-shows at 2+ groups or splits | ✅ Better |
| Tab status indicators | ✅ Error/warning badges, process state | ❌ No status indicators | Medium |

### 4. Find / Search in Terminal

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Find in terminal (Ctrl+F) | ✅ Full find widget with highlighting | ❌ **Not implemented** | **High** |
| Case-sensitive search | ✅ Toggle | ❌ | High |
| Regex search | ✅ Toggle | ❌ | Medium |
| Match count (X of Y) | ✅ Counter display | ❌ | High |
| Previous/next match | ✅ Navigation buttons | ❌ | High |
| Highlight all matches | ✅ All matches highlighted | ❌ | High |

> **This is the single biggest missing feature.** Users rely on find-in-terminal constantly for searching command output, log files, build errors, etc.

### 5. Shell Integration & Command Detection

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Command detection | ✅ Identifies individual commands and boundaries | ❌ | Medium |
| Command decorations | ✅ Gutter marks showing success/error per command | ❌ | Medium |
| CWD detection | ✅ Tracks directory changes in real-time | ❌ | Low |
| Scroll to previous/next command | ✅ Jump between commands in output | ❌ | Medium |
| Run recent command | ✅ Quick-pick of recent commands | ❌ | Low |
| Copy last command output | ✅ `CopyLastCommandOutput` | ❌ | Medium |
| Sticky scroll | ✅ Pin command at top while scrolling output | ❌ | Low |

> Shell integration is a large feature area. VS Code injects shell scripts (bash, zsh, fish, PowerShell) that emit OSC escape sequences to report command boundaries. This would require both backend (sequence parsing) and frontend (decoration rendering) work.

### 6. Links & File Detection

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Clickable URLs | ✅ Auto-detect and open in browser | ❌ | **High** |
| Clickable file paths | ✅ Click to open file at line:col | ❌ | **High** |
| Error/warning links | ✅ Extract actionable links from compiler output | ❌ | Medium |
| Custom URI schemes | ✅ Configurable allowed schemes | ❌ | Low |

> ghostty-web may already detect URLs at the WASM level but we're not wiring up click handlers.

### 7. Clipboard & Selection

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Copy selection | ✅ Ctrl+C (with selection) | ✅ | — |
| Paste | ✅ Ctrl+V | ✅ | — |
| Copy as HTML | ✅ Preserves formatting and colors | ❌ | Low |
| Copy last command | ✅ `CopyLastCommand` | ❌ | Low |
| Copy last command output | ✅ `CopyLastCommandOutput` | ❌ | Medium |
| Select all | ✅ `SelectAll` | ❌ | Medium |
| Right-click paste | ✅ Configurable right-click behavior | ❌ | Low |
| Middle-click paste | ✅ Configurable | ❌ | Low |

### 8. Keyboard & Input

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Ctrl+C/V | ✅ | ✅ | — |
| New terminal shortcut | ✅ Ctrl+Shift+` (default) | ⚠️ Registered but no default binding | Medium |
| Split shortcut | ✅ | ✅ Ctrl+Shift+5 | — |
| Focus prev/next pane | ✅ | ⚠️ Registered, no default binding | Medium |
| Focus terminal by index (1-9) | ✅ Alt+1 through Alt+9 | ❌ | Low |
| Delete word left/right | ✅ `DeleteWordLeft`, `DeleteWordRight` | ❌ (shell handles) | Low |
| Send custom sequence | ✅ `SendSequence` command | ❌ | Low |
| Keybinding passthrough config | ✅ `commandsToSkipShell` (90+ commands) | ❌ | Medium |
| Kitty keyboard protocol | ✅ Optional | ❌ | Low |

### 9. Rendering & Display

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Canvas rendering | ✅ xterm.js WebGL | ✅ ghostty-web WASM canvas | — |
| GPU acceleration toggle | ✅ `auto`/`on`/`off` | ❌ Always on (WASM) | Low |
| Font configuration | ✅ family, size, weight, ligatures, letter spacing | ❌ Uses system/theme defaults | Medium |
| Cursor style options | ✅ block, underline, line + inactive style | ⚠️ Hidden for AI (TUI renders own), bar for user terminals | Low |
| Cursor blinking | ✅ Configurable | ❌ | Low |
| Minimum contrast ratio | ✅ Enforce readable contrast | ❌ | Low |
| Smooth scrolling | ✅ Animated scroll | ❌ | Low |
| Scrollbar visibility | ✅ Configurable | ❌ | Low |
| Inline images (Sixel) | ✅ `enableImages` | ❌ | Low |
| Bold as bright colors | ✅ `drawBoldTextInBrightColors` | ❌ | Low |
| Unicode version | ✅ 6 or 11 configurable | ❌ | Low |

### 10. Terminal Persistence

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Restore terminals on restart | ✅ Persistent sessions with revival | ❌ **All terminals lost on restart** | **High** |
| Session revival modes | ✅ `onExit`, `onExitAndWindowClose`, `never` | ❌ | High |
| Layout persistence | ✅ Groups, splits, positions restored | ❌ | High |
| Detach/attach sessions | ✅ `DetachSession`, `AttachToSession` | ❌ | Low |
| Remember renamed tabs | ❌ (VS Code also resets) | ❌ Names lost on restart | Low |

> This is one of the most impactful gaps. Losing all terminal state on restart forces users to manually recreate their terminal setup every session.

### 11. Environment Variables

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Per-terminal env vars | ✅ Configurable per platform | ❌ Inherits parent process env | Low |
| Stale env indicator | ✅ Shows when env changed since terminal created | ❌ | Low |
| Extension env contributions | ✅ Extensions can add env vars | ❌ N/A (no extension system) | N/A |
| Default CWD config | ✅ `terminal.integrated.cwd` | ❌ Uses project root | Low |

### 12. Theming & Colors

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| ANSI color mapping | ✅ 16 colors | ✅ 16 colors from design tokens | — |
| Selection colors | ✅ Active + inactive | ⚠️ Active only (accent @ 30% opacity) | Low |
| Tab colors | ✅ | ✅ 9 colors | — |
| Tab icons | ✅ Full codicon set (400+) | ⚠️ 15 hardcoded icons | Medium |
| Named color palettes | ✅ 8 palettes (dracula, nord, etc.) | ❌ Single palette from theme | Low |
| Configurable cursor colors | ✅ Separate fg/bg | ⚠️ Uses `--accent` only | Low |
| Find match colors | ✅ Dedicated colors | ❌ (no find feature) | — |

### 13. Accessibility

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Screen reader mode | ✅ Full accessible buffer | ❌ | Medium |
| ARIA labels | ✅ Comprehensive | ⚠️ Basic | Medium |
| Terminal bell (visual/audio) | ✅ Configurable | ❌ | Low |
| High contrast mode | ✅ Full support | ❌ | Low |
| Keyboard-only navigation | ✅ Full | ⚠️ Some features mouse-only | Medium |

### 14. Context Menu Completeness

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Copy / Paste / Select All | ✅ In terminal context menu | ❌ Only via keyboard | Medium |
| Clear terminal | ✅ In context menu | ⚠️ Only in action bar overflow | Low |
| Kill from context menu | ✅ + Kill All, Kill Others | ✅ Kill only | Low |
| Move to editor | ✅ `MoveToEditor` | ❌ | N/A |
| Split from context menu | ✅ | ✅ | — |
| Change icon/color | ✅ | ✅ | — |
| Run selected text | ✅ Select in editor → run in terminal | ❌ | Low |

### 15. Process & Lifecycle

| Feature | VS Code | Voice Mirror | Priority |
|---------|---------|-------------|----------|
| Exit confirmation | ✅ `confirmOnExit`, `confirmOnKill` | ⚠️ Only for dev servers | Medium |
| Show exit alert | ✅ `showExitAlert` with error display | ⚠️ Prints "[Shell exited with code X]" | Low |
| Ignore process names on close | ✅ Configurable process whitelist | ❌ | Low |
| Process info on hover | ✅ PID, command, CWD in tooltip | ❌ | Low |

---

## Priority Summary

### 🔴 High Priority (Major UX Impact)

1. **Find in terminal** — Users can't search command output. This is used constantly for scanning build errors, log output, and grep results. (Category 4)

2. **Clickable URLs and file paths** — Terminal output with URLs and file paths should be interactive. Compiler errors with file:line should open in the editor. (Category 6)

3. **Terminal persistence across restarts** — All terminal state (groups, splits, names, colors) lost on app restart. Users must recreate their workspace every time. (Category 10)

4. **More than 2 splits per group** — Hardcoded to max 2 panes. Power users need 3-4 splits regularly. (Category 2)

5. **Tab close button** — No visual close affordance on tabs. Must right-click → Kill or hover sidebar. (Category 3)

### 🟡 Medium Priority (Noticeable Gaps)

6. **Font configuration** — No way to change terminal font family, size, or weight. (Category 9)
7. **Kill all terminals** — Can only kill one at a time. (Category 3)
8. **Default keyboard bindings** — New terminal and focus pane shortcuts registered but unbound. (Category 8)
9. **Tab status indicators** — No error/warning badges or process state on tabs. (Category 3)
10. **Select All in terminal** — No way to select all terminal output. (Category 7)
11. **Terminal quick picker** — No fuzzy search to jump between terminals. (Category 3)
12. **Shell integration basics** — Command detection would enable "scroll to command", "copy output", and command decorations. (Category 5)
13. **Vertical splits** — Only horizontal splits available. (Category 2)
14. **Keyboard pane resize** — Can't resize split panes without mouse. (Category 2)
15. **Larger icon set** — Only 15 icons vs VS Code's 400+ codicons. (Category 12)
16. **Copy/Paste in context menu** — Right-click in terminal has no copy/paste. (Category 14)
17. **Exit confirmation for user terminals** — Only dev servers get confirmation. (Category 15)
18. **Accessibility basics** — Missing screen reader support and ARIA labels. (Category 13)

### 🟢 Low Priority (Nice-to-Have)

19. Terminal in editor area
20. Copy as HTML
21. New terminal with specific CWD
22. Relaunch terminated terminal
23. Right/middle-click paste configuration
24. GPU acceleration toggle
25. Cursor style/blinking options
26. Smooth scrolling
27. Inline images (Sixel)
28. Environment variable management
29. Named color palettes
30. Keybinding passthrough configuration
31. Send custom sequence command
32. Process info on hover tooltip
33. Detach/attach sessions

---

## Known Bugs & Issues in Current Implementation

These are issues found in the current code that should be fixed regardless of the gap analysis:

1. **Rename uses `prompt()` dialog** — Browser-native prompt is ugly and blocks. Should use inline rename (like VS Code's inline input).

2. **Split limit not communicated** — UI doesn't grey out "Split Terminal" when already at max 2. User discovers the limit by trying.

3. **No tab close affordance** — Tabs in `TerminalTabStrip` have no close button or close-on-middle-click.

4. **Context menu positioning** — Fixed positioning can clip on small screens or near panel edges.

5. **Terminal numbering resets** — "Terminal 1", "Terminal 2" etc. recount from gaps, which can cause confusing renumbering when terminals are killed.

6. **Icon/color not persisted** — Custom icons and colors are lost on app restart (no state persistence).

7. **All groups mounted simultaneously** — Every terminal group stays in DOM with `visibility:hidden`. At scale (10+ groups) this wastes memory and PTY resources.

---

## Recommended Implementation Order

Based on user impact and implementation complexity:

### Phase 1: Essential UX (High Impact, Moderate Effort)
1. **Find in terminal** — Integrate search with ghostty-web's text buffer
2. **Clickable links** — URL detection + file path → editor navigation
3. **Tab close button** — Add X button to TerminalTabStrip tabs
4. **Inline rename** — Replace `prompt()` with inline text input

### Phase 2: Persistence & Polish (High Impact, Higher Effort)
5. **Terminal state persistence** — Save/restore groups, instances, names, colors, icons
6. **Unlimited splits** — Replace hardcoded 2-pane SplitPanel with recursive nesting
7. **Vertical splits** — Add orientation option to SplitPanel
8. **Font configuration** — Terminal font settings in config

### Phase 3: Power Features (Medium Impact)
9. **Kill all / Kill others** — Batch terminal operations
10. **Default keybindings** — Bind new-terminal, focus-pane shortcuts
11. **Terminal quick picker** — Ctrl+Shift+T fuzzy search
12. **Copy/Paste in context menu** — Add clipboard actions to right-click
13. **Tab status indicators** — Show running/exited/error state

### Phase 4: Shell Integration (Medium Impact, High Effort)
14. **Command detection** — Parse OSC sequences for command boundaries
15. **Command decorations** — Gutter marks for success/error
16. **Scroll to command** — Navigate between commands
17. **Copy command output** — Copy output of specific commands

### Phase 5: Accessibility & Edge Cases
18. **Screen reader support** — Accessible buffer, ARIA labels
19. **Exit confirmation** — For all terminals, not just dev servers
20. **Larger icon set** — Expand beyond 15 icons
21. **Process info tooltips** — PID, command, CWD on hover

---

## What We Do Better Than VS Code

Not everything is a gap — some things Voice Mirror does differently or better:

| Feature | Advantage |
|---------|-----------|
| **ghostty-web WASM renderer** | Potentially faster than xterm.js WebGL (native Zig VT100 parser) |
| **Sidebar auto-show** | Only appears when needed (2+ groups or splits), saves space |
| **Dev server integration** | First-class dev server terminals with framework detection, port tracking, crash-loop protection, LRU eviction |
| **AI provider terminal** | Dedicated, optimized terminal for TUI AI tools (Claude Code, OpenCode) with SGR mouse filtering |
| **Theme token mapping** | ANSI colors automatically derived from app theme — always consistent |
| **3-tab bottom panel** | Unified Voice Agent + Output + Terminal in one panel (VS Code separates these) |
| **Drag across groups** | Can move terminals between groups via sidebar drag (VS Code requires explicit commands) |

---

## Appendix: Voice Mirror Terminal Architecture

```
TerminalTabs (3-tab outer strip: AI / Output / Terminal)
  ├── AiTerminal (always mounted, ghostty-web for AI provider PTY)
  ├── OutputPanel (tracing log viewer with 5 channels)
  └── TerminalPanel (VS Code-style inner layout)
       ├── TerminalActionBar (new, split, profiles, overflow)
       ├── TerminalTabStrip (group tabs)
       ├── Content area (all groups, inactive = visibility:hidden)
       │    └── SplitPanel (per group, max 2 panes)
       │         ├── Terminal.svelte (instance 1, ghostty-web)
       │         └── Terminal.svelte (instance 2, ghostty-web)
       ├── TerminalSidebar (tree view, drag-to-reorder)
       ├── TerminalContextMenu (right-click on instances)
       ├── TerminalColorPicker (9 colors)
       └── TerminalIconPicker (15 icons)
```

**Stores:** `terminal-tabs.svelte.js` (869 lines, groups/instances/state), `terminal-profiles.svelte.js` (49 lines, shell detection)

**Backend:** `commands/terminal.rs` — 6 commands (`spawn`, `input`, `resize`, `kill`, `detect_profiles`, `list`)

**API:** `api.js` — 7 wrappers (`terminalSpawn`, `terminalInput`, `terminalResize`, `terminalKill`, `terminalDetectProfiles`, `aiRawInput`, `aiPtyResize`)
