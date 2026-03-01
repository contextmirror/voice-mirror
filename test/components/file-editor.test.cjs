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

const extSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-extensions.js'),
  'utf-8'
);

const mdPreviewCss = fs.readFileSync(
  path.join(__dirname, '../../src/styles/markdown-preview.css'),
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

describe('FileEditor.svelte: editor extensions extraction', () => {
  it('imports buildEditorExtensions from editor-extensions.js', () => {
    assert.ok(src.includes('buildEditorExtensions'), 'Should import buildEditorExtensions');
    assert.ok(src.includes('editor-extensions.js'), 'Should import from editor-extensions.js');
  });

  it('calls buildEditorExtensions with cm, lsp, and options', () => {
    assert.ok(src.includes('buildEditorExtensions(cm, lsp,'), 'Should call buildEditorExtensions');
  });

  it('editor-extensions.js exports buildEditorExtensions', () => {
    assert.ok(extSrc.includes('export function buildEditorExtensions'), 'Should export buildEditorExtensions');
  });

  it('editor-extensions.js builds basicSetup extension', () => {
    assert.ok(extSrc.includes('cm.basicSetup'), 'Should include basicSetup');
  });

  it('editor-extensions.js delegates multi-cursor to vscodeKeymap', () => {
    assert.ok(extSrc.includes('vscodeKeymap'), 'Should include vscodeKeymap (provides Ctrl+Alt+Arrow multi-cursor)');
  });

  it('editor-extensions.js adds LSP keybindings when LSP active', () => {
    assert.ok(extSrc.includes("'F2'"), 'Should have F2 rename shortcut');
    assert.ok(extSrc.includes("'Shift-F12'"), 'Should have Shift-F12 references shortcut');
    assert.ok(extSrc.includes("'Mod-.'"), 'Should have Mod-. code actions shortcut');
  });

  it('editor-extensions.js adds domEventHandlers', () => {
    assert.ok(extSrc.includes('domEventHandlers'), 'Should add domEventHandlers');
  });
});

describe('editor-extensions.js: CodeMirror minimap', () => {
  it('imports showMinimap from @replit/codemirror-minimap', () => {
    assert.ok(extSrc.includes("import { showMinimap }"), 'Should import showMinimap');
    assert.ok(extSrc.includes('@replit/codemirror-minimap'), 'Should import from @replit/codemirror-minimap');
  });

  it('adds showMinimap.compute to extensions', () => {
    assert.ok(extSrc.includes('showMinimap.compute'), 'Should call showMinimap.compute');
  });

  it('uses blocks display mode', () => {
    assert.ok(extSrc.includes("displayText: 'blocks'"), 'Should use blocks display text');
  });

  it('shows overlay always', () => {
    assert.ok(extSrc.includes("showOverlay: 'always'"), 'Should show overlay always');
  });

  it('creates container with cm-minimap-container class', () => {
    assert.ok(extSrc.includes('cm-minimap-container'), 'Should create container with minimap class');
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
    assert.ok(extSrc.includes('Mod-s'), 'Should have Mod-s save shortcut in editor-extensions.js');
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
    assert.ok(extSrc.includes('docChanged'), 'Should detect document changes in editor-extensions.js');
  });

  it('pins tab on edit', () => {
    assert.ok(src.includes('pinTab'), 'Should pin tab when edited');
  });
});

describe('FileEditor.svelte: language support', () => {
  it('has loadLanguage via shared codemirror-languages.js', () => {
    assert.ok(src.includes('loadLanguage'), 'Should have loadLanguage reference');
    assert.ok(
      src.includes("import { loadLanguageExtension } from '../../lib/codemirror-languages.js'"),
      'Should import loadLanguageExtension from codemirror-languages.js'
    );
  });

  it('delegates language loading to shared module', () => {
    assert.ok(
      src.includes('loadLanguageExtension'),
      'Should use loadLanguageExtension from shared module'
    );
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
      extSrc.includes('cm.autocompletion('),
      'Should add autocompletion to editor extensions in editor-extensions.js'
    );
  });

  it('activates on typing', () => {
    assert.ok(extSrc.includes('activateOnTyping: true'), 'Should activate autocomplete on typing in editor-extensions.js');
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

  it('imports uriToRelativePath from editor-lsp.svelte.js', () => {
    assert.ok(
      src.includes('uriToRelativePath') && src.includes('editor-lsp.svelte.js'),
      'Should import uriToRelativePath from editor-lsp'
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
      extSrc.includes('EditorState.readOnly.of(true)'),
      'Should add readOnly extension when tab is readOnly in editor-extensions.js'
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

describe('FileEditor.svelte: group support', () => {
  it('accepts groupId prop', () => {
    assert.ok(src.includes('groupId'), 'Should accept groupId prop');
  });

  it('defaults groupId to 1', () => {
    assert.ok(
      src.includes('groupId') && (src.includes('= 1') || src.includes('?? 1')),
      'Should default groupId to 1'
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

describe('FileEditor.svelte: markdown preview', () => {
  it('imports renderMarkdown from markdown.js', () => {
    assert.ok(src.includes('renderMarkdown'), 'Should import renderMarkdown');
    assert.ok(src.includes('markdown.js'), 'Should import from markdown.js');
  });

  it('has isMarkdown derived check', () => {
    assert.ok(
      src.includes('isMarkdown') && src.includes('md|markdown'),
      'Should have isMarkdown derived checking .md extension'
    );
  });

  it('has showPreview state defaulting to true', () => {
    assert.ok(
      src.includes('showPreview') && src.includes('$state(true)'),
      'Should have showPreview state defaulting to true'
    );
  });

  it('has markdownContent state for rendered content', () => {
    assert.ok(src.includes('markdownContent'), 'Should have markdownContent state');
  });

  it('has markdown-preview class for preview container', () => {
    assert.ok(src.includes('markdown-preview'), 'Should have markdown-preview class');
  });

  it('has editor-preview-toolbar class', () => {
    assert.ok(src.includes('editor-preview-toolbar'), 'Should have editor-preview-toolbar class');
  });

  it('uses @html to render markdown', () => {
    assert.ok(
      src.includes('{@html renderMarkdown('),
      'Should use @html directive to render markdown'
    );
  });

  it('has preview toggle buttons', () => {
    assert.ok(src.includes('preview-btn'), 'Should have preview toggle buttons');
  });

  it('hides editor when preview is active', () => {
    assert.ok(
      src.includes('file-editor') && src.includes('hidden'),
      'Should hide editor when preview is shown'
    );
  });
});

describe('FileEditor.svelte: markdown preview styles', () => {
  it('imports markdown-preview.css', () => {
    assert.ok(
      src.includes("@import '../../styles/markdown-preview.css'"),
      'Should import markdown-preview.css in style block'
    );
  });

  it('has table styling in markdown-preview', () => {
    assert.ok(
      mdPreviewCss.includes('.markdown-preview') && mdPreviewCss.includes('border-collapse'),
      'Should style tables in markdown preview'
    );
  });

  it('has heading styles', () => {
    assert.ok(
      mdPreviewCss.includes(':global(h1)') && mdPreviewCss.includes(':global(h2)'),
      'Should have heading styles in markdown preview'
    );
  });

  it('has code block styling', () => {
    assert.ok(
      mdPreviewCss.includes('.markdown-preview') && mdPreviewCss.includes(':global(pre)'),
      'Should have code block styles in preview'
    );
  });

  it('has blockquote styling', () => {
    assert.ok(
      mdPreviewCss.includes('.markdown-preview') && mdPreviewCss.includes(':global(blockquote)'),
      'Should have blockquote styles in preview'
    );
  });

  it('has list styling', () => {
    assert.ok(
      mdPreviewCss.includes('.markdown-preview') && mdPreviewCss.includes(':global(ul)'),
      'Should have list styles in preview'
    );
  });

  it('has collapsible code block support', () => {
    assert.ok(
      mdPreviewCss.includes('.markdown-preview') && mdPreviewCss.includes('code-collapse'),
      'Should have collapsible code block styles'
    );
  });
});

describe('FileEditor.svelte: markdown preview config', () => {
  it('imports configStore', () => {
    assert.ok(src.includes('configStore'), 'Should import configStore');
  });

  it('derives markdownPreviewDefault from config', () => {
    assert.ok(
      src.includes('markdownPreviewDefault') && src.includes('editor?.markdownPreview'),
      'Should derive preview default from editor config'
    );
  });

  it('resets showPreview to config default on file load', () => {
    const loadStart = src.indexOf('async function loadFile');
    const chunk = src.slice(loadStart, loadStart + 1200);
    assert.ok(
      chunk.includes('showPreview = markdownPreviewDefault'),
      'Should reset showPreview to config default when loading a new file'
    );
  });
});

describe('editor-extensions.js: indentWithTab', () => {
  it('imports indentWithTab from @codemirror/commands', () => {
    assert.ok(
      extSrc.includes("import { indentWithTab } from '@codemirror/commands'"),
      'Should import indentWithTab from @codemirror/commands'
    );
  });

  it('includes indentWithTab in keymap', () => {
    assert.ok(
      extSrc.includes('indentWithTab'),
      'Should include indentWithTab in keymap'
    );
  });
});

describe('editor-extensions.js: F12 go-to-definition', () => {
  it('has F12 keybinding for go-to-definition', () => {
    assert.ok(
      extSrc.includes("'F12'"),
      'Should have F12 keybinding'
    );
  });

  it('calls handleGoToDefinition on F12', () => {
    assert.ok(
      extSrc.includes('lsp.handleGoToDefinition(v, v.state.selection.main.head)'),
      'Should call lsp.handleGoToDefinition with cursor position on F12'
    );
  });
});

describe('editor-extensions.js: font zoom keybindings', () => {
  it('accepts onFontZoom option', () => {
    assert.ok(
      extSrc.includes('onFontZoom'),
      'Should accept onFontZoom callback option'
    );
  });

  it('has Ctrl+= for zoom in', () => {
    assert.ok(
      extSrc.includes("'Ctrl-='"),
      'Should have Ctrl+= keybinding for zoom in'
    );
  });

  it('has Ctrl+- for zoom out', () => {
    assert.ok(
      extSrc.includes("'Ctrl--'"),
      'Should have Ctrl+- keybinding for zoom out'
    );
  });

  it('has Ctrl+0 for zoom reset', () => {
    assert.ok(
      extSrc.includes("'Ctrl-0'"),
      'Should have Ctrl+0 keybinding for zoom reset'
    );
  });

  it('calls onFontZoom with delta values', () => {
    assert.ok(
      extSrc.includes('onFontZoom(1)') && extSrc.includes('onFontZoom(-1)') && extSrc.includes('onFontZoom(0)'),
      'Should call onFontZoom with +1 (zoom in), -1 (zoom out), and 0 (reset)'
    );
  });

  it('conditionally adds zoom bindings only when onFontZoom is provided', () => {
    assert.ok(
      extSrc.includes('onFontZoom ?'),
      'Should only add zoom keybindings when onFontZoom callback is provided'
    );
  });
});

describe('FileEditor.svelte: font zoom integration', () => {
  it('imports updateConfig from config store', () => {
    assert.ok(
      src.includes('updateConfig') && src.includes('config.svelte.js'),
      'Should import updateConfig from config store'
    );
  });

  it('has handleFontZoom function', () => {
    assert.ok(
      src.includes('function handleFontZoom'),
      'Should have handleFontZoom function'
    );
  });

  it('applies --cm-font-size CSS variable', () => {
    assert.ok(
      src.includes('--cm-font-size'),
      'Should set --cm-font-size CSS variable on editor element'
    );
  });

  it('has min and max font size bounds', () => {
    assert.ok(
      src.includes('MIN_FONT_SIZE') && src.includes('MAX_FONT_SIZE'),
      'Should clamp font size to min/max bounds'
    );
  });

  it('passes onFontZoom to buildEditorExtensions', () => {
    assert.ok(
      src.includes('onFontZoom:'),
      'Should pass onFontZoom callback to buildEditorExtensions'
    );
  });
});

describe('FileEditor.svelte: markdown link safety', () => {
  it('imports open from @tauri-apps/plugin-shell', () => {
    assert.ok(
      src.includes("import { open } from '@tauri-apps/plugin-shell'"),
      'Should import shell open for external links'
    );
  });

  it('intercepts link clicks in markdown preview', () => {
    assert.ok(
      src.includes("closest('a[href]')"),
      'Should use closest to find clicked links'
    );
  });

  it('opens external links via shell open', () => {
    const previewStart = src.indexOf('markdown-preview');
    const chunk = src.slice(previewStart, previewStart + 500);
    assert.ok(
      chunk.includes('open(href)'),
      'Should open links with Tauri shell'
    );
  });

  it('only opens http/https links externally', () => {
    assert.ok(
      src.includes("href.startsWith('http://')") || src.includes("href.startsWith('https://')"),
      'Should only open http/https links'
    );
  });

  it('prevents default navigation on link click', () => {
    const previewStart = src.indexOf('markdown-preview');
    const chunk = src.slice(previewStart, previewStart + 500);
    assert.ok(
      chunk.includes('e.preventDefault()'),
      'Should prevent default link navigation'
    );
  });
});

describe('FileEditor.svelte: pendingCursorPosition', () => {
  it('imports tabsStore for pending cursor', () => {
    assert.ok(
      src.includes('tabsStore') && src.includes('pendingCursorPosition'),
      'Should check tabsStore.pendingCursorPosition'
    );
  });

  it('dispatches cursor position from pending', () => {
    assert.ok(src.includes('clearPendingCursor'), 'Should clear pending cursor after applying');
  });

  it('uses scrollIntoView when applying pending cursor', () => {
    assert.ok(src.includes('scrollIntoView'), 'Should scroll to the cursor position');
  });
});
