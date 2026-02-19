<script>
  /**
   * OrbSection -- Orb preview, preset picker, customize controls, import/export.
   */
  import {
    ORB_PRESETS, DEFAULT_ORB_PRESET,
    deepMergePreset, validateOrbPreset, slidersToOverrides,
  } from '../../../lib/orb-presets.js';
  import { toastStore } from '../../../lib/stores/toast.svelte.js';
  import Orb from '../../overlay/Orb.svelte';
  import Slider from '../../shared/Slider.svelte';
  import Select from '../../shared/Select.svelte';
  import Button from '../../shared/Button.svelte';

  let {
    orbSize = $bindable(),
    selectedOrbPreset = $bindable(),
    orbCustomize = $bindable(),
    orbGlow = $bindable(),
    orbBorder = $bindable(),
    orbOpacity = $bindable(),
    orbAnimSpeed = $bindable(),
    orbIconStyle = $bindable(),
    orbOverrides = $bindable(),
    orbCustomPresets = $bindable(),
    orbCoreColor,
    onOrbCoreColorChange,
  } = $props();

  const ORB_PREVIEW_STATES = ['idle', 'listening', 'speaking', 'thinking'];
  let previewOrbState = $state('idle');

  const orbIconStyleOptions = [
    { value: 'default', label: 'Default' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'geometric', label: 'Geometric' },
    { value: 'none', label: 'None' },
  ];

  const allOrbPresets = $derived([
    ...Object.values(ORB_PRESETS),
    ...orbCustomPresets,
  ]);

  let resolvedOrbPreset = $derived.by(() => {
    const base = ORB_PRESETS[selectedOrbPreset]
      || orbCustomPresets.find(p => p.id === selectedOrbPreset)
      || ORB_PRESETS[DEFAULT_ORB_PRESET];
    if (orbCustomize && orbOverrides) return deepMergePreset(base, orbOverrides);
    return base;
  });

  // Cycle orb preview states
  $effect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % ORB_PREVIEW_STATES.length;
      previewOrbState = ORB_PREVIEW_STATES[idx];
    }, 3000);
    return () => clearInterval(interval);
  });

  function handleOrbPresetChange(presetId) {
    selectedOrbPreset = presetId;
    const base = ORB_PRESETS[presetId]
      || orbCustomPresets.find(p => p.id === presetId)
      || ORB_PRESETS[DEFAULT_ORB_PRESET];
    orbGlow = Math.round((base.render.glowRadius / 30) * 100);
    orbBorder = base.render.borderWidth;
    orbOpacity = Math.round(base.render.gradientCenterAlpha * 100);
    orbAnimSpeed = 1.0;
    orbIconStyle = base.icons.style;
    orbOverrides = null;
    orbCustomize = false;
  }

  function handleOrbSliderChange() {
    orbOverrides = slidersToOverrides({
      glowIntensity: orbGlow,
      borderWidth: orbBorder,
      opacity: orbOpacity,
      animSpeed: orbAnimSpeed,
      iconStyle: orbIconStyle,
    });
  }

  function exportOrbStyle() {
    const preset = { ...resolvedOrbPreset };
    preset.name = preset.name || selectedOrbPreset;
    preset.description = preset.description || 'Custom orb style';
    delete preset.id;
    const json = JSON.stringify(preset, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `voice-mirror-orb-${selectedOrbPreset}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toastStore.addToast({ message: `Exported orb style "${preset.name}"`, severity: 'success' });
  }

  function importOrbStyle() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10240) {
        toastStore.addToast({ message: 'File too large (max 10KB)', severity: 'error' });
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const validation = validateOrbPreset(data);
        if (!validation.valid) {
          toastStore.addToast({ message: `Invalid orb preset: ${validation.errors[0]}`, severity: 'error' });
          return;
        }
        data.id = `custom-${Date.now()}`;
        data.name = data.name || file.name.replace('.json', '');
        data.isCustom = true;
        orbCustomPresets = [...orbCustomPresets, data];
        selectedOrbPreset = data.id;
        orbOverrides = null;
        orbCustomize = false;
        orbGlow = Math.round((data.render.glowRadius / 30) * 100);
        orbBorder = data.render.borderWidth;
        orbOpacity = Math.round(data.render.gradientCenterAlpha * 100);
        orbAnimSpeed = 1.0;
        orbIconStyle = data.icons.style;
        toastStore.addToast({ message: `Imported orb style "${data.name}"`, severity: 'success' });
      } catch (err) {
        console.error('[OrbSection] Orb import failed:', err);
        toastStore.addToast({ message: 'Import failed: invalid JSON file', severity: 'error' });
      }
    };
    input.click();
  }

  function deleteCustomOrbPreset(id) {
    const preset = orbCustomPresets.find(p => p.id === id);
    if (!preset) return;
    orbCustomPresets = orbCustomPresets.filter(p => p.id !== id);
    if (selectedOrbPreset === id) handleOrbPresetChange(DEFAULT_ORB_PRESET);
    toastStore.addToast({ message: `Removed orb style "${preset.name}"`, severity: 'success' });
  }
</script>

<section class="settings-section">
  <h3>Orb</h3>
  <div class="settings-group">
    <!-- Live orb preview -->
    <div class="orb-preview-area">
      <div class="orb-preview-frame">
        <Orb state={previewOrbState} size={orbSize} preset={resolvedOrbPreset} />
      </div>
      <span class="orb-preview-state">{previewOrbState}</span>
    </div>

    <!-- Preset picker grid -->
    <div class="orb-preset-section">
      <span class="orb-preset-label">Preset</span>
      <div class="orb-preset-grid">
        {#each allOrbPresets as preset (preset.id)}
          <div
            class="orb-preset-card"
            class:active={selectedOrbPreset === preset.id}
            role="button"
            tabindex="0"
            onclick={() => handleOrbPresetChange(preset.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOrbPresetChange(preset.id); }}
            title={preset.description}
          >
            <div class="orb-preset-mini">
              <Orb state="idle" size={32} preset={preset} isStatic={true} />
            </div>
            <span class="orb-preset-name">{preset.name}</span>
            {#if preset.isCustom}
              <span class="orb-custom-badge">custom</span>
              <button
                class="orb-custom-delete"
                title="Remove custom preset"
                onclick={(e) => { e.stopPropagation(); deleteCustomOrbPreset(preset.id); }}
              >&times;</button>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Orb Core Color -->
    <div class="orb-core-color-row">
      <label class="orb-core-label">
        <span>Core Color</span>
        <div class="orb-core-control">
          <input
            type="color"
            value={orbCoreColor}
            oninput={(e) => onOrbCoreColorChange(e.target.value)}
            class="color-input"
          />
          <span class="orb-core-hex">{orbCoreColor}</span>
        </div>
      </label>
    </div>

    <!-- Orb size slider -->
    <Slider label="Orb Size" value={orbSize} min={32} max={256} step={4}
      onChange={(v) => (orbSize = v)} formatValue={(v) => v + 'px'} />

    <!-- Customize Style -->
    <div class="orb-customize-section">
      <button class="orb-customize-toggle" onclick={() => { orbCustomize = !orbCustomize; }}>
        <span class="orb-customize-arrow" class:expanded={orbCustomize}>&#9654;</span>
        Customize Style
      </button>

      {#if orbCustomize}
        <div class="orb-customize-controls">
          <Slider label="Glow" value={orbGlow} min={0} max={100} step={5}
            onChange={(v) => { orbGlow = v; handleOrbSliderChange(); }} formatValue={(v) => v + '%'} />
          <Slider label="Border" value={orbBorder} min={0} max={6} step={0.5}
            onChange={(v) => { orbBorder = v; handleOrbSliderChange(); }} formatValue={(v) => v + 'px'} />
          <Slider label="Opacity" value={orbOpacity} min={30} max={100} step={5}
            onChange={(v) => { orbOpacity = v; handleOrbSliderChange(); }} formatValue={(v) => v + '%'} />
          <Slider label="Animation Speed" value={orbAnimSpeed} min={0.5} max={2} step={0.1}
            onChange={(v) => { orbAnimSpeed = v; handleOrbSliderChange(); }} formatValue={(v) => v.toFixed(1) + 'x'} />
          <Select label="Icon Style" value={orbIconStyle} options={orbIconStyleOptions}
            onChange={(v) => { orbIconStyle = v; handleOrbSliderChange(); }} />
        </div>
      {/if}
    </div>

    <!-- Import / Export Orb Style -->
    <div class="orb-io-actions">
      <Button variant="secondary" small onClick={importOrbStyle}>Import Orb Style</Button>
      <Button variant="secondary" small onClick={exportOrbStyle}>Export Current Style</Button>
    </div>
  </div>
</section>

<style>
  .orb-preview-area {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 20px; margin: 8px;
    background: var(--bg); border-radius: var(--radius-md); border: 1px solid var(--border);
    min-height: 140px;
  }
  .orb-preview-frame {
    width: 120px; height: 120px;
    display: flex; align-items: center; justify-content: center;
    overflow: visible; flex-shrink: 0;
  }
  .orb-preview-state {
    font-size: 11px; color: var(--muted);
    text-transform: capitalize; font-family: var(--font-mono);
  }

  .orb-preset-section { padding: 12px; }
  .orb-preset-label {
    display: block; color: var(--muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px;
  }
  .orb-preset-grid { display: flex; gap: 8px; flex-wrap: wrap; }

  .orb-preset-card {
    position: relative; display: flex; flex-direction: column; align-items: center;
    gap: 4px; padding: 8px 12px; background: var(--bg);
    border: 2px solid var(--border); border-radius: var(--radius-md);
    cursor: pointer; transition: all var(--duration-fast) var(--ease-out); min-width: 64px;
  }
  .orb-preset-card:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  .orb-preset-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-glow); }

  .orb-preset-mini {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; pointer-events: none;
  }
  .orb-preset-name { font-size: 10px; color: var(--muted); white-space: nowrap; }
  .orb-preset-card.active .orb-preset-name { color: var(--accent); }

  .orb-custom-badge {
    position: absolute; top: 2px; right: 2px;
    font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
    color: var(--accent); background: var(--accent-subtle); padding: 1px 4px; border-radius: 3px;
  }
  .orb-custom-delete {
    position: absolute; top: -4px; right: -4px;
    width: 16px; height: 16px; border-radius: 50%; border: none;
    background: var(--danger); color: white; font-size: 11px; line-height: 1;
    cursor: pointer; display: none; align-items: center; justify-content: center; padding: 0;
  }
  .orb-preset-card:hover .orb-custom-delete { display: flex; }

  .orb-core-color-row { padding: 12px; }
  .orb-core-label {
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; color: var(--text); font-size: 14px;
  }
  .orb-core-control { display: flex; align-items: center; gap: 8px; }
  .orb-core-hex { color: var(--muted); font-size: 11px; font-family: var(--font-mono); }

  .color-input {
    -webkit-appearance: none; appearance: none;
    width: 28px; height: 28px; border: 2px solid var(--border-strong);
    border-radius: 50%; cursor: pointer; padding: 0; background: none; flex-shrink: 0;
  }
  .color-input::-webkit-color-swatch-wrapper { padding: 0; }
  .color-input::-webkit-color-swatch { border: none; border-radius: 50%; }
  .color-input::-moz-color-swatch { border: none; border-radius: 50%; }

  .orb-customize-section { border-top: 1px solid var(--border); margin: 0 12px; padding-top: 8px; }
  .orb-customize-toggle {
    display: flex; align-items: center; gap: 6px;
    background: none; border: none; color: var(--text);
    font-size: 13px; font-weight: 500; cursor: pointer; padding: 8px 0;
    font-family: var(--font-family); transition: color var(--duration-fast) var(--ease-out);
  }
  .orb-customize-toggle:hover { color: var(--accent); }
  .orb-customize-arrow {
    font-size: 9px; transition: transform var(--duration-fast) var(--ease-out); display: inline-block;
  }
  .orb-customize-arrow.expanded { transform: rotate(90deg); }
  .orb-customize-controls { padding: 8px 0 4px; }

  .orb-io-actions {
    display: flex; gap: 8px; padding: 8px 12px 12px;
    border-top: 1px solid var(--border); margin: 0 12px;
  }
</style>
