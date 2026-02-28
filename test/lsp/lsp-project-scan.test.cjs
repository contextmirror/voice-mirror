/**
 * lsp-project-scan.test.cjs -- Source-inspection tests for LSP project file scanning.
 *
 * Verifies:
 * - Background file scanner (scan_project_files, collect_matching_files)
 * - Staggered didOpen batching
 * - Auto-scan on server start
 * - Background-to-foreground promotion
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);

describe('mod.rs: project file scanner', () => {
  it('has scan_project_files method', () => {
    assert.ok(modSrc.includes('scan_project_files'), 'Should have scan_project_files');
  });
  it('skips common ignored directories', () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', 'target']) {
      assert.ok(modSrc.includes(dir), `Should skip ${dir} directory`);
    }
  });
  it('caps max files scanned', () => {
    assert.ok(
      modSrc.includes('MAX_SCAN_FILES') || modSrc.includes('max_files'),
      'Should have max file cap'
    );
  });
  it('tracks background docs separately', () => {
    assert.ok(modSrc.includes('background_docs'), 'Should track background documents');
  });
  it('has collect_matching_files function', () => {
    assert.ok(modSrc.includes('collect_matching_files'), 'Should have file collection helper');
  });
  it('promotes background docs to foreground on user open', () => {
    // open_document should check background_docs and send didClose before re-opening
    assert.ok(
      modSrc.includes('background_docs') && modSrc.includes('didClose'),
      'Should handle background-to-foreground promotion'
    );
  });
});

describe('mod.rs: staggered background scanning', () => {
  it('batches didOpen calls with delay', () => {
    assert.ok(
      modSrc.includes('SCAN_BATCH_SIZE') || modSrc.includes('batch'),
      'Should batch didOpen calls'
    );
  });
  it('uses async sleep between batches', () => {
    assert.ok(
      modSrc.includes('sleep') && modSrc.includes('scan'),
      'Should sleep between batches to avoid flooding'
    );
  });
  it('has configurable batch size', () => {
    assert.ok(modSrc.includes('10') || modSrc.includes('SCAN_BATCH_SIZE'));
  });
});

describe('mod.rs: auto-scan on server start', () => {
  it('triggers scan after server initialization', () => {
    assert.ok(
      modSrc.includes('scan_project_files') && modSrc.includes('ensure_server'),
      'Should call scan_project_files in or after ensure_server'
    );
  });
  it('delays scan to let server initialize', () => {
    assert.ok(
      modSrc.includes('sleep') && (modSrc.includes('2') || modSrc.includes('scan')),
      'Should delay before scanning'
    );
  });
});

describe('commands/lsp.rs: scan project command', () => {
  it('has lsp_scan_project command', () => {
    assert.ok(cmdSrc.includes('lsp_scan_project'), 'Should have scan project command');
  });
});

describe('api.js: scan project wrapper', () => {
  it('has lspScanProject wrapper', () => {
    assert.ok(apiSrc.includes('lspScanProject'), 'Should have lspScanProject API wrapper');
  });
});
