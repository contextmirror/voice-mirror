const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../../src/lib/clamp-to-viewport.js');

describe('clamp-to-viewport.js', () => {
  it('source file exists', () => {
    assert.ok(fs.existsSync(srcPath), 'src/lib/clamp-to-viewport.js should exist');
  });

  const src = fs.existsSync(srcPath) ? fs.readFileSync(srcPath, 'utf-8') : '';

  it('exports clampToViewport as a named export', () => {
    assert.ok(
      src.includes('export function clampToViewport'),
      'Should export clampToViewport as a named function'
    );
  });

  it('accepts an element parameter and optional pad parameter', () => {
    // function clampToViewport(el, pad = 4)
    assert.match(src, /function clampToViewport\(\s*el\s*,\s*pad\s*=\s*4\s*\)/,
      'Should accept (el, pad = 4) parameters');
  });

  it('reads getBoundingClientRect from the element', () => {
    assert.ok(
      src.includes('getBoundingClientRect()'),
      'Should call getBoundingClientRect() on the element'
    );
  });

  it('clamps bottom overflow using window.innerHeight', () => {
    assert.ok(
      src.includes('rect.bottom > window.innerHeight'),
      'Should check if rect.bottom exceeds window.innerHeight'
    );
    assert.ok(
      src.includes('el.style.top'),
      'Should set el.style.top when bottom overflows'
    );
  });

  it('clamps right overflow using window.innerWidth', () => {
    assert.ok(
      src.includes('rect.right > window.innerWidth'),
      'Should check if rect.right exceeds window.innerWidth'
    );
    assert.ok(
      src.includes('el.style.left'),
      'Should set el.style.left when right overflows'
    );
  });

  it('uses Math.max to ensure element stays within padding', () => {
    const maxCalls = (src.match(/Math\.max\(/g) || []).length;
    assert.ok(maxCalls >= 2, `Should have at least 2 Math.max calls, found ${maxCalls}`);
  });

  it('has JSDoc documentation', () => {
    assert.ok(src.includes('/**'), 'Should have JSDoc comment');
    assert.ok(src.includes('@param'), 'Should have @param tags');
  });
});

describe('clampToViewport consumers', () => {
  const consumers = [
    { file: 'src/components/lens/TabContextMenu.svelte', label: 'TabContextMenu' },
    { file: 'src/components/lens/FileContextMenu.svelte', label: 'FileContextMenu' },
    { file: 'src/components/lens/EditorContextMenu.svelte', label: 'EditorContextMenu' },
    { file: 'src/components/lens/CodeActionsMenu.svelte', label: 'CodeActionsMenu' },
    { file: 'src/components/terminal/TerminalContextMenu.svelte', label: 'TerminalContextMenu' },
    { file: 'src/components/chat/ChatSessionDropdown.svelte', label: 'ChatSessionDropdown' },
    { file: 'src/components/lens/RenameInput.svelte', label: 'RenameInput' },
  ];

  for (const { file, label } of consumers) {
    const fullPath = path.join(__dirname, '../../', file);

    it(`${label} imports clampToViewport`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        content.includes("import { clampToViewport }") ||
        content.includes("import {clampToViewport}"),
        `${label} should import clampToViewport`
      );
    });

    it(`${label} calls clampToViewport() instead of inline getBoundingClientRect`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        content.includes('clampToViewport('),
        `${label} should call clampToViewport()`
      );
      // Should NOT have the inline pattern anymore
      assert.ok(
        !content.includes('getBoundingClientRect'),
        `${label} should no longer have inline getBoundingClientRect`
      );
    });
  }
});
