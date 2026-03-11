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

  it('has setShowChat method for programmatic control', () => {
    assert.ok(src.includes('setShowChat(v)'), 'Should have setShowChat');
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

describe('layout.svelte.js — workspace state persistence', () => {
  it('has serialize() method', () => {
    assert.ok(src.includes('serialize()'), 'Should have serialize method');
  });

  it('has restore() method', () => {
    assert.ok(src.includes('restore(data)'), 'Should have restore method');
  });

  it('serialize includes panel visibility and ratios', () => {
    assert.ok(src.includes('showChat,'), 'Should include showChat');
    assert.ok(src.includes('chatRatio,'), 'Should include chatRatio');
    assert.ok(src.includes('centerRatio,'), 'Should include centerRatio');
    assert.ok(src.includes('previewRatio,'), 'Should include previewRatio');
    assert.ok(src.includes('devicePreviewRatio,'), 'Should include devicePreviewRatio');
  });

  it('restore validates types before setting', () => {
    assert.ok(src.includes("typeof data.showChat === 'boolean'"), 'Should validate boolean');
    assert.ok(src.includes("typeof data.chatRatio === 'number'"), 'Should validate number');
  });

  it('exports ratio getters', () => {
    assert.ok(src.includes('get chatRatio()'), 'Should export chatRatio getter');
    assert.ok(src.includes('get centerRatio()'), 'Should export centerRatio getter');
    assert.ok(src.includes('get previewRatio()'), 'Should export previewRatio getter');
    assert.ok(src.includes('get devicePreviewRatio()'), 'Should export devicePreviewRatio getter');
  });

  it('exports ratio setters', () => {
    assert.ok(src.includes('setChatRatio('), 'Should export setChatRatio');
    assert.ok(src.includes('setCenterRatio('), 'Should export setCenterRatio');
    assert.ok(src.includes('setPreviewRatio('), 'Should export setPreviewRatio');
    assert.ok(src.includes('setDevicePreviewRatio('), 'Should export setDevicePreviewRatio');
  });
});
