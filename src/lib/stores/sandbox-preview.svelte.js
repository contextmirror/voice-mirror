/**
 * sandbox-preview.svelte.js -- live preview of an app being built (CDP screencast).
 *
 * Opens a CDP screencast of a Tauri app Voice Mirror launched (by its CDP
 * remote-debugging port) and exposes the local MJPEG stream URL for the
 * SandboxPreview panel to display — the REAL app window at its true size, the
 * same surface the AI sees via the sandbox_* MCP tools. Backed by
 * services/sandbox_stream.rs (Page.startScreencast -> MJPEG).
 */
import { sandboxStreamStart, sandboxStreamStop } from '../api.js';
import { unwrapResult } from '../utils.js';

function createSandboxPreviewStore() {
  let isOpen = $state(false);
  let cdpPort = $state(null);
  let streamUrl = $state('');
  let loading = $state(false);
  let error = $state('');

  return {
    get isOpen() { return isOpen; },
    get cdpPort() { return cdpPort; },
    get streamUrl() { return streamUrl; },
    get loading() { return loading; },
    get error() { return error; },

    /** Open the live preview for the app on `port` (CDP). Idempotent per port. */
    async open(port) {
      if (!port) return;
      if (isOpen && cdpPort === port && streamUrl) return;
      cdpPort = port;
      isOpen = true;
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

    /** Close the live preview and stop the screencast. */
    close() {
      const port = cdpPort;
      isOpen = false;
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
