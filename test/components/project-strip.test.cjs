/**
 * project-strip.test.cjs -- Source-inspection tests for ProjectStrip.svelte
 *
 * Validates imports, UI structure, behavior, and styles of the
 * ProjectStrip component by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(__dirname, '../../src/components/sidebar/ProjectStrip.svelte');
let src;
try {
  src = fs.readFileSync(filePath, 'utf-8');
} catch {
  // File may not exist yet if ui-coder hasn't finished; skip gracefully
  src = '';
}

describe('ProjectStrip.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'ProjectStrip.svelte should exist and have content');
  });

  // ── Imports ──

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports open from @tauri-apps/plugin-dialog', () => {
    assert.ok(src.includes('open'), 'Should import open function');
    assert.ok(src.includes('@tauri-apps/plugin-dialog'), 'Should import from plugin-dialog');
  });

  // ── UI Structure ──

  it('has project-strip CSS class', () => {
    assert.ok(src.includes('project-strip'), 'Should have project-strip class');
  });

  it('has project-avatar class', () => {
    assert.ok(src.includes('project-avatar'), 'Should have project-avatar class');
  });

  it('has active class on selected project avatar', () => {
    assert.ok(src.includes('class:active'), 'Should toggle active class on avatar');
  });

  it('has project-add button', () => {
    assert.ok(src.includes('project-add'), 'Should have project-add button class');
  });

  it('has aria-label for add button', () => {
    assert.ok(
      src.includes('aria-label') && src.includes('Add project'),
      'Should have accessible Add project label'
    );
  });

  // ── Behavior ──

  it('calls open with directory: true for folder picker', () => {
    assert.ok(src.includes('directory: true'), 'Should open directory picker');
  });

  it('calls addProject when directory is selected', () => {
    assert.ok(src.includes('addProject'), 'Should call addProject');
  });

  it('calls setActive when clicking a project', () => {
    assert.ok(src.includes('setActive'), 'Should call setActive on click');
  });

  // ── Context menu ──

  it('has context menu support', () => {
    assert.ok(
      src.includes('contextmenu') || src.includes('context-menu') || src.includes('contextMenu'),
      'Should have context menu handling'
    );
  });

  it('has remove project option', () => {
    assert.ok(src.includes('removeProject'), 'Should have removeProject action');
  });

  // ── Tooltips ──

  it('has data-tooltip for project names', () => {
    assert.ok(src.includes('data-tooltip'), 'Should have tooltip attributes');
  });

  // ── Styles ──

  it('has scoped style block', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped styles');
  });
});
