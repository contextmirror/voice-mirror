/**
 * layout.test.cjs -- Source-inspection tests for layout.svelte.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/layout.svelte.js'),
  'utf-8'
);

describe('layout.svelte.js', () => {
  it('exports layoutStore', () => {
    assert.ok(src.includes('export const layoutStore'), 'Should export layoutStore');
  });

  it('has showChat state', () => {
    assert.ok(src.includes('showChat = $state('), 'Should have showChat state');
  });

  it('has showTerminal state', () => {
    assert.ok(src.includes('showTerminal = $state('), 'Should have showTerminal state');
  });

  it('has showFileTree state', () => {
    assert.ok(src.includes('showFileTree = $state('), 'Should have showFileTree state');
  });

  it('has toggleChat method', () => {
    assert.ok(src.includes('toggleChat()'), 'Should have toggleChat');
  });

  it('has toggleTerminal method', () => {
    assert.ok(src.includes('toggleTerminal()'), 'Should have toggleTerminal');
  });

  it('has toggleFileTree method', () => {
    assert.ok(src.includes('toggleFileTree()'), 'Should have toggleFileTree');
  });

  it('defaults all panels to visible', () => {
    assert.ok(src.includes('showChat = $state(true)'), 'Chat defaults to true');
    assert.ok(src.includes('showTerminal = $state(true)'), 'Terminal defaults to true');
    assert.ok(src.includes('showFileTree = $state(true)'), 'FileTree defaults to true');
  });
});
