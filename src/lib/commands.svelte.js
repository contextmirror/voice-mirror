/**
 * commands.svelte.js -- Central command registry for the command palette.
 *
 * Manages ~55 commands grouped by category (View, Editor, File, Search, LSP,
 * Git, Terminal, Chat, Voice, System). Commands can be searched, executed,
 * and tracked via MRU history in localStorage.
 *
 * This is a .svelte.js file so Svelte 5 runes ($state, $derived) work.
 */

import fuzzysort from 'fuzzysort';
import { layoutStore } from './stores/layout.svelte.js';
import { navigationStore } from './stores/navigation.svelte.js';
import { tabsStore } from './stores/tabs.svelte.js';
import { terminalTabsStore } from './stores/terminal-tabs.svelte.js';
import { editorGroupsStore } from './stores/editor-groups.svelte.js';
import { overlayStore } from './stores/overlay.svelte.js';
import { getActionHandler } from './stores/shortcuts.svelte.js';
import {
  gitStageAll,
  gitUnstageAll,
  gitPush,
  revealInExplorer,
  captureMonitor,
  detectGpu,
} from './api.js';

// ============ MRU History ============

const MRU_KEY = 'voice-mirror-command-history';
const MRU_MAX = 50;

/** @type {Map<string, number>|null} */
let mruCache = null;
let mruCounter = 0;

function loadMru() {
  if (mruCache) return;
  mruCache = new Map();
  try {
    const raw = localStorage.getItem(MRU_KEY);
    if (raw) {
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) {
        for (const [id, count] of entries) {
          mruCache.set(id, count);
          if (count >= mruCounter) mruCounter = count + 1;
        }
      }
    }
  } catch {
    mruCache = new Map();
  }
}

function saveMru() {
  if (!mruCache) return;
  try {
    const entries = [...mruCache.entries()];
    localStorage.setItem(MRU_KEY, JSON.stringify(entries));
  } catch {
    // localStorage quota or unavailable — ignore
  }
}

function pushHistory(id) {
  loadMru();
  mruCache.set(id, mruCounter++);
  // Evict oldest if over limit
  if (mruCache.size > MRU_MAX) {
    let oldestKey = null;
    let oldestVal = Infinity;
    for (const [k, v] of mruCache) {
      if (v < oldestVal) { oldestVal = v; oldestKey = k; }
    }
    if (oldestKey) mruCache.delete(oldestKey);
  }
  saveMru();
}

function getHistory() {
  loadMru();
  return [...mruCache.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

// ============ Registry ============

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   category?: string,
 *   keybinding?: string,
 *   execute: () => void,
 *   when?: () => boolean,
 * }} Command
 */

function createCommandRegistry() {
  /** @type {Map<string, Command>} */
  let commands = $state(new Map());

  return {
    get commands() { return commands; },

    /**
     * Register a single command.
     * @param {string} id
     * @param {{ label: string, category?: string, keybinding?: string, execute: () => void, when?: () => boolean }} opts
     */
    register(id, opts) {
      commands.set(id, { id, ...opts });
    },

    /**
     * Bulk register an array of commands.
     * @param {Array<{ id: string, label: string, category?: string, keybinding?: string, execute: () => void, when?: () => boolean }>} cmds
     */
    registerMany(cmds) {
      for (const cmd of cmds) {
        commands.set(cmd.id, cmd);
      }
    },

    /**
     * Unregister a command by ID.
     * @param {string} id
     */
    unregister(id) {
      commands.delete(id);
    },

    /**
     * Execute a command by ID. Pushes to MRU history.
     * @param {string} id
     */
    execute(id) {
      const cmd = commands.get(id);
      if (!cmd) {
        console.warn('[commands] Unknown command:', id);
        return;
      }
      if (cmd.when && !cmd.when()) return;
      pushHistory(id);
      cmd.execute();
    },

    /**
     * Fuzzy search commands. Returns results sorted by MRU first, then score.
     * Respects `when` conditions — hidden commands are excluded.
     * @param {string} query
     * @returns {Command[]}
     */
    search(query) {
      const available = [...commands.values()].filter(c => !c.when || c.when());
      if (!query.trim()) return available;

      const results = fuzzysort.go(query, available, { key: 'label', limit: 30 });
      const mruHistory = getHistory();

      return results
        .map(r => r.obj)
        .sort((a, b) => {
          const aIdx = mruHistory.indexOf(a.id);
          const bIdx = mruHistory.indexOf(b.id);
          const aHasMru = aIdx !== -1;
          const bHasMru = bIdx !== -1;
          // MRU items first, then by fuzzysort order (already sorted by score)
          if (aHasMru && !bHasMru) return -1;
          if (!aHasMru && bHasMru) return 1;
          if (aHasMru && bHasMru) return aIdx - bIdx;
          return 0;
        });
    },

    /**
     * Get all commands grouped by category.
     * MRU group appears first if history exists.
     * @returns {{ category: string, commands: Command[] }[]}
     */
    getAll() {
      const available = [...commands.values()].filter(c => !c.when || c.when());
      const mruHistory = getHistory();
      const groups = [];

      // MRU group first
      if (mruHistory.length > 0) {
        const mruCommands = mruHistory
          .map(id => commands.get(id))
          .filter(c => c && (!c.when || c.when()))
          .slice(0, 10);
        if (mruCommands.length > 0) {
          groups.push({ category: 'recently used', commands: mruCommands });
        }
      }

      // Group by category
      const byCategory = new Map();
      for (const cmd of available) {
        const cat = cmd.category || 'Other';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(cmd);
      }

      for (const [category, cmds] of byCategory) {
        groups.push({ category, commands: cmds });
      }

      return groups;
    },
  };
}

export const commandRegistry = createCommandRegistry();

// ============ Register Built-in Commands ============

// View (8)
commandRegistry.registerMany([
  {
    id: 'view.toggleChat',
    label: 'Toggle Chat Panel',
    category: 'View',
    execute: () => layoutStore.toggleChat(),
  },
  {
    id: 'view.toggleTerminal',
    label: 'Toggle Terminal',
    category: 'View',
    execute: () => layoutStore.toggleTerminal(),
  },
  {
    id: 'view.toggleFileTree',
    label: 'Toggle File Tree',
    category: 'View',
    execute: () => layoutStore.toggleFileTree(),
  },
  {
    id: 'view.openSettings',
    label: 'Open Settings',
    category: 'View',
    keybinding: 'Ctrl+,',
    execute: () => navigationStore.setView('settings'),
  },
  {
    id: 'view.openLens',
    label: 'Open Lens Workspace',
    category: 'View',
    execute: () => navigationStore.setMode('lens'),
  },
  {
    id: 'view.commandPalette',
    label: 'Show All Commands',
    category: 'View',
    keybinding: 'Ctrl+Shift+P',
    execute: () => window.dispatchEvent(new CustomEvent('command:open-palette', { detail: { mode: 'commands' } })),
  },
  {
    id: 'view.goToFile',
    label: 'Go to File',
    category: 'View',
    keybinding: 'Ctrl+P',
    execute: () => window.dispatchEvent(new CustomEvent('command:open-palette', { detail: { mode: 'files' } })),
  },
  {
    id: 'view.toggleBrowser',
    label: 'Toggle Browser Preview',
    category: 'View',
    execute: () => window.dispatchEvent(new CustomEvent('command:toggle-browser')),
  },
]);

// Editor (11)
commandRegistry.registerMany([
  {
    id: 'editor.splitRight',
    label: 'Split Editor Right',
    category: 'Editor',
    keybinding: 'Ctrl+\\',
    execute: () => getActionHandler('split-editor')?.(),
  },
  {
    id: 'editor.splitDown',
    label: 'Split Editor Down',
    category: 'Editor',
    execute: () => {
      const gid = editorGroupsStore.focusedGroupId;
      editorGroupsStore.splitGroup(gid, 'vertical');
    },
  },
  {
    id: 'editor.closeGroup',
    label: 'Close Editor Group',
    category: 'Editor',
    execute: () => {
      const gid = editorGroupsStore.focusedGroupId;
      if (editorGroupsStore.groupCount > 1) {
        editorGroupsStore.closeGroup(gid);
      }
    },
  },
  {
    id: 'editor.focusGroup1',
    label: 'Focus First Editor Group',
    category: 'Editor',
    keybinding: 'Ctrl+1',
    execute: () => getActionHandler('focus-group-1')?.(),
  },
  {
    id: 'editor.focusGroup2',
    label: 'Focus Second Editor Group',
    category: 'Editor',
    keybinding: 'Ctrl+2',
    execute: () => getActionHandler('focus-group-2')?.(),
  },
  {
    id: 'editor.focusLeft',
    label: 'Focus Editor Group Left',
    category: 'Editor',
    keybinding: 'Ctrl+K Ctrl+Left',
    execute: () => getActionHandler('focus-group-left')?.(),
  },
  {
    id: 'editor.focusRight',
    label: 'Focus Editor Group Right',
    category: 'Editor',
    keybinding: 'Ctrl+K Ctrl+Right',
    execute: () => getActionHandler('focus-group-right')?.(),
  },
  {
    id: 'editor.focusUp',
    label: 'Focus Editor Group Up',
    category: 'Editor',
    keybinding: 'Ctrl+K Ctrl+Up',
    execute: () => getActionHandler('focus-group-up')?.(),
  },
  {
    id: 'editor.focusDown',
    label: 'Focus Editor Group Down',
    category: 'Editor',
    keybinding: 'Ctrl+K Ctrl+Down',
    execute: () => getActionHandler('focus-group-down')?.(),
  },
  {
    id: 'editor.evenSizes',
    label: 'Reset Editor Group Sizes',
    category: 'Editor',
    keybinding: 'Ctrl+K Ctrl+=',
    execute: () => getActionHandler('even-editor-sizes')?.(),
  },
  {
    id: 'editor.maximize',
    label: 'Toggle Maximize Editor Group',
    category: 'Editor',
    keybinding: 'Ctrl+K Ctrl+M',
    execute: () => getActionHandler('maximize-editor-group')?.(),
  },
]);

// File (6)
commandRegistry.registerMany([
  {
    id: 'file.save',
    label: 'Save File',
    category: 'File',
    keybinding: 'Ctrl+S',
    execute: () => window.dispatchEvent(new CustomEvent('command:save')),
  },
  {
    id: 'file.newUntitled',
    label: 'New Untitled File',
    category: 'File',
    execute: () => tabsStore.createUntitled(),
  },
  {
    id: 'file.closeTab',
    label: 'Close Active Tab',
    category: 'File',
    execute: () => {
      const tab = tabsStore.getActiveTabForGroup(editorGroupsStore.focusedGroupId);
      if (tab) tabsStore.requestClose(tab.id);
    },
  },
  {
    id: 'file.closeOthers',
    label: 'Close Other Tabs',
    category: 'File',
    execute: () => {
      const activeId = tabsStore.activeTabId;
      if (activeId) tabsStore.closeOthers(activeId);
    },
  },
  {
    id: 'file.closeAll',
    label: 'Close All Tabs',
    category: 'File',
    execute: () => tabsStore.closeAll(),
  },
  {
    id: 'file.revealInExplorer',
    label: 'Reveal in File Explorer',
    category: 'File',
    execute: () => {
      const tab = tabsStore.activeTab;
      if (tab?.path && !tab.path.startsWith('untitled:')) {
        revealInExplorer(tab.path);
      }
    },
  },
]);

// Search (2)
commandRegistry.registerMany([
  {
    id: 'search.searchInFiles',
    label: 'Search in Files',
    category: 'Search',
    keybinding: 'Ctrl+Shift+F',
    execute: () => getActionHandler('open-text-search')?.(),
  },
  {
    id: 'search.goToLine',
    label: 'Go to Line',
    category: 'Search',
    keybinding: 'Ctrl+G',
    execute: () => window.dispatchEvent(new CustomEvent('command:open-palette', { detail: { mode: 'goto-line' } })),
  },
]);

// LSP (4)
commandRegistry.registerMany([
  {
    id: 'lsp.formatDocument',
    label: 'Format Document',
    category: 'LSP',
    keybinding: 'Shift+Alt+F',
    execute: () => window.dispatchEvent(new CustomEvent('command:format')),
  },
  {
    id: 'lsp.goToDefinition',
    label: 'Go to Definition',
    category: 'LSP',
    keybinding: 'F12',
    execute: () => window.dispatchEvent(new CustomEvent('command:go-to-definition')),
  },
  {
    id: 'lsp.findReferences',
    label: 'Find All References',
    category: 'LSP',
    keybinding: 'Shift+F12',
    execute: () => window.dispatchEvent(new CustomEvent('command:find-references')),
  },
  {
    id: 'lsp.rename',
    label: 'Rename Symbol',
    category: 'LSP',
    keybinding: 'F2',
    execute: () => window.dispatchEvent(new CustomEvent('command:rename')),
  },
]);

// Git (5)
commandRegistry.registerMany([
  {
    id: 'git.stageAll',
    label: 'Git: Stage All Changes',
    category: 'Git',
    execute: () => gitStageAll(),
  },
  {
    id: 'git.unstageAll',
    label: 'Git: Unstage All Changes',
    category: 'Git',
    execute: () => gitUnstageAll(),
  },
  {
    id: 'git.commit',
    label: 'Git: Commit',
    category: 'Git',
    execute: () => window.dispatchEvent(new CustomEvent('command:git-commit')),
  },
  {
    id: 'git.push',
    label: 'Git: Push',
    category: 'Git',
    execute: () => gitPush(),
  },
  {
    id: 'git.showChanges',
    label: 'Git: Show Changes',
    category: 'Git',
    execute: () => window.dispatchEvent(new CustomEvent('command:git-show-changes')),
  },
  {
    id: 'git.nextChangedFile',
    label: 'Go to Next Changed File',
    category: 'Git',
    keybinding: 'Alt+F5',
    execute: () => window.dispatchEvent(new CustomEvent('command:next-diff-file')),
  },
  {
    id: 'git.prevChangedFile',
    label: 'Go to Previous Changed File',
    category: 'Git',
    keybinding: 'Shift+Alt+F5',
    execute: () => window.dispatchEvent(new CustomEvent('command:prev-diff-file')),
  },
]);

// Terminal (4)
commandRegistry.registerMany([
  {
    id: 'terminal.newTerminal',
    label: 'New Terminal',
    category: 'Terminal',
    execute: () => terminalTabsStore.addTerminalTab(),
  },
  {
    id: 'terminal.nextTab',
    label: 'Next Terminal Tab',
    category: 'Terminal',
    execute: () => terminalTabsStore.nextTab(),
  },
  {
    id: 'terminal.prevTab',
    label: 'Previous Terminal Tab',
    category: 'Terminal',
    execute: () => terminalTabsStore.prevTab(),
  },
  {
    id: 'terminal.focus',
    label: 'Focus Terminal',
    category: 'Terminal',
    keybinding: 'Ctrl+T',
    execute: () => getActionHandler('switch-terminal')?.(),
  },
]);

// Chat (2)
commandRegistry.registerMany([
  {
    id: 'chat.newChat',
    label: 'New Chat',
    category: 'Chat',
    keybinding: 'Ctrl+N',
    execute: () => getActionHandler('new-chat')?.(),
  },
  {
    id: 'chat.focus',
    label: 'Focus Chat Panel',
    category: 'Chat',
    execute: () => {
      layoutStore.toggleChat();
    },
  },
]);

// Voice (3)
commandRegistry.registerMany([
  {
    id: 'voice.toggle',
    label: 'Toggle Voice Recording',
    category: 'Voice',
    keybinding: 'Ctrl+Shift+;',
    execute: () => getActionHandler('toggle-voice')?.(),
  },
  {
    id: 'voice.mute',
    label: 'Toggle Mute',
    category: 'Voice',
    keybinding: 'Ctrl+Shift+M',
    execute: () => getActionHandler('toggle-mute')?.(),
  },
  {
    id: 'voice.overlay',
    label: 'Toggle Overlay Mode',
    category: 'Voice',
    keybinding: 'Ctrl+Shift+O',
    execute: () => overlayStore.toggleOverlay(),
  },
]);

// System (3)
commandRegistry.registerMany([
  {
    id: 'system.screenshot',
    label: 'Take Screenshot',
    category: 'System',
    execute: () => captureMonitor(),
  },
  {
    id: 'system.detectGpu',
    label: 'Detect GPU',
    category: 'System',
    execute: () => detectGpu(),
  },
  {
    id: 'system.reloadWindow',
    label: 'Reload Window',
    category: 'System',
    execute: () => location.reload(),
  },
]);
