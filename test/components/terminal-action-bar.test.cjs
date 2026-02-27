const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalActionBar.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalActionBar.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports from terminal-tabs.svelte.js', () => {
    assert.ok(src.includes('terminal-tabs.svelte.js'), 'Should import from correct store file');
  });
});

describe('TerminalActionBar.svelte -- structure', () => {
  it('has terminal-actions container', () => {
    assert.ok(src.includes('terminal-actions'), 'Should have actions container');
  });
  it('has action buttons', () => {
    assert.ok(src.includes('action-btn'), 'Should have action button class');
  });
});

describe('TerminalActionBar.svelte -- new terminal button', () => {
  it('calls addGroup for new terminal', () => {
    assert.ok(src.includes('addGroup'), 'Should call addGroup');
  });
  it('has New Terminal title', () => {
    assert.ok(src.includes('New Terminal'), 'Should have New Terminal label');
  });
});

describe('TerminalActionBar.svelte -- split button', () => {
  it('calls splitInstance', () => {
    assert.ok(src.includes('splitInstance'), 'Should call splitInstance');
  });
  it('has Split Terminal title', () => {
    assert.ok(src.includes('Split Terminal'), 'Should have Split Terminal label');
  });
});

describe('TerminalActionBar.svelte -- dropdown menu', () => {
  it('has dropdown menu container', () => {
    assert.ok(src.includes('dropdown-menu'), 'Should have dropdown menu');
  });
  it('has dropdown items', () => {
    assert.ok(src.includes('dropdown-item'), 'Should have dropdown items');
  });
  it('has dropdown divider', () => {
    assert.ok(src.includes('dropdown-divider'), 'Should have divider');
  });
  it('dropdown uses position fixed', () => {
    assert.ok(src.includes('position: fixed'), 'Should use fixed positioning');
  });
  it('dropdown has z-index 10000', () => {
    assert.ok(src.includes('z-index: 10000'), 'Should have high z-index');
  });
  it('has dropdown chevron button', () => {
    assert.ok(src.includes('dropdown-chevron'), 'Should have chevron trigger');
  });
});

describe('TerminalActionBar.svelte -- overflow menu', () => {
  it('has overflow menu button (three dots)', () => {
    assert.ok(src.includes('More actions') || src.includes('overflow'), 'Should have overflow button');
  });
  it('has Clear Terminal option', () => {
    assert.ok(src.includes('Clear Terminal'), 'Should have clear option');
  });
});

describe('TerminalActionBar.svelte -- configure settings placeholder', () => {
  it('has Configure Terminal Settings option', () => {
    assert.ok(src.includes('Configure Terminal Settings'), 'Should have configure option');
  });
  it('configure is a placeholder (console.log)', () => {
    assert.ok(src.includes('console.log') && src.includes('placeholder'), 'Should be placeholder');
  });
});

describe('TerminalActionBar.svelte -- terminal profiles integration', () => {
  it('imports terminalProfilesStore', () => {
    assert.ok(src.includes('terminalProfilesStore'), 'Should import profiles store');
  });
  it('imports from terminal-profiles.svelte.js', () => {
    assert.ok(src.includes('terminal-profiles.svelte.js'), 'Should import from correct store file');
  });
  it('imports onMount from svelte', () => {
    assert.ok(src.includes("import { onMount }") || src.includes("onMount"), 'Should import onMount');
  });
  it('loads profiles on mount', () => {
    assert.ok(src.includes('loadProfiles'), 'Should call loadProfiles');
  });
  it('renders profile items in dropdown', () => {
    assert.ok(src.includes('terminalProfilesStore.profiles'), 'Should iterate over profiles');
  });
  it('has handleNewWithProfile function', () => {
    assert.ok(src.includes('handleNewWithProfile'), 'Should have handler for profile selection');
  });
  it('passes profileId when creating terminal from profile', () => {
    assert.ok(src.includes('profileId') || src.includes('profile.id'), 'Should pass profile ID');
  });
  it('has profile-icon class', () => {
    assert.ok(src.includes('profile-icon'), 'Should have profile icon styling');
  });
});

describe('TerminalActionBar.svelte -- outside click handling', () => {
  it('closes menus on outside click', () => {
    assert.ok(src.includes('window.addEventListener'), 'Should listen for outside clicks');
  });
  it('uses $effect for cleanup', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for lifecycle');
  });
});
