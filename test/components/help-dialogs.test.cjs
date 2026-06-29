/**
 * help-dialogs.test.cjs -- Source-inspection tests for the Help-menu dialogs:
 *   AboutDialog.svelte and KeyboardShortcutsDialog.svelte, plus their wiring
 *   into App.svelte. Mirrors the source-inspection idiom used elsewhere.
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

const aboutSrc = read('../../src/components/shared/AboutDialog.svelte');
const shortcutsSrc = read('../../src/components/shared/KeyboardShortcutsDialog.svelte');
const appSrc = read('../../src/App.svelte');

describe('AboutDialog.svelte', () => {
  it('exists and has content', () => {
    assert.ok(aboutSrc.length > 0, 'AboutDialog.svelte should exist');
  });

  it('shows the app name and tagline', () => {
    assert.ok(aboutSrc.includes('Voice Mirror'), 'Should show app name');
    assert.ok(aboutSrc.includes('voice-native IDE'), 'Should include the tagline');
  });

  it('includes the version string (mirrors package.json)', () => {
    assert.ok(aboutSrc.includes('0.1.0'), 'Should include version 0.1.0');
  });

  it('includes the website URL', () => {
    assert.ok(
      aboutSrc.includes('https://www.contextmirror.com'),
      'Should link to the website'
    );
  });

  it('opens links externally via the Tauri shell plugin', () => {
    assert.ok(
      aboutSrc.includes('@tauri-apps/plugin-shell'),
      'Should import open from plugin-shell'
    );
  });

  it('listens for the show-about-dialog window event', () => {
    assert.ok(
      aboutSrc.includes("addEventListener('show-about-dialog'"),
      'Should add a show-about-dialog listener'
    );
    assert.ok(
      aboutSrc.includes("removeEventListener('show-about-dialog'"),
      'Should clean up the listener'
    );
  });

  it('uses a dialog modal with backdrop and Escape close', () => {
    assert.ok(aboutSrc.includes('role="dialog"'), 'Should have dialog role');
    assert.ok(aboutSrc.includes('modal-overlay'), 'Should have a backdrop overlay');
    assert.ok(aboutSrc.includes("e.key === 'Escape'"), 'Should close on Escape');
  });

  it('uses a local visible $state', () => {
    assert.ok(aboutSrc.includes('let visible = $state(false)'), 'Should track visibility with $state');
  });
});

describe('KeyboardShortcutsDialog.svelte', () => {
  it('exists and has content', () => {
    assert.ok(shortcutsSrc.length > 0, 'KeyboardShortcutsDialog.svelte should exist');
  });

  it('imports the shortcut definitions from the shortcuts store', () => {
    assert.ok(
      shortcutsSrc.includes('DEFAULT_GLOBAL_SHORTCUTS'),
      'Should import DEFAULT_GLOBAL_SHORTCUTS'
    );
    assert.ok(
      shortcutsSrc.includes('IN_APP_SHORTCUTS'),
      'Should import IN_APP_SHORTCUTS'
    );
    assert.ok(
      shortcutsSrc.includes('stores/shortcuts.svelte.js'),
      'Should import from the shortcuts store'
    );
  });

  it('renders Global and In-App groups', () => {
    assert.ok(shortcutsSrc.includes('Global'), 'Should have a Global section');
    assert.ok(shortcutsSrc.includes('In-App'), 'Should have an In-App section');
  });

  it('renders key combos in <kbd> elements', () => {
    assert.ok(shortcutsSrc.includes('<kbd>'), 'Should render kbd elements');
  });

  it('listens for the show-keyboard-shortcuts window event', () => {
    assert.ok(
      shortcutsSrc.includes("addEventListener('show-keyboard-shortcuts'"),
      'Should add a show-keyboard-shortcuts listener'
    );
    assert.ok(
      shortcutsSrc.includes("removeEventListener('show-keyboard-shortcuts'"),
      'Should clean up the listener'
    );
  });

  it('uses a dialog modal with backdrop and Escape close', () => {
    assert.ok(shortcutsSrc.includes('role="dialog"'), 'Should have dialog role');
    assert.ok(shortcutsSrc.includes('modal-overlay'), 'Should have a backdrop overlay');
    assert.ok(shortcutsSrc.includes("e.key === 'Escape'"), 'Should close on Escape');
  });

  it('has a scrollable list container', () => {
    assert.ok(shortcutsSrc.includes('overflow-y: auto'), 'Should make the list scrollable');
  });
});

describe('App.svelte mounts the help dialogs', () => {
  it('imports both dialogs', () => {
    assert.ok(
      appSrc.includes("import AboutDialog from './components/shared/AboutDialog.svelte'"),
      'Should import AboutDialog'
    );
    assert.ok(
      appSrc.includes("import KeyboardShortcutsDialog from './components/shared/KeyboardShortcutsDialog.svelte'"),
      'Should import KeyboardShortcutsDialog'
    );
  });

  it('mounts both dialogs', () => {
    assert.ok(appSrc.includes('<AboutDialog'), 'Should mount AboutDialog');
    assert.ok(appSrc.includes('<KeyboardShortcutsDialog'), 'Should mount KeyboardShortcutsDialog');
  });
});
