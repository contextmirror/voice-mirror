<script>
  import { designCommand } from '../../lib/api.js';

  let { onSend = () => {}, onClose = () => {} } = $props();

  let activeTool = $state('pen');
  let activeColor = $state('#ff0000');
  let activeSize = $state(3);

  const tools = [
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

  function sendSize() {
    designCommand('set_size', { size: activeSize });
  }

  async function undo() { await designCommand('undo', {}); }
  async function redo() { await designCommand('redo', {}); }
  async function clear() { await designCommand('clear', {}); }
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
        {#if tool.id === 'circle'}
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
      bind:value={activeSize}
      oninput={sendSize}
      title="Brush size: {activeSize}"
    />
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

  <div class="spacer"></div>

  <!-- Send to Claude -->
  <button class="send-btn" onclick={onSend} title="Send annotated screenshot to Claude">
    Send to Claude
  </button>
</div>

<style>
  .design-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--muted);
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
    width: 60px;
    height: 4px;
    accent-color: var(--accent);
    cursor: pointer;
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
