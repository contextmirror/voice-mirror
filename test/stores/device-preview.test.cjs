/**
 * device-preview.test.cjs -- Source-inspection tests for device-preview.svelte.js
 *
 * Validates the device preview store for multi-device responsive preview management.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/device-preview.svelte.js'),
  'utf-8'
);

describe('device-preview store: exports', () => {
  it('exports devicePreviewStore', () => {
    assert.ok(src.includes('export const devicePreviewStore'), 'Should export devicePreviewStore');
  });

  it('creates store via createDevicePreviewStore factory', () => {
    assert.ok(src.includes('function createDevicePreviewStore()'), 'Should define createDevicePreviewStore factory');
  });
});

describe('device-preview store: reactive state', () => {
  it('uses $state rune', () => {
    assert.ok(src.includes('$state('), 'Should use $state rune');
  });

  it('has activeDevices state as array', () => {
    assert.ok(src.includes('activeDevices') && src.includes('$state(['), 'Should have activeDevices as $state array');
  });

  it('has isOpen state', () => {
    assert.ok(src.includes('isOpen') && src.includes('$state(false'), 'Should have isOpen as $state(false)');
  });

  it('has orientation state defaulting to portrait', () => {
    assert.ok(src.includes("$state('portrait')"), "Should have orientation defaulting to 'portrait'");
  });

  it('has syncEnabled state defaulting to true', () => {
    assert.ok(src.includes('$state(true'), 'Should have syncEnabled defaulting to true');
  });

  it('has previewUrl state defaulting to empty string', () => {
    assert.ok(src.includes("$state('')"), "Should have previewUrl defaulting to ''");
  });
});

describe('device-preview store: constants', () => {
  it('has MAX_DEVICES constant', () => {
    assert.ok(src.includes('MAX_DEVICES'), 'Should have MAX_DEVICES constant');
  });

  it('MAX_DEVICES is 5', () => {
    assert.ok(src.includes('MAX_DEVICES = 5'), 'MAX_DEVICES should be 5');
  });
});

describe('device-preview store: getters', () => {
  it('has activeDevices getter', () => {
    assert.ok(src.includes('get activeDevices()'), 'Should expose activeDevices getter');
  });

  it('has isOpen getter', () => {
    assert.ok(src.includes('get isOpen()'), 'Should expose isOpen getter');
  });

  it('has orientation getter', () => {
    assert.ok(src.includes('get orientation()'), 'Should expose orientation getter');
  });

  it('has syncEnabled getter', () => {
    assert.ok(src.includes('get syncEnabled()'), 'Should expose syncEnabled getter');
  });

  it('has previewUrl getter', () => {
    assert.ok(src.includes('get previewUrl()'), 'Should expose previewUrl getter');
  });

  it('has canAddDevice getter', () => {
    assert.ok(src.includes('get canAddDevice()'), 'Should expose canAddDevice getter');
  });

  it('canAddDevice checks MAX_DEVICES', () => {
    assert.ok(src.includes('activeDevices.length < MAX_DEVICES'), 'canAddDevice should compare against MAX_DEVICES');
  });

  it('has deviceCount getter', () => {
    assert.ok(src.includes('get deviceCount()'), 'Should expose deviceCount getter');
  });

  it('deviceCount returns activeDevices.length', () => {
    assert.ok(src.includes('activeDevices.length'), 'deviceCount should use activeDevices.length');
  });
});

describe('device-preview store: methods', () => {
  const methods = [
    'open(',
    'close(',
    'toggle(',
    'addDevice(',
    'removeDevice(',
    'removeAllDevices(',
    'toggleOrientation(',
    'setPreviewUrl(',
    'toggleSync(',
  ];

  for (const method of methods) {
    it(`has ${method.replace('(', '')} method`, () => {
      assert.ok(src.includes(method), `Should have ${method.replace('(', '')} method`);
    });
  }
});

describe('device-preview store: imports', () => {
  it('imports getPresetById from device-presets', () => {
    assert.ok(src.includes('getPresetById'), 'Should import getPresetById');
  });

  it('imports from device-presets.js', () => {
    assert.ok(
      src.includes('device-presets.js') || src.includes('device-presets'),
      'Should import from device-presets'
    );
  });

  it('imports lensCreateDeviceWebview from api', () => {
    assert.ok(src.includes('lensCreateDeviceWebview'), 'Should import lensCreateDeviceWebview');
  });

  it('imports lensCloseDeviceWebview from api', () => {
    assert.ok(src.includes('lensCloseDeviceWebview'), 'Should import lensCloseDeviceWebview');
  });

  it('imports lensCloseAllDeviceWebviews from api', () => {
    assert.ok(src.includes('lensCloseAllDeviceWebviews'), 'Should import lensCloseAllDeviceWebviews');
  });

  it('imports from ../api.js', () => {
    assert.ok(
      src.includes("'../api.js'") || src.includes('"../api.js"'),
      'Should import from ../api.js'
    );
  });
});

describe('device-preview store: addDevice logic', () => {
  it('addDevice is async', () => {
    assert.ok(src.includes('async addDevice('), 'addDevice should be async');
  });

  it('addDevice validates MAX_DEVICES limit', () => {
    const addBlock = src.split('async addDevice')[1]?.split(/\n\s{4}\w|async\s/)[0] || '';
    assert.ok(addBlock.includes('MAX_DEVICES'), 'addDevice should check MAX_DEVICES');
  });

  it('addDevice calls getPresetById', () => {
    const addBlock = src.split('async addDevice')[1]?.split(/\n\s{4}\w|async\s/)[0] || '';
    assert.ok(addBlock.includes('getPresetById'), 'addDevice should look up preset');
  });

  it('addDevice calls lensCreateDeviceWebview', () => {
    const addBlock = src.split('async addDevice')[1]?.split(/\n\s{4}\w|async\s/)[0] || '';
    assert.ok(addBlock.includes('lensCreateDeviceWebview'), 'addDevice should call backend API');
  });
});

describe('device-preview store: removeDevice logic', () => {
  it('removeDevice is async', () => {
    assert.ok(src.includes('async removeDevice('), 'removeDevice should be async');
  });

  it('removeDevice calls lensCloseDeviceWebview', () => {
    assert.ok(src.includes('lensCloseDeviceWebview'), 'removeDevice should call backend API');
  });
});

describe('device-preview store: removeAllDevices logic', () => {
  it('removeAllDevices is async', () => {
    assert.ok(src.includes('async removeAllDevices('), 'removeAllDevices should be async');
  });

  it('removeAllDevices calls lensCloseAllDeviceWebviews', () => {
    assert.ok(src.includes('lensCloseAllDeviceWebviews'), 'removeAllDevices should call backend API');
  });
});

describe('device-preview store: close cleans up', () => {
  it('close calls removeAllDevices', () => {
    // The close method body should reference removeAllDevices
    const closeBlock = src.split(/\bclose\s*\(\s*\)/)[1]?.split(/\n\s{4}\w/)[0] || '';
    assert.ok(
      closeBlock.includes('removeAllDevices') || src.includes('this.removeAllDevices'),
      'close should call removeAllDevices to clean up'
    );
  });
});

describe('device-preview store: orientation toggle', () => {
  it('toggleOrientation switches between portrait and landscape', () => {
    assert.ok(src.includes("'portrait'") && src.includes("'landscape'"), 'Should handle portrait and landscape');
  });
});
