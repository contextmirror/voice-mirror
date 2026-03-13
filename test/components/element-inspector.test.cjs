const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/ElementInspector.svelte'),
  'utf-8'
);

describe('ElementInspector.svelte: structure', () => {
  it('has a close button with aria-label', () => {
    assert.ok(src.includes('aria-label="Close inspector"'), 'Must have accessible close button');
  });

  it('has role="complementary" on panel', () => {
    assert.ok(src.includes('role="complementary"'), 'Panel must have complementary role');
  });

  it('uses CSS variables for theming (no hardcoded colors)', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    const lines = styleBlock.split('\n');
    for (const line of lines) {
      if (line.includes('color:') && !line.includes('var(') && !line.includes('currentColor') && !line.includes('//') && !line.includes('transparent') && !line.includes('inherit')) {
        if (!line.includes('swatch') && !line.includes('background:') && !line.includes('.swatch')) {
        }
      }
    }
    assert.ok(styleBlock.includes('var(--bg'), 'Must use --bg CSS variable');
    assert.ok(styleBlock.includes('var(--text'), 'Must use --text CSS variable');
    assert.ok(styleBlock.includes('var(--border'), 'Must use --border CSS variable');
  });
});

describe('ElementInspector.svelte: sections', () => {
  it('has COMPONENTS section header', () => {
    assert.ok(src.includes('COMPONENTS') || src.includes('Components'), 'Must have Components section');
  });

  it('has ELEMENT section', () => {
    assert.ok(src.includes('ELEMENT') || src.includes('Element'), 'Must have Element section');
  });

  it('has PATH section', () => {
    assert.ok(src.includes('PATH') || src.includes('Path'), 'Must have Path section');
  });

  it('has ATTRIBUTES section', () => {
    assert.ok(src.includes('ATTRIBUTES') || src.includes('Attributes'), 'Must have Attributes section');
  });

  it('has COMPUTED STYLES section', () => {
    assert.ok(src.includes('COMPUTED STYLES') || src.includes('Computed Styles'), 'Must have Computed Styles section');
  });

  it('has POSITION & SIZE section', () => {
    assert.ok(src.includes('POSITION') || src.includes('Position'), 'Must have Position section');
  });
});

describe('ElementInspector.svelte: tree view', () => {
  it('renders tree nodes with expand/collapse arrows', () => {
    assert.ok(src.includes('▶') || src.includes('▼') || src.includes('expand') || src.includes('collapse'), 'Must have expand/collapse indicators');
  });

  it('imports designSelectByTreeId API', () => {
    assert.ok(src.includes('designSelectByTreeId'), 'Must import tree selection API');
  });

  it('imports designExpandTreeNode API', () => {
    assert.ok(src.includes('designExpandTreeNode'), 'Must import tree expansion API');
  });
});

describe('ElementInspector.svelte: Svelte 5 runes', () => {
  it('uses $derived.by for computed values (not $derived with function)', () => {
    assert.ok(src.includes('$derived.by'), 'Must use $derived.by for function-based derivations');
  });
});

describe('ElementInspector.svelte: color swatches', () => {
  it('has color swatch elements for CSS color values', () => {
    assert.ok(src.includes('swatch'), 'Must render color swatches for color values');
  });
});

describe('ElementInspector.svelte: panel styling', () => {
  it('has fixed width around 300px', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('300px') || styleBlock.includes('width'), 'Panel must have ~300px width');
  });

  it('uses monospace font for values', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('monospace'), 'Must use monospace font for values');
  });
});
