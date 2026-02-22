/**
 * lens.svelte.js -- Svelte 5 reactive store for the Lens (embedded browser) view.
 *
 * Manages URL state, loading state, navigation history flags, and webview readiness.
 */

import { lensNavigate, lensGoBack, lensGoForward, lensReload } from '../api.js';

const DEFAULT_URL = 'https://www.google.com';

function createLensStore() {
  let url = $state(DEFAULT_URL);
  let inputUrl = $state(DEFAULT_URL);
  let loading = $state(false);
  let canGoBack = $state(false);
  let canGoForward = $state(false);
  let webviewReady = $state(false);
  let hidden = $state(false);
  let pageTitle = $state('');
  let devServers = $state([]);
  let devServerLoading = $state(false);

  return {
    get url() { return url; },
    get inputUrl() { return inputUrl; },
    get loading() { return loading; },
    get canGoBack() { return canGoBack; },
    get canGoForward() { return canGoForward; },
    get webviewReady() { return webviewReady; },
    get hidden() { return hidden; },
    get pageTitle() { return pageTitle; },
    get devServers() { return devServers; },
    get devServerLoading() { return devServerLoading; },

    /** The first running dev server, or null if none are running */
    get activeDevServer() {
      return devServers.find(s => s.running) || null;
    },

    setUrl(newUrl) { url = newUrl; },
    setInputUrl(newUrl) { inputUrl = newUrl; },
    setLoading(val) { loading = val; },
    setCanGoBack(val) { canGoBack = val; },
    setCanGoForward(val) { canGoForward = val; },
    setWebviewReady(val) { webviewReady = val; },
    setHidden(val) { hidden = val; },
    setPageTitle(title) { pageTitle = title; },
    setDevServers(servers) { devServers = servers; },
    setDevServerLoading(val) { devServerLoading = val; },

    /**
     * Hide the native webview so DOM overlays (dropdowns, modals, palettes)
     * can render without the WebView2 HWND painting over them.
     */
    freeze() {
      hidden = true;
    },

    /** Restore the live native webview after an overlay closes. */
    unfreeze() {
      hidden = false;
    },

    async navigate(rawUrl) {
      let normalized = rawUrl.trim();
      if (!normalized) return;
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = 'https://' + normalized;
      }
      url = normalized;
      inputUrl = normalized;
      loading = true;
      try {
        await lensNavigate(normalized);
      } catch (err) {
        console.error('[lens] Navigation failed:', err);
        loading = false;
      }
    },

    async goBack() {
      loading = true;
      try { await lensGoBack(); } catch (err) {
        console.warn('[lens] Go back failed:', err);
        loading = false;
      }
    },

    async goForward() {
      loading = true;
      try { await lensGoForward(); } catch (err) {
        console.warn('[lens] Go forward failed:', err);
        loading = false;
      }
    },

    async reload() {
      loading = true;
      try { await lensReload(); } catch (err) {
        console.warn('[lens] Reload failed:', err);
        loading = false;
      }
    },

    reset() {
      url = DEFAULT_URL;
      inputUrl = DEFAULT_URL;
      loading = false;
      canGoBack = false;
      canGoForward = false;
      webviewReady = false;
      hidden = false;
      pageTitle = '';
      devServers = [];
      devServerLoading = false;
    },
  };
}

export const lensStore = createLensStore();
export { DEFAULT_URL };
