/**
 * status-bar.test.cjs -- Source-inspection tests for StatusBar.svelte
 *
 * Validates layout, imports, theme CSS variables, each status bar item (L1-L4, R1-R6),
 * conditional visibility, CSS properties, and notification bell + panel.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/shared/StatusBar.svelte'),
  'utf-8'
);

describe('StatusBar.svelte: imports', () => {
  it('imports statusBarStore', () => {
    assert.ok(src.includes("from '../../lib/stores/status-bar.svelte.js'"), 'Should import statusBarStore');
  });

  it('imports navigationStore', () => {
    assert.ok(src.includes("from '../../lib/stores/navigation.svelte.js'"), 'Should import navigationStore');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes("from '../../lib/stores/project.svelte.js'"), 'Should import projectStore');
  });

  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes("from '../../lib/stores/lsp-diagnostics.svelte.js'"), 'Should import lspDiagnosticsStore');
  });

  it('imports devServerManager', () => {
    assert.ok(src.includes("from '../../lib/stores/dev-server-manager.svelte.js'"), 'Should import devServerManager');
  });
});

describe('StatusBar.svelte: layout', () => {
  it('uses footer element with status-bar class', () => {
    assert.ok(src.includes('<footer class="status-bar"'), 'Should use <footer class="status-bar">');
  });

  it('has left section', () => {
    assert.ok(src.includes('status-bar-left'), 'Should have left section class');
  });

  it('has right section', () => {
    assert.ok(src.includes('status-bar-right'), 'Should have right section class');
  });
});

describe('StatusBar.svelte: CSS properties', () => {
  it('has 22px height', () => {
    assert.ok(src.includes('22px'), 'Should have 22px height');
  });

  it('has 12px font-size', () => {
    assert.ok(src.includes('12px'), 'Should have 12px font-size');
  });

  it('uses flex-shrink: 0', () => {
    assert.ok(src.includes('flex-shrink: 0'), 'Should have flex-shrink: 0');
  });

  it('uses display: flex', () => {
    assert.ok(src.includes('display: flex'), 'Should use display: flex');
  });

  it('uses justify-content: space-between', () => {
    assert.ok(src.includes('justify-content: space-between'), 'Should use space-between');
  });

  it('uses user-select: none', () => {
    assert.ok(src.includes('user-select: none'), 'Should have user-select: none');
  });

  it('uses -webkit-app-region: no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag for Tauri frameless');
  });

  it('uses var(--bg-elevated) for background', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated for background');
  });

  it('uses var(--border) for top border', () => {
    assert.ok(src.includes('var(--border)'), 'Should use --border for top border');
  });

  it('uses var(--muted) for default text color', () => {
    assert.ok(src.includes('var(--muted)'), 'Should use --muted as default text color');
  });

  it('uses var(--font-family) for font', () => {
    assert.ok(src.includes('var(--font-family)'), 'Should use --font-family');
  });
});

describe('StatusBar.svelte: L1 - Git branch', () => {
  it('displays git branch name', () => {
    assert.ok(src.includes('statusBarStore.gitBranch'), 'Should read gitBranch from store');
  });

  it('shows dirty indicator when gitDirty', () => {
    assert.ok(src.includes('statusBarStore.gitDirty'), 'Should read gitDirty from store');
  });

  it('has branch icon symbol', () => {
    // Uses the fork/branch symbol
    assert.ok(src.includes('git-branch') || src.includes('\u2387') || src.includes('svg'), 'Should have branch icon');
  });
});

describe('StatusBar.svelte: L2 - Diagnostics', () => {
  it('displays error count from store', () => {
    assert.ok(src.includes('statusBarStore.diagErrors'), 'Should read diagErrors from store');
  });

  it('displays warning count from store', () => {
    assert.ok(src.includes('statusBarStore.diagWarnings'), 'Should read diagWarnings from store');
  });

  it('uses --danger color for errors > 0', () => {
    assert.ok(src.includes('var(--danger)'), 'Should use --danger for error styling');
  });

  it('uses --warn color for warnings > 0', () => {
    assert.ok(src.includes('var(--warn)'), 'Should use --warn for warning styling');
  });
});

describe('StatusBar.svelte: L3 - Dev server', () => {
  it('reads devServerStatus from store', () => {
    assert.ok(src.includes('statusBarStore.devServerStatus'), 'Should read devServerStatus');
  });

  it('reads devServerPort from store', () => {
    assert.ok(src.includes('statusBarStore.devServerPort'), 'Should read devServerPort');
  });

  it('uses --ok color for running server', () => {
    assert.ok(src.includes('var(--ok)'), 'Should use --ok for healthy/running state');
  });

  it('shows different states (running, starting, crashed)', () => {
    assert.ok(src.includes('starting'), 'Should handle starting state');
    assert.ok(src.includes('crashed'), 'Should handle crashed state');
  });
});

describe('StatusBar.svelte: L4 - LSP health', () => {
  it('reads lspHealth from store', () => {
    assert.ok(src.includes('statusBarStore.lspHealth'), 'Should read lspHealth from store');
  });

  it('shows colored health dot', () => {
    assert.ok(src.includes('lsp-dot') || src.includes('health-dot'), 'Should have colored LSP health dot');
  });

  it('hides when lspHealth is none', () => {
    assert.ok(src.includes("'none'"), 'Should handle none state for LSP health');
  });
});

describe('StatusBar.svelte: R1 - Cursor position', () => {
  it('displays line and column from store', () => {
    assert.ok(src.includes('statusBarStore.cursor'), 'Should read cursor from store');
  });

  it('shows "Ln" and "Col" labels', () => {
    assert.ok(src.includes('Ln'), 'Should show Ln label');
    assert.ok(src.includes('Col'), 'Should show Col label');
  });

  it('has "Go to Line" title attribute', () => {
    assert.ok(src.includes('Go to Line'), 'Should have Go to Line title');
  });
});

describe('StatusBar.svelte: R2 - Indentation', () => {
  it('reads indent from store', () => {
    assert.ok(src.includes('statusBarStore.indent'), 'Should read indent from store');
  });

  it('shows Spaces or Tabs label', () => {
    assert.ok(src.includes('Spaces') || src.includes('spaces'), 'Should show Spaces label');
    assert.ok(src.includes('Tabs') || src.includes('tabs'), 'Should show Tabs label');
  });
});

describe('StatusBar.svelte: R3 - Encoding', () => {
  it('reads encoding from store', () => {
    assert.ok(src.includes('statusBarStore.encoding'), 'Should read encoding from store');
  });
});

describe('StatusBar.svelte: R4 - EOL', () => {
  it('reads eol from store', () => {
    assert.ok(src.includes('statusBarStore.eol'), 'Should read eol from store');
  });
});

describe('StatusBar.svelte: R5 - Language', () => {
  it('reads language from store', () => {
    assert.ok(src.includes('statusBarStore.language'), 'Should read language from store');
  });
});

describe('StatusBar.svelte: R6 - Notification bell', () => {
  it('has a bell button', () => {
    assert.ok(src.includes('bell') || src.includes('notification'), 'Should have notification bell');
  });

  it('reads unreadCount from store', () => {
    assert.ok(src.includes('statusBarStore.unreadCount'), 'Should read unreadCount');
  });

  it('shows badge when unread > 0', () => {
    assert.ok(src.includes('badge'), 'Should have badge for unread count');
  });

  it('bell is a button element', () => {
    assert.ok(src.includes('bell-btn') || src.includes('notification-btn'), 'Should use button for bell');
  });

  it('has SVG bell icon', () => {
    assert.ok(src.includes('<svg') && src.includes('bell'), 'Should have SVG bell icon');
  });
});

describe('StatusBar.svelte: Notification panel', () => {
  it('has notification panel/dropdown', () => {
    assert.ok(src.includes('notification-panel') || src.includes('notif-panel'), 'Should have notification panel');
  });

  it('has header with Notifications title', () => {
    assert.ok(src.includes('Notifications'), 'Should have Notifications header');
  });

  it('has Clear All button', () => {
    assert.ok(src.includes('Clear All') || src.includes('clearAll'), 'Should have Clear All button');
  });

  it('calls clearAllNotifications on Clear All', () => {
    assert.ok(src.includes('clearAllNotifications'), 'Should call clearAllNotifications');
  });

  it('calls dismissNotification for individual dismiss', () => {
    assert.ok(src.includes('dismissNotification'), 'Should call dismissNotification');
  });

  it('has empty state text', () => {
    assert.ok(src.includes('No notifications') || src.includes('no notifications'), 'Should have empty state');
  });

  it('renders notifications list from store', () => {
    assert.ok(src.includes('statusBarStore.notifications'), 'Should read notifications from store');
  });

  it('notification panel positioned absolute', () => {
    const panelMatch = src.match(/\.notif-panel\s*\{[^}]*position:\s*absolute/) ||
                       src.match(/\.notification-panel\s*\{[^}]*position:\s*absolute/);
    assert.ok(panelMatch, 'Notification panel should be positioned absolute');
  });
});

describe('StatusBar.svelte: conditional visibility', () => {
  it('has hasProject derived state', () => {
    assert.ok(src.includes('hasProject') || src.includes('projectStore.activeProject'), 'Should check project state');
  });

  it('checks editorFocused for right side items', () => {
    assert.ok(src.includes('statusBarStore.editorFocused') || src.includes('editorFocused'), 'Should check editorFocused');
  });

  it('checks activeView for lens mode', () => {
    assert.ok(src.includes("'lens'") || src.includes('activeView'), 'Should check for lens view');
  });
});

describe('StatusBar.svelte: reactive sync', () => {
  it('uses $effect for reactive side effects', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for reactive sync');
  });

  it('calls updateDiagnostics sync', () => {
    assert.ok(src.includes('updateDiagnostics'), 'Should call updateDiagnostics');
  });

  it('calls updateDevServer sync', () => {
    assert.ok(src.includes('updateDevServer'), 'Should call updateDevServer');
  });

  it('calls startPolling and stopPolling', () => {
    assert.ok(src.includes('startPolling'), 'Should call startPolling');
    assert.ok(src.includes('stopPolling'), 'Should call stopPolling');
  });
});

describe('StatusBar.svelte: click-outside for notification panel', () => {
  it('has svelte:document or click-outside handler', () => {
    assert.ok(
      src.includes('svelte:document') || src.includes('svelte:window') || src.includes('clickOutside'),
      'Should have click-outside handler for notification panel'
    );
  });
});

// ---- FileEditor wiring tests ----
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

  it('calls setEncoding', () => {
    assert.ok(feSrc.includes('statusBarStore.setEncoding'), 'Should call setEncoding');
  });

  it('calls clearEditorState on destroy', () => {
    assert.ok(feSrc.includes('statusBarStore.clearEditorState'), 'Should clear on destroy');
  });
});

// ---- editor-extensions.js wiring tests ----
const EXT_SRC_PATH = path.join(__dirname, '../../src/lib/editor-extensions.js');
const extSrc = fs.readFileSync(EXT_SRC_PATH, 'utf-8');

describe('editor-extensions.js: cursor activity callback', () => {
  it('accepts onCursorActivity option', () => {
    assert.ok(extSrc.includes('onCursorActivity'), 'Should accept onCursorActivity');
  });

  it('calls onCursorActivity on selection change', () => {
    assert.ok(extSrc.includes('onCursorActivity(update)') || extSrc.includes('onCursorActivity('), 'Should call onCursorActivity');
  });
});

describe('StatusBar.svelte: theme integration', () => {
  it('uses var(--accent) for notification badge', () => {
    assert.ok(src.includes('var(--accent)'), 'Should use --accent for badge');
  });

  it('uses var(--text) for hover state', () => {
    assert.ok(src.includes('var(--text)'), 'Should use --text for hover');
  });

  it('uses var(--shadow) for notification panel', () => {
    assert.ok(
      src.includes('--shadow-md') || src.includes('--shadow-lg') || src.includes('--shadow-sm'),
      'Should use shadow variable for panel'
    );
  });
});
