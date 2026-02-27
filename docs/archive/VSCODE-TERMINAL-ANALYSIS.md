# VS Code Terminal System — Feature & Architecture Analysis

> Reference document for implementing VS Code-style shell UX in Voice Mirror.
> Source: `E:\Projects\references\VSCode\src\vs\workbench\contrib\terminal\`

---

## 1. Core Architecture

### Instance → Group → Panel Model

VS Code's terminal uses a three-level hierarchy:

```
Terminal Panel (bottom bar)
  └── Terminal Groups (tabs in sidebar list)
       └── Terminal Instances (individual PTYs, split within a group)
```

- **Instance**: Single PTY process + xterm.js renderer. Has `instanceId`, `title`, `icon`, `color`, `processName`.
- **Group**: Container for 1+ instances arranged as horizontal/vertical splits. A group with 1 instance = unsplit. A group with N instances = N split panes.
- **Panel**: The bottom bar housing all groups, with a tab list on the right showing the tree structure.

### Service Hierarchy

```
ITerminalService (global — all instances across panel + editor + background)
  ├── ITerminalGroupService (panel terminals + groups)
  ├── ITerminalEditorService (terminals embedded in editor tabs)
  ├── ITerminalInstanceService (raw instance creation)
  ├── ITerminalProfileService (shell profiles)
  └── ITerminalConfigurationService (settings access)
```

### Event-Driven Communication

All state changes propagate via events:
- `onDidCreateInstance`, `onDidChangeInstances`
- `onAnyInstanceTitleChange`, `onAnyInstanceIconChange`
- `onInstancesChanged` (per group), `onDisposed`

---

## 2. Tab List (Right Sidebar)

The tab list sits on the right side of the terminal panel, showing all groups and their split relationships:

```
┌ powershell        ← Group 1, split into 2 instances
└ powershell
  powershell        ← Group 2, single instance (unsplit)
┌ powershell        ← Group 3, split into 3 instances
├ powershell
└ powershell
```

**Tree characters**: `┌` (first pane), `├` (middle panes), `└` (last pane)

**Tab rendering modes**:
- **Text mode**: icon + title + description (wide enough)
- **Icon-only mode**: just icon (narrow view)

**Tab interactions**:
- Click → activate/focus
- Double-click → rename (inline InputBox)
- Right-click → context menu
- Drag → reorder groups or move instances between groups

**Visibility logic** (`hideCondition` setting):
- `'never'` → always show tabs
- `'singleTerminal'` → hide if only 1 instance
- `'singleGroup'` → hide if only 1 group

---

## 3. Action Bar (Top-Right)

Located at the top-right of the terminal panel:

```
[ + ˅ ]  [ ··· ]  [ ⤢ ]  [ × ]
```

### `+` Button (New Terminal)
Primary action: create new terminal with default profile.

### `˅` Dropdown (Profile Selection)

| Item | Shortcut | Description |
|------|----------|-------------|
| New Terminal | Ctrl+Shift+' | Create with default profile |
| New Terminal Window | Ctrl+Shift+Alt+' | New OS window with terminal |
| Split Terminal | Ctrl+Shift+5 | Split active terminal |
| — | | |
| PowerShell | | Create with this profile |
| Git Bash | | Create with this profile |
| Command Prompt | | Create with this profile |
| JavaScript Debug Terminal | | Create with this profile |
| Split Terminal with Profile → | | Submenu: split with specific profile |
| — | | |
| Configure Terminal Settings | | Opens settings.json terminal section |
| Select Default Profile | | Quick pick to change default |
| — | | |
| Run Task... | | Run configured task |
| Configure Tasks... | | Edit tasks.json |

### `···` Overflow Menu

| Item | Shortcut | Description |
|------|----------|-------------|
| Scroll to Previous Command | Ctrl+UpArrow | Shell integration required |
| Scroll to Next Command | Ctrl+DownArrow | Shell integration required |
| Clear Terminal | | Clears screen + scrollback |
| Run Active File | | Execute current editor file |
| Run Selected Text | | Send selection to terminal |
| Start Dictation | | Speech-to-text input |
| — | | |
| Go to Recent Directory... | Ctrl+G | Quick pick of recent dirs |
| Run Recent Command... | Ctrl+Alt+R | Quick pick of recent commands |

### `⤢` Maximize/Restore
Toggle terminal panel between maximized and normal size.

### `×` Close Panel
Hide the terminal panel.

---

## 4. Tab Right-Click Context Menu

| Item | Shortcut | Description |
|------|----------|-------------|
| Split Terminal | Ctrl+Shift+5 | Split this terminal |
| Move Terminal into Editor Area | | Open as editor tab |
| Move Terminal into New Window | | Detach to new OS window |
| — | | |
| Change Color... | | Color picker for tab |
| Change Icon... | | Icon picker for tab |
| Rename... | F2 | Inline rename |
| Toggle Size to Content Width | Alt+Z | Auto-fit pane width |
| — | | |
| Kill Terminal | Delete | Kill process + remove |
| — | | |
| Unsplit Terminal | | Remove splits in group |

---

## 5. Split Terminal System

### How Splits Work

Splits use VS Code's base `SplitView` library:
- Orientation: HORIZONTAL (side-by-side) or VERTICAL (stacked)
- Draggable sash between panes for manual resizing
- Minimum pane size: 80px
- Double-click sash → auto-fit to content width

### CWD for New Splits (`terminal.integrated.splitCwd` setting)

| Value | Behavior |
|-------|----------|
| `'workspaceRoot'` | Use workspace root |
| `'initial'` | Use terminal's initial CWD |
| `'inherited'` | Use terminal's current CWD |

### Split Navigation

| Action | Shortcut |
|--------|----------|
| Focus Previous Pane | Alt+Left |
| Focus Next Pane | Alt+Right |
| Resize Pane Left | — |
| Resize Pane Right | — |
| Resize Pane Up | — |
| Resize Pane Down | — |

### Data Flow: Creating a Split

```
User: Ctrl+Shift+5
  → TerminalAction.Split
  → getCwdForSplit() determines working directory
  → terminalGroupService.activeGroup.split(launchConfig)
  → ITerminalGroup.split()
  → terminalInstanceService.createInstance()
  → SplitPaneContainer._addChild(instance)
  → splitView.addView() adds pane to layout
  → ITerminalGroup.onInstancesChanged fires
  → Tab list re-renders with updated tree characters
```

---

## 6. Profile System

### ITerminalProfile

```typescript
interface ITerminalProfile {
  profileName: string;      // "PowerShell", "Git Bash", etc.
  path: string;             // Shell executable path
  args?: string[];          // Shell arguments
  overrideName?: string;    // Custom display name
  color?: string;           // Tab color
  icon?: TerminalIcon;      // Tab icon (codicon name)
  isDefault?: boolean;      // Is the default profile
}
```

### Profile Detection
VS Code auto-detects installed shells:
- Windows: PowerShell, Git Bash, Command Prompt, WSL
- macOS/Linux: bash, zsh, fish, sh

Users can add custom profiles in settings and select a default.

---

## 7. Customization Features

### Tab Colors
- Predefined theme colors (red, green, blue, yellow, etc.)
- Applied as background tint on the tab
- Persisted per terminal instance

### Tab Icons
- Full Codicon icon set available
- Icon picker widget with search/filter
- Default icon based on shell type

### Tab Renaming
- **F2** on focused tab → inline InputBox overlay
- **Command Palette** → name input dialog
- `titleSource` tracks how title was set (process, user, API)

---

## 8. Keyboard Shortcuts Summary

### Creation
| Action | Shortcut |
|--------|----------|
| New Terminal | Ctrl+Shift+' |
| New Terminal Window | Ctrl+Shift+Alt+' |
| Split Terminal | Ctrl+Shift+5 |

### Navigation
| Action | Shortcut |
|--------|----------|
| Toggle Terminal Panel | Ctrl+` |
| Focus Previous Pane | Alt+Left |
| Focus Next Pane | Alt+Right |
| Previous Terminal Group | — |
| Next Terminal Group | — |

### Terminal Actions
| Action | Shortcut |
|--------|----------|
| Clear Terminal | Ctrl+L |
| Rename Tab | F2 |
| Kill Terminal | Delete (when tab focused) |
| Go to Recent Directory | Ctrl+G |
| Run Recent Command | Ctrl+Alt+R |

---

## 9. Key Source Files

### Browser (UI)
| File | Purpose | Lines |
|------|---------|-------|
| `terminalView.ts` | ViewPane for terminal panel | 2000+ |
| `terminalTabbedView.ts` | Tab bar orchestration | — |
| `terminalTabsList.ts` | Tab list rendering | 900+ |
| `terminalInstance.ts` | Instance implementation | 2500+ |
| `terminalGroup.ts` | Split group management | 634 |
| `terminalGroupService.ts` | Group service | — |
| `terminalActions.ts` | All command handlers | 2000+ |
| `terminalMenus.ts` | Menu registry | — |
| `terminalContextMenu.ts` | Context menu handling | — |
| `terminalProfileQuickpick.ts` | Profile selection UI | — |
| `terminalIconPicker.ts` | Icon picker widget | — |
| `terminalEditor.ts` | Terminal in editor pane | — |

### Common (Types)
| File | Purpose |
|------|---------|
| `terminal.ts` | Core types (ITerminalConfiguration, ITerminalProfile) |
| `terminalContextKey.ts` | Context key definitions |
| `terminalStrings.ts` | Localized strings |
