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

const toolbarSrc = src;

describe('DesignToolbar — enriched context', () => {
  it('formats parent chain in context text', () => {
    assert.ok(toolbarSrc.includes('parentChain'), 'Should reference parentChain');
    assert.ok(toolbarSrc.includes('Parent chain'), 'Should have Parent chain section header');
  });

  it('formats pseudo-class rules in context text', () => {
    assert.ok(toolbarSrc.includes('pseudoRules'), 'Should reference pseudoRules');
    assert.ok(toolbarSrc.includes('Pseudo-class rules'), 'Should have Pseudo-class rules section header');
  });

  it('caps total context at 8000 characters', () => {
    assert.ok(toolbarSrc.includes('8000'), 'Should cap context at 8000 chars');
  });

  it('handles classes as string or array', () => {
    assert.ok(toolbarSrc.includes('Array.isArray(elem.classes)'), 'Should handle array classes');
  });
});

describe('DesignToolbar — accessibility context formatting', () => {
  it('formats accessibility role in context text', () => {
    assert.ok(toolbarSrc.includes('.accessibility'), 'Should reference accessibility field');
    assert.ok(toolbarSrc.includes('Role:'), 'Should have Role: label in context');
  });

  it('formats ARIA attributes in context text', () => {
    assert.ok(toolbarSrc.includes('ariaAttributes'), 'Should reference ariaAttributes');
    assert.ok(toolbarSrc.includes('ARIA:'), 'Should have ARIA: label in context');
  });

  it('formats HTML states in context text', () => {
    assert.ok(toolbarSrc.includes('htmlStates'), 'Should reference htmlStates');
    assert.ok(toolbarSrc.includes('States:'), 'Should have States: label in context');
  });

  it('only includes accessibility lines when data is present', () => {
    assert.ok(toolbarSrc.includes('.role'), 'Should check role exists');
  });
});
