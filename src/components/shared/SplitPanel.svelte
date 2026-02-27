<script>
  /** @type {{ direction?: 'horizontal' | 'vertical', ratio?: number, minA?: number, minB?: number, collapseA?: boolean, collapseB?: boolean, panelA: import('svelte').Snippet, panelB: import('svelte').Snippet }} */
  let {
    direction = 'horizontal',
    ratio = $bindable(0.5),
    minA = 200,
    minB = 200,
    collapseA = false,
    collapseB = false,
    panelA,
    panelB,
  } = $props();

  let containerEl = $state(null);
  let dragging = $state(false);

  function handlePointerDown(e) {
    e.preventDefault();
    dragging = true;
    e.target.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!dragging || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const isH = direction === 'horizontal';
    const total = isH ? rect.width : rect.height;
    const pos = (isH ? e.clientX : e.clientY) - (isH ? rect.left : rect.top);
    const minRatioA = total > 0 ? minA / total : 0;
    const maxRatioA = total > 0 ? 1 - minB / total : 1;
    ratio = Math.max(minRatioA, Math.min(maxRatioA, pos / total));
  }

  function handlePointerUp() {
    dragging = false;
  }

  let effectiveRatio = $derived(collapseA ? 0 : collapseB ? 1 : ratio);

  let panelAStyle = $derived(
    direction === 'horizontal'
      ? `width: ${effectiveRatio * 100}%; height: 100%;`
      : `height: ${effectiveRatio * 100}%; width: 100%;`
  );
  let panelBStyle = $derived(
    direction === 'horizontal'
      ? `width: ${(1 - effectiveRatio) * 100}%; height: 100%;`
      : `height: ${(1 - effectiveRatio) * 100}%; width: 100%;`
  );

  let handleHidden = $derived(collapseA || collapseB);
</script>

<div
  class="split-container"
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:dragging
  bind:this={containerEl}
>
  <div class="split-panel panel-a" style={panelAStyle}>
    {@render panelA()}
  </div>

  {#if !handleHidden}
    <div
      class="split-handle"
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      tabindex="0"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onlostpointercapture={handlePointerUp}
    >
      <div class="handle-line"></div>
    </div>
  {/if}

  <div class="split-panel panel-b" style={panelBStyle}>
    {@render panelB()}
  </div>
</div>

<style>
  .split-container {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    -webkit-app-region: no-drag;
  }
  .split-container.horizontal { flex-direction: row; }
  .split-container.vertical { flex-direction: column; }

  /* Global cursor override during drag */
  .split-container.dragging.horizontal { cursor: col-resize; }
  .split-container.dragging.vertical { cursor: row-resize; }

  .split-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  .split-handle {
    position: relative;
    flex-shrink: 0;
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    background: color-mix(in srgb, var(--text) 12%, var(--bg));
    transition: background var(--duration-fast) var(--ease-out);
  }
  .split-handle:hover {
    background: color-mix(in srgb, var(--accent) 30%, var(--bg));
  }
  .dragging .split-handle {
    background: color-mix(in srgb, var(--accent) 50%, var(--bg));
  }
  .split-handle:focus-visible {
    background: color-mix(in srgb, var(--accent) 40%, var(--bg));
  }
  .horizontal > .split-handle {
    width: 4px;
    cursor: col-resize;
  }
  .vertical > .split-handle {
    height: 4px;
    cursor: row-resize;
  }

  .handle-line {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .handle-line { transition: none; }
  }
</style>
