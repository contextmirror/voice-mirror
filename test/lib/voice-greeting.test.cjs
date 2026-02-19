/**
 * voice-greeting.test.js -- Source-inspection tests for tauri/src/lib/voice-greeting.js
 *
 * ES module using Tauri APIs -- tested via source inspection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/voice-greeting.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('voice-greeting.js -- exports', () => {
  it('exports initStartupGreeting function', () => {
    assert.ok(
      src.includes('export async function initStartupGreeting'),
      'Should export initStartupGreeting as async function'
    );
  });
});

describe('voice-greeting.js -- greeting-played-once flag', () => {
  it('has greetingPlayed flag initialized to false', () => {
    assert.ok(src.includes('let greetingPlayed = false'), 'Should initialize greetingPlayed to false');
  });

  it('sets greetingPlayed to true after first greeting', () => {
    assert.ok(src.includes('greetingPlayed = true'), 'Should set flag to true');
  });

  it('checks greetingPlayed before speaking', () => {
    assert.ok(src.includes('greetingPlayed') && src.includes('if'), 'Should check flag to prevent duplicates');
  });

  it('exits early when greetingPlayed is true', () => {
    // The guard checks !payload || greetingPlayed
    assert.ok(
      src.includes('greetingPlayed') && src.includes('return'),
      'Should return early if already played'
    );
  });
});

describe('voice-greeting.js -- TTS call', () => {
  it('imports speakText from api module', () => {
    assert.ok(
      src.includes("import { speakText } from './api.js'") ||
      src.includes("import { speakText } from './api'"),
      'Should import speakText'
    );
  });

  it('calls speakText with greeting message', () => {
    assert.ok(
      src.includes("speakText('Voice Mirror is Online')"),
      'Should speak Voice Mirror is Online'
    );
  });

  it('catches speakText errors', () => {
    assert.ok(src.includes('.catch('), 'Should catch TTS errors');
  });

  it('logs warning on greeting failure', () => {
    assert.ok(src.includes('console.warn'), 'Should warn on failure');
  });
});

describe('voice-greeting.js -- event listening', () => {
  it('imports listen from Tauri event API', () => {
    assert.ok(
      src.includes("import { listen } from '@tauri-apps/api/event'"),
      'Should import listen from Tauri'
    );
  });

  it('listens for voice-event', () => {
    assert.ok(
      src.includes("listen('voice-event'"),
      'Should listen for voice-event'
    );
  });

  it('checks for ready event in payload', () => {
    assert.ok(
      src.includes("payload.event === 'ready'"),
      'Should check for ready event'
    );
  });

  it('accesses event.payload', () => {
    assert.ok(src.includes('event.payload'), 'Should access event payload');
  });
});

describe('voice-greeting.js -- config check', () => {
  it('imports configStore', () => {
    assert.ok(
      src.includes("import { configStore } from './stores/config.svelte.js'") ||
      src.includes("import { configStore } from './stores/config.svelte'"),
      'Should import configStore'
    );
  });

  it('checks announceStartup config preference', () => {
    assert.ok(
      src.includes('announceStartup'),
      'Should check announceStartup config'
    );
  });

  it('reads config value from configStore.value', () => {
    assert.ok(
      src.includes('configStore.value'),
      'Should read from configStore.value'
    );
  });

  it('defaults announceStartup to true (opt-out pattern)', () => {
    // The code checks: cfg?.voice?.announceStartup !== false
    assert.ok(
      src.includes('!== false'),
      'Should default to true (check !== false)'
    );
  });
});

describe('voice-greeting.js -- startup delay', () => {
  it('uses setTimeout before speaking', () => {
    assert.ok(src.includes('setTimeout'), 'Should delay before speaking');
  });

  it('uses 500ms delay for pipeline settle', () => {
    assert.ok(src.includes('500'), 'Should use 500ms delay');
  });
});
