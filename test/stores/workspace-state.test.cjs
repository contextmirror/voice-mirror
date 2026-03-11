const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/workspace-state.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('workspace-state.svelte.js — exports', () => {
  it('exports saveCurrentState', () => {
    assert.ok(src.includes('export async function saveCurrentState('), 'Should export saveCurrentState');
  });

  it('exports restoreState', () => {
    assert.ok(src.includes('export async function restoreState('), 'Should export restoreState');
  });

  it('exports startAutoSave', () => {
    assert.ok(src.includes('export function startAutoSave('), 'Should export startAutoSave');
  });

  it('exports stopAutoSave', () => {
    assert.ok(src.includes('export function stopAutoSave('), 'Should export stopAutoSave');
  });

  it('exports notifyChange', () => {
    assert.ok(src.includes('export function notifyChange('), 'Should export notifyChange');
  });
});

describe('workspace-state.svelte.js — imports', () => {
  it('imports tabsStore', () => {
    assert.ok(src.includes("from './tabs.svelte.js'"), 'Should import from tabs store');
  });

  it('imports editorGroupsStore', () => {
    assert.ok(src.includes("from './editor-groups.svelte.js'"), 'Should import from editor-groups store');
  });

  it('imports layoutStore', () => {
    assert.ok(src.includes("from './layout.svelte.js'"), 'Should import from layout store');
  });

  it('imports saveWorkspaceState and loadWorkspaceState from api', () => {
    assert.ok(src.includes('saveWorkspaceState'), 'Should import saveWorkspaceState');
    assert.ok(src.includes('loadWorkspaceState'), 'Should import loadWorkspaceState');
  });
});

describe('workspace-state.svelte.js — behavior', () => {
  it('defines STATE_VERSION', () => {
    assert.ok(src.includes('STATE_VERSION = 1'), 'Should define version 1');
  });

  it('defines AUTO_SAVE_DELAY of 60 seconds', () => {
    assert.ok(src.includes('60_000') || src.includes('60000'), 'Should use 60s delay');
  });

  it('notifyChange uses debounce pattern (clearTimeout + setTimeout)', () => {
    assert.ok(src.includes('clearTimeout(autoSaveTimer)'), 'Should clear previous timer');
    assert.ok(src.includes('setTimeout('), 'Should set new timer');
  });

  it('emits workspace-state:capture event before saving', () => {
    assert.ok(src.includes("'workspace-state:capture'"), 'Should emit capture event');
  });

  it('collectState includes version, tabs, activeTabId, groups, layout', () => {
    assert.ok(src.includes('version: STATE_VERSION'), 'Should include version');
    assert.ok(src.includes('tabs: tabsStore.serialize()'), 'Should serialize tabs');
    assert.ok(src.includes('activeTabId: tabsStore.activeTabId'), 'Should store activeTabId');
    assert.ok(src.includes('groups: editorGroupsStore.serialize()'), 'Should serialize groups');
    assert.ok(src.includes('layout: layoutStore.serialize()'), 'Should serialize layout');
  });

  it('restores groups before tabs (order matters)', () => {
    const groupsIdx = src.indexOf('editorGroupsStore.restore(');
    const tabsIdx = src.indexOf('tabsStore.restore(');
    assert.ok(groupsIdx < tabsIdx, 'Should restore groups before tabs');
  });
});
