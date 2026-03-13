const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/ConsolePanel.svelte'),
  'utf-8'
);

describe('ConsolePanel.svelte: structure', () => {
  it('has role="complementary" on panel', () => {
    assert.ok(src.includes('role="complementary"'));
  });

  it('has a close button with aria-label', () => {
    assert.ok(src.includes('aria-label="Close console"'));
  });

  it('has a clear button with aria-label', () => {
    assert.ok(src.includes('aria-label="Clear console"'));
  });

  it('has Console title', () => {
    assert.ok(src.includes('Console'));
  });
});

describe('ConsolePanel.svelte: message rendering', () => {
  it('renders message level', () => {
    assert.ok(src.includes('msg.level'));
  });

  it('renders message text', () => {
    assert.ok(src.includes('msg.message'));
  });

  it('has level-based CSS classes', () => {
    assert.ok(src.includes("'error'"), 'Must have error class');
    assert.ok(src.includes("'warn'"), 'Must have warn class');
    assert.ok(src.includes("'debug'"), 'Must have debug class');
  });

  it('shows empty state when no messages', () => {
    assert.ok(src.includes('No console output'));
  });
});

describe('ConsolePanel.svelte: theming', () => {
  it('uses CSS variables for theming', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('var(--bg'), 'Must use --bg');
    assert.ok(styleBlock.includes('var(--text'), 'Must use --text');
    assert.ok(styleBlock.includes('var(--border'), 'Must use --border');
  });

  it('uses monospace font for messages', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('monospace'));
  });
});

describe('ConsolePanel.svelte: auto-scroll', () => {
  it('has auto-scroll behavior', () => {
    assert.ok(src.includes('scrollTop') || src.includes('scrollHeight'));
  });
});

describe('ConsolePanel.svelte: props', () => {
  it('accepts messages, onClose, onClear props', () => {
    assert.ok(src.includes('messages'));
    assert.ok(src.includes('onClose'));
    assert.ok(src.includes('onClear'));
  });
});
