const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const workspaceSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
  'utf-8'
);

describe('LensWorkspace.svelte — element selection v2', () => {
  it('has handleElementSend function', () => {
    assert.ok(workspaceSrc.includes('function handleElementSend'));
  });

  it('passes onElementSend to DesignToolbar', () => {
    assert.ok(workspaceSrc.includes('onElementSend={handleElementSend}'));
  });

  it('queues attachment with context field', () => {
    assert.ok(workspaceSrc.includes("context:"), 'Should set context on attachment');
    assert.ok(workspaceSrc.includes('attachmentsStore.add'), 'Should add to pending attachments');
  });

  it('does NOT auto-send via chatStore.addMessage in handleElementSend', () => {
    const fnStart = workspaceSrc.indexOf('function handleElementSend');
    const fnEnd = workspaceSrc.indexOf('\n  }', fnStart);
    const fnBody = workspaceSrc.substring(fnStart, fnEnd);
    assert.ok(!fnBody.includes('chatStore.addMessage'), 'Should not auto-send message');
  });

  it('ensures chat panel is visible', () => {
    assert.ok(workspaceSrc.includes('layoutStore.setShowChat(true)'));
  });

  it('focuses chat input after queuing', () => {
    const fnStart = workspaceSrc.indexOf('function handleElementSend');
    const fnEnd = workspaceSrc.indexOf('\n  }', fnStart);
    const fnBody = workspaceSrc.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('focus'), 'Should focus chat input');
  });

  it('exits design mode after queuing', () => {
    assert.ok(workspaceSrc.includes('setDesignMode(false)'));
  });
});
