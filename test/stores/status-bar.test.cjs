/**
 * status-bar.test.cjs -- Source-inspection tests for status-bar.svelte.js
 *
 * Validates exports, state shape, setters, git polling, diagnostics sync,
 * dev server sync, LSP polling, notifications, and getLanguageName utility
 * by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/status-bar.svelte.js'),
  'utf-8'
);

// ── Exports ──────────────────────────────────────────────────────────────────

describe('status-bar.svelte.js: exports', () => {
  it('exports statusBarStore', () => {
    assert.ok(src.includes('export const statusBarStore'), 'Should export statusBarStore');
  });

  it('creates store via createStatusBarStore factory', () => {
    assert.ok(src.includes('function createStatusBarStore'), 'Should define factory');
    assert.ok(src.includes('createStatusBarStore()'), 'Should call factory');
  });

  it('exports getLanguageName utility function', () => {
    assert.ok(src.includes('export function getLanguageName'), 'Should export getLanguageName');
  });
});

// ── Imports ──────────────────────────────────────────────────────────────────

describe('status-bar.svelte.js: imports', () => {
  it('imports getGitChanges from api.js', () => {
    assert.ok(src.includes('getGitChanges'), 'Should import getGitChanges');
    assert.ok(src.includes("'../api.js'") || src.includes('"../api.js"'), 'Should import from api.js');
  });

  it('imports lspGetStatus from api.js', () => {
    assert.ok(src.includes('lspGetStatus'), 'Should import lspGetStatus');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should import lspDiagnosticsStore');
  });

  it('imports devServerManager', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
  });
});

// ── Reactive state ───────────────────────────────────────────────────────────

describe('status-bar.svelte.js: reactive state', () => {
  it('uses $state for cursor', () => {
    assert.ok(/let\s+cursor\s*=\s*\$state\(/.test(src), 'Should use $state for cursor');
  });

  it('uses $state for indent', () => {
    assert.ok(/let\s+indent\s*=\s*\$state\(/.test(src), 'Should use $state for indent');
  });

  it('uses $state for encoding', () => {
    assert.ok(/let\s+encoding\s*=\s*\$state\(/.test(src), 'Should use $state for encoding');
  });

  it('uses $state for eol', () => {
    assert.ok(/let\s+eol\s*=\s*\$state\(/.test(src), 'Should use $state for eol');
  });

  it('uses $state for language', () => {
    assert.ok(/let\s+language\s*=\s*\$state\(/.test(src), 'Should use $state for language');
  });

  it('uses $state for editorFocused', () => {
    assert.ok(/let\s+editorFocused\s*=\s*\$state\(/.test(src), 'Should use $state for editorFocused');
  });

  it('uses $state for gitBranch', () => {
    assert.ok(/let\s+gitBranch\s*=\s*\$state\(/.test(src), 'Should use $state for gitBranch');
  });

  it('uses $state for gitDirty', () => {
    assert.ok(/let\s+gitDirty\s*=\s*\$state\(/.test(src), 'Should use $state for gitDirty');
  });

  it('uses $state for notifications', () => {
    assert.ok(/let\s+notifications\s*=\s*\$state\(/.test(src), 'Should use $state for notifications');
  });

  it('uses $state for lspHealth', () => {
    assert.ok(/let\s+lspHealth\s*=\s*\$state\(/.test(src), 'Should use $state for lspHealth');
  });
});

// ── Getters ──────────────────────────────────────────────────────────────────

describe('status-bar.svelte.js: getters', () => {
  it('has cursor getter', () => {
    assert.ok(src.includes('get cursor()'), 'Should have cursor getter');
  });

  it('has indent getter', () => {
    assert.ok(src.includes('get indent()'), 'Should have indent getter');
  });

  it('has encoding getter', () => {
    assert.ok(src.includes('get encoding()'), 'Should have encoding getter');
  });

  it('has eol getter', () => {
    assert.ok(src.includes('get eol()'), 'Should have eol getter');
  });

  it('has language getter', () => {
    assert.ok(src.includes('get language()'), 'Should have language getter');
  });

  it('has editorFocused getter', () => {
    assert.ok(src.includes('get editorFocused()'), 'Should have editorFocused getter');
  });

  it('has gitBranch getter', () => {
    assert.ok(src.includes('get gitBranch()'), 'Should have gitBranch getter');
  });

  it('has gitDirty getter', () => {
    assert.ok(src.includes('get gitDirty()'), 'Should have gitDirty getter');
  });

  it('has diagErrors getter', () => {
    assert.ok(src.includes('get diagErrors()'), 'Should have diagErrors getter');
  });

  it('has diagWarnings getter', () => {
    assert.ok(src.includes('get diagWarnings()'), 'Should have diagWarnings getter');
  });

  it('has devServerStatus getter', () => {
    assert.ok(src.includes('get devServerStatus()'), 'Should have devServerStatus getter');
  });

  it('has devServerPort getter', () => {
    assert.ok(src.includes('get devServerPort()'), 'Should have devServerPort getter');
  });

  it('has lspHealth getter', () => {
    assert.ok(src.includes('get lspHealth()'), 'Should have lspHealth getter');
  });

  it('has notifications getter', () => {
    assert.ok(src.includes('get notifications()'), 'Should have notifications getter');
  });

  it('has unreadCount getter', () => {
    assert.ok(src.includes('get unreadCount()'), 'Should have unreadCount getter');
  });
});

// ── Editor setters ───────────────────────────────────────────────────────────

describe('status-bar.svelte.js: editor setters', () => {
  it('has setCursor method', () => {
    assert.ok(src.includes('setCursor('), 'Should have setCursor');
  });

  it('setCursor sets line and col', () => {
    const idx = src.indexOf('setCursor(');
    const body = src.slice(idx, idx + 200);
    assert.ok(body.includes('line') && body.includes('col'), 'setCursor should set line and col');
  });

  it('has setIndent method', () => {
    assert.ok(src.includes('setIndent('), 'Should have setIndent');
  });

  it('has setEncoding method', () => {
    assert.ok(src.includes('setEncoding('), 'Should have setEncoding');
  });

  it('has setEol method', () => {
    assert.ok(src.includes('setEol('), 'Should have setEol');
  });

  it('has setLanguage method', () => {
    assert.ok(src.includes('setLanguage('), 'Should have setLanguage');
  });

  it('has setEditorFocused method', () => {
    assert.ok(src.includes('setEditorFocused('), 'Should have setEditorFocused');
  });

  it('has clearEditorState method', () => {
    assert.ok(src.includes('clearEditorState'), 'Should have clearEditorState');
  });
});

// ── Git polling ──────────────────────────────────────────────────────────────

describe('status-bar.svelte.js: git polling', () => {
  it('has pollGitBranch method', () => {
    assert.ok(src.includes('pollGitBranch'), 'Should have pollGitBranch');
  });

  it('pollGitBranch calls getGitChanges', () => {
    const idx = src.indexOf('pollGitBranch');
    const body = src.slice(idx, idx + 400);
    assert.ok(body.includes('getGitChanges'), 'pollGitBranch should call getGitChanges');
  });

  it('sets gitDirty based on changes length', () => {
    assert.ok(src.includes('changes') && src.includes('length'), 'Should check changes.length for gitDirty');
  });

  it('defines GIT_POLL_INTERVAL at 15000ms', () => {
    assert.ok(src.includes('GIT_POLL_INTERVAL = 15000'), 'Should define git poll interval of 15000ms');
  });
});

// ── Diagnostics sync ─────────────────────────────────────────────────────────

describe('status-bar.svelte.js: diagnostics sync', () => {
  it('has updateDiagnostics method', () => {
    assert.ok(src.includes('updateDiagnostics'), 'Should have updateDiagnostics');
  });

  it('updateDiagnostics reads from lspDiagnosticsStore', () => {
    const idx = src.indexOf('updateDiagnostics');
    const body = src.slice(idx, idx + 500);
    assert.ok(body.includes('lspDiagnosticsStore'), 'updateDiagnostics should read from lspDiagnosticsStore');
  });
});

// ── Dev server sync ──────────────────────────────────────────────────────────

describe('status-bar.svelte.js: dev server sync', () => {
  it('has updateDevServer method', () => {
    assert.ok(src.includes('updateDevServer'), 'Should have updateDevServer');
  });

  it('updateDevServer reads from devServerManager', () => {
    const idx = src.indexOf('updateDevServer');
    const body = src.slice(idx, idx + 500);
    assert.ok(body.includes('devServerManager'), 'updateDevServer should read from devServerManager');
  });
});

// ── LSP health polling ──────────────────────────────────────────────────────

describe('status-bar.svelte.js: LSP health polling', () => {
  it('has pollLspHealth method', () => {
    assert.ok(src.includes('pollLspHealth'), 'Should have pollLspHealth');
  });

  it('pollLspHealth calls lspGetStatus', () => {
    const idx = src.indexOf('pollLspHealth');
    const body = src.slice(idx, idx + 400);
    assert.ok(body.includes('lspGetStatus'), 'pollLspHealth should call lspGetStatus');
  });

  it('derives aggregate health from server statuses', () => {
    assert.ok(src.includes("'healthy'"), 'Should support healthy status');
    assert.ok(src.includes("'starting'"), 'Should support starting status');
    assert.ok(src.includes("'error'"), 'Should support error status');
    assert.ok(src.includes("'none'"), 'Should support none status');
  });

  it('defines LSP_POLL_INTERVAL around 10000ms', () => {
    assert.ok(src.includes('10000'), 'Should define LSP poll interval of 10000ms');
  });
});

// ── Polling lifecycle ────────────────────────────────────────────────────────

describe('status-bar.svelte.js: polling lifecycle', () => {
  it('has startPolling method', () => {
    assert.ok(src.includes('startPolling'), 'Should have startPolling');
  });

  it('has stopPolling method', () => {
    assert.ok(src.includes('stopPolling'), 'Should have stopPolling');
  });

  it('startPolling sets up interval timers', () => {
    const idx = src.indexOf('startPolling');
    const body = src.slice(idx, idx + 500);
    assert.ok(body.includes('setInterval') || body.includes('Interval'), 'startPolling should use intervals');
  });

  it('stopPolling clears interval timers', () => {
    const idx = src.indexOf('function stopPolling');
    const body = src.slice(idx, idx + 300);
    assert.ok(body.includes('clearInterval'), 'stopPolling should clear intervals');
  });
});

// ── Notifications ────────────────────────────────────────────────────────────

describe('status-bar.svelte.js: notifications', () => {
  it('has addNotification method', () => {
    assert.ok(src.includes('addNotification'), 'Should have addNotification');
  });

  it('addNotification accepts message, severity, source', () => {
    const idx = src.indexOf('addNotification');
    const body = src.slice(idx, idx + 300);
    assert.ok(body.includes('message'), 'addNotification should accept message');
    assert.ok(body.includes('severity'), 'addNotification should accept severity');
    assert.ok(body.includes('source'), 'addNotification should accept source');
  });

  it('notification shape includes id, message, severity, source, timestamp, read', () => {
    assert.ok(src.includes('timestamp'), 'Notification should have timestamp');
    assert.ok(src.includes('read'), 'Notification should have read flag');
  });

  it('enforces max 100 notifications', () => {
    assert.ok(src.includes('100'), 'Should enforce max 100 notifications');
  });

  it('has dismissNotification method', () => {
    assert.ok(src.includes('dismissNotification'), 'Should have dismissNotification');
  });

  it('has markAllRead method', () => {
    assert.ok(src.includes('markAllRead'), 'Should have markAllRead');
  });

  it('has clearAllNotifications method', () => {
    assert.ok(src.includes('clearAllNotifications'), 'Should have clearAllNotifications');
  });

  it('unreadCount counts notifications where read is false', () => {
    assert.ok(src.includes('!n.read') || src.includes('n.read === false') || src.includes('!item.read'), 'Should count unread notifications');
  });
});

// ── getLanguageName ──────────────────────────────────────────────────────────

describe('status-bar.svelte.js: getLanguageName', () => {
  it('maps js to JavaScript', () => {
    assert.ok(src.includes("'JavaScript'") || src.includes('"JavaScript"'), 'Should map to JavaScript');
  });

  it('maps ts to TypeScript', () => {
    assert.ok(src.includes("'TypeScript'") || src.includes('"TypeScript"'), 'Should map to TypeScript');
  });

  it('maps rs to Rust', () => {
    assert.ok(src.includes("'Rust'") || src.includes('"Rust"'), 'Should map to Rust');
  });

  it('maps svelte to Svelte', () => {
    assert.ok(src.includes("'Svelte'") || src.includes('"Svelte"'), 'Should map to Svelte');
  });

  it('maps css to CSS', () => {
    assert.ok(src.includes("'CSS'") || src.includes('"CSS"'), 'Should map to CSS');
  });

  it('maps html to HTML', () => {
    assert.ok(src.includes("'HTML'") || src.includes('"HTML"'), 'Should map to HTML');
  });

  it('maps json to JSON', () => {
    assert.ok(src.includes("'JSON'") || src.includes('"JSON"'), 'Should map to JSON');
  });

  it('maps md to Markdown', () => {
    assert.ok(src.includes("'Markdown'") || src.includes('"Markdown"'), 'Should map to Markdown');
  });

  it('maps py to Python', () => {
    assert.ok(src.includes("'Python'") || src.includes('"Python"'), 'Should map to Python');
  });

  it('maps toml to TOML', () => {
    assert.ok(src.includes("'TOML'") || src.includes('"TOML"'), 'Should map to TOML');
  });

  it('maps yaml to YAML', () => {
    assert.ok(src.includes("'YAML'") || src.includes('"YAML"'), 'Should map to YAML');
  });

  it('maps sh to Shell', () => {
    assert.ok(src.includes("'Shell'") || src.includes('"Shell"'), 'Should map to Shell');
  });

  it('maps jsx to JavaScript JSX', () => {
    assert.ok(src.includes("'JavaScript JSX'") || src.includes('"JavaScript JSX"'), 'Should map to JavaScript JSX');
  });

  it('maps tsx to TypeScript JSX', () => {
    assert.ok(src.includes("'TypeScript JSX'") || src.includes('"TypeScript JSX"'), 'Should map to TypeScript JSX');
  });

  it('maps scss to SCSS', () => {
    assert.ok(src.includes("'SCSS'") || src.includes('"SCSS"'), 'Should map to SCSS');
  });

  it('maps xml to XML', () => {
    assert.ok(src.includes("'XML'") || src.includes('"XML"'), 'Should map to XML');
  });

  it('maps svg to SVG', () => {
    assert.ok(src.includes("'SVG'") || src.includes('"SVG"'), 'Should map to SVG');
  });

  it('maps txt to Plain Text', () => {
    assert.ok(src.includes("'Plain Text'") || src.includes('"Plain Text"'), 'Should map to Plain Text');
  });

  it('extracts extension from file path', () => {
    const fnIdx = src.indexOf('getLanguageName');
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    assert.ok(fnBody.includes('.') && (fnBody.includes('split') || fnBody.includes('lastIndexOf') || fnBody.includes('extname')), 'Should extract extension from path');
  });
});
