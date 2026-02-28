const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/terminal-profiles.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('terminal-profiles.svelte.js -- exports', () => {
  it('exports terminalProfilesStore', () => {
    assert.ok(src.includes('export const terminalProfilesStore'), 'Should export store');
  });
});

describe('terminal-profiles.svelte.js -- state', () => {
  it('has profiles state', () => {
    assert.ok(src.includes('profiles') && src.includes('$state'), 'Should have profiles state');
  });
  it('has defaultProfileId state', () => {
    assert.ok(src.includes('defaultProfileId'), 'Should have defaultProfileId');
  });
  it('has loaded state', () => {
    assert.ok(src.includes('loaded'), 'Should have loaded flag');
  });
});

describe('terminal-profiles.svelte.js -- methods', () => {
  it('has loadProfiles method', () => {
    assert.ok(src.includes('loadProfiles'), 'Should have loadProfiles');
  });
  it('has getDefaultProfile method', () => {
    assert.ok(src.includes('getDefaultProfile'), 'Should have getDefaultProfile');
  });
  it('has getProfile method', () => {
    assert.ok(src.includes('getProfile'), 'Should have getProfile');
  });
  it('has setDefault method', () => {
    assert.ok(src.includes('setDefault'), 'Should have setDefault');
  });
});

describe('terminal-profiles.svelte.js -- API integration', () => {
  it('imports terminalDetectProfiles from api', () => {
    assert.ok(src.includes('terminalDetectProfiles'), 'Should import API function');
  });
  it('calls terminalDetectProfiles in loadProfiles', () => {
    assert.ok(src.includes('terminalDetectProfiles()'), 'Should call API in loadProfiles');
  });
});

describe('terminal-profiles.svelte.js -- getters', () => {
  it('has profiles getter', () => {
    assert.ok(src.includes('get profiles()'), 'Should have profiles getter');
  });
  it('has defaultProfileId getter', () => {
    assert.ok(src.includes('get defaultProfileId()'), 'Should have defaultProfileId getter');
  });
  it('has loaded getter', () => {
    assert.ok(src.includes('get loaded()'), 'Should have loaded getter');
  });
});

describe('terminal-profiles.svelte.js -- uses success field for IPC response', () => {
  it('checks result.success (not result.ok)', () => {
    assert.ok(src.includes('result?.success'), 'Should check result.success for IpcResponse');
  });
});

describe('terminal-profiles.svelte.js -- profile field access', () => {
  it('reads is_default field from profiles', () => {
    assert.ok(src.includes('is_default'), 'Should access is_default (snake_case from Rust serde)');
  });
});
