/**
 * output.svelte.js -- Reactive store for Output panel log channels.
 *
 * Listens to `output-log` Tauri events and maintains per-channel arrays.
 * Tracks active channel, level filter, and auto-scroll state.
 */

import { listen } from '@tauri-apps/api/event';
import { getOutputLogs } from '../api.js';

const MAX_ENTRIES = 2000;
const CHANNELS = ['app', 'cli', 'voice', 'mcp', 'browser'];
const CHANNEL_LABELS = {
  app: 'Voice Mirror',
  cli: 'CLI Provider',
  voice: 'Voice Pipeline',
  mcp: 'MCP Server',
  browser: 'Browser Bridge',
};

let entries = $state({
  app: [],
  cli: [],
  voice: [],
  mcp: [],
  browser: [],
});

let activeChannel = $state('app');
let levelFilter = $state('trace'); // show all levels (MCP can still filter)
let autoScroll = $state(true);
let filterText = $state('');
let wordWrap = $state(true);
let listening = false;

/** Level priority for filtering */
function levelPriority(level) {
  const map = { ERROR: 5, WARN: 4, INFO: 3, DEBUG: 2, TRACE: 1 };
  return map[level?.toUpperCase()] || 0;
}

/** Get filtered entries for the active channel */
function getFilteredEntries() {
  const channelEntries = entries[activeChannel] || [];
  const minPriority = levelPriority(levelFilter);
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
  for (const ch of CHANNELS) {
    try {
      const result = await getOutputLogs({ channel: ch, last: MAX_ENTRIES });
      if (result?.entries) {
        entries[ch] = result.entries;
      }
    } catch {
      // Backend may not be ready yet — that's fine
    }
  }

  // Subscribe to live events
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
}

/** Switch active channel */
function switchChannel(ch) {
  if (CHANNELS.includes(ch)) {
    activeChannel = ch;
  }
}

/** Set minimum log level filter */
function setLevelFilter(level) {
  levelFilter = level;
}

/** Clear the display for the active channel (frontend only) */
function clearChannel() {
  entries[activeChannel] = [];
}

/** Toggle auto-scroll */
function setAutoScroll(value) {
  autoScroll = value;
}

export const outputStore = {
  get entries() { return entries; },
  get activeChannel() { return activeChannel; },
  get levelFilter() { return levelFilter; },
  get autoScroll() { return autoScroll; },
  get filterText() { return filterText; },
  get wordWrap() { return wordWrap; },
  get filteredEntries() { return getFilteredEntries(); },
  get channels() { return CHANNELS; },
  get channelLabels() { return CHANNEL_LABELS; },
  switchChannel,
  setLevelFilter,
  clearChannel,
  setAutoScroll,
  setFilterText,
  toggleWordWrap,
  startListening,
};
