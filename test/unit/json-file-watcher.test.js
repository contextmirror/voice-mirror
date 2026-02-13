const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createJsonFileWatcher } = require('../../electron/lib/json-file-watcher');

describe('electron/lib/json-file-watcher', () => {
    let tmpDir;
    let watcher;

    afterEach(() => {
        if (watcher && watcher.isRunning()) {
            watcher.stop();
        }
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
    });

    it('returns an object with start, stop, isRunning methods', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfw-test-'));
        watcher = createJsonFileWatcher({
            watchDir: tmpDir,
            filename: 'test.json',
            onEvent: () => {},
        });

        assert.equal(typeof watcher.start, 'function');
        assert.equal(typeof watcher.stop, 'function');
        assert.equal(typeof watcher.isRunning, 'function');
    });

    it('isRunning returns false before start', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfw-test-'));
        watcher = createJsonFileWatcher({
            watchDir: tmpDir,
            filename: 'test.json',
            onEvent: () => {},
        });

        assert.equal(watcher.isRunning(), false);
    });

    it('isRunning returns true after start', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfw-test-'));
        watcher = createJsonFileWatcher({
            watchDir: tmpDir,
            filename: 'test.json',
            onEvent: () => {},
        });

        watcher.start();
        assert.equal(watcher.isRunning(), true);
    });

    it('isRunning returns false after stop', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfw-test-'));
        watcher = createJsonFileWatcher({
            watchDir: tmpDir,
            filename: 'test.json',
            onEvent: () => {},
        });

        watcher.start();
        watcher.stop();
        assert.equal(watcher.isRunning(), false);
    });

    it('stop is safe to call when not running', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfw-test-'));
        watcher = createJsonFileWatcher({
            watchDir: tmpDir,
            filename: 'test.json',
            onEvent: () => {},
        });

        assert.doesNotThrow(() => watcher.stop());
    });

    it('start twice does not throw (idempotent)', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfw-test-'));
        watcher = createJsonFileWatcher({
            watchDir: tmpDir,
            filename: 'test.json',
            onEvent: () => {},
        });

        watcher.start();
        assert.doesNotThrow(() => watcher.start());
        assert.equal(watcher.isRunning(), true);
    });

    it('handles missing directory gracefully (falls back to polling)', () => {
        const missingDir = path.join(os.tmpdir(), 'jfw-nonexistent-' + Date.now());
        watcher = createJsonFileWatcher({
            watchDir: missingDir,
            filename: 'test.json',
            onEvent: () => {},
            label: 'MissingDirTest',
        });

        // fs.watch on a missing dir should throw, watcher should fall back to polling
        assert.doesNotThrow(() => watcher.start());
        assert.equal(watcher.isRunning(), true);
        watcher.stop();
    });

    it('uses the label option for logging', () => {
        // Source inspection: label is used in console.log messages
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../electron/lib/json-file-watcher.js'),
            'utf8'
        );
        assert.ok(src.includes('label'));
        assert.ok(src.includes("label = 'FileWatcher'"));
    });
});
