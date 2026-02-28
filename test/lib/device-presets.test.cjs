const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/device-presets.js'),
  'utf-8'
);

describe('device-presets.js: manufacturer-based structure', () => {
  it('exports MANUFACTURERS array', () => {
    assert.ok(src.includes('export const MANUFACTURERS'), 'Should export MANUFACTURERS');
  });

  it('has all 6 manufacturers', () => {
    for (const m of ['Apple', 'Samsung', 'Google', 'Motorola', 'OnePlus', 'Xiaomi']) {
      assert.ok(src.includes(`'${m}'`) || src.includes(`"${m}"`), `Should have manufacturer ${m}`);
    }
  });

  it('each manufacturer has an icon SVG string', () => {
    assert.ok(src.includes('icon:') || src.includes('icon :'), 'MANUFACTURERS entries should have icon field');
    const iconMatches = src.match(/<svg/g) || [];
    assert.ok(iconMatches.length >= 6, `Should have at least 6 SVG icons, found ${iconMatches.length}`);
  });

  it('presets have manufacturer field instead of category', () => {
    assert.ok(src.includes("manufacturer: 'apple'"), 'Should have apple manufacturer');
    assert.ok(src.includes("manufacturer: 'samsung'"), 'Should have samsung manufacturer');
    assert.ok(src.includes("manufacturer: 'google'"), 'Should have google manufacturer');
  });

  it('presets have type field (phone or tablet)', () => {
    assert.ok(src.includes("type: 'phone'"), 'Should have phone type');
    assert.ok(src.includes("type: 'tablet'"), 'Should have tablet type');
  });

  it('has popular flag on select devices', () => {
    assert.ok(src.includes('popular: true'), 'Some devices should be marked popular');
  });

  it('still exports DEVICE_CATEGORIES for backward compat', () => {
    assert.ok(src.includes('export const DEVICE_CATEGORIES'), 'Should still export DEVICE_CATEGORIES');
  });

  it('still exports getPresetById and getPresetsByCategory', () => {
    assert.ok(src.includes('export function getPresetById'), 'Should export getPresetById');
    assert.ok(src.includes('export function getPresetsByCategory'), 'Should export getPresetsByCategory');
  });

  it('exports getPresetsByManufacturer helper', () => {
    assert.ok(src.includes('export function getPresetsByManufacturer'), 'Should export getPresetsByManufacturer');
  });

  it('exports getPopularPresets helper', () => {
    assert.ok(src.includes('export function getPopularPresets'), 'Should export getPopularPresets');
  });
});

describe('device-presets.js: new devices', () => {
  it('has iPhone 13', () => {
    assert.ok(src.includes('iphone-13'), 'Should have iPhone 13');
  });

  it('has Galaxy S25 and S25 Ultra', () => {
    assert.ok(src.includes("id: 'galaxy-s25'"), 'Should have Galaxy S25');
    assert.ok(src.includes('galaxy-s25-ultra'), 'Should have Galaxy S25 Ultra');
  });

  it('has Galaxy A series (A54, A15)', () => {
    assert.ok(src.includes('galaxy-a54'), 'Should have Galaxy A54');
    assert.ok(src.includes('galaxy-a15'), 'Should have Galaxy A15');
  });

  it('has Pixel 9 series', () => {
    assert.ok(src.includes("id: 'pixel-9'"), 'Should have Pixel 9');
    assert.ok(src.includes('pixel-9-pro'), 'Should have Pixel 9 Pro');
  });

  it('has OnePlus devices', () => {
    assert.ok(src.includes('oneplus-12'), 'Should have OnePlus 12');
    assert.ok(src.includes('oneplus-nord'), 'Should have OnePlus Nord');
  });

  it('has Xiaomi devices', () => {
    assert.ok(src.includes('redmi-note-13'), 'Should have Redmi Note 13');
  });

  it('has at least 38 total devices', () => {
    const idMatches = src.match(/id:\s*'/g) || [];
    assert.ok(idMatches.length >= 38, `Should have at least 38 devices, found ${idMatches.length}`);
  });
});
