const { describe, it } = require('node:test');
const assert = require('node:assert');
const { HOME_DATA_DIR, CLAUDE_MESSAGES_PATH } = require('../../mcp-server/paths');

describe('config read/write (paths.js)', () => {
    it('HOME_DATA_DIR is a non-empty string', () => {
        assert.strictEqual(typeof HOME_DATA_DIR, 'string');
        assert.ok(HOME_DATA_DIR.length > 0, 'HOME_DATA_DIR should be non-empty');
    });

    it('CLAUDE_MESSAGES_PATH ends with inbox.json', () => {
        assert.ok(
            CLAUDE_MESSAGES_PATH.endsWith('inbox.json'),
            `Expected path ending with inbox.json, got: ${CLAUDE_MESSAGES_PATH}`
        );
    });

    it('config path resolution works for current platform', () => {
        // HOME_DATA_DIR should be under the platform-appropriate config location
        if (process.platform === 'win32') {
            assert.ok(
                HOME_DATA_DIR.includes('AppData') || HOME_DATA_DIR.includes('voice-mirror-electron'),
                `Expected Windows data dir, got: ${HOME_DATA_DIR}`
            );
        } else if (process.platform === 'darwin') {
            assert.ok(
                HOME_DATA_DIR.includes('Library'),
                `Expected macOS data dir, got: ${HOME_DATA_DIR}`
            );
        } else {
            assert.ok(
                HOME_DATA_DIR.includes('.config'),
                `Expected Linux data dir, got: ${HOME_DATA_DIR}`
            );
        }
    });
});
