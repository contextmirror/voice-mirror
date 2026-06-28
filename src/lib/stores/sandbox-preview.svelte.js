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
import { emit } from '@tauri-apps/api/event';
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
  // Layout mode: maximized fills the center content area (the same region the
  // Browser overlay occupies); restored docks it in the narrow side column.
  // Default to maximized so a freshly-opened preview is big, not crammed.
  let maximized = $state(true);
  let cdpPort = $state(null);
  let streamUrl = $state('');
  let loading = $state(false);
  let error = $state('');
  /** @type {Array<{hwnd:number,title:string,visible?:boolean}>} */
  let windows = $state([]);
  let currentHwnd = $state(null);
  // True when the followed app window closed and NO other VISIBLE window remains
  // to mirror — drives a clear "App window closed" empty state instead of an
  // infinite "Waiting…" spinner. Cleared whenever a real window is shown again.
  let noWindow = $state(false);

  // Non-reactive bookkeeping for polling.
  let pollTimer = null;
  // When the user manually picks a window from the switcher, stop auto-following
  // Claude until they go back to a session/window or reopen the preview.
  let userPinned = false;
  // Consecutive failures to list windows = the CDP debug port is unreachable
  // (the app / its dev server stopped). A few in a row → surface "disconnected".
  let listFailCount = 0;
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
        // We're mirroring a window again — leave the "no window" empty state.
        noWindow = false;
        listFailCount = 0;
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

    // Fetch the live window list. A THROW or non-array result means the CDP debug
    // port is unreachable — i.e. the app (or its dev server) on that port has
    // STOPPED (e.g. you closed TaskDeck, then opened a different app).
    let list = null;
    try {
      const res = await sandboxListWindows(cdpPort);
      const data = unwrapResult(res);
      if (Array.isArray(data)) list = data;
    } catch {
      list = null;
    }

    if (list == null) {
      // After a few consecutive misses (ignore a one-off blip), drop the STALE
      // frame and surface the disconnected state — never keep lying with the last
      // app's picture. The "Open app" button relaunches the current project.
      listFailCount += 1;
      if (listFailCount >= 3 && !noWindow) {
        noWindow = true;
        currentHwnd = null;
        streamUrl = ''; // clears the stale frame → component resets hasFrame
      }
      return;
    }
    listFailCount = 0;
    windows = list;

    // Don't fight a manual switcher choice — only auto-follow Claude when not
    // explicitly pinned by the user.
    if (userPinned) return;

    try {
      const activeRes = await sandboxActiveHwnd(cdpPort);
      const activeHwnd = unwrapResult(activeRes)?.hwnd ?? null;
      const present = new Set(windows.map((w) => w.hwnd));
      // Mirror Claude's window once it's a real, currently-open window.
      if (activeHwnd != null && activeHwnd !== currentHwnd && present.has(activeHwnd)) {
        startStream(activeHwnd);
        return;
      }
      // The window we're mirroring has CLOSED (e.g. you closed Settings).
      // `windows` is the authoritative LIVE window list for the app's process —
      // if currentHwnd isn't in it, the window is genuinely gone. Re-target to
      // another VISIBLE window rather than freezing on its last (stale) frame or
      // hanging on a non-presentable one (a multi-window pill app can be left
      // with only a hidden pill + transparent overlay, neither mirrorable).
      if (currentHwnd != null && !present.has(currentHwnd)) {
        const visible = windows.filter((w) => w.visible && w.hwnd !== currentHwnd);
        if (visible.length > 0) {
          // Prefer a real, presentable window — pick the first one.
          startStream(visible[0].hwnd);
        } else {
          // Nothing presentable to mirror — show a clear empty state instead of
          // spinning forever. (Cleared the moment any window is shown again.)
          noWindow = true;
        }
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
    get maximized() { return maximized; },
    get cdpPort() { return cdpPort; },
    get streamUrl() { return streamUrl; },
    get loading() { return loading; },
    get error() { return error; },
    get windows() { return windows; },
    get currentHwnd() { return currentHwnd; },
    get noWindow() { return noWindow; },

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
      // A newly launched app opens maximized (fills the preview area) so it's not
      // shrunk into the narrow side strip. User can restore it to the side column.
      maximized = true;
      attached = opts.attached ?? false;
      userPinned = false;
      currentHwnd = null;
      windows = [];
      noWindow = false;
      listFailCount = 0;
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
        noWindow = false;
        listFailCount = 0;
      }
    },

    /**
     * (Re)launch the current project's app so a closed/missing app window comes
     * back. Reuses the existing dev-server launch flow: LensWorkspace listens for
     * `sandbox-start-request` and runs detectDevServers → devServerManager.start.
     * Frontend-emitted events ARE caught by that `listen`, so this is all it needs.
     */
    async openApp() {
      await emit('sandbox-start-request', {});
    },

    /** Hide the panel but keep the screencast running (instant to re-show). */
    hide() {
      userHidden = true;
      visible = false;
    },

    /**
     * Toggle between maximized (center overlay, fills the preview area) and
     * restored (narrow side column). Read by LensWorkspace to pick the layout.
     */
    toggleMaximize() {
      maximized = !maximized;
    },

    /** Explicitly set the layout mode (true = maximized center overlay). */
    setMaximized(value) {
      maximized = !!value;
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
      noWindow = false;
      listFailCount = 0;
      userPinned = false;
      attached = false;
      userHidden = false;
      if (port) {
        sandboxStreamStop(port).catch(() => {});
      }
    },
  };
}

export const sandboxPreviewStore = createSandboxPreviewStore();
