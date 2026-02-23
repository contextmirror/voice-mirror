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
    if (errors === 0 && warnings === 0) {
      updated.delete(relativePath);
    } else {
      updated.set(relativePath, { errors, warnings });
    }
    diagnostics = updated;
  }

  return {
    /** Get the raw diagnostics Map */
    get diagnostics() { return diagnostics; },

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

    /** Clear all diagnostics (e.g. on project switch) */
    clear() {
      diagnostics = new Map();
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
