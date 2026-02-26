# VS Code-Style Terminal UX — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Voice Mirror's per-tab shell system with a VS Code-style terminal panel supporting groups, horizontal splits, profiles, customization, and full keyboard shortcuts.

**Architecture:** Incremental enhancement of the existing system. Phase 1 renames shell→terminal everywhere. Phase 2 simplifies the outer tab strip to 3 pinned tabs and introduces the inner TerminalPanel. Phase 3 adds the group/split model. Phase 4 adds profiles and customization. Each phase is independently shippable.

**Tech Stack:** Svelte 5 (runes), Rust/Tauri 2, ghostty-web WASM terminal, `portable-pty`, source-inspection tests (`node:test`).

**Design doc:** `docs/plans/2026-02-26-vscode-terminal-ux-design.md`
**VS Code reference:** `docs/reference/VSCODE-TERMINAL-ANALYSIS.md`

---

## Phase 1: Rename Shell → Terminal

### Task 1: Rename Rust Backend (shell → terminal)

**Files:**
- Rename: `src-tauri/src/shell/mod.rs` → `src-tauri/src/terminal/mod.rs`
- Rename: `src-tauri/src/commands/shell.rs` → `src-tauri/src/commands/terminal.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create `src-tauri/src/terminal/mod.rs`**

Copy `src-tauri/src/shell/mod.rs` to `src-tauri/src/terminal/mod.rs`. Apply these renames throughout:

| Old | New |
|-----|-----|
| `ShellEvent` | `TerminalEvent` |
| `ShellSession` | `TerminalSession` |
| `ShellManager` | `TerminalManager` |
| `event_type: "stdout"` | (keep as-is — this is the PTY output type, not a naming issue) |
| `shell_event_rx` | `terminal_event_rx` |
| `shell-output` (Tauri event name) | `terminal-output` |
| `"shell-{}"` (session ID format) | `"terminal-{}"` |
| All `Shell {}` log messages | `Terminal {}` |
| `find_git_bash()` | (keep — function name describes what it does) |

**Step 2: Create `src-tauri/src/commands/terminal.rs`**

Copy `src-tauri/src/commands/shell.rs` to `src-tauri/src/commands/terminal.rs`. Apply renames:

| Old | New |
|-----|-----|
| `ShellManagerState` | `TerminalManagerState` |
| `lock_shell!` macro | `lock_terminal!` macro |
| `"Shell manager lock poisoned"` | `"Terminal manager lock poisoned"` |
| `shell_spawn` | `terminal_spawn` |
| `shell_input` | `terminal_input` |
| `shell_resize` | `terminal_resize` |
| `shell_kill` | `terminal_kill` |
| `shell_list` | `terminal_list` |
| `crate::shell::ShellManager` | `crate::terminal::TerminalManager` |

**Step 3: Update `src-tauri/src/commands/mod.rs`**

Replace `pub mod shell;` with `pub mod terminal;`.

**Step 4: Update `src-tauri/src/lib.rs`**

- Replace `pub mod shell;` with `pub mod terminal;`
- Replace `shell_cmds::ShellManagerState` with `terminal_cmds::TerminalManagerState`
- Replace `crate::shell::ShellManager::new()` with `crate::terminal::TerminalManager::new()`
- Replace all 5 command registrations: `shell_cmds::shell_spawn` → `terminal_cmds::terminal_spawn`, etc.
- Replace the `shell-output` event emission: change `"shell-output"` to `"terminal-output"`
- Replace the cleanup code: `shell_cmds::ShellManagerState` → `terminal_cmds::TerminalManagerState`
- Also add `use commands::terminal as terminal_cmds;` alias (matching existing `shell_cmds` pattern)

**Step 5: Delete old files**

Delete `src-tauri/src/shell/mod.rs` (or the `shell/` directory) and `src-tauri/src/commands/shell.rs`.

**Step 6: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation with no errors.

**Step 7: Commit**

```bash
git add -A src-tauri/src/shell src-tauri/src/terminal src-tauri/src/commands/shell.rs src-tauri/src/commands/terminal.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "refactor: rename shell module to terminal (Rust backend)"
```

---

### Task 2: Rename Frontend API and Store

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src/lib/stores/terminal-tabs.svelte.js`
- Modify: `src/components/terminal/ShellTerminal.svelte`
- Modify: `src/components/terminal/TerminalTabs.svelte`
- Modify: `src/lib/stores/dev-server-manager.svelte.js`
- Modify: `src/lib/commands.svelte.js` (if it references shell commands)

**Step 1: Rename API wrappers in `src/lib/api.js`**

Find the Shell section (~line 585-630). Rename:

| Old | New |
|-----|-----|
| `shellSpawn` | `terminalSpawn` |
| `invoke('shell_spawn', ...)` | `invoke('terminal_spawn', ...)` |
| `shellInput` | `terminalInput` |
| `invoke('shell_input', ...)` | `invoke('terminal_input', ...)` |
| `shellResize` | `terminalResize` |
| `invoke('shell_resize', ...)` | `invoke('terminal_resize', ...)` |
| `shellKill` | `terminalKill` |
| `invoke('shell_kill', ...)` | `invoke('terminal_kill', ...)` |
| `shellList` | `terminalList` |
| `invoke('shell_list')` | `invoke('terminal_list')` |

Also rename the section comment from `// ============ Shell ============` to `// ============ Terminal ============`.

**Step 2: Update `src/lib/stores/terminal-tabs.svelte.js`**

- Change import: `shellSpawn, shellKill` → `terminalSpawn, terminalKill`
- Rename `addShellTab` → `addTerminalTab`
- Inside `addTerminalTab`: `shellSpawn(options)` → `terminalSpawn(options)`
- Inside `closeTab`: `shellKill(tab.shellId)` → `terminalKill(tab.shellId)`
- Change tab type: `type: 'shell'` → `type: 'terminal'`
- Change title: `Shell ${tabNum}` → `Terminal ${tabNum}`
- Rename `nextShellNumber` → `nextTerminalNumber`
- Update regex: `/^Shell (\d+)$/` → `/^Terminal (\d+)$/`
- Update comment at top referencing "shell tabs"

**Step 3: Update `ShellTerminal.svelte`**

- Change imports: `shellInput` → `terminalInput`, `shellResize` → `terminalResize`
- Change event name: `'shell-output'` → `'terminal-output'`
- Change all `shellInput(shellId` → `terminalInput(shellId`
- Change all `shellResize(shellId` → `terminalResize(shellId`
- Update CSS class names: `shell-terminal-view` → `terminal-view`, `shell-terminal-container` → `terminal-container`

**Step 4: Update `TerminalTabs.svelte`**

- Change references: `addShellTab` → `addTerminalTab`
- Change tab type comparisons: `t.type === 'shell'` → `t.type === 'terminal'`
- Change `handleAddShell` → `handleAddTerminal`
- Update any label text from "Shell" to "Terminal"

**Step 5: Update `dev-server-manager.svelte.js`**

Search for `shellSpawn`, `shellKill`, `addShellTab` references and rename to `terminalSpawn`, `terminalKill`, `addTerminalTab`.

**Step 6: Update `commands.svelte.js`**

Search for any `addShellTab` references and rename.

**Step 7: Run tests to see what breaks**

Run: `npm test`
Expected: Many test failures in shell-related test files (they reference old names). That's expected — Task 3 fixes them.

**Step 8: Commit**

```bash
git add src/lib/api.js src/lib/stores/terminal-tabs.svelte.js src/components/terminal/ShellTerminal.svelte src/components/terminal/TerminalTabs.svelte src/lib/stores/dev-server-manager.svelte.js src/lib/commands.svelte.js
git commit -m "refactor: rename shell to terminal (frontend API, stores, components)"
```

---

### Task 3: Rename Component Files and Update All Tests

**Files:**
- Rename: `src/components/terminal/Terminal.svelte` → `src/components/terminal/AiTerminal.svelte`
- Rename: `src/components/terminal/ShellTerminal.svelte` → `src/components/terminal/Terminal.svelte`
- Rename: `test/components/shell-terminal.test.cjs` → `test/components/terminal.test.cjs`
- Modify: `test/components/terminal-tabs.test.cjs`
- Modify: `test/components/terminal-tabs-confirm.test.cjs`
- Modify: `test/stores/terminal-tabs.test.cjs`
- Modify: `test/components/lens-workspace.test.cjs`

**Step 1: Rename component files**

```bash
# Rename Terminal.svelte (AI) to AiTerminal.svelte
mv src/components/terminal/Terminal.svelte src/components/terminal/AiTerminal.svelte

# Rename ShellTerminal.svelte to Terminal.svelte (user terminals)
mv src/components/terminal/ShellTerminal.svelte src/components/terminal/Terminal.svelte
```

**Step 2: Update imports in `TerminalTabs.svelte`**

- Change `import Terminal from './Terminal.svelte'` → `import AiTerminal from './AiTerminal.svelte'`
- Change `import ShellTerminal from './ShellTerminal.svelte'` → `import Terminal from './Terminal.svelte'`
- Change `<Terminal` (for AI) → `<AiTerminal` in the template
- Change `<ShellTerminal` → `<Terminal` in the template

**Step 3: Rename test file**

```bash
mv test/components/shell-terminal.test.cjs test/components/terminal.test.cjs
```

**Step 4: Update `test/components/terminal.test.cjs`** (was shell-terminal.test.cjs)

- Change SRC_PATH to `../../src/components/terminal/Terminal.svelte`
- Change all `ShellTerminal` → `Terminal` in describe blocks
- Change `shellInput` → `terminalInput`
- Change `shellResize` → `terminalResize`
- Change `'shell-output'` → `'terminal-output'`
- Change `shell-terminal-view` → `terminal-view`
- Change `shell-terminal-container` → `terminal-container`

**Step 5: Update `test/components/terminal-tabs.test.cjs`**

- Change `import ShellTerminal from` → `import Terminal from`
- Change `import Terminal from` (AI) → `import AiTerminal from`
- Adjust any string assertions to match new import names

**Step 6: Update `test/stores/terminal-tabs.test.cjs`**

- Change `has addShellTab method` → `has addTerminalTab method`
- Change `src.includes('addShellTab(')` → `src.includes('addTerminalTab(')`
- Change `imports shellSpawn from api` → `imports terminalSpawn from api`
- Change `src.includes('shellSpawn')` → `src.includes('terminalSpawn')`
- Change `imports shellKill from api` → `imports terminalKill from api`
- Change `src.includes('shellKill')` → `src.includes('terminalKill')`
- Change `await shellSpawn(` → `await terminalSpawn(`
- Change `await shellKill(` → `await terminalKill(`
- Change `nextShellNumber` → `nextTerminalNumber`
- Change `/^Shell (\\d+)$/` → `/^Terminal (\\d+)$/`

**Step 7: Update `test/components/terminal-tabs-confirm.test.cjs`**

Scan for any `shell` references and update.

**Step 8: Update `test/components/lens-workspace.test.cjs`**

Check for `ShellTerminal` references — update if found.

**Step 9: Run all tests**

Run: `npm test`
Expected: All tests pass (3400+).

**Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rename component files and update all tests (shell → terminal)"
```

---

## Phase 2: Terminal Panel Architecture

### Task 4: Simplify Outer Tab Strip to 3 Pinned Tabs

**Files:**
- Modify: `src/components/terminal/TerminalTabs.svelte`
- Test: `test/components/terminal-tabs.test.cjs`

**Context:** Currently `TerminalTabs.svelte` renders individual tabs for each terminal instance in the bottom strip. We need to simplify it to just 3 pinned tabs: Voice Agent, Output, Terminal. When "Terminal" is clicked, the content area shows the new `TerminalPanel` component (Task 5).

**Step 1: Update tests first**

In `test/components/terminal-tabs.test.cjs`, add/modify tests:

```javascript
// New tests for 3-tab model
it('has Voice Agent pinned tab', () => {
  assert.ok(src.includes('Voice Agent'), 'Should have Voice Agent tab');
});

it('has Output pinned tab', () => {
  assert.ok(src.includes('Output'), 'Should have Output tab');
});

it('has Terminal pinned tab', () => {
  assert.ok(src.includes("'terminal'") || src.includes('"terminal"'), 'Should have Terminal tab');
});

it('imports TerminalPanel component', () => {
  assert.ok(src.includes("import TerminalPanel from"), 'Should import TerminalPanel');
});

it('renders TerminalPanel when terminal mode active', () => {
  assert.ok(src.includes('<TerminalPanel'), 'Should render TerminalPanel');
});

it('has bottomPanelMode state', () => {
  assert.ok(src.includes('bottomPanelMode'), 'Should have bottomPanelMode state');
});
```

Remove or update tests that reference individual shell tabs in the outer strip (the old `{#each}` loop for shell tabs).

**Step 2: Refactor `TerminalTabs.svelte`**

The outer tab strip becomes:
```svelte
<div class="terminal-tab-bar">
  <!-- Voice Agent tab -->
  <div class="terminal-tab" class:active={bottomPanelMode === 'ai'} onclick={() => bottomPanelMode = 'ai'}>
    Voice Agent
  </div>

  <!-- Output tab -->
  <div class="terminal-tab" class:active={bottomPanelMode === 'output'} onclick={() => bottomPanelMode = 'output'}>
    Output
  </div>

  <!-- Terminal tab -->
  <div class="terminal-tab" class:active={bottomPanelMode === 'terminal'} onclick={() => bottomPanelMode = 'terminal'}>
    Terminal
  </div>

  <div class="tab-bar-spacer"></div>

  <!-- Toolbar actions (context-specific) -->
  ...
</div>

<div class="terminal-panels">
  <!-- AI terminal -->
  <div class="terminal-panel" class:hidden={bottomPanelMode !== 'ai'}>
    <AiTerminal />
  </div>

  <!-- Output panel -->
  <div class="terminal-panel" class:hidden={bottomPanelMode !== 'output'}>
    <OutputPanel ... />
  </div>

  <!-- Terminal panel (VS Code style) -->
  <div class="terminal-panel" class:hidden={bottomPanelMode !== 'terminal'}>
    <TerminalPanel />
  </div>
</div>
```

Remove the old `{#each}` loop for individual shell tabs, the `+` button in the outer strip, drag-and-drop between tabs, and inline rename on outer tabs. All of that moves into `TerminalPanel`.

Keep the Voice Agent context menu and the Output context menu as they are (they're on the outer tabs). Remove shell tab context menus from the outer strip.

**Step 3: Run tests**

Run: `npm test`
Expected: Tests pass. Some old tests may need removal if they tested the old per-tab loop.

**Step 4: Commit**

```bash
git commit -m "refactor: simplify outer tab strip to 3 pinned tabs (Voice Agent, Output, Terminal)"
```

---

### Task 5: Terminal Group/Instance Store Model

**Files:**
- Modify: `src/lib/stores/terminal-tabs.svelte.js`
- Create: `test/stores/terminal-groups.test.cjs`

**Context:** Enhance the terminal store to support the VS Code group/instance model. Groups contain 1+ instances (splits). The store manages `groups[]`, `instances`, `activeGroupId`, `activeInstanceId`.

**Step 1: Write tests in `test/stores/terminal-groups.test.cjs`**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('terminal-tabs.svelte.js -- group model', () => {
  it('has groups state', () => {
    assert.ok(src.includes('groups') && src.includes('$state'), 'Should have groups state');
  });

  it('has activeGroupId state', () => {
    assert.ok(src.includes('activeGroupId'), 'Should have activeGroupId');
  });

  it('has activeInstanceId state', () => {
    assert.ok(src.includes('activeInstanceId'), 'Should have activeInstanceId');
  });

  it('has groups getter', () => {
    assert.ok(src.includes('get groups()'), 'Should have groups getter');
  });

  it('has activeGroup getter', () => {
    assert.ok(src.includes('get activeGroup()'), 'Should have activeGroup getter');
  });
});

describe('terminal-tabs.svelte.js -- group methods', () => {
  it('has addGroup method', () => {
    assert.ok(src.includes('addGroup('), 'Should have addGroup for new terminal');
  });

  it('has splitInstance method', () => {
    assert.ok(src.includes('splitInstance('), 'Should have splitInstance');
  });

  it('has killInstance method', () => {
    assert.ok(src.includes('killInstance('), 'Should have killInstance');
  });

  it('has unsplitGroup method', () => {
    assert.ok(src.includes('unsplitGroup('), 'Should have unsplitGroup');
  });

  it('has setActiveGroup method', () => {
    assert.ok(src.includes('setActiveGroup('), 'Should have setActiveGroup');
  });

  it('has focusInstance method', () => {
    assert.ok(src.includes('focusInstance('), 'Should have focusInstance');
  });

  it('has focusPreviousPane method', () => {
    assert.ok(src.includes('focusPreviousPane'), 'Should have focusPreviousPane');
  });

  it('has focusNextPane method', () => {
    assert.ok(src.includes('focusNextPane'), 'Should have focusNextPane');
  });
});

describe('terminal-tabs.svelte.js -- instance data', () => {
  it('instances have groupId field', () => {
    assert.ok(src.includes('groupId'), 'Instances should have groupId');
  });

  it('instances have profileId field', () => {
    assert.ok(src.includes('profileId'), 'Instances should have profileId');
  });

  it('instances have color field', () => {
    assert.ok(src.includes('color'), 'Instances should have color field');
  });

  it('instances have icon field', () => {
    assert.ok(src.includes('icon'), 'Instances should have icon field');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="group model|group methods|instance data"`
Expected: All fail.

**Step 3: Implement the group model**

Enhance `terminal-tabs.svelte.js`. Keep existing methods (`addTerminalTab`, `closeTab`, `markExited`, `renameTab`, etc.) but refactor internally to use groups. Add new state and methods:

```javascript
// New state
let groups = $state([]);            // TerminalGroup[]
let instances = $state({});          // Map<id, TerminalInstance>
let activeGroupId = $state(null);
let activeInstanceId = $state(null);

// New methods
addGroup(options = {})              // Create group with 1 instance, spawn PTY
splitInstance(options = {})          // Add instance to active group, spawn PTY
killInstance(instanceId)             // Kill instance, remove from group, cleanup
unsplitGroup(groupId)               // Keep active instance, kill rest
setActiveGroup(groupId)             // Switch visible group
focusInstance(instanceId)            // Focus specific pane in active group
focusPreviousPane()                  // Alt+Left
focusNextPane()                      // Alt+Right
renameInstance(instanceId, title)    // Rename
setInstanceColor(instanceId, color)  // Set tab color
setInstanceIcon(instanceId, icon)    // Set tab icon
```

Each `TerminalInstance` object:
```javascript
{
  id: 'terminal-1',
  groupId: 'group-1',
  title: 'bash',
  profileId: 'default',
  icon: null,
  color: null,
  shellId: 'terminal-1',  // PTY session ID
  running: true
}
```

Each `TerminalGroup` object:
```javascript
{
  id: 'group-1',
  instanceIds: ['terminal-1']
}
```

**Important:** Keep backward compatibility for `addTerminalTab` (wraps `addGroup`), `closeTab` (wraps `killInstance`), and all dev-server methods. The outer API can stay the same while the internal model changes.

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass (old + new).

**Step 5: Commit**

```bash
git commit -m "feat: add terminal group/instance model for split support"
```

---

### Task 6: TerminalPanel Component (Main Layout)

**Files:**
- Create: `src/components/terminal/TerminalPanel.svelte`
- Create: `test/components/terminal-panel.test.cjs`

**Step 1: Write tests**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalPanel.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalPanel.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports Terminal component', () => {
    assert.ok(src.includes("import Terminal from './Terminal.svelte'"), 'Should import Terminal');
  });
  it('imports SplitPanel', () => {
    assert.ok(src.includes("import SplitPanel from"), 'Should import SplitPanel for splits');
  });
  it('imports TerminalTabStrip', () => {
    assert.ok(src.includes("import TerminalTabStrip from"), 'Should import TerminalTabStrip');
  });
  it('imports TerminalSidebar', () => {
    assert.ok(src.includes("import TerminalSidebar from"), 'Should import TerminalSidebar');
  });
  it('imports TerminalActionBar', () => {
    assert.ok(src.includes("import TerminalActionBar from"), 'Should import TerminalActionBar');
  });
});

describe('TerminalPanel.svelte -- structure', () => {
  it('has terminal-panel-inner container', () => {
    assert.ok(src.includes('terminal-panel-inner'), 'Should have inner container');
  });
  it('has terminal-header with tab strip and action bar', () => {
    assert.ok(src.includes('terminal-header'), 'Should have header');
  });
  it('has terminal-content area', () => {
    assert.ok(src.includes('terminal-content'), 'Should have content area');
  });
  it('has terminal-sidebar area', () => {
    assert.ok(src.includes('terminal-sidebar'), 'Should have sidebar wrapper');
  });
  it('renders Terminal component for each instance in active group', () => {
    assert.ok(src.includes('<Terminal'), 'Should render Terminal instances');
  });
  it('uses SplitPanel for multi-instance groups', () => {
    assert.ok(src.includes('SplitPanel'), 'Should use SplitPanel for splits');
  });
});

describe('TerminalPanel.svelte -- auto-spawn', () => {
  it('auto-creates first terminal on mount if no groups exist', () => {
    assert.ok(src.includes('addGroup') || src.includes('onMount'), 'Should auto-spawn');
  });
});

describe('TerminalPanel.svelte -- sidebar visibility', () => {
  it('conditionally shows sidebar based on group/instance count', () => {
    assert.ok(src.includes('showSidebar') || src.includes('sidebarVisible'), 'Should control sidebar visibility');
  });
});
```

**Step 2: Implement `TerminalPanel.svelte`**

Layout structure:

```svelte
<script>
  import { onMount } from 'svelte';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import Terminal from './Terminal.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import TerminalTabStrip from './TerminalTabStrip.svelte';
  import TerminalSidebar from './TerminalSidebar.svelte';
  import TerminalActionBar from './TerminalActionBar.svelte';

  // Auto-spawn first terminal if none exist
  onMount(() => {
    if (terminalTabsStore.groups.length === 0) {
      terminalTabsStore.addGroup();
    }
  });

  let showSidebar = $derived(
    terminalTabsStore.groups.length > 1 ||
    terminalTabsStore.groups.some(g => g.instanceIds.length > 1)
  );

  const activeGroup = $derived(terminalTabsStore.activeGroup);
  const activeInstances = $derived(
    activeGroup ? activeGroup.instanceIds.map(id => terminalTabsStore.getInstance(id)).filter(Boolean) : []
  );
</script>

<div class="terminal-panel-inner">
  <div class="terminal-header">
    <TerminalTabStrip />
    <TerminalActionBar />
  </div>
  <div class="terminal-body">
    <div class="terminal-content">
      {#if activeInstances.length === 1}
        <Terminal shellId={activeInstances[0].shellId} visible={true} />
      {:else if activeInstances.length > 1}
        <!-- Render horizontal splits using SplitPanel -->
        <!-- For 2 instances: single SplitPanel -->
        <!-- For 3+: nested SplitPanels -->
        ...
      {/if}
    </div>
    {#if showSidebar}
      <div class="terminal-sidebar">
        <TerminalSidebar />
      </div>
    {/if}
  </div>
</div>
```

For splits with >2 instances, use a recursive pattern or chain SplitPanels. The simplest approach for now: support up to 4 splits with nested SplitPanels.

**Step 3: Run tests**

Run: `npm test`
Expected: All pass.

**Step 4: Commit**

```bash
git commit -m "feat: add TerminalPanel component with group layout and auto-spawn"
```

---

### Task 7: TerminalTabStrip Component (Group Tabs)

**Files:**
- Create: `src/components/terminal/TerminalTabStrip.svelte`
- Create: `test/components/terminal-tab-strip.test.cjs`

**Step 1: Write tests**

```javascript
describe('TerminalTabStrip.svelte', () => {
  it('renders group tabs with each block', () => {
    assert.ok(src.includes('{#each') && src.includes('groups'), 'Should iterate groups');
  });
  it('has class:active for active group', () => {
    assert.ok(src.includes('class:active'), 'Should highlight active group');
  });
  it('clicking tab calls setActiveGroup', () => {
    assert.ok(src.includes('setActiveGroup'), 'Should switch group on click');
  });
  it('has tab-strip container class', () => {
    assert.ok(src.includes('tab-strip'), 'Should have tab-strip class');
  });
  it('shows group title', () => {
    assert.ok(src.includes('title') || src.includes('label'), 'Should show group title');
  });
});
```

**Step 2: Implement**

Simple tab strip iterating `terminalTabsStore.groups`. Each tab shows the title of the first/active instance in that group. Click switches active group.

**Step 3: Run tests, commit**

```bash
git commit -m "feat: add TerminalTabStrip component for group tabs"
```

---

### Task 8: TerminalSidebar Component (Instance List)

**Files:**
- Create: `src/components/terminal/TerminalSidebar.svelte`
- Create: `test/components/terminal-sidebar.test.cjs`

**Step 1: Write tests**

```javascript
describe('TerminalSidebar.svelte', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('iterates all groups', () => {
    assert.ok(src.includes('{#each') && src.includes('groups'), 'Should iterate groups');
  });
  it('shows tree characters for splits', () => {
    assert.ok(src.includes('┌') || src.includes('├') || src.includes('└'), 'Should have tree chars');
  });
  it('shows instance title', () => {
    assert.ok(src.includes('title'), 'Should show instance title');
  });
  it('clicking instance focuses it', () => {
    assert.ok(src.includes('focusInstance') || src.includes('setActiveGroup'), 'Should focus on click');
  });
  it('has class:active for active instance', () => {
    assert.ok(src.includes('class:active'), 'Should highlight active');
  });
  it('has sidebar-list container class', () => {
    assert.ok(src.includes('sidebar-list') || src.includes('instance-list'), 'Should have list class');
  });
  it('supports right-click context menu', () => {
    assert.ok(src.includes('oncontextmenu') || src.includes('contextmenu'), 'Should have context menu');
  });
});
```

**Step 2: Implement**

The sidebar shows all instances across all groups. For multi-instance groups, show tree characters:

```
  bash                    ← single-instance group
┌ powershell              ← first in split group
└ powershell              ← last in split group
```

Logic for tree prefix:
```javascript
function getTreePrefix(group, instanceIndex) {
  if (group.instanceIds.length <= 1) return '';
  if (instanceIndex === 0) return '┌ ';
  if (instanceIndex === group.instanceIds.length - 1) return '└ ';
  return '├ ';
}
```

**Step 3: Run tests, commit**

```bash
git commit -m "feat: add TerminalSidebar with instance tree characters"
```

---

### Task 9: TerminalActionBar Component

**Files:**
- Create: `src/components/terminal/TerminalActionBar.svelte`
- Create: `test/components/terminal-action-bar.test.cjs`

**Step 1: Write tests**

```javascript
describe('TerminalActionBar.svelte', () => {
  it('has new terminal button (+)', () => {
    assert.ok(src.includes('add') || src.includes('new-terminal'), 'Should have add button');
  });
  it('has dropdown toggle', () => {
    assert.ok(src.includes('dropdown') || src.includes('chevron'), 'Should have dropdown');
  });
  it('dropdown has New Terminal option', () => {
    assert.ok(src.includes('New Terminal'), 'Should have New Terminal option');
  });
  it('dropdown has Split Terminal option', () => {
    assert.ok(src.includes('Split Terminal'), 'Should have Split Terminal option');
  });
  it('has overflow menu (...)', () => {
    assert.ok(src.includes('overflow') || src.includes('more-actions'), 'Should have overflow');
  });
  it('overflow has Clear Terminal option', () => {
    assert.ok(src.includes('Clear Terminal'), 'Should have Clear Terminal');
  });
  it('clicking + calls addGroup', () => {
    assert.ok(src.includes('addGroup'), 'Should create new group');
  });
  it('split calls splitInstance', () => {
    assert.ok(src.includes('splitInstance'), 'Should split instance');
  });
});
```

**Step 2: Implement**

Action bar with:
- `+` button → `terminalTabsStore.addGroup()`
- `˅` dropdown → New Terminal, Split Terminal, (profiles listed here in Task 11)
- `···` overflow → Clear Terminal, Run Active File, Run Selected Text

Use the existing dropdown/context menu pattern from the codebase (see Output tab context menu in TerminalTabs.svelte for the pattern).

**Step 3: Run tests, commit**

```bash
git commit -m "feat: add TerminalActionBar with dropdown and overflow menus"
```

---

### Task 10: TerminalContextMenu Component

**Files:**
- Create: `src/components/terminal/TerminalContextMenu.svelte`
- Create: `test/components/terminal-context-menu.test.cjs`

**Step 1: Write tests**

```javascript
describe('TerminalContextMenu.svelte', () => {
  it('has Split Terminal option', () => {
    assert.ok(src.includes('Split Terminal'), 'Should have split');
  });
  it('has Kill Terminal option', () => {
    assert.ok(src.includes('Kill Terminal'), 'Should have kill');
  });
  it('has Rename option', () => {
    assert.ok(src.includes('Rename'), 'Should have rename');
  });
  it('has Change Color option', () => {
    assert.ok(src.includes('Change Color'), 'Should have color');
  });
  it('has Change Icon option', () => {
    assert.ok(src.includes('Change Icon'), 'Should have icon');
  });
  it('has Unsplit Terminal option', () => {
    assert.ok(src.includes('Unsplit'), 'Should have unsplit');
  });
  it('accepts instanceId prop', () => {
    assert.ok(src.includes('instanceId') && src.includes('$props'), 'Should accept instanceId');
  });
  it('calls killInstance on Kill', () => {
    assert.ok(src.includes('killInstance'), 'Should call killInstance');
  });
  it('calls splitInstance on Split', () => {
    assert.ok(src.includes('splitInstance'), 'Should call splitInstance');
  });
  it('calls unsplitGroup on Unsplit', () => {
    assert.ok(src.includes('unsplitGroup'), 'Should call unsplitGroup');
  });
});
```

**Step 2: Implement**

Context menu with dividers:
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

Triggered from right-click on sidebar instances and group tabs.

**Step 3: Run tests, commit**

```bash
git commit -m "feat: add TerminalContextMenu with split, kill, rename, color, icon, unsplit"
```

---

## Phase 3: Profile System & Customization

### Task 11: Terminal Profile Detection (Rust)

**Files:**
- Modify: `src-tauri/src/terminal/mod.rs`
- Modify: `src-tauri/src/commands/terminal.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add `TerminalProfile` struct to `terminal/mod.rs`**

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TerminalProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub args: Vec<String>,
    pub icon: String,
    pub color: Option<String>,
    pub is_default: bool,
    pub is_builtin: bool,
}
```

**Step 2: Add `detect_profiles()` function to `TerminalManager`**

```rust
impl TerminalManager {
    pub fn detect_profiles(&self) -> Vec<TerminalProfile> {
        let mut profiles = Vec::new();

        #[cfg(target_os = "windows")]
        {
            // Git Bash
            if let Some(bash_path) = find_git_bash() {
                profiles.push(TerminalProfile {
                    id: "git-bash".to_string(),
                    name: "Git Bash".to_string(),
                    path: bash_path,
                    args: vec!["--login".to_string(), "-i".to_string()],
                    icon: "terminal-bash".to_string(),
                    color: None,
                    is_default: true,
                    is_builtin: true,
                });
            }

            // PowerShell (detect pwsh first, then powershell)
            // ...

            // Command Prompt
            // ...
        }

        // macOS/Linux: check $SHELL and /etc/shells
        // ...

        profiles
    }
}
```

**Step 3: Add `terminal_detect_profiles` command to `commands/terminal.rs`**

```rust
#[tauri::command]
pub fn terminal_detect_profiles(
    state: State<'_, TerminalManagerState>,
) -> IpcResponse {
    let manager = lock_terminal!(state);
    let profiles = manager.detect_profiles();
    IpcResponse::ok(serde_json::to_value(profiles).unwrap_or_default())
}
```

**Step 4: Enhance `terminal_spawn` with `profile_id` parameter**

```rust
#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, TerminalManagerState>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    profile_id: Option<String>,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    match manager.spawn(cols, rows, cwd, profile_id) {
        Ok(id) => IpcResponse::ok(json!({ "id": id })),
        Err(e) => IpcResponse::err(e),
    }
}
```

Update `TerminalManager::spawn()` to accept `profile_id: Option<String>` and use it to select the shell path and args instead of the hardcoded logic.

**Step 5: Register new command in `lib.rs`**

Add `terminal_cmds::terminal_detect_profiles` to the invoke handler chain.

**Step 6: Verify**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation.

**Step 7: Commit**

```bash
git commit -m "feat: add terminal profile detection and profile-based spawn"
```

---

### Task 12: Terminal Profiles Store and API

**Files:**
- Create: `src/lib/stores/terminal-profiles.svelte.js`
- Create: `test/stores/terminal-profiles.test.cjs`
- Modify: `src/lib/api.js`

**Step 1: Add API wrapper**

In `api.js`, add:
```javascript
export async function terminalDetectProfiles() {
  return invoke('terminal_detect_profiles');
}
```

**Step 2: Write tests for profiles store**

```javascript
describe('terminal-profiles.svelte.js', () => {
  it('exports terminalProfilesStore', () => {
    assert.ok(src.includes('export const terminalProfilesStore'));
  });
  it('has profiles state', () => {
    assert.ok(src.includes('profiles') && src.includes('$state'));
  });
  it('has defaultProfileId state', () => {
    assert.ok(src.includes('defaultProfileId'));
  });
  it('has loadProfiles method', () => {
    assert.ok(src.includes('loadProfiles'));
  });
  it('has getDefaultProfile method', () => {
    assert.ok(src.includes('getDefaultProfile'));
  });
  it('has setDefault method', () => {
    assert.ok(src.includes('setDefault'));
  });
  it('imports terminalDetectProfiles from api', () => {
    assert.ok(src.includes('terminalDetectProfiles'));
  });
});
```

**Step 3: Implement profiles store**

```javascript
import { terminalDetectProfiles } from '../api.js';

function createTerminalProfilesStore() {
  let profiles = $state([]);
  let defaultProfileId = $state(null);
  let loaded = $state(false);

  return {
    get profiles() { return profiles; },
    get defaultProfileId() { return defaultProfileId; },
    get loaded() { return loaded; },

    getDefaultProfile() {
      return profiles.find(p => p.id === defaultProfileId) || profiles[0] || null;
    },

    async loadProfiles() {
      const result = await terminalDetectProfiles();
      if (result?.success && Array.isArray(result.data)) {
        profiles = result.data;
        const def = profiles.find(p => p.is_default);
        if (def) defaultProfileId = def.id;
      }
      loaded = true;
    },

    setDefault(id) {
      defaultProfileId = id;
    },
  };
}

export const terminalProfilesStore = createTerminalProfilesStore();
```

**Step 4: Wire profiles into TerminalActionBar dropdown**

Update `TerminalActionBar.svelte` to show detected profiles in the `+` dropdown.

**Step 5: Run tests, commit**

```bash
git commit -m "feat: add terminal profiles store with detection and default selection"
```

---

### Task 13: Tab Color and Icon Pickers

**Files:**
- Create: `src/components/terminal/TerminalColorPicker.svelte`
- Create: `src/components/terminal/TerminalIconPicker.svelte`
- Create: `test/components/terminal-color-picker.test.cjs`
- Create: `test/components/terminal-icon-picker.test.cjs`

**Step 1: Write tests for TerminalColorPicker**

```javascript
describe('TerminalColorPicker.svelte', () => {
  it('has color grid with predefined colors', () => {
    assert.ok(src.includes('color-grid') || src.includes('color-swatch'));
  });
  it('includes theme colors (accent, ok, warn, danger)', () => {
    assert.ok(src.includes('--accent') || src.includes('var(--'));
  });
  it('accepts onSelect callback', () => {
    assert.ok(src.includes('onSelect') && src.includes('$props'));
  });
  it('accepts onClose callback', () => {
    assert.ok(src.includes('onClose'));
  });
});
```

**Step 2: Write tests for TerminalIconPicker**

```javascript
describe('TerminalIconPicker.svelte', () => {
  it('has icon grid', () => {
    assert.ok(src.includes('icon-grid') || src.includes('icon-list'));
  });
  it('has search/filter input', () => {
    assert.ok(src.includes('filter') || src.includes('search'));
  });
  it('accepts onSelect callback', () => {
    assert.ok(src.includes('onSelect') && src.includes('$props'));
  });
});
```

**Step 3: Implement TerminalColorPicker**

A simple popup with a grid of predefined colors. Use CSS custom property colors from the theme:
- `--accent`, `--ok`, `--warn`, `--danger`, `--muted`
- Plus a few standard colors: red, orange, yellow, green, blue, purple, pink

When a color is selected, call `terminalTabsStore.setInstanceColor(instanceId, color)`.

**Step 4: Implement TerminalIconPicker**

A popup showing available icons with search. Use a subset of relevant terminal/tool icons. Keep it simple — ~20 predefined icons with a filter input.

**Step 5: Wire into TerminalContextMenu**

"Change Color..." → opens TerminalColorPicker
"Change Icon..." → opens TerminalIconPicker

**Step 6: Run tests, commit**

```bash
git commit -m "feat: add terminal tab color and icon pickers"
```

---

### Task 14: Keyboard Shortcuts

**Files:**
- Modify: `src/lib/stores/shortcuts.svelte.js` (or wherever shortcuts are registered)
- Modify: `src/components/terminal/TerminalPanel.svelte`
- Modify: `src/components/terminal/TerminalTabs.svelte`

**Step 1: Register terminal shortcuts**

Using the existing `setActionHandler` pattern from the shortcuts store:

| Action ID | Shortcut | Handler |
|-----------|----------|---------|
| `new-terminal` | Ctrl+Shift+' | `terminalTabsStore.addGroup()` |
| `split-terminal` | Ctrl+Shift+5 | `terminalTabsStore.splitInstance()` |
| `toggle-terminal` | Ctrl+` | Toggle terminal panel visibility |
| `focus-prev-pane` | Alt+Left | `terminalTabsStore.focusPreviousPane()` |
| `focus-next-pane` | Alt+Right | `terminalTabsStore.focusNextPane()` |
| `kill-terminal` | Delete | `terminalTabsStore.killInstance()` (when tab focused) |
| `rename-terminal` | F2 | Trigger inline rename (when tab focused) |

**Step 2: Wire handlers in TerminalPanel**

Use `$effect` with `setActionHandler` to register/unregister handlers when the terminal panel is active.

**Step 3: Add Ctrl+` toggle**

In `TerminalTabs.svelte`, add a keyboard listener for Ctrl+` that toggles `bottomPanelMode` between `'terminal'` and the previous mode (or collapses the panel).

**Step 4: Run tests, commit**

```bash
git commit -m "feat: add terminal keyboard shortcuts (new, split, toggle, focus, kill, rename)"
```

---

### Task 15: Integration Testing and Polish

**Files:**
- All test files
- Any remaining UI polish

**Step 1: Run full test suite**

Run: `npm test`
Expected: All 3400+ tests pass.

**Step 2: Run Rust checks**

Run: `cd src-tauri && cargo check && cargo check --tests`
Expected: Clean compilation.

**Step 3: Fix any remaining test failures**

Update any tests that were missed in earlier tasks.

**Step 4: Visual polish**

- Ensure sidebar colors match theme
- Ensure tab strip styling is consistent with the outer strip
- Ensure split sashes are visible and draggable
- Ensure context menus position correctly

**Step 5: Update CLAUDE.md**

Update the file layout table and component descriptions to reflect the new terminal architecture.

**Step 6: Final commit**

```bash
git commit -m "feat: VS Code-style terminal UX complete — groups, splits, profiles, shortcuts"
```

---

## Task Dependency Graph

```
Task 1 (Rust rename)
  → Task 2 (Frontend rename)
    → Task 3 (Test updates + component rename)
      → Task 4 (Outer strip simplification)
        → Task 5 (Group/instance store)
          → Task 6 (TerminalPanel)
            → Task 7 (TerminalTabStrip)
            → Task 8 (TerminalSidebar)
            → Task 9 (TerminalActionBar)
            → Task 10 (TerminalContextMenu)
          → Task 11 (Rust profiles)
            → Task 12 (Profiles store)
              → Task 13 (Color/Icon pickers)
          → Task 14 (Keyboard shortcuts)
      → Task 15 (Integration testing)
```

Tasks 7-10 can run in parallel after Task 6.
Tasks 11-13 can run in parallel with Tasks 7-10 after Task 5.
Task 14 depends on Task 6.
Task 15 runs last.
