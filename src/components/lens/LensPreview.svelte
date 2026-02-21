<script>
  import { lensStore, DEFAULT_URL } from '../../lib/stores/lens.svelte.js';
  import { lensCreateWebview, lensResizeWebview, lensCloseWebview } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';

  let containerEl = $state(null);
  let resizeObserver = $state(null);
  let resizeTimeout = $state(null);
  let unlistenUrl = $state(null);

  function getAbsoluteBounds() {
    if (!containerEl) return null;
    const rect = containerEl.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function syncBounds() {
    const bounds = getAbsoluteBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    lensResizeWebview(bounds.x, bounds.y, bounds.width, bounds.height).catch(() => {});
  }

  // Hide/show webview when lensStore.hidden changes (e.g. screenshot picker overlay)
  $effect(() => {
    if (!lensStore.webviewReady) return;
    if (lensStore.hidden) {
      // Move webview off-screen so DOM overlays can render above it
      lensResizeWebview(-9999, -9999, 0, 0).catch(() => {});
    } else {
      // Restore correct bounds
      syncBounds();
    }
  });

  $effect(() => {
    if (!containerEl) return;

    let cancelled = false;

    async function setup() {
      // Listen for URL change events first (before webview creation)
      const ul = await listen('lens-url-changed', (event) => {
        if (event.payload?.url) {
          lensStore.setUrl(event.payload.url);
          lensStore.setInputUrl(event.payload.url);
        }
        lensStore.setLoading(false);
      });
      if (cancelled) { ul(); return; }
      unlistenUrl = ul;

      // Wait for layout to settle before measuring bounds (double rAF)
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });

      if (cancelled) return;

      const bounds = getAbsoluteBounds();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        console.warn('[LensPreview] Container has zero bounds, skipping webview creation');
        return;
      }

      console.log('[LensPreview] Creating webview at', bounds);

      try {
        await lensCreateWebview(
          DEFAULT_URL,
          bounds.x, bounds.y,
          bounds.width, bounds.height,
        );
        if (cancelled) {
          lensCloseWebview().catch(() => {});
          return;
        }
        lensStore.setWebviewReady(true);
        console.log('[LensPreview] Webview ready');
      } catch (err) {
        console.error('[LensPreview] Failed to create webview:', err);
        return;
      }

      // Observe container resize for bounds syncing
      const observer = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => syncBounds(), 50);
      });
      observer.observe(containerEl);
      resizeObserver = observer;
    }

    setup().catch((err) => {
      console.error('[LensPreview] Setup failed:', err);
    });

    return () => {
      cancelled = true;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (unlistenUrl) {
        unlistenUrl();
        unlistenUrl = null;
      }
      lensCloseWebview().catch(() => {});
      lensStore.setWebviewReady(false);
    };
  });
</script>

<div class="lens-preview" bind:this={containerEl}>
  {#if !lensStore.webviewReady}
    <div class="lens-loading">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <p>Loading browser...</p>
    </div>
  {/if}
</div>

<style>
  .lens-preview {
    flex: 1;
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }

  .lens-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--muted);
  }

  .lens-loading svg {
    opacity: 0.3;
  }

  .lens-loading p {
    font-size: 13px;
    margin: 0;
  }
</style>
