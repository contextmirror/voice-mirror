/**
 * lsp-severity.js -- LSP diagnostic severity classification helpers.
 *
 * Centralizes the numeric/string severity checks that were previously
 * duplicated across lsp-diagnostics store, ProblemsPanel, and TerminalTabs.
 */

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
