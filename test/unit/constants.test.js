const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CLI_PROVIDERS, DEFAULT_ENDPOINTS } = require('../../electron/constants');

describe('electron/constants', () => {
    it('exports CLI_PROVIDERS as a non-empty array', () => {
        assert.ok(Array.isArray(CLI_PROVIDERS));
        assert.ok(CLI_PROVIDERS.length > 0);
    });

    it('CLI_PROVIDERS contains only strings', () => {
        for (const p of CLI_PROVIDERS) {
            assert.equal(typeof p, 'string');
        }
    });

    it('CLI_PROVIDERS has no duplicates', () => {
        const unique = new Set(CLI_PROVIDERS);
        assert.equal(unique.size, CLI_PROVIDERS.length);
    });

    it('exports DEFAULT_ENDPOINTS as a non-empty object', () => {
        assert.equal(typeof DEFAULT_ENDPOINTS, 'object');
        assert.ok(Object.keys(DEFAULT_ENDPOINTS).length > 0);
    });

    it('DEFAULT_ENDPOINTS values are valid http(s) URLs', () => {
        for (const [key, url] of Object.entries(DEFAULT_ENDPOINTS)) {
            assert.ok(
                url.startsWith('http://') || url.startsWith('https://'),
                `${key} endpoint "${url}" is not a valid http(s) URL`
            );
            // Should parse without throwing
            new URL(url);
        }
    });

    it('DEFAULT_ENDPOINTS keys are all strings', () => {
        for (const key of Object.keys(DEFAULT_ENDPOINTS)) {
            assert.equal(typeof key, 'string');
        }
    });
});
