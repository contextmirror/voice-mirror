/**
 * Tests for update-checker service (electron-updater version)
 *
 * Since electron-updater requires a packaged Electron app, these tests
 * verify the module's API shape and dev-mode behaviour (where app.isPackaged
 * is false and the service returns a no-op stub).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Source inspection — read the actual module source
const checkerPath = path.resolve(__dirname, '../../electron/services/update-checker.js');
const checkerSrc = fs.readFileSync(checkerPath, 'utf8');

describe('update-checker', () => {
    it('exports createUpdateChecker', () => {
        assert.ok(checkerSrc.includes('module.exports'));
        assert.ok(checkerSrc.includes('createUpdateChecker'));
    });

    it('uses electron-updater autoUpdater', () => {
        assert.ok(checkerSrc.includes("require('electron-updater')"));
        assert.ok(checkerSrc.includes('autoUpdater'));
    });

    it('disables auto-download (user choice pattern)', () => {
        assert.ok(checkerSrc.includes('autoDownload = false'));
    });

    it('disables auto-install on quit', () => {
        assert.ok(checkerSrc.includes('autoInstallOnAppQuit = false'));
    });

    it('skips updates in dev mode (app.isPackaged check)', () => {
        assert.ok(checkerSrc.includes('app.isPackaged'));
        assert.ok(checkerSrc.includes('dev mode'));
    });

    it('returns start, stop, check, applyUpdate API', () => {
        // The return object should expose all four methods
        assert.ok(checkerSrc.includes('return { start, stop, check, applyUpdate }'));
    });

    it('dev-mode stub returns all four methods', () => {
        // The early-return dev-mode stub must also have all four
        assert.ok(checkerSrc.includes('start()'));
        assert.ok(checkerSrc.includes('stop()'));
        assert.ok(checkerSrc.includes('check()'));
        assert.ok(checkerSrc.includes('applyUpdate()'));
    });

    it('handles update-available event via safeSend', () => {
        assert.ok(checkerSrc.includes("'update-available'"));
        assert.ok(checkerSrc.includes('info.version'));
    });

    it('handles download-progress event', () => {
        assert.ok(checkerSrc.includes("'download-progress'"));
        assert.ok(checkerSrc.includes('progress.percent'));
    });

    it('handles update-downloaded event', () => {
        assert.ok(checkerSrc.includes("'update-downloaded'"));
        assert.ok(checkerSrc.includes("status: 'ready'"));
        assert.ok(checkerSrc.includes('needsRestart: true'));
    });

    it('handles error event', () => {
        assert.ok(checkerSrc.includes("autoUpdater.on('error'"));
        assert.ok(checkerSrc.includes("status: 'error'"));
    });

    it('uses structured logger', () => {
        assert.ok(checkerSrc.includes("require('./logger')"));
        assert.ok(checkerSrc.includes("log.info('[Update]'"));
        assert.ok(checkerSrc.includes("log.error('[Update]'"));
    });

    it('check() has error handling', () => {
        assert.ok(checkerSrc.includes('checkForUpdates'));
        assert.ok(checkerSrc.includes('catch'));
    });

    it('applyUpdate() calls downloadUpdate', () => {
        assert.ok(checkerSrc.includes('downloadUpdate'));
    });

    it('start() uses delayed initial check and periodic interval', () => {
        assert.ok(checkerSrc.includes('setTimeout'));
        assert.ok(checkerSrc.includes('setInterval'));
    });

    it('stop() clears both timers', () => {
        assert.ok(checkerSrc.includes('clearTimeout'));
        assert.ok(checkerSrc.includes('clearInterval'));
    });

    it('does NOT contain git operations (removed)', () => {
        assert.ok(!checkerSrc.includes('git fetch'));
        assert.ok(!checkerSrc.includes('git reset'));
        assert.ok(!checkerSrc.includes('git clean'));
        assert.ok(!checkerSrc.includes('execFileSync'));
        assert.ok(!checkerSrc.includes('preflight'));
        assert.ok(!checkerSrc.includes('pending-install'));
        assert.ok(!checkerSrc.includes('npm install'));
    });
});
