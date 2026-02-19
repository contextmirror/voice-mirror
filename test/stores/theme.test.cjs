/**
 * theme.test.js -- Source-inspection tests for tauri/src/lib/stores/theme.svelte.js
 *
 * Since this is a .svelte.js file that uses $state (Svelte 5 runes),
 * it cannot be directly imported in Node.js. We read the source text
 * and assert on expected patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/theme.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('theme.svelte.js -- preset names', () => {
  const presetNames = [
    'colorblind',
    'midnight',
    'emerald',
    'rose',
    'slate',
    'black',
    'gray',
    'light',
  ];

  it('defines PRESETS object', () => {
    assert.ok(src.includes('export const PRESETS'), 'Should export PRESETS');
  });

  for (const name of presetNames) {
    it(`has "${name}" preset`, () => {
      // Match as a key in the PRESETS object (e.g. "colorblind: {")
      const pattern = new RegExp(`${name}:\\s*\\{`);
      assert.ok(pattern.test(src), `PRESETS should contain "${name}" preset`);
    });
  }

  it('has exactly 8 presets', () => {
    // Count top-level keys inside PRESETS by looking for "name:" display names
    // Each preset has a "name:" property with a display string
    const nameMatches = src.match(/^\s+name:\s*'/gm);
    assert.ok(nameMatches, 'Should find preset name entries');
    assert.equal(nameMatches.length, 8, 'Should have exactly 8 presets');
  });
});

describe('theme.svelte.js -- preset color keys', () => {
  const requiredColorKeys = [
    'bg',
    'bgElevated',
    'text',
    'textStrong',
    'muted',
    'accent',
    'ok',
    'warn',
    'danger',
    'orbCore',
  ];

  // Extract each preset block and verify all 10 color keys exist
  const presetNames = ['colorblind', 'midnight', 'emerald', 'rose', 'slate', 'black', 'gray', 'light'];

  for (const preset of presetNames) {
    describe(`"${preset}" preset`, () => {
      // Find the preset block starting from its key
      const presetStart = src.indexOf(`${preset}:`);
      // Grab a generous chunk after the preset key to search within
      const chunk = src.slice(presetStart, presetStart + 500);

      for (const key of requiredColorKeys) {
        it(`has "${key}" color`, () => {
          assert.ok(
            chunk.includes(`${key}:`),
            `"${preset}" preset should have "${key}" color key`
          );
        });
      }
    });
  }
});

describe('theme.svelte.js -- deriveTheme function', () => {
  it('exports deriveTheme', () => {
    assert.ok(
      src.includes('export function deriveTheme'),
      'Should export deriveTheme function'
    );
  });

  it('deriveTheme generates CSS variables', () => {
    // Check that deriveTheme returns an object with CSS custom property keys
    assert.ok(src.includes("'--bg'"), 'Should generate --bg CSS variable');
    assert.ok(src.includes("'--text'"), 'Should generate --text CSS variable');
    assert.ok(src.includes("'--accent'"), 'Should generate --accent CSS variable');
    assert.ok(src.includes("'--ok'"), 'Should generate --ok CSS variable');
    assert.ok(src.includes("'--warn'"), 'Should generate --warn CSS variable');
    assert.ok(src.includes("'--danger'"), 'Should generate --danger CSS variable');
    assert.ok(src.includes("'--border'"), 'Should generate --border CSS variable');
    assert.ok(src.includes("'--shadow-sm'"), 'Should generate --shadow-sm CSS variable');
    assert.ok(src.includes("'--font-family'"), 'Should generate --font-family CSS variable');
  });

  it('handles light vs dark detection', () => {
    assert.ok(src.includes('isLight'), 'Should detect light vs dark background');
  });
});

describe('theme.svelte.js -- color utility functions', () => {
  it('exports hexToRgb', () => {
    assert.ok(
      src.includes('export function hexToRgb'),
      'Should export hexToRgb function'
    );
  });

  it('defines rgbToHex (internal)', () => {
    assert.ok(src.includes('function rgbToHex'), 'Should define rgbToHex');
  });

  it('defines rgbToHsl (internal)', () => {
    assert.ok(src.includes('function rgbToHsl'), 'Should define rgbToHsl');
  });

  it('defines hslToRgb (internal)', () => {
    assert.ok(src.includes('function hslToRgb'), 'Should define hslToRgb');
  });

  it('defines lighten', () => {
    assert.ok(src.includes('function lighten'), 'Should define lighten function');
  });

  it('defines darken', () => {
    assert.ok(src.includes('function darken'), 'Should define darken function');
  });

  it('defines blend', () => {
    assert.ok(src.includes('function blend'), 'Should define blend function');
  });

  it('defines hexToRgba', () => {
    assert.ok(src.includes('function hexToRgba'), 'Should define hexToRgba function');
  });
});

describe('theme.svelte.js -- store exports', () => {
  it('exports currentThemeName', () => {
    assert.ok(
      src.includes('export const currentThemeName'),
      'Should export currentThemeName store'
    );
  });

  it('exports applyTheme', () => {
    assert.ok(
      src.includes('export function applyTheme'),
      'Should export applyTheme function'
    );
  });

  it('exports resolveTheme', () => {
    assert.ok(
      src.includes('export function resolveTheme'),
      'Should export resolveTheme function'
    );
  });

  it('uses $state rune for reactive theme name', () => {
    assert.ok(src.includes("$state('colorblind')"), 'Should use $state with colorblind default');
  });

  it('applyTheme sets CSS variables on document root', () => {
    assert.ok(
      src.includes('document.documentElement') || src.includes('root.style.setProperty'),
      'applyTheme should modify document.documentElement styles'
    );
  });
});
