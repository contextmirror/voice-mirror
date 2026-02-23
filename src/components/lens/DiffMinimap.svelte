<script>
  let {
    chunks = [],
    totalLines = 0,
  } = $props();

  let markers = $derived(
    totalLines > 0
      ? chunks.map(chunk => ({
          top: (chunk.startLine / totalLines) * 100,
          height: Math.max(((chunk.endLine - chunk.startLine + 1) / totalLines) * 100, 0.5),
          type: chunk.type,
        }))
      : []
  );
</script>

<div class="diff-minimap">
  {#each markers as marker}
    <div
      class="minimap-marker {marker.type}"
      style="top: {marker.top}%; height: {marker.height}%"
    ></div>
  {/each}
</div>

<style>
  .diff-minimap {
    position: absolute;
    top: 0;
    right: 0;
    width: 14px;
    height: 100%;
    z-index: 8;
    pointer-events: none;
  }

  .minimap-marker {
    position: absolute;
    left: 3px;
    right: 3px;
    min-height: 3px;
    border-radius: 2px;
  }

  .minimap-marker.addition {
    background: color-mix(in srgb, var(--ok) 80%, transparent);
  }

  .minimap-marker.deletion {
    background: color-mix(in srgb, var(--danger) 80%, transparent);
  }

  .minimap-marker.change {
    background: color-mix(in srgb, var(--accent) 80%, transparent);
  }
</style>
