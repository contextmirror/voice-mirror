const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DevicePickerMenu.svelte'),
  'utf-8'
);

describe('DevicePickerMenu component', () => {
  describe('imports', () => {
    it('imports DEVICE_PRESETS from device-presets.js', () => {
      assert.ok(src.includes('DEVICE_PRESETS'), 'should import DEVICE_PRESETS');
    });

    it('imports DEVICE_CATEGORIES from device-presets.js', () => {
      assert.ok(src.includes('DEVICE_CATEGORIES'), 'should import DEVICE_CATEGORIES');
    });

    it('imports devicePreviewStore', () => {
      assert.ok(src.includes('devicePreviewStore'), 'should import devicePreviewStore');
    });
  });

  describe('props', () => {
    it('has onClose prop', () => {
      assert.ok(src.includes('onClose'), 'should have onClose prop');
    });
  });

  describe('template structure', () => {
    it('has picker-menu class for the menu container', () => {
      assert.ok(src.includes('picker-menu'), 'should have .picker-menu class');
    });

    it('has category-header class for category labels', () => {
      assert.ok(src.includes('category-header'), 'should have .category-header class');
    });

    it('has device-item class for individual device entries', () => {
      assert.ok(src.includes('device-item'), 'should have .device-item class');
    });

    it('has checkbox inputs for multi-select', () => {
      assert.ok(
        src.includes('type="checkbox"') || src.includes("type='checkbox'"),
        'should have checkbox inputs'
      );
    });

    it('shows device dimensions using preset.width and preset.height', () => {
      assert.ok(src.includes('preset.width'), 'should reference preset.width');
      assert.ok(src.includes('preset.height'), 'should reference preset.height');
    });

    it('has backdrop or onClose mechanism for closing', () => {
      assert.ok(
        src.includes('backdrop') || src.includes('onClose'),
        'should have backdrop or onClose for dismissing'
      );
    });
  });

  describe('behavior', () => {
    it('references canAddDevice for disabling items', () => {
      assert.ok(src.includes('canAddDevice'), 'should reference canAddDevice for disable logic');
    });

    it('calls addDevice when checkbox is checked', () => {
      assert.ok(src.includes('addDevice'), 'should call addDevice');
    });

    it('calls removeDevice when checkbox is unchecked', () => {
      assert.ok(src.includes('removeDevice'), 'should call removeDevice');
    });
  });

  describe('styling', () => {
    it('has a <style> block', () => {
      assert.ok(src.includes('<style>'), 'should have a <style> block');
    });

    it('uses CSS variables for theming', () => {
      assert.ok(src.includes('var(--bg-elevated)'), 'should use --bg-elevated');
      assert.ok(src.includes('var(--border)'), 'should use --border');
      assert.ok(src.includes('var(--muted)'), 'should use --muted');
      assert.ok(src.includes('var(--accent)'), 'should use --accent');
    });

    it('opens upward with bottom positioning', () => {
      assert.ok(src.includes('bottom'), 'should reference bottom for upward opening');
    });

    it('uses -webkit-app-region: no-drag for interactivity', () => {
      assert.ok(
        src.includes('-webkit-app-region: no-drag'),
        'should set -webkit-app-region: no-drag'
      );
    });
  });
});
