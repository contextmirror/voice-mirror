/**
 * voice.svelte.js -- Reactive voice pipeline state store.
 *
 * Listens to `voice-event` Tauri events from the Rust voice pipeline
 * and exposes reactive state for the Sidebar, ChatInput, Overlay, etc.
 */
import { listen } from '@tauri-apps/api/event';
import { startVoice, stopVoice, getVoiceStatus, speakText, setVoiceMode, aiPtyInput, writeUserMessage } from '../api.js';
import { configStore } from './config.svelte.js';
import { chatStore } from './chat.svelte.js';
import { aiStatusStore } from './ai-status.svelte.js';

function createVoiceStore() {
  let state = $state('idle');           // idle | listening | recording | processing | speaking
  let running = $state(false);
  let lastTranscription = $state('');
  let error = $state(null);

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

    /** Update state from voice-event payload */
    _handleVoiceEvent(payload) {
      if (!payload) return;

      // The Rust VoiceEvent is serialized as { event: "...", data: {...} }
      const eventType = payload.event;
      const data = payload.data || {};

      switch (eventType) {
        case 'state_change':
          state = data.state || 'idle';
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
            lastTranscription = data.text;
            routeTranscriptionToAI(data.text);
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
  };
}

export const voiceStore = createVoiceStore();

/**
 * Route a transcription from the voice pipeline to the active AI provider.
 * Adds the text as a user chat message and sends it via the appropriate channel.
 */
function routeTranscriptionToAI(text) {
  // Add as user message in chat
  chatStore.addMessage('user', text, { source: 'voice' });

  // Route to appropriate provider
  if (aiStatusStore.isApiProvider) {
    aiPtyInput(text).catch((err) => {
      console.warn('[voice] Failed to send transcription to API provider:', err);
    });
  } else {
    writeUserMessage(text).catch((err) => {
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

/**
 * Initialize voice event listeners. Call once on app mount.
 */
export async function initVoiceListeners() {
  // Listen for all voice pipeline events
  await listen('voice-event', (event) => {
    voiceStore._handleVoiceEvent(event.payload);
  });

  // Listen for MCP inbox messages (voice_send responses from AI → chat UI + TTS).
  // Messages arrive via both named pipe (fast) and inbox watcher (slow fallback).
  // Deduplicate by message ID to prevent double cards/TTS.
  const seenMessageIds = new Set();
  await listen('mcp-inbox-message', (event) => {
    const payload = event.payload;
    if (!payload || !payload.text) return;

    // Deduplicate: pipe delivers instantly, inbox watcher delivers ~100ms later
    if (payload.id && seenMessageIds.has(payload.id)) return;
    if (payload.id) {
      seenMessageIds.add(payload.id);
      // Keep bounded (last 100 IDs)
      if (seenMessageIds.size > 100) {
        const first = seenMessageIds.values().next().value;
        seenMessageIds.delete(first);
      }
    }

    if (payload.kind === 'claude_message') {
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
  });

  // Poll initial status
  try {
    const result = await getVoiceStatus();
    const data = result?.data || result;
    if (data?.running) {
      voiceStore._setRunning(true);
    }
  } catch {
    // Backend may not be ready yet
  }
}
