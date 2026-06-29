/**
 * updater.test.cjs -- Source-inspection tests for the in-app auto-update experience.
 *
 * Covers the updater store state machine, the status-bar entry, the settings
 * Updates section, the release-notes dialog, the don't-nag throttle, and the
 * App.svelte wiring (mount + startAutoCheck + sticky toast). Svelte/runes files
 * can't be imported in Node, so we read source and assert patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// ---- updater store ----

describe('updater.svelte.js -- state machine store', () => {
  const src = read('src/lib/stores/updater.svelte.js');

  it('exports updaterStore', () => {
    assert.ok(src.includes('export const updaterStore'), 'Should export updaterStore');
  });

  it('models all state-machine states', () => {
    for (const state of ['idle', 'checking', 'available', 'downloading', 'downloaded', 'ready', 'error', 'disabled']) {
      assert.ok(src.includes(`'${state}'`), `Should reference state "${state}"`);
    }
  });

  it('exposes the state as runes state', () => {
    assert.ok(src.includes("let state = $state('idle')"), 'Should initialize state machine to idle');
  });

  it('carries the documented payload fields', () => {
    for (const field of ['version', 'notes', 'date', 'downloadedBytes', 'totalBytes', 'error', 'explicit']) {
      assert.ok(src.includes(field), `Should model payload field "${field}"`);
    }
  });

  it('uses plugin-updater check()', () => {
    assert.ok(src.includes("@tauri-apps/plugin-updater"), 'Should import from plugin-updater');
    assert.ok(src.includes('check()'), 'Should call check()');
  });

  it('uses downloadAndInstall with a progress callback', () => {
    assert.ok(src.includes('downloadAndInstall'), 'Should define/call downloadAndInstall');
    assert.ok(src.includes('updateHandle.downloadAndInstall('), 'Should invoke the update handle download');
  });

  it('maps the Started/Progress/Finished download events', () => {
    assert.ok(src.includes("'Started'"), 'Should handle Started event');
    assert.ok(src.includes("'Progress'"), 'Should handle Progress event');
    assert.ok(src.includes("'Finished'"), 'Should handle Finished event');
    assert.ok(src.includes('contentLength'), 'Started should read contentLength');
    assert.ok(src.includes('chunkLength'), 'Progress should accumulate chunkLength');
  });

  it('uses plugin-process relaunch() to restart', () => {
    assert.ok(src.includes('@tauri-apps/plugin-process'), 'Should import from plugin-process');
    assert.ok(src.includes('relaunch'), 'Should call relaunch');
    assert.ok(src.includes('restartToApply'), 'Should expose restartToApply');
  });

  it('guards calls behind a Tauri-context check', () => {
    assert.ok(src.includes('__TAURI_INTERNALS__'), 'Should detect Tauri via __TAURI_INTERNALS__');
    assert.ok(src.includes('function isTauri'), 'Should have an isTauri guard');
  });

  it('swallows background-check errors but surfaces explicit ones', () => {
    assert.ok(src.includes('explicitCheck = false'), 'checkForUpdates defaults explicit to false');
    assert.ok(src.includes('if (explicitCheck)'), 'Should branch error surfacing on explicit');
  });

  it('implements the don\'t-nag throttle with the documented localStorage keys', () => {
    assert.ok(src.includes('vm-update-last-notified-version'), 'Should use last-notified-version key');
    assert.ok(src.includes('vm-update-notified-at'), 'Should use notified-at key');
    assert.ok(src.includes('shouldNotify'), 'Should expose shouldNotify');
    assert.ok(src.includes('recordNotified'), 'Should expose recordNotified');
    assert.ok(src.includes('5 * 24 * 60 * 60 * 1000') || src.includes('NAG_INTERVAL_MS'), 'Should use a 5-day window');
  });

  it('supports stable/beta channels persisted to localStorage', () => {
    assert.ok(src.includes('vm-update-channel'), 'Should use the channel localStorage key');
    assert.ok(src.includes("'beta'"), 'Should support beta channel');
    assert.ok(src.includes('latest-beta.json'), 'Should document the beta endpoint hook');
    assert.ok(src.includes('setChannel'), 'Should expose setChannel');
  });

  it('auto-checks 30s after startup then every 6 hours', () => {
    assert.ok(src.includes('startAutoCheck'), 'Should expose startAutoCheck');
    assert.ok(src.includes('30 * 1000') || src.includes('FIRST_CHECK_DELAY_MS'), 'First check ~30s');
    assert.ok(src.includes('6 * 60 * 60 * 1000') || src.includes('RECHECK_INTERVAL_MS'), 'Recheck every 6h');
    assert.ok(src.includes('setInterval'), 'Should schedule repeating checks');
  });

  it('exposes derived UI helpers (hasUpdate / isReady / progress)', () => {
    assert.ok(src.includes('hasUpdate'), 'Should expose hasUpdate');
    assert.ok(src.includes('isReady'), 'Should expose isReady');
    assert.ok(src.includes('progress'), 'Should expose progress');
  });
});

// ---- status bar entry ----

describe('StatusBar.svelte -- update entry', () => {
  const src = read('src/components/shared/StatusBar.svelte');

  it('imports the updater store', () => {
    assert.ok(src.includes("stores/updater.svelte.js"), 'Should import updaterStore');
  });

  it('reflects update state with the VS Code-style labels', () => {
    assert.ok(src.includes('Checking for updates'), 'Should show checking label');
    assert.ok(src.includes('Downloading update'), 'Should show downloading label');
    assert.ok(src.includes('Update ready'), 'Should show ready label');
  });

  it('is hidden when idle/disabled', () => {
    assert.ok(src.includes('showUpdaterItem'), 'Should gate visibility on a derived flag');
  });

  it('click downloads when available and restarts when ready', () => {
    assert.ok(src.includes('handleUpdaterClick'), 'Should have a click handler');
    assert.ok(src.includes('updaterStore.downloadAndInstall()'), 'available → download');
    assert.ok(src.includes('updaterStore.restartToApply()'), 'ready → restart');
  });
});

// ---- settings Updates section ----

describe('BehaviorSettings.svelte -- Updates section', () => {
  const src = read('src/components/settings/BehaviorSettings.svelte');

  it('has an Updates section', () => {
    assert.ok(src.includes('>Updates<') || src.includes('Updates</h3>'), 'Should render an Updates heading');
  });

  it('shows the current app version via getVersion (guarded)', () => {
    assert.ok(src.includes('@tauri-apps/api/app'), 'Should import app getVersion');
    assert.ok(src.includes('getVersion'), 'Should call getVersion');
    assert.ok(src.includes('__TAURI_INTERNALS__'), 'Should guard the version call');
  });

  it('has a Check for updates button calling checkForUpdates(true)', () => {
    assert.ok(src.includes('Check for updates'), 'Should render a check button');
    assert.ok(src.includes('checkForUpdates(true)'), 'Explicit check passes true');
  });

  it('has a Stable/Beta channel toggle', () => {
    assert.ok(src.includes('Stable') && src.includes('Beta'), 'Should offer Stable and Beta');
    assert.ok(src.includes('setChannel') || src.includes('setUpdateChannel'), 'Should switch channel');
  });

  it('has an auto-check toggle persisted to config', () => {
    assert.ok(src.includes('Automatically Check for Updates'), 'Should have auto-check toggle');
    assert.ok(src.includes('updates:') && src.includes('autoCheck'), 'Should persist updates.autoCheck');
  });
});

// ---- release notes dialog ----

describe('UpdateNotesDialog.svelte -- release notes modal', () => {
  const src = read('src/components/shared/UpdateNotesDialog.svelte');

  it('imports the updater store', () => {
    assert.ok(src.includes("stores/updater.svelte.js"), 'Should import updaterStore');
  });

  it('opens on the show-update-notes window event', () => {
    assert.ok(src.includes("addEventListener('show-update-notes'"), 'Should listen for show-update-notes');
  });

  it('renders the version and notes', () => {
    assert.ok(src.includes('updaterStore.version'), 'Should show version');
    assert.ok(src.includes('updaterStore.notes'), 'Should show notes');
  });
});

// ---- App.svelte wiring ----

describe('App.svelte -- updater wiring', () => {
  const src = read('src/App.svelte');

  it('imports the updater store and notes dialog', () => {
    assert.ok(src.includes("stores/updater.svelte.js"), 'Should import updaterStore');
    assert.ok(src.includes('UpdateNotesDialog'), 'Should import UpdateNotesDialog');
  });

  it('mounts the UpdateNotesDialog', () => {
    assert.ok(src.includes('<UpdateNotesDialog'), 'Should mount the dialog');
  });

  it('calls startAutoCheck after config loads', () => {
    assert.ok(src.includes('startAutoCheck'), 'Should call startAutoCheck');
    assert.ok(src.includes('configStore.loaded'), 'Should gate on configStore.loaded');
    assert.ok(src.includes('updates?.autoCheck'), 'Should respect the autoCheck config flag');
  });

  it('shows a sticky restart toast for the ready state, gated by the throttle', () => {
    assert.ok(src.includes("=== 'ready'"), 'Should react to the ready state');
    assert.ok(src.includes('shouldNotify'), 'Should gate the toast by the throttle');
    assert.ok(src.includes('recordNotified'), 'Should record the notification');
    assert.ok(src.includes('duration: 0'), 'Toast should be sticky');
    assert.ok(src.includes('Restart now'), 'Should offer Restart now');
    assert.ok(src.includes('Release notes'), 'Should offer Release notes');
  });
});

// ---- diagnostics wiring ----

describe('diagnostics -- updater subsystem registered', () => {
  it('health-contracts.js defines an updater contract', () => {
    const src = read('src/lib/health-contracts.js');
    assert.ok(src.includes("'updater'"), 'Should register an updater contract');
    assert.ok(src.includes('updaterStore'), 'Should import the updater store');
  });

  it('diagnostics store lists updater in EXPECTED_SUBSYSTEMS', () => {
    const src = read('src/lib/stores/diagnostics.svelte.js');
    assert.ok(src.includes("'updater'"), 'Should expect the updater subsystem');
  });
});
