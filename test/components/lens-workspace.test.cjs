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

  // Chat panel skeleton
  it('has chat area with session info', () => {
    assert.ok(src.includes('chat-area'));
    assert.ok(src.includes('chat-session-info'));
  });
  it('has chat input area', () => {
    assert.ok(src.includes('chat-input-box'));
  });

  // Files panel skeleton
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

  // Terminal panel skeleton
  it('has terminal area with tab bar', () => {
    assert.ok(src.includes('terminal-area'));
    assert.ok(src.includes('terminal-tabs'));
  });
  it('has terminal tab with close and add buttons', () => {
    assert.ok(src.includes('terminal-tab-close'));
    assert.ok(src.includes('terminal-tab-add'));
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
});
