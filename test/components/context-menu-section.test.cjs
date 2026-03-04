const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/settings/appearance/ContextMenuSection.svelte'), 'utf8'
);

describe('ContextMenuSection', () => {
  describe('structure', () => {
    it('is a section with heading "Context Menus"', () => {
      assert.match(src, /<section/);
      assert.match(src, /Context Menus/);
    });

    it('imports CONTEXT_MENU_PRESETS and applyContextMenuPreset', () => {
      assert.match(src, /CONTEXT_MENU_PRESETS/);
      assert.match(src, /applyContextMenuPreset/);
    });

    it('imports Slider component for custom overrides', () => {
      assert.match(src, /import\s+Slider/);
    });
  });

  describe('preset picker', () => {
    it('renders preset cards with click handler', () => {
      assert.match(src, /ctx-preset-card/);
      assert.match(src, /onclick/);
    });

    it('has active class binding for selected preset', () => {
      assert.match(src, /class:active/);
    });
  });

  describe('live preview', () => {
    it('renders a fake context menu with sample items', () => {
      assert.match(src, /Cut/);
      assert.match(src, /Copy/);
      assert.match(src, /Paste/);
      assert.match(src, /Delete/);
    });

    it('preview uses context-menu classes', () => {
      assert.match(src, /context-menu-item/);
      assert.match(src, /context-menu-divider/);
    });

    it('preview shows a danger item', () => {
      assert.match(src, /danger/);
    });
  });

  describe('customize controls', () => {
    it('has a collapsible customize section', () => {
      assert.match(src, /Customize/i);
    });

    it('has sliders for border radius, item padding, font size, item radius', () => {
      assert.match(src, /Border Radius/);
      assert.match(src, /Item Padding/);
      assert.match(src, /Font Size/);
      assert.match(src, /Item Radius/);
    });

    it('has a shadow selector', () => {
      assert.match(src, /Shadow/);
    });
  });

  describe('bindable props', () => {
    it('uses $bindable for selectedCtxPreset', () => {
      assert.match(src, /selectedCtxPreset\s*=\s*\$bindable/);
    });

    it('uses $bindable for ctxOverrides', () => {
      assert.match(src, /ctxOverrides\s*=\s*\$bindable/);
    });

    it('uses $bindable for ctxCustomize', () => {
      assert.match(src, /ctxCustomize\s*=\s*\$bindable/);
    });
  });
});
