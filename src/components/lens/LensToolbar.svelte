<script>
  import { lensStore } from '../../lib/stores/lens.svelte.js';

  let urlInput = $state('');

  $effect(() => {
    urlInput = lensStore.inputUrl;
  });

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (trimmed) {
      lensStore.navigate(trimmed);
    }
  }

  function handleBack() { lensStore.goBack(); }
  function handleForward() { lensStore.goForward(); }
  function handleReload() { lensStore.reload(); }
</script>

<div class="lens-toolbar">
  <div class="toolbar-nav">
    <button class="nav-btn" onclick={handleBack} disabled={!lensStore.canGoBack} title="Go back" aria-label="Go back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="nav-btn" onclick={handleForward} disabled={!lensStore.canGoForward} title="Go forward" aria-label="Go forward">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <button class="nav-btn" onclick={handleReload} title="Reload" aria-label="Reload page">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
    </button>
  </div>

  <form class="url-bar" onsubmit={handleSubmit}>
    <input
      class="url-input"
      type="text"
      bind:value={urlInput}
      placeholder="Enter URL or search..."
      spellcheck="false"
      autocomplete="off"
    />
  </form>

</div>

<style>
  .lens-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
  }

  .toolbar-nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg);
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .url-bar {
    flex: 1;
    display: flex;
  }

  .url-input {
    flex: 1;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .url-input:focus {
    border-color: var(--accent);
  }

  .url-input::placeholder {
    color: var(--muted);
  }

</style>
