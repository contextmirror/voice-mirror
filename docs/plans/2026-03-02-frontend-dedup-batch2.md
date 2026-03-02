# Frontend Deduplication Batch 2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 6 remaining frontend duplication patterns into shared utilities/components.

**Architecture:** Same approach as batch 1 — extract shared code, find-and-replace call sites. Each task is independent.

**Tech Stack:** Svelte 5, ES modules, node:test

**Branch:** `refactor/code-audit-2` (from `feature/lens` HEAD)

---

### Task 1: Consolidate PROVIDER_NAMES + CLI_PROVIDERS (correctness fix)

**Files:**
- Modify: `src/lib/providers.js` — expand exports
- Modify: `src/lib/stores/ai-status.svelte.js` — import instead of private copies
- Test: `test/stores/ai-status.test.cjs` — update source-inspection tests

**Problem:** `providers.js` has 6 provider names and 2 CLI providers. `ai-status.svelte.js` has a private superset: 11 names and 5 CLI providers. Adding a new CLI provider requires updating both files.

**Step 1:** Expand `src/lib/providers.js` PROVIDER_NAMES to include all 11 providers:
```js
export const PROVIDER_NAMES = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'OpenAI Codex',
  'gemini-cli': 'Gemini CLI',
  'kimi-cli': 'Kimi CLI',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  jan: 'Jan',
  openai: 'OpenAI',
  groq: 'Groq',
  dictation: 'Dictation Only',
};
```

**Step 2:** Expand CLI_PROVIDERS:
```js
export const CLI_PROVIDERS = ['claude', 'opencode', 'codex', 'gemini-cli', 'kimi-cli'];
```

**Step 3:** In `ai-status.svelte.js`, delete the private `PROVIDER_NAMES` and `CLI_PROVIDERS` constants. Add import:
```js
import { PROVIDER_NAMES, CLI_PROVIDERS } from '$lib/providers.js';
```

**Step 4:** Run `npm test`, fix any source-inspection tests that check for the old inline definitions.

**Step 5:** Commit: `refactor: consolidate PROVIDER_NAMES and CLI_PROVIDERS to single source`

---

### Task 2: Extract LSP severity helpers (7+ sites)

**Files:**
- Create: `src/lib/lsp-severity.js`
- Create: `test/lib/lsp-severity.test.cjs`
- Modify: `src/lib/stores/lsp-diagnostics.svelte.js` (2 sites)
- Modify: `src/components/lens/ProblemsPanel.svelte` (4 sites)
- Modify: `src/components/terminal/TerminalTabs.svelte` (1 site)

**Implementation — create `src/lib/lsp-severity.js`:**
```js
/**
 * Classify an LSP diagnostic severity into a category name.
 * @param {number|string} sev
 * @returns {'error'|'warning'|'info'}
 */
export function severityName(sev) {
  if (sev === 1 || sev === 'error') return 'error';
  if (sev === 2 || sev === 'warning') return 'warning';
  return 'info';
}

/**
 * Convert an LSP diagnostic severity to a numeric sort key (1=error, 2=warning, 3=info).
 * @param {number|string} sev
 * @returns {number}
 */
export function severityNum(sev) {
  if (sev === 1 || sev === 'error') return 1;
  if (sev === 2 || sev === 'warning') return 2;
  return 3;
}

/**
 * Human-readable label for a severity.
 * @param {number|string} sev
 * @returns {string}
 */
export function severityLabel(sev) {
  if (sev === 1 || sev === 'error') return 'Error';
  if (sev === 2 || sev === 'warning') return 'Warning';
  return 'Info';
}
```

**Replacements:**
- `lsp-diagnostics.svelte.js` handleDiagnosticsEvent: use `severityName(sev) === 'error'` / `=== 'warning'`
- `lsp-diagnostics.svelte.js` getTotals: use `severityName(sev)` switch
- `ProblemsPanel.svelte` filter: use `severityName(sev)` for isError/isWarning/isInfo
- `ProblemsPanel.svelte` sort: use `severityNum(sev)` for comparator
- `ProblemsPanel.svelte` severityIcon/severityLabel: replace with imports
- `TerminalTabs.svelte` formatSeverity: replace with `severityLabel(sev)`

**Step:** Write tests, implement, replace, run `npm test`, commit.

---

### Task 3: Extract formatLogTime() and formatRelativeTime() (3 sites)

**Files:**
- Modify: `src/lib/utils.js` — add two exports
- Modify: `test/unit/utils.test.mjs` — add tests
- Modify: `src/components/lens/OutputPanel.svelte` — import formatLogTime
- Modify: `src/components/terminal/TerminalTabs.svelte` — import formatLogTime
- Modify: `src/components/shared/StatusBar.svelte` — import formatRelativeTime

**Implementation — add to `src/lib/utils.js`:**
```js
/** Format timestamp as HH:MM:SS for log output. */
export function formatLogTime(ts) {
  return new Date(ts).toTimeString().slice(0, 8);
}

/** Format timestamp as relative time (just now, Xm ago, Xh ago, Xd ago). */
export function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
```

**Replacements:**
- `OutputPanel.svelte:41-44` — delete local `formatTime`, import `formatLogTime`
- `TerminalTabs.svelte:229` — inline `d.toTimeString().slice(0, 8)` → `formatLogTime(d.getTime())`
- `StatusBar.svelte:89-95` — delete local `formatTime`, import `formatRelativeTime`

Note: The existing `formatTime` in `utils.js` (locale time) stays as-is — it's used by MessageGroup.

---

### Task 4: Extract getTabIcon() (2 sites)

**Files:**
- Create: `src/lib/tab-utils.js`
- Create: `test/lib/tab-utils.test.cjs`
- Modify: `src/components/lens/TabBar.svelte` — import
- Modify: `src/components/lens/GroupTabBar.svelte` — import

**Implementation — create `src/lib/tab-utils.js`:**
```js
/**
 * Get an icon category for a tab based on its type and file extension.
 * @param {{ type?: string, title?: string }} tab
 * @returns {string}
 */
export function getTabIcon(tab) {
  if (tab.type === 'diff') return 'diff';
  const ext = tab.title?.split('.').pop()?.toLowerCase() || '';
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) return 'code';
  if (['rs'].includes(ext)) return 'code';
  if (['css', 'scss', 'less'].includes(ext)) return 'palette';
  if (['html', 'svelte', 'vue'].includes(ext)) return 'code';
  if (['json', 'toml', 'yaml', 'yml'].includes(ext)) return 'settings';
  if (['md', 'txt', 'log'].includes(ext)) return 'doc';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  return 'file';
}
```

**Replacements:** Delete local `getTabIcon` from both TabBar.svelte and GroupTabBar.svelte, import shared version.

---

### Task 5: Extract copyFullPath() and copyRelativePath() (3 sites)

**Files:**
- Modify: `src/lib/utils.js` — add two exports
- Modify: `test/unit/utils.test.mjs` — add tests
- Modify: `src/components/lens/FileContextMenu.svelte`
- Modify: `src/components/lens/EditorContextMenu.svelte`
- Modify: `src/components/lens/TabContextMenu.svelte`

**Implementation — add to `src/lib/utils.js`:**
```js
/**
 * Copy the full OS path (with backslashes on Windows) to clipboard.
 * @param {string} relativePath
 * @param {string} [root]
 */
export function copyFullPath(relativePath, root) {
  const full = root ? `${root}/${relativePath}` : relativePath;
  navigator.clipboard.writeText(full.replace(/\//g, '\\'));
}

/**
 * Copy the relative path to clipboard.
 * @param {string} relativePath
 */
export function copyRelativePath(relativePath) {
  navigator.clipboard.writeText(relativePath);
}
```

**Replacements:** In each of the 3 context menus, replace `handleCopyPath`/`handleCopyRelativePath` with calls to the shared functions. Each menu still needs `close()` before the copy call — that stays inline.

---

### Task 6: Extract TabDiffBadge.svelte (2 sites)

**Files:**
- Create: `src/components/lens/TabDiffBadge.svelte`
- Create: `test/components/tab-diff-badge.test.cjs`
- Modify: `src/components/lens/TabBar.svelte` — import component, delete duplicate CSS
- Modify: `src/components/lens/GroupTabBar.svelte` — import component, delete duplicate CSS

**Implementation — create `src/components/lens/TabDiffBadge.svelte`:**
```svelte
<script>
  let { tab } = $props();
</script>

{#if tab.type === 'diff' && tab.diffStats}
  <span class="tab-diff-stats">
    <span class="tab-diff-stats-add">+{tab.diffStats.additions}</span>
    <span class="tab-diff-stats-del">-{tab.diffStats.deletions}</span>
  </span>
{:else if tab.type === 'diff' && tab.status}
  <span
    class="tab-diff-badge"
    class:added={tab.status === 'added'}
    class:modified={tab.status === 'modified'}
    class:deleted={tab.status === 'deleted'}
  >{tab.status === 'added' ? 'A' : tab.status === 'deleted' ? 'D' : 'M'}</span>
{/if}

<style>
.tab-diff-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 9px;
  font-weight: 700;
  border-radius: 2px;
  flex-shrink: 0;
  color: var(--bg);
}
.tab-diff-badge.added { background: var(--ok); }
.tab-diff-badge.modified { background: var(--accent); }
.tab-diff-badge.deleted { background: var(--danger); }

.tab-diff-stats {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-mono);
  flex-shrink: 0;
}
.tab-diff-stats-add { color: var(--ok); }
.tab-diff-stats-del { color: var(--danger); }
</style>
```

**Replacements:** In both TabBar and GroupTabBar, replace the inline diff badge markup with `<TabDiffBadge {tab} />` and delete the duplicate CSS blocks.
