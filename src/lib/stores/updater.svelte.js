/**
 * updater.svelte.js -- Auto-update state machine (Svelte 5 runes).
 *
 * Models the full in-app update experience on top of the Tauri updater plugin
 * (@tauri-apps/plugin-updater) + process plugin (@tauri-apps/plugin-process).
 * This store owns the MECHANISM-AGNOSTIC state machine; every UI surface
 * (status bar, settings, badge, toast, release-notes modal) is a pure function
 * of this single store — modelled on VS Code's update UX.
 *
 * State machine (one of):
 *   idle        — no update known / up to date
 *   checking    — a check is in flight
 *   available   — an update exists, not yet downloaded
 *   downloading — download in progress (downloadedBytes / totalBytes)
 *   downloaded  — bytes on disk (alias for "ready" on platforms that stage)
 *   ready       — downloaded + installed, restart to apply (Windows force-exits
 *                 on install, so we treat "ready" as "downloaded, restart to apply")
 *   error       — last operation failed (only surfaced on explicit checks)
 *   disabled    — not running inside a packaged Tauri app (dev/browser/test)
 *
 * Payload fields: version, notes, date, downloadedBytes, totalBytes, error, explicit.
 */

// ── localStorage keys ──
// Don't-nag throttle: suppress the *toast* (not the badge/status-bar) for
// NAG_INTERVAL_MS after first learning of a version; reset when version changes.
const LS_LAST_NOTIFIED_VERSION = 'vm-update-last-notified-version';
const LS_NOTIFIED_AT = 'vm-update-notified-at';
// Release channel: 'stable' | 'beta'. Stable endpoint is wired on the Rust side;
// 'beta' maps to a `latest-beta.json` endpoint (documented hook — the Rust
// updater config selects the endpoint based on this value once wired).
const LS_CHANNEL = 'vm-update-channel';

/** Don't-nag window: 5 days. */
const NAG_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;

/** Auto-check cadence: first check 30s after startup, then every 6 hours. */
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Are we running inside a packaged Tauri app? Calling the updater outside one
 * throws, so every call is gated behind this. (dev/browser/test → false.)
 */
function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Safe localStorage read. */
function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Safe localStorage write. */
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

function createUpdaterStore() {
  // ── Core state machine ──
  let state = $state('idle');

  // ── Payload ──
  let version = $state(null);
  let notes = $state(null);
  let date = $state(null);
  let downloadedBytes = $state(0);
  let totalBytes = $state(0);
  let error = $state(null);
  /** Whether the in-flight op was user-initiated (controls error surfacing). */
  let explicit = $state(false);

  // ── Channel ──
  let channel = $state(lsGet(LS_CHANNEL) === 'beta' ? 'beta' : 'stable');

  // ── Internals ──
  /** The live Tauri `Update` handle from check(); used by downloadAndInstall(). */
  let updateHandle = null;
  let autoCheckTimer = null;
  let autoCheckStarted = false;

  /** Download progress 0-100, or null when not downloading. */
  const progress = () => (totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0);

  // ── Don't-nag throttle ──
  /**
   * Should we show the (sticky "restart to apply") toast for this version?
   * - New version (!== last notified) → yes, and record it.
   * - Same version within the nag window → no.
   * - Same version after the nag window → yes, and re-record.
   */
  function shouldNotify(forVersion) {
    if (!forVersion) return false;
    const last = lsGet(LS_LAST_NOTIFIED_VERSION);
    const at = parseInt(lsGet(LS_NOTIFIED_AT) || '0', 10);
    if (last !== forVersion) return true; // new version — always notify
    if (!at || Number.isNaN(at)) return true;
    return Date.now() - at > NAG_INTERVAL_MS;
  }

  /** Record that we've notified the user about a version (resets the nag timer). */
  function recordNotified(forVersion) {
    lsSet(LS_LAST_NOTIFIED_VERSION, forVersion || '');
    lsSet(LS_NOTIFIED_AT, String(Date.now()));
  }

  // ── Actions ──

  /**
   * Check for updates.
   * @param {boolean} [explicitCheck=false] - true when user-initiated (errors
   *   are surfaced); background checks swallow errors silently (VS Code style).
   */
  async function checkForUpdates(explicitCheck = false) {
    if (!isTauri()) {
      state = 'disabled';
      return;
    }
    // Don't clobber an in-progress download/ready state with a background check.
    if (state === 'downloading' || state === 'ready' || state === 'downloaded') return;

    explicit = explicitCheck;
    error = null;
    state = 'checking';
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        updateHandle = update;
        version = update.version || null;
        notes = update.body || null;
        date = update.date || null;
        state = 'available';
      } else {
        updateHandle = null;
        version = null;
        notes = null;
        state = 'idle';
      }
    } catch (err) {
      error = err?.message || String(err);
      // Only surface errors on explicit checks; background failures go silent.
      if (explicitCheck) {
        state = 'error';
      } else {
        state = 'idle';
      }
    }
  }

  /**
   * Download and install the available update, mapping plugin progress events:
   *   Started  → totalBytes = e.data.contentLength
   *   Progress → downloadedBytes += e.data.chunkLength
   *   Finished → ready
   * State: downloading → ready.
   */
  async function downloadAndInstall() {
    if (!isTauri()) {
      state = 'disabled';
      return;
    }
    if (!updateHandle) {
      // No handle (e.g. after a reload) — re-check first, then bail; the user
      // can click again once it's available.
      await checkForUpdates(true);
      if (!updateHandle) return;
    }

    error = null;
    downloadedBytes = 0;
    totalBytes = 0;
    state = 'downloading';
    try {
      await updateHandle.downloadAndInstall((e) => {
        switch (e.event) {
          case 'Started':
            totalBytes = e.data?.contentLength || 0;
            downloadedBytes = 0;
            break;
          case 'Progress':
            downloadedBytes += e.data?.chunkLength || 0;
            break;
          case 'Finished':
            state = 'ready';
            break;
          default:
            break;
        }
      });
      // Windows force-exits on install; if we reach here, treat as ready
      // ("downloaded, restart to apply").
      state = 'ready';
    } catch (err) {
      error = err?.message || String(err);
      state = 'error';
    }
  }

  /** Relaunch the app to apply a downloaded/ready update. */
  async function restartToApply() {
    if (!isTauri()) return;
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      error = err?.message || String(err);
      state = 'error';
    }
  }

  /** Open the release-notes modal for the current update. */
  function showReleaseNotes() {
    try {
      window.dispatchEvent(new CustomEvent('show-update-notes', { detail: { version, notes } }));
    } catch {
      /* no window — ignore */
    }
  }

  /**
   * Set the release channel ('stable' | 'beta'), persisted to localStorage.
   * 'beta' maps to a `latest-beta.json` endpoint (Rust side selects the endpoint
   * from this value). Re-checks immediately so the new channel takes effect.
   */
  function setChannel(next) {
    const c = next === 'beta' ? 'beta' : 'stable';
    channel = c;
    lsSet(LS_CHANNEL, c);
    // Channel changed — a previously-known update may no longer apply.
    if (state === 'available' || state === 'error') {
      state = 'idle';
      updateHandle = null;
      version = null;
      notes = null;
    }
  }

  /**
   * Start background auto-checking: first check 30s after startup, then every
   * 6 hours. No-op outside Tauri and idempotent (safe to call once at startup).
   */
  function startAutoCheck() {
    if (!isTauri()) {
      state = 'disabled';
      return;
    }
    if (autoCheckStarted) return;
    autoCheckStarted = true;
    setTimeout(() => {
      checkForUpdates(false);
      autoCheckTimer = setInterval(() => checkForUpdates(false), RECHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);
  }

  /** Stop background auto-checking (used in teardown/tests). */
  function stopAutoCheck() {
    if (autoCheckTimer) {
      clearInterval(autoCheckTimer);
      autoCheckTimer = null;
    }
    autoCheckStarted = false;
  }

  /** Dismiss an error back to idle (e.g. user closes an error toast). */
  function clearError() {
    if (state === 'error') {
      state = 'idle';
      error = null;
    }
  }

  return {
    get state() { return state; },
    get version() { return version; },
    get notes() { return notes; },
    get date() { return date; },
    get downloadedBytes() { return downloadedBytes; },
    get totalBytes() { return totalBytes; },
    get progress() { return progress(); },
    get error() { return error; },
    get explicit() { return explicit; },
    get channel() { return channel; },
    // Derived UI helpers — every surface is a pure function of `state`.
    get hasUpdate() { return state === 'available' || state === 'downloaded' || state === 'ready'; },
    get isReady() { return state === 'ready' || state === 'downloaded'; },
    get isBusy() { return state === 'checking' || state === 'downloading'; },
    checkForUpdates,
    downloadAndInstall,
    restartToApply,
    showReleaseNotes,
    setChannel,
    startAutoCheck,
    stopAutoCheck,
    clearError,
    // Don't-nag throttle (used by the sticky toast gate).
    shouldNotify,
    recordNotified,
  };
}

export const updaterStore = createUpdaterStore();
