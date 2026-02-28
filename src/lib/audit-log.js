/**
 * audit-log.js -- Interaction audit logger.
 *
 * Captures key user interactions (file opens, tab switches, LSP requests,
 * terminal actions) with timestamps. Logs at DEBUG level with [AUDIT] prefix
 * to the Frontend output channel. Claude Code can read the JSONL timeline
 * to understand what happened before a bug appeared.
 *
 * Usage:
 *   import { audit, auditEditor, auditTerminal, auditLsp, auditNav } from './audit-log.js';
 *   auditEditor('file-opened', { path: 'src/main.js' });
 *   auditTerminal('shell-created', { shellId: 'abc', profile: 'bash' });
 *   auditLsp('completion-requested', { file: 'foo.ts', line: 42 });
 *   auditNav('tab-switched', { from: 'lens', to: 'chat' });
 */

import { logFrontendError } from './api.js';

/**
 * Log an audit event. Safe to call anywhere — never throws.
 *
 * @param {string} category - Subsystem category (e.g. 'editor', 'terminal', 'lsp', 'nav')
 * @param {string} action - What happened (e.g. 'file-opened', 'shell-exited')
 * @param {Object} [details] - Optional structured details
 */
export function audit(category, action, details) {
  try {
    const message = `[AUDIT] [${category}] ${action}`;
    const context = details ? JSON.stringify(details) : '';
    logFrontendError({ level: 'DEBUG', message, context });
  } catch {
    // Audit logging must never crash the app
  }
}

/** Audit an editor interaction */
export function auditEditor(action, details) {
  audit('editor', action, details);
}

/** Audit a terminal interaction */
export function auditTerminal(action, details) {
  audit('terminal', action, details);
}

/** Audit an LSP interaction */
export function auditLsp(action, details) {
  audit('lsp', action, details);
}

/** Audit a navigation interaction */
export function auditNav(action, details) {
  audit('nav', action, details);
}
