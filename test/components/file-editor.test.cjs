/**
 * file-editor.test.cjs -- Source-inspection tests for FileEditor.svelte
 *
 * Validates the CodeMirror-based file editor component.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/FileEditor.svelte'),
  'utf-8'
);

describe('FileEditor.svelte', () => {
  it('has file-editor CSS class', () => {
    assert.ok(src.includes('file-editor'), 'Should have file-editor class');
  });

  it('imports readFile and writeFile from api', () => {
    assert.ok(src.includes('readFile'), 'Should import readFile');
    assert.ok(src.includes('writeFile'), 'Should import writeFile');
  });

  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('accepts tab prop', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('tab'), 'Should accept tab prop');
  });

  it('has loading state', () => {
    assert.ok(src.includes('loading'), 'Should have loading state');
  });

  it('has error state', () => {
    assert.ok(src.includes('error'), 'Should have error state');
  });
});

describe('FileEditor.svelte: CodeMirror integration', () => {
  it('dynamically imports codemirror', () => {
    assert.ok(
      src.includes("import('codemirror')") || src.includes("import( 'codemirror')"),
      'Should lazy-load codemirror'
    );
  });

  it('imports @codemirror/state', () => {
    assert.ok(src.includes('@codemirror/state'), 'Should import codemirror state');
  });

  it('imports @codemirror/view', () => {
    assert.ok(src.includes('@codemirror/view'), 'Should import codemirror view');
  });

  it('uses oneDark theme', () => {
    assert.ok(src.includes('oneDark'), 'Should use oneDark theme');
  });

  it('creates EditorView', () => {
    assert.ok(src.includes('EditorView'), 'Should create EditorView');
  });

  it('creates EditorState', () => {
    assert.ok(src.includes('EditorState'), 'Should create EditorState');
  });

  it('has Mod-s keymap for save', () => {
    assert.ok(src.includes('Mod-s'), 'Should have Mod-s save shortcut');
  });

  it('destroys view on cleanup', () => {
    assert.ok(src.includes('view?.destroy()'), 'Should clean up EditorView');
  });
});

describe('FileEditor.svelte: save functionality', () => {
  it('has save function', () => {
    assert.ok(src.includes('save'), 'Should have save function');
  });

  it('gets doc content as string', () => {
    assert.ok(src.includes('doc.toString()'), 'Should get doc content');
  });

  it('calls writeFile on save', () => {
    assert.ok(src.includes('writeFile('), 'Should call writeFile');
  });

  it('clears dirty flag after save', () => {
    assert.ok(src.includes('setDirty'), 'Should clear dirty flag');
  });
});

describe('FileEditor.svelte: dirty tracking', () => {
  it('marks tab dirty on doc change', () => {
    assert.ok(src.includes('docChanged'), 'Should detect document changes');
  });

  it('pins tab on edit', () => {
    assert.ok(src.includes('pinTab'), 'Should pin tab when edited');
  });
});

describe('FileEditor.svelte: language support', () => {
  it('has language loading function', () => {
    assert.ok(src.includes('loadLanguage'), 'Should have loadLanguage function');
  });

  it('supports JavaScript', () => {
    assert.ok(src.includes('@codemirror/lang-javascript'), 'Should support JS');
  });

  it('supports TypeScript', () => {
    assert.ok(src.includes('typescript: true'), 'Should support TS');
  });

  it('supports Rust', () => {
    assert.ok(src.includes('@codemirror/lang-rust'), 'Should support Rust');
  });

  it('supports CSS', () => {
    assert.ok(src.includes('@codemirror/lang-css'), 'Should support CSS');
  });

  it('supports HTML', () => {
    assert.ok(src.includes('@codemirror/lang-html'), 'Should support HTML');
  });

  it('supports JSON', () => {
    assert.ok(src.includes('@codemirror/lang-json'), 'Should support JSON');
  });

  it('supports Markdown', () => {
    assert.ok(src.includes('@codemirror/lang-markdown'), 'Should support Markdown');
  });

  it('supports Python', () => {
    assert.ok(src.includes('@codemirror/lang-python'), 'Should support Python');
  });
});

describe('FileEditor.svelte: autocomplete', () => {
  it('imports @codemirror/autocomplete', () => {
    assert.ok(src.includes('@codemirror/autocomplete'), 'Should import autocomplete package');
  });

  it('imports autocompletion function', () => {
    assert.ok(src.includes('autocompletion'), 'Should import autocompletion');
  });

  it('enables autocomplete in extensions', () => {
    assert.ok(
      src.includes('cm.autocompletion('),
      'Should add autocompletion to editor extensions'
    );
  });

  it('activates on typing', () => {
    assert.ok(src.includes('activateOnTyping: true'), 'Should activate autocomplete on typing');
  });
});

describe('FileEditor.svelte: lifecycle', () => {
  it('uses $effect to react to tab changes', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for reactive loading');
  });

  it('caches CodeMirror modules', () => {
    assert.ok(src.includes('cmCache'), 'Should cache CM modules');
  });

  it('uses onDestroy', () => {
    assert.ok(src.includes('onDestroy'), 'Should use onDestroy');
  });

  it('has loading UI', () => {
    assert.ok(src.includes('editor-loading'), 'Should show loading state');
  });

  it('has error UI', () => {
    assert.ok(src.includes('editor-error'), 'Should show error state');
  });

  it('overrides CodeMirror height to fill space', () => {
    assert.ok(src.includes('.cm-editor'), 'Should override cm-editor height');
  });
});
