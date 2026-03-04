const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/lib/context-menu-presets.js'), 'utf8'
);

describe('context-menu-presets', () => {
  describe('exports', () => {
    it('exports CONTEXT_MENU_PRESETS', () => {
      assert.match(src, /export\s+const\s+CONTEXT_MENU_PRESETS/);
    });

    it('exports DEFAULT_CONTEXT_MENU_PRESET', () => {
      assert.match(src, /export\s+const\s+DEFAULT_CONTEXT_MENU_PRESET/);
    });

    it('exports applyContextMenuPreset function', () => {
      assert.match(src, /export\s+function\s+applyContextMenuPreset/);
    });
  });

  describe('CONTEXT_MENU_PRESETS', () => {
    it('has 4 presets: default, rounded, compact, flat', () => {
      assert.match(src, /default:\s*\{/);
      assert.match(src, /rounded:\s*\{/);
      assert.match(src, /compact:\s*\{/);
      assert.match(src, /flat:\s*\{/);
    });

    it('each preset has required keys', () => {
      const requiredKeys = ['id', 'name', 'menuRadius', 'itemRadius', 'itemPadding', 'fontSize', 'shadow', 'dividerMargin'];
      for (const key of requiredKeys) {
        const matches = src.match(new RegExp(`${key}:`, 'g'));
        assert.ok(matches && matches.length >= 4, `key "${key}" should appear in all 4 presets`);
      }
    });
  });

  describe('applyContextMenuPreset', () => {
    it('sets CSS custom properties on document.documentElement', () => {
      assert.match(src, /documentElement/);
      assert.match(src, /--ctx-menu-radius/);
      assert.match(src, /--ctx-item-padding/);
      assert.match(src, /--ctx-item-font-size/);
      assert.match(src, /--ctx-item-radius/);
      assert.match(src, /--ctx-menu-shadow/);
      assert.match(src, /--ctx-divider-margin/);
      assert.match(src, /--ctx-menu-padding/);
    });
  });
});
