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

  it('uses custom Voice Mirror editor theme', () => {
    assert.ok(src.includes('voiceMirrorEditorTheme'), 'Should use voiceMirrorEditorTheme');
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

describe('FileEditor.svelte: go-to-definition navigation', () => {
  it('wraps path in object for openFile with readOnly/external flags', () => {
    // BUG-002 fix: openFile expects { name, path }, not a raw string
    // External file support: passes readOnly and external flags
    assert.ok(
      src.includes('tabsStore.openFile({ name: fileName, path: resolved.path, readOnly: resolved.external, external: resolved.external })'),
      'Should pass { name, path, readOnly, external } object to openFile'
    );
  });

  it('extracts filename from path for tab title', () => {
    assert.ok(
      src.includes(".split(/[/\\\\]/).pop()"),
      'Should extract filename from path for display'
    );
  });
});

describe('FileEditor.svelte: external file support', () => {
  it('imports readExternalFile from api', () => {
    assert.ok(src.includes('readExternalFile'), 'Should import readExternalFile');
  });

  it('uriToRelativePath returns { path, external } object', () => {
    assert.ok(
      src.includes('external: false') && src.includes('external: true'),
      'Should distinguish internal vs external paths'
    );
  });

  it('checks tab.external flag to choose read method', () => {
    assert.ok(
      src.includes('isExternal') && src.includes('tab?.external'),
      'Should check external flag'
    );
  });

  it('uses readExternalFile for external files', () => {
    assert.ok(
      src.includes('readExternalFile(filePath)'),
      'Should call readExternalFile for external files'
    );
  });

  it('disables LSP for external files', () => {
    assert.ok(
      src.includes('!isExternal && LSP_EXTENSIONS'),
      'Should skip LSP for external files'
    );
  });

  it('applies readOnly extension for read-only tabs', () => {
    assert.ok(
      src.includes('EditorState.readOnly.of(true)'),
      'Should add readOnly extension when tab is readOnly'
    );
  });

  it('shows read-only banner for readOnly tabs', () => {
    assert.ok(src.includes('readonly-banner'), 'Should have readonly-banner class');
    assert.ok(
      src.includes("tab?.readOnly"),
      'Should conditionally show banner for readOnly tabs'
    );
  });

  it('shows external file label in banner', () => {
    assert.ok(
      src.includes('external file'),
      'Should show external file label'
    );
  });

  it('has lock icon in read-only banner', () => {
    // Lock icon SVG: rect for body + path for shackle
    const bannerIdx = src.indexOf('readonly-banner');
    const chunk = src.slice(bannerIdx, bannerIdx + 300);
    assert.ok(
      chunk.includes('M7 11V7a5 5 0 0 1 10 0v4'),
      'Should have lock icon SVG path'
    );
  });
});

describe('FileEditor.svelte: conflict detection', () => {
  it('has conflictDetected state', () => {
    assert.ok(src.includes('conflictDetected'), 'Should have conflict detection state');
  });

  it('sets conflictDetected when file changes on dirty tab', () => {
    assert.ok(
      src.includes('conflictDetected = true'),
      'Should set conflict flag when external change detected on dirty tab'
    );
  });

  it('has reloadFromDisk function', () => {
    assert.ok(src.includes('async function reloadFromDisk'), 'Should have reload function');
  });

  it('has dismissConflict function', () => {
    assert.ok(src.includes('function dismissConflict'), 'Should have dismiss function');
  });

  it('shows conflict banner UI', () => {
    assert.ok(src.includes('conflict-banner'), 'Should have conflict banner CSS class');
  });

  it('has Reload button', () => {
    assert.ok(src.includes('conflict-reload'), 'Should have reload button');
  });

  it('has Dismiss button', () => {
    assert.ok(src.includes('conflict-dismiss'), 'Should have dismiss button');
  });

  it('displays file changed message', () => {
    assert.ok(
      src.includes('File changed on disk'),
      'Should show descriptive conflict message'
    );
  });

  it('reloadFromDisk clears conflict and dirty flags', () => {
    const fnStart = src.indexOf('async function reloadFromDisk');
    const chunk = src.slice(fnStart, fnStart + 700);
    assert.ok(chunk.includes('conflictDetected = false'), 'Should clear conflict after reload');
    assert.ok(chunk.includes('setDirty'), 'Should clear dirty flag after reload');
  });
});

describe('FileEditor.svelte: gutter context menu fallback (BUG-004)', () => {
  it('has oncontextmenu handler on .file-editor container', () => {
    assert.ok(
      src.includes('oncontextmenu='),
      'Should have oncontextmenu fallback on container div'
    );
  });

  it('skips fallback when CM handler already fired', () => {
    assert.ok(
      src.includes('if (editorMenu.visible) return'),
      'Should skip fallback when editor menu is already visible'
    );
  });

  it('tries posAtCoords for line resolution', () => {
    // The fallback handler resolves line number from click coordinates
    const handlerStart = src.indexOf('oncontextmenu=');
    const chunk = src.slice(handlerStart, handlerStart + 800);
    assert.ok(
      chunk.includes('posAtCoords'),
      'Should attempt posAtCoords in fallback handler'
    );
  });

  it('falls back to lineBlockAtHeight for gutter clicks', () => {
    const handlerStart = src.indexOf('oncontextmenu=');
    const chunk = src.slice(handlerStart, handlerStart + 1200);
    assert.ok(
      chunk.includes('lineBlockAtHeight'),
      'Should try lineBlockAtHeight as secondary line resolution'
    );
  });

  it('checks diagnostics by line number for gutter markers', () => {
    const handlerStart = src.indexOf('oncontextmenu=');
    const chunk = src.slice(handlerStart, handlerStart + 1500);
    assert.ok(
      chunk.includes('cachedDiagnostics'),
      'Should check cached diagnostics in fallback handler'
    );
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
