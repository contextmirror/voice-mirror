/**
 * output.svelte.js -- Reactive store for Output panel log channels.
 *
 * Listens to `output-log` Tauri events and maintains per-channel arrays.
 * Tracks active channel, level filter, and auto-scroll state.
 *
 * Supports both fixed system channels (app, cli, voice, mcp, browser, frontend,
 * preview) and dynamic project channels (registered at runtime by dev server
 * manager).
 */

import { listen } from '@tauri-apps/api/event';
import { getOutputLogs, registerProjectChannel as apiRegister, unregisterProjectChannel as apiUnregister } from '../api.js';

const MAX_ENTRIES = 2000;
const SYSTEM_CHANNELS = ['app', 'cli', 'voice', 'mcp', 'browser', 'frontend', 'preview'];
const CHANNEL_LABELS = {
  app: 'Voice Mirror',
  cli: 'CLI Provider',
  voice: 'Voice Pipeline',
  mcp: 'MCP Server',
  browser: 'Browser Bridge',
  frontend: 'Frontend Errors',
  preview: 'App Preview',
};

let entries = $state({
  app: [],
  cli: [],
  voice: [],
  mcp: [],
  browser: [],
  frontend: [],
  preview: [],
});

/** Dynamic project channel entries: label -> LogEntry[] */
let projectChannelEntries = $state({});

/** Dynamic project channel metadata: { label, projectPath, framework, port }[] */
let projectChannelList = $state([]);

let activeChannel = $state('app');
/**
 * Per-channel minimum level filter (VS Code stores log level per channel).
 * channel label -> level string (ERROR/WARN/INFO/DEBUG/TRACE, case-insensitive).
 * Missing entry means 'trace' (show all).
 */
let levelFilterByChannel = $state({});
let autoScroll = $state(true);
let filterText = $state('');
let wordWrap = $state(true);
let listening = false;

/** Level priority for filtering */
function levelPriority(level) {
  const map = { ERROR: 5, WARN: 4, INFO: 3, DEBUG: 2, TRACE: 1 };
  return map[level?.toUpperCase()] || 0;
}

/** Get the minimum level filter for a channel (defaults to 'trace' = show all) */
function getLevelFilter(channel) {
  return levelFilterByChannel[channel] || 'trace';
}

/** Get filtered entries for the active channel */
function getFilteredEntries() {
  const channelEntries = entries[activeChannel] || projectChannelEntries[activeChannel] || [];
  const minPriority = levelPriority(getLevelFilter(activeChannel));
  let filtered = channelEntries.filter(e => levelPriority(e.level) >= minPriority);

  // Apply text filter (supports !exclude and comma-separated patterns)
  if (filterText.trim()) {
    const patterns = filterText.split(',').map(p => p.trim()).filter(Boolean);
    const includes = patterns.filter(p => !p.startsWith('!'));
    const excludes = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1).toLowerCase());

    filtered = filtered.filter(e => {
      const msg = e.message.toLowerCase();
      // Exclude matches
      if (excludes.some(ex => msg.includes(ex))) return false;
      // Include matches (if any specified, at least one must match)
      if (includes.length > 0) {
        return includes.some(inc => msg.includes(inc.toLowerCase()));
      }
      return true;
    });
  }

  return filtered;
}

/** Set filter text */
function setFilterText(text) {
  filterText = text;
}

/** Toggle word wrap */
function toggleWordWrap() {
  wordWrap = !wordWrap;
}

/** Start listening for output-log events */
async function startListening() {
  if (listening) return;
  listening = true;

  // Load initial entries from backend
  for (const ch of SYSTEM_CHANNELS) {
    try {
      const result = await getOutputLogs({ channel: ch, last: MAX_ENTRIES });
      if (result?.entries) {
        entries[ch] = result.entries;
      }
    } catch {
      // Backend may not be ready yet — that's fine
    }
  }

  // Subscribe to live system channel events
  await listen('output-log', (event) => {
    const entry = event.payload;
    if (!entry?.channel || !entries[entry.channel]) return;

    const arr = entries[entry.channel];
    arr.push(entry);
    // Reassign to guarantee Svelte 5 reactivity triggers.
    // When over cap, slice also handles reassignment.
    if (arr.length > MAX_ENTRIES) {
      entries[entry.channel] = arr.slice(arr.length - MAX_ENTRIES);
    } else {
      entries[entry.channel] = arr;
    }
  });

  // Listen for browser console messages from Lens preview
  await listen('lens-console-message', (event) => {
    const { level, message } = event.payload;
    if (!level || !message) return;

    // Normalize so console.warn/console.error reliably map to WARN/ERROR and are
    // honored by the per-channel level filter (levelPriority is case-insensitive,
    // but store the canonical uppercase level for consistency + counts).
    const normLevel = String(level).toUpperCase();

    // Route to the active project channel (first one, or based on current project)
    const activeProject = projectChannelList[0]; // TODO: route based on URL/port
    if (activeProject) {
      const entry = {
        id: Date.now() + Math.random(),
        timestamp: Date.now(),
        level: normLevel,
        channel: 'app',
        message: `[console${normLevel !== 'INFO' ? ':' + normLevel.toLowerCase() : ''}] ${message}`,
      };

      if (!projectChannelEntries[activeProject.label]) {
        projectChannelEntries[activeProject.label] = [];
      }
      const arr = projectChannelEntries[activeProject.label];
      arr.push(entry);
      if (arr.length > MAX_ENTRIES) {
        projectChannelEntries[activeProject.label] = arr.slice(arr.length - MAX_ENTRIES);
      } else {
        projectChannelEntries[activeProject.label] = [...arr];
      }
    }
  });

  // Listen for project-output-log events (terminal mirroring from Rust)
  await listen('project-output-log', (event) => {
    const { channel, entry } = event.payload;
    if (!channel || !entry) return;

    if (!projectChannelEntries[channel]) {
      projectChannelEntries[channel] = [];
    }
    const arr = projectChannelEntries[channel];
    arr.push(entry);
    if (arr.length > MAX_ENTRIES) {
      projectChannelEntries[channel] = arr.slice(arr.length - MAX_ENTRIES);
    } else {
      projectChannelEntries[channel] = [...arr];
    }
  });
}

/** Switch active channel (system or project) */
function switchChannel(ch) {
  if (SYSTEM_CHANNELS.includes(ch) || projectChannelEntries[ch] !== undefined) {
    activeChannel = ch;
  }
}

/** Set minimum log level filter for a specific channel (VS Code stores this per channel) */
function setLevelFilter(channel, level) {
  levelFilterByChannel = { ...levelFilterByChannel, [channel]: level };
}

/**
 * Count entries by level for a channel: { error, warn, info, debug, trace }.
 * Used to show per-level badges in the level picker.
 */
function countsByLevel(channel) {
  const channelEntries = entries[channel] || projectChannelEntries[channel] || [];
  const counts = { error: 0, warn: 0, info: 0, debug: 0, trace: 0 };
  for (const e of channelEntries) {
    const key = e.level?.toLowerCase();
    if (key && counts[key] !== undefined) counts[key]++;
  }
  return counts;
}

/** Clear the display for the active channel (frontend only) */
function clearChannel() {
  if (entries[activeChannel]) {
    entries[activeChannel] = [];
  } else if (projectChannelEntries[activeChannel]) {
    projectChannelEntries[activeChannel] = [];
  }
}

/** Toggle auto-scroll */
function setAutoScroll(value) {
  autoScroll = value;
}

/** Register a dynamic project channel */
async function registerProjectChannel(label, projectPath, framework, port) {
  await apiRegister(label, projectPath, framework, port);
  if (!projectChannelEntries[label]) {
    projectChannelEntries[label] = [];
  }
  projectChannelList = [...projectChannelList, { label, projectPath, framework, port }];
}

/** Unregister a dynamic project channel */
async function unregisterProjectChannel(label) {
  await apiUnregister(label);
  delete projectChannelEntries[label];
  projectChannelList = projectChannelList.filter(c => c.label !== label);
  // If we were viewing this channel, switch to a system channel
  if (activeChannel === label) {
    activeChannel = 'app';
  }
}

export const outputStore = {
  get entries() { return entries; },
  get activeChannel() { return activeChannel; },
  /** Minimum level filter for the currently-active channel (per-channel model). */
  get levelFilter() { return getLevelFilter(activeChannel); },
  get autoScroll() { return autoScroll; },
  get filterText() { return filterText; },
  get wordWrap() { return wordWrap; },
  get filteredEntries() { return getFilteredEntries(); },
  get channels() { return SYSTEM_CHANNELS; },
  get channelLabels() { return CHANNEL_LABELS; },
  get projectChannels() { return projectChannelList; },
  get projectEntries() { return projectChannelEntries; },
  get hasProjectErrors() {
    for (const entries of Object.values(projectChannelEntries)) {
      if (entries.some(e => e.level === 'ERROR')) return true;
    }
    return false;
  },
  switchChannel,
  setLevelFilter,
  getLevelFilter,
  countsByLevel,
  clearChannel,
  setAutoScroll,
  setFilterText,
  toggleWordWrap,
  startListening,
  registerProjectChannel,
  unregisterProjectChannel,
};
