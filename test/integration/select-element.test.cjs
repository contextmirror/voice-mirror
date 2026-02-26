/**
 * Integration tests for the Select Element feature.
 *
 * Verifies full end-to-end wiring across all files:
 *   design-overlay.js -> design.rs -> lib.rs -> api.js -> DesignToolbar.svelte -> LensWorkspace.svelte
 *
 * Uses source-inspection pattern (read file text, assert patterns exist)
 * since Svelte runes and Tauri invoke() can't run in Node.js.
 */

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Read all source files involved in the Select Element feature
const designOverlaySrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/assets/design-overlay.js'),
  'utf-8'
);
const designRsSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/design.rs'),
  'utf-8'
);
const libRsSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lib.rs'),
  'utf-8'
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'),
  'utf-8'
);
const toolbarSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DesignToolbar.svelte'),
  'utf-8'
);
const workspaceSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
  'utf-8'
);

describe('Select Element — End-to-End Wiring', () => {

  describe('Data Flow: Design Overlay -> Rust -> Frontend', () => {
    it('design overlay exposes getSelectedElement on vmDesign', () => {
      assert.ok(designOverlaySrc.includes('getSelectedElement'));
      assert.ok(designOverlaySrc.includes('window.vmDesign'));
    });

    it('Rust command reads getSelectedElement via ExecuteScript', () => {
      assert.ok(designRsSrc.includes('getSelectedElement'));
      assert.ok(designRsSrc.includes('evaluate_js_with_result'));
    });

    it('Rust command is async and returns Result<IpcResponse, String>', () => {
      assert.ok(designRsSrc.includes('pub async fn design_get_element'));
      assert.ok(designRsSrc.includes('Result<IpcResponse, String>'));
    });

    it('Rust command is registered in lib.rs invoke handler', () => {
      assert.ok(libRsSrc.includes('design_get_element'));
    });

    it('api.js wraps the Rust command', () => {
      assert.ok(apiSrc.includes('export async function designGetElement'));
      assert.ok(apiSrc.includes("invoke('design_get_element')"));
    });

    it('DesignToolbar imports and calls designGetElement', () => {
      assert.ok(toolbarSrc.includes('designGetElement'));
      assert.ok(toolbarSrc.includes('import') && toolbarSrc.includes('designGetElement'));
    });

  });

  describe('Data Flow: Toolbar Send -> Queue Attachment', () => {
    it('LensWorkspace has handleElementSend that queues attachment', () => {
      assert.ok(workspaceSrc.includes('function handleElementSend'));
      assert.ok(workspaceSrc.includes('attachmentsStore.add'));
    });

    it('LensWorkspace queues attachment with context field', () => {
      assert.ok(workspaceSrc.includes('context:'));
    });

    it('LensWorkspace ensures chat panel is visible on element send', () => {
      assert.ok(workspaceSrc.includes('layoutStore.setShowChat(true)'));
    });

    it('LensWorkspace focuses chat input after queuing', () => {
      const fnStart = workspaceSrc.indexOf('function handleElementSend');
      const fnEnd = workspaceSrc.indexOf('\n  }', fnStart);
      const fnBody = workspaceSrc.substring(fnStart, fnEnd);
      assert.ok(fnBody.includes('focus'), 'Should focus chat input');
    });

    it('LensWorkspace does not auto-send via chatStore.addMessage', () => {
      const fnStart = workspaceSrc.indexOf('function handleElementSend');
      const fnEnd = workspaceSrc.indexOf('\n  }', fnStart);
      const fnBody = workspaceSrc.substring(fnStart, fnEnd);
      assert.ok(!fnBody.includes('chatStore.addMessage'), 'Should not auto-send');
    });
  });

  describe('UI: Toolbar Integration', () => {
    it('select is a valid tool in the overlay setTool', () => {
      assert.ok(designOverlaySrc.includes("'select'"));
      // Verify it's in the valid tools list inside setTool
      assert.ok(designOverlaySrc.includes("'pen', 'line', 'arrow', 'rect', 'circle', 'text', 'marker', 'pixelate', 'select'"));
    });

    it('DesignToolbar has select as first tool in tools array', () => {
      const toolsMatch = toolbarSrc.match(/const tools = \[([\s\S]*?)\];/);
      assert.ok(toolsMatch, 'tools array found');
      assert.ok(toolsMatch[1].trim().startsWith("{ id: 'select'"), 'select is first');
    });

    it('DesignToolbar hides drawing controls when select is active', () => {
      assert.ok(toolbarSrc.includes("activeTool !== 'select'"));
    });

    it('DesignToolbar declares onElementSend prop', () => {
      assert.ok(toolbarSrc.includes('onElementSend'));
    });

    it('LensWorkspace passes onElementSend to DesignToolbar', () => {
      assert.ok(workspaceSrc.includes('onElementSend={handleElementSend}'));
    });

    it('DesignToolbar select button has Select Element label', () => {
      assert.ok(toolbarSrc.includes("label: 'Select Element'"));
    });
  });

  describe('Element Data Serialization', () => {
    it('overlay has _buildSelector function for CSS selectors', () => {
      assert.ok(designOverlaySrc.includes('function _buildSelector'));
      assert.ok(designOverlaySrc.includes('selector:'));
    });

    it('overlay serializes element bounds via getBoundingClientRect', () => {
      assert.ok(designOverlaySrc.includes('getBoundingClientRect'));
      assert.ok(designOverlaySrc.includes('bounds:'));
    });

    it('overlay serializes HTML (stripped scripts, max 2000 chars)', () => {
      assert.ok(designOverlaySrc.includes('outerHTML'));
      assert.ok(designOverlaySrc.includes('2000'));
      // Strips scripts before serializing
      assert.ok(designOverlaySrc.includes("querySelectorAll('script, style')"));
    });

    it('overlay serializes computed styles', () => {
      assert.ok(designOverlaySrc.includes('getComputedStyle'));
      assert.ok(designOverlaySrc.includes('font-family'));
      assert.ok(designOverlaySrc.includes('background-color'));
    });

    it('overlay serializes text content (max 200 chars)', () => {
      assert.ok(designOverlaySrc.includes('textContent'));
      assert.ok(designOverlaySrc.includes('200'));
    });

    it('overlay returns structured object with all expected fields', () => {
      assert.ok(designOverlaySrc.includes('selector:'));
      assert.ok(designOverlaySrc.includes('tagName:'));
      assert.ok(designOverlaySrc.includes('bounds:'));
      assert.ok(designOverlaySrc.includes('html:'));
      assert.ok(designOverlaySrc.includes('text:'));
      assert.ok(designOverlaySrc.includes('styles:'));
      assert.ok(designOverlaySrc.includes('classes:'));
    });
  });

  describe('Screenshot Cropping', () => {
    it('DesignToolbar has cropScreenshot with DPR support', () => {
      assert.ok(toolbarSrc.includes('cropScreenshot'));
      assert.ok(toolbarSrc.includes('devicePixelRatio'));
    });

    it('DesignToolbar has cropScreenshot with DPR support', () => {
      assert.ok(toolbarSrc.includes('cropScreenshot'));
      assert.ok(toolbarSrc.includes('devicePixelRatio'));
    });

    it('DesignToolbar crop function uses canvas drawImage', () => {
      assert.ok(toolbarSrc.includes('drawImage'));
    });

    it('DesignToolbar crop function outputs image/png data URL', () => {
      assert.ok(toolbarSrc.includes("toDataURL('image/png')"));
    });
  });

  describe('Chrome DevTools-Style Highlight', () => {
    it('draws margin box (orange)', () => {
      assert.ok(designOverlaySrc.includes('246, 178, 107'));
    });

    it('draws padding box (green)', () => {
      assert.ok(designOverlaySrc.includes('147, 196, 125'));
    });

    it('draws content box (blue)', () => {
      assert.ok(designOverlaySrc.includes('111, 168, 220'));
    });

    it('has tooltip with element info', () => {
      assert.ok(designOverlaySrc.includes('data-vm-tooltip'));
    });

    it('has action bar with Deselect button', () => {
      assert.ok(designOverlaySrc.includes('data-vm-actionbar'));
      assert.ok(designOverlaySrc.includes('Deselect'));
    });

    it('draws highlight using _drawElementHighlight', () => {
      assert.ok(designOverlaySrc.includes('function _drawElementHighlight'));
      assert.ok(designOverlaySrc.includes('_drawElementHighlight'));
    });
  });

  describe('Chat Attachment Format', () => {
    it('workspace adds image attachment with correct type and path', () => {
      assert.ok(workspaceSrc.includes("type: 'image/png'"));
      assert.ok(workspaceSrc.includes("path: 'element-capture'"));
    });

    it('workspace queues attachment with context for hidden context', () => {
      assert.ok(workspaceSrc.includes('attachmentsStore.add'));
      assert.ok(workspaceSrc.includes('context:'));
    });

    it('toolbar formats context with selector, HTML, and styles', () => {
      assert.ok(toolbarSrc.includes('elem.selector'));
      assert.ok(toolbarSrc.includes('elem.html'));
      assert.ok(toolbarSrc.includes('elem.styles'));
    });

    it('toolbar includes element bounds dimensions in context', () => {
      assert.ok(toolbarSrc.includes('elem.bounds.width'));
      assert.ok(toolbarSrc.includes('elem.bounds.height'));
    });
  });

  describe('Select Mode State Management', () => {
    it('overlay tracks select mode state', () => {
      assert.ok(designOverlaySrc.includes('_selectMode'));
      assert.ok(designOverlaySrc.includes('_hoveredEl'));
      assert.ok(designOverlaySrc.includes('_selectedElement'));
    });

    it('overlay has mouse handlers for select mode', () => {
      assert.ok(designOverlaySrc.includes('_handleSelectMouseMove'));
      assert.ok(designOverlaySrc.includes('_handleSelectMouseDown'));
      assert.ok(designOverlaySrc.includes('_handleSelectKeyDown'));
    });

    it('overlay exits select mode on Escape', () => {
      assert.ok(designOverlaySrc.includes('_exitSelectMode'));
      assert.ok(designOverlaySrc.includes("e.key === 'Escape'"));
    });

    it('overlay has _cancelSelect to clear selection state', () => {
      assert.ok(designOverlaySrc.includes('function _cancelSelect'));
      assert.ok(designOverlaySrc.includes('_selectedElement = null'));
      assert.ok(designOverlaySrc.includes('_hoveredEl = null'));
    });

    it('overlay skips own elements during hover detection', () => {
      assert.ok(designOverlaySrc.includes('data-vm-tooltip'));
      assert.ok(designOverlaySrc.includes('data-vm-actionbar'));
      assert.ok(designOverlaySrc.includes('vm-design-canvas'));
    });

    it('overlay disables canvas pointer-events during element picking', () => {
      assert.ok(designOverlaySrc.includes("pointerEvents = 'none'"));
      assert.ok(designOverlaySrc.includes('elementFromPoint'));
      assert.ok(designOverlaySrc.includes("pointerEvents = 'auto'"));
    });
  });

  describe('Rust Command Module Wiring', () => {
    it('design module is imported in lib.rs', () => {
      assert.ok(libRsSrc.includes('use commands::design as design_cmds'));
    });

    it('both design_command and design_get_element are registered', () => {
      assert.ok(libRsSrc.includes('design_cmds::design_command'));
      assert.ok(libRsSrc.includes('design_cmds::design_get_element'));
    });

    it('Rust command handles null element (no selection)', () => {
      assert.ok(designRsSrc.includes('No element selected'));
    });

    it('Rust command uses LensState for active tab resolution', () => {
      assert.ok(designRsSrc.includes('LensState'));
      assert.ok(designRsSrc.includes('active_tab_id'));
    });
  });

  describe('API Layer Completeness', () => {
    it('api.js has the Design Overlay section with both commands', () => {
      assert.ok(apiSrc.includes('Design Overlay'));
      assert.ok(apiSrc.includes('designCommand'));
      assert.ok(apiSrc.includes('designGetElement'));
    });

    it('designCommand passes action and args', () => {
      assert.ok(apiSrc.includes("invoke('design_command', { action, args })"));
    });

    it('designGetElement is a no-arg wrapper', () => {
      assert.ok(apiSrc.includes('export async function designGetElement()'));
      assert.ok(apiSrc.includes("invoke('design_get_element')"));
    });
  });
});
