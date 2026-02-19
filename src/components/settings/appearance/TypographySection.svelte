<script>
  /**
   * TypographySection -- Font selection, size, upload custom fonts.
   */
  import { toastStore } from '../../../lib/stores/toast.svelte.js';
  import Select from '../../shared/Select.svelte';
  import Slider from '../../shared/Slider.svelte';
  import Button from '../../shared/Button.svelte';

  let {
    fontFamily = $bindable(),
    fontMono = $bindable(),
    fontSize = $bindable(),
    customFonts = $bindable(),
  } = $props();

  const _injectedFontStyles = new Map();

  const baseFontFamilyOptions = [
    { value: "'Segoe UI', system-ui, -apple-system, sans-serif", label: 'Segoe UI (Default)' },
    { value: "'Inter', system-ui, sans-serif", label: 'Inter' },
    { value: "'SF Pro Display', -apple-system, sans-serif", label: 'SF Pro' },
    { value: "'Helvetica Neue', Helvetica, sans-serif", label: 'Helvetica Neue' },
    { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
    { value: "'Fira Sans', sans-serif", label: 'Fira Sans' },
    { value: "'IBM Plex Sans', sans-serif", label: 'IBM Plex Sans' },
    { value: "'Roboto', sans-serif", label: 'Roboto' },
  ];

  const baseFontMonoOptions = [
    { value: "'Cascadia Code', 'Fira Code', monospace", label: 'Cascadia Code (Default)' },
    { value: "'Fira Code', monospace", label: 'Fira Code' },
    { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
    { value: "'Source Code Pro', monospace", label: 'Source Code Pro' },
    { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
    { value: "'Hack', monospace", label: 'Hack' },
    { value: "'Iosevka', monospace", label: 'Iosevka' },
  ];

  const fontFamilyOptions = $derived([
    ...baseFontFamilyOptions,
    ...customFonts.filter(f => f.type === 'ui')
      .map(f => ({ value: `'${f.familyName}', sans-serif`, label: f.displayName })),
  ]);

  const fontMonoOptions = $derived([
    ...baseFontMonoOptions,
    ...customFonts.filter(f => f.type === 'mono')
      .map(f => ({ value: `'${f.familyName}', monospace`, label: f.displayName })),
  ]);

  // Inject all custom fonts (idempotent — checks Map before adding)
  $effect(() => {
    for (const font of customFonts) {
      injectCustomFont(font);
    }
  });

  function fontId(name, type) {
    return `custom-${type}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  }

  function fontNameFromFile(filename) {
    return filename.replace(/\.(ttf|otf|woff|woff2)$/i, '').replace(/[-_]/g, ' ');
  }

  function injectCustomFont(font) {
    if (_injectedFontStyles.has(font.id)) return;
    const style = document.createElement('style');
    style.dataset.fontId = font.id;
    style.textContent = `@font-face { font-family: '${font.familyName}'; src: url('${font.dataUrl}'); }`;
    document.head.appendChild(style);
    _injectedFontStyles.set(font.id, style);
  }

  function removeInjectedFont(id) {
    const style = _injectedFontStyles.get(id);
    if (style) { style.remove(); _injectedFontStyles.delete(id); }
  }

  /** Exported so the parent can call it during reset */
  export function removeAllInjectedFonts() {
    for (const [id] of _injectedFontStyles) {
      removeInjectedFont(id);
    }
  }

  function handleUploadFont(type) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.woff,.woff2';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const displayName = fontNameFromFile(file.name);
      const familyName = `VM-${displayName.replace(/\s+/g, '')}`;
      const id = fontId(familyName, type);
      if (customFonts.some(f => f.id === id)) {
        toastStore.addToast({ message: `Font "${displayName}" already uploaded`, severity: 'warning' });
        return;
      }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const entry = { id, displayName, familyName, type, dataUrl };
        injectCustomFont(entry);
        customFonts = [...customFonts, entry];
        const fontValue = type === 'ui' ? `'${familyName}', sans-serif` : `'${familyName}', monospace`;
        if (type === 'ui') fontFamily = fontValue;
        else fontMono = fontValue;
        toastStore.addToast({ message: `Added "${displayName}" as ${type} font`, severity: 'success' });
      } catch (err) {
        console.error('[TypographySection] Font upload failed:', err);
        toastStore.addToast({ message: 'Failed to read font file', severity: 'error' });
      }
    };
    input.click();
  }

  function handleRemoveFont(id) {
    const font = customFonts.find(f => f.id === id);
    if (!font) return;
    removeInjectedFont(id);
    const fontValue = font.type === 'ui'
      ? `'${font.familyName}', sans-serif`
      : `'${font.familyName}', monospace`;
    if (font.type === 'ui' && fontFamily === fontValue) fontFamily = baseFontFamilyOptions[0].value;
    else if (font.type === 'mono' && fontMono === fontValue) fontMono = baseFontMonoOptions[0].value;
    customFonts = customFonts.filter(f => f.id !== id);
    toastStore.addToast({ message: `Removed "${font.displayName}"`, severity: 'success' });
  }
</script>

<section class="settings-section">
  <h3>Typography</h3>
  <div class="settings-group">
    <div class="font-section">
      <Select label="UI Font" value={fontFamily} options={fontFamilyOptions}
        onChange={(v) => (fontFamily = v)} />
      <span class="font-desc">Labels, menus, chat text, and general interface</span>
    </div>
    <div class="font-section">
      <Select label="Mono Font" value={fontMono} options={fontMonoOptions}
        onChange={(v) => (fontMono = v)} />
      <span class="font-desc">Terminal, code blocks, and technical content</span>
    </div>
    <Slider label="Font Size" value={fontSize} min={10} max={20} step={1}
      onChange={(v) => (fontSize = v)} formatValue={(v) => v + 'px'} />
    <div class="font-upload-row">
      <Button variant="secondary" small onClick={() => handleUploadFont('ui')}>Upload Custom UI Font</Button>
      <Button variant="secondary" small onClick={() => handleUploadFont('mono')}>Upload Custom Mono Font</Button>
    </div>

    {#if customFonts.length > 0}
      <div class="custom-fonts-list">
        <span class="custom-fonts-heading">Custom Fonts</span>
        <div class="custom-fonts-items">
          {#each customFonts as font (font.id)}
            <div class="custom-font-item">
              <span class="custom-font-name">{font.displayName}</span>
              <span class="custom-font-type">{font.type}</span>
              <button class="custom-font-remove" title="Remove font"
                onclick={() => handleRemoveFont(font.id)}>&times;</button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .font-section { border-bottom: 1px solid var(--border); }
  .font-section:last-of-type { border-bottom: none; }
  .font-desc {
    display: block; font-size: 11px; color: var(--muted);
    padding: 0 12px 10px; margin-top: -6px;
  }
  .font-upload-row { display: flex; gap: 8px; padding: 8px 12px 12px; }

  .custom-fonts-list { padding: 12px; border-top: 1px solid var(--border); margin-top: 4px; }
  .custom-fonts-heading {
    display: block; color: var(--muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px;
  }
  .custom-fonts-items { display: flex; flex-direction: column; gap: 6px; }
  .custom-font-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; background: var(--bg); border-radius: var(--radius-sm);
  }
  .custom-font-name {
    flex: 1; color: var(--text); font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .custom-font-type {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
    color: var(--accent); background: var(--accent-subtle);
    padding: 2px 6px; border-radius: var(--radius-sm); flex-shrink: 0;
  }
  .custom-font-remove {
    background: none; border: none; color: var(--muted);
    font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1;
    border-radius: var(--radius-sm); flex-shrink: 0;
    transition: color var(--duration-fast) var(--ease-in-out),
      background var(--duration-fast) var(--ease-in-out);
  }
  .custom-font-remove:hover { color: var(--danger); background: var(--danger-subtle); }
</style>
