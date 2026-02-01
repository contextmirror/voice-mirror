/**
 * Tests for extra paths support in MarkdownStore
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MarkdownStore = require('./MarkdownStore');

describe('Extra paths support', () => {
    let dir, extraDir, store;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extra-paths-test-'));
        extraDir = path.join(dir, 'extra');
        fs.mkdirSync(extraDir, { recursive: true });
    });

    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true }); } catch {}
    });

    it('should include files from extra directory paths', async () => {
        // Create an extra file
        fs.writeFileSync(path.join(extraDir, 'notes.md'), '# Extra notes\n- Something important');

        store = new MarkdownStore(path.join(dir, 'memory'), { extraPaths: [extraDir] });
        await store.init();

        const files = await store.listMemoryFiles();
        const extraFiles = files.filter(f => f.type === 'extra');
        assert.strictEqual(extraFiles.length, 1);
        assert.ok(extraFiles[0].path.endsWith('notes.md'));
    });

    it('should include individual extra file paths', async () => {
        const extraFile = path.join(dir, 'standalone.md');
        fs.writeFileSync(extraFile, '# Standalone\n- Data');

        store = new MarkdownStore(path.join(dir, 'memory'), { extraPaths: [extraFile] });
        await store.init();

        const files = await store.listMemoryFiles();
        const extraFiles = files.filter(f => f.type === 'extra');
        assert.strictEqual(extraFiles.length, 1);
    });

    it('should skip symlinks for safety', async () => {
        const realFile = path.join(dir, 'real.md');
        fs.writeFileSync(realFile, '# Real file');
        const linkPath = path.join(extraDir, 'link.md');
        fs.symlinkSync(realFile, linkPath);

        store = new MarkdownStore(path.join(dir, 'memory'), { extraPaths: [extraDir] });
        await store.init();

        const files = await store.listMemoryFiles();
        const extraFiles = files.filter(f => f.type === 'extra');
        assert.strictEqual(extraFiles.length, 0, 'Symlinks should be skipped');
    });

    it('should skip non-md files', async () => {
        fs.writeFileSync(path.join(extraDir, 'data.txt'), 'not markdown');
        fs.writeFileSync(path.join(extraDir, 'notes.md'), '# Notes');

        store = new MarkdownStore(path.join(dir, 'memory'), { extraPaths: [extraDir] });
        await store.init();

        const files = await store.listMemoryFiles();
        const extraFiles = files.filter(f => f.type === 'extra');
        assert.strictEqual(extraFiles.length, 1);
    });

    it('should handle non-existent extra paths gracefully', async () => {
        store = new MarkdownStore(path.join(dir, 'memory'), {
            extraPaths: ['/nonexistent/path/to/nowhere']
        });
        await store.init();

        const files = await store.listMemoryFiles();
        // Should not throw, just skip
        assert.ok(Array.isArray(files));
    });

    it('should default to empty extraPaths', async () => {
        store = new MarkdownStore(path.join(dir, 'memory'));
        await store.init();

        const files = await store.listMemoryFiles();
        const extraFiles = files.filter(f => f.type === 'extra');
        assert.strictEqual(extraFiles.length, 0);
    });
});
