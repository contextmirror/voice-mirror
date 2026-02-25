/**
 * design-overlay.test.cjs -- Source-inspection tests for design-overlay.js
 *
 * Validates the design overlay IIFE including the element select mode
 * (DevTools-style element picker) alongside the existing 8 drawing tools.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/assets/design-overlay.js'),
  'utf-8'
);

// =========================================================================
// IIFE structure
// =========================================================================

describe('design-overlay.js: IIFE structure', () => {
  it('is wrapped in an IIFE', () => {
    assert.ok(src.includes('(function () {'), 'Should be an IIFE');
    assert.ok(src.trimEnd().endsWith('})();'), 'Should end with })()');
  });

  it('guards against double-init', () => {
    assert.ok(src.includes('if (window.vmDesign) return'), 'Should skip if already initialized');
  });

  it('assigns window.vmDesign', () => {
    assert.ok(src.includes('window.vmDesign ='), 'Should create window.vmDesign');
  });

  it('uses strict mode', () => {
    assert.ok(src.includes("'use strict'"), 'Should use strict mode');
  });
});

// =========================================================================
// State variables
// =========================================================================

describe('design-overlay.js: core state variables', () => {
  it('has canvas state', () => {
    assert.ok(src.includes('var canvas = null'), 'Should have canvas');
    assert.ok(src.includes('var ctx = null'), 'Should have ctx');
  });

  it('has tool state', () => {
    assert.ok(src.includes("var currentTool = 'pen'"), 'Should default to pen tool');
    assert.ok(src.includes("var currentColor = '#ff0000'"), 'Should default to red');
    assert.ok(src.includes('var currentSize = 3'), 'Should default size 3');
  });

  it('has stroke tracking', () => {
    assert.ok(src.includes('var strokes = []'), 'Should have strokes array');
    assert.ok(src.includes('var redoStack = []'), 'Should have redo stack');
    assert.ok(src.includes('var drawing = false'), 'Should have drawing flag');
    assert.ok(src.includes('var currentStroke = null'), 'Should have current stroke');
  });

  it('has shift key tracking', () => {
    assert.ok(src.includes('var shiftHeld = false'), 'Should track shift key');
  });

  it('has text input state', () => {
    assert.ok(src.includes('var textInput = null'), 'Should have text input state');
  });
});

// =========================================================================
// Select mode state
// =========================================================================

describe('design-overlay.js: select mode state variables', () => {
  it('has _selectMode flag', () => {
    assert.ok(src.includes('var _selectMode = false'), 'Should have _selectMode');
  });

  it('has _hoveredEl', () => {
    assert.ok(src.includes('var _hoveredEl = null'), 'Should have _hoveredEl');
  });

  it('has _selectedElement', () => {
    assert.ok(src.includes('var _selectedElement = null'), 'Should have _selectedElement');
  });

  it('has _selectTooltip', () => {
    assert.ok(src.includes('var _selectTooltip = null'), 'Should have _selectTooltip');
  });

  it('has _selectActionBar', () => {
    assert.ok(src.includes('var _selectActionBar = null'), 'Should have _selectActionBar');
  });
});

// =========================================================================
// Existing drawing tools (not modified)
// =========================================================================

describe('design-overlay.js: existing drawing tools', () => {
  var tools = ['pen', 'line', 'arrow', 'rect', 'circle', 'text', 'marker', 'pixelate'];

  tools.forEach(function (tool) {
    it('supports ' + tool + ' tool in _drawStroke', () => {
      assert.ok(src.includes("case '" + tool + "'"), 'Should have case for ' + tool);
    });
  });

  it('has _isTwoPoint helper', () => {
    assert.ok(src.includes('function _isTwoPoint(tool)'), 'Should have _isTwoPoint');
  });

  it('has _redrawAll', () => {
    assert.ok(src.includes('function _redrawAll()'), 'Should have _redrawAll');
  });

  it('has undo/redo', () => {
    assert.ok(src.includes('function _undo()'), 'Should have _undo');
    assert.ok(src.includes('function _redo()'), 'Should have _redo');
  });
});

// =========================================================================
// _buildSelector
// =========================================================================

describe('design-overlay.js: _buildSelector', () => {
  it('has _buildSelector function', () => {
    assert.ok(src.includes('function _buildSelector(el)'), 'Should have _buildSelector');
  });

  it('builds selector path with tag names', () => {
    assert.ok(src.includes('cur.tagName.toLowerCase()'), 'Should use lowercase tag names');
  });

  it('stops at element with id', () => {
    assert.ok(src.includes("seg = seg + '#' + cur.id"), 'Should stop and include id');
  });

  it('appends classes to selector', () => {
    assert.ok(src.includes("seg += '.' + classes[i]"), 'Should append classes');
  });

  it('uses nth-child for disambiguation', () => {
    assert.ok(src.includes(':nth-child('), 'Should use nth-child when siblings share tag');
  });

  it('joins with child combinator', () => {
    assert.ok(src.includes("parts.join(' > ')"), 'Should join parts with >');
  });

  it('stops at document.body', () => {
    assert.ok(src.includes('cur !== document.body'), 'Should not traverse past body');
  });
});

// =========================================================================
// _drawElementHighlight
// =========================================================================

describe('design-overlay.js: _drawElementHighlight', () => {
  it('has _drawElementHighlight function', () => {
    assert.ok(src.includes('function _drawElementHighlight(el)'), 'Should have _drawElementHighlight');
  });

  it('uses getBoundingClientRect', () => {
    assert.ok(src.includes('el.getBoundingClientRect()'), 'Should get bounding rect');
  });

  it('uses getComputedStyle', () => {
    assert.ok(src.includes('window.getComputedStyle(el)'), 'Should get computed style');
  });

  it('draws orange margin box', () => {
    assert.ok(src.includes('rgba(246, 178, 107, 0.3)'), 'Should draw orange margin area');
  });

  it('draws green padding box', () => {
    assert.ok(src.includes('rgba(147, 196, 125, 0.4)'), 'Should draw green padding area');
  });

  it('draws blue content box', () => {
    assert.ok(src.includes('rgba(111, 168, 220, 0.4)'), 'Should draw blue content area');
  });

  it('draws blue border outline', () => {
    assert.ok(src.includes('rgba(111, 168, 220, 1)'), 'Should draw blue border outline');
  });

  it('parses margin values', () => {
    assert.ok(src.includes('style.marginTop'), 'Should parse marginTop');
    assert.ok(src.includes('style.marginRight'), 'Should parse marginRight');
    assert.ok(src.includes('style.marginBottom'), 'Should parse marginBottom');
    assert.ok(src.includes('style.marginLeft'), 'Should parse marginLeft');
  });

  it('parses padding values', () => {
    assert.ok(src.includes('style.paddingTop'), 'Should parse paddingTop');
    assert.ok(src.includes('style.paddingRight'), 'Should parse paddingRight');
    assert.ok(src.includes('style.paddingBottom'), 'Should parse paddingBottom');
    assert.ok(src.includes('style.paddingLeft'), 'Should parse paddingLeft');
  });

  it('parses border width values', () => {
    assert.ok(src.includes('style.borderTopWidth'), 'Should parse borderTopWidth');
    assert.ok(src.includes('style.borderRightWidth'), 'Should parse borderRightWidth');
    assert.ok(src.includes('style.borderBottomWidth'), 'Should parse borderBottomWidth');
    assert.ok(src.includes('style.borderLeftWidth'), 'Should parse borderLeftWidth');
  });
});

// =========================================================================
// _showSelectTooltip
// =========================================================================

describe('design-overlay.js: _showSelectTooltip', () => {
  it('has _showSelectTooltip function', () => {
    assert.ok(src.includes('function _showSelectTooltip(el)'), 'Should have _showSelectTooltip');
  });

  it('creates div with data-vm-tooltip attribute', () => {
    assert.ok(src.includes("data-vm-tooltip"), 'Should set data-vm-tooltip');
  });

  it('uses z-index 1000001', () => {
    assert.ok(src.includes('z-index:1000001'), 'Should use z-index 1000001');
  });

  it('sets pointer-events none', () => {
    assert.ok(src.includes('pointer-events:none'), 'Tooltip should be non-interactive');
  });

  it('shows tag#id.class | width x height format', () => {
    // Check the dimension part of the label
    assert.ok(src.includes("Math.round(rect.width) + ' x ' + Math.round(rect.height)"), 'Should show dimensions');
  });

  it('positions above element by default', () => {
    assert.ok(src.includes('rect.top - tipH - 4'), 'Should position above by default');
  });

  it('falls back to below when near top', () => {
    assert.ok(src.includes('rect.bottom + 4'), 'Should fallback to below');
  });

  it('uses monospace font', () => {
    assert.ok(src.includes('font-family:monospace'), 'Should use monospace font');
  });

  it('calls _removeSelectTooltip first', () => {
    // Verify it removes previous tooltip before creating new one
    const fnBody = src.substring(src.indexOf('function _showSelectTooltip'));
    assert.ok(fnBody.includes('_removeSelectTooltip()'), 'Should clean up old tooltip first');
  });
});

// =========================================================================
// _showSelectActionBar
// =========================================================================

describe('design-overlay.js: _showSelectActionBar', () => {
  it('has _showSelectActionBar function', () => {
    assert.ok(src.includes('function _showSelectActionBar(el)'), 'Should have _showSelectActionBar');
  });

  it('creates div with data-vm-actionbar attribute', () => {
    assert.ok(src.includes("data-vm-actionbar"), 'Should set data-vm-actionbar');
  });

  it('has Deselect button', () => {
    assert.ok(src.includes("'Deselect'"), 'Should have Deselect button');
  });

  it('calls _cancelSelect on Deselect', () => {
    // The deselect button handler calls _cancelSelect
    const actionBarFn = src.substring(src.indexOf('function _showSelectActionBar'));
    assert.ok(actionBarFn.includes('_cancelSelect()'), 'Deselect should call _cancelSelect');
  });

  it('stops mouse events from reaching canvas', () => {
    // The action bar stops propagation on mouse events
    const actionBarFn = src.substring(src.indexOf('function _showSelectActionBar'));
    assert.ok(actionBarFn.includes('e.stopPropagation()'), 'Should stop event propagation');
  });

  it('positions below element', () => {
    const actionBarFn = src.substring(src.indexOf('function _showSelectActionBar'));
    assert.ok(actionBarFn.includes('rect.bottom + 4'), 'Should position below element');
  });

  it('falls back to above when near bottom', () => {
    const actionBarFn = src.substring(src.indexOf('function _showSelectActionBar'));
    assert.ok(actionBarFn.includes('window.innerHeight'), 'Should check viewport bottom');
  });
});

// =========================================================================
// _serializeElement
// =========================================================================

describe('design-overlay.js: _serializeElement', () => {
  it('has _serializeElement function', () => {
    assert.ok(src.includes('function _serializeElement(el)'), 'Should have _serializeElement');
  });

  it('calls _buildSelector', () => {
    const fn = src.substring(src.indexOf('function _serializeElement'));
    assert.ok(fn.includes('_buildSelector(el)'), 'Should build selector');
  });

  it('returns selector field', () => {
    assert.ok(src.includes('selector: selector'), 'Should include selector');
  });

  it('returns tagName field', () => {
    assert.ok(src.includes("tagName: el.tagName.toLowerCase()"), 'Should include tagName');
  });

  it('returns id field', () => {
    assert.ok(src.includes("id: el.id || ''"), 'Should include id');
  });

  it('returns classes array', () => {
    assert.ok(src.includes('classes:'), 'Should include classes array');
  });

  it('returns bounds with x, y, width, height', () => {
    assert.ok(src.includes('bounds:'), 'Should include bounds object');
    assert.ok(src.includes('Math.round(rect.left)'), 'Bounds should have rounded x');
    assert.ok(src.includes('Math.round(rect.top)'), 'Bounds should have rounded y');
    assert.ok(src.includes('Math.round(rect.width)'), 'Bounds should have rounded width');
    assert.ok(src.includes('Math.round(rect.height)'), 'Bounds should have rounded height');
  });

  it('strips script and style tags from HTML', () => {
    assert.ok(src.includes("clone.querySelectorAll('script, style')"), 'Should strip script/style');
  });

  it('trims HTML to 2000 chars', () => {
    assert.ok(src.includes('html.length > 2000'), 'Should cap HTML at 2000 chars');
    assert.ok(src.includes('html.substring(0, 2000)'), 'Should truncate HTML');
  });

  it('trims text to 200 chars', () => {
    assert.ok(src.includes('text.length > 200'), 'Should cap text at 200 chars');
    assert.ok(src.includes('text.substring(0, 200)'), 'Should truncate text');
  });

  it('captures key computed style properties', () => {
    var expectedProps = [
      'display', 'position', 'width', 'height', 'padding', 'margin',
      'gap', 'flex-direction', 'align-items', 'justify-content',
      'color', 'background', 'background-color', 'border', 'border-radius',
      'box-shadow', 'opacity', 'font-family', 'font-size', 'font-weight',
      'line-height', 'letter-spacing'
    ];
    expectedProps.forEach(function (prop) {
      assert.ok(src.includes("'" + prop + "'"), 'Should capture style: ' + prop);
    });
  });

  it('uses getPropertyValue for style extraction', () => {
    assert.ok(src.includes('style.getPropertyValue(styleProps[j])'), 'Should use getPropertyValue');
  });
});

// =========================================================================
// Select mode mouse/keyboard handlers
// =========================================================================

describe('design-overlay.js: select mode handlers', () => {
  it('has _handleSelectMouseMove', () => {
    assert.ok(src.includes('function _handleSelectMouseMove(e)'), 'Should have _handleSelectMouseMove');
  });

  it('has _handleSelectMouseDown', () => {
    assert.ok(src.includes('function _handleSelectMouseDown(e)'), 'Should have _handleSelectMouseDown');
  });

  it('has _handleSelectKeyDown', () => {
    assert.ok(src.includes('function _handleSelectKeyDown(e)'), 'Should have _handleSelectKeyDown');
  });

  it('disables canvas pointer-events for elementFromPoint', () => {
    assert.ok(
      src.includes("canvas.style.pointerEvents = 'none'"),
      'Should disable pointer-events before elementFromPoint'
    );
    assert.ok(
      src.includes("canvas.style.pointerEvents = 'auto'"),
      'Should re-enable pointer-events after elementFromPoint'
    );
  });

  it('uses document.elementFromPoint', () => {
    assert.ok(src.includes('document.elementFromPoint(e.clientX, e.clientY)'), 'Should use elementFromPoint');
  });

  it('skips overlay elements (data-vm-tooltip, data-vm-actionbar, data-vm-text)', () => {
    const fn = src.substring(src.indexOf('function _handleSelectMouseMove'));
    assert.ok(fn.includes("data-vm-tooltip"), 'Should skip tooltip elements');
    assert.ok(fn.includes("data-vm-actionbar"), 'Should skip action bar elements');
    assert.ok(fn.includes("data-vm-text"), 'Should skip text input elements');
  });

  it('skips vm-design-canvas element', () => {
    assert.ok(src.includes("el.id === 'vm-design-canvas'"), 'Should skip canvas element');
  });

  it('draws highlight and shows tooltip on hover', () => {
    const fn = src.substring(src.indexOf('function _handleSelectMouseMove'));
    assert.ok(fn.includes('_drawElementHighlight(el)'), 'Should draw highlight');
    assert.ok(fn.includes('_showSelectTooltip(el)'), 'Should show tooltip');
  });

  it('serializes element on mousedown', () => {
    const fn = src.substring(src.indexOf('function _handleSelectMouseDown'));
    assert.ok(fn.includes('_serializeElement(_hoveredEl)'), 'Should serialize on click');
  });

  it('shows action bar on mousedown', () => {
    const fn = src.substring(src.indexOf('function _handleSelectMouseDown'));
    assert.ok(fn.includes('_showSelectActionBar(_hoveredEl)'), 'Should show action bar');
  });

  it('handles Escape in select mode', () => {
    const fn = src.substring(src.indexOf('function _handleSelectKeyDown'));
    assert.ok(fn.includes("e.key === 'Escape'"), 'Should handle Escape');
  });

  it('Escape cancels selection if element is selected', () => {
    const fn = src.substring(src.indexOf('function _handleSelectKeyDown'));
    assert.ok(fn.includes('_cancelSelect()'), 'Escape should cancel selection');
  });

  it('Escape exits select mode if no element selected', () => {
    const fn = src.substring(src.indexOf('function _handleSelectKeyDown'));
    assert.ok(fn.includes('_exitSelectMode()'), 'Escape should exit select mode');
  });

  it('also checks parent chain for overlay elements', () => {
    const fn = src.substring(src.indexOf('function _handleSelectMouseMove'));
    assert.ok(fn.includes('el.parentElement'), 'Should check parent chain');
  });
});

// =========================================================================
// Select mode cleanup helpers
// =========================================================================

describe('design-overlay.js: select mode cleanup', () => {
  it('has _removeSelectTooltip', () => {
    assert.ok(src.includes('function _removeSelectTooltip()'), 'Should have _removeSelectTooltip');
  });

  it('has _removeSelectActionBar', () => {
    assert.ok(src.includes('function _removeSelectActionBar()'), 'Should have _removeSelectActionBar');
  });

  it('has _cancelSelect', () => {
    assert.ok(src.includes('function _cancelSelect()'), 'Should have _cancelSelect');
  });

  it('has _exitSelectMode', () => {
    assert.ok(src.includes('function _exitSelectMode()'), 'Should have _exitSelectMode');
  });

  it('_cancelSelect resets state', () => {
    const fn = src.substring(src.indexOf('function _cancelSelect()'));
    assert.ok(fn.includes('_selectedElement = null'), 'Should clear selected element');
    assert.ok(fn.includes('_hoveredEl = null'), 'Should clear hovered element');
    assert.ok(fn.includes('_removeSelectTooltip()'), 'Should remove tooltip');
    assert.ok(fn.includes('_removeSelectActionBar()'), 'Should remove action bar');
    assert.ok(fn.includes('_redrawAll()'), 'Should redraw canvas');
  });

  it('_exitSelectMode resets _selectMode flag', () => {
    const fn = src.substring(src.indexOf('function _exitSelectMode()'));
    assert.ok(fn.includes('_selectMode = false'), 'Should clear select mode flag');
  });

  it('_exitSelectMode calls _cancelSelect', () => {
    const fn = src.substring(src.indexOf('function _exitSelectMode()'));
    assert.ok(fn.includes('_cancelSelect()'), 'Should call _cancelSelect');
  });

  it('_removeSelectTooltip removes from DOM', () => {
    const fn = src.substring(src.indexOf('function _removeSelectTooltip()'));
    assert.ok(fn.includes('_selectTooltip.parentNode.removeChild'), 'Should remove tooltip from DOM');
  });

  it('_removeSelectActionBar removes from DOM', () => {
    const fn = src.substring(src.indexOf('function _removeSelectActionBar()'));
    assert.ok(fn.includes('_selectActionBar.parentNode.removeChild'), 'Should remove action bar from DOM');
  });
});

// =========================================================================
// Wiring into existing handlers
// =========================================================================

describe('design-overlay.js: select mode wiring', () => {
  it('_handleMouseDown checks _selectMode first', () => {
    // The select mode check should be the very first thing in _handleMouseDown
    const fnStart = src.indexOf('function _handleMouseDown(e)');
    const fnBody = src.substring(fnStart, fnStart + 200);
    assert.ok(fnBody.includes('if (_selectMode)'), 'Should check _selectMode at top of _handleMouseDown');
    assert.ok(fnBody.includes('_handleSelectMouseDown(e)'), 'Should delegate to select handler');
  });

  it('_handleMouseMove checks _selectMode first', () => {
    const fnStart = src.indexOf('function _handleMouseMove(e)');
    const fnBody = src.substring(fnStart, fnStart + 200);
    assert.ok(fnBody.includes('if (_selectMode)'), 'Should check _selectMode at top of _handleMouseMove');
    assert.ok(fnBody.includes('_handleSelectMouseMove(e)'), 'Should delegate to select handler');
  });

  it('_handleMouseUp returns early in select mode', () => {
    const fnStart = src.indexOf('function _handleMouseUp(e)');
    const fnBody = src.substring(fnStart, fnStart + 200);
    assert.ok(fnBody.includes('if (_selectMode) return'), 'Should return early in select mode');
  });

  it('_handleKeyDown checks _selectMode before Shift', () => {
    const fnStart = src.indexOf('function _handleKeyDown(e)');
    const fnBody = src.substring(fnStart, fnStart + 600);
    var selectIdx = fnBody.indexOf('_selectMode');
    var shiftIdx = fnBody.indexOf("e.key === 'Shift'");
    assert.ok(selectIdx !== -1, 'Should have _selectMode check');
    assert.ok(shiftIdx !== -1, 'Should have Shift check');
    assert.ok(selectIdx < shiftIdx, 'Select mode check should come before Shift check');
  });

  it('disable() calls _exitSelectMode', () => {
    const disableStart = src.indexOf('disable: function ()');
    const disableBody = src.substring(disableStart, disableStart + 300);
    assert.ok(disableBody.includes('_exitSelectMode()'), 'disable should call _exitSelectMode');
  });
});

// =========================================================================
// setTool integration
// =========================================================================

describe('design-overlay.js: setTool with select', () => {
  it('includes select in valid tools list', () => {
    assert.ok(src.includes("'select'"), 'Should include select in valid tools');
    // Verify it's in the valid array
    const setToolFn = src.substring(src.indexOf('setTool: function'));
    assert.ok(setToolFn.includes("'select'"), 'select should be in setTool valid list');
  });

  it('sets _selectMode = true when tool is select', () => {
    const setToolFn = src.substring(src.indexOf('setTool: function'));
    assert.ok(setToolFn.includes('_selectMode = true'), 'Should set _selectMode true');
  });

  it('calls _exitSelectMode when switching away from select', () => {
    const setToolFn = src.substring(src.indexOf('setTool: function'));
    assert.ok(setToolFn.includes('_exitSelectMode()'), 'Should exit select mode on tool change');
  });

  it('sets crosshair cursor for select mode', () => {
    const setToolFn = src.substring(src.indexOf('setTool: function'));
    assert.ok(setToolFn.includes("'crosshair'"), 'Should set crosshair cursor');
  });
});

// =========================================================================
// Public API: getSelectedElement
// =========================================================================

describe('design-overlay.js: getSelectedElement API', () => {
  it('exposes getSelectedElement on window.vmDesign', () => {
    assert.ok(src.includes('getSelectedElement: function ()'), 'Should expose getSelectedElement');
  });

  it('returns _selectedElement', () => {
    const fn = src.substring(src.indexOf('getSelectedElement: function'));
    assert.ok(fn.includes('return _selectedElement'), 'Should return _selectedElement');
  });
});

// =========================================================================
// Public API completeness
// =========================================================================

describe('design-overlay.js: public API', () => {
  var expectedMethods = [
    'enable', 'disable', 'setTool', 'setColor', 'setSize',
    'undo', 'redo', 'clear', 'getStrokeCount', 'toDataURL',
    'getSelectedElement'
  ];

  expectedMethods.forEach(function (method) {
    it('exposes ' + method + ' method', () => {
      assert.ok(src.includes(method + ':'), 'Should expose ' + method);
    });
  });
});

// =========================================================================
// ES5 compliance
// =========================================================================

describe('design-overlay.js: ES5 compliance', () => {
  it('does not use let', () => {
    // Check that no line starts with let (allowing for let inside strings)
    var lines = src.split('\n');
    var hasLet = false;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed.startsWith('let ') || trimmed.startsWith('let\t')) {
        hasLet = true;
        break;
      }
    }
    assert.ok(!hasLet, 'Should not use let declarations');
  });

  it('does not use const', () => {
    var lines = src.split('\n');
    var hasConst = false;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed.startsWith('const ') || trimmed.startsWith('const\t')) {
        hasConst = true;
        break;
      }
    }
    assert.ok(!hasConst, 'Should not use const declarations');
  });

  it('does not use arrow functions', () => {
    // Arrow functions would appear as `=>` outside of comments and strings
    var lines = src.split('\n');
    var hasArrow = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Skip comment lines
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      // Check for => that is not inside a string
      if (line.includes('=>') && !line.includes("'") && !line.includes('"')) {
        hasArrow = true;
        break;
      }
    }
    assert.ok(!hasArrow, 'Should not use arrow functions');
  });

  it('does not use template literals', () => {
    var lines = src.split('\n');
    var hasTemplate = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      if (line.includes('`')) {
        hasTemplate = true;
        break;
      }
    }
    assert.ok(!hasTemplate, 'Should not use template literals');
  });

  it('uses var for all variable declarations', () => {
    // Already tested via no-let and no-const, but verify var is used
    assert.ok(src.includes('var canvas'), 'Should use var for declarations');
    assert.ok(src.includes('var _selectMode'), 'Should use var for select mode state');
  });

  it('uses function expressions not arrow functions', () => {
    assert.ok(src.includes('function (e)'), 'Should use function expressions for event handlers');
  });
});

// =========================================================================
// Canvas z-index and overlay layering
// =========================================================================

describe('design-overlay.js: layering', () => {
  it('canvas uses z-index 999999', () => {
    assert.ok(src.includes('z-index:999999'), 'Canvas should be at z-index 999999');
  });

  it('tooltip and action bar use z-index 1000001', () => {
    // Both tooltip and action bar should be above canvas
    var matches = src.match(/z-index:1000001/g);
    assert.ok(matches && matches.length >= 2, 'Tooltip and action bar should use z-index 1000001');
  });
});

// =========================================================================
// Listener cleanup
// =========================================================================

describe('design-overlay.js: listener references', () => {
  var listeners = ['_onMouseDown', '_onMouseMove', '_onMouseUp', '_onKeyDown', '_onKeyUp', '_onResize'];

  listeners.forEach(function (listener) {
    it('stores ' + listener + ' for cleanup', () => {
      assert.ok(src.includes('var ' + listener + ' = null'), 'Should have ' + listener);
    });
  });
});
