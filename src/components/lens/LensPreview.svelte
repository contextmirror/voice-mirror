<script>
  import { onMount, onDestroy } from 'svelte';
  import { lensStore, DEFAULT_URL } from '../../lib/stores/lens.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { lensCreateWebview, lensResizeWebview, lensCloseWebview, detectDevServers } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';

  let containerEl = $state(null);
  let resizeObserver = null;
  let rafId = null;
  let unlistenUrl = null;
  let setupDone = false;
  let retryCount = 0;
  let retryTimer = null;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;
  const LOADING_TIMEOUT_MS = 15000;
  let loadingTimer = null;

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

  /** Safety net: clear loading state after timeout so user is never stuck. */
  function startLoadingTimeout() {
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      if (lensStore.loading) {
        console.warn('[LensPreview] Loading timeout — clearing stuck loading state');
        lensStore.setLoading(false);
      }
    }, LOADING_TIMEOUT_MS);
  }

  /** Watch loading state to arm/disarm the safety timeout. */
  $effect(() => {
    if (lensStore.loading) {
      startLoadingTimeout();
    } else {
      clearTimeout(loadingTimer);
    }
  });

  // ---- Project switch → dev server detection + browser navigation ----
  let lastDetectedProject = $state(null);
  let previousProjectIndex = $state(null);

  // Trigger detection when active project changes
  $effect(() => {
    const project = projectStore.activeProject;
    if (!project || project.path === lastDetectedProject) {
      if (project && previousProjectIndex !== projectStore.activeIndex) {
        previousProjectIndex = projectStore.activeIndex;
      }
      return;
    }

    // Save current URL for the outgoing project before switching
    if (previousProjectIndex !== null && previousProjectIndex !== projectStore.activeIndex && lensStore.webviewReady) {
      const currentUrl = lensStore.url;
      if (currentUrl && currentUrl !== DEFAULT_URL) {
        projectStore.updateProjectField(previousProjectIndex, 'lastBrowserUrl', currentUrl);
      }
    }

    const timer = setTimeout(() => {
      const oldPath = lastDetectedProject;
      lastDetectedProject = project.path;
      previousProjectIndex = projectStore.activeIndex;
      devServerManager.handleProjectSwitch(oldPath, project.path);
      detectAndNavigate(project);
    }, 300);

    return () => clearTimeout(timer);
  });

  // Also trigger detection when webview becomes ready (catches initial load race)
  $effect(() => {
    if (!lensStore.webviewReady) return;
    const project = projectStore.activeProject;
    if (project && project.path !== lastDetectedProject) {
      lastDetectedProject = project.path;
      previousProjectIndex = projectStore.activeIndex;
      detectAndNavigate(project);
    }
  });

  async function detectAndNavigate(project) {
    // Wait for the webview to be ready (may still be creating during first project load)
    if (!lensStore.webviewReady) {
      // Poll for readiness up to 10 seconds (webview creation can take a few seconds)
      const ready = await new Promise(resolve => {
        if (lensStore.webviewReady) return resolve(true);
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 200;
          if (lensStore.webviewReady) { clearInterval(interval); resolve(true); }
          else if (elapsed >= 10000) { clearInterval(interval); resolve(false); }
        }, 200);
      });
      if (!ready) {
        console.warn('[lens] Webview not ready after 10s, skipping detection');
        return;
      }
    }

    lensStore.setDevServerLoading(true);

    try {
      const result = await detectDevServers(project.path);
      const data = result?.data || result || {};
      const servers = data.servers || [];
      const packageManager = data.packageManager || null;
      lensStore.setDevServers(servers);

      // Determine URL to navigate to (priority: preferred > running server > last URL)
      let targetUrl = null;

      if (project.preferredServerUrl) {
        targetUrl = project.preferredServerUrl;
      } else {
        const running = servers.find(s => s.running);
        if (running) {
          targetUrl = running.url;
        } else if (project.lastBrowserUrl) {
          targetUrl = project.lastBrowserUrl;
        }
      }

      if (targetUrl) {
        lensStore.navigate(targetUrl);
      }

      // Auto-start logic for stopped servers
      const stoppedServer = servers.find(s => !s.running);
      if (stoppedServer) {
        const autoStart = project.autoStartServer;
        if (autoStart === null || autoStart === undefined) {
          // Never asked — show consent toast
          toastStore.addToast({
            message: `${stoppedServer.framework || 'Dev server'} on :${stoppedServer.port} is not running.`,
            severity: 'info',
            key: 'dev-server-consent-' + project.path,
            actions: [
              {
                label: 'Always start',
                callback: () => {
                  projectStore.updateActiveField('autoStartServer', true);
                  devServerManager.startServer(stoppedServer, project.path, packageManager);
                },
              },
              {
                label: 'Start once',
                callback: () => {
                  devServerManager.startServer(stoppedServer, project.path, packageManager);
                },
              },
              {
                label: 'Not now',
                callback: () => {},
              },
            ],
          });
        } else if (autoStart === true) {
          // User opted in — auto-start silently
          devServerManager.startServer(stoppedServer, project.path, packageManager);
        }
        // autoStart === false → do nothing
      }
    } catch (err) {
      console.error('[lens] Dev server detection failed:', err);
    } finally {
      lensStore.setDevServerLoading(false);
    }
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

  async function createWebview() {
    if (!containerEl) return;

    // Wait for layout to settle before measuring bounds (double rAF)
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    const bounds = getAbsoluteBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      console.warn('[LensPreview] Container has zero bounds, will retry');
      scheduleRetry();
      return;
    }

    console.log('[LensPreview] Creating webview at', bounds, retryCount > 0 ? `(retry ${retryCount})` : '');

    try {
      await lensCreateWebview(
        DEFAULT_URL,
        bounds.x, bounds.y,
        bounds.width, bounds.height,
      );
      lensStore.setWebviewReady(true);
      retryCount = 0;
      console.log('[LensPreview] Webview ready');

      // Observe container resize — sync bounds on next animation frame
      if (resizeObserver) resizeObserver.disconnect();
      const observer = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => { rafId = null; syncBounds(); });
      });
      observer.observe(containerEl);
      resizeObserver = observer;
    } catch (err) {
      console.error('[LensPreview] Failed to create webview:', err);
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (retryCount >= MAX_RETRIES) {
      console.error(`[LensPreview] Giving up after ${MAX_RETRIES} retries`);
      return;
    }
    retryCount++;
    console.log(`[LensPreview] Retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount}/${MAX_RETRIES})`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      createWebview();
    }, RETRY_DELAY_MS);
  }

  // Use onMount instead of $effect to avoid re-running on reactive state changes.
  // This ensures theme changes, config updates, etc. don't destroy/recreate the webview.
  onMount(async () => {
    if (setupDone) return;
    setupDone = true;

    // Listen for URL change events first (before webview creation)
    unlistenUrl = await listen('lens-url-changed', (event) => {
      if (event.payload?.url) {
        lensStore.setUrl(event.payload.url);
        lensStore.setInputUrl(event.payload.url);
      }
      lensStore.setLoading(false);
    });

    await createWebview();
  });

  onDestroy(() => {
    clearTimeout(retryTimer);
    clearTimeout(loadingTimer);
    if (rafId) cancelAnimationFrame(rafId);
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
    setupDone = false;
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
