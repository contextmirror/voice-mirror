/**
 * ai-status.test.js -- Source-inspection tests for ai-status.svelte.js
 *
 * Validates exports, reactive state, event listeners, and provider maps
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'ai-status.svelte.js'),
  'utf-8'
);

// ============ PROVIDER_NAMES map ============

describe('ai-status: PROVIDER_NAMES', () => {
  const expectedProviders = [
    ['claude', 'Claude Code'],
    ['opencode', 'OpenCode'],
    ['codex', 'OpenAI Codex'],
    ['gemini-cli', 'Gemini CLI'],
    ['kimi-cli', 'Kimi CLI'],
    ['ollama', 'Ollama'],
    ['lmstudio', 'LM Studio'],
    ['jan', 'Jan'],
    ['openai', 'OpenAI'],
    ['groq', 'Groq'],
  ];

  for (const [key, name] of expectedProviders) {
    it(`has entry for "${key}" -> "${name}"`, () => {
      // Match the key (may be quoted or unquoted depending on if it has hyphens)
      assert.ok(src.includes(key), `PROVIDER_NAMES should contain key "${key}"`);
      assert.ok(src.includes(`'${name}'`) || src.includes(`"${name}"`),
        `PROVIDER_NAMES should map "${key}" to "${name}"`);
    });
  }

  it('defines PROVIDER_NAMES as a const', () => {
    assert.ok(src.includes('const PROVIDER_NAMES'), 'Should define const PROVIDER_NAMES');
  });
});

// ============ CLI_PROVIDERS list ============

describe('ai-status: CLI_PROVIDERS', () => {
  const expectedCli = ['claude', 'opencode', 'codex', 'gemini-cli', 'kimi-cli'];

  it('defines CLI_PROVIDERS as a const array', () => {
    assert.ok(src.includes('const CLI_PROVIDERS'), 'Should define const CLI_PROVIDERS');
  });

  for (const provider of expectedCli) {
    it(`includes "${provider}"`, () => {
      // CLI_PROVIDERS array should contain this string
      assert.ok(
        src.includes(`'${provider}'`) || src.includes(`"${provider}"`),
        `CLI_PROVIDERS should include "${provider}"`
      );
    });
  }
});

// ============ Exports ============

describe('ai-status: exports', () => {
  it('exports aiStatusStore', () => {
    assert.ok(src.includes('export const aiStatusStore'), 'Should export aiStatusStore');
  });

  it('exports startProvider', () => {
    assert.ok(src.includes('export async function startProvider'), 'Should export startProvider');
  });

  it('exports stopProvider', () => {
    assert.ok(src.includes('export async function stopProvider'), 'Should export stopProvider');
  });

  it('exports switchProvider', () => {
    assert.ok(src.includes('export async function switchProvider'), 'Should export switchProvider');
  });

  it('exports refreshStatus', () => {
    assert.ok(src.includes('export async function refreshStatus'), 'Should export refreshStatus');
  });

  it('exports initAiStatusListeners', () => {
    assert.ok(src.includes('export async function initAiStatusListeners'), 'Should export initAiStatusListeners');
  });
});

// ============ Getters ============

describe('ai-status: store getters', () => {
  const expectedGetters = ['running', 'providerType', 'displayName', 'error', 'starting', 'isCliProvider', 'isApiProvider'];

  for (const getter of expectedGetters) {
    it(`has getter "${getter}"`, () => {
      assert.ok(
        src.includes(`get ${getter}()`),
        `Store should have getter "${getter}"`
      );
    });
  }

  it('isCliProvider checks CLI_PROVIDERS.includes', () => {
    assert.ok(
      src.includes('CLI_PROVIDERS.includes(providerType)'),
      'isCliProvider should check CLI_PROVIDERS.includes(providerType)'
    );
  });

  it('isApiProvider is the inverse of CLI check', () => {
    assert.ok(
      src.includes('!CLI_PROVIDERS.includes(providerType)'),
      'isApiProvider should negate CLI_PROVIDERS.includes'
    );
  });
});

// ============ $state reactivity ============

describe('ai-status: $state reactivity', () => {
  const stateVars = ['running', 'providerType', 'displayName', 'error', 'starting'];

  for (const varName of stateVars) {
    it(`uses $state for "${varName}"`, () => {
      const pattern = new RegExp(`let\\s+${varName}\\s*=\\s*\\$state\\(`);
      assert.ok(pattern.test(src), `Should use $state() for "${varName}"`);
    });
  }
});

// ============ Imports ============

describe('ai-status: imports', () => {
  it('imports buildLocalLlmInstructions', () => {
    assert.ok(
      src.includes('buildLocalLlmInstructions'),
      'Should import buildLocalLlmInstructions'
    );
  });

  it('imports from local-llm-instructions.js', () => {
    assert.ok(
      src.includes('local-llm-instructions.js'),
      'Should import from local-llm-instructions.js'
    );
  });

  it('imports listen from @tauri-apps/api/event', () => {
    assert.ok(
      src.includes("from '@tauri-apps/api/event'") || src.includes('from "@tauri-apps/api/event"'),
      'Should import from @tauri-apps/api/event'
    );
  });

  it('imports chatStore for routing API responses', () => {
    assert.ok(
      src.includes('chatStore'),
      'Should import/use chatStore for wiring streaming events'
    );
  });
});

// ============ Event listeners ============

describe('ai-status: event listeners', () => {
  const expectedEvents = [
    'ai-status-change',
    'ai-error',
    'ai-stream-token',
    'ai-stream-end',
    'ai-response',
    'ai-tool-calls',
  ];

  for (const eventName of expectedEvents) {
    it(`listens to "${eventName}"`, () => {
      assert.ok(
        src.includes(`'${eventName}'`) || src.includes(`"${eventName}"`),
        `Should listen to "${eventName}" event`
      );
    });
  }

  it('uses listen() to register event handlers', () => {
    const listenCalls = src.match(/await listen\(/g);
    assert.ok(listenCalls, 'Should call await listen()');
    assert.ok(listenCalls.length >= 5, `Should have at least 5 listen() calls, found ${listenCalls.length}`);
  });
});

// ============ API streaming integration ============

describe('ai-status: API streaming integration', () => {
  it('tracks streaming message ID with _apiStreamingMsgId', () => {
    assert.ok(src.includes('_apiStreamingMsgId'), 'Should track streaming message ID');
  });

  it('calls chatStore.startStreamingMessage on first token', () => {
    assert.ok(
      src.includes('chatStore.startStreamingMessage'),
      'Should call chatStore.startStreamingMessage'
    );
  });

  it('calls chatStore.updateStreamingMessage to append tokens', () => {
    assert.ok(
      src.includes('chatStore.updateStreamingMessage'),
      'Should call chatStore.updateStreamingMessage'
    );
  });

  it('calls chatStore.finalizeStreamingMessage on stream end', () => {
    assert.ok(
      src.includes('chatStore.finalizeStreamingMessage'),
      'Should call chatStore.finalizeStreamingMessage'
    );
  });

  it('calls refreshStatus at the end of initAiStatusListeners', () => {
    assert.ok(
      src.includes('await refreshStatus()'),
      'Should poll initial status at the end of init'
    );
  });

  it('speaks API responses via speakText', () => {
    assert.ok(src.includes('speakText'), 'Should call speakText for TTS on API responses');
  });
});
