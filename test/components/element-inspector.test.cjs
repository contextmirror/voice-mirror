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
    assert.ok(styleBlock.includes('var(--bg'), 'Must use --bg CSS variable');
    assert.ok(styleBlock.includes('var(--text'), 'Must use --text CSS variable');
    assert.ok(styleBlock.includes('var(--border'), 'Must use --border CSS variable');
  });
});

describe('ElementInspector.svelte: tabs', () => {
  it('has Design and CSS tabs', () => {
    assert.ok(src.includes('Design'), 'Must have Design tab');
    assert.ok(src.includes('>CSS<') || (src.includes('tab-btn') && src.includes("'css'")), 'Must have CSS tab');
    assert.ok(src.includes('tab-btn'), 'Must have tab button class');
  });

  it('has activeTab state for tab switching', () => {
    assert.ok(src.includes('activeTab'), 'Must have activeTab state');
  });
});

describe('ElementInspector.svelte: Design tab sections', () => {
  it('has Components tree section', () => {
    assert.ok(src.includes('Components'), 'Must have Components section');
  });

  it('has Position section', () => {
    assert.ok(src.includes('Position'), 'Must have Position section');
  });

  it('has Layout section', () => {
    assert.ok(src.includes('Layout'), 'Must have Layout section');
  });

  it('has Padding section', () => {
    assert.ok(src.includes('Padding'), 'Must have Padding section');
  });

  it('has Margin section', () => {
    assert.ok(src.includes('Margin'), 'Must have Margin section');
  });

  it('has Appearance section', () => {
    assert.ok(src.includes('Appearance'), 'Must have Appearance section');
  });

  it('has Text section', () => {
    assert.ok(src.includes('>Text<') || src.includes("'Text'") || src.includes('"Text"') || src.includes('>Text</'), 'Must have Text section');
  });
});

describe('ElementInspector.svelte: CSS tab', () => {
  it('renders sorted CSS properties', () => {
    assert.ok(src.includes('sortedCssProps'), 'Must have sorted CSS properties list');
  });

  it('uses allStyles data for full computed styles', () => {
    assert.ok(src.includes('allStyles'), 'Must reference allStyles for CSS tab');
  });

  it('has color swatch elements for CSS color values', () => {
    assert.ok(src.includes('swatch'), 'Must render color swatches for color values');
  });
});

describe('ElementInspector.svelte: tree view', () => {
  it('renders tree nodes with expand/collapse arrows', () => {
    assert.ok(src.includes('▶') || src.includes('▼'), 'Must have expand/collapse indicators');
  });

  it('imports designSelectByTreeId API', () => {
    assert.ok(src.includes('designSelectByTreeId'), 'Must import tree selection API');
  });

  it('imports designExpandTreeNode API', () => {
    assert.ok(src.includes('designExpandTreeNode'), 'Must import tree expansion API');
  });
});

describe('ElementInspector.svelte: Svelte 5 runes', () => {
  it('uses $derived.by for computed values', () => {
    assert.ok(src.includes('$derived.by'), 'Must use $derived.by for function-based derivations');
  });
});

describe('ElementInspector.svelte: panel styling', () => {
  it('has fixed width around 300px', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('300px'), 'Panel must have ~300px width');
  });

  it('uses monospace font for values', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('monospace'), 'Must use monospace font for values');
  });
});
