/**
 * sandbox-preview.svelte.js -- live preview of an app being built (multi-window).
 *
 * Mirrors a Tauri app Voice Mirror launched (by its CDP remote-debugging port).
 * The actual capture is WGC window capture (services/sandbox_stream.rs) — the
 * REAL app window at true size, the same surface the AI sees via sandbox_*.
 *
 * Multi-window: a Tauri app has several windows (the pill, a settings window, a
 * dialog…). This store tracks them all (`windows`) and FOLLOWS THE WINDOW CLAUDE
 * IS DRIVING: every snapshot publishes the OS window it acted on
 * (`sandbox_active_hwnd`), and the preview mirrors exactly that — so the human
 * watches precisely what Claude is doing, by construction, not by guessing. You
 * can still override manually via the switcher (`switchTo`).
 *
 * State split: `active` (a session is running) vs `visible` (the panel is shown).
 * Hiding keeps the session alive so toggling vs the Browser is instant.
 */
import {
  sandboxStreamStart,
  sandboxStreamStop,
  sandboxListWindows,
  sandboxActiveHwnd,
} from '../api.js';
import { unwrapResult } from '../utils.js';

const POLL_INTERVAL = 1000;

function createSandboxPreviewStore() {
  let active = $state(false);
  let visible = $state(false);
  let cdpPort = $state(null);
  let streamUrl = $state('');
  let loading = $state(false);
  let error = $state('');
  /** @type {Array<{hwnd:number,title:string}>} */
  let windows = $state([]);
  let currentHwnd = $state(null);

  // Non-reactive bookkeeping for polling.
  let pollTimer = null;
  // When the user manually picks a window from the switcher, stop auto-following
  // Claude until they go back to a session/window or reopen the preview.
  let userPinned = false;
  // Consecutive polls the mirrored window has been gone (debounce for snap-back).
  let goneCount = 0;
  // The last dev-server CDP port we auto-opened for. Lives in the store (not a
  // component) so a LensWorkspace remount / status-flap can't re-fire open() and
  // pop the panel back up after the user hid it. Persists for the app lifetime.
  let lastAutoPort = null;
  // The user explicitly hid the panel (toggle/X) — don't let auto-open re-show it
  // for the same port until they reopen it or a different app launches.
  let userHidden = false;
  // True when this session was opened by sandbox_attach (an external app the agent
  // launched), not by a Voice Mirror dev server — so the auto-sync must NOT close
  // it when no dev-server CDP port is active.
  let attached = false;

  function setStreamUrl(url) {
    // Cache-bust so the <img> reconnects when we re-target the stream to a
    // different window (the MJPEG endpoint still matches "/stream").
    streamUrl = url ? `${url}?t=${Date.now()}` : '';
  }

  /** Start (or re-target) the WGC mirror. `hwnd` null = the app's main window. */
  async function startStream(hwnd) {
    loading = true;
    error = '';
    try {
      const res = await sandboxStreamStart(cdpPort, hwnd ?? null);
      const data = unwrapResult(res);
      if (data?.url) {
        setStreamUrl(data.url);
        if (data.hwnd != null) currentHwnd = data.hwnd;
      } else {
        error = 'Failed to start the live preview.';
      }
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  /**
   * Follow the window CLAUDE is driving. Every sandbox_snapshot publishes the OS
   * window it acted on (`sandbox_active_hwnd`); we mirror exactly that. This is
   * the unified model that replaced the fragile auto-follow/snap-back: the
   * preview and Claude reference the SAME window, so they can't diverge. We also
   * refresh the window list for the switcher.
   */
  async function refreshWindows() {
    if (!active || cdpPort == null) return;
    try {
      const res = await sandboxListWindows(cdpPort);
      const list = unwrapResult(res);
      windows = Array.isArray(list) ? list : [];

      // Don't fight a manual switcher choice — only auto-follow Claude when not
      // explicitly pinned by the user.
      if (userPinned) return;

      const activeRes = await sandboxActiveHwnd(cdpPort);
      const activeHwnd = unwrapResult(activeRes)?.hwnd ?? null;
      const present = new Set(windows.map((w) => w.hwnd));
      // Mirror Claude's window once it's a real, currently-open window.
      if (activeHwnd != null && activeHwnd !== currentHwnd && present.has(activeHwnd)) {
        startStream(activeHwnd);
        goneCount = 0;
        return;
      }
      // Snap back to the main window when the one we're mirroring has CLOSED
      // (e.g. you closed Settings). Debounced so a single transient miss in the
      // OS window enumeration can't thrash the stream.
      if (currentHwnd != null && !present.has(currentHwnd) && windows.length > 0) {
        if (++goneCount >= 2) {
          goneCount = 0;
          startStream(null);
        }
      } else {
        goneCount = 0;
      }
    } catch {
      // transient — try again next tick
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshWindows, POLL_INTERVAL);
    refreshWindows();
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    get active() { return active; },
    get visible() { return visible; },
    get cdpPort() { return cdpPort; },
    get streamUrl() { return streamUrl; },
    get loading() { return loading; },
    get error() { return error; },
    get windows() { return windows; },
    get currentHwnd() { return currentHwnd; },

    /**
     * Begin a live preview for the app on `port` (CDP) and show it. Idempotent:
     * re-opening the same active port just re-shows the panel (no stream churn).
     * @param {number} port
     * @param {{ attached?: boolean }} [opts] - `attached` marks an external app
     *   (from sandbox_attach) so the dev-server auto-sync won't tear it down.
     */
    async open(port, opts = {}) {
      if (!port) return;
      userHidden = false; // an explicit open clears any prior user-hide
      if (active && cdpPort === port) {
        attached = opts.attached ?? attached;
        visible = true;
        return;
      }
      cdpPort = port;
      active = true;
      visible = true;
      attached = opts.attached ?? false;
      userPinned = false;
      goneCount = 0;
      currentHwnd = null;
      windows = [];
      await startStream(null); // main window
      startPolling();
    },

    /**
     * Reconcile the auto-open state with the active dev-server CDP port (called
     * reactively from LensWorkspace). Opens once per new port, respects an
     * explicit user-hide, and tears down only its OWN auto session (never an
     * attached external app). The guard lives here so a component remount can't
     * re-trigger it.
     * @param {number|null} port - active dev-server CDP port, or null if none.
     */
    syncAuto(port) {
      if (port) {
        if (port === lastAutoPort) return; // already reacted to this port
        lastAutoPort = port;
        if (userHidden && port === cdpPort) return; // user hid this one — leave it
        this.open(port);
      } else {
        lastAutoPort = null;
        // Only close an auto (dev-server) session; an attached external app stays.
        if (active && !attached) this.close();
      }
    },

    /** Show the panel (session must already be active). */
    show() {
      if (active) {
        userHidden = false;
        visible = true;
      }
    },

    /** Hide the panel but keep the screencast running (instant to re-show). */
    hide() {
      userHidden = true;
      visible = false;
    },

    /**
     * Switch the mirror to a specific window (from the switcher dropdown). Pins
     * the choice so we stop auto-following Claude until the preview is reopened.
     */
    switchTo(hwnd) {
      if (hwnd == null) return;
      userPinned = true;
      startStream(Number(hwnd));
    },

    /** Fully tear down: hide and stop the screencast (app stopped/closed). */
    close() {
      const port = cdpPort;
      stopPolling();
      active = false;
      visible = false;
      streamUrl = '';
      loading = false;
      error = '';
      cdpPort = null;
      windows = [];
      currentHwnd = null;
      userPinned = false;
      goneCount = 0;
      attached = false;
      userHidden = false;
      if (port) {
        sandboxStreamStop(port).catch(() => {});
      }
    },
  };
}

export const sandboxPreviewStore = createSandboxPreviewStore();
