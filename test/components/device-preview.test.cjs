const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lensSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lens.rs'), 'utf-8');
const libSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');

describe('device preview — Rust commands', () => {
    describe('lens.rs structures', () => {
        it('has DeviceWebview struct', () => {
            assert.ok(lensSrc.includes('pub struct DeviceWebview'), 'missing pub struct DeviceWebview');
        });

        it('has device_webviews field in LensState', () => {
            assert.ok(lensSrc.includes('device_webviews'), 'missing device_webviews field');
        });

        it('has MAX_DEVICE_WEBVIEWS constant', () => {
            assert.ok(lensSrc.includes('MAX_DEVICE_WEBVIEWS'), 'missing MAX_DEVICE_WEBVIEWS constant');
        });
    });

    describe('lens.rs commands', () => {
        it('has lens_create_device_webview command', () => {
            assert.ok(
                lensSrc.includes('pub async fn lens_create_device_webview'),
                'missing pub async fn lens_create_device_webview'
            );
        });

        it('has lens_close_device_webview command', () => {
            assert.ok(
                lensSrc.includes('pub fn lens_close_device_webview'),
                'missing pub fn lens_close_device_webview'
            );
        });

        it('has lens_close_all_device_webviews command', () => {
            assert.ok(
                lensSrc.includes('pub fn lens_close_all_device_webviews'),
                'missing pub fn lens_close_all_device_webviews'
            );
        });

        it('has lens_resize_device_webview command', () => {
            assert.ok(
                lensSrc.includes('pub fn lens_resize_device_webview'),
                'missing pub fn lens_resize_device_webview'
            );
        });
    });

    describe('lib.rs command registration', () => {
        it('registers lens_create_device_webview', () => {
            assert.ok(
                libSrc.includes('lens_cmds::lens_create_device_webview'),
                'lens_create_device_webview not registered in lib.rs'
            );
        });

        it('registers lens_close_device_webview', () => {
            assert.ok(
                libSrc.includes('lens_cmds::lens_close_device_webview'),
                'lens_close_device_webview not registered in lib.rs'
            );
        });

        it('registers lens_close_all_device_webviews', () => {
            assert.ok(
                libSrc.includes('lens_cmds::lens_close_all_device_webviews'),
                'lens_close_all_device_webviews not registered in lib.rs'
            );
        });

        it('registers lens_resize_device_webview', () => {
            assert.ok(
                libSrc.includes('lens_cmds::lens_resize_device_webview'),
                'lens_resize_device_webview not registered in lib.rs'
            );
        });
    });
});
