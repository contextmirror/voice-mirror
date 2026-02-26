/**
 * app.test.cjs -- Source-inspection tests for App.svelte
 *
 * Validates the titlebar provider status indicator (moved from sidebar).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/App.svelte'),
  'utf-8'
);

describe('App.svelte -- titlebar provider status', () => {
  it('imports PROVIDER_ICONS from providers.js', () => {
    assert.ok(src.includes('PROVIDER_ICONS'), 'Should import PROVIDER_ICONS');
  });

  it('derives providerIcon from aiStatusStore', () => {
    assert.ok(src.includes('PROVIDER_ICONS[aiProviderType]'), 'Should derive providerIcon');
  });

  it('has titlebar-provider-status class', () => {
    assert.ok(src.includes('titlebar-provider-status'), 'Should have provider status container');
  });

  it('has titlebar-provider-icon-wrapper class', () => {
    assert.ok(src.includes('titlebar-provider-icon-wrapper'), 'Should have icon wrapper');
  });

  it('has titlebar-status-dot class', () => {
    assert.ok(src.includes('titlebar-status-dot'), 'Should have status dot');
  });

  it('has titlebar-provider-name class', () => {
    assert.ok(src.includes('titlebar-provider-name'), 'Should have provider name');
  });

  it('has titlebar-provider-state class', () => {
    assert.ok(src.includes('titlebar-provider-state'), 'Should have provider state');
  });

  it('shows running state with class binding', () => {
    assert.ok(src.includes('class:running={aiStatusStore.running}'), 'Should bind running class');
  });

  it('shows starting state with class binding', () => {
    assert.ok(src.includes('class:starting={aiStatusStore.starting}'), 'Should bind starting class');
  });

  it('displays provider name from aiStatusStore', () => {
    assert.ok(src.includes('aiStatusStore.displayName'), 'Should display provider name');
  });

  it('supports cover-type provider icons', () => {
    assert.ok(src.includes("providerIcon?.type === 'cover'"), 'Should handle cover icons');
  });

  it('has placeholder for missing provider icon', () => {
    assert.ok(src.includes('titlebar-provider-icon placeholder'), 'Should have placeholder class');
  });

  it('has status dot animation for starting state', () => {
    assert.ok(src.includes('titlebar-status-pulse'), 'Should have pulse animation');
  });
});

describe('App.svelte -- auto-start provider gating', () => {
  it('checks ai.autoStart config before starting provider', () => {
    assert.ok(src.includes('autoStart'), 'Should reference autoStart config');
  });

  it('always auto-starts dictation provider regardless of autoStart', () => {
    assert.ok(
      src.includes("provider === 'dictation'"),
      'Should carve out dictation from autoStart check'
    );
  });

  it('has providerStarted guard to prevent re-starts', () => {
    assert.ok(src.includes('providerStarted'), 'Should have providerStarted one-shot guard');
  });
});
