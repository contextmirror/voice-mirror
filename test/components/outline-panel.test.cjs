const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/OutlinePanel.svelte'), 'utf-8');

describe('OutlinePanel.svelte: imports', () => {
  it('imports lspRequestDocumentSymbols from api', () => {
    assert.ok(src.includes('lspRequestDocumentSymbols'), 'Should import lspRequestDocumentSymbols');
    assert.ok(src.includes("from '../../lib/api.js'"), 'Should import from api.js');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });
});

describe('OutlinePanel.svelte: props', () => {
  it('accepts filePath prop', () => {
    assert.ok(src.includes('filePath'), 'Should have filePath prop');
  });

  it('accepts hasLsp prop', () => {
    assert.ok(src.includes('hasLsp'), 'Should have hasLsp prop');
  });

  it('accepts onSymbolClick prop', () => {
    assert.ok(src.includes('onSymbolClick'), 'Should have onSymbolClick prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });
});

describe('OutlinePanel.svelte: state', () => {
  it('has symbols state', () => {
    assert.ok(src.includes('symbols = $state('), 'Should have symbols state');
  });

  it('has loading state', () => {
    assert.ok(src.includes('loading = $state('), 'Should have loading state');
  });
});

describe('OutlinePanel.svelte: symbol kinds', () => {
  it('has SYMBOL_KINDS mapping', () => {
    assert.ok(src.includes('SYMBOL_KINDS'), 'Should have SYMBOL_KINDS');
  });

  it('has symbolIcon function', () => {
    assert.ok(src.includes('symbolIcon'), 'Should have symbolIcon function');
  });

  it('maps class/struct to C', () => {
    assert.ok(src.includes("5: 'C'"), 'Should map class to C');
    assert.ok(src.includes("23: 'C'"), 'Should map struct to C');
  });

  it('maps method/function to F', () => {
    assert.ok(src.includes("6: 'F'"), 'Should map method to F');
    assert.ok(src.includes("12: 'F'"), 'Should map function to F');
  });

  it('maps variable/constant to V', () => {
    assert.ok(src.includes("13: 'V'"), 'Should map variable to V');
    assert.ok(src.includes("14: 'V'"), 'Should map constant to V');
  });

  it('maps enum to E', () => {
    assert.ok(src.includes("10: 'E'"), 'Should map enum to E');
  });

  it('maps interface to I', () => {
    assert.ok(src.includes("11: 'I'"), 'Should map interface to I');
  });

  it('maps type parameter to T', () => {
    assert.ok(src.includes("26: 'T'"), 'Should map type parameter to T');
  });
});

describe('OutlinePanel.svelte: rendering', () => {
  it('has outline-panel class', () => {
    assert.ok(src.includes('outline-panel'), 'Should have outline-panel class');
  });

  it('has outline-item class', () => {
    assert.ok(src.includes('outline-item'), 'Should have outline-item class');
  });

  it('has symbol-icon class', () => {
    assert.ok(src.includes('symbol-icon'), 'Should have symbol-icon class');
  });

  it('has symbol-name class', () => {
    assert.ok(src.includes('symbol-name'), 'Should have symbol-name class');
  });

  it('has symbol-detail class', () => {
    assert.ok(src.includes('symbol-detail'), 'Should have symbol-detail class');
  });

  it('renders children recursively with snippet', () => {
    assert.ok(src.includes('symbolNode'), 'Should have symbolNode snippet');
    assert.ok(src.includes('symbol.children'), 'Should handle children');
    assert.ok(src.includes('depth + 1'), 'Should recurse with incremented depth');
  });

  it('shows empty state when no symbols', () => {
    assert.ok(src.includes('No symbols found'), 'Should show empty state');
  });

  it('shows loading state', () => {
    assert.ok(src.includes('Loading'), 'Should show loading state');
  });

  it('shows no LSP message', () => {
    assert.ok(src.includes('No LSP available'), 'Should show no LSP message');
  });
});

describe('OutlinePanel.svelte: behavior', () => {
  it('calls onSymbolClick on click', () => {
    assert.ok(src.includes('onSymbolClick'), 'Should call onSymbolClick');
  });

  it('fetches symbols via $effect', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect');
    assert.ok(src.includes('fetchSymbols'), 'Should call fetchSymbols');
  });

  it('uses selectionRange or range for navigation', () => {
    assert.ok(src.includes('selectionRange') || src.includes('symbol.range'), 'Should use range for navigation');
  });
});

describe('OutlinePanel.svelte: styles', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have style block');
  });

  it('uses CSS variables for theming', () => {
    assert.ok(src.includes('var(--text)'), 'Should use --text');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted');
    assert.ok(src.includes('var(--accent)'), 'Should use --accent');
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });
});
