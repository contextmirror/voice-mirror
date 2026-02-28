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

  it('has rawDiagnostics getter', () => {
    assert.ok(src.includes('get rawDiagnostics()'), 'Should expose rawDiagnostics publicly');
  });
});

describe('lsp-diagnostics.svelte.js: raw diagnostics cache', () => {
  it('maintains rawDiagnostics Map with $state', () => {
    assert.ok(/let\s+rawDiagnostics\s*=\s*\$state\(new Map\(\)\)/.test(src), 'Should use $state for rawDiagnostics');
  });

  it('has getRawForFile method', () => {
    assert.ok(src.includes('getRawForFile('), 'Should have getRawForFile method');
  });

  it('getRawForFile returns from rawDiagnostics Map', () => {
    assert.ok(src.includes('rawDiagnostics.get(filePath)'), 'Should get from rawDiagnostics Map');
  });

  it('stores raw diagnostics in handleDiagnosticsEvent', () => {
    assert.ok(src.includes('updatedRaw.set(relativePath, lspDiags)'), 'Should cache raw LSP diagnostics');
  });

  it('clears rawDiagnostics on clear()', () => {
    const clearSection = src.slice(src.indexOf('clear()'));
    const matches = clearSection.match(/new Map\(\)/g);
    assert.ok(matches && matches.length >= 2, 'Should reset both diagnostics and rawDiagnostics');
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

describe('lsp-diagnostics.svelte.js: getTotals method', () => {
  it('has getTotals method', () => {
    assert.ok(src.includes('getTotals('), 'Should have getTotals method');
  });

  it('getTotals aggregates errors, warnings, and infos', () => {
    const getTotalsIdx = src.indexOf('getTotals()');
    const getTotalsBody = src.slice(getTotalsIdx, getTotalsIdx + 300);
    assert.ok(getTotalsBody.includes('errors'), 'Should count total errors');
    assert.ok(getTotalsBody.includes('warnings'), 'Should count total warnings');
    assert.ok(getTotalsBody.includes('infos'), 'Should count total infos');
  });

  it('getTotals iterates rawDiagnostics', () => {
    const getTotalsIdx = src.indexOf('getTotals()');
    const getTotalsBody = src.slice(getTotalsIdx, getTotalsIdx + 400);
    assert.ok(getTotalsBody.includes('rawDiagnostics'), 'Should iterate rawDiagnostics for accurate counts');
  });

  it('getTotals returns object with errors, warnings, infos keys', () => {
    const getTotalsIdx = src.indexOf('getTotals()');
    const getTotalsBody = src.slice(getTotalsIdx, getTotalsIdx + 500);
    assert.ok(/return\s*\{[^}]*errors[^}]*warnings[^}]*infos[^}]*\}/.test(getTotalsBody),
      'Should return { errors, warnings, infos }');
  });

  it('getTotals checks severity 3 for info', () => {
    const getTotalsIdx = src.indexOf('getTotals()');
    const getTotalsBody = src.slice(getTotalsIdx, getTotalsIdx + 500);
    assert.ok(getTotalsBody.includes("'information'") || getTotalsBody.includes('sev === 3'),
      'Should check info severity (string or numeric)');
  });
});

describe('lsp-diagnostics.svelte.js: project-wide state', () => {
  it('diagnostics Map keyed by relative path', () => {
    assert.ok(src.includes('updated.set(relativePath,'), 'Should key diagnostics by relative path');
  });

  it('clear resets both diagnostics and rawDiagnostics Maps', () => {
    const clearIdx = src.indexOf('clear()');
    const clearBody = src.slice(clearIdx, clearIdx + 200);
    const mapResets = (clearBody.match(/new Map\(\)/g) || []).length;
    assert.ok(mapResets >= 2, 'clear() should reset both diagnostics and rawDiagnostics to new Map()');
  });

  it('handles bulk updates by creating new Map copies', () => {
    assert.ok(src.includes('new Map(diagnostics)'), 'Should create new Map from existing for immutable update');
    assert.ok(src.includes('new Map(rawDiagnostics)'), 'Should create new Map from rawDiagnostics for immutable update');
  });

  it('removes files with zero diagnostics from Maps', () => {
    assert.ok(src.includes('updated.delete(relativePath)'), 'Should delete from summary map');
    assert.ok(src.includes('updatedRaw.delete(relativePath)'), 'Should delete from raw map');
  });
});
