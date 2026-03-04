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

  // Local slider state
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
  }

  function handleSliderChange() {
    ctxOverrides = {
      menuRadius,
      itemRadius,
      itemPadding: `${itemPaddingV}px ${Math.round(itemPaddingV * 2)}px`,
      fontSize,
      shadow,
    };
  }

  // Sync sliders when preset/overrides change externally (e.g. config load)
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
