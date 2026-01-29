/**
 * browser-panel.js - Browser page renderer logic
 * Manages the embedded webview toolbar, URL bar, and idle state.
 */

import { navigateTo } from './navigation.js';

let webview = null;
let urlBar = null;
let idleState = null;
let backBtn = null;
let forwardBtn = null;
let refreshBtn = null;
let popoutBtn = null;

/**
 * Initialize the browser panel.
 * Wires up toolbar buttons and webview event listeners.
 */
export function initBrowserPanel() {
    webview = document.getElementById('browser-webview');
    urlBar = document.getElementById('browser-url');
    idleState = document.getElementById('browser-idle-state');
    backBtn = document.getElementById('browser-back');
    forwardBtn = document.getElementById('browser-forward');
    refreshBtn = document.getElementById('browser-refresh');
    popoutBtn = document.getElementById('browser-popout');

    if (!webview) {
        console.warn('[BrowserPanel] No webview element found');
        return;
    }

    // Toolbar buttons
    backBtn?.addEventListener('click', () => webview.goBack());
    forwardBtn?.addEventListener('click', () => webview.goForward());
    refreshBtn?.addEventListener('click', () => webview.reload());
    popoutBtn?.addEventListener('click', popOutBrowser);

    // Webview navigation events
    webview.addEventListener('did-start-loading', () => {
        refreshBtn?.classList.add('loading');
    });

    webview.addEventListener('did-stop-loading', () => {
        refreshBtn?.classList.remove('loading');
    });

    webview.addEventListener('did-navigate', (e) => {
        updateUrlBar(e.url);
        if (e.url && e.url !== 'about:blank') {
            showWebview(true);
            // Auto-switch to browser page when navigation happens
            navigateTo('browser');
        }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        if (e.isMainFrame) {
            updateUrlBar(e.url);
        }
    });

    webview.addEventListener('page-title-updated', (e) => {
        // Could update a title display if desired
        console.log('[BrowserPanel] Title:', e.title);
    });

    webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3) { // -3 = aborted (normal for navigations)
            console.error('[BrowserPanel] Load failed:', e.errorDescription);
        }
    });

    // Listen for browser status changes from main process
    if (window.voiceMirror?.browser?.onStatusChange) {
        window.voiceMirror.browser.onStatusChange((data) => {
            if (data.url && data.url !== 'about:blank') {
                showWebview(true);
                updateUrlBar(data.url);
                navigateTo('browser');
            } else if (data.stopped) {
                showWebview(false);
            }
        });
    }

    console.log('[BrowserPanel] Initialized');
}

/**
 * Show or hide the webview, toggling the idle state.
 */
function showWebview(visible) {
    if (!webview || !idleState) return;
    webview.style.display = visible ? 'flex' : 'none';
    idleState.style.display = visible ? 'none' : 'flex';
}

/**
 * Update the URL bar text.
 */
function updateUrlBar(url) {
    if (!urlBar) return;
    urlBar.textContent = url || 'about:blank';
    urlBar.title = url || '';
}

/**
 * Pop out the current URL in the user's default browser.
 */
async function popOutBrowser() {
    const url = urlBar?.textContent;
    if (url && url !== 'about:blank') {
        window.voiceMirror.openExternal(url);
    }
}

/**
 * Navigate the browser panel to a URL and switch to the browser page.
 * Called from main process via IPC when a tool triggers navigation.
 */
export function navigateToBrowserPage() {
    navigateTo('browser');
}
