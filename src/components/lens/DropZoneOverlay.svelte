<script>
  let { active = false, zone = 'center' } = $props();
</script>

{#if active}
  <div class="drop-zone-overlay">
    <div class="zone zone-center" class:active={zone === 'center'}></div>
    <div class="zone zone-left" class:active={zone === 'left'}></div>
    <div class="zone zone-right" class:active={zone === 'right'}></div>
    <div class="zone zone-top" class:active={zone === 'top'}></div>
    <div class="zone zone-bottom" class:active={zone === 'bottom'}></div>
  </div>
{/if}

<style>
  .drop-zone-overlay {
    position: absolute;
    inset: 0;
    z-index: 10000;
    pointer-events: none;
  }

  .zone {
    position: absolute;
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border: 2px dashed var(--accent);
    border-radius: 4px;
    opacity: 0;
    transition: opacity 70ms ease-out;
  }

  .zone.active {
    opacity: 1;
  }

  .zone-center {
    inset: 8px;
  }

  .zone-left {
    top: 8px;
    bottom: 8px;
    left: 8px;
    width: calc(50% - 12px);
  }

  .zone-right {
    top: 8px;
    bottom: 8px;
    right: 8px;
    width: calc(50% - 12px);
  }

  .zone-top {
    top: 8px;
    left: 8px;
    right: 8px;
    height: calc(50% - 12px);
  }

  .zone-bottom {
    bottom: 8px;
    left: 8px;
    right: 8px;
    height: calc(50% - 12px);
  }
</style>
