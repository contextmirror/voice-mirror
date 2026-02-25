const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const workspaceSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
  'utf-8'
);

describe('LensWorkspace.svelte — element selection', () => {
  it('has handleElementSend function', () => {
    assert.ok(workspaceSrc.includes('function handleElementSend'));
  });

  it('passes onElementSend to DesignToolbar', () => {
    assert.ok(workspaceSrc.includes('onElementSend={handleElementSend}'));
  });

  it('adds image attachment for element capture', () => {
    assert.ok(workspaceSrc.includes("path: 'element-capture'"));
    assert.ok(workspaceSrc.includes("type: 'image/png'"));
  });

  it('auto-sends to chat via chatStore.addMessage', () => {
    assert.ok(workspaceSrc.includes('chatStore.addMessage'));
  });

  it('imports chatStore for auto-send', () => {
    assert.ok(workspaceSrc.includes("import { chatStore }"));
  });

  it('ensures chat panel is visible on send', () => {
    assert.ok(workspaceSrc.includes('layoutStore.setShowChat(true)'));
  });

  it('routes message to AI provider via onSend', () => {
    assert.ok(workspaceSrc.includes('onSend(contextText'));
  });

  it('exits design mode after element send', () => {
    assert.ok(workspaceSrc.includes('setDesignMode(false)'));
  });
});
