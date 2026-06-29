/**
 * sandbox-preview.test.cjs -- Source-inspection tests for SandboxPreview.svelte
 *
 * Covers the confirm-before-start UX (FIX 2): the in-panel confirmation shown
 * when the user clicks the App tab with no session and no remembered preference.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'lens', 'SandboxPreview.svelte'),
  'utf-8'
);

describe('SandboxPreview: confirm-before-start UI', () => {
  it('renders a confirm branch driven by the store confirmStart flag', () => {
    assert.ok(src.includes('sandboxPreviewStore.confirmStart'), 'Should read confirmStart from the store');
    assert.ok(src.includes('{#if confirmStart}'), 'Should branch on confirmStart first');
  });

  it('shows the project name in the prompt', () => {
    assert.ok(src.includes('projectStore.activeProject'), 'Should read the active project name');
    assert.ok(src.includes('projectName'), 'Should reference the project name');
  });

  it('Start button calls confirmStartNow with the always-checkbox value', () => {
    assert.ok(
      src.includes('sandboxPreviewStore.confirmStartNow(alwaysStart)'),
      'Start should call confirmStartNow(alwaysStart)'
    );
  });

  it('Not now button dismisses via cancelStart', () => {
    assert.ok(src.includes('sandboxPreviewStore.cancelStart()'), 'Should wire cancelStart for "Not now"');
  });

  it('has an "always start automatically" checkbox bound to local state', () => {
    assert.ok(/let\s+alwaysStart\s*=\s*\$state\(false\)/.test(src), 'Should track alwaysStart in $state');
    assert.ok(src.includes('bind:checked={alwaysStart}'), 'Checkbox should bind to alwaysStart');
    assert.ok(src.includes('Always start automatically'), 'Should label the checkbox clearly');
  });
});
