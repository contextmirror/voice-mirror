const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DevicePickerMenu.svelte'),
  'utf-8'
);

describe('DevicePickerMenu.svelte: manufacturer-based grouping', () => {
  it('imports MANUFACTURERS from device-presets', () => {
    assert.ok(src.includes('MANUFACTURERS'), 'Should import MANUFACTURERS');
  });

  it('imports getPresetsByManufacturer', () => {
    assert.ok(src.includes('getPresetsByManufacturer'), 'Should import getPresetsByManufacturer');
  });

  it('imports getPopularPresets', () => {
    assert.ok(src.includes('getPopularPresets'), 'Should import getPopularPresets');
  });

  it('imports devicePreviewStore', () => {
    assert.ok(src.includes('devicePreviewStore'), 'should import devicePreviewStore');
  });
});

describe('DevicePickerMenu.svelte: search filter', () => {
  it('has a search input', () => {
    assert.ok(src.includes('search') && src.includes('<input'), 'Should have search input');
  });

  it('filters devices by search query', () => {
    assert.ok(
      src.includes('.filter') && src.includes('search'),
      'Should filter presets by search term'
    );
  });
});

describe('DevicePickerMenu.svelte: popular section', () => {
  it('has a Popular section', () => {
    assert.ok(src.includes('Popular') && src.includes('popular'), 'Should have Popular section');
  });
});

describe('DevicePickerMenu.svelte: collapsible sections', () => {
  it('tracks collapsed state per manufacturer', () => {
    assert.ok(src.includes('collapsed'), 'Should track collapse state');
  });

  it('has toggle click handler on manufacturer headers', () => {
    assert.ok(src.includes('toggleSection') || src.includes('toggle'), 'Should toggle sections');
  });

  it('has chevron indicator for collapse state', () => {
    assert.ok(src.includes('▸') || src.includes('▾') || src.includes('chevron'), 'Should show collapse indicator');
  });
});

describe('DevicePickerMenu.svelte: manufacturer icons', () => {
  it('renders manufacturer icon via {@html}', () => {
    assert.ok(src.includes('{@html') && src.includes('icon'), 'Should render icon with {@html}');
  });
});

describe('DevicePickerMenu.svelte: phone/tablet sub-groups', () => {
  it('shows sub-type labels when manufacturer has both', () => {
    assert.ok(
      (src.includes('Phones') || src.includes('phones')) && (src.includes('Tablets') || src.includes('tablets')),
      'Should distinguish phones and tablets within manufacturer'
    );
  });
});

describe('DevicePickerMenu.svelte: props', () => {
  it('has onClose prop', () => {
    assert.ok(src.includes('onClose'), 'should have onClose prop');
  });

  it('has anchorRect prop', () => {
    assert.ok(src.includes('anchorRect'), 'should have anchorRect prop');
  });
});

describe('DevicePickerMenu.svelte: template structure', () => {
  it('has picker-menu class for the menu container', () => {
    assert.ok(src.includes('picker-menu'), 'should have .picker-menu class');
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

  it('has backdrop for closing', () => {
    assert.ok(src.includes('backdrop'), 'should have backdrop for dismissing');
  });
});

describe('DevicePickerMenu.svelte: behavior', () => {
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

describe('DevicePickerMenu.svelte: styling', () => {
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

// Verify DevicePreview.svelte uses new type field instead of category
const previewSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DevicePreview.svelte'),
  'utf-8'
);

describe('DevicePreview.svelte: uses new type field', () => {
  it('uses preset.type for phone detection', () => {
    assert.ok(previewSrc.includes("preset.type === 'phone'"), 'Should use type field for phone detection');
  });

  it('uses preset.type for tablet detection', () => {
    assert.ok(previewSrc.includes("preset.type === 'tablet'"), 'Should use type field for tablet detection');
  });

  it('does not use old category-based detection', () => {
    assert.ok(!previewSrc.includes("preset.category === 'iPhone'"), 'Should not use category for iPhone');
    assert.ok(!previewSrc.includes("preset.category === 'iPad'"), 'Should not use category for iPad');
    assert.ok(!previewSrc.includes("preset.category === 'Android Phone'"), 'Should not use category for Android Phone');
    assert.ok(!previewSrc.includes("preset.category === 'Android Tablet'"), 'Should not use category for Android Tablet');
  });
});
