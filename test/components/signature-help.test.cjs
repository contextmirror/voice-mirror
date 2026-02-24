/**
 * signature-help.test.js -- Source-inspection tests for SignatureHelp.svelte
 *
 * Validates the signature help tooltip component for LSP parameter hints.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../src/components/lens/SignatureHelp.svelte');
const src = fs.readFileSync(filePath, 'utf-8');

describe('SignatureHelp.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0);
  });

  // ── Props ──

  it('accepts visible prop via $props()', () => {
    assert.ok(src.includes('visible'), 'Should have visible prop');
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });

  it('accepts data prop', () => {
    assert.ok(src.includes('data'), 'Should have data prop');
  });

  it('accepts cursorX and cursorY props', () => {
    assert.ok(src.includes('cursorX'), 'Should have cursorX prop');
    assert.ok(src.includes('cursorY'), 'Should have cursorY prop');
  });

  it('accepts onDismiss callback', () => {
    assert.ok(src.includes('onDismiss'), 'Should have onDismiss prop');
  });

  // ── Rendering ──

  it('has signature-help container class', () => {
    assert.ok(src.includes('signature-help'), 'Should have signature-help class');
  });

  it('highlights active parameter', () => {
    assert.ok(src.includes('active-param'), 'Should have active-param class');
  });

  it('shows parameter documentation', () => {
    assert.ok(src.includes('param-doc'), 'Should have param-doc class');
  });

  it('shows signature count for overloads', () => {
    assert.ok(src.includes('signature-count'), 'Should have signature-count class');
  });

  it('handles offset tuple parameter labels', () => {
    assert.ok(src.includes('Array.isArray(paramLabel)'), 'Should handle offset tuple labels');
  });

  it('handles string parameter labels', () => {
    assert.ok(src.includes('label.indexOf(paramLabel)') || src.includes("typeof paramLabel === 'string'"), 'Should handle string labels');
  });

  it('derives active signature from data', () => {
    assert.ok(src.includes('activeSignature'), 'Should derive activeSignature');
  });

  it('derives active parameter index', () => {
    assert.ok(src.includes('activeParamIndex') || src.includes('activeParameter'), 'Should derive active parameter index');
  });

  // ── Interaction ──

  it('handles Escape key to dismiss', () => {
    assert.ok(src.includes("'Escape'"), 'Should handle Escape key');
  });

  it('uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'), 'Should use fixed positioning');
  });

  it('uses z-index 10003', () => {
    assert.ok(src.includes('10003'), 'Should use z-index 10003');
  });

  it('uses pointer-events: none', () => {
    assert.ok(src.includes('pointer-events: none'), 'Should not steal focus from editor');
  });

  // ── Styles ──

  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped style block');
  });

  it('uses --bg-elevated for background', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated');
  });

  it('uses --accent for active parameter', () => {
    assert.ok(src.includes('var(--accent)'), 'Should use accent for active param');
  });

  it('uses --font-mono for signature text', () => {
    assert.ok(src.includes('var(--font-mono)'), 'Should use monospace font');
  });

  it('uses --border for borders', () => {
    assert.ok(src.includes('var(--border)'), 'Should use --border variable');
  });

  it('uses --muted for documentation text', () => {
    assert.ok(src.includes('var(--muted)'), 'Should use --muted for docs');
  });

  it('has -webkit-app-region: no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });

  it('uses role="tooltip" for accessibility', () => {
    assert.ok(src.includes('role="tooltip"'), 'Should have tooltip role');
  });
});
