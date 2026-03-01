/**
 * diff-toolbar.test.cjs -- Source-inspection tests for DiffToolbar.svelte
 *
 * Validates the diff toolbar UI component with navigation, toggles, and stats.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DiffToolbar.svelte'),
  'utf-8'
);

describe('DiffToolbar.svelte: structure', () => {
  it('uses $props for component inputs', () => {
    assert.ok(src.includes('$props()'), 'Should use $props rune');
  });

  it('accepts filePath prop', () => {
    assert.ok(src.includes('filePath'), 'Should have filePath prop');
  });

  it('accepts stats prop with additions and deletions', () => {
    assert.ok(src.includes('stats'), 'Should have stats prop');
    assert.ok(src.includes('stats.additions'), 'Should reference stats.additions');
    assert.ok(src.includes('stats.deletions'), 'Should reference stats.deletions');
  });

  it('accepts viewMode prop', () => {
    assert.ok(src.includes('viewMode'), 'Should have viewMode prop');
  });

  it('accepts chunkCount and currentChunkIndex props', () => {
    assert.ok(src.includes('chunkCount'), 'Should have chunkCount prop');
    assert.ok(src.includes('currentChunkIndex'), 'Should have currentChunkIndex prop');
  });

  it('accepts wordWrap and showWhitespace toggle props', () => {
    assert.ok(src.includes('wordWrap'), 'Should have wordWrap prop');
    assert.ok(src.includes('showWhitespace'), 'Should have showWhitespace prop');
  });

  it('accepts callback props for actions', () => {
    assert.ok(src.includes('onToggleMode'), 'Should have onToggleMode callback');
    assert.ok(src.includes('onPrevChunk'), 'Should have onPrevChunk callback');
    assert.ok(src.includes('onNextChunk'), 'Should have onNextChunk callback');
    assert.ok(src.includes('onToggleWrap'), 'Should have onToggleWrap callback');
    assert.ok(src.includes('onToggleWhitespace'), 'Should have onToggleWhitespace callback');
  });
});

describe('DiffToolbar.svelte: toolbar layout', () => {
  it('has diff-toolbar container class', () => {
    assert.ok(src.includes('diff-toolbar'), 'Should have diff-toolbar class');
  });

  it('has -webkit-app-region: no-drag for interactivity', () => {
    assert.ok(
      src.includes('-webkit-app-region: no-drag'),
      'Should prevent drag on toolbar'
    );
  });

  it('has background using var(--bg-elevated)', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use elevated bg');
  });

  it('has border-bottom using var(--border)', () => {
    assert.ok(src.includes('border-bottom'), 'Should have border-bottom');
  });

  it('displays file path', () => {
    assert.ok(src.includes('diff-file-path'), 'Should have file path element');
  });
});

describe('DiffToolbar.svelte: view mode buttons', () => {
  it('has unified view button', () => {
    assert.ok(src.includes('aria-label="Unified view"'), 'Should have unified button');
  });

  it('has split view button', () => {
    assert.ok(src.includes('aria-label="Split view"'), 'Should have split button');
  });

  it('highlights active view mode', () => {
    assert.ok(src.includes('class:active'), 'Should use class:active directive');
  });

  it('active state uses accent color', () => {
    assert.ok(src.includes('.diff-btn.active'), 'Should have .diff-btn.active CSS');
    assert.ok(src.includes('var(--accent)'), 'Should use accent color for active');
  });
});

describe('DiffToolbar.svelte: chunk navigation', () => {
  it('has previous change button', () => {
    assert.ok(src.includes('aria-label="Previous change"'), 'Should have prev button');
  });

  it('has next change button', () => {
    assert.ok(src.includes('aria-label="Next change"'), 'Should have next button');
  });

  it('shows chunk label with index and count', () => {
    assert.ok(src.includes('diff-chunk-label'), 'Should have chunk label');
    assert.ok(src.includes('chunkLabel'), 'Should compute chunk label');
  });

  it('disables navigation buttons at boundaries', () => {
    assert.ok(src.includes('disabled={!hasPrev}'), 'Should disable prev at start');
    assert.ok(src.includes('disabled={!hasNext}'), 'Should disable next at end');
  });

  it('disabled buttons have reduced opacity', () => {
    assert.ok(src.includes('.diff-btn:disabled'), 'Should have disabled CSS');
    assert.ok(src.includes('opacity: 0.3'), 'Should reduce opacity when disabled');
  });
});

describe('DiffToolbar.svelte: toggle buttons', () => {
  it('has word wrap toggle', () => {
    assert.ok(src.includes('aria-label="Toggle word wrap"'), 'Should have wrap toggle');
  });

  it('has whitespace toggle', () => {
    assert.ok(src.includes('aria-label="Toggle whitespace"'), 'Should have ws toggle');
  });
});

describe('DiffToolbar.svelte: diff stats display', () => {
  it('has diff-stats container', () => {
    assert.ok(src.includes('diff-stats'), 'Should have diff-stats class');
  });

  it('shows additions in ok color', () => {
    assert.ok(src.includes('diff-stat-add'), 'Should have additions class');
    assert.ok(src.includes('var(--ok)'), 'Should use ok color for additions');
  });

  it('shows deletions in danger color', () => {
    assert.ok(src.includes('diff-stat-del'), 'Should have deletions class');
    assert.ok(src.includes('var(--danger)'), 'Should use danger color for deletions');
  });

  it('stats use font-weight 600', () => {
    assert.ok(src.includes('font-weight: 600'), 'Should use bold stats');
  });
});

describe('DiffToolbar.svelte: SVG icons', () => {
  it('has SVG icons with 16x16 dimensions', () => {
    assert.ok(src.includes('width="16" height="16"'), 'Should have 16x16 SVGs');
  });

  it('uses stroke-based SVG icons', () => {
    assert.ok(src.includes('stroke="currentColor"'), 'Should use currentColor stroke');
  });

  it('buttons are 28x28px', () => {
    assert.ok(src.includes('width: 28px'), 'Should be 28px wide');
    assert.ok(src.includes('height: 28px'), 'Should be 28px tall');
  });

  it('buttons have border-radius: 4px', () => {
    assert.ok(src.includes('border-radius: 4px'), 'Should have 4px radius');
  });
});

describe('DiffToolbar.svelte: toolbar separators', () => {
  it('has separator elements between groups', () => {
    assert.ok(src.includes('diff-toolbar-separator'), 'Should have separators');
  });
});

describe('DiffToolbar.svelte: file navigation buttons', () => {
  it('accepts onPrevFile and onNextFile callback props', () => {
    assert.ok(src.includes('onPrevFile'), 'Should have onPrevFile callback');
    assert.ok(src.includes('onNextFile'), 'Should have onNextFile callback');
  });

  it('accepts hasPrevFile and hasNextFile props', () => {
    assert.ok(src.includes('hasPrevFile'), 'Should have hasPrevFile prop');
    assert.ok(src.includes('hasNextFile'), 'Should have hasNextFile prop');
  });

  it('has previous changed file button', () => {
    assert.ok(src.includes('aria-label="Previous changed file"'), 'Should have prev file button');
  });

  it('has next changed file button', () => {
    assert.ok(src.includes('aria-label="Next changed file"'), 'Should have next file button');
  });

  it('disables file navigation buttons when at boundaries', () => {
    assert.ok(src.includes('disabled={!hasPrevFile}'), 'Should disable prev file at start');
    assert.ok(src.includes('disabled={!hasNextFile}'), 'Should disable next file at end');
  });

  it('shows keyboard shortcut hints in tooltips', () => {
    assert.ok(src.includes('Shift+Alt+F5'), 'Should show Shift+Alt+F5 in prev file tooltip');
    assert.ok(src.includes('Alt+F5'), 'Should show Alt+F5 in next file tooltip');
  });
});
