<script>
  /**
   * ThemeSection -- Theme preset grid, import/export, custom color pickers.
   */
  import { PRESETS, applyTheme, resolveTheme } from '../../../lib/stores/theme.svelte.js';
  import Toggle from '../../shared/Toggle.svelte';
  import Button from '../../shared/Button.svelte';

  let {
    selectedTheme = $bindable(),
    customizeColors = $bindable(),
    customColors = $bindable(),
    fontFamily,
    fontMono,
  } = $props();

  const COLOR_GROUPS = [
    { label: 'Backgrounds', keys: ['bg', 'bgElevated'] },
    { label: 'Text', keys: ['text', 'textStrong', 'muted'] },
    { label: 'Accent', keys: ['accent'] },
    { label: 'Status', keys: ['ok', 'warn', 'danger'] },
  ];

  const COLOR_LABELS = {
    bg: 'Background',
    bgElevated: 'Elevated',
    text: 'Text',
    textStrong: 'Strong',
    muted: 'Muted',
    accent: 'Accent',
    ok: 'OK',
    warn: 'Warning',
    danger: 'Danger',
    orbCore: 'Orb Core',
  };

  const REQUIRED_COLOR_KEYS = [
    'bg', 'bgElevated', 'text', 'textStrong', 'muted',
    'accent', 'ok', 'warn', 'danger', 'orbCore',
  ];

  let importExportMessage = $state('');
  let importExportStatus = $state('');

  const currentPreset = $derived(PRESETS[selectedTheme] || PRESETS.colorblind);

  function showMessage(text, status = 'success') {
    importExportMessage = text;
    importExportStatus = status;
    setTimeout(() => { importExportMessage = ''; importExportStatus = ''; }, 4000);
  }

  function handleThemeChange(newTheme) {
    selectedTheme = newTheme;
    const { colors, fonts } = resolveTheme(newTheme);
    customColors = { ...colors };
    if (customizeColors) {
      applyTheme(customColors, fonts);
    } else {
      applyTheme(colors, fonts);
    }
  }

  function handleColorChange(key, value) {
    customColors = { ...customColors, [key]: value };
    applyTheme(customColors, { fontFamily, fontMono });
  }

  function handleCustomizeToggle(enabled) {
    customizeColors = enabled;
    if (enabled) {
      const preset = PRESETS[selectedTheme] || PRESETS.colorblind;
      customColors = { ...preset.colors, ...customColors };
      applyTheme(customColors, { fontFamily, fontMono });
    } else {
      const { colors, fonts } = resolveTheme(selectedTheme);
      applyTheme(colors, fonts);
    }
  }

  function validateThemeJson(data) {
    if (!data || typeof data !== 'object') return { valid: false, error: 'Invalid JSON: not an object' };
    if (!data.colors || typeof data.colors !== 'object') return { valid: false, error: 'Missing "colors" object' };
    const missingKeys = REQUIRED_COLOR_KEYS.filter(key => !data.colors[key]);
    if (missingKeys.length > 0) return { valid: false, error: `Missing color keys: ${missingKeys.join(', ')}` };
    for (const key of REQUIRED_COLOR_KEYS) {
      const val = data.colors[key];
      if (typeof val !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(val)) {
        return { valid: false, error: `Invalid color for "${key}": expected hex format (#RRGGBB)` };
      }
    }
    if (data.fonts !== undefined && data.fonts !== null && typeof data.fonts !== 'object') {
      return { valid: false, error: '"fonts" must be an object if provided' };
    }
    return { valid: true };
  }

  function exportTheme() {
    const colors = customizeColors ? { ...customColors } : { ...currentPreset.colors };
    const data = { name: currentPreset.name || selectedTheme, colors, fonts: { fontFamily, fontMono } };
    const json = JSON.stringify(data, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `voice-mirror-theme-${selectedTheme}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showMessage(`Exported "${data.name}" theme`, 'success');
  }

  function importTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const validation = validateThemeJson(data);
        if (!validation.valid) { showMessage(`Import failed: ${validation.error}`, 'error'); return; }
        customColors = { ...data.colors };
        customizeColors = true;
        const fonts = data.fonts || { fontFamily, fontMono };
        applyTheme(data.colors, fonts);
        if (data.fonts?.fontFamily) fontFamily = data.fonts.fontFamily;
        if (data.fonts?.fontMono) fontMono = data.fonts.fontMono;
        showMessage(`Imported "${data.name || file.name.replace('.json', '')}" theme`, 'success');
      } catch (err) {
        console.error('[ThemeSection] Import failed:', err);
        showMessage('Import failed: invalid JSON file', 'error');
      }
    };
    input.click();
  }
</script>

<!-- Theme Preset Grid -->
<section class="settings-section">
  <h3>Theme</h3>
  <div class="settings-group">
    <div class="theme-preset-grid">
      {#each Object.entries(PRESETS) as [key, preset]}
        <button
          class="theme-preset-card"
          class:active={selectedTheme === key}
          onclick={() => handleThemeChange(key)}
        >
          <div class="preset-swatches">
            {#each ['bg', 'accent', 'ok', 'warn', 'danger'] as colorKey}
              <div class="preset-swatch" style:background={preset.colors[colorKey]}></div>
            {/each}
          </div>
          <span class="preset-name">{preset.name}</span>
        </button>
      {/each}
    </div>

    <div class="theme-actions">
      <Button variant="secondary" small onClick={importTheme}>Import Theme</Button>
      <Button variant="secondary" small onClick={exportTheme}>Export Theme</Button>
    </div>
    {#if importExportMessage}
      <div class="import-export-message" class:error={importExportStatus === 'error'}>
        {importExportMessage}
      </div>
    {/if}
  </div>
</section>

<!-- Custom Colors -->
<section class="settings-section">
  <h3>Custom Colors</h3>
  <div class="settings-group">
    <Toggle
      label="Customize Colors"
      description="Override preset colors with custom values"
      checked={customizeColors}
      onChange={handleCustomizeToggle}
    />
    {#if customizeColors}
      <div class="color-picker-grid">
        {#each COLOR_GROUPS as group}
          <div class="color-group">
            <span class="color-group-label">{group.label}</span>
            <div class="color-group-items">
              {#each group.keys as key}
                <label class="color-picker-item">
                  <input
                    type="color"
                    value={customColors[key]}
                    oninput={(e) => handleColorChange(key, e.target.value)}
                    class="color-input"
                  />
                  <div class="color-picker-info">
                    <span class="color-picker-name">{COLOR_LABELS[key]}</span>
                    <span class="color-picker-hex">{customColors[key]}</span>
                  </div>
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .theme-preset-grid {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding: 12px;
  }

  .theme-preset-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    min-width: 80px;
  }

  .theme-preset-card:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  .theme-preset-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-glow);
  }

  .preset-swatches { display: flex; gap: 4px; }

  .preset-swatch {
    width: 16px; height: 16px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .preset-name { font-size: 11px; color: var(--muted); }
  .theme-preset-card.active .preset-name { color: var(--accent); }

  .theme-actions { display: flex; gap: 8px; padding: 8px 12px 12px; }

  .import-export-message {
    margin: 0 12px 12px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    background: var(--ok-subtle);
    color: var(--ok);
    border-left: 3px solid var(--ok);
  }
  .import-export-message.error {
    background: var(--danger-subtle);
    color: var(--danger);
    border-left-color: var(--danger);
  }

  .color-picker-grid { padding: 12px; display: flex; flex-direction: column; gap: 16px; }
  .color-group { display: flex; flex-direction: column; gap: 8px; }
  .color-group-label {
    color: var(--muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  .color-group-items { display: flex; flex-wrap: wrap; gap: 8px; }

  .color-picker-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; background: var(--bg);
    border-radius: var(--radius-sm); cursor: pointer;
    transition: background var(--duration-fast) var(--ease-in-out);
  }
  .color-picker-item:hover { background: var(--bg-hover); }

  .color-input {
    -webkit-appearance: none; appearance: none;
    width: 28px; height: 28px;
    border: 2px solid var(--border-strong);
    border-radius: 50%; cursor: pointer; padding: 0;
    background: none; flex-shrink: 0;
  }
  .color-input::-webkit-color-swatch-wrapper { padding: 0; }
  .color-input::-webkit-color-swatch { border: none; border-radius: 50%; }
  .color-input::-moz-color-swatch { border: none; border-radius: 50%; }

  .color-picker-info { display: flex; flex-direction: column; gap: 1px; }
  .color-picker-name { color: var(--text); font-size: 12px; font-weight: 500; }
  .color-picker-hex { color: var(--muted); font-size: 10px; font-family: var(--font-mono); }

  @media (prefers-reduced-motion: reduce) {
    .theme-preset-card, .color-picker-item { transition: none; }
  }
</style>
