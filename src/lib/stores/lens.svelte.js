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

  return {
    get url() { return url; },
    get inputUrl() { return inputUrl; },
    get loading() { return loading; },
    get canGoBack() { return canGoBack; },
    get canGoForward() { return canGoForward; },
    get webviewReady() { return webviewReady; },
    get hidden() { return hidden; },
    get pageTitle() { return pageTitle; },

    setUrl(newUrl) { url = newUrl; },
    setInputUrl(newUrl) { inputUrl = newUrl; },
    setLoading(val) { loading = val; },
    setCanGoBack(val) { canGoBack = val; },
    setCanGoForward(val) { canGoForward = val; },
    setWebviewReady(val) { webviewReady = val; },
    setHidden(val) { hidden = val; },
    setPageTitle(title) { pageTitle = title; },

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
      }
    },

    async goBack() {
      try { await lensGoBack(); } catch (err) {
        console.warn('[lens] Go back failed:', err);
      }
    },

    async goForward() {
      try { await lensGoForward(); } catch (err) {
        console.warn('[lens] Go forward failed:', err);
      }
    },

    async reload() {
      loading = true;
      try { await lensReload(); } catch (err) {
        console.warn('[lens] Reload failed:', err);
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
    },
  };
}

export const lensStore = createLensStore();
export { DEFAULT_URL };
