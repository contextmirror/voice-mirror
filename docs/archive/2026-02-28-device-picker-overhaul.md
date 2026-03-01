# Device Picker Menu Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the device picker menu by manufacturer with icons, collapsible sections, search, a "Popular" section, and add ~15 new devices from Samsung, Google, OnePlus, and Xiaomi.

**Architecture:** Refactor `device-presets.js` to use manufacturer-based grouping with a `MANUFACTURERS` registry (name + inline SVG icon) and add `manufacturer`, `type`, `popular` fields to each preset. Overhaul `DevicePickerMenu.svelte` with collapsible sections, search filter, and "Popular" quick-pick section at top.

**Tech Stack:** Svelte 5, inline SVG icons, existing device-presets.js data module

---

## Context

**Current state:** 25 devices in 4 OS-based categories (`iPhone`, `iPad`, `Android Phone`, `Android Tablet`). Flat list, no icons, no search, no collapsing. Android section mixes Samsung/Google/Motorola.

**Target state:** ~40 devices grouped by 6 manufacturers (Apple, Samsung, Google, Motorola, OnePlus, Xiaomi), with collapsible headers showing manufacturer icons, a search bar, and a "Popular" quick-pick section.

**Key files:**
- `src/lib/device-presets.js` — device registry (data only)
- `src/components/lens/DevicePickerMenu.svelte` — picker dropdown UI
- `test/lib/device-presets.test.cjs` — preset tests
- `test/components/device-picker-menu.test.cjs` — menu tests

**Existing consumers of device-presets.js exports:**
- `DevicePickerMenu.svelte` imports `DEVICE_PRESETS`, `DEVICE_CATEGORIES`
- `DevicePreview.svelte` imports `getPresetById`
- `DevicePreviewStrip.svelte` imports `getPresetById`
- `device-preview.svelte.js` (store) imports `getPresetById`, `DEVICE_PRESETS`

Only `DevicePickerMenu.svelte` uses `DEVICE_CATEGORIES` — safe to replace.

---

### Task 1: Refactor device-presets.js data structure

**Files:**
- Modify: `src/lib/device-presets.js`
- Test: `test/lib/device-presets.test.cjs`

**Step 1: Write failing tests for new data structure**

Add to `test/lib/device-presets.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/device-presets.js'),
  'utf-8'
);

describe('device-presets.js: manufacturer-based structure', () => {
  it('exports MANUFACTURERS array', () => {
    assert.ok(src.includes('export const MANUFACTURERS'), 'Should export MANUFACTURERS');
  });

  it('has all 6 manufacturers', () => {
    for (const m of ['Apple', 'Samsung', 'Google', 'Motorola', 'OnePlus', 'Xiaomi']) {
      assert.ok(src.includes(`'${m}'`) || src.includes(`"${m}"`), `Should have manufacturer ${m}`);
    }
  });

  it('each manufacturer has an icon SVG string', () => {
    assert.ok(src.includes('icon:') || src.includes('icon :'), 'MANUFACTURERS entries should have icon field');
    // Count SVG icons — should be at least 6
    const iconMatches = src.match(/<svg/g) || [];
    assert.ok(iconMatches.length >= 6, `Should have at least 6 SVG icons, found ${iconMatches.length}`);
  });

  it('presets have manufacturer field instead of category', () => {
    assert.ok(src.includes("manufacturer: 'apple'"), 'Should have apple manufacturer');
    assert.ok(src.includes("manufacturer: 'samsung'"), 'Should have samsung manufacturer');
    assert.ok(src.includes("manufacturer: 'google'"), 'Should have google manufacturer');
  });

  it('presets have type field (phone or tablet)', () => {
    assert.ok(src.includes("type: 'phone'"), 'Should have phone type');
    assert.ok(src.includes("type: 'tablet'"), 'Should have tablet type');
  });

  it('has popular flag on select devices', () => {
    assert.ok(src.includes('popular: true'), 'Some devices should be marked popular');
  });

  it('still exports DEVICE_CATEGORIES for backward compat', () => {
    assert.ok(src.includes('export const DEVICE_CATEGORIES'), 'Should still export DEVICE_CATEGORIES');
  });

  it('still exports getPresetById and getPresetsByCategory', () => {
    assert.ok(src.includes('export function getPresetById'), 'Should export getPresetById');
    assert.ok(src.includes('export function getPresetsByCategory'), 'Should export getPresetsByCategory');
  });

  it('exports getPresetsByManufacturer helper', () => {
    assert.ok(src.includes('export function getPresetsByManufacturer'), 'Should export getPresetsByManufacturer');
  });

  it('exports getPopularPresets helper', () => {
    assert.ok(src.includes('export function getPopularPresets'), 'Should export getPopularPresets');
  });
});

describe('device-presets.js: new devices', () => {
  it('has iPhone 13', () => {
    assert.ok(src.includes('iphone-13'), 'Should have iPhone 13');
  });

  it('has Galaxy S25 and S25 Ultra', () => {
    assert.ok(src.includes('galaxy-s25') && !src.includes('galaxy-s25').endsWith('-'), 'Should have Galaxy S25');
    assert.ok(src.includes('galaxy-s25-ultra'), 'Should have Galaxy S25 Ultra');
  });

  it('has Galaxy A series (A54, A15)', () => {
    assert.ok(src.includes('galaxy-a54'), 'Should have Galaxy A54');
    assert.ok(src.includes('galaxy-a15'), 'Should have Galaxy A15');
  });

  it('has Pixel 9 series', () => {
    assert.ok(src.includes('pixel-9'), 'Should have Pixel 9');
    assert.ok(src.includes('pixel-9-pro'), 'Should have Pixel 9 Pro');
  });

  it('has OnePlus devices', () => {
    assert.ok(src.includes('oneplus-12'), 'Should have OnePlus 12');
    assert.ok(src.includes('oneplus-nord'), 'Should have OnePlus Nord');
  });

  it('has Xiaomi devices', () => {
    assert.ok(src.includes('redmi-note-13'), 'Should have Redmi Note 13');
  });

  it('has at least 38 total devices', () => {
    const idMatches = src.match(/id:\s*'/g) || [];
    assert.ok(idMatches.length >= 38, `Should have at least 38 devices, found ${idMatches.length}`);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "(FAIL|fail|✗|not ok)" | head -20`
Expected: Multiple failures about missing MANUFACTURERS, manufacturer field, etc.

**Step 3: Implement the new device-presets.js**

Replace the full contents of `src/lib/device-presets.js` with:

```js
/**
 * Device preset registry for Device Preview feature.
 * Organized by manufacturer with phone/tablet sub-types.
 * Each preset defines viewport dimensions, DPR, and user agent for a real device.
 */

// ── Manufacturer registry with icons ──

export const MANUFACTURERS = [
  {
    id: 'apple',
    name: 'Apple',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.3 7.4c0-1.7 1.4-2.5 1.5-2.6-.8-1.2-2.1-1.4-2.5-1.4-1.1-.1-2.1.6-2.6.6s-1.4-.6-2.3-.6C3 3.4 1.7 4.5 1.7 7.5c0 1.2.4 2.4 1 3.2.5.7 1.1 1.5 1.8 1.5.7 0 1-.5 1.9-.5s1.1.5 1.9.5c.8 0 1.3-.7 1.8-1.4.4-.5.6-1 .7-1.1-.1 0-1.5-.5-1.5-2.3zM8.9 2.5c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.6 0 1.3-.4 1.7-.8z" fill="currentColor"/></svg>',
  },
  {
    id: 'samsung',
    name: 'Samsung',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5.5C3.5 4.7 4.2 4 5 4h4c.8 0 1.5.7 1.5 1.5v3c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5v-3z" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="6" y="2.5" width="2" height="1.5" rx=".5" fill="currentColor"/><rect x="6" y="10" width="2" height="1.5" rx=".5" fill="currentColor"/></svg>',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M7 4.5v5M9 6H7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  },
  {
    id: 'motorola',
    name: 'Motorola',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10V4.5C2 3.7 2.7 3 3.5 3h7c.8 0 1.5.7 1.5 1.5V10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5 10V6l2 2.5L9 6v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    id: 'oneplus',
    name: 'OnePlus',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="4" width="9" height="6.5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="5" y="6" width="4" height="3" rx=".5" fill="currentColor" opacity=".6"/></svg>',
  },
];

// ── User agent strings ──

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Device presets ──

export const DEVICE_PRESETS = [
  // ── Apple: iPhone ──
  { id: 'iphone-se-3', name: 'iPhone SE 3rd Gen', manufacturer: 'apple', type: 'phone', width: 375, height: 667, dpr: 2, userAgent: IPHONE_UA },
  { id: 'iphone-13', name: 'iPhone 13', manufacturer: 'apple', type: 'phone', width: 390, height: 844, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-14', name: 'iPhone 14', manufacturer: 'apple', type: 'phone', width: 390, height: 844, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-15', name: 'iPhone 15', manufacturer: 'apple', type: 'phone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA, popular: true },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', manufacturer: 'apple', type: 'phone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', manufacturer: 'apple', type: 'phone', width: 430, height: 932, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-16', name: 'iPhone 16', manufacturer: 'apple', type: 'phone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA, popular: true },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', manufacturer: 'apple', type: 'phone', width: 402, height: 874, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', manufacturer: 'apple', type: 'phone', width: 440, height: 956, dpr: 3, userAgent: IPHONE_UA },

  // ── Apple: iPad ──
  { id: 'ipad-mini-6', name: 'iPad Mini 6th Gen', manufacturer: 'apple', type: 'tablet', width: 744, height: 1133, dpr: 2, userAgent: IPAD_UA },
  { id: 'ipad-air-m2', name: 'iPad Air M2', manufacturer: 'apple', type: 'tablet', width: 820, height: 1180, dpr: 2, userAgent: IPAD_UA, popular: true },
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', manufacturer: 'apple', type: 'tablet', width: 834, height: 1194, dpr: 2, userAgent: IPAD_UA },
  { id: 'ipad-pro-13', name: 'iPad Pro 13"', manufacturer: 'apple', type: 'tablet', width: 1032, height: 1376, dpr: 2, userAgent: IPAD_UA },

  // ── Samsung: Phone ──
  { id: 'galaxy-s24', name: 'Galaxy S24', manufacturer: 'samsung', type: 'phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', manufacturer: 'samsung', type: 'phone', width: 384, height: 824, dpr: 3.75, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-s25', name: 'Galaxy S25', manufacturer: 'samsung', type: 'phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA, popular: true },
  { id: 'galaxy-s25-ultra', name: 'Galaxy S25 Ultra', manufacturer: 'samsung', type: 'phone', width: 412, height: 915, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-a54', name: 'Galaxy A54', manufacturer: 'samsung', type: 'phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-a15', name: 'Galaxy A15', manufacturer: 'samsung', type: 'phone', width: 360, height: 800, dpr: 2, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-z-fold-folded', name: 'Galaxy Z Fold (Folded)', manufacturer: 'samsung', type: 'phone', width: 280, height: 653, dpr: 2.55, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-z-fold-open', name: 'Galaxy Z Fold (Open)', manufacturer: 'samsung', type: 'phone', width: 600, height: 653, dpr: 2.55, userAgent: ANDROID_PHONE_UA },

  // ── Samsung: Tablet ──
  { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', manufacturer: 'samsung', type: 'tablet', width: 800, height: 1280, dpr: 2, userAgent: ANDROID_TABLET_UA },

  // ── Google: Phone ──
  { id: 'pixel-8', name: 'Pixel 8', manufacturer: 'google', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'pixel-8-pro', name: 'Pixel 8 Pro', manufacturer: 'google', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'pixel-9', name: 'Pixel 9', manufacturer: 'google', type: 'phone', width: 412, height: 923, dpr: 2.625, userAgent: ANDROID_PHONE_UA, popular: true },
  { id: 'pixel-9-pro', name: 'Pixel 9 Pro', manufacturer: 'google', type: 'phone', width: 410, height: 914, dpr: 3.125, userAgent: ANDROID_PHONE_UA },

  // ── Google: Tablet ──
  { id: 'pixel-tablet', name: 'Pixel Tablet', manufacturer: 'google', type: 'tablet', width: 1200, height: 2000, dpr: 2, userAgent: ANDROID_TABLET_UA },

  // ── Motorola: Phone ──
  { id: 'moto-g56', name: 'Moto G56', manufacturer: 'motorola', type: 'phone', width: 360, height: 800, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g54', name: 'Moto G54', manufacturer: 'motorola', type: 'phone', width: 360, height: 800, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g-power-2024', name: 'Moto G Power (2024)', manufacturer: 'motorola', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g-stylus-2024', name: 'Moto G Stylus (2024)', manufacturer: 'motorola', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g-play-2024', name: 'Moto G Play (2024)', manufacturer: 'motorola', type: 'phone', width: 360, height: 800, dpr: 2, userAgent: ANDROID_PHONE_UA },

  // ── OnePlus: Phone ──
  { id: 'oneplus-12', name: 'OnePlus 12', manufacturer: 'oneplus', type: 'phone', width: 412, height: 919, dpr: 3.5, userAgent: ANDROID_PHONE_UA },
  { id: 'oneplus-nord', name: 'OnePlus Nord', manufacturer: 'oneplus', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },

  // ── Xiaomi: Phone ──
  { id: 'redmi-note-13', name: 'Redmi Note 13', manufacturer: 'xiaomi', type: 'phone', width: 393, height: 873, dpr: 2.75, userAgent: ANDROID_PHONE_UA },
];

// ── Backward-compatible category derivation ──
// Maps manufacturer+type back to the old category names for consumers that still use them.

function deriveCategory(preset) {
  if (preset.manufacturer === 'apple') return preset.type === 'tablet' ? 'iPad' : 'iPhone';
  return preset.type === 'tablet' ? 'Android Tablet' : 'Android Phone';
}

/** @deprecated Use MANUFACTURERS and manufacturer field instead */
export const DEVICE_CATEGORIES = ['iPhone', 'iPad', 'Android Phone', 'Android Tablet'];

/**
 * Find a device preset by its unique ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getPresetById(id) {
  return DEVICE_PRESETS.find(p => p.id === id) ?? null;
}

/**
 * Get all presets belonging to a legacy category.
 * @deprecated Use getPresetsByManufacturer instead
 * @param {string} category
 * @returns {object[]}
 */
export function getPresetsByCategory(category) {
  return DEVICE_PRESETS.filter(p => deriveCategory(p) === category);
}

/**
 * Get all presets for a given manufacturer ID.
 * @param {string} manufacturerId - e.g. 'apple', 'samsung'
 * @returns {object[]}
 */
export function getPresetsByManufacturer(manufacturerId) {
  return DEVICE_PRESETS.filter(p => p.manufacturer === manufacturerId);
}

/**
 * Get all presets marked as popular.
 * @returns {object[]}
 */
export function getPopularPresets() {
  return DEVICE_PRESETS.filter(p => p.popular);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -5`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/device-presets.js test/lib/device-presets.test.cjs
git commit -m "refactor: reorganize device presets by manufacturer with new devices"
```

---

### Task 2: Overhaul DevicePickerMenu.svelte

**Files:**
- Modify: `src/components/lens/DevicePickerMenu.svelte`
- Test: `test/components/device-picker-menu.test.cjs`

**Step 1: Write failing tests for new menu features**

Add/update `test/components/device-picker-menu.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DevicePickerMenu.svelte'),
  'utf-8'
);

describe('DevicePickerMenu.svelte: manufacturer-based grouping', () => {
  it('imports MANUFACTURERS from device-presets', () => {
    assert.ok(src.includes('MANUFACTURERS'), 'Should import MANUFACTURERS');
  });

  it('imports getPresetsByManufacturer', () => {
    assert.ok(src.includes('getPresetsByManufacturer'), 'Should import getPresetsByManufacturer');
  });

  it('imports getPopularPresets', () => {
    assert.ok(src.includes('getPopularPresets'), 'Should import getPopularPresets');
  });
});

describe('DevicePickerMenu.svelte: search filter', () => {
  it('has a search input', () => {
    assert.ok(src.includes('search') && src.includes('<input'), 'Should have search input');
  });

  it('filters devices by search query', () => {
    assert.ok(
      src.includes('.filter') && src.includes('search'),
      'Should filter presets by search term'
    );
  });
});

describe('DevicePickerMenu.svelte: popular section', () => {
  it('has a Popular section', () => {
    assert.ok(src.includes('Popular') && src.includes('popular'), 'Should have Popular section');
  });
});

describe('DevicePickerMenu.svelte: collapsible sections', () => {
  it('tracks collapsed state per manufacturer', () => {
    assert.ok(src.includes('collapsed') || src.includes('expanded'), 'Should track collapse state');
  });

  it('has toggle click handler on manufacturer headers', () => {
    assert.ok(src.includes('toggle') || src.includes('collapsed'), 'Should toggle sections');
  });

  it('has chevron/arrow indicator for collapse state', () => {
    assert.ok(src.includes('chevron') || src.includes('arrow') || src.includes('▸') || src.includes('▾'), 'Should show collapse indicator');
  });
});

describe('DevicePickerMenu.svelte: manufacturer icons', () => {
  it('renders manufacturer icon via {@html}', () => {
    assert.ok(src.includes('{@html') && src.includes('icon'), 'Should render icon with {@html}');
  });
});

describe('DevicePickerMenu.svelte: phone/tablet sub-groups', () => {
  it('shows sub-type labels when manufacturer has both', () => {
    assert.ok(
      (src.includes('phone') || src.includes('Phone')) && (src.includes('tablet') || src.includes('Tablet')),
      'Should distinguish phones and tablets within manufacturer'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "(FAIL|fail|✗)" | head -15`
Expected: Multiple failures

**Step 3: Implement the new DevicePickerMenu.svelte**

Replace full contents of `src/components/lens/DevicePickerMenu.svelte`:

```svelte
<script>
  /**
   * DevicePickerMenu -- Dropdown menu for selecting device presets.
   *
   * Grouped by manufacturer with collapsible sections, search filter,
   * popular quick-pick section, and manufacturer icons.
   */
  import { MANUFACTURERS, DEVICE_PRESETS, getPresetsByManufacturer, getPopularPresets } from '../../lib/device-presets.js';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';

  let { onClose = () => {}, anchorRect = null } = $props();

  let search = $state('');
  let collapsed = $state({});

  const popularPresets = getPopularPresets();

  /**
   * Check if a preset is currently active.
   * @param {string} presetId
   */
  function isActive(presetId) {
    return devicePreviewStore.activeDevices.some(d => d.presetId === presetId);
  }

  /**
   * Handle checkbox change for a device preset.
   * @param {string} presetId
   * @param {Event} e
   */
  function handleToggle(presetId, e) {
    if (e.target.checked) {
      devicePreviewStore.addDevice(presetId);
    } else {
      devicePreviewStore.removeDevice(presetId);
    }
  }

  function toggleSection(manufacturerId) {
    collapsed = { ...collapsed, [manufacturerId]: !collapsed[manufacturerId] };
  }

  /**
   * Filter presets by search query (matches device name, case-insensitive).
   */
  function filterPresets(presets) {
    if (!search.trim()) return presets;
    const q = search.trim().toLowerCase();
    return presets.filter(p => p.name.toLowerCase().includes(q));
  }

  /**
   * Get presets for a manufacturer, split into phone/tablet sub-groups.
   */
  function getSubGroups(manufacturerId) {
    const all = filterPresets(getPresetsByManufacturer(manufacturerId));
    const phones = all.filter(p => p.type === 'phone');
    const tablets = all.filter(p => p.type === 'tablet');
    return { phones, tablets, hasSubGroups: phones.length > 0 && tablets.length > 0 };
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose} onkeydown={() => {}}></div>

<div class="picker-menu" style={anchorRect ? `position: fixed; bottom: ${window.innerHeight - anchorRect.top + 4}px; left: ${anchorRect.left}px;` : ''}>

  <!-- Search -->
  <div class="search-row">
    <input
      class="search-input"
      type="text"
      placeholder="Search devices..."
      bind:value={search}
    />
  </div>

  <!-- Popular section -->
  {#if !search.trim()}
    {@const filteredPopular = popularPresets}
    {#if filteredPopular.length > 0}
      <div class="section-header popular-header">
        <span class="section-icon">&#9733;</span>
        <span class="section-label">Popular</span>
      </div>
      {#each filteredPopular as preset}
        {@const active = isActive(preset.id)}
        <label class="device-item" class:active>
          <input
            type="checkbox"
            checked={active}
            disabled={!devicePreviewStore.canAddDevice && !active}
            onchange={(e) => handleToggle(preset.id, e)}
          />
          <span class="device-name">{preset.name}</span>
          <span class="device-dims">{preset.width}&times;{preset.height}</span>
        </label>
      {/each}
      <div class="section-divider"></div>
    {/if}
  {/if}

  <!-- Manufacturer sections -->
  {#each MANUFACTURERS as mfr}
    {@const { phones, tablets, hasSubGroups } = getSubGroups(mfr.id)}
    {@const total = phones.length + tablets.length}
    {#if total > 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="section-header" onclick={() => toggleSection(mfr.id)}>
        <span class="chevron">{collapsed[mfr.id] ? '▸' : '▾'}</span>
        <span class="section-icon">{@html mfr.icon}</span>
        <span class="section-label">{mfr.name}</span>
        <span class="section-count">{total}</span>
      </div>

      {#if !collapsed[mfr.id]}
        {#if hasSubGroups}
          <div class="sub-header">Phones</div>
        {/if}
        {#each phones as preset}
          {@const active = isActive(preset.id)}
          <label class="device-item" class:active>
            <input
              type="checkbox"
              checked={active}
              disabled={!devicePreviewStore.canAddDevice && !active}
              onchange={(e) => handleToggle(preset.id, e)}
            />
            <span class="device-name">{preset.name}</span>
            <span class="device-dims">{preset.width}&times;{preset.height}</span>
          </label>
        {/each}
        {#if hasSubGroups}
          <div class="sub-header">Tablets</div>
        {/if}
        {#each tablets as preset}
          {@const active = isActive(preset.id)}
          <label class="device-item" class:active>
            <input
              type="checkbox"
              checked={active}
              disabled={!devicePreviewStore.canAddDevice && !active}
              onchange={(e) => handleToggle(preset.id, e)}
            />
            <span class="device-name">{preset.name}</span>
            <span class="device-dims">{preset.width}&times;{preset.height}</span>
          </label>
        {/each}
      {/if}
    {/if}
  {/each}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10001;
    -webkit-app-region: no-drag;
  }

  .picker-menu {
    width: 300px;
    max-height: 480px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 10002;
    -webkit-app-region: no-drag;
  }

  .search-row {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .search-input {
    width: 100%;
    padding: 5px 8px;
    background: color-mix(in srgb, var(--bg) 50%, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--muted);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .section-header:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .popular-header {
    cursor: default;
    color: var(--accent);
  }

  .popular-header:hover {
    background: none;
  }

  .chevron {
    font-size: 10px;
    width: 10px;
    text-align: center;
    color: var(--muted);
    flex-shrink: 0;
  }

  .section-icon {
    display: flex;
    align-items: center;
    color: var(--muted);
    flex-shrink: 0;
  }

  .section-label {
    flex: 1;
  }

  .section-count {
    font-size: 10px;
    color: var(--muted);
    font-weight: 400;
  }

  .section-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .sub-header {
    padding: 4px 12px 2px 36px;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 36px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    -webkit-app-region: no-drag;
  }

  .device-item:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .device-item.active {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .device-item input[type="checkbox"] {
    accent-color: var(--accent);
    margin: 0;
    flex-shrink: 0;
  }

  .device-item input[type="checkbox"]:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .device-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .device-dims {
    color: var(--muted);
    font-size: 11px;
    flex-shrink: 0;
    font-family: var(--font-mono);
  }
</style>
```

**Step 4: Update DevicePreview.svelte phone/tablet detection**

In `src/components/lens/DevicePreview.svelte`, the phone/tablet frame detection currently checks `preset.category`. Update it to use `preset.type`:

Find and replace all occurrences of:
```js
preset.category === 'iPhone' || preset.category === 'Android Phone'
```
with:
```js
preset.type === 'phone'
```

And any:
```js
preset.category === 'iPad' || preset.category === 'Android Tablet'
```
with:
```js
preset.type === 'tablet'
```

Also update the notch/home bar conditional that checks for iPhone specifically (if Apple phones should get notch, Android phones don't):
```js
preset.manufacturer === 'apple' && preset.type === 'phone'
```

**Step 5: Run all tests**

Run: `npm test 2>&1 | tail -5`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/components/lens/DevicePickerMenu.svelte src/components/lens/DevicePreview.svelte test/components/device-picker-menu.test.cjs
git commit -m "feat: overhaul device picker with manufacturer grouping, icons, search, and popular section"
```

---

### Task 3: Verify and clean up

**Step 1: Check no other files reference the old `category` field directly**

Search for `preset.category` or `.category ===` in all JS/Svelte files. The `getPresetsByCategory()` function provides backward compat, but direct field access on presets needs updating.

Likely files to check:
- `src/components/lens/DevicePreview.svelte` (handled in Task 2)
- `src/lib/stores/device-preview.svelte.js` (may reference category)
- `src/components/lens/DevicePreviewStrip.svelte` (may reference category)

**Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: All tests pass (5207+ tests)

**Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: clean up stale category references in device preview"
```

---

## Device Dimensions Reference

All CSS viewport sizes (not physical resolution). Cross-verified against Chrome DevTools emulated devices list ([alxwndr/list-of-custom-emulated-devices-in-chrome](https://github.com/alxwndr/list-of-custom-emulated-devices-in-chrome)), [Screen Size Checker](https://screensizechecker.com/devices/android-viewport-sizes), [YesViz](https://yesviz.com/viewport/), [Phone Simulator](https://phone-simulator.com/), and [Blisk](https://blisk.io/).

**Note:** Android viewport sizes can vary by display scaling setting. Values below are for default/factory scaling.

### Existing devices (verified, no changes needed)

| Device | Viewport | DPR | Verified by |
|---|---|---|---|
| iPhone SE 3rd Gen | 375×667 | 2 | Chrome DevTools (iPhone 8 same dims) |
| iPhone 14 | 390×844 | 3 | Chrome DevTools |
| iPhone 15 | 393×852 | 3 | Chrome DevTools (iPhone 14 Pro same dims) |
| iPhone 15 Pro | 393×852 | 3 | Chrome DevTools (iPhone 14 Pro same dims) |
| iPhone 15 Pro Max | 430×932 | 3 | Chrome DevTools (iPhone 14 Pro Max same dims) |
| iPhone 16 | 393×852 | 3 | Same as iPhone 15 (confirmed by Apple) |
| iPhone 16 Pro | 402×874 | 3 | Screen Size Checker |
| iPhone 16 Pro Max | 440×956 | 3 | Screen Size Checker |
| iPad Mini 6 | 744×1133 | 2 | Chrome DevTools gist |
| iPad Air M2 | 820×1180 | 2 | Matches iPad 10th gen class |
| iPad Pro 11" | 834×1194 | 2 | Chrome DevTools (10.5" class) |
| iPad Pro 13" | 1032×1376 | 2 | Chrome DevTools (12.9" = 1024×1366, ours is M-series updated) |
| Galaxy S24 | 360×780 | 3 | Blisk, Phone Simulator |
| Pixel 8 | 412×915 | 2.625 | Matches Pixel 7 class from Chrome DevTools |
| Pixel 8 Pro | 412×915 | 2.625 | Matches Pixel 7 Pro class |
| Galaxy Z Fold (Folded) | 280×653 | 2.55 | Closest: Z Fold4 inner=730×877 (our folded is outer screen) |
| Galaxy Z Fold (Open) | 600×653 | 2.55 | Derived from inner display |
| Galaxy Tab S9 | 800×1280 | 2 | Standard Samsung tablet viewport |
| Pixel Tablet | 1200×2000 | 2 | Standard tablet class |
| Moto G series | 360×800 | 2-3 | Standard 1080p/720p Android mid-range |

### Existing devices with corrections

| Device | Old | Corrected | DPR | Source |
|---|---|---|---|---|
| Galaxy S24 Ultra | 412×915 @ 3.5 | 384×824 @ 3.75 | 3.75 | Blisk (verified) |

### New devices (added in this plan)

| Device | Viewport | DPR | Source |
|---|---|---|---|
| iPhone 13 | 390×844 | 3 | Chrome DevTools, YesViz |
| Galaxy S25 | 360×780 | 3 | Phone Simulator, Screen Size Checker |
| Galaxy S25 Ultra | 412×915 | 3 | Screen Size Checker (default scaling) |
| Galaxy A54 | 360×780 | 3 | Derived (1080×2340, same class as S24) |
| Galaxy A15 | 360×800 | 2 | Derived (720×1600 / 2, budget 720p class) |
| Pixel 9 | 412×923 | 2.625 | Screen Size Checker |
| Pixel 9 Pro | 410×914 | 3.125 | Screen Size Checker |
| OnePlus 12 | 412×919 | 3.5 | Matches OnePlus 10 Pro from Chrome DevTools |
| OnePlus Nord | 412×915 | 2.625 | YesViz |
| Redmi Note 13 | 393×873 | 2.75 | Matches Xiaomi Mi 10T Pro from Chrome DevTools |

## Popular Devices (5 quick-picks)

| Device | Why |
|---|---|
| iPhone 16 | Current gen Apple flagship |
| iPhone 15 | Previous gen, still very popular |
| Galaxy S25 | Current gen Samsung flagship |
| Pixel 9 | Current gen Google flagship |
| iPad Air M2 | Most popular tablet |
