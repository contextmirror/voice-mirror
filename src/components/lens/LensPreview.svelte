<script>
  import { onMount, onDestroy } from 'svelte';
  import { lensStore, DEFAULT_URL } from '../../lib/stores/lens.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';
  import { lensResizeWebview, lensCloseAllTabs, lensClearCache, detectDevServers, designCommand } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';
  import { unwrapResult } from '../../lib/utils.js';

  let containerEl = $state(null);
  let resizeObserver = null;
  let rafId = null;
  let unlistenUrl = null;
  let unlistenOpenTab = null;
  let unlistenTitle = null;
  let unlistenFocusTab = null;
  let setupDone = false;
  const LOADING_TIMEOUT_MS = 15000;
  let loadingTimer = null;
  let detectionTimer = null;
  let creatingFirstTab = false;

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

  export function createNewTab(url = 'about:blank') {
    const bounds = getAbsoluteBounds();
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      browserTabsStore.openTab(url, bounds);
    }
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

  /** Sync lensStore URL/inputUrl when the active browser tab changes (tab switch or close). */
  $effect(() => {
    const active = browserTabsStore.activeTab;
    if (active?.url) {
      lensStore.setUrl(active.url);
      lensStore.setInputUrl(active.url);
    }
  });

  // ---- Project switch → dev server detection + browser navigation ----
  // Plain variables (NOT $state) — used only as guards inside effects.
  // Using $state would re-trigger the effects when written, causing either
  // an infinite loop or cancelled timeouts.
  let lastDetectedProject = null;
  let previousProjectIndex = null;

  // Trigger detection + navigation when active project changes.
  //
  // IMPORTANT: The detection timer is managed OUTSIDE the effect cleanup.
  // Svelte 5 calls the effect cleanup on every re-trigger (including benign
  // ones from file watcher, config updates, etc.). If we used `return () =>
  // clearTimeout(timer)`, the cleanup would cancel the pending detection on
  // re-trigger, and the guard would prevent re-scheduling — so detection
  // would never run. Instead, we manage `detectionTimer` as a component-level
  // variable and only cancel it when a REAL project switch happens.
  $effect(() => {
    const project = projectStore.activeProject;
    const currentIndex = projectStore.activeIndex;
    if (!project) {
      // Reset detection guard so re-adding the same project triggers detection again
      lastDetectedProject = null;
      previousProjectIndex = currentIndex;
      return;
    }

    // Capture values for deferred work (avoid reading reactive state in timeout)
    const oldIndex = previousProjectIndex;
    const oldPath = lastDetectedProject;

    // Set guard SYNCHRONOUSLY so re-triggers see it immediately
    lastDetectedProject = project.path;
    previousProjectIndex = currentIndex;

    // Same project, same index → no change (prevents re-trigger on unrelated store updates)
    if (project.path === oldPath && currentIndex === oldIndex) return;

    // Cancel any previous pending detection (real project switch)
    clearTimeout(detectionTimer);
    detectionTimer = setTimeout(() => {
      detectionTimer = null;

      // Save current URL for the outgoing project (deferred to avoid entries mutation loop)
      if (oldIndex !== null && oldIndex !== currentIndex && lensStore.webviewReady) {
        const currentUrl = lensStore.url;
        if (currentUrl && currentUrl !== DEFAULT_URL) {
          projectStore.updateProjectField(oldIndex, 'lastBrowserUrl', currentUrl);
        }
      }

      devServerManager.handleProjectSwitch(oldPath, project.path);
      detectAndNavigate(project);
    }, 300);
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
      /** @type {any} */
      const data = unwrapResult(result) || {};
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
        // Clear WebView2 disk cache before navigating to prevent stale content
        // from a previously-cached localhost port (e.g. switching from solitaire
        // on :3000 to Next.js on :3000 would show solitaire without this).
        await lensClearCache().catch(() => {});
        lensStore.navigate(targetUrl);
      }

      // Auto-start logic for stopped servers
      const stoppedServer = servers.find(s => !s.running);
      if (stoppedServer) {
        // Skip the offer if the dev server manager already has this server as running/starting
        // (can happen when detection re-fires while a server is mid-start)
        const existingState = devServerManager.getServerStatus(project.path);
        if (existingState && (existingState.status === 'running' || existingState.status === 'starting')) {
          console.log('[lens] Server already running/starting, skipping offer');
        } else {
          const autoStart = project.autoStartServer;
          console.log('[lens] Auto-start check:', { autoStart, framework: stoppedServer.framework, port: stoppedServer.port });
          if (autoStart === null || autoStart === undefined) {
            // Never asked (or "Start once" was used before) — show consent toast
            toastStore.addToast({
              message: `${stoppedServer.framework || 'Dev server'} on :${stoppedServer.port} is not running. Start it?`,
              severity: 'warning',
              key: 'dev-server-consent-' + project.path,
              duration: 0, // Don't auto-dismiss — user must choose
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

  // Enable/disable the design canvas overlay when design mode changes
  $effect(() => {
    const isDesignMode = lensStore.designMode;
    if (!lensStore.webviewReady) return;
    if (isDesignMode) {
      designCommand('enable', {}).catch((err) => {
        console.warn('[LensPreview] Design enable failed:', err);
      });
    } else {
      designCommand('disable', {}).catch((err) => {
        console.warn('[LensPreview] Design disable failed:', err);
      });
    }
  });

  async function createFirstTab() {
    if (!containerEl) return;
    if (lensStore.webviewReady) return; // Already created
    if (creatingFirstTab) return;       // Already in-flight (prevents ResizeObserver + onMount race)
    creatingFirstTab = true;

    // Wait for layout to settle before measuring bounds (double rAF)
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    const bounds = getAbsoluteBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      // Container is CSS-hidden (display:none when file tab is active).
      // Don't waste retries — we'll try again when the container becomes visible
      // via the ResizeObserver set up in onMount.
      console.log('[LensPreview] Container has zero bounds, will create tab when visible');
      creatingFirstTab = false; // Reset so ResizeObserver can retry when container becomes visible
      return;
    }

    console.log('[LensPreview] Creating first browser tab at', bounds);

    try {
      const tabId = await browserTabsStore.openTab(DEFAULT_URL, bounds);
      if (tabId) {
        lensStore.setWebviewReady(true);
        console.log('[LensPreview] First browser tab ready');
      }
    } catch (err) {
      console.error('[LensPreview] Failed to create first tab:', err);
    }
  }

  // Use onMount instead of $effect to avoid re-running on reactive state changes.
  // This ensures theme changes, config updates, etc. don't destroy/recreate the webview.
  onMount(async () => {
    if (setupDone) return;
    setupDone = true;

    // Listen for URL change events — route by tabId to browser tabs store
    unlistenUrl = await listen('lens-url-changed', (event) => {
      const tabId = event.payload?.tabId;
      const url = event.payload?.url;

      if (tabId && url) {
        browserTabsStore.setTabUrl(tabId, url);
        browserTabsStore.setTabLoading(tabId, false);
      }

      // Sync active tab URL to lensStore for backward compat
      if ((!tabId || tabId === browserTabsStore.activeTabId) && url) {
        lensStore.setUrl(url);
        lensStore.setInputUrl(url);
      }
      lensStore.setLoading(false);
    });

    // Listen for MCP browser_open requests to create new tabs
    unlistenOpenTab = await listen('lens-open-tab', (event) => {
      const url = event.payload?.url;
      if (url) {
        const bounds = getAbsoluteBounds();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          browserTabsStore.openTab(url, bounds);
        }
      }
    });

    // Listen for page title changes from child WebView2 instances
    unlistenTitle = await listen('lens-title-changed', (event) => {
      const tabId = event.payload?.tabId;
      const title = event.payload?.title;
      if (tabId && title) {
        browserTabsStore.setTabTitle(tabId, title);
      }
    });

    // Listen for MCP-initiated tab switches (browser_action tab_switch)
    unlistenFocusTab = await listen('lens-focus-tab', (event) => {
      const tabId = event.payload?.tabId;
      if (tabId) {
        // Update frontend tab bar to reflect the active tab
        browserTabsStore.setActiveTabDirect(tabId);
      }
    });

    // Observe container resize — this serves two purposes:
    // 1. Sync webview bounds when the panel is resized
    // 2. Trigger first tab creation when the container becomes visible
    //    (it starts with display:none if a file tab is active on load)
    if (containerEl) {
      const observer = new ResizeObserver(() => {
        if (!lensStore.webviewReady) {
          // Container just became visible — create the first tab
          createFirstTab();
        } else {
          // Normal resize — sync bounds
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => { rafId = null; syncBounds(); });
        }
      });
      observer.observe(containerEl);
      resizeObserver = observer;
    }

    await createFirstTab();
  });

  onDestroy(() => {
    clearTimeout(loadingTimer);
    clearTimeout(detectionTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (unlistenUrl) {
      unlistenUrl();
      unlistenUrl = null;
    }
    if (unlistenOpenTab) {
      unlistenOpenTab();
      unlistenOpenTab = null;
    }
    if (unlistenTitle) {
      unlistenTitle();
      unlistenTitle = null;
    }
    if (unlistenFocusTab) {
      unlistenFocusTab();
      unlistenFocusTab = null;
    }
    lensCloseAllTabs().catch(() => {});
    browserTabsStore.clearAll();
    lensStore.setWebviewReady(false);
    setupDone = false;
    creatingFirstTab = false;
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
