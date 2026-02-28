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

const schemaSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/config/schema.rs'), 'utf-8');
const configStoreSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/stores/config.svelte.js'), 'utf-8');

describe('config: device preview settings', () => {
  it('schema.rs has DevicePreviewConfig struct', () => {
    assert.ok(schemaSrc.includes('pub struct DevicePreviewConfig'), 'Should have DevicePreviewConfig');
  });

  it('AppConfig has device_preview field', () => {
    assert.ok(schemaSrc.includes('device_preview'), 'AppConfig should have device_preview field');
  });

  it('DevicePreviewConfig has custom_devices field', () => {
    assert.ok(schemaSrc.includes('custom_devices'), 'Should store custom device presets');
  });

  it('DevicePreviewConfig has last_devices field', () => {
    assert.ok(schemaSrc.includes('last_devices'), 'Should remember last-used devices');
  });

  it('DEFAULT_CONFIG has devicePreview section', () => {
    assert.ok(configStoreSrc.includes('devicePreview'), 'DEFAULT_CONFIG should have devicePreview');
  });
});

// Re-read the component source for sync tests (after Task 11 modifications)
const componentSrcV2 = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePreview.svelte'), 'utf-8');

describe('DevicePreview.svelte: interaction sync', () => {
  it('imports SYNC_SCRIPT', () => {
    assert.ok(componentSrcV2.includes('SYNC_SCRIPT'), 'Should import sync script');
  });

  it('imports replayScrollScript', () => {
    assert.ok(componentSrcV2.includes('replayScrollScript'), 'Should import scroll replay');
  });

  it('injects sync script on device creation', () => {
    assert.ok(componentSrcV2.includes('SYNC_SCRIPT') && componentSrcV2.includes('evaluate') || componentSrcV2.includes('lensEvalDeviceJs'), 'Should inject sync JS');
  });

  it('has sync polling interval', () => {
    assert.ok(componentSrcV2.includes('setInterval') || componentSrcV2.includes('poll'), 'Should poll for sync events');
  });

  it('respects syncEnabled toggle', () => {
    assert.ok(componentSrcV2.includes('syncEnabled'), 'Should check sync toggle');
  });
});

// Check for lens_eval_device_js command
const lensSrcV2 = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lens.rs'), 'utf-8');
const libSrcV2 = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');
const apiSrcV2 = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('lens_eval_device_js command', () => {
  it('has lens_eval_device_js in lens.rs', () => {
    assert.ok(lensSrcV2.includes('lens_eval_device_js'), 'Should have lens_eval_device_js command');
  });

  it('is registered in lib.rs', () => {
    assert.ok(libSrcV2.includes('lens_cmds::lens_eval_device_js'), 'Should be registered');
  });

  it('has API wrapper in api.js', () => {
    assert.ok(apiSrcV2.includes('lensEvalDeviceJs') || apiSrcV2.includes('lens_eval_device_js'), 'Should have API wrapper');
  });
});

// Re-read sources for CDP emulation tests
const lensSrcCDP = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lens.rs'), 'utf-8');
const libSrcCDP = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');
const apiSrcCDP = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');
const componentSrcCDP = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePreview.svelte'), 'utf-8');

describe('CDP device emulation', () => {
  it('lens.rs has lens_set_device_emulation command', () => {
    assert.ok(lensSrcCDP.includes('lens_set_device_emulation'), 'Should have lens_set_device_emulation');
  });

  it('lens.rs calls Emulation.setDeviceMetricsOverride', () => {
    assert.ok(lensSrcCDP.includes('setDeviceMetricsOverride'), 'Should call setDeviceMetricsOverride');
  });

  it('lens.rs calls Network.setUserAgentOverride', () => {
    assert.ok(lensSrcCDP.includes('setUserAgentOverride'), 'Should call setUserAgentOverride');
  });

  it('lens.rs calls Emulation.setTouchEmulationEnabled', () => {
    assert.ok(lensSrcCDP.includes('setTouchEmulationEnabled'), 'Should call setTouchEmulationEnabled');
  });

  it('is registered in lib.rs', () => {
    assert.ok(libSrcCDP.includes('lens_cmds::lens_set_device_emulation'), 'Should be registered');
  });

  it('has API wrapper', () => {
    assert.ok(apiSrcCDP.includes('lensSetDeviceEmulation'), 'Should have API wrapper');
  });

  it('DevicePreview calls lensSetDeviceEmulation', () => {
    assert.ok(componentSrcCDP.includes('lensSetDeviceEmulation'), 'Should call CDP emulation');
  });

  it('tracks emulated devices to avoid re-calling', () => {
    assert.ok(componentSrcCDP.includes('emulatedDevices'), 'Should track emulated devices');
  });
});
