/**
 * voice.svelte.js -- Reactive voice pipeline state store.
 *
 * Listens to `voice-event` Tauri events from the Rust voice pipeline
 * and exposes reactive state for the Sidebar, ChatInput, Overlay, etc.
 */
import { listen } from '@tauri-apps/api/event';
import { startVoice, stopVoice, getVoiceStatus, speakText, setVoiceMode, aiPtyInput, writeUserMessage, injectText } from '../api.js';
import { configStore } from './config.svelte.js';
import { chatStore } from './chat.svelte.js';
import { aiStatusStore } from './ai-status.svelte.js';
import { attachmentsStore } from './attachments.svelte.js';
import { unwrapResult } from '../utils.js';

/** Dedup window (ms) — ignore duplicate transcription text within this period. */
const TRANSCRIPTION_DEDUP_MS = 3000;

/**
 * Apply user dictionary corrections to a transcription.
 *
 * Each entry replaces `from` with `to`, case-insensitively, on word
 * boundaries where applicable. This is a model-agnostic post-processing
 * fix for proper nouns / jargon the STT model mishears (e.g.
 * "Power to Keep" -> "Parakeet") — it runs on the transcript text, so it
 * behaves identically on any Whisper size or STT engine.
 *
 * @param {string} text - raw transcription from the STT engine
 * @param {Array<{from:string,to:string}>} [dictionary]
 * @returns {string} corrected text
 */
export function applyDictionary(text, dictionary) {
  if (!text || !Array.isArray(dictionary) || dictionary.length === 0) return text;
  let out = text;
  for (const entry of dictionary) {
    const from = entry?.from?.trim();
    if (!from) continue;
    const to = entry?.to ?? '';
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchor on word boundaries only where the phrase edges are word
    // characters, so phrases like "5070 Ti" still match cleanly.
    const left = /^\w/.test(from) ? '\\b' : '';
    const right = /\w$/.test(from) ? '\\b' : '';
    out = out.replace(new RegExp(`${left}${escaped}${right}`, 'gi'), to);
  }
  return out;
}

function createVoiceStore() {
  let state = $state('idle');           // idle | listening | recording | processing | speaking
  let running = $state(false);
  let lastTranscription = $state('');
  let error = $state(null);
  let isDictating = $state(false);     // true when recording for dictation (not AI)
  let stuck = $state(null);            // { state, elapsedSecs } when pipeline is wedged, else null
  let lastRoutedText = '';
  let lastRoutedTime = 0;

  return {
    get state() { return state; },
    get running() { return running; },
    get lastTranscription() { return lastTranscription; },
    get error() { return error; },

    // Derived convenience getters
    get isRecording() { return state === 'recording'; },
    get isListening() { return state === 'listening'; },
    get isSpeaking() { return state === 'speaking'; },
    get isProcessing() { return state === 'processing'; },
    get isDictating() { return isDictating; },
    get stuck() { return stuck; },

    /** Update state from voice-event payload */
    _handleVoiceEvent(payload) {
      if (!payload) return;

      // The Rust VoiceEvent is serialized as { event: "...", data: {...} }
      const eventType = payload.event;
      const data = payload.data || {};

      switch (eventType) {
        case 'state_change':
          state = data.state || 'idle';
          // Any state transition means the pipeline is making progress —
          // clear a stale "stuck" indicator. If it wedges again the
          // watchdog will re-emit a fresh 'stuck' event.
          stuck = null;
          break;
        case 'stuck':
          // Watchdog detected the pipeline wedged in a non-idle state.
          stuck = { state: data.state, elapsedSecs: data.elapsed_secs ?? 0 };
          break;
        case 'ready':
          running = true;
          error = null;
          applyVoiceModeFromConfig();
          break;
        case 'starting':
          running = false;
          error = null;
          break;
        case 'stopping':
          running = false;
          state = 'idle';
          break;
        case 'transcription':
          if (data.text) {
            // Apply user dictionary corrections before anything consumes the
            // text (dedup, injection, AI routing all use the corrected form).
            const text = applyDictionary(data.text, configStore.value?.voice?.dictionary);
            lastTranscription = text;

            // Dedup: the voice pipeline can fire multiple transcription events
            // for the same audio segment. Skip if same text within the dedup window.
            const now = Date.now();
            if (text === lastRoutedText && (now - lastRoutedTime) < TRANSCRIPTION_DEDUP_MS) {
              break;
            }
            lastRoutedText = text;
            lastRoutedTime = now;

            if (isDictating || aiStatusStore.isDictationProvider) {
              if (isDictating) isDictating = false;
              injectText(text).catch((err) => {
                console.warn('[voice] Failed to inject dictation text:', err);
              });
            } else {
              routeTranscriptionToAI(text);
            }
          }
          break;
        case 'speaking_start':
          state = 'speaking';
          break;
        case 'speaking_end':
          // Don't override if pipeline already set to listening
          if (state === 'speaking') {
            state = 'idle';
          }
          break;
        case 'error':
          error = data.message || 'Unknown voice error';
          break;
        case 'audio_devices':
          // Ignore — handled by settings panel if needed
          break;
      }
    },

    _setRunning(value) {
      running = value;
      if (!value) state = 'idle';
    },

    _setError(msg) {
      error = msg;
    },

    startDictation() {
      isDictating = true;
    },

    stopDictation() {
      isDictating = false;
    },

    /** Manually clear the stuck indicator (e.g. after the user restarts voice). */
    clearStuck() {
      stuck = null;
    },
  };
}

export const voiceStore = createVoiceStore();

/**
 * Route a transcription from the voice pipeline to the active AI provider.
 * Adds the text as a user chat message and sends it via the appropriate channel.
 */
function routeTranscriptionToAI(text) {
  // Take any pending attachments (screenshot thumbnails queued from the picker)
  const attachments = attachmentsStore.take();
  const meta = { source: 'voice' };
  if (attachments.length > 0) {
    meta.attachments = attachments;
  }

  // Add as user message in chat (with attachments if any)
  chatStore.addMessage('user', text, meta);

  // Extract image path AND data URL for the AI provider. Screenshot-picker
  // attachments have a real path; drag-and-dropped images only have a data
  // URL (no file on disk). Pass both — the backend prefers the data URL and
  // falls back to reading the path — so dropped images reach the assistant
  // by voice too, matching the text path in App.svelte.
  const imagePath = attachments.length > 0 ? (attachments[0].path || null) : null;
  const imageDataUrl = attachments.length > 0 ? (attachments[0].dataUrl || null) : null;

  // Route to appropriate provider
  if (aiStatusStore.isApiProvider) {
    aiPtyInput(text, imagePath, imageDataUrl).catch((err) => {
      console.warn('[voice] Failed to send transcription to API provider:', err);
    });
  } else {
    writeUserMessage(text, null, null, imagePath, imageDataUrl).catch((err) => {
      console.warn('[voice] Failed to send transcription to MCP inbox:', err);
    });
  }
}

/**
 * Apply the saved activation mode from config to the running voice pipeline.
 */
async function applyVoiceModeFromConfig() {
  const cfg = configStore.value;
  const mode = cfg?.behavior?.activationMode || 'pushToTalk';
  await setVoiceMode(mode).catch((err) => {
    console.warn('[voice] Failed to apply voice mode from config:', err);
  });
}

/**
 * Start the voice engine.
 * Called from App.svelte on startup or from settings.
 */
export async function startVoiceEngine() {
  try {
    const result = await startVoice();
    if (result?.success === false) {
      voiceStore._setError(result.error || 'Failed to start voice engine');
    }
    // Running state will be confirmed by the voice-event Ready event
  } catch (err) {
    voiceStore._setError(err?.message || String(err));
  }
}

/**
 * Stop the voice engine.
 */
export async function stopVoiceEngine() {
  try {
    await stopVoice();
    voiceStore._setRunning(false);
  } catch (err) {
    console.warn('[voice] Stop failed:', err);
  }
}

/** Guards against duplicate registration. Re-registering the voice-event
 *  listener (an effect re-run, a remount, or a dev HMR reload) would stack
 *  handlers and inject dictated text multiple times. */
let voiceListenersInitialized = false;
/** Unlisten handles, kept so the listeners can be torn down on HMR dispose. */
let voiceUnlisteners = [];

/**
 * Initialize voice event listeners. Idempotent — only the first call
 * registers; later calls are no-ops. Call on app mount.
 */
export async function initVoiceListeners() {
  if (voiceListenersInitialized) return;
  voiceListenersInitialized = true;

  // Listen for all voice pipeline events
  voiceUnlisteners.push(await listen('voice-event', (event) => {
    voiceStore._handleVoiceEvent(event.payload);
  }));

  // Listen for MCP inbox messages (voice_send responses from AI → chat UI + TTS).
  // Messages arrive via both named pipe (fast) and inbox watcher (slow fallback).
  // Deduplicate by message ID to prevent double cards/TTS.
  const seenMessageIds = new Set();

  // When a new Claude session starts, reset dedup tracking.
  // The backend clears inbox.json on session start, so old IDs are irrelevant.
  voiceUnlisteners.push(await listen('mcp-session-start', () => {
    seenMessageIds.clear();
  }));

  voiceUnlisteners.push(await listen('mcp-inbox-message', (event) => {
    const payload = event.payload;
    if (!payload || !payload.text) return;

    // Deduplicate: pipe delivers instantly, inbox watcher delivers ~100ms later
    if (payload.id && seenMessageIds.has(payload.id)) return;
    if (payload.id) {
      seenMessageIds.add(payload.id);
      if (seenMessageIds.size > 1000) {
        const arr = [...seenMessageIds];
        seenMessageIds.clear();
        for (const item of arr.slice(-500)) seenMessageIds.add(item);
      }
    }

    if (payload.kind === 'ai_message') {
      // AI response — add to chat and speak it
      chatStore.addMessage('assistant', payload.text, {
        from: payload.from,
        inboxId: payload.id,
      });

      // Speak the response via TTS (unless voice engine is off)
      if (voiceStore.running) {
        speakText(payload.text).catch((err) => {
          console.warn('[voice] Failed to speak inbox message:', err);
        });
      }
    }
    // user_message kind is NOT added here — ChatInput already adds it to the store
  }));

  // Poll initial status
  try {
    const result = await getVoiceStatus();
    const data = unwrapResult(result);
    if (data?.running) {
      voiceStore._setRunning(true);
    }
  } catch {
    // Backend may not be ready yet
  }
}

// Dev only: Vite swaps this module on edit. Without teardown, the previous
// module's listeners stay alive — bound to a stale store with its own dedup
// state — so dictated text gets injected once per accumulated reload. Dispose
// them so dev behaves like production (a single injection).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const un of voiceUnlisteners) {
      try { un?.(); } catch { /* ignore */ }
    }
    voiceUnlisteners = [];
    voiceListenersInitialized = false;
  });
}
