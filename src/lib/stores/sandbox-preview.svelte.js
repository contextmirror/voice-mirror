/**
 * sandbox-preview.svelte.js -- live preview of an app being built (CDP screencast).
 *
 * Opens a CDP screencast of a Tauri app Voice Mirror launched (by its CDP
 * remote-debugging port) and exposes the local MJPEG stream URL for the
 * SandboxPreview panel to display — the REAL app window at its true size, the
 * same surface the AI sees via the sandbox_* MCP tools. Backed by
 * services/sandbox_stream.rs (Page.startScreencast -> MJPEG).
 *
 * Two pieces of state, deliberately separate:
 *  - `active`  : a screencast session is running (a Tauri app with CDP is up).
 *  - `visible` : the preview panel is currently shown. Hiding keeps the session
 *                alive so toggling back to it (vs the Browser) is instant.
 */
import { sandboxStreamStart, sandboxStreamStop } from '../api.js';
import { unwrapResult } from '../utils.js';

function createSandboxPreviewStore() {
  let active = $state(false);
  let visible = $state(false);
  let cdpPort = $state(null);
  let streamUrl = $state('');
  let loading = $state(false);
  let error = $state('');

  return {
    get active() { return active; },
    get visible() { return visible; },
    get cdpPort() { return cdpPort; },
    get streamUrl() { return streamUrl; },
    get loading() { return loading; },
    get error() { return error; },

    /**
     * Begin a live preview for the app on `port` (CDP) and show it.
     * Idempotent per port.
     */
    async open(port) {
      if (!port) return;
      if (active && cdpPort === port) {
        visible = true;
        return;
      }
      cdpPort = port;
      active = true;
      visible = true;
      loading = true;
      error = '';
      try {
        const res = await sandboxStreamStart(port);
        const data = unwrapResult(res);
        if (data?.url) {
          streamUrl = data.url;
        } else {
          error = 'Failed to start the live preview screencast.';
        }
      } catch (err) {
        error = err?.message || String(err);
      } finally {
        loading = false;
      }
    },

    /** Show the panel (session must already be active). */
    show() {
      if (active) visible = true;
    },

    /** Hide the panel but keep the screencast running (instant to re-show). */
    hide() {
      visible = false;
    },

    /** Fully tear down: hide and stop the screencast (app stopped/closed). */
    close() {
      const port = cdpPort;
      active = false;
      visible = false;
      streamUrl = '';
      loading = false;
      error = '';
      cdpPort = null;
      if (port) {
        sandboxStreamStop(port).catch(() => {});
      }
    },
  };
}

export const sandboxPreviewStore = createSandboxPreviewStore();
