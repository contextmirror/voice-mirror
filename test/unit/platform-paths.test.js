const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getDataDir, getConfigBase, getConfigPath, getMemoryDir } = require('../../mcp-server/lib/memory/utils');

describe('platform-paths (utils.js exports)', () => {
    it('getDataDir() returns a string containing voice-mirror-electron', () => {
        const dir = getDataDir();
        assert.strictEqual(typeof dir, 'string');
        assert.ok(dir.includes('voice-mirror-electron'), `Expected path to contain "voice-mirror-electron", got: ${dir}`);
    });

    it('getConfigBase() returns a non-empty string', () => {
        const base = getConfigBase();
        assert.strictEqual(typeof base, 'string');
        assert.ok(base.length > 0, 'getConfigBase() should return a non-empty string');
    });

    it('getConfigPath() ends with config.json', () => {
        const p = getConfigPath();
        assert.ok(p.endsWith('config.json'), `Expected path ending with config.json, got: ${p}`);
    });

    it('getMemoryDir() returns a string containing memory', () => {
        const dir = getMemoryDir();
        assert.strictEqual(typeof dir, 'string');
        assert.ok(dir.includes('memory'), `Expected path to contain "memory", got: ${dir}`);
    });

    if (process.platform === 'win32') {
        it('Windows: paths contain AppData or backslash separator', () => {
            const dir = getDataDir();
            const base = getConfigBase();
            // On Windows APPDATA is typically set; paths use backslash
            assert.ok(
                dir.includes('AppData') || dir.includes('\\'),
                `Expected Windows-style path, got: ${dir}`
            );
            assert.ok(
                base.includes('AppData') || base.includes('\\'),
                `Expected Windows-style config base, got: ${base}`
            );
        });
    }

    if (process.platform === 'linux') {
        it('Linux: paths contain .config', () => {
            const dir = getDataDir();
            assert.ok(dir.includes('.config'), `Expected Linux path with .config, got: ${dir}`);
        });
    }
});
