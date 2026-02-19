<script>
  /**
   * OverlayPanel.svelte -- Compact overlay mode showing just the orb.
   *
   * In overlay mode the window shrinks to a small floating circle.
   * Clicking the orb expands back to the full app.
   *
   * Dragging is handled programmatically via Tauri's startDragging() API
   * because transparent window areas don't receive mouse events on Windows.
   * A movement threshold (3px) distinguishes click from drag.
   */

  import { getCurrentWindow } from '@tauri-apps/api/window';
  import Orb from './Orb.svelte';
  import { overlayStore } from '../../lib/stores/overlay.svelte.js';
  import { configStore } from '../../lib/stores/config.svelte.js';

  let orbState = $derived(overlayStore.orbState);
  let orbSize = $derived(configStore.value?.appearance?.orbSize || 64);

  // ---- Drag vs. click detection ----
  let dragStart = null;
  let hasDragged = false;

  function onPointerDown(e) {
    dragStart = { x: e.clientX, y: e.clientY };
    hasDragged = false;
  }

  function onPointerMove(e) {
    if (!dragStart) return;
    const dx = Math.abs(e.clientX - dragStart.x);
    const dy = Math.abs(e.clientY - dragStart.y);
    if (dx > 3 || dy > 3) {
      hasDragged = true;
      dragStart = null;
      // Hand off to OS-level window drag — browser won't receive
      // further pointer events until the user releases the mouse.
      getCurrentWindow().startDragging();
    }
  }

  function handleOrbClick() {
    // After startDragging(), no click event fires, so this only
    // runs on genuine clicks (no movement > 3px threshold).
    if (hasDragged) return;
    overlayStore.expand();
  }
</script>

<div class="overlay-panel">
  <div
    class="orb-container"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
  >
    <Orb state={orbState} size={orbSize} onclick={handleOrbClick} />
  </div>
</div>

<style>
  .overlay-panel {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    overflow: hidden;
  }

  .orb-container {
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    cursor: grab;
  }

  .orb-container:active {
    cursor: grabbing;
  }
</style>
