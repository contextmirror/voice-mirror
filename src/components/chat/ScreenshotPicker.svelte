<script>
  /**
   * ScreenshotPicker -- Modal for selecting a screenshot target.
   *
   * Three tabs: Browser Tab (disabled), Window, Entire Screen.
   * Shows base64 thumbnails of available targets. User selects one
   * and clicks "Share" to capture full-res.
   */
  import { fade, fly } from 'svelte/transition';
  import { listMonitors, listWindows, captureMonitor, captureWindow } from '../../lib/api.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';

  let {
    onCapture = () => {},
    onClose = () => {},
    browserSnapshot = null,
  } = $props();

  let activeTab = $state(browserSnapshot ? 'browser' : 'screen');
  let monitors = $state([]);
  let windows = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let selectedMonitor = $state(null);
  let selectedWindow = $state(null);
  let capturing = $state(false);

  // Track which tabs have been loaded to avoid redundant fetches
  let monitorsLoaded = $state(false);
  let windowsLoaded = $state(false);

  const hasBrowser = $derived(browserSnapshot !== null);

  const canShare = $derived(
    (activeTab === 'browser' && hasBrowser) ||
    (activeTab === 'screen' && selectedMonitor !== null) ||
    (activeTab === 'window' && selectedWindow !== null)
  );

  async function loadMonitors() {
    if (monitorsLoaded && monitors.length > 0) {
      loading = false;
      return;
    }
    loading = true;
    error = null;
    try {
      const result = await listMonitors();
      const data = result?.data || result;
      const list = Array.isArray(data) ? data : [];
      // Sort primary monitor first
      monitors = list.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
      monitorsLoaded = true;
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  async function loadWindows() {
    if (windowsLoaded && windows.length > 0) {
      loading = false;
      return;
    }
    loading = true;
    error = null;
    try {
      const result = await listWindows();
      const data = result?.data || result;
      windows = Array.isArray(data) ? data : [];
      windowsLoaded = true;
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  function switchTab(tab) {
    if (tab === activeTab) return;
    activeTab = tab;
    selectedMonitor = null;
    selectedWindow = null;
    error = null;

    if (tab === 'screen') loadMonitors();
    else if (tab === 'window') loadWindows();
  }

  async function handleShare() {
    if (!canShare || capturing) return;
    capturing = true;
    try {
      if (activeTab === 'browser' && browserSnapshot) {
        // Browser tab uses the pre-captured snapshot
        onCapture(browserSnapshot.path, browserSnapshot.dataUrl || null);
        return;
      }

      let result;
      if (activeTab === 'screen' && selectedMonitor !== null) {
        result = await captureMonitor(selectedMonitor);
      } else if (activeTab === 'window' && selectedWindow !== null) {
        result = await captureWindow(selectedWindow);
      }
      const data = result?.data || result;
      if (data?.path) {
        onCapture(data.path, data.dataUrl || null);
      }
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      capturing = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && canShare) handleShare();
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  // Hide the native webview so this modal renders above it
  $effect(() => {
    lensStore.setHidden(true);
    return () => lensStore.setHidden(false);
  });

  // Load initial data for the default tab
  $effect(() => {
    if (activeTab === 'screen') loadMonitors();
  });
</script>

<svelte:document onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker-overlay" transition:fade={{ duration: 150 }} onclick={handleOverlayClick}>
  <div class="picker-modal" transition:fly={{ y: 20, duration: 200 }}>
    <!-- Header -->
    <div class="picker-header">
      <div>
        <h2 class="picker-title">Choose what to share</h2>
        <p class="picker-subtitle">Select a screen or window to capture.</p>
      </div>
      <button class="close-btn" onclick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Tab bar -->
    <div class="picker-tabs" role="tablist">
      <button
        class="tab"
        class:active={activeTab === 'browser'}
        disabled={!hasBrowser}
        title={hasBrowser ? 'Capture browser content' : 'No browser active'}
        onclick={() => switchTab('browser')}
        role="tab"
        aria-selected={activeTab === 'browser'}
      >
        Browser Tab
      </button>
      <button
        class="tab"
        class:active={activeTab === 'window'}
        onclick={() => switchTab('window')}
        role="tab"
        aria-selected={activeTab === 'window'}
      >
        Window
      </button>
      <button
        class="tab"
        class:active={activeTab === 'screen'}
        onclick={() => switchTab('screen')}
        role="tab"
        aria-selected={activeTab === 'screen'}
      >
        Entire Screen
      </button>
    </div>

    <!-- Content area -->
    <div class="picker-body">
      {#if loading}
        <div class="state-message">
          <div class="spinner"></div>
          <p>Loading previews...</p>
        </div>
      {:else if error}
        <div class="state-message error">
          <p>{error}</p>
          <button class="retry-btn" onclick={() => activeTab === 'screen' ? loadMonitors() : loadWindows()}>
            Retry
          </button>
        </div>
      {:else if activeTab === 'screen'}
        <div class="thumbnail-grid">
          {#each monitors as monitor}
            <button
              class="thumbnail-card"
              class:selected={selectedMonitor === monitor.index}
              onclick={() => { selectedMonitor = monitor.index; }}
            >
              <div class="thumbnail-img-wrap">
                <img
                  src="data:image/png;base64,{monitor.thumbnail}"
                  alt="Screen {monitor.index + 1}"
                  draggable="false"
                />
              </div>
              <div class="thumbnail-label">
                <span class="thumbnail-name">
                  Screen {monitor.index + 1}
                  {#if monitor.primary}
                    <span class="badge">Primary</span>
                  {/if}
                </span>
                <span class="thumbnail-meta">{monitor.width} x {monitor.height}</span>
              </div>
            </button>
          {/each}
        </div>
      {:else if activeTab === 'window'}
        <div class="thumbnail-grid windows">
          {#each windows as win}
            <button
              class="thumbnail-card"
              class:selected={selectedWindow === win.hwnd}
              onclick={() => { selectedWindow = win.hwnd; }}
            >
              <div class="thumbnail-img-wrap">
                <img
                  src="data:image/png;base64,{win.thumbnail}"
                  alt={win.title}
                  draggable="false"
                />
              </div>
              <div class="thumbnail-label">
                {#if win.icon}
                  <img
                    class="window-icon"
                    src="data:image/png;base64,{win.icon}"
                    alt=""
                    width="16"
                    height="16"
                    draggable="false"
                  />
                {/if}
                <span class="thumbnail-name" title={win.title}>{win.title}</span>
              </div>
            </button>
          {/each}
          {#if windows.length === 0}
            <div class="state-message">
              <p>No windows found.</p>
            </div>
          {/if}
        </div>
      {:else if activeTab === 'browser'}
        {#if browserSnapshot}
          <div class="thumbnail-grid">
            <button
              class="thumbnail-card selected"
            >
              <div class="thumbnail-img-wrap">
                <img
                  src="data:image/png;base64,{browserSnapshot.thumbnail}"
                  alt="Browser preview"
                  draggable="false"
                />
              </div>
              <div class="thumbnail-label">
                <span class="thumbnail-name">Lens Browser</span>
              </div>
            </button>
          </div>
        {:else}
          <div class="state-message">
            <p>No browser active. Open a page in the Lens tab first.</p>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    <div class="picker-footer">
      <button class="cancel-btn" onclick={onClose}>Cancel</button>
      <button
        class="share-btn"
        disabled={!canShare || capturing}
        onclick={handleShare}
      >
        {#if capturing}
          Capturing...
        {:else}
          Share
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  /* ========== Overlay ========== */
  .picker-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  }

  /* ========== Modal ========== */
  .picker-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg, 12px);
    max-width: 680px;
    width: 92%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-app-region: no-drag;
  }

  /* ========== Header ========== */
  .picker-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px 24px 12px;
  }

  .picker-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
    margin: 0;
  }

  .picker-subtitle {
    font-size: 13px;
    color: var(--muted);
    margin: 4px 0 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm, 4px);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  /* ========== Tabs ========== */
  .picker-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    gap: 0;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-family);
    padding: 10px 16px;
    cursor: pointer;
    transition: color var(--duration-fast, 0.15s) var(--ease-out, ease-out),
                border-color var(--duration-fast, 0.15s) var(--ease-out, ease-out);
  }

  .tab:hover:not(:disabled) {
    color: var(--text);
  }

  .tab.active {
    color: var(--text-strong);
    border-bottom-color: var(--accent);
  }

  .tab:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* ========== Body ========== */
  .picker-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    min-height: 200px;
  }

  /* ========== Thumbnail Grid ========== */
  .thumbnail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }

  .thumbnail-grid.windows {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }

  .thumbnail-card {
    background: var(--bg);
    border: 2px solid var(--border);
    border-radius: var(--radius-md, 8px);
    padding: 0;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    transition: border-color var(--duration-fast, 0.15s) var(--ease-out, ease-out),
                box-shadow var(--duration-fast, 0.15s) var(--ease-out, ease-out);
    display: flex;
    flex-direction: column;
  }

  .thumbnail-card:hover {
    border-color: var(--muted);
  }

  .thumbnail-card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .thumbnail-img-wrap {
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: #111;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .thumbnail-img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .thumbnail-label {
    padding: 8px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
  }

  .thumbnail-name {
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .thumbnail-meta {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .window-icon {
    flex-shrink: 0;
    border-radius: 2px;
  }

  .badge {
    font-size: 10px;
    color: var(--accent);
    background: var(--accent-subtle, rgba(100, 100, 255, 0.1));
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 600;
    flex-shrink: 0;
  }

  /* ========== States ========== */
  .state-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    color: var(--muted);
    font-size: 13px;
    text-align: center;
  }

  .state-message.error {
    color: var(--danger);
  }

  .state-message p {
    margin: 0;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .retry-btn {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 14px;
    border-radius: var(--radius-md, 8px);
    font-size: 13px;
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--bg-hover);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ========== Footer ========== */
  .picker-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 24px 16px;
    border-top: 1px solid var(--border);
  }

  .cancel-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 18px;
    border-radius: var(--radius-md, 8px);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
  }

  .cancel-btn:hover {
    background: var(--bg-hover);
  }

  .share-btn {
    background: var(--accent);
    border: none;
    color: var(--accent-contrast, white);
    padding: 8px 22px;
    border-radius: var(--radius-md, 8px);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background var(--duration-fast, 0.15s) var(--ease-out, ease-out);
  }

  .share-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .share-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      opacity: 0.5;
    }

    .tab,
    .thumbnail-card,
    .share-btn {
      transition: none;
    }
  }
</style>
