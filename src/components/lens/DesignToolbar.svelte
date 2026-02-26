<script>
  import { designCommand, designGetElement, lensCapturePreview } from '../../lib/api.js';

  let { onSend = () => {}, onClose = () => {}, onElementSend = () => {} } = $props();

  let activeTool = $state('pen');
  let activeColor = $state('#ff0000');
  let activeSize = $state(3);
  let sizeLabel = $derived(activeTool === 'text' ? `Font: ${activeSize * 4 + 8}px` : `Size: ${activeSize}`);

  const tools = [
    { id: 'select', label: 'Select Element', icon: '' },
    { id: 'pen', label: 'Pen', icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z' },
    { id: 'line', label: 'Line', icon: 'M4 20L20 4' },
    { id: 'arrow', label: 'Arrow', icon: 'M5 19L19 5M19 5v6M19 5h-6' },
    { id: 'rect', label: 'Rectangle', icon: 'M3 5h18v14H3z' },
    { id: 'circle', label: 'Circle', icon: '' },
    { id: 'text', label: 'Text', icon: 'M6 4v2h5v14h2V6h5V4z' },
    { id: 'marker', label: 'Marker', icon: 'M2 16l6-6 4 4-6 6H2v-4zM14 6l4-4 4 4-4 4-4-4z' },
    { id: 'pixelate', label: 'Pixelate', icon: '' },
  ];

  const colors = [
    '#ff0000', '#0066ff', '#00cc44', '#ffcc00',
    '#ff6600', '#9933ff', '#ffffff', '#000000',
  ];

  async function selectTool(tool) {
    activeTool = tool;
    await designCommand('set_tool', { tool });
  }

  async function selectColor(color) {
    activeColor = color;
    await designCommand('set_color', { color });
  }

  let sizeTimer = null;
  function handleSizeInput(e) {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val)) return;
    activeSize = val;
    // Debounce IPC — only send after 50ms of no movement
    if (sizeTimer) clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      designCommand('set_size', { size: activeSize });
    }, 50);
  }

  async function undo() { await designCommand('undo', {}); }
  async function redo() { await designCommand('redo', {}); }
  async function clear() { await designCommand('clear', {}); }

  /** Crop a data URL image to the given bounds using canvas. */
  async function cropScreenshot(dataUrl, bounds) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.round(bounds.x * dpr);
        const sy = Math.round(bounds.y * dpr);
        const sw = Math.round(bounds.width * dpr);
        const sh = Math.round(bounds.height * dpr);

        const cx = Math.max(0, Math.min(sx, img.width));
        const cy = Math.max(0, Math.min(sy, img.height));
        const cw = Math.min(sw, img.width - cx);
        const ch = Math.min(sh, img.height - cy);

        if (cw <= 0 || ch <= 0) {
          resolve(dataUrl);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /** Handle "Send to Chat" for a selected element — crop screenshot + format context. */
  async function handleElementSend() {
    console.log('[DesignToolbar] handleElementSend called');
    try {
      const elemResult = await designGetElement();
      console.log('[DesignToolbar] designGetElement result:', elemResult);
      if (!elemResult?.success || !elemResult?.data) {
        console.warn('[DesignToolbar] No element selected:', elemResult?.error);
        return;
      }
      const elem = elemResult.data;
      console.log('[DesignToolbar] Element data:', elem.tagName, elem.selector);

      const screenshotResult = await lensCapturePreview();
      console.log('[DesignToolbar] Screenshot result:', screenshotResult?.success, screenshotResult?.data?.dataUrl?.length);
      if (!screenshotResult?.success || !screenshotResult?.data?.dataUrl) {
        console.warn('[DesignToolbar] Screenshot failed:', screenshotResult?.error);
        return;
      }

      const croppedDataUrl = await cropScreenshot(
        screenshotResult.data.dataUrl,
        elem.bounds
      );
      console.log('[DesignToolbar] Cropped screenshot length:', croppedDataUrl?.length);

      // Format parent chain
      const parentLines = (elem.parentChain || []).map(p => {
        const id = p.id ? '#' + p.id : '';
        const cls = p.classes ? '.' + p.classes.split(' ').join('.') : '';
        const childInfo = p.children ? ` (${p.childCount} children: ${p.children.join(', ')})` : '';
        const styles = Object.entries(p.styles || {})
          .filter(([, v]) => v && v !== 'static' && v !== 'visible' && v !== 'none' && v !== 'normal')
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        return `  ${p.tagName}${id}${cls}${childInfo}\n    ${styles}`;
      }).join('\n');

      // Format pseudo-class rules
      const pseudoLines = (elem.pseudoRules || []).map(r => `  ${r.css}`).join('\n');

      const styleLines = Object.entries(elem.styles || {})
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');

      const classes = typeof elem.classes === 'string' ? elem.classes : (Array.isArray(elem.classes) ? elem.classes.join(' ') : '');

      // Format accessibility info
      const a11y = elem.accessibility || {};
      const roleLine = a11y.role ? `Role: ${a11y.role}` : null;
      const ariaEntries = Object.entries(a11y.ariaAttributes || {});
      const ariaLine = ariaEntries.length > 0
        ? `ARIA: ${ariaEntries.map(([k, v]) => `${k}="${v}"`).join('; ')}`
        : null;
      const statesLine = (a11y.htmlStates || []).length > 0
        ? `States: ${a11y.htmlStates.join(', ')}`
        : null;

      let contextText = [
        `Selected element: ${elem.tagName}${elem.id ? '#' + elem.id : ''}${classes ? '.' + classes.split(' ').join('.') : ''}`,
        `Selector: ${elem.selector}`,
        `Size: ${elem.bounds.width} x ${elem.bounds.height}px`,
        roleLine,
        ariaLine,
        statesLine,
        elem.text ? `Text: "${elem.text}"` : null,
        '',
        'HTML:',
        elem.html,
        parentLines ? '\nParent chain:' : null,
        parentLines || null,
        pseudoLines ? '\nPseudo-class rules:' : null,
        pseudoLines || null,
        '',
        'Computed styles:',
        styleLines
      ].filter(v => v !== null && v !== undefined).join('\n');

      // Cap total context at 8000 characters
      if (contextText.length > 8000) {
        contextText = contextText.substring(0, 7980) + '\n[...truncated]';
      }

      console.log('[DesignToolbar] Calling onElementSend with context length:', contextText.length);
      onElementSend({
        imageDataUrl: croppedDataUrl,
        contextText: contextText,
        name: `Element: ${elem.selector.split(' > ').pop()}`
      });
      console.log('[DesignToolbar] onElementSend completed');
    } catch (err) {
      console.error('[DesignToolbar] Element send failed:', err);
    }
  }
</script>

<div class="design-toolbar">
  <!-- Tool buttons -->
  <div class="tool-group">
    {#each tools as tool}
      <button
        class="tool-btn"
        class:active={activeTool === tool.id}
        onclick={() => selectTool(tool.id)}
        title={tool.label}
        aria-label={tool.label}
      >
        {#if tool.id === 'select'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M8 12h.01M12 12h.01M16 12h.01"/>
          </svg>
        {:else if tool.id === 'circle'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9"/>
          </svg>
        {:else if tool.id === 'pixelate'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/>
            <rect x="9" y="9" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/>
            <rect x="15" y="15" width="6" height="6"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d={tool.icon}/>
          </svg>
        {/if}
      </button>
    {/each}
  </div>

  {#if activeTool !== 'select'}
    <div class="separator"></div>

    <!-- Color swatches -->
    <div class="color-group">
      {#each colors as color}
        <button
          class="color-swatch"
          class:active={activeColor === color}
          style="background: {color};"
          onclick={() => selectColor(color)}
          title={color}
          aria-label="Color {color}"
        ></button>
      {/each}
    </div>

    <div class="separator"></div>

    <!-- Size control -->
    <div class="size-group">
      <div
        class="size-preview"
        style="width: {Math.max(activeSize, 2)}px; height: {Math.max(activeSize, 2)}px; background: {activeColor};"
      ></div>
      <input
        type="range"
        class="size-slider"
        min="1"
        max="20"
        value={activeSize}
        oninput={handleSizeInput}
        title={sizeLabel}
      />
      <span class="size-label">{sizeLabel}</span>
    </div>

    <div class="separator"></div>

    <!-- Undo / Redo / Clear -->
    <div class="action-group">
      <button class="tool-btn" onclick={undo} title="Undo" aria-label="Undo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </button>
      <button class="tool-btn" onclick={redo} title="Redo" aria-label="Redo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
      <button class="tool-btn" onclick={clear} title="Clear all" aria-label="Clear all annotations">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  {/if}

  <div class="spacer"></div>

  <!-- Send to Claude -->
  <button class="send-btn" onclick={activeTool === 'select' ? handleElementSend : onSend} title={activeTool === 'select' ? 'Send selected element to chat' : 'Send annotated screenshot to chat'}>
    Send to Chat
  </button>
</div>

<style>
  .design-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    z-index: 10001;
  }

  .tool-group,
  .color-group,
  .action-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .size-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .separator {
    width: 1px;
    height: 20px;
    background: var(--muted);
    margin: 0 4px;
    opacity: 0.4;
  }

  .spacer {
    flex: 1;
  }

  .tool-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out);
  }

  .tool-btn.active {
    background: var(--accent);
    color: var(--bg);
  }

  .tool-btn:hover:not(.active) {
    background: color-mix(in srgb, var(--text) 15%, transparent);
  }

  .color-swatch {
    width: 18px;
    height: 18px;
    border: 2px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
    transition: border-color var(--duration-fast, 100ms) var(--ease-out, ease-out);
  }

  .color-swatch.active {
    border-color: var(--accent);
  }

  .color-swatch:hover:not(.active) {
    border-color: var(--text);
  }

  .size-preview {
    border-radius: 50%;
    min-width: 2px;
    min-height: 2px;
    max-width: 20px;
    max-height: 20px;
  }

  .size-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 14px;
    background: transparent;
    outline: none;
    cursor: pointer;
    margin: 0;
    padding: 0;
  }

  .size-slider::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    background: color-mix(in srgb, var(--text) 25%, transparent);
    border-radius: 2px;
    border: none;
  }

  .size-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    border: none;
    cursor: pointer;
    margin-top: -5px;
  }

  .size-slider::-webkit-slider-thumb:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--text-strong));
  }

  .size-label {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    min-width: 52px;
  }

  .send-btn {
    padding: 4px 12px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity var(--duration-fast, 100ms) var(--ease-out, ease-out);
  }

  .send-btn:hover {
    opacity: 0.85;
  }
</style>
