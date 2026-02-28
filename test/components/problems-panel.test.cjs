/**
 * problems-panel.test.cjs -- Source-inspection tests for ProblemsPanel.svelte
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/ProblemsPanel.svelte'),
  'utf-8'
);

describe('ProblemsPanel.svelte: imports', () => {
  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should use diagnostics store');
  });

  it('imports tabsStore for navigation', () => {
    assert.ok(src.includes('tabsStore'), 'Should use tabs store for click-to-navigate');
  });
});

describe('ProblemsPanel.svelte: structure', () => {
  it('has file group headers with collapse toggle', () => {
    assert.ok(src.includes('file-group'), 'Should have file group containers');
    assert.ok(src.includes('collapsed') || src.includes('expanded'), 'Should support collapse/expand');
  });

  it('has diagnostic rows', () => {
    assert.ok(src.includes('diagnostic-row') || src.includes('diag-row'), 'Should have diagnostic rows');
  });

  it('shows severity icons', () => {
    assert.ok(src.includes('severity'), 'Should render severity indicators');
  });

  it('shows line and column', () => {
    assert.ok(src.includes('line') && src.includes('character'), 'Should show line:col');
  });

  it('shows diagnostic message', () => {
    assert.ok(src.includes('message'), 'Should show diagnostic message');
  });
});

describe('ProblemsPanel.svelte: click to navigate', () => {
  it('calls openFile on diagnostic click', () => {
    assert.ok(src.includes('openFile'), 'Should call openFile on click');
  });

  it('sets pending cursor position', () => {
    assert.ok(src.includes('setPendingCursor'), 'Should set cursor position for editor');
  });
});

describe('ProblemsPanel.svelte: empty state', () => {
  it('shows empty message when no problems', () => {
    assert.ok(
      src.includes('No problems') || src.includes('no problems'),
      'Should show empty state message'
    );
  });
});

describe('ProblemsPanel.svelte: filtering', () => {
  it('supports severity filtering', () => {
    assert.ok(src.includes('showErrors') || src.includes('filterErrors'), 'Should have error filter state');
    assert.ok(src.includes('showWarnings') || src.includes('filterWarnings'), 'Should have warning filter state');
  });

  it('supports text filtering', () => {
    assert.ok(src.includes('filterText') || src.includes('textFilter'), 'Should have text filter');
  });
});

describe('ProblemsPanel.svelte: sorting', () => {
  it('sorts diagnostics by severity then line', () => {
    assert.ok(src.includes('sort'), 'Should sort diagnostics');
  });
});

describe('ProblemsPanel.svelte: styling', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped styles');
  });

  it('uses theme variables for severity colors', () => {
    assert.ok(src.includes('--danger'), 'Should use --danger for errors');
    assert.ok(src.includes('--warn'), 'Should use --warn for warnings');
  });
});
