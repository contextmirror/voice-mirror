/**
 * diff-minimap.test.cjs -- Source-inspection tests for DiffMinimap.svelte
 *
 * Validates the scrollbar minimap component showing change markers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DiffMinimap.svelte'),
  'utf-8'
);

describe('DiffMinimap.svelte: structure', () => {
  it('uses $props for component inputs', () => {
    assert.ok(src.includes('$props()'), 'Should use $props rune');
  });

  it('accepts chunks prop', () => {
    assert.ok(src.includes('chunks'), 'Should have chunks prop');
  });

  it('accepts totalLines prop', () => {
    assert.ok(src.includes('totalLines'), 'Should have totalLines prop');
  });

  it('computes markers with $derived', () => {
    assert.ok(src.includes('$derived'), 'Should use $derived for markers');
    assert.ok(src.includes('markers'), 'Should compute markers');
  });
});

describe('DiffMinimap.svelte: container', () => {
  it('has diff-minimap container class', () => {
    assert.ok(src.includes('diff-minimap'), 'Should have diff-minimap class');
  });

  it('is absolutely positioned', () => {
    assert.ok(src.includes('position: absolute'), 'Should be absolutely positioned');
  });

  it('is positioned at right edge', () => {
    assert.ok(src.includes('right: 0'), 'Should be on right edge');
    assert.ok(src.includes('top: 0'), 'Should start at top');
  });

  it('is 14px wide to overlay scrollbar', () => {
    assert.ok(src.includes('width: 14px'), 'Should be 14px wide to overlay scrollbar');
  });

  it('has full height', () => {
    assert.ok(src.includes('height: 100%'), 'Should span full height');
  });

  it('has z-index 8 to overlay scrollbar', () => {
    assert.ok(src.includes('z-index: 8'), 'Should have z-index 8');
  });

  it('has pointer-events none', () => {
    assert.ok(src.includes('pointer-events: none'), 'Should not capture pointer events');
  });
});

describe('DiffMinimap.svelte: markers', () => {
  it('has minimap-marker class', () => {
    assert.ok(src.includes('minimap-marker'), 'Should have minimap-marker class');
  });

  it('markers have absolute positioning', () => {
    const markerSection = src.substring(src.indexOf('.minimap-marker {'));
    assert.ok(markerSection.includes('position: absolute'), 'Markers should be absolutely positioned');
  });

  it('markers are inset from edges', () => {
    assert.ok(src.includes('left: 3px'), 'Markers should have left inset');
    assert.ok(src.includes('right: 3px'), 'Markers should have right inset');
  });

  it('markers have min-height of 3px', () => {
    assert.ok(src.includes('min-height: 3px'), 'Markers should have min-height');
  });

  it('markers have border-radius', () => {
    assert.ok(src.includes('border-radius: 2px'), 'Markers should be rounded');
  });
});

describe('DiffMinimap.svelte: marker colors', () => {
  it('addition markers use ok color', () => {
    assert.ok(src.includes('.minimap-marker.addition'), 'Should have addition class');
    assert.ok(src.includes('var(--ok)'), 'Should use ok color for additions');
  });

  it('deletion markers use danger color', () => {
    assert.ok(src.includes('.minimap-marker.deletion'), 'Should have deletion class');
    assert.ok(src.includes('var(--danger)'), 'Should use danger color for deletions');
  });

  it('change markers use accent color', () => {
    assert.ok(src.includes('.minimap-marker.change'), 'Should have change class');
    assert.ok(src.includes('var(--accent)'), 'Should use accent color for changes');
  });

  it('markers have 80% opacity via color-mix', () => {
    assert.ok(src.includes('80%'), 'Should use 80% opacity');
    assert.ok(src.includes('color-mix'), 'Should use color-mix for transparency');
  });
});

describe('DiffMinimap.svelte: positioning', () => {
  it('computes top position as percentage', () => {
    assert.ok(src.includes('top:'), 'Should set top position');
    assert.ok(src.includes('startLine'), 'Should use startLine for position');
  });

  it('computes height as percentage', () => {
    assert.ok(src.includes('height:'), 'Should set height');
    assert.ok(src.includes('endLine'), 'Should use endLine for height');
  });

  it('renders marker type as CSS class', () => {
    assert.ok(src.includes('marker.type'), 'Should apply type as class');
  });
});
