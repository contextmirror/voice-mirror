/**
 * providers.js -- Shared provider metadata (icons, names, groups).
 *
 * Single source of truth for AI provider display info used by
 * AISettings, Sidebar, and any other component that needs provider metadata.
 */

// ---- Provider icon imports (Vite resolves these) ----
import claudeIcon from '../assets/icons/providers/claude.webp';
import ollamaIcon from '../assets/icons/providers/ollama.svg';
import lmstudioIcon from '../assets/icons/providers/lmstudio.svg';
import janIcon from '../assets/icons/providers/jan.svg';
import opencodeIcon from '../assets/icons/providers/opencode.svg';
import dictationIcon from '../assets/icons/providers/dictation.svg';

// ---- Provider display names ----

export const PROVIDER_NAMES = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  jan: 'Jan',
  dictation: 'Dictation Only',
};

// ---- Provider icon metadata ----

export const PROVIDER_ICONS = {
  claude: { type: 'cover', src: claudeIcon },
  opencode: { type: 'inner', src: opencodeIcon, bg: 'linear-gradient(135deg, #1a1717, #131010)' },
  ollama: { type: 'inner', src: ollamaIcon, bg: 'linear-gradient(135deg, #f0f0f0, #d0d0d0)' },
  lmstudio: { type: 'inner', src: lmstudioIcon, bg: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
  jan: { type: 'inner', src: janIcon, bg: 'linear-gradient(135deg, #a855f7, #7c3aed)' },
  dictation: { type: 'inner', src: dictationIcon, bg: 'linear-gradient(135deg, #10b981, #059669)' },
};

// ---- Provider classification ----

export const CLI_PROVIDERS = ['claude', 'opencode'];
export const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'jan'];
export const MCP_PROVIDERS = ['claude', 'opencode'];
const DICTATION_PROVIDERS = ['dictation'];

// ---- Default endpoints for local providers ----

export const DEFAULT_ENDPOINTS = {
  ollama: 'http://127.0.0.1:11434',
  lmstudio: 'http://127.0.0.1:1234',
  jan: 'http://127.0.0.1:1337',
};

// ---- Grouped provider options (for dropdown selectors) ----

export const PROVIDER_GROUPS = [
  {
    label: 'CLI Agents',
    badge: 'Terminal Access',
    providers: [
      { value: 'claude', label: 'Claude Code' },
      { value: 'opencode', label: 'OpenCode' },
    ],
  },
  {
    label: 'Local LLM Servers',
    badge: null,
    providers: [
      { value: 'ollama', label: 'Ollama' },
      { value: 'lmstudio', label: 'LM Studio' },
      { value: 'jan', label: 'Jan' },
    ],
  },
  {
    label: 'Voice Input',
    badge: 'No AI',
    providers: [
      { value: 'dictation', label: 'Dictation Only' },
    ],
  },
];

// ---- Helper functions ----

/** Get the icon metadata for a provider ID, or null if not found. */
function getProviderIcon(id) {
  return PROVIDER_ICONS[id] || null;
}

/** Get the display name for a provider ID, falling back to the raw ID. */
function getProviderName(id) {
  return PROVIDER_NAMES[id] || id;
}
