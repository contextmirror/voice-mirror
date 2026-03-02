/**
 * search.svelte.js -- Svelte 5 reactive store for global text search.
 *
 * Manages search state (query, options, results) and invokes the
 * Rust search_content command via the API layer.
 */

import { searchContent } from '../api.js';
import { projectStore } from './project.svelte.js';

function createSearchStore() {
  let query = $state('');
  let caseSensitive = $state(false);
  let isRegex = $state(false);
  let wholeWord = $state(false);
  let includePattern = $state('');
  let excludePattern = $state('');

  let results = $state([]);
  let totalMatches = $state(0);
  let truncated = $state(false);
  let loading = $state(false);
  let error = $state(null);

  let collapsedFiles = $state(new Set());

  // Monotonic counter to discard stale async responses
  let searchId = 0;

  return {
    get query() { return query; },
    get caseSensitive() { return caseSensitive; },
    get isRegex() { return isRegex; },
    get wholeWord() { return wholeWord; },
    get includePattern() { return includePattern; },
    get excludePattern() { return excludePattern; },
    get results() { return results; },
    get totalMatches() { return totalMatches; },
    get truncated() { return truncated; },
    get loading() { return loading; },
    get error() { return error; },
    get collapsedFiles() { return collapsedFiles; },

    setQuery(v) { query = v; },
    setCaseSensitive(v) { caseSensitive = v; },
    setIsRegex(v) { isRegex = v; },
    setWholeWord(v) { wholeWord = v; },
    setIncludePattern(v) { includePattern = v; },
    setExcludePattern(v) { excludePattern = v; },

    async search() {
      if (!query.trim()) {
        this.clear();
        return;
      }

      const id = ++searchId;
      loading = true;
      error = null;

      try {
        const root = projectStore.root;
        const resp = await searchContent(query, {
          root,
          caseSensitive: caseSensitive || null,
          isRegex: isRegex || null,
          wholeWord: wholeWord || null,
          includePattern: includePattern || null,
          excludePattern: excludePattern || null,
        });

        // Discard if a newer search has been launched
        if (id !== searchId) return;

        if (resp && resp.success !== false && resp.data) {
          results = resp.data.matches || [];
          totalMatches = resp.data.totalMatches || 0;
          truncated = resp.data.truncated || false;
          error = null;
        } else {
          results = [];
          totalMatches = 0;
          truncated = false;
          error = resp?.error || 'Search failed';
        }
      } catch (err) {
        if (id !== searchId) return;
        results = [];
        totalMatches = 0;
        truncated = false;
        error = String(err);
      } finally {
        if (id === searchId) {
          loading = false;
        }
      }
    },

    clear() {
      query = '';
      results = [];
      totalMatches = 0;
      truncated = false;
      loading = false;
      error = null;
      collapsedFiles = new Set();
    },

    toggleFileCollapsed(path) {
      const next = new Set(collapsedFiles);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      collapsedFiles = next;
    },
  };
}

export const searchStore = createSearchStore();
