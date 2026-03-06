/**
 * voice.test.js -- Source-inspection tests for voice.svelte.js
 *
 * Validates exports, reactive state, event listeners, and transcription routing
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'voice.svelte.js'),
  'utf-8'
);

// ============ Exports ============

describe('voice: exports', () => {
  it('exports voiceStore', () => {
    assert.ok(src.includes('export const voiceStore'), 'Should export voiceStore');
  });

  it('exports startVoiceEngine', () => {
    assert.ok(src.includes('export async function startVoiceEngine'), 'Should export startVoiceEngine');
  });

  it('exports stopVoiceEngine', () => {
    assert.ok(src.includes('export async function stopVoiceEngine'), 'Should export stopVoiceEngine');
  });

  it('exports initVoiceListeners', () => {
    assert.ok(src.includes('export async function initVoiceListeners'), 'Should export initVoiceListeners');
  });
});

// ============ Store getters ============

describe('voice: store getters', () => {
  const expectedGetters = ['state', 'running', 'lastTranscription', 'error', 'isRecording', 'isListening'];

  for (const getter of expectedGetters) {
    it(`has getter "${getter}"`, () => {
      assert.ok(src.includes(`get ${getter}()`), `Store should have getter "${getter}"`);
    });
  }

  it('has getter "isSpeaking"', () => {
    assert.ok(src.includes('get isSpeaking()'), 'Should have isSpeaking getter');
  });

  it('has getter "isProcessing"', () => {
    assert.ok(src.includes('get isProcessing()'), 'Should have isProcessing getter');
  });

  it('isRecording checks state === "recording"', () => {
    assert.ok(
      src.includes("state === 'recording'") || src.includes('state === "recording"'),
      'isRecording should check state === "recording"'
    );
  });

  it('isListening checks state === "listening"', () => {
    assert.ok(
      src.includes("state === 'listening'") || src.includes('state === "listening"'),
      'isListening should check state === "listening"'
    );
  });
});

// ============ $state reactivity ============

describe('voice: $state reactivity', () => {
  const stateVars = [
    { name: 'state', init: "'idle'" },
    { name: 'running', init: 'false' },
    { name: 'lastTranscription', init: "''" },
    { name: 'error', init: 'null' },
  ];

  for (const { name, init } of stateVars) {
    it(`uses $state for "${name}"`, () => {
      const pattern = new RegExp(`let\\s+${name}\\s*=\\s*\\$state\\(`);
      assert.ok(pattern.test(src), `Should use $state() for "${name}"`);
    });
  }

  it('state is initialized to "idle"', () => {
    assert.ok(
      src.includes("$state('idle')") || src.includes('$state("idle")'),
      'state should be initialized to "idle"'
    );
  });

  it('running is initialized to false', () => {
    assert.ok(src.includes('$state(false)'), 'running should be initialized to false');
  });
});

// ============ Event listeners ============

describe('voice: event listeners', () => {
  it('listens to "voice-event" Tauri event', () => {
    assert.ok(
      src.includes("'voice-event'") || src.includes('"voice-event"'),
      'Should listen to "voice-event" event'
    );
  });

  it('listens to "mcp-inbox-message" for MCP responses', () => {
    assert.ok(
      src.includes("'mcp-inbox-message'") || src.includes('"mcp-inbox-message"'),
      'Should listen to "mcp-inbox-message" event'
    );
  });

  it('imports listen from @tauri-apps/api/event', () => {
    assert.ok(
      src.includes("from '@tauri-apps/api/event'") || src.includes('from "@tauri-apps/api/event"'),
      'Should import listen from @tauri-apps/api/event'
    );
  });
});

// ============ Voice event handling ============

describe('voice: _handleVoiceEvent switch cases', () => {
  const eventTypes = [
    'state_change',
    'ready',
    'starting',
    'stopping',
    'transcription',
    'speaking_start',
    'speaking_end',
    'error',
    'audio_devices',
  ];

  for (const eventType of eventTypes) {
    it(`handles "${eventType}" event`, () => {
      assert.ok(
        src.includes(`'${eventType}'`) || src.includes(`"${eventType}"`),
        `Should handle "${eventType}" voice event`
      );
    });
  }
});

// ============ Transcription routing ============

describe('voice: transcription routing to AI', () => {
  it('defines routeTranscriptionToAI function', () => {
    assert.ok(
      src.includes('function routeTranscriptionToAI'),
      'Should define routeTranscriptionToAI'
    );
  });

  it('calls routeTranscriptionToAI when transcription arrives', () => {
    assert.ok(
      src.includes('routeTranscriptionToAI(data.text)'),
      'Should route transcription text to AI'
    );
  });

  it('adds transcription as user message in chat', () => {
    assert.ok(
      src.includes("chatStore.addMessage('user'") || src.includes('chatStore.addMessage("user"'),
      'Should add transcription as user chat message'
    );
  });

  it('checks isApiProvider to decide routing path', () => {
    assert.ok(
      src.includes('aiStatusStore.isApiProvider'),
      'Should check aiStatusStore.isApiProvider for routing'
    );
  });

  it('uses aiPtyInput with imagePath for API providers', () => {
    assert.ok(
      src.includes('aiPtyInput(text, imagePath)'),
      'Should call aiPtyInput with imagePath for API providers'
    );
  });

  it('uses writeUserMessage with imagePath for CLI providers', () => {
    assert.ok(
      src.includes('writeUserMessage(text, null, null, imagePath)'),
      'Should call writeUserMessage with imagePath for CLI/MCP providers'
    );
  });

  it('imports attachmentsStore for pending attachments', () => {
    assert.ok(
      src.includes("import { attachmentsStore } from './attachments.svelte.js'"),
      'Should import attachmentsStore'
    );
  });

  it('takes pending attachments via attachmentsStore.take()', () => {
    assert.ok(
      src.includes('attachmentsStore.take()'),
      'Should take pending attachments from shared store'
    );
  });

  it('includes attachments in chat message metadata', () => {
    assert.ok(
      src.includes('meta.attachments = attachments'),
      'Should include attachments in message metadata'
    );
  });

  it('extracts imagePath from first attachment', () => {
    assert.ok(
      src.includes('attachments[0].path'),
      'Should extract imagePath from first attachment'
    );
  });
});

// ============ Transcription deduplication ============

describe('voice: transcription deduplication', () => {
  it('defines TRANSCRIPTION_DEDUP_MS constant', () => {
    assert.ok(src.includes('TRANSCRIPTION_DEDUP_MS'), 'Should define dedup window constant');
  });

  it('tracks lastRoutedText for dedup comparison', () => {
    assert.ok(src.includes('lastRoutedText'), 'Should track last routed text');
  });

  it('tracks lastRoutedTime for dedup window', () => {
    assert.ok(src.includes('lastRoutedTime'), 'Should track last routed timestamp');
  });

  it('skips duplicate transcription within dedup window', () => {
    assert.ok(
      src.includes('data.text === lastRoutedText'),
      'Should compare against last routed text'
    );
    assert.ok(
      src.includes('lastRoutedTime) < TRANSCRIPTION_DEDUP_MS'),
      'Should check time window for dedup'
    );
  });
});

// ============ Message deduplication ============

describe('voice: message deduplication', () => {
  it('uses a Set for deduplication', () => {
    assert.ok(src.includes('new Set()'), 'Should use a Set for deduplication');
  });

  it('tracks seen message IDs with seenMessageIds', () => {
    assert.ok(src.includes('seenMessageIds'), 'Should track seen message IDs');
  });

  it('checks if message ID was already seen', () => {
    assert.ok(
      src.includes('seenMessageIds.has('),
      'Should check seenMessageIds.has() before processing'
    );
  });

  it('adds new message IDs to the set', () => {
    assert.ok(
      src.includes('seenMessageIds.add('),
      'Should add new message IDs to the set'
    );
  });

  it('resets dedup set on mcp-session-start', () => {
    assert.ok(
      src.includes('seenMessageIds.clear()'),
      'Should clear seenMessageIds when a new session starts'
    );
  });
});

// ============ Imports from api.js ============

describe('voice: imports from api.js', () => {
  const apiImports = ['startVoice', 'stopVoice', 'getVoiceStatus', 'speakText', 'setVoiceMode'];

  for (const name of apiImports) {
    it(`imports "${name}" from api.js`, () => {
      assert.ok(src.includes(name), `Should import "${name}"`);
    });
  }

  it('imports from ../api.js', () => {
    assert.ok(
      src.includes("from '../api.js'") || src.includes('from "../api.js"'),
      'Should import from ../api.js'
    );
  });
});

// ============ Dictation support ============

describe('voice: dictation', () => {
  it('has isDictating $state', () => {
    assert.ok(
      /let\s+isDictating\s*=\s*\$state\(/.test(src),
      'Should have isDictating $state'
    );
  });

  it('has isDictating getter', () => {
    assert.ok(src.includes('get isDictating()'), 'Should have isDictating getter');
  });

  it('has startDictation method', () => {
    assert.ok(src.includes('startDictation()'), 'Should have startDictation method');
  });

  it('has stopDictation method', () => {
    assert.ok(src.includes('stopDictation()'), 'Should have stopDictation method');
  });

  it('imports injectText from api.js', () => {
    assert.ok(src.includes('injectText'), 'Should import injectText');
  });

  it('calls injectText when isDictating is true on transcription', () => {
    assert.ok(
      src.includes('injectText(data.text)'),
      'Should call injectText with transcription text when dictating'
    );
  });

  it('resets isDictating after injecting text', () => {
    // isDictating should be set to false before/after calling injectText
    assert.ok(
      src.includes('isDictating = false'),
      'Should reset isDictating to false after injecting'
    );
  });
});

// ============ Voice mode from config ============

describe('voice: applyVoiceModeFromConfig', () => {
  it('defines applyVoiceModeFromConfig function', () => {
    assert.ok(
      src.includes('function applyVoiceModeFromConfig'),
      'Should define applyVoiceModeFromConfig'
    );
  });

  it('reads activationMode from config', () => {
    assert.ok(
      src.includes('activationMode'),
      'Should read activationMode from config'
    );
  });

  it('defaults to pushToTalk', () => {
    assert.ok(
      src.includes("'pushToTalk'") || src.includes('"pushToTalk"'),
      'Should default to pushToTalk'
    );
  });

  it('calls setVoiceMode to apply the mode', () => {
    assert.ok(
      src.includes('setVoiceMode(mode)') || src.includes('setVoiceMode('),
      'Should call setVoiceMode to apply'
    );
  });
});
