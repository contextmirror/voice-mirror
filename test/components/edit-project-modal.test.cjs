/**
 * edit-project-modal.test.cjs -- Source-inspection tests for EditProjectModal.svelte
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(__dirname, '../../src/components/sidebar/EditProjectModal.svelte');
let src;
try {
  src = fs.readFileSync(filePath, 'utf-8');
} catch {
  src = '';
}

describe('EditProjectModal.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'EditProjectModal.svelte should exist and have content');
  });

  // ── Imports ──

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports open from @tauri-apps/plugin-dialog', () => {
    assert.ok(src.includes('@tauri-apps/plugin-dialog'), 'Should import plugin-dialog for file picker');
  });

  it('imports saveProjectIcon and removeProjectIcon from api', () => {
    assert.ok(src.includes('saveProjectIcon'), 'Should import saveProjectIcon');
    assert.ok(src.includes('removeProjectIcon'), 'Should import removeProjectIcon');
  });

  // ── Props ──

  it('accepts projectIndex prop', () => {
    assert.ok(src.includes('projectIndex'), 'Should have projectIndex prop');
  });

  it('accepts onClose prop', () => {
    assert.ok(src.includes('onClose'), 'Should have onClose prop');
  });

  // ── UI Structure ──

  it('has modal-overlay class', () => {
    assert.ok(src.includes('modal-overlay'), 'Should have modal-overlay backdrop');
  });

  it('has role="dialog" and aria-modal', () => {
    assert.ok(src.includes('role="dialog"'), 'Should have dialog role');
    assert.ok(src.includes('aria-modal'), 'Should have aria-modal');
  });

  it('has name input field', () => {
    assert.ok(src.includes('field-input'), 'Should have text input for name');
  });

  it('has color swatches', () => {
    assert.ok(src.includes('color-swatches'), 'Should have color swatch container');
    assert.ok(src.includes('swatch'), 'Should have swatch class for color buttons');
  });

  it('has all 8 color values', () => {
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
    for (const c of colors) {
      assert.ok(src.includes(c), `Should have color ${c}`);
    }
  });

  it('has icon preview area', () => {
    assert.ok(src.includes('icon-preview'), 'Should have icon preview button');
  });

  it('has remove icon button', () => {
    assert.ok(src.includes('remove-icon-btn'), 'Should have remove icon button');
  });

  // ── Actions ──

  it('has save and cancel buttons', () => {
    assert.ok(src.includes('btn-save'), 'Should have save button');
    assert.ok(src.includes('btn-cancel'), 'Should have cancel button');
  });

  it('has handleSave function', () => {
    assert.ok(src.includes('handleSave'), 'Should have handleSave handler');
  });

  it('has handleCancel function', () => {
    assert.ok(src.includes('handleCancel'), 'Should have handleCancel handler');
  });

  it('uses updateProjectField for saving', () => {
    assert.ok(src.includes('updateProjectField'), 'Should call updateProjectField on save');
  });

  it('handles Escape key to close', () => {
    assert.ok(src.includes('Escape'), 'Should handle Escape key');
  });

  // ── Styles ──

  it('has scoped style block', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped styles');
  });

  it('disables save when name is empty', () => {
    assert.ok(src.includes('disabled'), 'Should disable save button for empty names');
  });
});
