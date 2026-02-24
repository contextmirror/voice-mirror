/**
 * codemirror-languages.test.cjs -- Source-inspection tests for the shared
 * CodeMirror language loader utility.
 *
 * Verifies the exported function, supported extensions, and import usage
 * by both FileEditor and DiffViewer.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/codemirror-languages.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

const EDITOR_PATH = path.join(__dirname, '../../src/components/lens/FileEditor.svelte');
const editorSrc = fs.readFileSync(EDITOR_PATH, 'utf-8');

const DIFF_PATH = path.join(__dirname, '../../src/components/lens/DiffViewer.svelte');
const diffSrc = fs.readFileSync(DIFF_PATH, 'utf-8');

describe('codemirror-languages.js -- exports', () => {
  it('exports loadLanguageExtension as an async function', () => {
    assert.ok(
      src.includes('export async function loadLanguageExtension('),
      'Should export async function loadLanguageExtension()'
    );
  });

  it('accepts a filePath parameter', () => {
    assert.ok(
      src.includes('loadLanguageExtension(filePath)'),
      'Should accept filePath parameter'
    );
  });
});

describe('codemirror-languages.js -- supported extensions', () => {
  const extensions = [
    { cases: "'js': case 'jsx': case 'mjs': case 'cjs'", lang: '@codemirror/lang-javascript' },
    { cases: "'ts': case 'tsx'", lang: '@codemirror/lang-javascript' },
    { cases: "'rs'", lang: '@codemirror/lang-rust' },
    { cases: "'css': case 'scss'", lang: '@codemirror/lang-css' },
    { cases: "'html': case 'svelte'", lang: '@codemirror/lang-html' },
    { cases: "'json'", lang: '@codemirror/lang-json' },
    { cases: "'md': case 'markdown'", lang: '@codemirror/lang-markdown' },
    { cases: "'py': case 'python'", lang: '@codemirror/lang-python' },
  ];

  for (const { cases, lang } of extensions) {
    it(`handles ${cases} via ${lang}`, () => {
      assert.ok(src.includes(cases), `Should have case for ${cases}`);
      assert.ok(src.includes(lang), `Should import from ${lang}`);
    });
  }

  it('returns empty array for unknown extensions', () => {
    assert.ok(
      src.includes('default:') && src.includes('return []'),
      'Should return empty array for unknown extensions'
    );
  });
});

describe('codemirror-languages.js -- TypeScript handling', () => {
  it('passes typescript: true for .ts/.tsx files', () => {
    assert.ok(
      src.includes('typescript: true'),
      'Should enable typescript mode for .ts/.tsx'
    );
  });
});

describe('codemirror-languages.js -- error handling', () => {
  it('catches errors and returns empty array', () => {
    assert.ok(
      src.includes('catch (err)'),
      'Should have catch block'
    );
    // After catch, it should return []
    const catchIndex = src.indexOf('catch (err)');
    const afterCatch = src.slice(catchIndex, catchIndex + 200);
    assert.ok(
      afterCatch.includes('return []'),
      'Should return empty array on error'
    );
  });
});

describe('codemirror-languages.js -- consumers', () => {
  it('FileEditor imports loadLanguageExtension', () => {
    assert.ok(
      editorSrc.includes("import { loadLanguageExtension } from '../../lib/codemirror-languages.js'"),
      'FileEditor should import loadLanguageExtension from codemirror-languages.js'
    );
  });

  it('DiffViewer imports loadLanguageExtension', () => {
    assert.ok(
      diffSrc.includes("import { loadLanguageExtension } from '../../lib/codemirror-languages.js'"),
      'DiffViewer should import loadLanguageExtension from codemirror-languages.js'
    );
  });

  it('FileEditor does NOT have inline language switch block', () => {
    // Should not have the full switch cases inline anymore
    assert.ok(
      !editorSrc.includes("@codemirror/lang-javascript"),
      'FileEditor should not have inline @codemirror/lang-javascript import'
    );
  });

  it('DiffViewer does NOT have inline language switch block', () => {
    assert.ok(
      !diffSrc.includes("@codemirror/lang-javascript"),
      'DiffViewer should not have inline @codemirror/lang-javascript import'
    );
  });
});
