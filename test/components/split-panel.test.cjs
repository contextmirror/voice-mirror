/**
 * split-panel.test.cjs -- Source-inspection tests for SplitPanel.svelte
 *
 * Validates the generic resizable split panel component using the
 * source-inspection pattern (read file text, assert patterns exist).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/shared/SplitPanel.svelte'),
  'utf-8'
);

describe('SplitPanel.svelte', () => {
  it('accepts direction prop', () => {
    assert.ok(src.includes("direction = 'horizontal'"), 'Should default direction to horizontal');
  });

  it('accepts ratio as $bindable', () => {
    assert.ok(src.includes('$bindable'), 'Should use $bindable for two-way ratio binding');
  });

  it('accepts minA and minB props', () => {
    assert.ok(src.includes('minA'), 'Should have minA prop');
    assert.ok(src.includes('minB'), 'Should have minB prop');
  });

  it('accepts panelA and panelB snippet props', () => {
    assert.ok(src.includes('panelA'), 'Should have panelA snippet prop');
    assert.ok(src.includes('panelB'), 'Should have panelB snippet prop');
  });

  it('renders panelA snippet', () => {
    assert.ok(src.includes('{@render panelA()}'), 'Should render panelA snippet');
  });

  it('renders panelB snippet', () => {
    assert.ok(src.includes('{@render panelB()}'), 'Should render panelB snippet');
  });

  it('uses setPointerCapture for smooth dragging', () => {
    assert.ok(src.includes('setPointerCapture'), 'Should use pointer capture API');
  });

  it('has separator role for accessibility', () => {
    assert.ok(src.includes('role="separator"'), 'Should have separator role');
  });

  it('has aria-orientation', () => {
    assert.ok(src.includes('aria-orientation'), 'Should have aria-orientation attribute');
  });

  it('uses -webkit-app-region: no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should prevent Tauri window drag');
  });

  it('has split-handle CSS class', () => {
    assert.ok(src.includes('.split-handle'), 'Should have split-handle CSS');
  });

  it('has handle-line for visual indicator', () => {
    assert.ok(src.includes('.handle-line'), 'Should have handle-line CSS');
  });

  it('tracks dragging state', () => {
    assert.ok(src.includes('dragging'), 'Should track dragging state');
  });

  it('supports col-resize cursor', () => {
    assert.ok(src.includes('col-resize'), 'Should have col-resize cursor for horizontal');
  });

  it('supports row-resize cursor', () => {
    assert.ok(src.includes('row-resize'), 'Should have row-resize cursor for vertical');
  });

  it('clamps ratio to respect minimums', () => {
    assert.ok(src.includes('Math.max'), 'Should clamp with Math.max');
    assert.ok(src.includes('Math.min'), 'Should clamp with Math.min');
  });

  it('split panels are flex containers for children', () => {
    // .split-panel needs display:flex so children using flex:1 get proper sizing
    const panelCSS = src.split('.split-panel')[1]?.split('}')[0] || '';
    assert.ok(panelCSS.includes('display: flex'), 'split-panel should be a flex container');
    assert.ok(panelCSS.includes('flex-direction: column'), 'split-panel should use column direction');
  });
});
