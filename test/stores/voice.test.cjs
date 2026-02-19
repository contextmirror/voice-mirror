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

  it('uses aiPtyInput for API providers', () => {
    assert.ok(
      src.includes('aiPtyInput(text)'),
      'Should call aiPtyInput for API providers'
    );
  });

  it('uses writeUserMessage for CLI providers', () => {
    assert.ok(
      src.includes('writeUserMessage(text)'),
      'Should call writeUserMessage for CLI/MCP providers'
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

  it('bounds the set size to prevent memory leaks', () => {
    assert.ok(
      src.includes('seenMessageIds.size > 100') || src.includes('seenMessageIds.size >='),
      'Should bound the dedup set size'
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
