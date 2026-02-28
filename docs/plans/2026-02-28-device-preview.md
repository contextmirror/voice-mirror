# Device Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a SwiftUI-style multi-device preview panel to Lens that renders your web app across real WebView2 device viewports side-by-side with the code editor, with interaction sync across devices.

**Architecture:** A new split pane in LensWorkspace holds a scrollable grid of CSS-scaled WebView2 instances, each at real device dimensions. A modular device preset registry (~28 devices) feeds a picker dropdown. Interaction sync injects JS into each WebView2 that broadcasts scroll/click/input events to Rust, which relays to all siblings.

**Tech Stack:** Svelte 5 (runes stores + components), Rust/Tauri (WebView2 lifecycle, sync relay), CSS `transform: scale()` (scaled rendering), modular JS device registry.

---

## Progress Tracker

| Task | Description | Status | Agent | Commit |
|------|-------------|--------|-------|--------|
| 1 | Device preset registry (`device-presets.js`) | Pending | — | — |
| 2 | Device preview store (`device-preview.svelte.js`) | Pending | — | — |
| 3 | Rust commands for device WebView2 lifecycle | Pending | — | — |
| 4 | API wrappers for device preview commands | Pending | — | — |
| 5 | DevicePickerMenu component | Pending | — | — |
| 6 | DevicePreviewStrip component | Pending | — | — |
| 7 | DevicePreview main panel component | Pending | — | — |
| 8 | Device preview button in GroupTabBar | Pending | — | — |
| 9 | Integrate DevicePreview into LensWorkspace | Pending | — | — |
| 10 | Interaction sync module (`device-sync.js`) | Pending | — | — |
| 11 | Wire sync into DevicePreview component | Pending | — | — |
| 12 | DevicePreviewConfig in config schema | Pending | — | — |
| 13 | Full test suite + compilation verification | Pending | — | — |

---

## Context for the Implementer

### Key files to understand before starting

| File | Purpose | Why it matters |
|------|---------|---------------|
| `src/components/lens/GroupTabBar.svelte` | Editor tab bar with action buttons | The 📱 button goes here (lines 318-332) |
| `src/components/lens/LensWorkspace.svelte` | Layout orchestrator with SplitPanel nesting | Device preview pane integrates here (lines 280-352) |
| `src/components/lens/EditorPane.svelte` | Editor pane that passes `onBrowserClick` to GroupTabBar | Needs new `onDevicePreviewClick` prop |
| `src-tauri/src/commands/lens.rs` | Rust WebView2 management (`LensState`, `lens_create_tab`) | Pattern for new device WebView2 commands |
| `src/lib/stores/browser-tabs.svelte.js` | Reactive store managing browser tabs | Pattern for device-preview store |
| `src/lib/stores/layout.svelte.js` | Layout toggles (`showChat`, `showTerminal`, `showFileTree`) | Reference for panel visibility pattern |
| `src/lib/api.js` | 116 Tauri invoke wrappers (lines 337-401 for lens) | Pattern for new API wrappers |
| `src-tauri/src/config/schema.rs` | Config schema with subsection structs | Pattern for `DevicePreviewConfig` |
| `src-tauri/src/lib.rs` | Command registration (lines 340-354 for lens) | Register new device preview commands |

### Naming conventions

- Rust commands: `lens_create_device_webview`, `lens_close_device_webview`, etc.
- API wrappers: `lensCreateDeviceWebview()`, `lensCloseDeviceWebview()`, etc.
- Store: `devicePreviewStore` in `device-preview.svelte.js`
- Components: `DevicePreview.svelte`, `DevicePreviewStrip.svelte`, `DevicePickerMenu.svelte`
- CSS classes: `.device-preview`, `.device-frame`, `.device-strip`, `.device-picker`

---

### Task 1: Create device preset registry

**Files:**
- Create: `src/lib/device-presets.js`
- Create: `test/lib/device-presets.test.mjs`

**Step 1: Write the failing test**

Create `test/lib/device-presets.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_PRESETS, getPresetById, getPresetsByCategory, DEVICE_CATEGORIES } from '../../src/lib/device-presets.js';

describe('device-presets: exports', () => {
  it('exports DEVICE_PRESETS array', () => {
    assert.ok(Array.isArray(DEVICE_PRESETS));
    assert.ok(DEVICE_PRESETS.length >= 25, `Expected 25+ presets, got ${DEVICE_PRESETS.length}`);
  });

  it('exports DEVICE_CATEGORIES array', () => {
    assert.ok(Array.isArray(DEVICE_CATEGORIES));
    assert.ok(DEVICE_CATEGORIES.length >= 5);
  });

  it('exports getPresetById function', () => {
    assert.equal(typeof getPresetById, 'function');
  });

  it('exports getPresetsByCategory function', () => {
    assert.equal(typeof getPresetsByCategory, 'function');
  });
});

describe('device-presets: preset shape', () => {
  it('each preset has required fields', () => {
    for (const preset of DEVICE_PRESETS) {
      assert.ok(preset.id, `Missing id on preset`);
      assert.ok(preset.name, `Missing name on ${preset.id}`);
      assert.ok(preset.category, `Missing category on ${preset.id}`);
      assert.ok(typeof preset.width === 'number' && preset.width > 0, `Bad width on ${preset.id}`);
      assert.ok(typeof preset.height === 'number' && preset.height > 0, `Bad height on ${preset.id}`);
      assert.ok(typeof preset.dpr === 'number' && preset.dpr > 0, `Bad dpr on ${preset.id}`);
    }
  });

  it('each preset id is unique', () => {
    const ids = DEVICE_PRESETS.map(p => p.id);
    assert.equal(ids.length, new Set(ids).size, 'Duplicate preset IDs');
  });
});

describe('device-presets: helpers', () => {
  it('getPresetById returns correct preset', () => {
    const iphone15 = getPresetById('iphone-15');
    assert.ok(iphone15);
    assert.equal(iphone15.name, 'iPhone 15');
    assert.equal(iphone15.width, 393);
    assert.equal(iphone15.height, 852);
  });

  it('getPresetById returns null for unknown id', () => {
    assert.equal(getPresetById('nonexistent'), null);
  });

  it('getPresetsByCategory returns all iPhones', () => {
    const iphones = getPresetsByCategory('iPhone');
    assert.ok(iphones.length >= 6);
    assert.ok(iphones.every(p => p.category === 'iPhone'));
  });

  it('getPresetsByCategory returns empty for unknown category', () => {
    assert.deepEqual(getPresetsByCategory('Nonexistent'), []);
  });
});

describe('device-presets: coverage', () => {
  it('has iPhone presets', () => {
    assert.ok(getPresetsByCategory('iPhone').length >= 6);
  });

  it('has iPad presets', () => {
    assert.ok(getPresetsByCategory('iPad').length >= 4);
  });

  it('has Android Phone presets', () => {
    assert.ok(getPresetsByCategory('Android Phone').length >= 4);
  });

  it('has Android Tablet presets', () => {
    assert.ok(getPresetsByCategory('Android Tablet').length >= 2);
  });

  it('has Desktop presets', () => {
    assert.ok(getPresetsByCategory('Desktop').length >= 3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "device-presets"`
Expected: FAIL — module not found

**Step 3: Implement the device preset registry**

Create `src/lib/device-presets.js`:

```js
/**
 * device-presets.js -- Modular device preset registry for Device Preview.
 *
 * Adding a new device = adding one object to DEVICE_PRESETS.
 * No other files need to change.
 */

export const DEVICE_CATEGORIES = [
  'iPhone',
  'iPad',
  'Android Phone',
  'Android Tablet',
  'Desktop',
];

export const DEVICE_PRESETS = [
  // ── iPhone ──
  {
    id: 'iphone-se-3',
    name: 'iPhone SE (3rd gen)',
    category: 'iPhone',
    width: 375,
    height: 667,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-14',
    name: 'iPhone 14',
    category: 'iPhone',
    width: 390,
    height: 844,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-15',
    name: 'iPhone 15',
    category: 'iPhone',
    width: 393,
    height: 852,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    category: 'iPhone',
    width: 393,
    height: 852,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-15-pro-max',
    name: 'iPhone 15 Pro Max',
    category: 'iPhone',
    width: 430,
    height: 932,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-16',
    name: 'iPhone 16',
    category: 'iPhone',
    width: 393,
    height: 852,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    category: 'iPhone',
    width: 402,
    height: 874,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    category: 'iPhone',
    width: 440,
    height: 956,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },

  // ── iPad ──
  {
    id: 'ipad-mini-6',
    name: 'iPad Mini (6th gen)',
    category: 'iPad',
    width: 744,
    height: 1133,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'ipad-air-m2',
    name: 'iPad Air (M2)',
    category: 'iPad',
    width: 820,
    height: 1180,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'ipad-pro-11',
    name: 'iPad Pro 11"',
    category: 'iPad',
    width: 834,
    height: 1194,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'ipad-pro-13',
    name: 'iPad Pro 13"',
    category: 'iPad',
    width: 1032,
    height: 1376,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },

  // ── Android Phone ──
  {
    id: 'pixel-8',
    name: 'Pixel 8',
    category: 'Android Phone',
    width: 412,
    height: 915,
    dpr: 2.625,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'pixel-8-pro',
    name: 'Pixel 8 Pro',
    category: 'Android Phone',
    width: 412,
    height: 915,
    dpr: 3.5,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'galaxy-s24',
    name: 'Galaxy S24',
    category: 'Android Phone',
    width: 360,
    height: 780,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'galaxy-s24-ultra',
    name: 'Galaxy S24 Ultra',
    category: 'Android Phone',
    width: 412,
    height: 915,
    dpr: 3.5,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'galaxy-z-fold-folded',
    name: 'Galaxy Z Fold (Folded)',
    category: 'Android Phone',
    width: 280,
    height: 653,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-F956B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'galaxy-z-fold-open',
    name: 'Galaxy Z Fold (Open)',
    category: 'Android Phone',
    width: 600,
    height: 653,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-F956B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },

  // ── Android Tablet ──
  {
    id: 'galaxy-tab-s9',
    name: 'Galaxy Tab S9',
    category: 'Android Tablet',
    width: 800,
    height: 1280,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  {
    id: 'pixel-tablet',
    name: 'Pixel Tablet',
    category: 'Android Tablet',
    width: 1200,
    height: 2000,
    dpr: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },

  // ── Desktop ──
  {
    id: 'laptop-hd',
    name: 'Laptop (1366x768)',
    category: 'Desktop',
    width: 1366,
    height: 768,
    dpr: 1,
    userAgent: '',
  },
  {
    id: 'desktop-fhd',
    name: 'Full HD (1920x1080)',
    category: 'Desktop',
    width: 1920,
    height: 1080,
    dpr: 1,
    userAgent: '',
  },
  {
    id: 'desktop-2k',
    name: '2K (2560x1440)',
    category: 'Desktop',
    width: 2560,
    height: 1440,
    dpr: 1,
    userAgent: '',
  },
];

/**
 * Look up a device preset by id.
 * @param {string} id
 * @returns {object|null}
 */
export function getPresetById(id) {
  return DEVICE_PRESETS.find(p => p.id === id) || null;
}

/**
 * Get all presets in a category.
 * @param {string} category
 * @returns {object[]}
 */
export function getPresetsByCategory(category) {
  return DEVICE_PRESETS.filter(p => p.category === category);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "device-presets"`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add src/lib/device-presets.js test/lib/device-presets.test.mjs
git commit -m "feat(device-preview): add modular device preset registry with 23 devices"
```

---

### Task 2: Create device preview store

**Files:**
- Create: `src/lib/stores/device-preview.svelte.js`
- Create: `test/stores/device-preview.test.cjs`

**Step 1: Write the failing test**

Create `test/stores/device-preview.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/lib/stores/device-preview.svelte.js'), 'utf-8');

describe('device-preview store: exports', () => {
  it('exports devicePreviewStore', () => {
    assert.ok(src.includes('export const devicePreviewStore'), 'Should export devicePreviewStore');
  });
});

describe('device-preview store: state', () => {
  it('has active devices state', () => {
    assert.ok(src.includes('activeDevices'), 'Should track active devices');
  });

  it('has isOpen state', () => {
    assert.ok(src.includes('isOpen'), 'Should track open/close state');
  });

  it('has orientation state', () => {
    assert.ok(src.includes('orientation'), 'Should track orientation (portrait/landscape)');
  });

  it('has syncEnabled state', () => {
    assert.ok(src.includes('syncEnabled'), 'Should track sync toggle');
  });

  it('has previewUrl state', () => {
    assert.ok(src.includes('previewUrl'), 'Should track preview URL');
  });
});

describe('device-preview store: constants', () => {
  it('has MAX_DEVICES limit', () => {
    assert.ok(src.includes('MAX_DEVICES'), 'Should have device limit');
  });
});

describe('device-preview store: methods', () => {
  it('has open method', () => {
    assert.ok(src.includes('open('), 'Should have open()');
  });

  it('has close method', () => {
    assert.ok(src.includes('close('), 'Should have close()');
  });

  it('has toggle method', () => {
    assert.ok(src.includes('toggle('), 'Should have toggle()');
  });

  it('has addDevice method', () => {
    assert.ok(src.includes('addDevice('), 'Should have addDevice()');
  });

  it('has removeDevice method', () => {
    assert.ok(src.includes('removeDevice('), 'Should have removeDevice()');
  });

  it('has removeAllDevices method', () => {
    assert.ok(src.includes('removeAllDevices('), 'Should have removeAllDevices()');
  });

  it('has toggleOrientation method', () => {
    assert.ok(src.includes('toggleOrientation('), 'Should have toggleOrientation()');
  });

  it('has setPreviewUrl method', () => {
    assert.ok(src.includes('setPreviewUrl('), 'Should have setPreviewUrl()');
  });

  it('has toggleSync method', () => {
    assert.ok(src.includes('toggleSync('), 'Should have toggleSync()');
  });
});

describe('device-preview store: imports', () => {
  it('imports from device-presets', () => {
    assert.ok(src.includes('device-presets'), 'Should import from device-presets');
  });

  it('imports from api.js', () => {
    assert.ok(src.includes('api.js'), 'Should import API wrappers');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "device-preview store"`
Expected: FAIL — file not found

**Step 3: Implement the store**

Create `src/lib/stores/device-preview.svelte.js`:

```js
/**
 * device-preview.svelte.js -- Svelte 5 reactive store for Device Preview.
 *
 * Manages device preview panel state: which devices are active,
 * orientation, sync toggle, and preview URL. Each active device
 * corresponds to a real WebView2 instance on the backend.
 */
import { getPresetById } from '../device-presets.js';
import {
  lensCreateDeviceWebview,
  lensCloseDeviceWebview,
  lensCloseAllDeviceWebviews,
} from '../api.js';

const MAX_DEVICES = 5;

function createDevicePreviewStore() {
  /** @type {Array<{ presetId: string, webviewLabel: string|null }>} */
  let activeDevices = $state([]);
  let isOpen = $state(false);
  let orientation = $state('portrait');
  let syncEnabled = $state(true);
  let previewUrl = $state('');

  return {
    get activeDevices() { return activeDevices; },
    get isOpen() { return isOpen; },
    get orientation() { return orientation; },
    get syncEnabled() { return syncEnabled; },
    get previewUrl() { return previewUrl; },
    get canAddDevice() { return activeDevices.length < MAX_DEVICES; },
    get deviceCount() { return activeDevices.length; },

    open() {
      isOpen = true;
    },

    close() {
      isOpen = false;
      // Close all device webviews
      this.removeAllDevices();
    },

    toggle() {
      if (isOpen) {
        this.close();
      } else {
        this.open();
      }
    },

    /**
     * Add a device to the preview.
     * @param {string} presetId - Device preset ID from device-presets.js
     * @param {{ x: number, y: number, width: number, height: number }|null} bounds
     * @returns {Promise<boolean>} true if added successfully
     */
    async addDevice(presetId, bounds = null) {
      if (activeDevices.length >= MAX_DEVICES) return false;
      if (activeDevices.some(d => d.presetId === presetId)) return false;

      const preset = getPresetById(presetId);
      if (!preset) return false;

      const device = { presetId, webviewLabel: null };
      activeDevices.push(device);

      const url = previewUrl || 'about:blank';
      const w = orientation === 'portrait' ? preset.width : preset.height;
      const h = orientation === 'portrait' ? preset.height : preset.width;

      try {
        const result = await lensCreateDeviceWebview({
          presetId,
          url,
          width: w,
          height: h,
          x: bounds?.x ?? 0,
          y: bounds?.y ?? 0,
        });
        const d = activeDevices.find(d => d.presetId === presetId);
        if (d && result?.data?.label) {
          d.webviewLabel = result.data.label;
        }
        return true;
      } catch (err) {
        console.error('[device-preview] Failed to create device webview:', err);
        const idx = activeDevices.findIndex(d => d.presetId === presetId);
        if (idx !== -1) activeDevices.splice(idx, 1);
        return false;
      }
    },

    /**
     * Remove a device from the preview.
     * @param {string} presetId
     */
    async removeDevice(presetId) {
      const idx = activeDevices.findIndex(d => d.presetId === presetId);
      if (idx === -1) return;
      const device = activeDevices[idx];
      if (device.webviewLabel) {
        try {
          await lensCloseDeviceWebview(device.webviewLabel);
        } catch (err) {
          console.error('[device-preview] Failed to close device webview:', err);
        }
      }
      activeDevices.splice(idx, 1);
    },

    /** Remove all devices and close all webviews. */
    async removeAllDevices() {
      try {
        await lensCloseAllDeviceWebviews();
      } catch (err) {
        console.error('[device-preview] Failed to close all device webviews:', err);
      }
      activeDevices.length = 0;
    },

    toggleOrientation() {
      orientation = orientation === 'portrait' ? 'landscape' : 'portrait';
    },

    /** @param {string} url */
    setPreviewUrl(url) {
      previewUrl = url;
    },

    toggleSync() {
      syncEnabled = !syncEnabled;
    },

  };
}

export const devicePreviewStore = createDevicePreviewStore();
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "device-preview store"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/stores/device-preview.svelte.js test/stores/device-preview.test.cjs
git commit -m "feat(device-preview): add reactive store for device preview state"
```

---

### Task 3: Add Rust commands for device WebView2 lifecycle

**Files:**
- Modify: `src-tauri/src/commands/lens.rs`
- Modify: `src-tauri/src/lib.rs` (line ~342, command registration)
- Create: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Create `test/components/device-preview.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lensSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lens.rs'), 'utf-8');
const libSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');

describe('lens.rs: device preview state', () => {
  it('has DeviceWebview struct', () => {
    assert.ok(lensSrc.includes('pub struct DeviceWebview'), 'Should have DeviceWebview struct');
  });

  it('LensState has device_webviews field', () => {
    assert.ok(lensSrc.includes('device_webviews'), 'LensState should track device webviews');
  });

  it('has MAX_DEVICE_WEBVIEWS constant', () => {
    assert.ok(lensSrc.includes('MAX_DEVICE_WEBVIEWS'), 'Should limit device webview count');
  });
});

describe('lens.rs: device preview commands', () => {
  it('has lens_create_device_webview command', () => {
    assert.ok(lensSrc.includes('pub async fn lens_create_device_webview'), 'Should have create command');
  });

  it('has lens_close_device_webview command', () => {
    assert.ok(lensSrc.includes('pub fn lens_close_device_webview'), 'Should have close command');
  });

  it('has lens_close_all_device_webviews command', () => {
    assert.ok(lensSrc.includes('pub fn lens_close_all_device_webviews'), 'Should have close-all command');
  });

  it('has lens_resize_device_webview command', () => {
    assert.ok(lensSrc.includes('pub fn lens_resize_device_webview'), 'Should have resize command');
  });
});

describe('lib.rs: device preview commands registered', () => {
  it('registers lens_create_device_webview', () => {
    assert.ok(libSrc.includes('lens_create_device_webview'), 'Should register create command');
  });

  it('registers lens_close_device_webview', () => {
    assert.ok(libSrc.includes('lens_close_device_webview'), 'Should register close command');
  });

  it('registers lens_close_all_device_webviews', () => {
    assert.ok(libSrc.includes('lens_close_all_device_webviews'), 'Should register close-all command');
  });

  it('registers lens_resize_device_webview', () => {
    assert.ok(libSrc.includes('lens_resize_device_webview'), 'Should register resize command');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "device preview"`
Expected: FAIL

**Step 3: Add DeviceWebview struct and device_webviews to LensState**

In `src-tauri/src/commands/lens.rs`, after the existing `BrowserTab` struct (~line 12) and before `LensState` (~line 16), add:

```rust
/// Maximum number of device preview WebView2 instances.
const MAX_DEVICE_WEBVIEWS: usize = 5;

/// A device preview WebView2 instance.
pub struct DeviceWebview {
    pub preset_id: String,
    pub webview_label: String,
}
```

Add to `LensState` struct:

```rust
pub struct LensState {
    pub tabs: Mutex<HashMap<String, BrowserTab>>,
    pub active_tab_id: Mutex<Option<String>>,
    pub bounds: Mutex<Option<(f64, f64, f64, f64)>>,
    pub device_webviews: Mutex<Vec<DeviceWebview>>,
}
```

Update the `LensState::default()` or initialization to include `device_webviews: Mutex::new(Vec::new())`.

**Step 4: Add the four device preview commands**

Append to `src-tauri/src/commands/lens.rs`:

```rust
#[tauri::command]
pub async fn lens_create_device_webview(
    app: AppHandle,
    preset_id: String,
    url: String,
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    info!("[lens] Creating device webview {} at ({}, {}) {}x{}", preset_id, x, y, width, height);

    {
        let devices = state.device_webviews.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if devices.len() >= MAX_DEVICE_WEBVIEWS {
            return Ok(IpcResponse::err(format!("Maximum {} device previews reached", MAX_DEVICE_WEBVIEWS)));
        }
        if devices.iter().any(|d| d.preset_id == preset_id) {
            return Ok(IpcResponse::err(format!("Device {} already active", preset_id)));
        }
    }

    let label = format!("device-{}", preset_id);
    // Reuse create_tab_webview helper but with device-specific label
    let webview_label = create_tab_webview(&app, &label, &url, x, y, width, height).await?;

    {
        let mut devices = state.device_webviews.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        devices.push(DeviceWebview {
            preset_id: preset_id.clone(),
            webview_label: webview_label.clone(),
        });
    }

    Ok(IpcResponse::ok(serde_json::json!({
        "label": webview_label,
        "presetId": preset_id
    })))
}

#[tauri::command]
pub fn lens_close_device_webview(
    app: AppHandle,
    label: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let mut devices = match state.device_webviews.lock() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
    };

    if let Some(idx) = devices.iter().position(|d| d.webview_label == label) {
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.close();
        }
        devices.remove(idx);
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err(format!("Device webview {} not found", label))
    }
}

#[tauri::command]
pub fn lens_close_all_device_webviews(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let mut devices = match state.device_webviews.lock() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
    };

    for device in devices.iter() {
        if let Some(webview) = app.get_webview(&device.webview_label) {
            let _ = webview.close();
        }
    }
    devices.clear();
    IpcResponse::ok_empty()
}

#[tauri::command]
pub fn lens_resize_device_webview(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let devices = match state.device_webviews.lock() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
    };

    if let Some(device) = devices.iter().find(|d| d.webview_label == label) {
        if let Some(webview) = app.get_webview(&device.webview_label) {
            if let Err(e) = webview.set_position(Position::Logical(LogicalPosition::new(x, y))) {
                return IpcResponse::err(format!("Failed to set position: {}", e));
            }
            if let Err(e) = webview.set_size(Size::Logical(LogicalSize::new(width, height))) {
                return IpcResponse::err(format!("Failed to set size: {}", e));
            }
            IpcResponse::ok_empty()
        } else {
            IpcResponse::err(format!("WebView2 {} not found", device.webview_label))
        }
    } else {
        IpcResponse::err(format!("Device {} not found", label))
    }
}
```

**Step 5: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, after `lens_cmds::lens_clear_cache,` (~line 354), add:

```rust
            // Device Preview
            lens_cmds::lens_create_device_webview,
            lens_cmds::lens_close_device_webview,
            lens_cmds::lens_close_all_device_webviews,
            lens_cmds::lens_resize_device_webview,
```

**Step 6: Run tests and verify Rust compiles**

Run: `npm test -- --test-name-pattern "device preview"` and `cd src-tauri && cargo check`
Expected: JS tests PASS, Rust compiles clean

**Step 7: Commit**

```bash
git add src-tauri/src/commands/lens.rs src-tauri/src/lib.rs test/components/device-preview.test.cjs
git commit -m "feat(device-preview): add Rust commands for device WebView2 lifecycle"
```

---

### Task 4: Add API wrappers for device preview commands

**Files:**
- Modify: `src/lib/api.js` (after lens section, ~line 401)
- Modify: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Append to `test/components/device-preview.test.cjs`:

```js
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "api.js: device preview"`
Expected: FAIL

**Step 3: Add API wrappers**

In `src/lib/api.js`, after the Browser Tabs section (~line 401), add:

```js
// ============ Device Preview ============

export async function lensCreateDeviceWebview({ presetId, url, width, height, x, y }) {
  return invoke('lens_create_device_webview', { presetId, url, width, height, x, y });
}

export async function lensCloseDeviceWebview(label) {
  return invoke('lens_close_device_webview', { label });
}

export async function lensCloseAllDeviceWebviews() {
  return invoke('lens_close_all_device_webviews');
}

export async function lensResizeDeviceWebview(label, x, y, width, height) {
  return invoke('lens_resize_device_webview', { label, x, y, width, height });
}
```

**Step 4: Run tests**

Run: `npm test -- --test-name-pattern "device preview"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/api.js test/components/device-preview.test.cjs
git commit -m "feat(device-preview): add API wrappers for device WebView2 commands"
```

---

### Task 5: Create DevicePickerMenu component

**Files:**
- Create: `src/components/lens/DevicePickerMenu.svelte`
- Create: `test/components/device-picker-menu.test.cjs`

**Step 1: Write the failing test**

Create `test/components/device-picker-menu.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePickerMenu.svelte'), 'utf-8');

describe('DevicePickerMenu: imports', () => {
  it('imports DEVICE_PRESETS and DEVICE_CATEGORIES', () => {
    assert.ok(src.includes('DEVICE_PRESETS'), 'Should import DEVICE_PRESETS');
    assert.ok(src.includes('DEVICE_CATEGORIES'), 'Should import DEVICE_CATEGORIES');
  });

  it('imports devicePreviewStore', () => {
    assert.ok(src.includes('devicePreviewStore'), 'Should import store');
  });
});

describe('DevicePickerMenu: props', () => {
  it('accepts onClose prop', () => {
    assert.ok(src.includes('onClose'), 'Should have onClose prop');
  });
});

describe('DevicePickerMenu: rendering', () => {
  it('renders category headers', () => {
    assert.ok(src.includes('category-header'), 'Should have category headers');
  });

  it('renders device items with checkboxes', () => {
    assert.ok(src.includes('device-item'), 'Should have device items');
    assert.ok(src.includes('type="checkbox"') || src.includes('checkbox'), 'Should have checkboxes');
  });

  it('shows device dimensions', () => {
    assert.ok(src.includes('preset.width') && src.includes('preset.height'), 'Should show dimensions');
  });

  it('has picker-menu class', () => {
    assert.ok(src.includes('picker-menu'), 'Should have picker-menu class');
  });

  it('has backdrop for closing', () => {
    assert.ok(src.includes('backdrop') || src.includes('onClose'), 'Should close on backdrop click');
  });

  it('disables add when at max', () => {
    assert.ok(src.includes('MAX_DEVICES') || src.includes('canAddDevice'), 'Should respect device limit');
  });
});

describe('DevicePickerMenu: styles', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have style block');
  });

  it('uses CSS variables', () => {
    assert.ok(src.includes('var(--'), 'Should use CSS variables');
  });

  it('opens upward (above the strip)', () => {
    assert.ok(src.includes('bottom') && src.includes('position'), 'Should position upward');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement DevicePickerMenu**

Create `src/components/lens/DevicePickerMenu.svelte`. This is a dropdown that opens upward from the [+] button, grouped by category, with checkboxes for multi-select. The component should:

- Import `DEVICE_PRESETS`, `DEVICE_CATEGORIES` from `device-presets.js`
- Import `devicePreviewStore`
- Group presets by category using `DEVICE_CATEGORIES` order
- Show a checkbox for each device, checked if already active
- Show device name and dimensions (e.g. "iPhone 15 — 393×852")
- Disable checkbox when `activeDevices.length >= MAX_DEVICES` and device not already selected
- Call `devicePreviewStore.addDevice(presetId)` on check, `removeDevice(presetId)` on uncheck
- Position with `position: absolute; bottom: 100%` to open upward
- Backdrop click calls `onClose()`
- Use standard Voice Mirror CSS vars (`--bg-elevated`, `--border`, `--text`, `--muted`, `--accent`)

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git add src/components/lens/DevicePickerMenu.svelte test/components/device-picker-menu.test.cjs
git commit -m "feat(device-preview): add DevicePickerMenu dropdown component"
```

---

### Task 6: Create DevicePreviewStrip component

**Files:**
- Create: `src/components/lens/DevicePreviewStrip.svelte`
- Create: `test/components/device-preview-strip.test.cjs`

**Step 1: Write the failing test**

Create `test/components/device-preview-strip.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePreviewStrip.svelte'), 'utf-8');

describe('DevicePreviewStrip: imports', () => {
  it('imports devicePreviewStore', () => {
    assert.ok(src.includes('devicePreviewStore'), 'Should import store');
  });

  it('imports getPresetById', () => {
    assert.ok(src.includes('getPresetById'), 'Should import getPresetById');
  });

  it('imports DevicePickerMenu', () => {
    assert.ok(src.includes('DevicePickerMenu'), 'Should import picker');
  });
});

describe('DevicePreviewStrip: rendering', () => {
  it('has device-strip class', () => {
    assert.ok(src.includes('device-strip'), 'Should have device-strip class');
  });

  it('renders device chips with close button', () => {
    assert.ok(src.includes('device-chip'), 'Should have device chips');
    assert.ok(src.includes('removeDevice'), 'Chips should have remove action');
  });

  it('has add device button', () => {
    assert.ok(src.includes('add-device') || src.includes('add-btn'), 'Should have add button');
  });

  it('has orientation toggle', () => {
    assert.ok(src.includes('toggleOrientation'), 'Should have orientation toggle');
  });

  it('has sync toggle', () => {
    assert.ok(src.includes('toggleSync'), 'Should have sync toggle');
  });

  it('shows picker menu on add click', () => {
    assert.ok(src.includes('showPicker') || src.includes('pickerVisible'), 'Should toggle picker visibility');
  });
});

describe('DevicePreviewStrip: styles', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have style block');
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement DevicePreviewStrip**

Create `src/components/lens/DevicePreviewStrip.svelte`. This is the thin control bar at the bottom of the device preview pane:

- Left side: device chips (each shows preset name + ✕ close button) + [+] add button
- Right side: orientation toggle (🔄) + sync toggle
- Chip click removes the device
- [+] button toggles `DevicePickerMenu` visibility (positioned above the strip)
- Uses `devicePreviewStore` for all state/actions
- Height ~30px, uses `--bg-elevated` background, `--border` top border
- All interactive elements get `-webkit-app-region: no-drag`

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git add src/components/lens/DevicePreviewStrip.svelte test/components/device-preview-strip.test.cjs
git commit -m "feat(device-preview): add DevicePreviewStrip control bar component"
```

---

### Task 7: Create DevicePreview main panel component

**Files:**
- Create: `src/components/lens/DevicePreview.svelte`
- Append to: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Append to `test/components/device-preview.test.cjs`:

```js
const componentSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePreview.svelte'), 'utf-8');

describe('DevicePreview.svelte: imports', () => {
  it('imports devicePreviewStore', () => {
    assert.ok(componentSrc.includes('devicePreviewStore'), 'Should import store');
  });

  it('imports DevicePreviewStrip', () => {
    assert.ok(componentSrc.includes('DevicePreviewStrip'), 'Should import strip');
  });

  it('imports getPresetById', () => {
    assert.ok(componentSrc.includes('getPresetById'), 'Should import getPresetById');
  });
});

describe('DevicePreview.svelte: structure', () => {
  it('has device-preview class', () => {
    assert.ok(componentSrc.includes('device-preview'), 'Should have main container');
  });

  it('has device-grid class', () => {
    assert.ok(componentSrc.includes('device-grid'), 'Should have scrollable grid');
  });

  it('has device-frame class', () => {
    assert.ok(componentSrc.includes('device-frame'), 'Should have device frames');
  });

  it('has empty state', () => {
    assert.ok(componentSrc.includes('No devices selected') || componentSrc.includes('Click'), 'Should have empty state');
  });

  it('shows device label', () => {
    assert.ok(componentSrc.includes('device-label'), 'Should show device name/dimensions');
  });

  it('includes DevicePreviewStrip at bottom', () => {
    assert.ok(componentSrc.includes('DevicePreviewStrip'), 'Should render strip');
  });
});

describe('DevicePreview.svelte: WebView2 positioning', () => {
  it('uses ResizeObserver for bounds tracking', () => {
    assert.ok(componentSrc.includes('ResizeObserver'), 'Should track container bounds');
  });

  it('calls resize API for device webviews', () => {
    assert.ok(componentSrc.includes('lensResizeDeviceWebview') || componentSrc.includes('Resize'), 'Should resize webviews on layout change');
  });
});

describe('DevicePreview.svelte: styles', () => {
  it('has scoped styles', () => {
    assert.ok(componentSrc.includes('<style>'), 'Should have style block');
  });

  it('grid is scrollable', () => {
    assert.ok(componentSrc.includes('overflow'), 'Grid should scroll');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement DevicePreview**

Create `src/components/lens/DevicePreview.svelte`. This is the main preview panel:

- Layout: flex column, `device-grid` (flex: 1, overflow-y: auto) + `DevicePreviewStrip` (bottom)
- When no devices: empty state "No devices selected — Click + to add devices"
- When devices active: render `device-frame` for each, containing a placeholder div where the native WebView2 renders
- Each device-frame tracks its container bounds via `ResizeObserver` → calls `lensResizeDeviceWebview` to position the native WebView2 at the correct screen coordinates
- Scale calculation: `Math.min(frameWidth / deviceWidth, frameHeight / deviceHeight)` — each frame scales to fit
- Device label below each frame: "iPhone 15 — 393×852"
- Grid layout: CSS grid with `auto-fill` and `minmax()` for responsive arrangement
- Import `onMount`, `onDestroy` for lifecycle management
- Clean up: `onDestroy` closes all device webviews

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git add src/components/lens/DevicePreview.svelte test/components/device-preview.test.cjs
git commit -m "feat(device-preview): add DevicePreview main panel component"
```

---

### Task 8: Add device preview button to GroupTabBar

**Files:**
- Modify: `src/components/lens/GroupTabBar.svelte` (lines 9, 318-332)
- Modify: `src/components/lens/EditorPane.svelte` (line 9, 109)
- Modify: `src/components/lens/LensWorkspace.svelte` (lines 245, 299)
- Append to: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Append to `test/components/device-preview.test.cjs`:

```js
const groupTabBarSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/GroupTabBar.svelte'), 'utf-8');
const editorPaneSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/EditorPane.svelte'), 'utf-8');

describe('GroupTabBar.svelte: device preview button', () => {
  it('accepts onDevicePreviewClick prop', () => {
    assert.ok(groupTabBarSrc.includes('onDevicePreviewClick'), 'Should accept device preview click handler');
  });

  it('has device preview button in editor-actions', () => {
    assert.ok(groupTabBarSrc.includes('device-preview-btn') || groupTabBarSrc.includes('Device Preview'), 'Should have device preview button');
  });
});

describe('EditorPane.svelte: device preview prop passthrough', () => {
  it('accepts onDevicePreviewClick prop', () => {
    assert.ok(editorPaneSrc.includes('onDevicePreviewClick'), 'Should pass through device preview handler');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Wire the button through the component chain**

**GroupTabBar.svelte** — Add `onDevicePreviewClick` to props (line 9), and add a new button before the split editor button (line 318):

```svelte
{#if onDevicePreviewClick}
  <button class="action-btn" class:active={showDevicePreview} onclick={onDevicePreviewClick} aria-label="Device Preview" title="Device Preview">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  </button>
{/if}
```

Also add `showDevicePreview = false` to props.

**EditorPane.svelte** — Add `onDevicePreviewClick = null` and `showDevicePreview = false` to props (line 9), pass to GroupTabBar (line 109).

**LensWorkspace.svelte** — In the EditorPane rendering (lines 245, 299), pass `onDevicePreviewClick` and `showDevicePreview` props from the first group only (like `onBrowserClick`).

**Step 4: Run tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/components/lens/GroupTabBar.svelte src/components/lens/EditorPane.svelte src/components/lens/LensWorkspace.svelte test/components/device-preview.test.cjs
git commit -m "feat(device-preview): add device preview button to editor toolbar"
```

---

### Task 9: Integrate DevicePreview pane into LensWorkspace layout

**Files:**
- Modify: `src/components/lens/LensWorkspace.svelte` (import DevicePreview, add split pane logic)
- Append to: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Append to `test/components/device-preview.test.cjs`:

```js
const workspaceSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'), 'utf-8');

describe('LensWorkspace.svelte: device preview integration', () => {
  it('imports DevicePreview component', () => {
    assert.ok(workspaceSrc.includes('DevicePreview'), 'Should import DevicePreview');
  });

  it('imports devicePreviewStore', () => {
    assert.ok(workspaceSrc.includes('devicePreviewStore'), 'Should import store');
  });

  it('has device preview state or uses store isOpen', () => {
    assert.ok(
      workspaceSrc.includes('devicePreviewStore.isOpen') || workspaceSrc.includes('showDevicePreview'),
      'Should track device preview open state'
    );
  });

  it('wraps editor in split panel for device preview', () => {
    assert.ok(workspaceSrc.includes('DevicePreview'), 'Should render DevicePreview in layout');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Integrate into LensWorkspace**

In `src/components/lens/LensWorkspace.svelte`:

1. Import `DevicePreview` and `devicePreviewStore`
2. Add a `devicePreviewRatio` state for the split (default `0.5`)
3. Wrap the `.preview-area` content in a new horizontal `SplitPanel` that shows `[editor-grid | DevicePreview]` when `devicePreviewStore.isOpen` is true. When closed, the SplitPanel collapses the right side (DevicePreview).
4. Wire `onDevicePreviewClick` on EditorPane to toggle `devicePreviewStore.toggle()`:

```svelte
onDevicePreviewClick={node.groupId === firstGroupId ? () => { devicePreviewStore.toggle(); } : null}
showDevicePreview={node.groupId === firstGroupId ? devicePreviewStore.isOpen : false}
```

**Step 4: Run tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/components/lens/LensWorkspace.svelte test/components/device-preview.test.cjs
git commit -m "feat(device-preview): integrate DevicePreview pane into LensWorkspace layout"
```

---

### Task 10: Add interaction sync (scroll, click, input)

**Files:**
- Create: `src/lib/device-sync.js`
- Create: `test/lib/device-sync.test.cjs`
- Modify: `src/components/lens/DevicePreview.svelte` (inject sync script)

**Step 1: Write the failing test**

Create `test/lib/device-sync.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/lib/device-sync.js'), 'utf-8');

describe('device-sync.js: exports', () => {
  it('exports SYNC_SCRIPT constant', () => {
    assert.ok(src.includes('export const SYNC_SCRIPT'), 'Should export injectable sync script');
  });

  it('exports REPLAY_SCROLL_SCRIPT function', () => {
    assert.ok(src.includes('export function replayScrollScript'), 'Should export scroll replay builder');
  });

  it('exports REPLAY_CLICK_SCRIPT function', () => {
    assert.ok(src.includes('export function replayClickScript'), 'Should export click replay builder');
  });
});

describe('device-sync.js: sync script content', () => {
  it('listens for scroll events', () => {
    assert.ok(src.includes('scroll'), 'Should capture scroll');
  });

  it('listens for click events', () => {
    assert.ok(src.includes('click'), 'Should capture click');
  });

  it('uses debounce for scroll', () => {
    assert.ok(src.includes('requestAnimationFrame') || src.includes('setTimeout'), 'Should debounce scroll');
  });

  it('uses CSS selector for click targeting', () => {
    assert.ok(src.includes('querySelector') || src.includes('selector'), 'Should use selector-based click');
  });

  it('communicates via window.__deviceSync', () => {
    assert.ok(src.includes('__deviceSync'), 'Should use window.__deviceSync namespace');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement device-sync.js**

Create `src/lib/device-sync.js`. This module provides:

- `SYNC_SCRIPT` — JS string to inject into each device WebView2. It:
  - Captures `scroll` events (debounced via `requestAnimationFrame`), records `scrollTop / scrollHeight` ratio
  - Captures `click` events, generates a CSS selector path for the clicked element
  - Stores last event in `window.__deviceSync.lastEvent` for Rust to poll via `evaluate_js`
- `replayScrollScript(scrollPercent)` — Returns JS string that scrolls to the given percentage
- `replayClickScript(selector)` — Returns JS string that clicks the element matching the selector

The sync coordinator in DevicePreview.svelte will poll each device's `window.__deviceSync.lastEvent` periodically (every 100ms) and replay to siblings.

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git add src/lib/device-sync.js test/lib/device-sync.test.cjs
git commit -m "feat(device-preview): add interaction sync script module"
```

---

### Task 11: Wire sync into DevicePreview component

**Files:**
- Modify: `src/components/lens/DevicePreview.svelte`
- Append to: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Append to `test/components/device-preview.test.cjs`:

```js
// Re-read the component after modifications
const componentSrcV2 = fs.readFileSync(path.join(__dirname, '../../src/components/lens/DevicePreview.svelte'), 'utf-8');

describe('DevicePreview.svelte: interaction sync', () => {
  it('imports SYNC_SCRIPT', () => {
    assert.ok(componentSrcV2.includes('SYNC_SCRIPT'), 'Should import sync script');
  });

  it('imports replayScrollScript', () => {
    assert.ok(componentSrcV2.includes('replayScrollScript'), 'Should import scroll replay');
  });

  it('injects sync script on device creation', () => {
    assert.ok(componentSrcV2.includes('SYNC_SCRIPT') && componentSrcV2.includes('evaluate'), 'Should inject sync JS');
  });

  it('has sync polling interval', () => {
    assert.ok(componentSrcV2.includes('setInterval') || componentSrcV2.includes('poll'), 'Should poll for sync events');
  });

  it('respects syncEnabled toggle', () => {
    assert.ok(componentSrcV2.includes('syncEnabled'), 'Should check sync toggle');
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Wire sync logic**

In `DevicePreview.svelte`, add:

1. Import `SYNC_SCRIPT`, `replayScrollScript`, `replayClickScript` from `device-sync.js`
2. After creating each device WebView2, inject `SYNC_SCRIPT` via Tauri `invoke('lens_eval_device_js', { label, js: SYNC_SCRIPT })`
3. Start a 100ms polling interval that:
   - For each device, calls `invoke('lens_eval_device_js', { label, js: 'JSON.stringify(window.__deviceSync?.lastEvent || null)' })`
   - If an event is found, replays it to all other devices
   - Clears the event after relaying
4. Only poll when `devicePreviewStore.syncEnabled` is true
5. Clean up interval on destroy

**Note:** This task also requires a new Rust command `lens_eval_device_js` that runs `evaluate_js` on a specific device webview by label. Add it to `lens.rs`, register in `lib.rs`, and add an API wrapper.

**Step 4: Run tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/components/lens/DevicePreview.svelte src-tauri/src/commands/lens.rs src-tauri/src/lib.rs src/lib/api.js test/components/device-preview.test.cjs
git commit -m "feat(device-preview): wire interaction sync into DevicePreview component"
```

---

### Task 12: Add DevicePreviewConfig to config schema

**Files:**
- Modify: `src-tauri/src/config/schema.rs`
- Modify: `src/lib/stores/config.svelte.js` (add `devicePreview` to `DEFAULT_CONFIG`)
- Append to: `test/components/device-preview.test.cjs`

**Step 1: Write the failing test**

Append to `test/components/device-preview.test.cjs`:

```js
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
```

**Step 2: Run test — FAIL**

**Step 3: Add config**

**schema.rs** — Add before `AppConfig`:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePreviewConfig {
    #[serde(default)]
    pub custom_devices: Vec<serde_json::Value>,
    #[serde(default)]
    pub last_devices: Vec<String>,
    #[serde(default)]
    pub sync_enabled: Option<bool>,
    #[serde(default)]
    pub orientation: Option<String>,
}
```

Add to `AppConfig`:

```rust
    #[serde(default)]
    pub device_preview: DevicePreviewConfig,
```

**config.svelte.js** — Add to `DEFAULT_CONFIG`:

```js
    devicePreview: {
      customDevices: [],
      lastDevices: [],
      syncEnabled: true,
      orientation: 'portrait',
    },
```

**Step 4: Run tests**

Run: `npm test` and `cd src-tauri && cargo check`
Expected: All pass, Rust compiles

**Step 5: Commit**

```bash
git add src-tauri/src/config/schema.rs src/lib/stores/config.svelte.js test/components/device-preview.test.cjs
git commit -m "feat(device-preview): add DevicePreviewConfig to config schema"
```

---

### Task 13: Run full test suite and verify compilation

**Step 1: Run npm tests**

Run: `npm test`
Expected: All tests pass (4600+)

**Step 2: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation

**Step 3: Visual verification**

Run: `npm run dev`
1. Open a project with a dev server
2. Click the 📱 button in the editor toolbar
3. Device preview pane opens with empty state and control strip
4. Click [+], select iPhone 15 and iPad Air
5. Both devices render the dev server URL
6. Scroll on one device — the other scrolls too
7. Click 📱 again — pane closes, chat re-expands

---

## Summary of all files

### New files (8)

| File | Purpose |
|------|---------|
| `src/lib/device-presets.js` | Device catalog registry (23 built-in presets) |
| `src/lib/device-sync.js` | Interaction sync script (inject + replay) |
| `src/lib/stores/device-preview.svelte.js` | Reactive store for device preview state |
| `src/components/lens/DevicePreview.svelte` | Main preview pane with device grid |
| `src/components/lens/DevicePreviewStrip.svelte` | Bottom control strip |
| `src/components/lens/DevicePickerMenu.svelte` | Device picker dropdown |
| `test/lib/device-presets.test.mjs` | Unit tests for device presets |
| `test/lib/device-sync.test.cjs` | Source inspection tests for sync module |

### Modified files (8)

| File | Change |
|------|--------|
| `src/components/lens/GroupTabBar.svelte` | Add 📱 button to `.editor-actions` |
| `src/components/lens/EditorPane.svelte` | Pass `onDevicePreviewClick` + `showDevicePreview` props |
| `src/components/lens/LensWorkspace.svelte` | Add DevicePreview split pane |
| `src-tauri/src/commands/lens.rs` | Add `DeviceWebview`, 5 new commands |
| `src-tauri/src/lib.rs` | Register 5 new commands |
| `src/lib/api.js` | Add 5 new invoke wrappers |
| `src-tauri/src/config/schema.rs` | Add `DevicePreviewConfig` |
| `src/lib/stores/config.svelte.js` | Add `devicePreview` to DEFAULT_CONFIG |

### Test files (5)

| File | Tests |
|------|-------|
| `test/lib/device-presets.test.mjs` | 15+ tests for preset registry |
| `test/stores/device-preview.test.cjs` | 15+ tests for store |
| `test/components/device-preview.test.cjs` | 30+ tests for Rust commands, API, components, config |
| `test/components/device-picker-menu.test.cjs` | 10+ tests for picker |
| `test/components/device-preview-strip.test.cjs` | 10+ tests for strip |
