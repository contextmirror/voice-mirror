<script>
  import LensToolbar from './LensToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
</script>

<div class="lens-panel">
  <LensToolbar />
  <LensPreview />
</div>

<style>
  .lens-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }
</style>
