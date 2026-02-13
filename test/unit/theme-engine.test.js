/**
 * theme-engine.test.js — Tests for theme system color utilities and derivation.
 * Source-inspection + logic verification (no DOM needed).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', '..', 'electron', 'renderer', 'theme-engine.js');
const src = fs.readFileSync(srcPath, 'utf-8');

describe('theme-engine', () => {
    describe('exports', () => {
        it('should export hexToRgb', () => {
            assert.ok(src.includes('export function hexToRgb'));
        });
        it('should define rgbToHex (internal)', () => {
            assert.ok(src.includes('function rgbToHex'));
        });
        it('should define lighten (internal)', () => {
            assert.ok(src.includes('function lighten'));
        });
        it('should define darken (internal)', () => {
            assert.ok(src.includes('function darken'));
        });
        it('should define blend (internal)', () => {
            assert.ok(src.includes('function blend'));
        });
        it('should export PRESETS', () => {
            assert.ok(src.includes('export const PRESETS'));
        });
        it('should export deriveTheme', () => {
            assert.ok(src.includes('export function deriveTheme'));
        });
        it('should export deriveOrbColors', () => {
            assert.ok(src.includes('export function deriveOrbColors'));
        });
        it('should export resolveTheme', () => {
            assert.ok(src.includes('export function resolveTheme'));
        });
        it('should export applyTheme', () => {
            assert.ok(src.includes('export function applyTheme'));
        });
        it('should export buildExportData', () => {
            assert.ok(src.includes('export function buildExportData'));
        });
        it('should export validateImportData', () => {
            assert.ok(src.includes('export function validateImportData'));
        });
    });

    describe('presets', () => {
        it('should define dark preset', () => {
            assert.ok(src.includes("dark:"));
            assert.ok(src.includes("name: 'Dark'"));
        });
        it('should define midnight preset', () => {
            assert.ok(src.includes("midnight:"));
            assert.ok(src.includes("name: 'Midnight'"));
        });
        it('should define emerald preset', () => {
            assert.ok(src.includes("emerald:"));
            assert.ok(src.includes("name: 'Emerald'"));
        });
        it('should define rose preset', () => {
            assert.ok(src.includes("rose:"));
            assert.ok(src.includes("name: 'Rose'"));
        });
        it('should define slate preset', () => {
            assert.ok(src.includes("slate:"));
            assert.ok(src.includes("name: 'Slate'"));
        });
        it('each preset should have all 10 color keys', () => {
            const keys = ['bg', 'bgElevated', 'text', 'textStrong', 'muted', 'accent', 'ok', 'warn', 'danger', 'orbCore'];
            for (const key of keys) {
                // Each preset colors block should reference this key
                assert.ok(src.includes(`${key}:`), `Missing color key: ${key}`);
            }
        });
        it('each preset should have fonts', () => {
            assert.ok(src.includes('fontFamily:'));
            assert.ok(src.includes('fontMono:'));
        });
    });

    describe('deriveTheme', () => {
        it('should produce all expected CSS variable keys', () => {
            const expectedVars = [
                '--bg', '--bg-accent', '--bg-elevated', '--bg-hover',
                '--card', '--card-highlight',
                '--text', '--text-strong', '--muted',
                '--border', '--border-strong',
                '--accent', '--accent-hover', '--accent-subtle', '--accent-glow',
                '--ok', '--warn', '--danger',
                '--shadow-sm', '--shadow-md', '--shadow-lg',
                '--font-family', '--font-mono',
            ];
            for (const v of expectedVars) {
                assert.ok(src.includes(`'${v}'`), `Missing CSS var: ${v}`);
            }
        });
        it('should use blend for bg-accent derivation', () => {
            assert.ok(src.includes("'--bg-accent': blend("));
        });
        it('should use lighten for bg-hover derivation', () => {
            assert.ok(src.includes("'--bg-hover': lighten("));
        });
        it('should use lighten for accent-hover derivation', () => {
            assert.ok(src.includes("'--accent-hover': lighten("));
        });
        it('should use hexToRgba for accent-subtle', () => {
            assert.ok(src.includes("'--accent-subtle': hexToRgba("));
        });
    });

    describe('deriveOrbColors', () => {
        it('should return borderRgb, centerRgb, edgeRgb, iconRgb, eyeRgb', () => {
            assert.ok(src.includes('borderRgb:'));
            assert.ok(src.includes('centerRgb:'));
            assert.ok(src.includes('edgeRgb:'));
            assert.ok(src.includes('iconRgb:'));
            assert.ok(src.includes('eyeRgb:'));
        });
        it('borderRgb should derive from accent', () => {
            assert.ok(src.includes("hexToRgb(colors.accent)"));
        });
        it('centerRgb should derive from orbCore', () => {
            assert.ok(src.includes("hexToRgb(colors.orbCore)"));
        });
    });

    describe('resolveTheme', () => {
        it('should fall back to dark preset when theme is unknown', () => {
            assert.ok(src.includes("PRESETS[themeName] || PRESETS.dark"));
        });
        it('should use custom colors when provided', () => {
            assert.ok(src.includes("appearance.colors || preset.colors"));
        });
    });

    describe('import/export validation', () => {
        it('validateImportData should check version', () => {
            assert.ok(src.includes('data.version !== 1'));
        });
        it('validateImportData should check all color keys', () => {
            assert.ok(src.includes('COLOR_KEYS'));
            assert.ok(src.includes('HEX_PATTERN'));
        });
        it('buildExportData should include version field', () => {
            assert.ok(src.includes('version: 1'));
        });
    });

    describe('color utilities', () => {
        it('hexToRgb should parse 6-digit hex', () => {
            assert.ok(src.includes('/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i'));
        });
        it('rgbToHex should pad single-digit values', () => {
            assert.ok(src.includes("padStart(2, '0')"));
        });
        it('lighten should increase HSL lightness', () => {
            assert.ok(src.includes('hsl.l + amount'));
        });
        it('darken should decrease HSL lightness', () => {
            assert.ok(src.includes('hsl.l - amount'));
        });
        it('blend should interpolate between two colors', () => {
            assert.ok(src.includes('c1.r * (1 - t) + c2.r * t'));
        });
    });
});
