const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DesignToolbar.svelte'),
  'utf-8'
);

describe('DesignToolbar.svelte — select element', () => {
  it('has a select tool in the tools array', () => {
    assert.ok(src.includes("id: 'select'"));
  });

  it('has a Select Element label', () => {
    assert.ok(src.includes('Select Element'));
  });

  it('imports designGetElement from api', () => {
    assert.ok(src.includes('designGetElement'));
  });

  it('imports lensCapturePreview from api', () => {
    assert.ok(src.includes('lensCapturePreview'));
  });

  it('has onElementSend prop', () => {
    assert.ok(src.includes('onElementSend'));
  });

  it('has cropScreenshot function', () => {
    assert.ok(src.includes('cropScreenshot'));
  });

  it('has handleElementSend function', () => {
    assert.ok(src.includes('handleElementSend'));
  });

  it('hides drawing controls when select tool is active', () => {
    assert.ok(src.includes("activeTool !== 'select'"));
  });

  it('select is the first tool in the array', () => {
    const toolsMatch = src.match(/const tools = \[([\s\S]*?)\];/);
    assert.ok(toolsMatch, 'tools array found');
    const firstTool = toolsMatch[1].trim();
    assert.ok(firstTool.startsWith("{ id: 'select'"), 'select is first tool');
  });

  it('formats context text with selector, size, HTML and styles', () => {
    assert.ok(src.includes('elem.selector'));
    assert.ok(src.includes('elem.bounds.width'));
    assert.ok(src.includes('elem.html'));
    assert.ok(src.includes('elem.styles'));
  });

  it('uses devicePixelRatio for crop scaling', () => {
    assert.ok(src.includes('devicePixelRatio'));
  });
});
