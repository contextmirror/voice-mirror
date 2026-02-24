const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiSrc = fs.readFileSync(
    path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);

describe('Dev Server API -- parameter passing', () => {
    it('passes projectRoot parameter', () => {
        assert.ok(apiSrc.includes('{ projectRoot }'));
    });
    it('passes port parameter', () => {
        assert.ok(apiSrc.includes('{ port }'));
    });
});
