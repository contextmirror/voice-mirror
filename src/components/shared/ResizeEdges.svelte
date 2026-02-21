<script>
  import { getCurrentWindow } from '@tauri-apps/api/window';

  const appWindow = getCurrentWindow();

  function startResize(direction) {
    return (e) => {
      e.preventDefault();
      appWindow.startResizeDragging(direction);
    };
  }
</script>

<!-- Edges -->
<div class="resize-edge top" onmousedown={startResize('North')}></div>
<div class="resize-edge right" onmousedown={startResize('East')}></div>
<div class="resize-edge bottom" onmousedown={startResize('South')}></div>
<div class="resize-edge left" onmousedown={startResize('West')}></div>

<!-- Corners -->
<div class="resize-corner nw" onmousedown={startResize('NorthWest')}></div>
<div class="resize-corner ne" onmousedown={startResize('NorthEast')}></div>
<div class="resize-corner sw" onmousedown={startResize('SouthWest')}></div>
<div class="resize-corner se" onmousedown={startResize('SouthEast')}></div>

<style>
  .resize-edge,
  .resize-corner {
    position: fixed;
    z-index: 99999;
    -webkit-app-region: no-drag;
  }

  /* Edges — 6px strips along each side, leaving 12px gaps at corners */
  .resize-edge.top    { top: 0;    left: 12px; right: 12px; height: 6px; cursor: n-resize; }
  .resize-edge.bottom { bottom: 0; left: 12px; right: 12px; height: 6px; cursor: s-resize; }
  .resize-edge.left   { left: 0;   top: 12px;  bottom: 12px; width: 6px; cursor: w-resize; }
  .resize-edge.right  { right: 0;  top: 12px;  bottom: 12px; width: 6px; cursor: e-resize; }

  /* Corners — 12×12px squares */
  .resize-corner.nw { top: 0;    left: 0;   width: 12px; height: 12px; cursor: nw-resize; }
  .resize-corner.ne { top: 0;    right: 0;  width: 12px; height: 12px; cursor: ne-resize; }
  .resize-corner.sw { bottom: 0; left: 0;   width: 12px; height: 12px; cursor: sw-resize; }
  .resize-corner.se { bottom: 0; right: 0;  width: 12px; height: 12px; cursor: se-resize; }
</style>
