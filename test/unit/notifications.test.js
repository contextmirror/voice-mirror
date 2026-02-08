/**
 * Tests for notifications.js toast system
 *
 * Tests the interface contract and structure without requiring a DOM environment.
 * The actual rendering is tested visually in the app.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('notifications', () => {
    const notificationsPath = path.join(__dirname, '../../electron/js/notifications.js');
    const cssPath = path.join(__dirname, '../../electron/styles/notifications.css');

    describe('notifications.js file structure', () => {
        it('should exist', () => {
            assert.ok(fs.existsSync(notificationsPath));
        });

        it('should export showToast function', () => {
            const content = fs.readFileSync(notificationsPath, 'utf-8');
            assert.ok(content.includes('export function showToast'));
        });

        it('should export dismissToast function', () => {
            const content = fs.readFileSync(notificationsPath, 'utf-8');
            assert.ok(content.includes('export function dismissToast'));
        });

        it('should export updateToast function', () => {
            const content = fs.readFileSync(notificationsPath, 'utf-8');
            assert.ok(content.includes('export function updateToast'));
        });

        it('showToast should accept options parameter with actionText and onAction', () => {
            const content = fs.readFileSync(notificationsPath, 'utf-8');
            assert.ok(content.includes('options.actionText'));
            assert.ok(content.includes('options.onAction'));
        });
    });

    describe('toast icons', () => {
        const content = fs.readFileSync(notificationsPath, 'utf-8');

        it('should have info icon', () => {
            assert.ok(content.includes("info:"));
            assert.ok(content.includes("<svg"));
        });

        it('should have success icon', () => {
            assert.ok(content.includes("success:"));
        });

        it('should have warning icon', () => {
            assert.ok(content.includes("warning:"));
        });

        it('should have error icon', () => {
            assert.ok(content.includes("error:"));
        });

        it('should have loading spinner', () => {
            assert.ok(content.includes("loading:"));
            assert.ok(content.includes("toast-spinner"));
        });
    });

    describe('toast action button', () => {
        const content = fs.readFileSync(notificationsPath, 'utf-8');

        it('should create action button when options provided', () => {
            assert.ok(content.includes("toast-action"));
            assert.ok(content.includes("actionBtn"));
        });

        it('should stop propagation on action button click', () => {
            assert.ok(content.includes("stopPropagation"));
        });
    });

    describe('notifications.css file structure', () => {
        it('should exist', () => {
            assert.ok(fs.existsSync(cssPath));
        });

        const cssContent = fs.readFileSync(cssPath, 'utf-8');

        it('should have toast container styles', () => {
            assert.ok(cssContent.includes('#toast-container'));
        });

        it('should have base toast styles', () => {
            assert.ok(cssContent.includes('.toast {'));
        });

        it('should have toast type variants', () => {
            assert.ok(cssContent.includes('.toast.info'));
            assert.ok(cssContent.includes('.toast.success'));
            assert.ok(cssContent.includes('.toast.warning'));
            assert.ok(cssContent.includes('.toast.error'));
        });

        it('should have toast action button styles', () => {
            assert.ok(cssContent.includes('.toast-action'));
        });

        it('should have toast action hover state', () => {
            assert.ok(cssContent.includes('.toast-action:hover'));
        });

        it('should hide action button in loading state', () => {
            assert.ok(cssContent.includes('.toast.loading .toast-action'));
        });

        it('should have toast close button styles', () => {
            assert.ok(cssContent.includes('.toast-close'));
        });

        it('should have toast exit animation', () => {
            assert.ok(cssContent.includes('.toast.exiting'));
            assert.ok(cssContent.includes('toast-exit'));
        });

        it('should have loading spinner styles', () => {
            assert.ok(cssContent.includes('.toast-spinner'));
        });
    });

    describe('update notification integration', () => {
        const mainJsPath = path.join(__dirname, '../../electron/js/main.js');
        const mainContent = fs.readFileSync(mainJsPath, 'utf-8');

        it('should use sidebar banner for update notifications', () => {
            assert.ok(mainContent.includes('onUpdateAvailable'));
            assert.ok(mainContent.includes('sidebar-update-banner'));
        });

        it('should have Update button in banner', () => {
            assert.ok(mainContent.includes("'Update'"));
        });

        it('should call applyUpdate on action', () => {
            assert.ok(mainContent.includes('applyUpdate'));
        });

        it('should handle update status events', () => {
            assert.ok(mainContent.includes('onUpdateStatus'));
            assert.ok(mainContent.includes("status === 'pulling'"));
            assert.ok(mainContent.includes("status === 'installing'"));
            assert.ok(mainContent.includes("status === 'ready'"));
            assert.ok(mainContent.includes("status === 'error'"));
        });
    });
});
