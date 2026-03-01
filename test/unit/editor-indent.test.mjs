/**
 * editor-indent.mjs -- Unit tests for detectIndentation and convertIndentation.
 *
 * Direct ES module import tests (pure functions, no Svelte runes).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectIndentation, convertIndentation } from '../../src/lib/editor-extensions.js';

// ── detectIndentation ────────────────────────────────────────────────

describe('detectIndentation', () => {
  it('detects 2-space indentation', () => {
    const text = `function foo() {\n  return 1;\n  if (true) {\n    bar();\n  }\n}`;
    const result = detectIndentation(text);
    assert.equal(result.type, 'spaces');
    assert.equal(result.size, 2);
  });

  it('detects 4-space indentation', () => {
    const text = `function foo() {\n    return 1;\n    if (true) {\n        bar();\n    }\n}`;
    const result = detectIndentation(text);
    assert.equal(result.type, 'spaces');
    assert.equal(result.size, 4);
  });

  it('detects tab indentation', () => {
    const text = `function foo() {\n\treturn 1;\n\tif (true) {\n\t\tbar();\n\t}\n}`;
    const result = detectIndentation(text);
    assert.equal(result.type, 'tabs');
  });

  it('returns spaces default for empty content', () => {
    const result = detectIndentation('');
    assert.equal(result.type, 'spaces');
    assert.equal(result.size, 2);
  });

  it('returns spaces default for flat code (no indentation)', () => {
    const text = `const a = 1;\nconst b = 2;\nconst c = 3;`;
    const result = detectIndentation(text);
    assert.equal(result.type, 'spaces');
  });

  it('handles mixed but space-dominant', () => {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push('    code();\n');
    lines.push('\tcode();\n');
    const result = detectIndentation(lines.join(''));
    assert.equal(result.type, 'spaces');
    assert.equal(result.size, 4);
  });

  it('handles mixed but tab-dominant', () => {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push('\tcode();\n');
    lines.push('    code();\n');
    const result = detectIndentation(lines.join(''));
    assert.equal(result.type, 'tabs');
  });
});

// ── convertIndentation ───────────────────────────────────────────────

describe('convertIndentation', () => {
  it('converts tabs to 2 spaces', () => {
    const input = `\tline1\n\t\tline2\nline3`;
    const result = convertIndentation(input, 'spaces', 2);
    assert.equal(result, `  line1\n    line2\nline3`);
  });

  it('converts tabs to 4 spaces', () => {
    const input = `\tline1\n\t\tline2`;
    const result = convertIndentation(input, 'spaces', 4);
    assert.equal(result, `    line1\n        line2`);
  });

  it('converts 4 spaces to tabs', () => {
    const input = `    line1\n        line2\nline3`;
    const result = convertIndentation(input, 'tabs', 4);
    assert.equal(result, `\tline1\n\t\tline2\nline3`);
  });

  it('converts 2 spaces to tabs', () => {
    const input = `  line1\n    line2`;
    const result = convertIndentation(input, 'tabs', 2);
    assert.equal(result, `\tline1\n\t\tline2`);
  });

  it('preserves lines with no indentation', () => {
    const input = `line1\nline2`;
    const result = convertIndentation(input, 'tabs', 2);
    assert.equal(result, `line1\nline2`);
  });

  it('preserves content after indentation', () => {
    const input = `\tconst x = 1;`;
    const result = convertIndentation(input, 'spaces', 4);
    assert.equal(result, `    const x = 1;`);
  });
});
