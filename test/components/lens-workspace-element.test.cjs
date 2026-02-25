const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const workspaceSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
  'utf-8'
);

const libSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lib.rs'),
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

  it('adds text attachment for element context', () => {
    assert.ok(workspaceSrc.includes("path: 'element-context'"));
    assert.ok(workspaceSrc.includes("type: 'text/plain'"));
  });

  it('imports designGetElement from api', () => {
    assert.ok(workspaceSrc.includes('designGetElement'));
  });

  it('listens for lens-element-selected event', () => {
    assert.ok(workspaceSrc.includes('lens-element-selected'));
  });

  it('has cropElementScreenshot function', () => {
    assert.ok(workspaceSrc.includes('cropElementScreenshot'));
  });

  it('uses devicePixelRatio for crop scaling', () => {
    assert.ok(workspaceSrc.includes('devicePixelRatio'));
  });

  it('exits design mode after element send', () => {
    assert.ok(workspaceSrc.includes('setDesignMode(false)'));
  });
});

describe('lib.rs — element-selected lens-shortcut', () => {
  it('handles element-selected key in lens-shortcut scheme', () => {
    assert.ok(libSrc.includes('element-selected'));
  });

  it('emits lens-element-selected event', () => {
    assert.ok(libSrc.includes('lens-element-selected'));
  });
});
