/**
 * getting-started.test.cjs -- Source-inspection tests for the first-run
 * "Get Started" walkthrough: GettingStarted.svelte plus its wiring into
 * App.svelte, commands.svelte.js, and TitleBar.svelte. Mirrors the
 * source-inspection idiom used in help-dialogs.test.cjs.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  try {
    return fs.readFileSync(path.join(__dirname, rel), 'utf-8');
  } catch {
    return '';
  }
}

const src = read('../../src/components/shared/GettingStarted.svelte');
const appSrc = read('../../src/App.svelte');
const commandsSrc = read('../../src/lib/commands.svelte.js');
const titleBarSrc = read('../../src/components/shared/TitleBar.svelte');

describe('GettingStarted.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'GettingStarted.svelte should exist');
  });

  it('listens for the show-tutorial window event with cleanup', () => {
    assert.ok(
      src.includes("addEventListener('show-tutorial'"),
      'Should add a show-tutorial listener'
    );
    assert.ok(
      src.includes("removeEventListener('show-tutorial'"),
      'Should clean up the listener'
    );
  });

  it('uses a local visible $state', () => {
    assert.ok(
      src.includes('let visible = $state(false)'),
      'Should track visibility with $state'
    );
  });

  it('uses a dialog modal with backdrop and Escape close', () => {
    assert.ok(src.includes('role="dialog"'), 'Should have dialog role');
    assert.ok(src.includes('modal-overlay'), 'Should have a backdrop overlay');
    assert.ok(src.includes("e.key === 'Escape'"), 'Should close on Escape');
  });

  it('gates first-run auto-show on the voice-mirror-tutorial-seen key', () => {
    assert.ok(
      src.includes('voice-mirror-tutorial-seen'),
      'Should use the voice-mirror-tutorial-seen localStorage key'
    );
    assert.ok(
      src.includes('localStorage.getItem'),
      'Should read the seen flag from localStorage'
    );
    assert.ok(
      src.includes('localStorage.setItem'),
      'Should persist the seen flag to localStorage'
    );
  });

  it('only auto-shows after onboarding is completed', () => {
    assert.ok(
      src.includes('configStore'),
      'Should import/read the config store'
    );
    assert.ok(
      src.includes('onboardingCompleted'),
      'Should check onboardingCompleted before auto-showing'
    );
  });

  it('has a stepper with Back / Next / Skip and progress dots', () => {
    assert.ok(src.includes('Skip'), 'Should have a Skip button');
    assert.ok(src.includes('Back'), 'Should have a Back button');
    assert.ok(src.includes('Next'), 'Should have a Next button');
    assert.ok(src.includes('Done'), 'Last step Next becomes Done');
    assert.ok(src.includes('dot'), 'Should render progress dots');
  });

  it('covers the key UI sections in its step copy', () => {
    assert.ok(src.includes('Workspaces'), 'Should mention Workspaces');
    assert.ok(src.includes('Voice Agent'), 'Should mention the Voice Agent');
    assert.ok(src.includes('right-click'), 'Should tell users to right-click for provider');
    assert.ok(src.includes('Command Palette'), 'Should mention the Command Palette');
    assert.ok(src.includes('Get Started'), 'Should mention reopening from Help → Get Started');
  });

  it('wraps localStorage access in try/catch', () => {
    assert.ok(src.includes('try'), 'Should guard localStorage with try');
    assert.ok(src.includes('catch'), 'Should guard localStorage with catch');
  });
});

describe('App.svelte mounts the walkthrough', () => {
  it('imports GettingStarted', () => {
    assert.ok(
      appSrc.includes("import GettingStarted from './components/shared/GettingStarted.svelte'"),
      'Should import GettingStarted'
    );
  });

  it('mounts GettingStarted', () => {
    assert.ok(appSrc.includes('<GettingStarted'), 'Should mount GettingStarted');
  });
});

describe('commands.svelte.js registers help.getStarted', () => {
  it('has a help.getStarted command in the Help category', () => {
    assert.ok(commandsSrc.includes("id: 'help.getStarted'"), 'Should register help.getStarted');
    assert.ok(commandsSrc.includes("label: 'Help: Get Started'"), 'Should label it Help: Get Started');
  });

  it('dispatches the show-tutorial event', () => {
    assert.ok(
      commandsSrc.includes("new CustomEvent('show-tutorial')"),
      'Should dispatch the show-tutorial event'
    );
  });
});

describe('TitleBar.svelte help menu', () => {
  it('includes a Get Started item wired to help.getStarted', () => {
    assert.ok(
      titleBarSrc.includes("cmd: 'help.getStarted'"),
      'Help menu should include help.getStarted'
    );
  });
});
