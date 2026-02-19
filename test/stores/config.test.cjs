/**
 * config.test.js -- Source-inspection tests for tauri/src/lib/stores/config.svelte.js
 *
 * Since this is a .svelte.js file that uses $state (Svelte 5 runes),
 * it cannot be directly imported in Node.js. We read the source text
 * and assert on expected patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/config.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('config.svelte.js -- DEFAULT_CONFIG structure', () => {
  it('defines DEFAULT_CONFIG', () => {
    assert.ok(src.includes('const DEFAULT_CONFIG'), 'Should define DEFAULT_CONFIG');
  });

  it('exports DEFAULT_CONFIG', () => {
    assert.ok(src.includes('export { DEFAULT_CONFIG }'), 'Should export DEFAULT_CONFIG');
  });

  // All top-level config sections
  const sections = [
    'wakeWord',
    'voice',
    'appearance',
    'behavior',
    'window',
    'overlay',
    'advanced',
    'sidebar',
    'user',
    'system',
    'ai',
  ];

  for (const section of sections) {
    it(`has "${section}" config section`, () => {
      // Match the section key in the DEFAULT_CONFIG object
      assert.ok(
        src.includes(`${section}:`),
        `DEFAULT_CONFIG should have "${section}" section`
      );
    });
  }
});

describe('config.svelte.js -- critical field values', () => {
  it('has ttsAdapter field', () => {
    assert.ok(src.includes("ttsAdapter:"), 'Should have ttsAdapter');
  });

  it('defaults ttsAdapter to kokoro', () => {
    assert.ok(src.includes("ttsAdapter: 'kokoro'"), 'ttsAdapter should default to kokoro');
  });

  it('has ttsVoice field', () => {
    assert.ok(src.includes("ttsVoice:"), 'Should have ttsVoice');
  });

  it('has sttModel field', () => {
    assert.ok(src.includes("sttModel:"), 'Should have sttModel');
  });

  it('defaults theme to colorblind', () => {
    assert.ok(src.includes("theme: 'colorblind'"), 'theme should default to colorblind');
  });

  it('has activationMode field', () => {
    assert.ok(src.includes("activationMode:"), 'Should have activationMode');
  });

  it('defaults activationMode to wakeWord', () => {
    assert.ok(
      src.includes("activationMode: 'wakeWord'"),
      'activationMode should default to wakeWord'
    );
  });

  it('defaults provider to claude', () => {
    assert.ok(src.includes("provider: 'claude'"), 'provider should default to claude');
  });

  it('has contextLength field', () => {
    assert.ok(src.includes('contextLength:'), 'Should have contextLength');
  });

  it('defaults contextLength to 32768', () => {
    assert.ok(src.includes('contextLength: 32768'), 'contextLength should default to 32768');
  });
});

describe('config.svelte.js -- ai.endpoints', () => {
  it('has ollama endpoint at 127.0.0.1:11434', () => {
    assert.ok(
      src.includes("ollama: 'http://127.0.0.1:11434'"),
      'Should have ollama endpoint'
    );
  });

  it('has lmstudio endpoint at 127.0.0.1:1234', () => {
    assert.ok(
      src.includes("lmstudio: 'http://127.0.0.1:1234'"),
      'Should have lmstudio endpoint'
    );
  });

  it('has jan endpoint at 127.0.0.1:1337', () => {
    assert.ok(
      src.includes("jan: 'http://127.0.0.1:1337'"),
      'Should have jan endpoint'
    );
  });
});

describe('config.svelte.js -- store exports', () => {
  it('exports configStore', () => {
    assert.ok(src.includes('export const configStore'), 'Should export configStore');
  });

  it('exports loadConfig', () => {
    assert.ok(src.includes('export async function loadConfig'), 'Should export loadConfig');
  });

  it('exports updateConfig', () => {
    assert.ok(src.includes('export async function updateConfig'), 'Should export updateConfig');
  });

  it('exports resetConfigToDefaults', () => {
    assert.ok(
      src.includes('export async function resetConfigToDefaults'),
      'Should export resetConfigToDefaults'
    );
  });
});

describe('config.svelte.js -- implementation patterns', () => {
  it('uses deepMerge', () => {
    assert.ok(src.includes('deepMerge'), 'Should use deepMerge for config merging');
  });

  it('imports deepMerge from utils', () => {
    assert.ok(
      src.includes("import { deepMerge } from '../utils.js'") ||
      src.includes("import { deepMerge } from '../utils'"),
      'Should import deepMerge from utils module'
    );
  });

  it('uses $state rune', () => {
    assert.ok(src.includes('$state('), 'Should use Svelte 5 $state rune');
  });

  it('imports from api module', () => {
    assert.ok(
      src.includes("from '../api.js'") || src.includes("from '../api'"),
      'Should import from api module'
    );
  });

  it('imports getConfig from api', () => {
    assert.ok(src.includes('getConfig'), 'Should import getConfig from api');
  });

  it('imports setConfig from api', () => {
    assert.ok(src.includes('setConfig'), 'Should import setConfig from api');
  });

  it('imports resetConfig from api', () => {
    assert.ok(
      src.includes('resetConfig') || src.includes('apiResetConfig'),
      'Should import resetConfig from api'
    );
  });

  it('uses structuredClone for deep copying defaults', () => {
    assert.ok(src.includes('structuredClone'), 'Should use structuredClone');
  });
});
