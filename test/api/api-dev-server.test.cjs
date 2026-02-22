const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiSrc = fs.readFileSync(
    path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);

describe('Dev Server API', () => {
    it('exports detectDevServers', () => {
        assert.ok(apiSrc.includes('export async function detectDevServers'));
    });
    it('invokes detect_dev_servers command', () => {
        assert.ok(apiSrc.includes("invoke('detect_dev_servers'"));
    });
    it('exports probePort', () => {
        assert.ok(apiSrc.includes('export async function probePort'));
    });
    it('invokes probe_port command', () => {
        assert.ok(apiSrc.includes("invoke('probe_port'"));
    });
    it('passes projectRoot parameter', () => {
        assert.ok(apiSrc.includes('{ projectRoot }'));
    });
    it('passes port parameter', () => {
        assert.ok(apiSrc.includes('{ port }'));
    });
    it('has Dev Server section comment', () => {
        assert.ok(apiSrc.includes('// ============ Dev Server'));
    });
});
