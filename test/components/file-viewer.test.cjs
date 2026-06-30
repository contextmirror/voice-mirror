/**
 * file-viewer.test.cjs -- Source-inspection tests for the multi-format file viewer.
 *
 * Covers the viewer-type resolver, the FileViewer router, and each sub-viewer
 * (Image / Pdf / Office / Binary). Svelte components can't be imported in Node,
 * so we read source and assert on structure. The resolver is plain JS and IS
 * exercised directly.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LENS_DIR = path.join(__dirname, '../../src/components/lens');
const LIB_DIR = path.join(__dirname, '../../src/lib');

function readComponent(name) {
  return fs.readFileSync(path.join(LENS_DIR, name), 'utf-8');
}
function readLib(name) {
  return fs.readFileSync(path.join(LIB_DIR, name), 'utf-8');
}

// ---- viewer-type.js resolver (executed directly) ----

describe('viewer-type.js -- resolveViewerType', () => {
  const { resolveViewerType } = require('../../src/lib/viewer-type.js');

  it('resolves images', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']) {
      assert.equal(resolveViewerType(`a.${ext}`), 'image', `${ext} should be image`);
    }
  });

  it('resolves pdf', () => {
    assert.equal(resolveViewerType('doc.pdf'), 'pdf');
    assert.equal(resolveViewerType('DOC.PDF'), 'pdf', 'should be case-insensitive');
  });

  it('resolves office (doc/docx)', () => {
    assert.equal(resolveViewerType('report.docx'), 'office');
    assert.equal(resolveViewerType('report.doc'), 'office');
  });

  it('resolves known binary types', () => {
    for (const ext of ['zip', 'exe', 'dll', 'mp4', 'ttf', 'xlsx', 'sqlite']) {
      assert.equal(resolveViewerType(`a.${ext}`), 'binary', `${ext} should be binary`);
    }
  });

  it('defaults unknown / code-ish files to text', () => {
    assert.equal(resolveViewerType('main.rs'), 'text');
    assert.equal(resolveViewerType('app.svelte'), 'text');
    assert.equal(resolveViewerType('weird.xyz'), 'text');
    assert.equal(resolveViewerType('Makefile'), 'text', 'no extension → text');
    assert.equal(resolveViewerType('.gitignore'), 'text', 'dotfile → text');
    assert.equal(resolveViewerType('untitled:1'), 'text', 'untitled → text');
  });

  it('handles empty / nullish input safely', () => {
    assert.equal(resolveViewerType(''), 'text');
    assert.equal(resolveViewerType(null), 'text');
    assert.equal(resolveViewerType(undefined), 'text');
  });

  it('exports the extension sets', () => {
    const src = readLib('viewer-type.js');
    assert.ok(src.includes('IMAGE_EXTS'), 'exports IMAGE_EXTS');
    assert.ok(src.includes('PDF_EXTS'), 'exports PDF_EXTS');
    assert.ok(src.includes('OFFICE_EXTS'), 'exports OFFICE_EXTS');
    assert.ok(src.includes('BINARY_EXTS'), 'exports BINARY_EXTS');
  });
});

// ---- FileViewer.svelte (router) ----

describe('FileViewer.svelte -- router', () => {
  const src = readComponent('FileViewer.svelte');

  it('imports resolveViewerType', () => {
    assert.ok(src.includes("from '../../lib/viewer-type.js'"), 'imports the resolver');
    assert.ok(src.includes('resolveViewerType'), 'uses resolveViewerType');
  });

  it('imports every sub-viewer', () => {
    assert.ok(src.includes("import FileEditor from './FileEditor.svelte'"), 'FileEditor');
    assert.ok(src.includes("import ImageViewer from './ImageViewer.svelte'"), 'ImageViewer');
    assert.ok(src.includes("import PdfViewer from './PdfViewer.svelte'"), 'PdfViewer');
    assert.ok(src.includes("import OfficeViewer from './OfficeViewer.svelte'"), 'OfficeViewer');
    assert.ok(src.includes("import BinaryFilePanel from './BinaryFilePanel.svelte'"), 'BinaryFilePanel');
  });

  it('routes each viewer type', () => {
    assert.ok(src.includes("viewerType === 'image'"), 'image branch');
    assert.ok(src.includes("viewerType === 'pdf'"), 'pdf branch');
    assert.ok(src.includes("viewerType === 'office'"), 'office branch');
    assert.ok(src.includes("viewerType === 'binary'"), 'binary branch');
    assert.ok(src.includes('<FileEditor'), 'falls back to FileEditor for text');
  });

  it('derives viewerType from tab.path', () => {
    assert.ok(src.includes('resolveViewerType(tab?.path)'), 'derives from tab.path');
  });
});

// ---- EditorPane wiring ----

describe('EditorPane.svelte -- routes file tabs through FileViewer', () => {
  const src = readComponent('EditorPane.svelte');

  it('imports FileViewer (not FileEditor directly)', () => {
    assert.ok(src.includes("import FileViewer from './FileViewer.svelte'"), 'imports FileViewer');
    assert.ok(!src.includes("import FileEditor from './FileEditor.svelte'"), 'no direct FileEditor import');
  });

  it('renders FileViewer for type:file tabs', () => {
    assert.ok(src.includes("activeTab?.type === 'file'"), 'checks file type');
    assert.ok(src.includes('<FileViewer tab={activeTab}'), 'renders FileViewer');
  });
});

// ---- ImageViewer.svelte ----

describe('ImageViewer.svelte', () => {
  const src = readComponent('ImageViewer.svelte');

  it('uses readFile for the data URL', () => {
    assert.ok(src.includes('readFile'), 'reads via readFile');
    assert.ok(src.includes('dataUrl'), 'uses the dataUrl field');
  });

  it('renders an img on a checkerboard', () => {
    assert.ok(src.includes('<img'), 'has an img');
    assert.ok(src.includes('checkerboard'), 'checkerboard background');
  });

  it('falls back to BinaryFilePanel on failure', () => {
    assert.ok(src.includes('BinaryFilePanel'), 'has a binary fallback');
  });
});

// ---- PdfViewer.svelte ----

describe('PdfViewer.svelte', () => {
  const src = readComponent('PdfViewer.svelte');

  it('uses readFileBase64', () => {
    assert.ok(src.includes('readFileBase64'), 'reads base64 bytes');
  });

  it('builds a blob URL and points an iframe at it', () => {
    assert.ok(src.includes('new Blob('), 'creates a Blob');
    assert.ok(src.includes('createObjectURL'), 'creates an object URL');
    assert.ok(src.includes('<iframe'), 'renders an iframe');
    assert.ok(src.includes('application/pdf'), 'pdf mime');
  });

  it('revokes the object URL on cleanup', () => {
    assert.ok(src.includes('revokeObjectURL'), 'revokes the URL');
  });

  it('offers an "Open in default app" fallback', () => {
    assert.ok(src.includes("from '@tauri-apps/plugin-shell'"), 'imports shell open');
    assert.ok(src.includes('Open in default app'), 'has the fallback button');
  });
});

// ---- OfficeViewer.svelte ----

describe('OfficeViewer.svelte', () => {
  const src = readComponent('OfficeViewer.svelte');

  it('lazy-imports mammoth', () => {
    assert.ok(src.includes("import('mammoth')"), 'dynamic import of mammoth');
    assert.ok(!src.match(/import\s+mammoth\s+from/), 'no static mammoth import (keep it out of main chunk)');
  });

  it('converts docx to HTML', () => {
    assert.ok(src.includes('convertToHtml'), 'calls convertToHtml');
    assert.ok(src.includes('arrayBuffer'), 'passes an arrayBuffer');
  });

  it('sanitizes the HTML before rendering', () => {
    assert.ok(src.includes('DOMPurify'), 'imports DOMPurify');
    assert.ok(src.includes('.sanitize('), 'sanitizes output');
  });

  it('reuses the markdown-preview container', () => {
    assert.ok(src.includes('markdown-preview'), 'uses markdown-preview CSS');
  });

  it('falls back to BinaryFilePanel for non-docx / failures', () => {
    assert.ok(src.includes('BinaryFilePanel'), 'has a binary fallback');
    assert.ok(src.includes("!== 'docx'"), 'non-docx office types fall back');
  });
});

// ---- BinaryFilePanel.svelte ----

describe('BinaryFilePanel.svelte', () => {
  const src = readComponent('BinaryFilePanel.svelte');

  it('shows filename and size', () => {
    assert.ok(src.includes('basename'), 'derives a filename');
    assert.ok(src.includes('formatSize'), 'formats a size');
  });

  it('has "Open in default app" using shell open with absolute path', () => {
    assert.ok(src.includes("from '@tauri-apps/plugin-shell'"), 'imports shell open');
    assert.ok(src.includes('Open in default app'), 'has the button');
    assert.ok(src.includes('absolutePath'), 'builds an absolute path');
    assert.ok(src.includes('projectStore.root'), 'uses the project root');
  });

  it('has "Reveal in Explorer" using revealInExplorer', () => {
    assert.ok(src.includes('revealInExplorer'), 'calls revealInExplorer');
    assert.ok(src.includes('Reveal in Explorer'), 'has the button');
  });
});

// ---- FileEditor.svelte cleanup ----

describe('FileEditor.svelte -- binary handled by BinaryFilePanel', () => {
  const src = readComponent('FileEditor.svelte');

  it('imports BinaryFilePanel', () => {
    assert.ok(src.includes("import BinaryFilePanel from './BinaryFilePanel.svelte'"), 'imports the panel');
  });

  it('renders BinaryFilePanel for binary files (no dead-end branch)', () => {
    assert.ok(src.includes('<BinaryFilePanel'), 'renders the panel');
    assert.ok(!src.includes('This file is not displayed because it is binary'), 'old dead-end text removed');
  });

  it('no longer carries the lifted image-preview branch', () => {
    assert.ok(!src.includes('editor-image-preview'), 'image preview branch lifted out');
    assert.ok(!src.includes('imageDataUrl'), 'imageDataUrl state removed');
  });
});

// ---- health contract wiring ----

describe('file-viewer health contract', () => {
  const hcSrc = readLib('health-contracts.js');
  const diagSrc = readLib('stores/diagnostics.svelte.js');

  it('registers a file-viewer contract', () => {
    assert.ok(hcSrc.includes("name: 'file-viewer'"), 'contract registered');
    assert.ok(hcSrc.includes('resolveViewerType'), 'checks the resolver');
    assert.ok(hcSrc.includes('readFileBase64'), 'checks the base64 reader');
  });

  it('is listed in EXPECTED_SUBSYSTEMS', () => {
    assert.ok(diagSrc.includes("'file-viewer'"), 'expected subsystem registered');
  });
});
