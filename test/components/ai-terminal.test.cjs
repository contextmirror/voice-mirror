/**
 * ai-terminal.test.cjs
 *
 * Guards the cold-start terminal sizing fix: on first boot into the Lens IDE,
 * the ghostty canvas must wait for the monospace web font before its initial
 * fit, or it leaves a grey band until a resize/remount.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'terminal', 'AiTerminal.svelte'),
  'utf-8'
);

describe('AiTerminal: cold-start sizing', () => {
  it('waits for web fonts before the initial fit', () => {
    assert.ok(src.includes('document.fonts.ready'), 'Should await document.fonts.ready before fitting');
  });

  it('still fits and reveals the terminal after fonts load', () => {
    const idx = src.indexOf('document.fonts.ready');
    const after = src.slice(idx);
    assert.ok(after.includes('fitTerminal()'), 'Should fit after fonts are ready');
    assert.ok(after.includes('initialized = true'), 'Should reveal (initialized) after the corrected fit');
  });

  it('has a delayed backstop re-fit for late layout settling', () => {
    assert.ok(/setTimeout\([^)]*\n?[^}]*fitTerminal/.test(src) || src.includes('Backstop re-fit'), 'Should re-fit after a short delay');
  });
});
