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

const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('api.js: device preview wrappers', () => {
  it('exports lensCreateDeviceWebview', () => {
    assert.ok(apiSrc.includes('export async function lensCreateDeviceWebview'), 'Should export lensCreateDeviceWebview');
  });

  it('exports lensCloseDeviceWebview', () => {
    assert.ok(apiSrc.includes('export async function lensCloseDeviceWebview'), 'Should export lensCloseDeviceWebview');
  });

  it('exports lensCloseAllDeviceWebviews', () => {
    assert.ok(apiSrc.includes('export async function lensCloseAllDeviceWebviews'), 'Should export lensCloseAllDeviceWebviews');
  });

  it('exports lensResizeDeviceWebview', () => {
    assert.ok(apiSrc.includes('export async function lensResizeDeviceWebview'), 'Should export lensResizeDeviceWebview');
  });

  it('lensCreateDeviceWebview invokes correct command', () => {
    assert.ok(apiSrc.includes("'lens_create_device_webview'"), 'Should invoke lens_create_device_webview');
  });
});

const componentSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePreview.svelte'), 'utf-8');

describe('DevicePreview.svelte: imports', () => {
  it('imports devicePreviewStore', () => {
    assert.ok(componentSrc.includes('devicePreviewStore'));
  });
  it('imports DevicePreviewStrip', () => {
    assert.ok(componentSrc.includes('DevicePreviewStrip'));
  });
  it('imports getPresetById', () => {
    assert.ok(componentSrc.includes('getPresetById'));
  });
  it('imports lensResizeDeviceWebview', () => {
    assert.ok(componentSrc.includes('lensResizeDeviceWebview'));
  });
});

describe('DevicePreview.svelte: structure', () => {
  it('has device-preview class', () => {
    assert.ok(componentSrc.includes('device-preview'));
  });
  it('has device-grid class', () => {
    assert.ok(componentSrc.includes('device-grid'));
  });
  it('has device-frame class', () => {
    assert.ok(componentSrc.includes('device-frame'));
  });
  it('has device-label class', () => {
    assert.ok(componentSrc.includes('device-label'));
  });
  it('has empty state', () => {
    assert.ok(componentSrc.includes('No devices selected') || componentSrc.includes('device-empty'));
  });
  it('includes DevicePreviewStrip', () => {
    assert.ok(componentSrc.includes('DevicePreviewStrip'));
  });
});

describe('DevicePreview.svelte: WebView2 positioning', () => {
  it('uses ResizeObserver', () => {
    assert.ok(componentSrc.includes('ResizeObserver'));
  });
  it('references lensResizeDeviceWebview for positioning', () => {
    assert.ok(componentSrc.includes('lensResizeDeviceWebview'));
  });
  it('uses getBoundingClientRect for bounds', () => {
    assert.ok(componentSrc.includes('getBoundingClientRect'));
  });
});

describe('DevicePreview.svelte: styles', () => {
  it('has scoped styles', () => {
    assert.ok(componentSrc.includes('<style>'));
  });
  it('grid is scrollable', () => {
    assert.ok(componentSrc.includes('overflow'));
  });
});

const groupTabBarSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/GroupTabBar.svelte'), 'utf-8');
const editorPaneSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/EditorPane.svelte'), 'utf-8');
const workspaceSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'), 'utf-8');

describe('GroupTabBar: device preview button', () => {
  it('accepts onDevicePreviewClick prop', () => {
    assert.ok(groupTabBarSrc.includes('onDevicePreviewClick'));
  });
  it('accepts showDevicePreview prop', () => {
    assert.ok(groupTabBarSrc.includes('showDevicePreview'));
  });
  it('has device preview button with phone icon', () => {
    assert.ok(groupTabBarSrc.includes('Device Preview'));
  });
});

describe('EditorPane: device preview passthrough', () => {
  it('accepts onDevicePreviewClick prop', () => {
    assert.ok(editorPaneSrc.includes('onDevicePreviewClick'));
  });
  it('accepts showDevicePreview prop', () => {
    assert.ok(editorPaneSrc.includes('showDevicePreview'));
  });
});

describe('LensWorkspace: device preview wiring', () => {
  it('imports devicePreviewStore', () => {
    assert.ok(workspaceSrc.includes('devicePreviewStore'));
  });
  it('passes onDevicePreviewClick to EditorPane', () => {
    assert.ok(workspaceSrc.includes('onDevicePreviewClick'));
  });
  it('passes showDevicePreview to EditorPane', () => {
    assert.ok(workspaceSrc.includes('showDevicePreview'));
  });
});

describe('LensWorkspace.svelte: device preview integration', () => {
  it('imports DevicePreview component', () => {
    assert.ok(workspaceSrc.includes("import DevicePreview from './DevicePreview.svelte'"), 'Should import DevicePreview');
  });

  it('renders DevicePreview in a split pane with editor', () => {
    assert.ok(workspaceSrc.includes('<DevicePreview'), 'Should render DevicePreview component');
  });

  it('uses devicePreviewStore.isOpen for collapse', () => {
    assert.ok(workspaceSrc.includes('devicePreviewStore.isOpen'), 'Should use store isOpen for visibility');
  });

  it('has devicePreviewRatio state for split', () => {
    assert.ok(workspaceSrc.includes('devicePreviewRatio'), 'Should have devicePreviewRatio state');
  });
});
