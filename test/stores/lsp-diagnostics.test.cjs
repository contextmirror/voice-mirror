/**
 * lsp-diagnostics.test.cjs -- Source-inspection tests for lsp-diagnostics.svelte.js
 *
 * Validates exports, state, methods, event listening, and URI conversion
 * by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/lsp-diagnostics.svelte.js'),
  'utf-8'
);

describe('lsp-diagnostics.svelte.js: exports', () => {
  it('exports lspDiagnosticsStore', () => {
    assert.ok(src.includes('export const lspDiagnosticsStore'), 'Should export lspDiagnosticsStore');
  });

  it('creates store via createLspDiagnosticsStore factory', () => {
    assert.ok(src.includes('function createLspDiagnosticsStore'), 'Should define factory');
  });
});

describe('lsp-diagnostics.svelte.js: reactive state', () => {
  it('uses $state for diagnostics Map', () => {
    assert.ok(/let\s+diagnostics\s*=\s*\$state\(new Map\(\)\)/.test(src), 'Should use $state for diagnostics Map');
  });
});

describe('lsp-diagnostics.svelte.js: methods', () => {
  it('has getForFile method', () => {
    assert.ok(src.includes('getForFile('), 'Should have getForFile method');
  });

  it('getForFile returns from diagnostics Map', () => {
    assert.ok(src.includes('diagnostics.get(filePath)'), 'Should get from Map');
  });

  it('has getForDirectory method', () => {
    assert.ok(src.includes('getForDirectory('), 'Should have getForDirectory method');
  });

  it('getForDirectory uses prefix match', () => {
    assert.ok(src.includes('path.startsWith(prefix)'), 'Should use prefix match for directory');
  });

  it('getForDirectory aggregates errors and warnings', () => {
    assert.ok(src.includes('errors += counts.errors'), 'Should aggregate errors');
    assert.ok(src.includes('warnings += counts.warnings'), 'Should aggregate warnings');
  });

  it('has clear method', () => {
    assert.ok(src.includes('clear()'), 'Should have clear method');
  });

  it('clear resets diagnostics to empty Map', () => {
    const clearIdx = src.indexOf('clear()');
    const afterClear = src.slice(clearIdx, clearIdx + 100);
    assert.ok(afterClear.includes('new Map()'), 'Should reset to new Map');
  });

  it('has startListening method', () => {
    assert.ok(src.includes('async startListening('), 'Should have startListening');
  });

  it('has stopListening method', () => {
    assert.ok(src.includes('stopListening()'), 'Should have stopListening');
  });
});

describe('lsp-diagnostics.svelte.js: event listening', () => {
  it('imports listen from Tauri', () => {
    assert.ok(src.includes("import { listen }"), 'Should import listen');
    assert.ok(src.includes("@tauri-apps/api/event"), 'Should import from Tauri event');
  });

  it('listens for lsp-diagnostics event', () => {
    assert.ok(src.includes("'lsp-diagnostics'"), 'Should listen for lsp-diagnostics');
  });

  it('calls stopListening before starting new listener', () => {
    const startIdx = src.indexOf('async startListening');
    const startBody = src.slice(startIdx, startIdx + 200);
    assert.ok(startBody.includes('stopListening'), 'Should stop old listener first');
  });

  it('cleans up unlisten on stopListening', () => {
    assert.ok(src.includes('unlisten?.()'), 'Should call unlisten on cleanup');
  });
});

describe('lsp-diagnostics.svelte.js: diagnostic handling', () => {
  it('has handleDiagnosticsEvent function', () => {
    assert.ok(src.includes('handleDiagnosticsEvent'), 'Should have event handler');
  });

  it('counts errors by severity', () => {
    assert.ok(
      src.includes("sev === 'error'") || src.includes('sev === 1'),
      'Should count error severity'
    );
  });

  it('counts warnings by severity', () => {
    assert.ok(
      src.includes("sev === 'warning'") || src.includes('sev === 2'),
      'Should count warning severity'
    );
  });

  it('removes entries with zero errors and warnings', () => {
    assert.ok(src.includes('updated.delete(relativePath)'), 'Should delete entries with no issues');
  });

  it('creates new Map on update for reactivity', () => {
    assert.ok(src.includes('new Map(diagnostics)'), 'Should create new Map for reactivity');
  });
});

describe('lsp-diagnostics.svelte.js: URI conversion', () => {
  it('has uriToRelativePath wrapper', () => {
    assert.ok(src.includes('function uriToRelativePath'), 'Should have uriToRelativePath wrapper');
  });

  it('imports shared uriToRelativePath from editor-lsp', () => {
    assert.ok(src.includes("import { uriToRelativePath"), 'Should import from editor-lsp');
    assert.ok(src.includes("editor-lsp.svelte.js"), 'Should reference editor-lsp.svelte.js');
  });

  it('filters out external paths', () => {
    assert.ok(src.includes('result.external'), 'Should check external flag');
  });

  it('returns null for paths outside project root', () => {
    assert.ok(src.includes('return null'), 'Should return null for external paths');
  });
});

describe('lsp-diagnostics.svelte.js: diagnostics getter', () => {
  it('has diagnostics getter', () => {
    assert.ok(src.includes('get diagnostics()'), 'Should have diagnostics getter');
  });
});

describe('lsp-diagnostics.svelte.js: getForFile returns null when no diagnostics', () => {
  it('returns null when file not in Map', () => {
    assert.ok(src.includes('|| null'), 'Should return null for missing file');
  });
});

describe('lsp-diagnostics.svelte.js: getForDirectory returns null for empty dirs', () => {
  it('returns null when no children have diagnostics', () => {
    const getForDir = src.slice(src.indexOf('getForDirectory'));
    assert.ok(getForDir.includes('return null'), 'Should return null for clean directories');
  });
});
