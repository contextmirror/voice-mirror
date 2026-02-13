const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ensureWithin } = require('../../electron/lib/safe-path');

describe('electron/lib/safe-path', () => {
    const base = path.resolve('/tmp/test-base');

    it('resolves a simple filename within the base', () => {
        const result = ensureWithin(base, 'file.txt');
        assert.equal(result, path.join(base, 'file.txt'));
    });

    it('resolves a nested path within the base', () => {
        const result = ensureWithin(base, 'sub/dir/file.txt');
        assert.equal(result, path.join(base, 'sub', 'dir', 'file.txt'));
    });

    it('throws on path traversal with ../', () => {
        assert.throws(
            () => ensureWithin(base, '../../../etc/passwd'),
            /Path traversal detected/
        );
    });

    it('throws on path traversal that escapes after going deeper', () => {
        assert.throws(
            () => ensureWithin(base, 'sub/../../..'),
            /Path traversal detected/
        );
    });

    it('allows the base directory itself', () => {
        const result = ensureWithin(base, '.');
        assert.equal(result, path.resolve(base));
    });

    it('throws on absolute path that escapes the base', () => {
        const escapePath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';
        assert.throws(
            () => ensureWithin(base, escapePath),
            /Path traversal detected/
        );
    });

    it('handles empty string (resolves to base)', () => {
        const result = ensureWithin(base, '');
        assert.equal(result, path.resolve(base));
    });
});
