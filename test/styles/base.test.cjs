/**
 * base.test.cjs -- Source-inspection tests for base.css
 *
 * Validates global scrollbar styling and reset rules.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/styles/base.css'),
  'utf-8'
);

describe('base.css: global scrollbar styling', () => {
  it('has 14px wide scrollbar', () => {
    assert.ok(src.includes('width: 14px'), 'Should have 14px scrollbar width');
    assert.ok(src.includes('height: 14px'), 'Should have 14px scrollbar height');
  });

  it('has transparent track', () => {
    const trackSection = src.substring(src.indexOf('::-webkit-scrollbar-track'));
    assert.ok(trackSection.includes('background: transparent'), 'Track should be transparent');
  });

  it('has semi-transparent thumb using color-mix', () => {
    assert.ok(
      src.includes('color-mix(in srgb, var(--text) 20%, transparent)'),
      'Thumb should use 20% text color'
    );
  });

  it('has hover state on thumb', () => {
    assert.ok(
      src.includes('color-mix(in srgb, var(--text) 35%, transparent)'),
      'Thumb hover should use 35% text color'
    );
  });

  it('uses padding-box clip for inset thumb appearance', () => {
    assert.ok(src.includes('background-clip: padding-box'), 'Should use padding-box clip');
  });

  it('has 3px transparent border for thumb inset', () => {
    assert.ok(src.includes('border: 3px solid transparent'), 'Should have 3px transparent border');
  });

  it('has 7px border-radius on thumb', () => {
    assert.ok(src.includes('border-radius: 7px'), 'Should have 7px radius');
  });

  it('has transparent scrollbar corner', () => {
    assert.ok(src.includes('::-webkit-scrollbar-corner'), 'Should style corner');
  });
});

describe('base.css: global reset', () => {
  it('has scroll-behavior: smooth on all elements', () => {
    assert.ok(src.includes('scroll-behavior: smooth'), 'Should have smooth scrolling globally');
  });

  it('has box-sizing: border-box reset', () => {
    assert.ok(src.includes('box-sizing: border-box'), 'Should reset box-sizing');
  });
});
