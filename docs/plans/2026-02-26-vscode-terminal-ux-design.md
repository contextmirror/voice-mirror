# VS Code-Style Terminal UX — Design Document

**Date**: 2026-02-26
**Status**: Approved
**Reference**: `docs/reference/VSCODE-TERMINAL-ANALYSIS.md`

---

## Goal

Replace Voice Mirror's per-tab shell system with a VS Code-style terminal panel that supports multiple instances, horizontal split panes, terminal profiles, customization (colors, icons, renaming), and full keyboard shortcuts. Rename all "shell" references to "terminal" throughout the codebase.

## Architecture

### Bottom Tab Strip (Outer)

Three permanent pinned tabs:

```
[ Voice Agent ]  [ Output ]  [ Terminal ]
```

- **Voice Agent**: AI provider PTY (unchanged)
- **Output**: Backend log channels (unchanged)
- **Terminal**: New VS Code-style terminal panel

No `+` button in the outer strip. Individual terminal instances are managed INSIDE the Terminal panel.

### Terminal Panel (Inner)

When the "Terminal" tab is active, the panel shows:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [ bash ]  [ powershell ˅ ]              [+ ˅] [···] [⤢]               │ ← tab strip + action bar
│ ┌────────────────────┬──────────────────┐   bash                       │
│ │ PS E:\Projects>    │ PS E:\Projects>  │ ┌ powershell                 │ ← sidebar instance list
│ │ $ _                │ $ _             │ └ powershell                  │
│ └────────────────────┴──────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Left**: Group tab strip showing terminal groups
- **Center**: Active group's terminal panes (horizontal SplitPanel for splits)
- **Right**: Sidebar instance list with tree characters (`┌├└`) showing split relationships
- **Top-right**: Action bar (`+` dropdown, `···` overflow, maximize)

### Data Model

```
TerminalGroup {
  id: string              // "group-1"
  instanceIds: string[]   // ordered list of instances in this group
}

TerminalInstance {
  id: string              // "terminal-1"
  groupId: string
  title: string           // "bash", user-set name
  profileId: string       // "git-bash", "powershell"
  icon: string            // icon identifier
  color: string|null      // custom tab color
  shellId: string         // PTY session ID from Rust backend
  running: boolean
}
```

**Store state** (enhanced `terminal-tabs.svelte.js`):
- `groups: TerminalGroup[]`
- `instances: Map<string, TerminalInstance>`
- `activeGroupId: string|null`
- `activeInstanceId: string|null` (focused pane within active group)

### Key Operations

| Action | Effect |
|--------|--------|
| New Terminal (`+`) | Create new group with 1 instance |
| Split Terminal | Add instance to active group |
| Kill Terminal | Remove instance; if group empty, remove group |
| Unsplit | Keep focused instance, kill others in group |
| Focus pane | Set `activeInstanceId` within group |
| Click group tab | Set `activeGroupId`, show that group's split layout |

### First Open Behavior

On first click of Terminal tab (or app startup), auto-spawn one terminal instance using the default profile. Single group, single instance.

### Sidebar Visibility

- 1 group, 1 instance → sidebar hidden
- 2+ groups OR any splits → sidebar visible

---

## Splits

**Horizontal only** (side-by-side panes within a group). Uses existing `SplitPanel` component.

- 1 instance → full width
- 2 instances → SplitPanel with 2 panes
- 3+ instances → nested SplitPanel

Each pane renders a `Terminal.svelte` connected to its PTY.

---

## Menus

### `+` Dropdown

```
New Terminal                    Ctrl+Shift+'
Split Terminal                  Ctrl+Shift+5
───────────────────────────────
Git Bash                        (detected)
PowerShell                      (detected)
Command Prompt                  (detected)
Split Terminal with Profile  →  [submenu]
───────────────────────────────
Configure Terminal Settings
Select Default Profile
```

### `···` Overflow Menu

```
Clear Terminal
───────────────────────────────
Run Active File
Run Selected Text
```

### Tab/Instance Right-Click Context Menu

```
Split Terminal                  Ctrl+Shift+5
───────────────────────────────
Change Color...
Change Icon...
Rename...                       F2
───────────────────────────────
Kill Terminal                   Delete
Unsplit Terminal
```

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Terminal | Ctrl+Shift+' |
| Split Terminal | Ctrl+Shift+5 |
| Toggle Terminal Panel | Ctrl+` |
| Focus Previous Pane | Alt+Left |
| Focus Next Pane | Alt+Right |
| Clear Terminal | Ctrl+L |
| Rename Tab | F2 |
| Kill Terminal | Delete |
| Next Group | Ctrl+Tab |
| Previous Group | Ctrl+Shift+Tab |

---

## Profile System

### Detection (Rust Backend)

New command: `terminal_detect_profiles`

**Windows**: Git Bash (existing `find_git_bash()`), PowerShell (`where powershell.exe`/`pwsh.exe`), Command Prompt (`cmd.exe`), WSL (`wsl.exe --list`)
**macOS**: zsh, bash, fish, sh (from `$SHELL` + `/etc/shells`)
**Linux**: bash, zsh, fish, sh (from `$SHELL` + `/etc/shells`)

### Profile Structure

```rust
struct TerminalProfile {
    id: String,
    name: String,
    path: String,
    args: Vec<String>,
    icon: String,
    color: Option<String>,
    is_default: bool,
    is_builtin: bool,    // auto-detected vs user-created
}
```

### Storage

Config section `terminal.defaultProfile` and `terminal.profiles` (user-created only). Built-in profiles re-detected on launch.

### Settings UI

New section in Settings → Terminal Profiles: list detected + custom profiles, add/edit/delete, set default.

### Spawn Integration

`terminal_spawn` gains optional `profile_id` parameter. Uses profile's shell path + args if given, otherwise default profile.

---

## Customization

### Tab Colors

Predefined palette (theme-aware) + custom hex input. Applied as colored indicator on tab/sidebar entry.

### Tab Icons

Selection from available icon set. Default based on shell type (bash icon, powershell icon, etc.).

### Renaming

F2 on focused tab → inline edit. Enter saves, Escape cancels, blur saves.

---

## Rename: Shell → Terminal

Full rename across all layers:

| Layer | Old | New |
|-------|-----|-----|
| UI labels | "Shell 1" | "Terminal 1" (or profile name) |
| Tab types | `type: 'shell'` | `type: 'terminal'` |
| Components | `ShellTerminal.svelte` | `Terminal.svelte` |
| AI component | `Terminal.svelte` | `AiTerminal.svelte` |
| Store methods | `addShellTab()` | `addTerminalTab()` / `addGroup()` |
| Rust commands | `shell_spawn/input/resize/kill/list` | `terminal_spawn/input/resize/kill/list` |
| Rust module | `commands/shell.rs`, `shell/mod.rs` | `commands/terminal.rs`, `terminal/mod.rs` |
| API wrappers | `shellSpawn()`, etc. | `terminalSpawn()`, etc. |
| Event names | `shell-output` | `terminal-output` |
| Tests | shell references | terminal references |

---

## Output Tab Relationship

Output and Terminal are completely independent:

| | Output Tab | Terminal Instance |
|--|-----------|-----------------|
| Source | Rust `tracing` log events | PTY stdout |
| Content | App diagnostics | Shell commands + output |
| Per-instance? | No (global channels) | Yes (each PTY) |
| Persistence | Ring buffer + JSONL | Terminal scrollback |

---

## Scope Exclusions (Deferred)

- Terminal in editor area (move to editor tab)
- Shell integration (command detection, recent dirs/commands)
- Run Task / Configure Tasks
- Terminal search (find in scrollback)
- Start Dictation
- Vertical splits

---

## New Files

| File | Purpose |
|------|---------|
| `src/components/terminal/TerminalPanel.svelte` | Inner panel (splits + sidebar + action bar) |
| `src/components/terminal/TerminalSidebar.svelte` | Instance list with tree characters |
| `src/components/terminal/TerminalActionBar.svelte` | `+` dropdown, `···` menu |
| `src/components/terminal/TerminalTabStrip.svelte` | Group tabs within panel |
| `src/components/terminal/TerminalContextMenu.svelte` | Right-click context menu |
| `src/components/terminal/TerminalColorPicker.svelte` | Color selection popup |
| `src/components/terminal/TerminalIconPicker.svelte` | Icon selection popup |
| `src/lib/stores/terminal-profiles.svelte.js` | Profile detection + management |
| `src-tauri/src/commands/terminal.rs` | Renamed + new commands |

## Modified Files

| File | Changes |
|------|---------|
| `TerminalTabs.svelte` | Simplified to 3 pinned tabs, delegates to TerminalPanel |
| `Terminal.svelte` → `AiTerminal.svelte` | Renamed |
| `ShellTerminal.svelte` → `Terminal.svelte` | Renamed + enhanced |
| `terminal-tabs.svelte.js` | Group/instance/split model |
| `api.js` | shell* → terminal*, profile commands |
| `shell/mod.rs` → `terminal/mod.rs` | Renamed + profile detection |
| `lib.rs` | Command registration updates |
| `config.svelte.js` | Terminal config section |
| `schema.rs` | Terminal profile schema |
| Tests | shell → terminal references |
