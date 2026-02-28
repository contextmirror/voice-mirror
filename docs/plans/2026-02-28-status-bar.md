# Status Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a VS Code/Zed-style status bar at the bottom of the app shell, showing git branch, diagnostics, dev server status, LSP health, cursor position, indentation, encoding, EOL, language mode, and a notification bell.

**Architecture:** Monolithic approach — one `StatusBar.svelte` component reads from a single `statusBarStore` (reactive aggregator). The store pulls data from existing stores (`projectStore`, `tabsStore`, `lspDiagnosticsStore`, `devServerManager`, `navigationStore`) and APIs (`getGitChanges()`, `lspGetStatus()`). FileEditor pushes cursor/indent/EOL/encoding/language data into the store via setter methods. The status bar mounts in `App.svelte` after `.app-body` inside `.app-shell`, spanning full window width.

**Tech Stack:** Svelte 5 runes, CSS custom properties (theme system), CodeMirror 6 EditorView, Tauri IPC (`invoke()`), existing reactive stores.

**Design doc:** `docs/plans/2026-02-28-status-bar-design.md`

---

## Task 1: Create the status bar store (state shape + setters)

**Files:**
- Create: `src/lib/stores/status-bar.svelte.js`
- Test: `test/stores/status-bar.test.cjs`

**Context:** This store aggregates all status bar data. It follows the same factory pattern as other stores in the codebase (e.g. `lsp-diagnostics.svelte.js`, `toast.svelte.js`). The store file MUST be `.svelte.js` because it uses Svelte 5 runes (`$state`).

**Step 1: Write the failing tests**

Create `test/stores/status-bar.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/status-bar.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('status-bar.svelte.js: exports', () => {
  it('exports statusBarStore', () => {
    assert.ok(src.includes('export const statusBarStore'), 'Should export statusBarStore');
  });

  it('uses createStatusBarStore factory', () => {
    assert.ok(src.includes('function createStatusBarStore'), 'Should use factory pattern');
  });
});

describe('status-bar.svelte.js: editor state', () => {
  it('has cursor state with $state', () => {
    assert.ok(src.includes('cursor') && src.includes('$state'), 'Should have cursor state');
  });

  it('has indent state', () => {
    assert.ok(src.includes('indent'), 'Should have indent state');
  });

  it('has encoding state', () => {
    assert.ok(src.includes('encoding'), 'Should have encoding state');
  });

  it('has eol state', () => {
    assert.ok(src.includes('eol'), 'Should have eol state');
  });

  it('has language state', () => {
    assert.ok(src.includes('language'), 'Should have language state');
  });

  it('has editorFocused state', () => {
    assert.ok(src.includes('editorFocused'), 'Should have editorFocused state');
  });
});

describe('status-bar.svelte.js: setter methods', () => {
  it('has setCursor method', () => {
    assert.ok(src.includes('setCursor'), 'Should have setCursor');
  });

  it('has setIndent method', () => {
    assert.ok(src.includes('setIndent'), 'Should have setIndent');
  });

  it('has setEncoding method', () => {
    assert.ok(src.includes('setEncoding'), 'Should have setEncoding');
  });

  it('has setEol method', () => {
    assert.ok(src.includes('setEol'), 'Should have setEol');
  });

  it('has setLanguage method', () => {
    assert.ok(src.includes('setLanguage'), 'Should have setLanguage');
  });

  it('has setEditorFocused method', () => {
    assert.ok(src.includes('setEditorFocused'), 'Should have setEditorFocused');
  });

  it('has clearEditorState method', () => {
    assert.ok(src.includes('clearEditorState'), 'Should have clearEditorState');
  });
});

describe('status-bar.svelte.js: git state', () => {
  it('has gitBranch state', () => {
    assert.ok(src.includes('gitBranch'), 'Should have gitBranch state');
  });

  it('has gitDirty state', () => {
    assert.ok(src.includes('gitDirty'), 'Should have gitDirty state');
  });
});

describe('status-bar.svelte.js: left side state', () => {
  it('has diagnostics state for errors and warnings', () => {
    assert.ok(src.includes('totalErrors') || src.includes('diagErrors'), 'Should have error count');
    assert.ok(src.includes('totalWarnings') || src.includes('diagWarnings'), 'Should have warning count');
  });

  it('has devServer state', () => {
    assert.ok(src.includes('devServerStatus') || src.includes('devServer'), 'Should have devServer state');
  });

  it('has lspHealth state', () => {
    assert.ok(src.includes('lspHealth'), 'Should have lspHealth state');
  });
});

describe('status-bar.svelte.js: notification state', () => {
  it('has notifications array', () => {
    assert.ok(src.includes('notifications'), 'Should have notifications');
  });

  it('has unreadCount', () => {
    assert.ok(src.includes('unreadCount'), 'Should have unreadCount');
  });

  it('has addNotification method', () => {
    assert.ok(src.includes('addNotification'), 'Should have addNotification');
  });

  it('has markAllRead method', () => {
    assert.ok(src.includes('markAllRead'), 'Should have markAllRead');
  });

  it('has dismissNotification method', () => {
    assert.ok(src.includes('dismissNotification'), 'Should have dismissNotification');
  });
});

describe('status-bar.svelte.js: getLanguageName utility', () => {
  it('exports getLanguageName function', () => {
    assert.ok(src.includes('getLanguageName'), 'Should have getLanguageName');
  });

  it('maps js to JavaScript', () => {
    assert.ok(src.includes('JavaScript'), 'Should map to JavaScript');
  });

  it('maps rs to Rust', () => {
    assert.ok(src.includes('Rust'), 'Should map to Rust');
  });

  it('maps py to Python', () => {
    assert.ok(src.includes('Python'), 'Should map to Python');
  });

  it('maps svelte to Svelte', () => {
    assert.ok(src.includes('Svelte'), 'Should map to Svelte');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/stores/status-bar.test.cjs`
Expected: FAIL — file not found

**Step 3: Write the store implementation**

Create `src/lib/stores/status-bar.svelte.js`:

```js
/**
 * status-bar.svelte.js -- Svelte 5 reactive store for status bar data aggregation.
 *
 * Aggregates data from multiple sources:
 * - Editor state (cursor, indent, EOL, encoding, language) — pushed by FileEditor
 * - Git branch — polled via getGitChanges() API
 * - Diagnostics — read from lspDiagnosticsStore
 * - Dev server — read from devServerManager store
 * - LSP health — polled via lspGetStatus() API
 * - Notifications — internal notification persistence
 */

import { getGitChanges, lspGetStatus } from '../api.js';
import { projectStore } from './project.svelte.js';
import { lspDiagnosticsStore } from './lsp-diagnostics.svelte.js';
import { devServerManager } from './dev-server-manager.svelte.js';
import { navigationStore } from './navigation.svelte.js';
import { tabsStore } from './tabs.svelte.js';

/**
 * Map file extension to human-readable language name.
 * Matches the extensions supported by codemirror-languages.js.
 * @param {string} filePath
 * @returns {string}
 */
export function getLanguageName(filePath) {
  const ext = filePath?.split('.').pop()?.toLowerCase() || '';
  const MAP = {
    js: 'JavaScript', jsx: 'JavaScript JSX', mjs: 'JavaScript', cjs: 'JavaScript',
    ts: 'TypeScript', tsx: 'TypeScript JSX',
    rs: 'Rust',
    css: 'CSS', scss: 'SCSS',
    html: 'HTML', svelte: 'Svelte',
    json: 'JSON',
    md: 'Markdown', markdown: 'Markdown',
    py: 'Python', python: 'Python',
    toml: 'TOML', yaml: 'YAML', yml: 'YAML',
    sh: 'Shell', bash: 'Shell',
    xml: 'XML', svg: 'SVG',
    txt: 'Plain Text',
  };
  return MAP[ext] || ext.toUpperCase() || 'Plain Text';
}

const GIT_POLL_INTERVAL = 5000;
const LSP_POLL_INTERVAL = 10000;
const MAX_NOTIFICATIONS = 100;

function createStatusBarStore() {
  // ── Editor state (pushed by FileEditor) ──
  let cursor = $state({ line: 1, col: 1 });
  let indent = $state({ type: 'spaces', size: 2 });
  let encoding = $state('UTF-8');
  let eol = $state('LF');
  let language = $state('');
  let editorFocused = $state(false);

  // ── Git state (polled) ──
  let gitBranch = $state('');
  let gitDirty = $state(false);
  let gitPollTimer = null;

  // ── Diagnostics (derived from lspDiagnosticsStore) ──
  let diagErrors = $state(0);
  let diagWarnings = $state(0);

  // ── Dev server (read from devServerManager) ──
  let devServerStatus = $state('stopped');
  let devServerPort = $state(null);

  // ── LSP health (polled) ──
  let lspHealth = $state('none'); // 'none' | 'healthy' | 'starting' | 'error'
  let lspPollTimer = null;

  // ── Notifications ──
  let notifications = $state([]);
  let unreadCount = $state(0);

  // ── Polling: git branch ──

  async function pollGitBranch() {
    const project = projectStore.activeProject;
    if (!project?.path) {
      gitBranch = '';
      gitDirty = false;
      return;
    }
    try {
      const resp = await getGitChanges(project.path);
      if (resp?.data) {
        gitBranch = resp.data.branch || '';
        gitDirty = Array.isArray(resp.data.changes) && resp.data.changes.length > 0;
      }
    } catch {
      // Silently fail — git may not be available
    }
  }

  function startGitPolling() {
    stopGitPolling();
    pollGitBranch();
    gitPollTimer = setInterval(pollGitBranch, GIT_POLL_INTERVAL);
  }

  function stopGitPolling() {
    if (gitPollTimer) {
      clearInterval(gitPollTimer);
      gitPollTimer = null;
    }
  }

  // ── Polling: LSP health ──

  async function pollLspHealth() {
    try {
      const resp = await lspGetStatus();
      const servers = resp?.data?.servers;
      if (!servers || servers.length === 0) {
        lspHealth = 'none';
        return;
      }
      const hasError = servers.some(s => s.status === 'error' || s.status === 'crashed');
      const hasStarting = servers.some(s => s.status === 'starting' || s.status === 'initializing');
      if (hasError) lspHealth = 'error';
      else if (hasStarting) lspHealth = 'starting';
      else lspHealth = 'healthy';
    } catch {
      lspHealth = 'none';
    }
  }

  function startLspPolling() {
    stopLspPolling();
    pollLspHealth();
    lspPollTimer = setInterval(pollLspHealth, LSP_POLL_INTERVAL);
  }

  function stopLspPolling() {
    if (lspPollTimer) {
      clearInterval(lspPollTimer);
      lspPollTimer = null;
    }
  }

  // ── Diagnostics aggregation ──

  function updateDiagnostics() {
    let errors = 0;
    let warnings = 0;
    for (const [, counts] of lspDiagnosticsStore.diagnostics) {
      errors += counts.errors;
      warnings += counts.warnings;
    }
    diagErrors = errors;
    diagWarnings = warnings;
  }

  // ── Dev server sync ──

  function updateDevServer() {
    const project = projectStore.activeProject;
    if (!project?.path) {
      devServerStatus = 'stopped';
      devServerPort = null;
      return;
    }
    const state = devServerManager.getServerStatus(project.path);
    if (state) {
      devServerStatus = state.status;
      devServerPort = state.port;
    } else {
      devServerStatus = 'stopped';
      devServerPort = null;
    }
  }

  // ── Notifications ──

  function addNotification({ message, severity = 'info', source = null }) {
    const notification = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      message,
      severity,
      source,
      timestamp: Date.now(),
      read: false,
    };
    notifications = [notification, ...notifications].slice(0, MAX_NOTIFICATIONS);
    unreadCount = notifications.filter(n => !n.read).length;
    return notification.id;
  }

  function dismissNotification(id) {
    notifications = notifications.filter(n => n.id !== id);
    unreadCount = notifications.filter(n => !n.read).length;
  }

  function markAllRead() {
    notifications = notifications.map(n => ({ ...n, read: true }));
    unreadCount = 0;
  }

  function clearAllNotifications() {
    notifications = [];
    unreadCount = 0;
  }

  return {
    // ── Editor state getters ──
    get cursor() { return cursor; },
    get indent() { return indent; },
    get encoding() { return encoding; },
    get eol() { return eol; },
    get language() { return language; },
    get editorFocused() { return editorFocused; },

    // ── Editor state setters ──
    setCursor(line, col) { cursor = { line, col }; },
    setIndent(type, size) { indent = { type, size }; },
    setEncoding(val) { encoding = val; },
    setEol(val) { eol = val; },
    setLanguage(val) { language = val; },
    setEditorFocused(val) { editorFocused = val; },
    clearEditorState() {
      editorFocused = false;
      cursor = { line: 1, col: 1 };
      language = '';
    },

    // ── Git state ──
    get gitBranch() { return gitBranch; },
    get gitDirty() { return gitDirty; },

    // ── Diagnostics ──
    get diagErrors() { return diagErrors; },
    get diagWarnings() { return diagWarnings; },

    // ── Dev server ──
    get devServerStatus() { return devServerStatus; },
    get devServerPort() { return devServerPort; },

    // ── LSP health ──
    get lspHealth() { return lspHealth; },

    // ── Notifications ──
    get notifications() { return notifications; },
    get unreadCount() { return unreadCount; },
    addNotification,
    dismissNotification,
    markAllRead,
    clearAllNotifications,

    // ── Lifecycle ──
    startPolling() {
      startGitPolling();
      startLspPolling();
    },
    stopPolling() {
      stopGitPolling();
      stopLspPolling();
    },
    updateDiagnostics,
    updateDevServer,
    pollGitBranch,
    pollLspHealth,
  };
}

export const statusBarStore = createStatusBarStore();
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/stores/status-bar.test.cjs`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/lib/stores/status-bar.svelte.js test/stores/status-bar.test.cjs
git commit -m "feat(status-bar): add statusBarStore with state shape, setters, polling"
```

---

## Task 2: Create the StatusBar component shell + CSS

**Files:**
- Create: `src/components/shared/StatusBar.svelte`
- Create: `test/components/status-bar.test.cjs`

**Context:** The component renders the status bar UI. It reads all data from `statusBarStore`. At this stage it shows the basic layout with left/right containers and L2 (diagnostics). Other items are added in later tasks. The component is 22px tall, uses CSS custom properties for theming, and sits at the bottom of `.app-shell`. Refer to `src/components/shared/StatsBar.svelte` or `src/components/shared/TitleBar.svelte` for the general Svelte component pattern in this project.

**Step 1: Write the failing tests**

Create `test/components/status-bar.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../../src/components/shared/StatusBar.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('StatusBar.svelte: imports', () => {
  it('imports statusBarStore', () => {
    assert.ok(src.includes('statusBarStore'), 'Should import statusBarStore');
  });

  it('imports from status-bar.svelte.js', () => {
    assert.ok(src.includes('status-bar.svelte.js'), 'Should import from correct file');
  });

  it('imports navigationStore', () => {
    assert.ok(src.includes('navigationStore'), 'Should import navigationStore');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });
});

describe('StatusBar.svelte: layout', () => {
  it('has status-bar root class', () => {
    assert.ok(src.includes('status-bar'), 'Should have status-bar class');
  });

  it('has left section', () => {
    assert.ok(src.includes('status-bar-left'), 'Should have left section');
  });

  it('has right section', () => {
    assert.ok(src.includes('status-bar-right'), 'Should have right section');
  });

  it('has 22px height', () => {
    assert.ok(src.includes('22px'), 'Should have 22px height');
  });

  it('has 12px font size', () => {
    assert.ok(src.includes('12px'), 'Should have 12px font size');
  });
});

describe('StatusBar.svelte: theme awareness', () => {
  it('uses --bg-elevated for background', () => {
    assert.ok(src.includes('--bg-elevated'), 'Should use --bg-elevated');
  });

  it('uses --border for top border', () => {
    assert.ok(src.includes('--border'), 'Should use --border');
  });

  it('uses --text for primary text', () => {
    assert.ok(src.includes('--text'), 'Should use --text');
  });

  it('uses --muted for secondary text', () => {
    assert.ok(src.includes('--muted'), 'Should use --muted');
  });

  it('uses --danger for error counts', () => {
    assert.ok(src.includes('--danger'), 'Should use --danger');
  });

  it('uses --warn for warning counts', () => {
    assert.ok(src.includes('--warn'), 'Should use --warn');
  });
});

describe('StatusBar.svelte: L2 diagnostics', () => {
  it('displays diagErrors', () => {
    assert.ok(src.includes('diagErrors'), 'Should display error count');
  });

  it('displays diagWarnings', () => {
    assert.ok(src.includes('diagWarnings'), 'Should display warning count');
  });
});

describe('StatusBar.svelte: L1 git branch', () => {
  it('displays gitBranch', () => {
    assert.ok(src.includes('gitBranch'), 'Should display git branch');
  });

  it('shows dirty indicator', () => {
    assert.ok(src.includes('gitDirty'), 'Should show dirty indicator');
  });
});

describe('StatusBar.svelte: L3 dev server', () => {
  it('displays devServerStatus', () => {
    assert.ok(src.includes('devServerStatus'), 'Should display dev server status');
  });

  it('displays devServerPort', () => {
    assert.ok(src.includes('devServerPort'), 'Should display dev server port');
  });
});

describe('StatusBar.svelte: L4 LSP health', () => {
  it('displays lspHealth', () => {
    assert.ok(src.includes('lspHealth'), 'Should display LSP health');
  });

  it('has health dot classes', () => {
    assert.ok(src.includes('healthy') && src.includes('starting'), 'Should have health dot classes');
  });
});

describe('StatusBar.svelte: R1 cursor position', () => {
  it('displays cursor line and col', () => {
    assert.ok(src.includes('cursor.line') || src.includes('cursor?.line'), 'Should display cursor line');
    assert.ok(src.includes('cursor.col') || src.includes('cursor?.col'), 'Should display cursor col');
  });
});

describe('StatusBar.svelte: R2 indentation', () => {
  it('displays indent type and size', () => {
    assert.ok(src.includes('indent'), 'Should display indentation');
  });
});

describe('StatusBar.svelte: R3 encoding', () => {
  it('displays encoding', () => {
    assert.ok(src.includes('encoding'), 'Should display encoding');
  });
});

describe('StatusBar.svelte: R4 EOL', () => {
  it('displays eol', () => {
    assert.ok(src.includes('.eol'), 'Should display EOL');
  });
});

describe('StatusBar.svelte: R5 language', () => {
  it('displays language', () => {
    assert.ok(src.includes('.language') || src.includes('language}'), 'Should display language');
  });
});

describe('StatusBar.svelte: R6 notification bell', () => {
  it('has notification bell', () => {
    assert.ok(src.includes('notification') || src.includes('bell'), 'Should have notification bell');
  });

  it('shows unread count', () => {
    assert.ok(src.includes('unreadCount'), 'Should show unread count');
  });
});

describe('StatusBar.svelte: conditional visibility', () => {
  it('checks editorFocused for right side items', () => {
    assert.ok(src.includes('editorFocused'), 'Should check editorFocused');
  });

  it('checks project for left side items', () => {
    assert.ok(src.includes('hasProject') || src.includes('projectStore.activeProject'), 'Should check project');
  });
});

describe('StatusBar.svelte: CSS', () => {
  it('uses flex-shrink 0', () => {
    assert.ok(src.includes('flex-shrink') && src.includes('0'), 'Should not shrink');
  });

  it('uses display flex', () => {
    assert.ok(src.includes('display: flex') || src.includes('display:flex'), 'Should use flexbox');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/components/status-bar.test.cjs`
Expected: FAIL — file not found

**Step 3: Write the StatusBar component**

Create `src/components/shared/StatusBar.svelte`:

```svelte
<script>
  import { statusBarStore } from '../../lib/stores/status-bar.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';

  let hasProject = $derived(!!projectStore.activeProject?.path);
  let isLens = $derived(navigationStore.activeView === 'lens');
  let showEditorItems = $derived(statusBarStore.editorFocused && isLens);

  // Keep diagnostics + dev server synced reactively
  $effect(() => {
    lspDiagnosticsStore.diagnostics; // track
    statusBarStore.updateDiagnostics();
  });

  $effect(() => {
    devServerManager.servers; // track
    statusBarStore.updateDevServer();
  });

  // Start/stop polling based on project
  $effect(() => {
    if (hasProject) {
      statusBarStore.startPolling();
    } else {
      statusBarStore.stopPolling();
    }
    return () => statusBarStore.stopPolling();
  });

  // Notification center state
  let notifOpen = $state(false);

  function toggleNotifications() {
    notifOpen = !notifOpen;
    if (notifOpen) {
      statusBarStore.markAllRead();
    }
  }

  function closeNotifications() {
    notifOpen = false;
  }

  function handleNotifWindowClick(e) {
    if (!notifOpen) return;
    if (!e.target.closest('.status-bar-notif-panel') && !e.target.closest('.status-bar-bell')) {
      closeNotifications();
    }
  }
</script>

<svelte:document onclick={handleNotifWindowClick} />

<footer class="status-bar">
  <!-- LEFT SIDE -->
  <div class="status-bar-left">
    {#if hasProject}
      <!-- L1: Git branch -->
      {#if statusBarStore.gitBranch}
        <span class="status-bar-item" title="Git branch: {statusBarStore.gitBranch}">
          <span class="status-bar-icon">&#x2387;</span>
          <span>{statusBarStore.gitBranch}</span>
          {#if statusBarStore.gitDirty}<span class="status-bar-dirty">*</span>{/if}
        </span>
      {/if}

      <!-- L2: Diagnostics -->
      <span class="status-bar-item status-bar-diag" title="Errors: {statusBarStore.diagErrors}, Warnings: {statusBarStore.diagWarnings}">
        <span class="status-bar-diag-errors" class:has-errors={statusBarStore.diagErrors > 0}>
          <span class="status-bar-icon">&#x2298;</span>
          <span>{statusBarStore.diagErrors}</span>
        </span>
        <span class="status-bar-diag-warnings" class:has-warnings={statusBarStore.diagWarnings > 0}>
          <span class="status-bar-icon">&#x26A0;</span>
          <span>{statusBarStore.diagWarnings}</span>
        </span>
      </span>

      <!-- L3: Dev server -->
      {#if statusBarStore.devServerStatus !== 'stopped'}
        <span class="status-bar-item" title="Dev server: {statusBarStore.devServerStatus}">
          {#if statusBarStore.devServerStatus === 'running' || statusBarStore.devServerStatus === 'idle'}
            <span class="status-bar-icon status-bar-dev-running">&#x25B6;</span>
            <span>:{statusBarStore.devServerPort}</span>
          {:else if statusBarStore.devServerStatus === 'starting'}
            <span class="status-bar-icon status-bar-dev-starting">&#x25B6;</span>
            <span>starting...</span>
          {:else if statusBarStore.devServerStatus === 'crashed'}
            <span class="status-bar-icon status-bar-dev-crashed">&#x25A0;</span>
            <span>crashed</span>
          {/if}
        </span>
      {/if}

      <!-- L4: LSP health -->
      {#if statusBarStore.lspHealth !== 'none'}
        <span class="status-bar-item" title="LSP: {statusBarStore.lspHealth}">
          <span class="status-bar-icon">&#x26A1;</span>
          <span class="status-bar-lsp-dot"
            class:healthy={statusBarStore.lspHealth === 'healthy'}
            class:starting={statusBarStore.lspHealth === 'starting'}
            class:error={statusBarStore.lspHealth === 'error'}
          ></span>
        </span>
      {/if}
    {/if}
  </div>

  <!-- RIGHT SIDE -->
  <div class="status-bar-right">
    {#if showEditorItems}
      <!-- R1: Cursor position -->
      <span class="status-bar-item" title="Go to Line">
        Ln {statusBarStore.cursor.line}, Col {statusBarStore.cursor.col}
      </span>

      <!-- R2: Indentation -->
      <span class="status-bar-item">
        {statusBarStore.indent.type === 'tabs' ? 'Tabs' : 'Spaces'}: {statusBarStore.indent.size}
      </span>

      <!-- R3: Encoding -->
      <span class="status-bar-item">
        {statusBarStore.encoding}
      </span>

      <!-- R4: EOL -->
      <span class="status-bar-item status-bar-eol">
        {statusBarStore.eol}
      </span>

      <!-- R5: Language -->
      {#if statusBarStore.language}
        <span class="status-bar-item">
          {statusBarStore.language}
        </span>
      {/if}
    {/if}

    <!-- R6: Notification bell (always shown) -->
    <button class="status-bar-item status-bar-bell" onclick={toggleNotifications} title="Notifications">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {#if statusBarStore.unreadCount > 0}
        <span class="status-bar-notif-badge">{statusBarStore.unreadCount}</span>
      {/if}
    </button>

    <!-- Notification center dropdown -->
    {#if notifOpen}
      <div class="status-bar-notif-panel">
        <div class="status-bar-notif-header">
          <span>Notifications</span>
          {#if statusBarStore.notifications.length > 0}
            <button class="status-bar-notif-clear" onclick={() => statusBarStore.clearAllNotifications()}>Clear All</button>
          {/if}
        </div>
        <div class="status-bar-notif-list">
          {#if statusBarStore.notifications.length === 0}
            <div class="status-bar-notif-empty">No notifications</div>
          {:else}
            {#each statusBarStore.notifications as notif (notif.id)}
              <div class="status-bar-notif-item" class:unread={!notif.read}>
                <span class="status-bar-notif-message">{notif.message}</span>
                <span class="status-bar-notif-time">{new Date(notif.timestamp).toLocaleTimeString()}</span>
                <button class="status-bar-notif-dismiss" onclick={() => statusBarStore.dismissNotification(notif.id)}>&times;</button>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    font-size: 12px;
    font-family: var(--font-family);
    color: var(--muted);
    user-select: none;
    -webkit-app-region: no-drag;
    z-index: 100;
    position: relative;
  }

  .status-bar-left,
  .status-bar-right {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .status-bar-right {
    position: relative;
  }

  .status-bar-item {
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
    cursor: default;
    padding: 0 4px;
    border-radius: 3px;
    height: 18px;
    line-height: 18px;
  }

  .status-bar-item:hover {
    background: var(--bg-hover, rgba(255,255,255,0.06));
    color: var(--text);
  }

  .status-bar-icon {
    font-size: 12px;
    line-height: 1;
  }

  .status-bar-dirty {
    color: var(--warn);
    font-weight: bold;
  }

  /* Diagnostics */
  .status-bar-diag {
    gap: 8px;
  }

  .status-bar-diag-errors,
  .status-bar-diag-warnings {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .status-bar-diag-errors.has-errors {
    color: var(--danger);
  }

  .status-bar-diag-warnings.has-warnings {
    color: var(--warn);
  }

  /* Dev server */
  .status-bar-dev-running { color: var(--ok); }
  .status-bar-dev-starting { color: var(--warn); }
  .status-bar-dev-crashed { color: var(--danger); }

  /* LSP health dot */
  .status-bar-lsp-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
  }

  .status-bar-lsp-dot.healthy { background: var(--ok); }
  .status-bar-lsp-dot.starting { background: var(--warn); }
  .status-bar-lsp-dot.error { background: var(--danger); }

  /* Notification bell */
  .status-bar-bell {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    position: relative;
    padding: 0 4px;
    display: flex;
    align-items: center;
  }

  .status-bar-bell:hover {
    color: var(--text);
  }

  .status-bar-notif-badge {
    position: absolute;
    top: -4px;
    right: 0;
    min-width: 14px;
    height: 14px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--bg);
    font-size: 9px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    line-height: 1;
  }

  /* Notification panel */
  .status-bar-notif-panel {
    position: absolute;
    bottom: 24px;
    right: 0;
    width: 320px;
    max-height: 400px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
    z-index: 1000;
    display: flex;
    flex-direction: column;
  }

  .status-bar-notif-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    font-size: 12px;
    color: var(--text);
  }

  .status-bar-notif-clear {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 11px;
  }

  .status-bar-notif-list {
    overflow-y: auto;
    max-height: 360px;
  }

  .status-bar-notif-empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }

  .status-bar-notif-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }

  .status-bar-notif-item.unread {
    background: rgba(var(--accent-rgb, 100, 149, 237), 0.05);
  }

  .status-bar-notif-message {
    flex: 1;
    color: var(--text);
    min-width: 0;
    word-break: break-word;
  }

  .status-bar-notif-time {
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .status-bar-notif-dismiss {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
  }

  .status-bar-notif-dismiss:hover {
    color: var(--danger);
  }
</style>
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/components/status-bar.test.cjs`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/components/shared/StatusBar.svelte test/components/status-bar.test.cjs
git commit -m "feat(status-bar): add StatusBar component with full layout and styling"
```

---

## Task 3: Mount StatusBar in App.svelte

**Files:**
- Modify: `src/App.svelte` (lines 21, 460-461)

**Context:** The status bar goes inside `.app-shell`, after `.app-body` (line 460), before the closing `</div>`. It is always visible (not gated by `isOverlay` — overlay mode has its own UI). The component needs to be imported and placed as a sibling of `.app-body` in the flex column.

**Step 1: Write no new tests** (the existing `test/components/status-bar.test.cjs` already tests the component's structure; mounting is visual verification)

**Step 2: Modify App.svelte**

Add the import after line 26 (after the `StatsBar` import):

```js
import StatusBar from './components/shared/StatusBar.svelte';
```

Add the component after `.app-body` closing `</div>` (line 460), before the `.app-shell` closing `</div>` (line 461):

```svelte
    </div>
    <StatusBar />
  </div>
```

So the structure becomes:
```svelte
  <div class="app-shell">
    <TitleBar>...</TitleBar>
    <div class="app-body">
      ...
    </div>
    <StatusBar />
  </div>
```

**Step 3: Run all tests to verify nothing breaks**

Run: `npm test`
Expected: All tests PASS (4400+)

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat(status-bar): mount StatusBar in App.svelte layout"
```

---

## Task 4: Wire FileEditor → statusBarStore (cursor, indent, EOL, encoding, language)

**Files:**
- Modify: `src/components/lens/FileEditor.svelte` (add import, add update listener, add lifecycle)
- Modify: `src/lib/editor-extensions.js` (add cursor/selection update callback)

**Context:** FileEditor creates a CodeMirror `EditorView` (line 413). We need to:
1. Import `statusBarStore` and `getLanguageName` in FileEditor
2. Add an `EditorView.updateListener` callback that fires on every cursor move and pushes data to the store
3. Set `editorFocused = true` when the editor mounts, `false` when it unmounts
4. Detect EOL from file content (`\r\n` = CRLF, else LF)
5. Set encoding to `UTF-8` (all files are read as UTF-8 by the Rust backend)
6. Set language using `getLanguageName(filePath)`
7. Read indentation from CodeMirror's `indentUnit` facet

**Step 1: Add tests to `test/components/status-bar.test.cjs`**

Append to the existing test file:

```js
// Read FileEditor source for wiring tests
const FE_SRC_PATH = path.join(__dirname, '../../src/components/lens/FileEditor.svelte');
const feSrc = fs.readFileSync(FE_SRC_PATH, 'utf-8');

describe('FileEditor.svelte: status bar wiring', () => {
  it('imports statusBarStore', () => {
    assert.ok(feSrc.includes('statusBarStore'), 'Should import statusBarStore');
  });

  it('imports getLanguageName', () => {
    assert.ok(feSrc.includes('getLanguageName'), 'Should import getLanguageName');
  });

  it('calls setCursor', () => {
    assert.ok(feSrc.includes('statusBarStore.setCursor'), 'Should call setCursor');
  });

  it('calls setLanguage', () => {
    assert.ok(feSrc.includes('statusBarStore.setLanguage'), 'Should call setLanguage');
  });

  it('calls setEditorFocused', () => {
    assert.ok(feSrc.includes('statusBarStore.setEditorFocused'), 'Should call setEditorFocused');
  });

  it('calls setEol', () => {
    assert.ok(feSrc.includes('statusBarStore.setEol'), 'Should call setEol');
  });

  it('calls clearEditorState on destroy', () => {
    assert.ok(feSrc.includes('statusBarStore.clearEditorState'), 'Should clear on destroy');
  });
});
```

**Step 2: Run tests to verify new tests fail**

Run: `node --test test/components/status-bar.test.cjs`
Expected: New tests FAIL (FileEditor doesn't have these imports/calls yet)

**Step 3: Modify FileEditor.svelte**

Add import after line 22 (after `loadLanguageExtension` import):

```js
import { statusBarStore, getLanguageName } from '../../lib/stores/status-bar.svelte.js';
```

After the editor is created (after line 421, after the git gutter setup), add status bar initialization:

```js
        // Status bar: set language and initial editor state
        statusBarStore.setLanguage(getLanguageName(filePath));
        statusBarStore.setEditorFocused(true);
        statusBarStore.setEncoding('UTF-8');

        // Detect EOL from content
        const hasCarriageReturn = data.content?.includes('\r\n');
        statusBarStore.setEol(hasCarriageReturn ? 'CRLF' : 'LF');

        // Detect indentation from CodeMirror state
        const indentUnit = view.state.facet?.(cm.EditorState?.indentUnit) || '  ';
        const isTab = indentUnit === '\t';
        statusBarStore.setIndent(isTab ? 'tabs' : 'spaces', isTab ? 4 : indentUnit.length);
```

Add a cursor tracking update listener. In `buildEditorExtensions` call (around line 265), add a new callback option `onSelectionChanged`:

In `src/lib/editor-extensions.js`, add to the `EditorView.updateListener` callback (around line 60-74), after the existing selection check:

```js
      // Status bar cursor tracking
      if (update.selectionSet || update.docChanged) {
        if (options.onCursorActivity) {
          options.onCursorActivity(update);
        }
      }
```

Then in FileEditor.svelte, in the `buildEditorExtensions` call, add the `onCursorActivity` option:

```js
        onCursorActivity: (update) => {
          const pos = update.state.selection.main.head;
          const lineInfo = update.state.doc.lineAt(pos);
          statusBarStore.setCursor(lineInfo.number, pos - lineInfo.from + 1);
        },
```

Add cleanup in the `onDestroy` callback (FileEditor already has cleanup logic). Find the `onDestroy` call and add:

```js
  onDestroy(() => {
    // ... existing cleanup ...
    statusBarStore.clearEditorState();
  });
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/components/lens/FileEditor.svelte src/lib/editor-extensions.js test/components/status-bar.test.cjs
git commit -m "feat(status-bar): wire FileEditor cursor, indent, EOL, encoding, language to statusBarStore"
```

---

## Task 5: Wire R1 click → Go to Line dialog

**Files:**
- Modify: `src/components/shared/StatusBar.svelte`

**Context:** Clicking the cursor position (R1) should open the Command Palette in `goto-line` mode. The Command Palette is already wired to `commandPaletteVisible` and `commandPaletteMode` state in `App.svelte`. The simplest approach is to dispatch a DOM event that App.svelte listens for, similar to `lens-focus-search`. Alternatively, we can use the existing keyboard shortcut mechanism — the `go-to-line` shortcut already sets `commandPaletteMode = 'goto-line'` in App.svelte (line 182).

**Step 1: Add test**

Append to `test/components/status-bar.test.cjs`:

```js
describe('StatusBar.svelte: R1 click action', () => {
  it('dispatches go-to-line event on cursor click', () => {
    assert.ok(
      src.includes('status-bar-go-to-line') || src.includes('dispatchEvent'),
      'Should dispatch event on cursor click'
    );
  });
});
```

**Step 2: Modify StatusBar.svelte**

Change the R1 cursor item from a `<span>` to a clickable `<button>`:

```svelte
      <!-- R1: Cursor position -->
      <button class="status-bar-item status-bar-clickable" title="Go to Line"
        onclick={() => window.dispatchEvent(new CustomEvent('status-bar-go-to-line'))}>
        Ln {statusBarStore.cursor.line}, Col {statusBarStore.cursor.col}
      </button>
```

**Step 3: Modify App.svelte**

In the `$effect` that sets up shortcuts (around line 171-199), add a listener for the new event:

```js
      const handleGoToLine = () => {
        commandPaletteMode = 'goto-line';
        commandPaletteVisible = true;
      };
      window.addEventListener('status-bar-go-to-line', handleGoToLine);
```

And in the cleanup, remove the listener.

**Step 4: Run all tests**

Run: `npm test`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/components/shared/StatusBar.svelte src/App.svelte
git commit -m "feat(status-bar): wire cursor position click to Go to Line dialog"
```

---

## Task 6: Route toasts through notification store

**Files:**
- Modify: `src/lib/stores/toast.svelte.js`
- Modify: `test/stores/status-bar.test.cjs`

**Context:** Currently, `toastStore.addToast()` creates temporary toast notifications. We need to also persist each toast into `statusBarStore.addNotification()` so the notification bell tracks all notifications. The toast store already has the `addToast` function — we just need to also call `statusBarStore.addNotification()` inside it.

**Step 1: Add test**

Append to `test/stores/status-bar.test.cjs`:

```js
// Read toast store for wiring test
const TOAST_PATH = path.join(__dirname, '../../src/lib/stores/toast.svelte.js');
const toastSrc = fs.readFileSync(TOAST_PATH, 'utf-8');

describe('toast.svelte.js: notification routing', () => {
  it('imports statusBarStore', () => {
    assert.ok(toastSrc.includes('statusBarStore'), 'Should import statusBarStore');
  });

  it('calls addNotification when adding toast', () => {
    assert.ok(toastSrc.includes('addNotification'), 'Should route to notification store');
  });
});
```

**Step 2: Modify toast.svelte.js**

Add import at top:

```js
import { statusBarStore } from './status-bar.svelte.js';
```

Inside `addToast()`, after the toast is created and added (after line 96 `toasts = [...toasts, toast]`), add:

```js
    // Persist to notification center
    statusBarStore.addNotification({
      message,
      severity,
      source: 'toast',
    });
```

**Step 3: Run all tests**

Run: `npm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/lib/stores/toast.svelte.js test/stores/status-bar.test.cjs
git commit -m "feat(status-bar): route toast notifications through notification bell"
```

---

## Task 7: Update IDE-GAPS.md

**Files:**
- Modify: `docs/source-of-truth/IDE-GAPS.md`

**Context:** After implementing the status bar, update IDE-GAPS.md to reflect the new features as completed. The status bar items that were previously listed as gaps should be moved to the completed section.

**Step 1: Read IDE-GAPS.md**

Read the file to find status bar related entries.

**Step 2: Update the document**

Move status bar items from the gaps list to the completed table. Items that should be marked as completed:
- Status bar (general)
- Cursor position indicator
- Language mode display
- Git branch indicator (in status bar)
- Diagnostics summary
- Notification bell / notification center

**Step 3: Commit**

```bash
git add docs/source-of-truth/IDE-GAPS.md
git commit -m "docs: update IDE-GAPS.md with completed status bar features"
```

---

## Task 8: Run full test suite and verify

**Files:** None (verification only)

**Context:** Final verification step. Run the full test suite to ensure all 4400+ tests pass and nothing is broken.

**Step 1: Run all tests**

Run: `npm test`
Expected: All PASS (should be ~4450+ tests now with new status bar tests)

**Step 2: Verify visual appearance**

Run: `npm run dev`

Check:
- Status bar appears at bottom of app shell
- 22px height, 12px font
- Theme-aware (try switching themes)
- Git branch shows when project is open
- Diagnostics show `⊘ 0 ⚠ 0` by default
- Cursor position updates on click/type in editor
- Language mode shows for open files
- Indentation, encoding, EOL display correctly
- Notification bell appears far right
- Items hide when terminal/chat is focused (only bell stays)
- Sidebar collapse/expand doesn't affect status bar

**Step 3: Final commit (if any visual fixes needed)**

```bash
git add -A
git commit -m "fix(status-bar): visual polish and adjustments"
```

---

## Summary

| Task | Description | Files | Tests |
|------|-------------|-------|-------|
| 1 | Status bar store | `status-bar.svelte.js` | ~25 tests |
| 2 | StatusBar component + CSS | `StatusBar.svelte` | ~30 tests |
| 3 | Mount in App.svelte | `App.svelte` | Existing tests |
| 4 | FileEditor → store wiring | `FileEditor.svelte`, `editor-extensions.js` | ~7 tests |
| 5 | R1 click → Go to Line | `StatusBar.svelte`, `App.svelte` | ~1 test |
| 6 | Toast → notification routing | `toast.svelte.js` | ~2 tests |
| 7 | Update IDE-GAPS.md | `IDE-GAPS.md` | — |
| 8 | Full verification | — | Full suite |

**Total new tests:** ~65
**Total files created:** 4 (store, component, 2 test files)
**Total files modified:** 5 (App.svelte, FileEditor.svelte, editor-extensions.js, toast.svelte.js, IDE-GAPS.md)
