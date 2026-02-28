/**
 * status-bar.svelte.js -- Svelte 5 reactive store for status bar data aggregation.
 *
 * Aggregates editor state (cursor, indent, encoding, EOL, language), git info,
 * LSP diagnostics, dev server status, LSP health, and notifications into a
 * single reactive store consumed by the StatusBar component.
 */

import { getGitChanges, lspGetStatus } from '../api.js';
import { projectStore } from './project.svelte.js';
import { lspDiagnosticsStore } from './lsp-diagnostics.svelte.js';
import { devServerManager } from './dev-server-manager.svelte.js';
import { navigationStore } from './navigation.svelte.js';
import { tabsStore } from './tabs.svelte.js';

// -- Constants --
const GIT_POLL_INTERVAL = 5000;
const LSP_POLL_INTERVAL = 10000;
const MAX_NOTIFICATIONS = 100;

/** Counter for notification IDs */
let notifIdCounter = 0;

/**
 * Map file extension to human-readable language name.
 * @param {string} filePath - File path or filename
 * @returns {string} Language name or 'Plain Text' fallback
 */
export function getLanguageName(filePath) {
  if (!filePath) return 'Plain Text';
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return 'Plain Text';
  const ext = filePath.slice(dotIdx + 1).toLowerCase();

  const LANG_MAP = {
    js: 'JavaScript',
    jsx: 'JavaScript JSX',
    ts: 'TypeScript',
    tsx: 'TypeScript JSX',
    rs: 'Rust',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    svelte: 'Svelte',
    json: 'JSON',
    md: 'Markdown',
    py: 'Python',
    toml: 'TOML',
    yaml: 'YAML',
    yml: 'YAML',
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    xml: 'XML',
    svg: 'SVG',
    txt: 'Plain Text',
  };

  return LANG_MAP[ext] || 'Plain Text';
}

function createStatusBarStore() {
  // -- Editor state (pushed by FileEditor) --
  let cursor = $state({ line: 1, col: 1 });
  let indent = $state({ type: 'spaces', size: 2 });
  let encoding = $state('UTF-8');
  let eol = $state('LF');
  let language = $state('Plain Text');
  let editorFocused = $state(false);

  // -- Git state (polled) --
  let gitBranch = $state(null);
  let gitDirty = $state(false);

  // -- Diagnostics (synced from lspDiagnosticsStore) --
  let diagErrors = $state(0);
  let diagWarnings = $state(0);

  // -- Dev server (synced from devServerManager) --
  let devServerStatus = $state(null);
  let devServerPort = $state(null);

  // -- LSP health (polled) --
  let lspHealth = $state('none');

  // -- Notifications --
  let notifications = $state([]);

  // -- Polling timers --
  let gitPollTimer = null;
  let lspPollTimer = null;

  // ── Editor setters ──────────────────────────────────────────────────────

  function setCursor(line, col) {
    cursor = { line, col };
  }

  function setIndent(type, size) {
    indent = { type, size };
  }

  function setEncoding(val) {
    encoding = val;
  }

  function setEol(val) {
    eol = val;
  }

  function setLanguage(val) {
    language = val;
  }

  function setEditorFocused(val) {
    editorFocused = val;
  }

  function clearEditorState() {
    cursor = { line: 1, col: 1 };
    indent = { type: 'spaces', size: 2 };
    encoding = 'UTF-8';
    eol = 'LF';
    language = 'Plain Text';
    editorFocused = false;
  }

  // ── Notifications ──────────────────────────────────────────────────────

  function addNotification({ message, severity = 'info', source = null }) {
    const id = 'notif-' + (++notifIdCounter);
    const notification = {
      id,
      message,
      severity,
      source,
      timestamp: Date.now(),
      read: false,
    };

    // Trim oldest if over max
    let updated = [...notifications, notification];
    if (updated.length > MAX_NOTIFICATIONS) {
      updated = updated.slice(updated.length - MAX_NOTIFICATIONS);
    }
    notifications = updated;
    return id;
  }

  function dismissNotification(id) {
    notifications = notifications.filter(n => n.id !== id);
  }

  function markAllRead() {
    notifications = notifications.map(n => ({ ...n, read: true }));
  }

  function clearAllNotifications() {
    notifications = [];
  }

  // ── Polling ────────────────────────────────────────────────────────────

  async function pollGitBranch() {
    try {
      const project = projectStore.activeProject;
      if (!project?.path) {
        gitBranch = null;
        gitDirty = false;
        return;
      }
      const result = await getGitChanges(project.path);
      const data = result?.data;
      if (data) {
        gitBranch = data.branch || null;
        const changes = data.changes || [];
        gitDirty = changes.length > 0;
      }
    } catch (err) {
      console.warn('[status-bar] Git poll failed:', err);
    }
  }

  async function pollLspHealth() {
    try {
      const result = await lspGetStatus();
      const data = result?.data;
      if (!data?.servers || data.servers.length === 0) {
        lspHealth = 'none';
        return;
      }

      const servers = data.servers;
      const hasError = servers.some(s => s.status === 'error');
      const hasStarting = servers.some(s => s.status === 'starting');
      const allHealthy = servers.every(s => s.status === 'running' || s.status === 'healthy');

      if (hasError) {
        lspHealth = 'error';
      } else if (hasStarting) {
        lspHealth = 'starting';
      } else if (allHealthy) {
        lspHealth = 'healthy';
      } else {
        lspHealth = 'none';
      }
    } catch (err) {
      console.warn('[status-bar] LSP poll failed:', err);
    }
  }

  function startPolling() {
    stopPolling();
    // Initial polls
    pollGitBranch();
    pollLspHealth();
    // Set up intervals
    gitPollTimer = setInterval(pollGitBranch, GIT_POLL_INTERVAL);
    lspPollTimer = setInterval(pollLspHealth, LSP_POLL_INTERVAL);
  }

  function stopPolling() {
    if (gitPollTimer !== null) {
      clearInterval(gitPollTimer);
      gitPollTimer = null;
    }
    if (lspPollTimer !== null) {
      clearInterval(lspPollTimer);
      lspPollTimer = null;
    }
  }

  // ── Sync methods ───────────────────────────────────────────────────────

  function updateDiagnostics() {
    const diags = lspDiagnosticsStore.diagnostics;
    let errors = 0;
    let warnings = 0;
    for (const [, counts] of diags) {
      errors += counts.errors || 0;
      warnings += counts.warnings || 0;
    }
    diagErrors = errors;
    diagWarnings = warnings;
  }

  function updateDevServer() {
    const project = projectStore.activeProject;
    if (!project?.path) {
      devServerStatus = null;
      devServerPort = null;
      return;
    }
    const state = devServerManager.getServerStatus(project.path);
    if (state) {
      devServerStatus = state.status;
      devServerPort = state.port;
    } else {
      devServerStatus = null;
      devServerPort = null;
    }
  }

  return {
    // -- Getters --
    get cursor() { return cursor; },
    get indent() { return indent; },
    get encoding() { return encoding; },
    get eol() { return eol; },
    get language() { return language; },
    get editorFocused() { return editorFocused; },
    get gitBranch() { return gitBranch; },
    get gitDirty() { return gitDirty; },
    get diagErrors() { return diagErrors; },
    get diagWarnings() { return diagWarnings; },
    get devServerStatus() { return devServerStatus; },
    get devServerPort() { return devServerPort; },
    get lspHealth() { return lspHealth; },
    get notifications() { return notifications; },
    get unreadCount() {
      return notifications.filter(n => !n.read).length;
    },

    // -- Editor setters --
    setCursor,
    setIndent,
    setEncoding,
    setEol,
    setLanguage,
    setEditorFocused,
    clearEditorState,

    // -- Notifications --
    addNotification,
    dismissNotification,
    markAllRead,
    clearAllNotifications,

    // -- Polling --
    startPolling,
    stopPolling,
    pollGitBranch,
    pollLspHealth,

    // -- Sync --
    updateDiagnostics,
    updateDevServer,
  };
}

export const statusBarStore = createStatusBarStore();
