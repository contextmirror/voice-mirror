/**
 * overlay.js -- Svelte 5 reactive store for overlay/orb mode.
 *
 * Manages compact overlay mode (orb-only) vs expanded app mode,
 * and tracks the current orb visual state based on voice/AI events.
 */

import { listen } from '@tauri-apps/api/event';
import { setAlwaysOnTop, setWindowSize, setResizable } from '../api.js';
import { updateConfig, configStore } from '../stores/config.svelte.js';

/** Valid orb states */
const VALID_ORB_STATES = ['idle', 'listening', 'speaking', 'thinking', 'dictating', 'error'];

/** Window dimensions for each mode */
const OVERLAY_SIZE = { width: 120, height: 120 };
const EXPANDED_SIZE = { width: 420, height: 700 };

/**
 * Reactive overlay store.
 *
 * - isOverlayMode: whether the app is in compact orb-only mode
 * - orbState: current visual state of the orb
 * - toggleOverlay(): switch between compact and expanded modes
 */
function createOverlayStore() {
  let isOverlayMode = $state(false);
  let orbState = $state('idle');
  let audioLevels = $state(null); // Float32 array of audio bar amplitudes (0-1)
  let eventUnlisteners = [];
  let dictatingMode = false; // Set by App.svelte when dictation starts

  return {
    get isOverlayMode() { return isOverlayMode; },
    get orbState() { return orbState; },
    get audioLevels() { return audioLevels; },

    /**
     * Tell the overlay whether we're in dictation mode.
     * When true, recording state shows 'dictating' instead of 'listening'.
     * Called from App.svelte which has access to both voice and overlay stores.
     */
    setDictatingMode(mode) {
      dictatingMode = mode;
    },

    /**
     * Set the orb visual state.
     * @param {'idle'|'listening'|'speaking'|'thinking'|'dictating'|'error'} state
     */
    setOrbState(state) {
      if (!VALID_ORB_STATES.includes(state)) {
        console.warn(`[overlay] Invalid orb state: ${state}`);
        return;
      }
      orbState = state;
    },

    /**
     * Toggle between compact overlay mode and expanded app mode.
     * Resizes window and sets always-on-top accordingly.
     */
    async toggleOverlay() {
      const entering = !isOverlayMode;
      isOverlayMode = entering;

      try {
        if (entering) {
          // Make body/html transparent so only the orb is visible
          document.body.classList.add('overlay-mode');
          document.documentElement.style.background = 'transparent';
          document.body.style.background = 'transparent';

          // Switch to compact overlay: small window, always on top, not resizable
          await setAlwaysOnTop(true);
          await setResizable(false);
          await setWindowSize(OVERLAY_SIZE.width, OVERLAY_SIZE.height);
        } else {
          // Restore opaque background for expanded app mode
          document.body.classList.remove('overlay-mode');
          document.documentElement.style.background = '';
          document.body.style.background = '';

          // Switch to expanded app: full window, normal z-order, resizable
          const cfg = configStore.value;
          const expandedWidth = cfg?.appearance?.panelWidth || EXPANDED_SIZE.width;
          const expandedHeight = cfg?.appearance?.panelHeight || EXPANDED_SIZE.height;
          await setWindowSize(expandedWidth, expandedHeight);
          await setResizable(true);
          await setAlwaysOnTop(false);
        }
        // Persist mode to config (expanded=true means full app)
        updateConfig({ window: { expanded: !entering } }).catch((err) => {
          console.error('[overlay] Failed to persist overlay mode:', err);
        });
      } catch (err) {
        console.error('[overlay] Failed to toggle overlay mode:', err);
        // Revert state on failure
        isOverlayMode = !entering;
        // Revert body transparency class
        if (entering) {
          document.body.classList.remove('overlay-mode');
          document.documentElement.style.background = '';
          document.body.style.background = '';
        } else {
          document.body.classList.add('overlay-mode');
          document.documentElement.style.background = 'transparent';
          document.body.style.background = 'transparent';
        }
      }
    },

    /**
     * Enter expanded mode (from overlay). Does nothing if already expanded.
     */
    async expand() {
      if (!isOverlayMode) return;
      await this.toggleOverlay();
    },

    /**
     * Enter compact overlay mode. Does nothing if already in overlay mode.
     */
    async compact() {
      if (isOverlayMode) return;
      await this.toggleOverlay();
    },

    /**
     * Subscribe to Tauri events from the voice and AI backends
     * to automatically update orbState.
     */
    async initEventListeners() {
      // Clean up any previous listeners
      this.destroyEventListeners();

      try {
        // Voice pipeline events → orb state
        const unlistenVoice = await listen('voice-event', (event) => {
          const payload = event.payload;
          if (!payload) return;
          const eventType = payload.event;
          const data = payload.data || {};

          switch (eventType) {
            case 'state_change':
              switch (data.state) {
                case 'listening':
                  orbState = 'idle'; // Passive listening (wake word) = idle visual
                  break;
                case 'recording':
                  // Dictation shows waveform; normal recording shows human icon
                  orbState = dictatingMode ? 'dictating' : 'listening';
                  break;
                case 'speaking':
                  orbState = 'speaking';
                  break;
                case 'processing':
                  orbState = 'thinking';
                  break;
                case 'idle':
                  dictatingMode = false;
                  audioLevels = null;
                  orbState = 'idle';
                  break;
              }
              break;
            case 'audio_level':
              if (data.levels) {
                audioLevels = data.levels;
              }
              break;
            case 'error':
              orbState = 'error';
              setTimeout(() => {
                if (orbState === 'error') orbState = 'idle';
              }, 3000);
              break;
          }
        });
        eventUnlisteners.push(unlistenVoice);

        // AI events: thinking/speaking/error
        const unlistenAiThinking = await listen('ai-stream-token', () => {
          if (orbState !== 'speaking') {
            orbState = 'thinking';
          }
        });
        eventUnlisteners.push(unlistenAiThinking);

        const unlistenAiResponse = await listen('ai-response', () => {
          orbState = 'speaking';
        });
        eventUnlisteners.push(unlistenAiResponse);

        const unlistenAiStreamEnd = await listen('ai-stream-end', () => {
          orbState = 'idle';
        });
        eventUnlisteners.push(unlistenAiStreamEnd);

        const unlistenAiError = await listen('ai-error', () => {
          orbState = 'error';
          // Auto-recover from error state after 3 seconds
          setTimeout(() => {
            if (orbState === 'error') {
              orbState = 'idle';
            }
          }, 3000);
        });
        eventUnlisteners.push(unlistenAiError);
      } catch (err) {
        console.error('[overlay] Failed to set up event listeners:', err);
      }
    },

    /**
     * Remove all event listeners.
     */
    destroyEventListeners() {
      for (const unlisten of eventUnlisteners) {
        unlisten();
      }
      eventUnlisteners = [];
    },
  };
}

export const overlayStore = createOverlayStore();
export { VALID_ORB_STATES, OVERLAY_SIZE, EXPANDED_SIZE };
