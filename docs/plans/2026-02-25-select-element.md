# Select Element Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Select Element" tool to Design Mode that lets users hover/click any element on any website, captures a cropped screenshot + HTML + computed styles + CSS selector, and sends it to chat as context for the AI.

**Architecture:** Extend the existing `design-overlay.js` with an element select mode that uses `elementFromPoint()` for hit-testing, draws Chrome DevTools-style highlight boxes on the existing canvas, serializes element metadata on click, and pipes it through the existing design command → chat attachment flow.

**Tech Stack:** Vanilla JS (design-overlay.js in WebView2), Svelte 5 (DesignToolbar), Rust/Tauri (design commands), OffscreenCanvas (screenshot cropping)

---

### Task 1: Add Element Select Mode to design-overlay.js

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js`

**Context:** This is the injected JS module that runs inside the WebView2 child window. It's a self-contained IIFE that creates `window.vmDesign`. Currently supports 8 drawing tools. We're adding a 9th: `select`.

**Step 1: Add element select state variables**

After line 19 (`var textInput = null;`), add:

```js
// --- Element select state ---
var _selectMode = false;
var _hoveredEl = null;
var _selectedElement = null;  // Locked selection data
var _selectTooltip = null;
var _selectActionBar = null;
```

**Step 2: Add CSS selector builder utility**

After the `_isTwoPoint()` utility function (~line 618), add:

```js
function _buildSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    var parts = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
        var selector = current.tagName.toLowerCase();
        if (current.id) {
            parts.unshift('#' + current.id);
            break;
        }
        if (current.className && typeof current.className === 'string') {
            var classes = current.className.trim().split(/\s+/).filter(function(c) { return c.length > 0; }).slice(0, 3);
            if (classes.length) selector += '.' + classes.join('.');
        }
        var parent = current.parentElement;
        if (parent) {
            var siblings = Array.prototype.filter.call(parent.children, function(s) { return s.tagName === current.tagName; });
            if (siblings.length > 1) {
                var idx = Array.prototype.indexOf.call(siblings, current) + 1;
                selector += ':nth-child(' + idx + ')';
            }
        }
        parts.unshift(selector);
        current = current.parentElement;
    }
    return parts.join(' > ');
}
```

**Step 3: Add DevTools-style highlight renderer**

Add below the selector builder:

```js
function _drawElementHighlight(el) {
    if (!el || !ctx || !canvas) return;

    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);

    var mt = parseFloat(style.marginTop) || 0;
    var mr = parseFloat(style.marginRight) || 0;
    var mb = parseFloat(style.marginBottom) || 0;
    var ml = parseFloat(style.marginLeft) || 0;
    var pt = parseFloat(style.paddingTop) || 0;
    var pr = parseFloat(style.paddingRight) || 0;
    var pb = parseFloat(style.paddingBottom) || 0;
    var pl = parseFloat(style.paddingLeft) || 0;

    // Margin box (orange)
    ctx.fillStyle = 'rgba(246, 178, 107, 0.3)';
    ctx.fillRect(
        rect.left - ml, rect.top - mt,
        rect.width + ml + mr, rect.height + mt + mb
    );

    // Padding box (green) — overwrite margin area inside the border
    ctx.fillStyle = 'rgba(147, 196, 125, 0.4)';
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

    // Content box (blue) — overwrite padding area
    ctx.fillStyle = 'rgba(111, 168, 220, 0.4)';
    ctx.fillRect(
        rect.left + pl, rect.top + pt,
        rect.width - pl - pr, rect.height - pt - pb
    );

    // Border outline
    ctx.strokeStyle = 'rgba(111, 168, 220, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
}
```

**Step 4: Add tooltip renderer**

```js
function _showSelectTooltip(el, mouseX, mouseY) {
    if (_selectTooltip) _removeSelectTooltip();

    var rect = el.getBoundingClientRect();
    var tag = el.tagName.toLowerCase();
    var classes = (el.className && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    var id = el.id ? '#' + el.id : '';
    var dims = Math.round(rect.width) + ' x ' + Math.round(rect.height);
    var label = tag + id + classes + '  |  ' + dims;

    var tip = document.createElement('div');
    tip.setAttribute('data-vm-tooltip', '1');
    tip.textContent = label;

    var tipTop = rect.top - 28;
    if (tipTop < 4) tipTop = rect.bottom + 4;

    tip.style.cssText = [
        'position:fixed',
        'left:' + Math.max(4, rect.left) + 'px',
        'top:' + tipTop + 'px',
        'padding:3px 8px',
        'background:#333740',
        'color:#e8eaed',
        'font-size:11px',
        'font-family:monospace',
        'border-radius:3px',
        'z-index:1000001',
        'pointer-events:none',
        'white-space:nowrap',
        'box-shadow:0 2px 6px rgba(0,0,0,0.3)'
    ].join(';');

    document.body.appendChild(tip);
    _selectTooltip = tip;
}

function _removeSelectTooltip() {
    if (_selectTooltip && _selectTooltip.parentNode) {
        _selectTooltip.parentNode.removeChild(_selectTooltip);
    }
    _selectTooltip = null;
}
```

**Step 5: Add action bar (Send to Chat / Cancel)**

```js
function _showSelectActionBar(el) {
    if (_selectActionBar) _removeSelectActionBar();

    var rect = el.getBoundingClientRect();
    var bar = document.createElement('div');
    bar.setAttribute('data-vm-actionbar', '1');

    var barTop = rect.bottom + 8;
    if (barTop + 36 > window.innerHeight) barTop = rect.top - 44;

    bar.style.cssText = [
        'position:fixed',
        'left:' + Math.max(4, rect.left) + 'px',
        'top:' + barTop + 'px',
        'display:flex',
        'gap:6px',
        'z-index:1000001',
        'pointer-events:auto'
    ].join(';');

    function makeBtn(text, bg, color) {
        var btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = [
            'padding:5px 14px',
            'border:none',
            'border-radius:4px',
            'background:' + bg,
            'color:' + color,
            'font-size:12px',
            'font-weight:600',
            'cursor:pointer',
            'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
        ].join(';');
        return btn;
    }

    var sendBtn = makeBtn('Send to Chat', '#4f46e5', '#fff');
    sendBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        // Notify the host that element was confirmed
        // The host reads _selectedElement via ExecuteScript
        _removeSelectActionBar();
        _removeSelectTooltip();
        if (canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            _redrawAll();
        }
        _selectMode = false;
        // Dispatch custom event for the Tauri host to catch via lens-shortcut
        var img = new Image();
        img.src = 'lens-shortcut://element-selected';
    });

    var cancelBtn = makeBtn('Cancel', '#333740', '#e8eaed');
    cancelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _cancelSelect();
    });

    bar.appendChild(sendBtn);
    bar.appendChild(cancelBtn);
    document.body.appendChild(bar);
    _selectActionBar = bar;
}

function _removeSelectActionBar() {
    if (_selectActionBar && _selectActionBar.parentNode) {
        _selectActionBar.parentNode.removeChild(_selectActionBar);
    }
    _selectActionBar = null;
}
```

**Step 6: Add element data serializer**

```js
function _serializeElement(el) {
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);

    // Collect key computed styles
    var styleProps = [
        'display','position','width','height','padding','margin','gap',
        'flex-direction','align-items','justify-content',
        'color','background','background-color','border','border-radius','box-shadow','opacity',
        'font-family','font-size','font-weight','line-height','letter-spacing'
    ];
    var computed = {};
    for (var i = 0; i < styleProps.length; i++) {
        var val = style.getPropertyValue(styleProps[i]);
        if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'rgba(0, 0, 0, 0)') {
            computed[styleProps[i]] = val;
        }
    }

    // Clean outerHTML (strip script/style, truncate)
    var html = el.outerHTML || '';
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    if (html.length > 2000) {
        html = html.substring(0, 2000) + '\n<!-- truncated -->';
    }

    // Text content
    var text = (el.textContent || '').trim();
    if (text.length > 200) text = text.substring(0, 200) + '...';

    return {
        selector: _buildSelector(el),
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: (el.className && typeof el.className === 'string') ? el.className.trim() : '',
        bounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        },
        html: html,
        text: text,
        styles: computed
    };
}
```

**Step 7: Add select mode mouse handlers**

```js
function _handleSelectMouseMove(e) {
    if (!_selectMode || _selectedElement) return;  // Locked — don't update hover
    e.preventDefault();
    e.stopPropagation();

    // Temporarily disable canvas to hit-test underlying elements
    if (canvas) canvas.style.pointerEvents = 'none';
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (canvas) canvas.style.pointerEvents = 'auto';

    // Skip our own overlays
    if (!el || el === canvas || (el.getAttribute && (
        el.getAttribute('data-vm-tooltip') ||
        el.getAttribute('data-vm-actionbar') ||
        el.getAttribute('data-vm-text')
    ))) return;

    _hoveredEl = el;

    // Redraw canvas with highlight
    if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _redrawAll();
        _drawElementHighlight(el);
    }
    _showSelectTooltip(el, e.clientX, e.clientY);
}

function _handleSelectMouseDown(e) {
    if (!_selectMode) return;
    e.preventDefault();
    e.stopPropagation();

    if (_selectedElement) {
        // Already locked — clicking again cancels and re-enters hover
        _cancelSelect();
        return;
    }

    if (_hoveredEl) {
        // Lock selection
        _selectedElement = _serializeElement(_hoveredEl);
        _showSelectActionBar(_hoveredEl);
    }
}

function _handleSelectKeyDown(e) {
    if (!_selectMode) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (_selectedElement) {
            _cancelSelect();
        } else {
            _exitSelectMode();
        }
    }
}

function _cancelSelect() {
    _selectedElement = null;
    _hoveredEl = null;
    _removeSelectActionBar();
    _removeSelectTooltip();
    if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _redrawAll();
    }
}

function _exitSelectMode() {
    _cancelSelect();
    _selectMode = false;
    if (canvas) canvas.style.cursor = _getCursor(currentTool);
}
```

**Step 8: Wire select mode into setTool and enable/disable**

Modify the `setTool` function in the public API to handle 'select':

```js
// In window.vmDesign.setTool:
setTool: function (name) {
    var valid = ['pen', 'line', 'arrow', 'rect', 'circle', 'text', 'marker', 'pixelate', 'select'];
    if (valid.indexOf(name) === -1) return;

    // Exit select mode if switching away
    if (_selectMode && name !== 'select') {
        _exitSelectMode();
    }

    currentTool = name;

    if (name === 'select') {
        _selectMode = true;
        _selectedElement = null;
        _hoveredEl = null;
        if (canvas) canvas.style.cursor = 'crosshair';
    } else {
        _selectMode = false;
        if (canvas) canvas.style.cursor = _getCursor(name);
    }
},
```

Modify `_handleMouseDown`, `_handleMouseMove`, `_handleMouseUp` to short-circuit when in select mode (add at top of each):

```js
// At top of _handleMouseDown:
if (_selectMode) { _handleSelectMouseDown(e); return; }

// At top of _handleMouseMove:
if (_selectMode) { _handleSelectMouseMove(e); return; }

// At top of _handleMouseUp (just return, select uses mousedown only):
if (_selectMode) return;
```

Modify `_handleKeyDown` to delegate in select mode:

```js
// At top of _handleKeyDown, before the Shift check:
if (_selectMode) { _handleSelectKeyDown(e); return; }
```

Add cleanup to `disable()`:

```js
// In window.vmDesign.disable(), after _removeTextInput():
_exitSelectMode();
```

**Step 9: Add getSelectedElement to public API**

```js
// Add to window.vmDesign:
getSelectedElement: function () {
    return _selectedElement;
},
```

**Step 10: Run tests**

```bash
npm test
```

Expected: All 3860+ tests pass (design-overlay.js is tested via source inspection).

**Step 11: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js
git commit -m "feat: add element select mode to design overlay with DevTools-style highlight"
```

---

### Task 2: Add get_selected_element Action to Rust design.rs

**Files:**
- Modify: `src-tauri/src/commands/design.rs`

**Context:** The `design_command` function dispatches actions to the webview via `eval()`. For `get_selected_element`, we need `ExecuteScript` (with return value) instead of `eval()` (fire-and-forget). However, the design command currently uses `eval()`. We need to use the browser bridge's `evaluate_js_with_result` pattern or make the command async.

**Step 1: Write the test**

Create test file: `test/components/design-overlay.cjs`

```js
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/assets/design-overlay.js'),
  'utf-8'
);

describe('design-overlay.js — element select mode', () => {
  it('includes select in valid tools list', () => {
    assert.ok(src.includes("'select'"));
  });

  it('has _buildSelector function', () => {
    assert.ok(src.includes('function _buildSelector'));
  });

  it('has _drawElementHighlight function', () => {
    assert.ok(src.includes('function _drawElementHighlight'));
  });

  it('has _serializeElement function', () => {
    assert.ok(src.includes('function _serializeElement'));
  });

  it('exposes getSelectedElement on public API', () => {
    assert.ok(src.includes('getSelectedElement'));
  });

  it('has _handleSelectMouseMove function', () => {
    assert.ok(src.includes('function _handleSelectMouseMove'));
  });

  it('has _handleSelectMouseDown function', () => {
    assert.ok(src.includes('function _handleSelectMouseDown'));
  });

  it('temporarily disables pointer-events for elementFromPoint', () => {
    assert.ok(src.includes("pointerEvents = 'none'"));
    assert.ok(src.includes("pointerEvents = 'auto'"));
  });

  it('strips script and style tags from outerHTML', () => {
    assert.ok(src.includes('<script'));
    assert.ok(src.includes('<\\/script>') || src.includes('</script>'));
    assert.ok(src.includes('<style'));
  });

  it('truncates outerHTML at 2000 chars', () => {
    assert.ok(src.includes('2000'));
    assert.ok(src.includes('truncated'));
  });

  it('draws margin, padding, and content boxes', () => {
    // Orange for margin
    assert.ok(src.includes('246, 178, 107') || src.includes('margin'));
    // Green for padding
    assert.ok(src.includes('147, 196, 125') || src.includes('padding'));
    // Blue for content
    assert.ok(src.includes('111, 168, 220') || src.includes('content'));
  });

  it('collects computed style properties', () => {
    assert.ok(src.includes('getComputedStyle'));
    assert.ok(src.includes('font-family'));
    assert.ok(src.includes('border-radius'));
    assert.ok(src.includes('background-color'));
  });

  it('serializes bounds with x, y, width, height', () => {
    assert.ok(src.includes('bounds'));
    assert.ok(src.includes('getBoundingClientRect'));
  });

  it('has tooltip and action bar elements', () => {
    assert.ok(src.includes('data-vm-tooltip'));
    assert.ok(src.includes('data-vm-actionbar'));
    assert.ok(src.includes('Send to Chat'));
    assert.ok(src.includes('Cancel'));
  });

  it('dispatches element-selected event via lens-shortcut', () => {
    assert.ok(src.includes('element-selected'));
  });

  it('cleans up select mode on disable()', () => {
    assert.ok(src.includes('_exitSelectMode'));
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test 2>&1 | grep -A 2 "element select"
```

Expected: FAIL — functions don't exist yet.

**Step 3: Implement the design-overlay.js changes from Task 1**

Apply all the code from Task 1 Steps 1-9.

**Step 4: Run tests**

```bash
npm test
```

Expected: All tests pass including the new element select tests.

**Step 5: Add `get_selected_element` action to design.rs**

In `src-tauri/src/commands/design.rs`, the command needs to return data from `ExecuteScript`. The simplest approach: make the command async and use the same `evaluate_js_with_result` pattern from `browser_bridge.rs`.

However, for simplicity, we can use a different approach: the `lens-shortcut://element-selected` event already fires from the JS. We handle the data retrieval on the frontend side by calling `designCommand('get_selected_element')` which uses `eval()` to read `window.vmDesign.getSelectedElement()` and return it via `lens-bridge`.

Actually, the cleanest approach: add a new **async** Tauri command `design_get_element` that uses `ExecuteScript` with a result callback:

Add to `design.rs`:

```rust
/// Get the selected element data from the design overlay.
/// Uses ExecuteScript (with result) instead of eval (fire-and-forget).
#[tauri::command]
pub async fn design_get_element(
    app: AppHandle,
    state: tauri::State<'_, super::lens::LensState>,
) -> Result<IpcResponse, String> {
    use crate::services::browser_bridge;

    let label = {
        let active_id = state
            .active_tab_id
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let active_id = match active_id.as_ref() {
            Some(id) => id.clone(),
            None => return Ok(IpcResponse::err("No active browser tab")),
        };
        let tabs = state
            .tabs
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        match tabs.get(&active_id) {
            Some(t) => t.webview_label.clone(),
            None => return Ok(IpcResponse::err("Active tab not found")),
        }
    };

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "WebView not found".to_string())?;

    let js = "JSON.stringify(window.vmDesign ? window.vmDesign.getSelectedElement() : null)";

    match browser_bridge::evaluate_js(&webview, js).await {
        Ok(result) => {
            if result == "null" || result.is_empty() {
                Ok(IpcResponse::err("No element selected"))
            } else {
                // Parse the JSON string returned by ExecuteScript
                match serde_json::from_str::<serde_json::Value>(&result) {
                    Ok(data) => Ok(IpcResponse::ok(data)),
                    Err(e) => Ok(IpcResponse::err(format!("Failed to parse element data: {}", e))),
                }
            }
        }
        Err(e) => Ok(IpcResponse::err(format!("ExecuteScript failed: {}", e))),
    }
}
```

**Note:** This depends on `browser_bridge::evaluate_js` being accessible. Check if it's `pub` or needs to be made public. If it's private, extract the relevant part or add a public wrapper.

**Step 6: Register the command in lib.rs**

In `src-tauri/src/lib.rs`, add `design_cmds::design_get_element` to the `.invoke_handler()` chain.

**Step 7: Add API wrapper in api.js**

```js
export async function designGetElement() {
  return invoke('design_get_element');
}
```

**Step 8: Run tests**

```bash
npm test
```

Expected: All tests pass.

**Step 9: Verify Rust compiles**

```bash
cd src-tauri && cargo check --tests
```

Expected: Compiles without errors.

**Step 10: Commit**

```bash
git add src-tauri/src/commands/design.rs src-tauri/src/lib.rs src/lib/api.js test/components/design-overlay.cjs
git commit -m "feat: add design_get_element command for retrieving selected element data"
```

---

### Task 3: Add Select Element Button to DesignToolbar.svelte

**Files:**
- Modify: `src/components/lens/DesignToolbar.svelte`

**Step 1: Write the test**

Add to existing tests or create `test/components/design-toolbar.cjs`:

```js
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DesignToolbar.svelte'),
  'utf-8'
);

describe('DesignToolbar.svelte — select element', () => {
  it('has a select tool in the tools array', () => {
    assert.ok(src.includes("id: 'select'"));
  });

  it('has a Select Element label', () => {
    assert.ok(src.includes('Select Element'));
  });

  it('imports designGetElement from api', () => {
    assert.ok(src.includes('designGetElement'));
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — 'select' tool not in toolbar yet.

**Step 3: Add the Select Element tool to the tools array**

In `DesignToolbar.svelte`, add to the `tools` array (as the first item, before pen, since it's most discoverable there):

```js
const tools = [
    { id: 'select', label: 'Select Element', icon: '' },
    { id: 'pen', label: 'Pen', icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z' },
    // ... rest unchanged
];
```

**Step 4: Add the select icon SVG in the template**

In the `{#each tools as tool}` block, add a case for `select` (alongside the existing `circle` and `pixelate` special cases):

```svelte
{:else if tool.id === 'select'}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 4h7v7H4z"/><path d="M15 3v3M21 9h-3M15 21v-3M3 9h3"/>
    <path d="M15 15h6v6h-6z" stroke-dasharray="2 2"/>
  </svg>
```

This is a cursor-in-selection-box icon. (Alternative: use a crosshair-in-box similar to Chrome DevTools' inspect icon.)

**Step 5: Add the import and send handler**

In the `<script>` block, add:

```js
import { designCommand, designGetElement, lensCapturePreview } from '../../lib/api.js';
```

Add the element send handler:

```js
async function handleElementSend() {
    try {
        // 1. Get serialized element data
        const elemResult = await designGetElement();
        if (!elemResult?.success || !elemResult?.data) {
            console.warn('[DesignToolbar] No element selected:', elemResult?.error);
            return;
        }
        const elem = elemResult.data;

        // 2. Capture full page screenshot
        const screenshotResult = await lensCapturePreview();
        if (!screenshotResult?.success || !screenshotResult?.data?.dataUrl) {
            console.warn('[DesignToolbar] Screenshot failed:', screenshotResult?.error);
            return;
        }

        // 3. Crop screenshot to element bounds
        const croppedDataUrl = await cropScreenshot(
            screenshotResult.data.dataUrl,
            elem.bounds
        );

        // 4. Format context text
        const styleLines = Object.entries(elem.styles || {})
            .map(([k, v]) => `  ${k}: ${v};`)
            .join('\n');

        const contextText = [
            `Selected element: ${elem.tagName}${elem.id ? '#' + elem.id : ''}${elem.classes ? '.' + elem.classes.split(' ').join('.') : ''}`,
            `Selector: ${elem.selector}`,
            `Size: ${elem.bounds.width} x ${elem.bounds.height}px`,
            elem.text ? `Text: "${elem.text}"` : null,
            '',
            'HTML:',
            elem.html,
            '',
            'Computed styles:',
            styleLines
        ].filter(Boolean).join('\n');

        // 5. Send to chat via onSend callback with element data
        onElementSend({
            imageDataUrl: croppedDataUrl,
            contextText: contextText,
            name: `Element: ${elem.selector.split(' > ').pop()}`
        });
    } catch (err) {
        console.error('[DesignToolbar] Element send failed:', err);
    }
}

/** Crop a data URL image to the given bounds using OffscreenCanvas. */
async function cropScreenshot(dataUrl, bounds) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Account for device pixel ratio — screenshot is at native resolution
            const dpr = window.devicePixelRatio || 1;
            const sx = Math.round(bounds.x * dpr);
            const sy = Math.round(bounds.y * dpr);
            const sw = Math.round(bounds.width * dpr);
            const sh = Math.round(bounds.height * dpr);

            // Clamp to image bounds
            const cx = Math.max(0, Math.min(sx, img.width));
            const cy = Math.max(0, Math.min(sy, img.height));
            const cw = Math.min(sw, img.width - cx);
            const ch = Math.min(sh, img.height - cy);

            if (cw <= 0 || ch <= 0) {
                resolve(dataUrl);  // Fallback to full screenshot
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(dataUrl);  // Fallback
        img.src = dataUrl;
    });
}
```

**Step 6: Add the `onElementSend` prop**

```js
let { onSend = () => {}, onClose = () => {}, onElementSend = () => {} } = $props();
```

**Step 7: Hide color/size controls when select tool is active**

Wrap the color group, size group, and undo/redo/clear sections in an `{#if}`:

```svelte
{#if activeTool !== 'select'}
  <div class="separator"></div>

  <!-- Color swatches -->
  <div class="color-group">
    ...
  </div>

  <div class="separator"></div>

  <!-- Size control -->
  <div class="size-group">
    ...
  </div>

  <div class="separator"></div>

  <!-- Undo / Redo / Clear -->
  <div class="action-group">
    ...
  </div>
{/if}
```

**Step 8: Run tests**

```bash
npm test
```

Expected: All tests pass.

**Step 9: Commit**

```bash
git add src/components/lens/DesignToolbar.svelte test/components/design-toolbar.cjs
git commit -m "feat: add Select Element button to design toolbar"
```

---

### Task 4: Wire Element Send to Chat in LensWorkspace.svelte

**Files:**
- Modify: `src/components/lens/LensWorkspace.svelte`

**Context:** `LensWorkspace` already has `handleDesignSend()` which captures a screenshot and adds it as an attachment. We need to add `handleElementSend()` that receives the cropped image + context text and adds both to chat.

**Step 1: Add the handler**

In `LensWorkspace.svelte`, after `handleDesignSend()`:

```js
/** Handle element selection from design toolbar — add cropped screenshot + context to chat. */
function handleElementSend({ imageDataUrl, contextText, name }) {
    // Add cropped element screenshot as attachment
    attachmentsStore.add({
        path: 'element-capture',
        dataUrl: imageDataUrl,
        type: 'image/png',
        name: name || 'Selected Element',
    });

    // Add context text as a prefilled message or second attachment
    // For now, add as a text attachment that gets prepended to the next message
    attachmentsStore.add({
        path: 'element-context',
        dataUrl: null,
        type: 'text/plain',
        name: 'Element Context',
        text: contextText,
    });

    lensStore.setDesignMode(false);
}
```

**Step 2: Pass onElementSend to DesignToolbar**

Find where `<DesignToolbar>` is rendered and add the prop:

```svelte
<DesignToolbar onSend={handleDesignSend} onElementSend={handleElementSend} onClose={() => lensStore.setDesignMode(false)} />
```

**Step 3: Update ChatInput to handle text attachments**

In `ChatInput.svelte` (or wherever messages are sent), check if any attachment has `type: 'text/plain'` and prepend its `text` to the message body instead of sending as an image.

**Step 4: Run tests**

```bash
npm test
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/components/lens/LensWorkspace.svelte
git commit -m "feat: wire element send to chat with cropped screenshot + context text"
```

---

### Task 5: Handle lens-shortcut://element-selected Event

**Files:**
- Modify: `src/components/lens/LensWorkspace.svelte` (or `LensPreview.svelte`)

**Context:** The design overlay JS fires `new Image().src = 'lens-shortcut://element-selected'` when "Send to Chat" is clicked in the action bar. We need to listen for this on the Rust side and either emit a Tauri event or handle it via the existing `lens-shortcut` URI scheme handler.

**Step 1: Check how `lens-shortcut` is handled**

Look at `src-tauri/src/lib.rs` for the custom URI scheme handler. Add a case for `element-selected` that emits a Tauri event.

**Step 2: Listen for the event in LensWorkspace.svelte**

```js
listen('lens-element-selected', async () => {
    await handleElementSend_fromOverlay();
});
```

Where `handleElementSend_fromOverlay()` calls `designGetElement()` → `lensCapturePreview()` → crop → send to chat.

**Step 3: Run tests**

```bash
npm test
```

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src/components/lens/LensWorkspace.svelte
git commit -m "feat: handle lens-shortcut element-selected event from design overlay"
```

---

### Task 6: Integration Test + Polish

**Files:**
- Create: `test/components/design-overlay.cjs` (if not done in Task 2)
- Modify: tests as needed

**Step 1: Add integration-level source inspection tests**

Verify the full wiring:

```js
// In test/api/api.cjs or test/api/api-design.cjs:
it('has designGetElement wrapper', () => {
    assert.ok(apiSrc.includes('export async function designGetElement'));
    assert.ok(apiSrc.includes("invoke('design_get_element')"));
});

// In test/components/lens-workspace.cjs:
it('handles onElementSend from DesignToolbar', () => {
    assert.ok(workspaceSrc.includes('handleElementSend'));
    assert.ok(workspaceSrc.includes('onElementSend'));
});
```

**Step 2: Verify Rust wiring**

```bash
cd src-tauri && cargo check --tests
```

**Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests pass (3860+ existing + ~15 new).

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: add source-inspection tests for select element feature"
```

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/src/assets/design-overlay.js` | Modify (+~200 lines) | Element select mode, highlight, tooltip, action bar, serializer |
| `src/components/lens/DesignToolbar.svelte` | Modify (+~80 lines) | Select Element button, crop helper, element send handler |
| `src/components/lens/LensWorkspace.svelte` | Modify (+~20 lines) | Wire handleElementSend to chat |
| `src-tauri/src/commands/design.rs` | Modify (+~40 lines) | `design_get_element` async command |
| `src-tauri/src/lib.rs` | Modify (+1 line) | Register `design_get_element` command |
| `src/lib/api.js` | Modify (+3 lines) | `designGetElement()` wrapper |
| `test/components/design-overlay.cjs` | Create (~60 lines) | Source inspection tests for element select |
| `test/components/design-toolbar.cjs` | Create (~20 lines) | Source inspection tests for toolbar |
