const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../../src/lib/popup-utils.js');

describe('popup-utils.js', () => {
  it('source file exists', () => {
    assert.ok(fs.existsSync(srcPath), 'src/lib/popup-utils.js should exist');
  });

  const src = fs.existsSync(srcPath) ? fs.readFileSync(srcPath, 'utf-8') : '';

  it('exports setupClickOutside as a named export', () => {
    assert.ok(
      src.includes('export function setupClickOutside'),
      'Should export setupClickOutside as a named function'
    );
  });

  it('accepts (el, onClose) parameters', () => {
    assert.match(src, /function setupClickOutside\(\s*el\s*,\s*onClose\s*\)/,
      'Should accept (el, onClose) parameters');
  });

  it('adds capture-phase mousedown listener on document', () => {
    assert.ok(
      src.includes("document.addEventListener('mousedown'"),
      'Should add mousedown listener on document'
    );
    // Verify capture phase (third arg = true)
    assert.match(src, /addEventListener\('mousedown',\s*\w+,\s*true\)/,
      'mousedown listener should use capture phase (third arg true)');
  });

  it('adds capture-phase keydown listener on document', () => {
    assert.ok(
      src.includes("document.addEventListener('keydown'"),
      'Should add keydown listener on document'
    );
    assert.match(src, /addEventListener\('keydown',\s*\w+,\s*true\)/,
      'keydown listener should use capture phase (third arg true)');
  });

  it('checks el.contains(e.target) for click-outside detection', () => {
    assert.ok(
      src.includes('el.contains(e.target)'),
      'Should check el.contains(e.target) to detect outside clicks'
    );
  });

  it('handles Escape key with preventDefault', () => {
    assert.ok(
      src.includes("e.key === 'Escape'"),
      'Should check for Escape key'
    );
    assert.ok(
      src.includes('e.preventDefault()'),
      'Should call e.preventDefault() on Escape'
    );
  });

  it('returns a cleanup function that removes both listeners', () => {
    assert.ok(
      src.includes("document.removeEventListener('mousedown'"),
      'Cleanup should remove mousedown listener'
    );
    assert.ok(
      src.includes("document.removeEventListener('keydown'"),
      'Cleanup should remove keydown listener'
    );
    // The return value should be a function
    assert.match(src, /return\s*\(\)\s*=>\s*\{/,
      'Should return an arrow function for cleanup');
  });

  it('has JSDoc documentation', () => {
    assert.ok(src.includes('/**'), 'Should have JSDoc comment');
    assert.ok(src.includes('@param'), 'Should have @param tags');
    assert.ok(src.includes('@returns'), 'Should have @returns tag');
  });
});

describe('setupClickOutside consumers', () => {
  const consumers = [
    { file: 'src/components/lens/TabContextMenu.svelte', label: 'TabContextMenu', closeFn: 'close' },
    { file: 'src/components/lens/FileContextMenu.svelte', label: 'FileContextMenu', closeFn: 'close' },
    { file: 'src/components/lens/EditorContextMenu.svelte', label: 'EditorContextMenu', closeFn: 'close' },
    { file: 'src/components/lens/CodeActionsMenu.svelte', label: 'CodeActionsMenu', closeFn: 'onClose' },
  ];

  for (const { file, label, closeFn } of consumers) {
    const fullPath = path.join(__dirname, '../../', file);

    it(`${label} imports setupClickOutside`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        content.includes("import { setupClickOutside }") ||
        content.includes("import {setupClickOutside}"),
        `${label} should import setupClickOutside`
      );
    });

    it(`${label} calls setupClickOutside(menuEl, ${closeFn})`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        content.includes(`setupClickOutside(menuEl, ${closeFn})`),
        `${label} should call setupClickOutside(menuEl, ${closeFn})`
      );
    });

    it(`${label} does not have inline handleClickOutside function`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        !content.includes('function handleClickOutside'),
        `${label} should no longer have inline handleClickOutside function`
      );
    });

    it(`${label} does not have inline click-outside addEventListener`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        !content.includes("document.addEventListener('mousedown', handleClickOutside"),
        `${label} should no longer have inline mousedown addEventListener`
      );
    });
  }
});
