/**
 * lsp-diagnostics.svelte.js -- Svelte 5 reactive store for LSP diagnostic aggregation.
 *
 * Listens to `lsp-diagnostics` Tauri events, maintains a Map of per-file error/warning
 * counts, and provides getForFile() / getForDirectory() methods for the FileTree to
 * render diagnostic decorations (red/yellow filenames + count badges).
 */

import { listen } from '@tauri-apps/api/event';
import { uriToRelativePath as _uriToRelativePath } from '../editor-lsp.svelte.js';

/** Convert a file:// URI to a project-relative path (string or null).
 *  Wraps the shared uriToRelativePath which returns { path, external }. */
function uriToRelativePath(uri, root) {
  if (!uri || !root) return null;
  const result = _uriToRelativePath(uri, root);
  if (!result || result.external) return null;
  return result.path;
}

function createLspDiagnosticsStore() {
  /** Map<relativePath, { errors: number, warnings: number }> */
  let diagnostics = $state(new Map());
  /** Map<relativePath, Array<{range, severity, message, source, code}>> — raw LSP diagnostics */
  let rawDiagnostics = $state(new Map());
  let unlisten = null;

  function handleDiagnosticsEvent(event, projectRoot) {
    const { uri, diagnostics: lspDiags } = event.payload;
    const relativePath = uriToRelativePath(uri, projectRoot);
    if (relativePath === null) return;

    let errors = 0;
    let warnings = 0;
    for (const d of lspDiags) {
      const sev = d.severity;
      if (sev === 'error' || sev === 1) {
        errors++;
      } else if (sev === 'warning' || sev === 2) {
        warnings++;
      }
    }

    const updated = new Map(diagnostics);
    const updatedRaw = new Map(rawDiagnostics);
    if (errors === 0 && warnings === 0) {
      updated.delete(relativePath);
      // Keep empty arrays in rawDiagnostics rather than deleting — prevents
      // ProblemsPanel file groups from disappearing/reappearing when the LSP
      // server briefly clears diagnostics during re-analysis (visual jump).
      // fileGroups filters out files with 0 matching diagnostics anyway.
      if (rawDiagnostics.has(relativePath)) {
        updatedRaw.set(relativePath, []);
      }
    } else {
      updated.set(relativePath, { errors, warnings });
      updatedRaw.set(relativePath, lspDiags);
    }
    diagnostics = updated;
    rawDiagnostics = updatedRaw;
  }

  return {
    /** Get the summary diagnostics Map */
    get diagnostics() { return diagnostics; },

    /** Get the raw diagnostics Map (full LSP diagnostic objects per file) */
    get rawDiagnostics() { return rawDiagnostics; },

    /** Get error/warning counts for a specific file path */
    getForFile(filePath) {
      return diagnostics.get(filePath) || null;
    },

    /** Aggregate error/warning counts for all files under a directory (prefix match) */
    getForDirectory(dirPath) {
      const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
      let errors = 0;
      let warnings = 0;
      for (const [path, counts] of diagnostics) {
        if (path.startsWith(prefix)) {
          errors += counts.errors;
          warnings += counts.warnings;
        }
      }
      if (errors === 0 && warnings === 0) return null;
      return { errors, warnings };
    },

    /** Get raw LSP diagnostics array for a specific file path */
    getRawForFile(filePath) {
      return rawDiagnostics.get(filePath) || null;
    },

    /** Get aggregate counts across all files */
    getTotals() {
      let errors = 0;
      let warnings = 0;
      let infos = 0;
      for (const [, diags] of rawDiagnostics) {
        for (const d of diags) {
          const sev = d.severity;
          if (sev === 'error' || sev === 1) errors++;
          else if (sev === 'warning' || sev === 2) warnings++;
          else if (sev === 'information' || sev === 3) infos++;
        }
      }
      return { errors, warnings, infos };
    },

    /** Clear all diagnostics (e.g. on project switch) */
    clear() {
      diagnostics = new Map();
      rawDiagnostics = new Map();
    },

    /** Start listening for lsp-diagnostics events */
    async startListening(projectRoot) {
      this.stopListening();
      unlisten = await listen('lsp-diagnostics', (event) => {
        handleDiagnosticsEvent(event, projectRoot);
      });
    },

    /** Stop listening and clean up */
    stopListening() {
      unlisten?.();
      unlisten = null;
    },
  };
}

export const lspDiagnosticsStore = createLspDiagnosticsStore();
