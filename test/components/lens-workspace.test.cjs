const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
  'utf-8'
);

describe('LensWorkspace.svelte', () => {
  // Imports
  it('imports SplitPanel', () => {
    assert.ok(src.includes("import SplitPanel from"));
  });
  it('imports LensToolbar', () => {
    assert.ok(src.includes("import LensToolbar from"));
  });
  it('imports LensPreview', () => {
    assert.ok(src.includes("import LensPreview from"));
  });
  it('imports ChatPanel', () => {
    assert.ok(src.includes("import ChatPanel from"));
  });
  it('imports Terminal', () => {
    assert.ok(src.includes("import Terminal from"));
  });

  // Props
  it('accepts onSend prop', () => {
    assert.ok(src.includes('onSend'));
    assert.ok(src.includes('$props()'));
  });

  // Layout structure
  it('has vertical split for main area vs terminal', () => {
    assert.ok(src.includes('direction="vertical"'));
  });
  it('has horizontal splits for chat | preview | files', () => {
    const count = (src.match(/direction="horizontal"/g) || []).length;
    assert.ok(count >= 2, 'Should have at least 2 horizontal splits');
  });
  it('has split ratio state variables', () => {
    assert.ok(src.includes('verticalRatio'));
    assert.ok(src.includes('chatRatio'));
    assert.ok(src.includes('previewRatio'));
  });

  // Tab strip
  it('has tab strip with add button', () => {
    assert.ok(src.includes('tab-strip'));
    assert.ok(src.includes('tab-add'));
  });

  // Chat panel (real component)
  it('has chat area wrapper with ChatPanel', () => {
    assert.ok(src.includes('chat-area'));
    assert.ok(src.includes('<ChatPanel'));
  });
  it('passes onSend to ChatPanel', () => {
    assert.ok(src.includes('{onSend}'));
  });

  // Terminal panel (real component)
  it('has terminal area wrapper with Terminal', () => {
    assert.ok(src.includes('terminal-area'));
    assert.ok(src.includes('<Terminal'));
  });

  // Files panel skeleton (still placeholder)
  it('has files area with tab headers', () => {
    assert.ok(src.includes('files-area'));
    assert.ok(src.includes('files-header'));
  });
  it('has All files and Changes tabs', () => {
    assert.ok(src.includes('All files'));
    assert.ok(src.includes('Changes'));
  });
  it('has file tree with folders and files', () => {
    assert.ok(src.includes('files-tree'));
    assert.ok(src.includes('tree-item'));
  });

  // Preview area
  it('renders LensToolbar and LensPreview in center', () => {
    assert.ok(src.includes('<LensToolbar'));
    assert.ok(src.includes('<LensPreview'));
  });

  // CSS
  it('has workspace-content with flex and margins', () => {
    assert.ok(src.includes('.workspace-content'));
    assert.ok(src.includes('margin-right'));
    assert.ok(src.includes('margin-bottom'));
  });
  it('uses flex column layout', () => {
    assert.ok(src.includes('flex-direction: column'));
  });
  it('has chat-area with border-right', () => {
    assert.ok(src.includes('border-right'));
  });
  it('has terminal-area with border-top', () => {
    assert.ok(src.includes('border-top'));
  });
});
