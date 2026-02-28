import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEVICE_CATEGORIES,
    DEVICE_PRESETS,
    getPresetById,
    getPresetsByCategory
} from '../../src/lib/device-presets.js';

describe('device-presets', () => {
    describe('DEVICE_CATEGORIES', () => {
        it('is an array with at least 4 categories', () => {
            assert.ok(Array.isArray(DEVICE_CATEGORIES));
            assert.ok(DEVICE_CATEGORIES.length >= 4, `Expected 4+ categories, got ${DEVICE_CATEGORIES.length}`);
        });

        it('contains expected category strings', () => {
            const expected = ['iPhone', 'iPad', 'Android Phone', 'Android Tablet'];
            for (const cat of expected) {
                assert.ok(DEVICE_CATEGORIES.includes(cat), `Missing category: ${cat}`);
            }
        });
    });

    describe('DEVICE_PRESETS', () => {
        it('is an array with at least 23 presets', () => {
            assert.ok(Array.isArray(DEVICE_PRESETS));
            assert.ok(DEVICE_PRESETS.length >= 23, `Expected 23+ presets, got ${DEVICE_PRESETS.length}`);
        });

        it('every preset has all required fields with valid values', () => {
            for (const preset of DEVICE_PRESETS) {
                assert.ok(typeof preset.id === 'string' && preset.id.length > 0, `Invalid id: ${preset.id}`);
                assert.ok(typeof preset.name === 'string' && preset.name.length > 0, `Invalid name: ${preset.name}`);
                assert.ok(typeof preset.category === 'string' && preset.category.length > 0, `Invalid category for ${preset.id}`);
                assert.ok(typeof preset.width === 'number' && preset.width > 0, `Invalid width for ${preset.id}: ${preset.width}`);
                assert.ok(typeof preset.height === 'number' && preset.height > 0, `Invalid height for ${preset.id}: ${preset.height}`);
                assert.ok(typeof preset.dpr === 'number' && preset.dpr > 0, `Invalid dpr for ${preset.id}: ${preset.dpr}`);
                assert.ok(typeof preset.userAgent === 'string', `userAgent must be a string for ${preset.id}`);
            }
        });

        it('every preset category is a valid DEVICE_CATEGORIES entry', () => {
            for (const preset of DEVICE_PRESETS) {
                assert.ok(
                    DEVICE_CATEGORIES.includes(preset.category),
                    `Preset "${preset.id}" has unknown category "${preset.category}"`
                );
            }
        });

        it('all preset IDs are unique', () => {
            const ids = DEVICE_PRESETS.map(p => p.id);
            const uniqueIds = new Set(ids);
            assert.equal(uniqueIds.size, ids.length, `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
        });
    });

    describe('getPresetById', () => {
        it('is a function', () => {
            assert.equal(typeof getPresetById, 'function');
        });

        it('returns correct preset for iphone-15', () => {
            const preset = getPresetById('iphone-15');
            assert.ok(preset !== null, 'Expected preset, got null');
            assert.equal(preset.name, 'iPhone 15');
            assert.equal(preset.width, 393);
            assert.equal(preset.height, 852);
        });

        it('returns null for nonexistent id', () => {
            const result = getPresetById('nonexistent');
            assert.equal(result, null);
        });
    });

    describe('getPresetsByCategory', () => {
        it('is a function', () => {
            assert.equal(typeof getPresetsByCategory, 'function');
        });

        it('returns 8+ iPhones, all with category iPhone', () => {
            const iphones = getPresetsByCategory('iPhone');
            assert.ok(iphones.length >= 8, `Expected 8+ iPhones, got ${iphones.length}`);
            for (const p of iphones) {
                assert.equal(p.category, 'iPhone');
            }
        });

        it('returns empty array for unknown category', () => {
            const result = getPresetsByCategory('Nonexistent');
            assert.ok(Array.isArray(result));
            assert.equal(result.length, 0);
        });
    });

    describe('category coverage', () => {
        it('has at least 8 iPhone presets', () => {
            const count = DEVICE_PRESETS.filter(p => p.category === 'iPhone').length;
            assert.ok(count >= 8, `Expected 8+ iPhone presets, got ${count}`);
        });

        it('has at least 4 iPad presets', () => {
            const count = DEVICE_PRESETS.filter(p => p.category === 'iPad').length;
            assert.ok(count >= 4, `Expected 4+ iPad presets, got ${count}`);
        });

        it('has at least 4 Android Phone presets', () => {
            const count = DEVICE_PRESETS.filter(p => p.category === 'Android Phone').length;
            assert.ok(count >= 4, `Expected 4+ Android Phone presets, got ${count}`);
        });

        it('has at least 2 Android Tablet presets', () => {
            const count = DEVICE_PRESETS.filter(p => p.category === 'Android Tablet').length;
            assert.ok(count >= 2, `Expected 2+ Android Tablet presets, got ${count}`);
        });

    });
});
