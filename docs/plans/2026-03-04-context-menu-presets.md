# Context Menu Presets — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Context Menus" section to Appearance settings with 4 presets (Default, Rounded, Compact, Flat), a live preview, and custom override sliders.

**Architecture:** Define presets in `context-menu-presets.js`, apply via CSS custom properties on `:root`. Settings UI in `ContextMenuSection.svelte` follows the OrbSection pattern (preset grid + preview + collapsible customize). `context-menu.css` switches from hardcoded values to CSS vars with fallbacks.

**Tech Stack:** Svelte 5 (runes, `$bindable`), CSS custom properties, existing `Slider`/`Select` shared components

---

### Task 1: Create context-menu-presets.js

**Files:**
- Create: `src/lib/context-menu-presets.js`
- Create: `test/unit/context-menu-presets.test.cjs`

**Step 1: Write the test**

Create `test/unit/context-menu-presets.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/lib/context-menu-presets.js'), 'utf8'
);

describe('context-menu-presets', () => {
  describe('exports', () => {
    it('exports CONTEXT_MENU_PRESETS', () => {
      assert.match(src, /export\s+const\s+CONTEXT_MENU_PRESETS/);
    });

    it('exports DEFAULT_CONTEXT_MENU_PRESET', () => {
      assert.match(src, /export\s+const\s+DEFAULT_CONTEXT_MENU_PRESET/);
    });

    it('exports applyContextMenuPreset function', () => {
      assert.match(src, /export\s+function\s+applyContextMenuPreset/);
    });
  });

  describe('CONTEXT_MENU_PRESETS', () => {
    it('has 4 presets: default, rounded, compact, flat', () => {
      assert.match(src, /default:\s*\{/);
      assert.match(src, /rounded:\s*\{/);
      assert.match(src, /compact:\s*\{/);
      assert.match(src, /flat:\s*\{/);
    });

    it('each preset has required keys: id, name, menuRadius, itemRadius, itemPadding, fontSize, shadow, dividerMargin', () => {
      const requiredKeys = ['id', 'name', 'menuRadius', 'itemRadius', 'itemPadding', 'fontSize', 'shadow', 'dividerMargin'];
      for (const key of requiredKeys) {
        // Each key should appear at least 4 times (once per preset)
        const matches = src.match(new RegExp(`${key}:`, 'g'));
        assert.ok(matches && matches.length >= 4, `key "${key}" should appear in all 4 presets`);
      }
    });
  });

  describe('applyContextMenuPreset', () => {
    it('sets CSS custom properties on document.documentElement', () => {
      assert.match(src, /documentElement/);
      assert.match(src, /--ctx-menu-radius/);
      assert.match(src, /--ctx-item-padding/);
      assert.match(src, /--ctx-item-font-size/);
      assert.match(src, /--ctx-item-radius/);
      assert.match(src, /--ctx-menu-shadow/);
      assert.match(src, /--ctx-divider-margin/);
      assert.match(src, /--ctx-menu-padding/);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | grep -A2 "context-menu-presets"
```
Expected: FAIL (file doesn't exist)

**Step 3: Write the implementation**

Create `src/lib/context-menu-presets.js`:

```js
/**
 * context-menu-presets.js -- Built-in context menu visual presets and helpers.
 *
 * Each preset defines shape/spacing for context menus.
 * Colors always come from the active theme (CSS vars).
 */

export const DEFAULT_CONTEXT_MENU_PRESET = 'default';

/**
 * @typedef {Object} ContextMenuPreset
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} menuRadius - border-radius of the menu container (px)
 * @property {number} itemRadius - border-radius of individual items (px)
 * @property {string} itemPadding - padding on each item (CSS shorthand)
 * @property {number} fontSize - item font size (px)
 * @property {string} shadow - box-shadow value (CSS)
 * @property {string} dividerMargin - margin on dividers (CSS shorthand)
 * @property {string} menuPadding - padding on the menu container (CSS shorthand)
 */

/** @type {Record<string, ContextMenuPreset>} */
export const CONTEXT_MENU_PRESETS = {
  default: {
    id: 'default',
    name: 'Default',
    description: 'Standard context menu style',
    menuRadius: 6,
    itemRadius: 0,
    itemPadding: '6px 12px',
    fontSize: 12,
    shadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    dividerMargin: '4px 8px',
    menuPadding: '4px 0',
  },
  rounded: {
    id: 'rounded',
    name: 'Rounded',
    description: 'Pill-shaped items with soft edges',
    menuRadius: 12,
    itemRadius: 8,
    itemPadding: '8px 14px',
    fontSize: 12,
    shadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
    dividerMargin: '4px 12px',
    menuPadding: '4px',
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter spacing and smaller text',
    menuRadius: 4,
    itemRadius: 0,
    itemPadding: '4px 8px',
    fontSize: 11,
    shadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    dividerMargin: '2px 6px',
    menuPadding: '2px 0',
  },
  flat: {
    id: 'flat',
    name: 'Flat',
    description: 'No shadow, minimal border',
    menuRadius: 2,
    itemRadius: 0,
    itemPadding: '6px 12px',
    fontSize: 12,
    shadow: 'none',
    dividerMargin: '4px 8px',
    menuPadding: '4px 0',
  },
};

/**
 * Apply a context menu preset (with optional overrides) to :root CSS vars.
 * @param {ContextMenuPreset} preset
 * @param {Partial<ContextMenuPreset>|null} [overrides]
 */
export function applyContextMenuPreset(preset, overrides) {
  const p = overrides ? { ...preset, ...overrides } : preset;
  const root = document.documentElement;
  root.style.setProperty('--ctx-menu-radius', p.menuRadius + 'px');
  root.style.setProperty('--ctx-menu-shadow', p.shadow);
  root.style.setProperty('--ctx-menu-padding', p.menuPadding);
  root.style.setProperty('--ctx-item-radius', p.itemRadius + 'px');
  root.style.setProperty('--ctx-item-padding', p.itemPadding);
  root.style.setProperty('--ctx-item-font-size', p.fontSize + 'px');
  root.style.setProperty('--ctx-divider-margin', p.dividerMargin);
}
```

**Step 4: Run tests**

```bash
npm test 2>&1 | grep -A2 "context-menu-presets"
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/context-menu-presets.js test/unit/context-menu-presets.test.cjs
git commit -m "feat: add context menu preset definitions and apply function"
```

---

### Task 2: Update context-menu.css to use CSS variables

**Files:**
- Modify: `src/styles/context-menu.css`

**Step 1: Replace hardcoded values with CSS custom properties**

Replace the full contents of `src/styles/context-menu.css` with:

```css
/* Shared context menu styles — imported by all context menu components.
   Values driven by CSS custom properties set via applyContextMenuPreset().
   Override specific properties in component <style> blocks as needed. */

.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--ctx-menu-radius, 6px);
  padding: var(--ctx-menu-padding, 4px 0);
  box-shadow: var(--ctx-menu-shadow, 0 4px 16px rgba(0, 0, 0, 0.3));
  font-family: var(--font-family);
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: var(--ctx-item-padding, 6px 12px);
  border: none;
  border-radius: var(--ctx-item-radius, 0);
  background: none;
  color: var(--text);
  font-size: var(--ctx-item-font-size, 12px);
  font-family: var(--font-family);
  cursor: pointer;
  text-align: left;
}

.context-menu-item:hover {
  background: var(--accent);
  color: var(--bg);
}

.context-menu-item:disabled {
  color: var(--muted);
  cursor: default;
  opacity: 0.5;
}

.context-menu-item:disabled:hover {
  background: none;
  color: var(--muted);
}

.context-menu-item.danger {
  color: var(--danger);
}

.context-menu-item.danger:hover {
  background: var(--danger);
  color: var(--bg);
}

.context-menu-shortcut {
  color: var(--muted);
  font-size: calc(var(--ctx-item-font-size, 12px) - 1px);
  margin-left: 24px;
}

.context-menu-item:hover:not(:disabled) .context-menu-shortcut {
  color: inherit;
  opacity: 0.7;
}

.context-menu-divider {
  height: 1px;
  margin: var(--ctx-divider-margin, 4px 8px);
  background: var(--border);
}
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/styles/context-menu.css
git commit -m "refactor: use CSS custom properties in context-menu.css for preset support"
```

---

### Task 3: Create ContextMenuSection.svelte

**Files:**
- Create: `src/components/settings/appearance/ContextMenuSection.svelte`
- Create: `test/components/context-menu-section.test.cjs`

**Step 1: Write the test**

Create `test/components/context-menu-section.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/settings/appearance/ContextMenuSection.svelte'), 'utf8'
);

describe('ContextMenuSection', () => {
  describe('structure', () => {
    it('is a section with heading "Context Menus"', () => {
      assert.match(src, /<section/);
      assert.match(src, /Context Menus/);
    });

    it('imports CONTEXT_MENU_PRESETS and applyContextMenuPreset', () => {
      assert.match(src, /CONTEXT_MENU_PRESETS/);
      assert.match(src, /applyContextMenuPreset/);
    });

    it('imports Slider component for custom overrides', () => {
      assert.match(src, /import\s+Slider/);
    });
  });

  describe('preset picker', () => {
    it('renders preset cards with click handler', () => {
      assert.match(src, /preset-card/);
      assert.match(src, /onclick/);
    });

    it('has active class binding for selected preset', () => {
      assert.match(src, /class:active/);
    });
  });

  describe('live preview', () => {
    it('renders a fake context menu with sample items', () => {
      assert.match(src, /Cut/);
      assert.match(src, /Copy/);
      assert.match(src, /Paste/);
      assert.match(src, /Delete/);
    });

    it('preview uses context-menu classes', () => {
      assert.match(src, /context-menu-item/);
      assert.match(src, /context-menu-divider/);
    });

    it('preview shows a danger item', () => {
      assert.match(src, /danger/);
    });
  });

  describe('customize controls', () => {
    it('has a collapsible customize section', () => {
      assert.match(src, /Customize/i);
    });

    it('has sliders for border radius, item padding, font size, item radius', () => {
      assert.match(src, /Border Radius/);
      assert.match(src, /Item Padding/);
      assert.match(src, /Font Size/);
      assert.match(src, /Item Radius/);
    });

    it('has a shadow selector', () => {
      assert.match(src, /Shadow/);
    });
  });

  describe('bindable props', () => {
    it('uses $bindable for selectedCtxPreset', () => {
      assert.match(src, /selectedCtxPreset\s*=\s*\$bindable/);
    });

    it('uses $bindable for ctxOverrides', () => {
      assert.match(src, /ctxOverrides\s*=\s*\$bindable/);
    });

    it('uses $bindable for ctxCustomize', () => {
      assert.match(src, /ctxCustomize\s*=\s*\$bindable/);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | grep -A2 "ContextMenuSection"
```
Expected: FAIL

**Step 3: Write the implementation**

Create `src/components/settings/appearance/ContextMenuSection.svelte`:

```svelte
<script>
  /**
   * ContextMenuSection -- Context menu preset picker, live preview, customize controls.
   */
  import {
    CONTEXT_MENU_PRESETS, DEFAULT_CONTEXT_MENU_PRESET, applyContextMenuPreset,
  } from '../../../lib/context-menu-presets.js';
  import Slider from '../../shared/Slider.svelte';
  import Select from '../../shared/Select.svelte';

  let {
    selectedCtxPreset = $bindable(),
    ctxCustomize = $bindable(),
    ctxOverrides = $bindable(),
  } = $props();

  const shadowOptions = [
    { value: 'none', label: 'None' },
    { value: '0 2px 8px rgba(0, 0, 0, 0.2)', label: 'Small' },
    { value: '0 4px 16px rgba(0, 0, 0, 0.3)', label: 'Medium' },
    { value: '0 8px 24px rgba(0, 0, 0, 0.35)', label: 'Large' },
  ];

  // Local slider state (derived from preset + overrides)
  let menuRadius = $state(6);
  let itemRadius = $state(0);
  let itemPaddingV = $state(6);
  let fontSize = $state(12);
  let shadow = $state('0 4px 16px rgba(0, 0, 0, 0.3)');

  // Resolved preset = base + overrides
  let resolved = $derived.by(() => {
    const base = CONTEXT_MENU_PRESETS[selectedCtxPreset] || CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET];
    if (ctxCustomize && ctxOverrides) return { ...base, ...ctxOverrides };
    return base;
  });

  // Apply live preview whenever resolved changes
  $effect(() => {
    applyContextMenuPreset(resolved);
  });

  function handlePresetChange(presetId) {
    selectedCtxPreset = presetId;
    const base = CONTEXT_MENU_PRESETS[presetId] || CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET];
    menuRadius = base.menuRadius;
    itemRadius = base.itemRadius;
    itemPaddingV = parseInt(base.itemPadding);
    fontSize = base.fontSize;
    shadow = base.shadow;
    ctxOverrides = null;
    ctxCustomize = false;
    applyContextMenuPreset(base);
  }

  function handleSliderChange() {
    ctxOverrides = {
      menuRadius,
      itemRadius,
      itemPadding: `${itemPaddingV}px ${Math.round(itemPaddingV * 2)}px`,
      fontSize,
      shadow,
    };
    applyContextMenuPreset(
      CONTEXT_MENU_PRESETS[selectedCtxPreset] || CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET],
      ctxOverrides,
    );
  }

  // Sync sliders when preset changes externally (e.g. config load)
  $effect(() => {
    const base = CONTEXT_MENU_PRESETS[selectedCtxPreset] || CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET];
    const p = ctxOverrides ? { ...base, ...ctxOverrides } : base;
    menuRadius = p.menuRadius;
    itemRadius = p.itemRadius;
    itemPaddingV = parseInt(p.itemPadding);
    fontSize = p.fontSize;
    shadow = p.shadow;
  });
</script>

<section class="settings-section">
  <h3>Context Menus</h3>
  <div class="settings-group">
    <!-- Preset picker grid -->
    <div class="ctx-preset-section">
      <span class="ctx-preset-label">Preset</span>
      <div class="ctx-preset-grid">
        {#each Object.values(CONTEXT_MENU_PRESETS) as preset (preset.id)}
          <div
            class="ctx-preset-card"
            class:active={selectedCtxPreset === preset.id}
            role="button"
            tabindex="0"
            onclick={() => handlePresetChange(preset.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handlePresetChange(preset.id); }}
            title={preset.description}
          >
            <span class="ctx-preset-name">{preset.name}</span>
            <span class="ctx-preset-desc">{preset.description}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Live preview -->
    <div class="ctx-preview-area">
      <span class="ctx-preview-label">Preview</span>
      <div class="ctx-preview-frame">
        <div class="context-menu ctx-preview-menu" style="position: relative; z-index: auto;">
          <button class="context-menu-item" style="pointer-events: none;">
            <span>Cut</span>
            <span class="context-menu-shortcut">Ctrl+X</span>
          </button>
          <button class="context-menu-item" style="pointer-events: none;">
            <span>Copy</span>
            <span class="context-menu-shortcut">Ctrl+C</span>
          </button>
          <div class="context-menu-divider"></div>
          <button class="context-menu-item" style="pointer-events: none;">
            <span>Paste</span>
            <span class="context-menu-shortcut">Ctrl+V</span>
          </button>
          <div class="context-menu-divider"></div>
          <button class="context-menu-item danger" style="pointer-events: none;">
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Customize -->
    <div class="ctx-customize-section">
      <button class="ctx-customize-toggle" onclick={() => { ctxCustomize = !ctxCustomize; }}>
        <span class="ctx-customize-arrow" class:expanded={ctxCustomize}>&#9654;</span>
        Customize Style
      </button>

      {#if ctxCustomize}
        <div class="ctx-customize-controls">
          <Slider label="Border Radius" value={menuRadius} min={0} max={16} step={1}
            onChange={(v) => { menuRadius = v; handleSliderChange(); }} formatValue={(v) => v + 'px'} />
          <Slider label="Item Radius" value={itemRadius} min={0} max={12} step={1}
            onChange={(v) => { itemRadius = v; handleSliderChange(); }} formatValue={(v) => v + 'px'} />
          <Slider label="Item Padding" value={itemPaddingV} min={2} max={12} step={1}
            onChange={(v) => { itemPaddingV = v; handleSliderChange(); }} formatValue={(v) => v + 'px'} />
          <Slider label="Font Size" value={fontSize} min={10} max={14} step={1}
            onChange={(v) => { fontSize = v; handleSliderChange(); }} formatValue={(v) => v + 'px'} />
          <Select label="Shadow" value={shadow} options={shadowOptions}
            onChange={(v) => { shadow = v; handleSliderChange(); }} />
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  @import '../../../styles/context-menu.css';

  .ctx-preset-section { padding: 12px; }
  .ctx-preset-label {
    display: block; color: var(--muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px;
  }
  .ctx-preset-grid { display: flex; gap: 8px; flex-wrap: wrap; }

  .ctx-preset-card {
    display: flex; flex-direction: column; gap: 2px;
    padding: 10px 14px; background: var(--bg);
    border: 2px solid var(--border); border-radius: var(--radius-md);
    cursor: pointer; transition: all var(--duration-fast) var(--ease-out);
    min-width: 80px; flex: 1;
  }
  .ctx-preset-card:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  .ctx-preset-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-glow); }

  .ctx-preset-name { font-size: 12px; font-weight: 600; color: var(--text); }
  .ctx-preset-card.active .ctx-preset-name { color: var(--accent); }
  .ctx-preset-desc { font-size: 10px; color: var(--muted); }

  .ctx-preview-area { padding: 12px; }
  .ctx-preview-label {
    display: block; color: var(--muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px;
  }
  .ctx-preview-frame {
    display: flex; justify-content: center; padding: 24px;
    background: var(--bg); border-radius: var(--radius-md); border: 1px solid var(--border);
  }
  .ctx-preview-menu {
    min-width: 200px; max-width: 260px;
  }
  .ctx-preview-menu .context-menu-item {
    justify-content: space-between;
  }

  .ctx-customize-section { border-top: 1px solid var(--border); margin: 0 12px; padding-top: 8px; }
  .ctx-customize-toggle {
    display: flex; align-items: center; gap: 6px;
    background: none; border: none; color: var(--text);
    font-size: 13px; font-weight: 500; cursor: pointer; padding: 8px 0;
    font-family: var(--font-family); transition: color var(--duration-fast) var(--ease-out);
  }
  .ctx-customize-toggle:hover { color: var(--accent); }
  .ctx-customize-arrow {
    font-size: 9px; transition: transform var(--duration-fast) var(--ease-out); display: inline-block;
  }
  .ctx-customize-arrow.expanded { transform: rotate(90deg); }
  .ctx-customize-controls { padding: 8px 0 4px; }
</style>
```

**Step 4: Run tests**

```bash
npm test 2>&1 | grep -A2 "ContextMenuSection"
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/settings/appearance/ContextMenuSection.svelte test/components/context-menu-section.test.cjs
git commit -m "feat: add ContextMenuSection with preset picker, preview, and customize controls"
```

---

### Task 4: Wire into AppearanceSettings

**Files:**
- Modify: `src/components/settings/AppearanceSettings.svelte`

**Step 1: Add state, import, config load, save, and reset**

In `<script>`:

1. Add import:
```js
import { CONTEXT_MENU_PRESETS, DEFAULT_CONTEXT_MENU_PRESET, applyContextMenuPreset } from '../../lib/context-menu-presets.js';
import ContextMenuSection from './appearance/ContextMenuSection.svelte';
```

2. Add state (after the Message Cards state block):
```js
// ---- State: Context Menu ----
let selectedCtxPreset = $state(DEFAULT_CONTEXT_MENU_PRESET);
let ctxCustomize = $state(false);
let ctxOverrides = $state(null);
```

3. In the `$effect` config init block, after the orb config loading, add:
```js
const ctxCfg = cfg.appearance?.contextMenu;
if (ctxCfg) {
  selectedCtxPreset = ctxCfg.preset || DEFAULT_CONTEXT_MENU_PRESET;
  if (ctxCfg.overrides) {
    ctxOverrides = ctxCfg.overrides;
    ctxCustomize = true;
  }
}
const ctxBase = CONTEXT_MENU_PRESETS[selectedCtxPreset] || CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET];
applyContextMenuPreset(ctxBase, ctxOverrides);
```

4. In `resetAppearance()`, add after orb reset:
```js
selectedCtxPreset = DEFAULT_CONTEXT_MENU_PRESET;
ctxCustomize = false;
ctxOverrides = null;
applyContextMenuPreset(CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET]);
```

And add `contextMenu: null` to the reset config patch.

5. In `saveAppearanceSettings()`, add to the patch inside `appearance`:
```js
contextMenu: {
  preset: selectedCtxPreset,
  overrides: ctxCustomize ? ctxOverrides : null,
},
```

6. In the template, add between `<MessageCardSection>` and `<TypographySection>`:
```svelte
<ContextMenuSection
  bind:selectedCtxPreset
  bind:ctxCustomize
  bind:ctxOverrides
/>
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/settings/AppearanceSettings.svelte
git commit -m "feat: wire ContextMenuSection into AppearanceSettings"
```

---

### Task 5: Apply preset on app startup

**Files:**
- Modify: `src/main.js` (or wherever theme is applied on startup)

Check how theme is applied on startup. The config load `$effect` in AppearanceSettings already calls `applyContextMenuPreset`. But we also need it applied before settings page is opened — when the app first loads.

**Step 1: Find and update the startup theme application**

Look for where `applyTheme()` is called during app init (likely in `App.svelte` or `main.js`). Add `applyContextMenuPreset()` alongside it:

```js
import { CONTEXT_MENU_PRESETS, DEFAULT_CONTEXT_MENU_PRESET, applyContextMenuPreset } from './lib/context-menu-presets.js';

// After applyTheme() call:
const ctxCfg = cfg?.appearance?.contextMenu;
const ctxPreset = CONTEXT_MENU_PRESETS[ctxCfg?.preset] || CONTEXT_MENU_PRESETS[DEFAULT_CONTEXT_MENU_PRESET];
applyContextMenuPreset(ctxPreset, ctxCfg?.overrides || null);
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add <modified-file>
git commit -m "feat: apply context menu preset on app startup"
```

---

### Task 6: Tests and docs

**Files:**
- Modify: `docs/CODE-AUDIT.md` (note new feature)

**Step 1: Run full test suite**

```bash
npm test
```

Verify all pass.

**Step 2: Commit**

```bash
git add docs/CODE-AUDIT.md
git commit -m "docs: add context menu presets to audit notes"
```
