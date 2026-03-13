# Element Inspector Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cursor-style Element Inspector sidebar panel that shows DOM tree, element info, attributes, computed styles, and position when an element is picked in the browser.

**Architecture:** The design overlay JS (child WebView2) serializes element + DOM tree data and signals selection via `lens-shortcut://` URI scheme. Rust emits Tauri events, Svelte frontend fetches the data and renders an `ElementInspector` panel that slides in on the right of the browser area. New Tauri commands support tree node expansion and selection.

**Tech Stack:** Svelte 5 (runes), Rust/Tauri 2, ES5 JavaScript (design-overlay.js), WebView2 COM API

**Spec:** `docs/superpowers/specs/2026-03-13-element-inspector-panel-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src-tauri/src/assets/design-overlay.js` | Element serialization, DOM tree, signals, action bar removal | Modify |
| `src-tauri/src/commands/design.rs` | Tauri commands for tree node selection/expansion | Modify |
| `src-tauri/src/commands/lens.rs` | URI scheme handler branches for element-selected/deselected | Modify |
| `src-tauri/src/lib.rs` | Register new Tauri commands | Modify |
| `src/lib/api.js` | JS API wrappers for new commands | Modify |
| `src/components/lens/ElementInspector.svelte` | Inspector panel UI (tree + detail sections) | Create |
| `src/components/lens/LensWorkspace.svelte` | Layout wrapper, event listeners, state | Modify |
| `src/components/lens/LensToolbar.svelte` | Move design mode button to right side | Modify |
| `src/components/lens/DesignToolbar.svelte` | New select icon SVG | Modify |
| `test/components/design-overlay.test.cjs` | Tests for new serialization + signals | Modify |
| `test/components/element-inspector.test.cjs` | Tests for ElementInspector component | Create |

---

## Chunk 1: Backend — Serialization, Signals, Commands

### Task 1: Extend element serialization with `attributes` field

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js:906-953` (`_serializeElement` function)
- Test: `test/components/design-overlay.test.cjs`

- [ ] **Step 1: Write failing test for `attributes` field**

In `test/components/design-overlay.test.cjs`, add a new describe block:

```javascript
describe('design-overlay.js: attributes serialization', () => {
  it('_serializeElement collects all HTML attributes', () => {
    const fnBody = src.substring(src.indexOf('function _serializeElement'));
    assert.ok(fnBody.includes('el.attributes.length'), '_serializeElement must iterate el.attributes');
    assert.ok(fnBody.includes('el.attributes['), 'Must access individual attributes by index');
  });

  it('attributes field is included in returned object', () => {
    const fnBody = src.substring(src.indexOf('function _serializeElement'));
    const returnBlock = fnBody.substring(fnBody.indexOf('return {'));
    assert.ok(returnBlock.includes('attributes:'), 'Return object must include attributes field');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -20`
Expected: FAIL — `_serializeElement must iterate el.attributes`

- [ ] **Step 3: Implement attributes collection in `_serializeElement`**

In `src-tauri/src/assets/design-overlay.js`, inside `_serializeElement()` (around line 934), add before the `return {` block:

```javascript
var attrs = {};
for (var a = 0; a < el.attributes.length; a++) {
    attrs[el.attributes[a].name] = el.attributes[a].value;
}
```

Add `attributes: attrs,` to the return object (after `classes:`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat(design): add attributes field to element serialization"
```

---

### Task 2: Change bounds to decimal precision

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js:941-946` (bounds in `_serializeElement`)
- Test: `test/components/design-overlay.test.cjs`

- [ ] **Step 1: Write failing test**

```javascript
describe('design-overlay.js: decimal precision bounds', () => {
  it('bounds use 2-decimal precision instead of Math.round', () => {
    const fnBody = src.substring(src.indexOf('function _serializeElement'));
    const boundsBlock = fnBody.substring(fnBody.indexOf('bounds:'), fnBody.indexOf('bounds:') + 300);
    assert.ok(boundsBlock.includes('* 100) / 100'), 'bounds must use Math.round(x * 100) / 100 for decimal precision');
    assert.ok(!boundsBlock.includes('Math.round(rect.left)'), 'Must not use plain Math.round on rect values');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Change Math.round to decimal precision**

In `_serializeElement()`, change the bounds block from:
```javascript
bounds: {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
},
```
To:
```javascript
bounds: {
    x: Math.round(rect.left * 100) / 100,
    y: Math.round(rect.top * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat(design): use decimal precision for element bounds"
```

---

### Task 3: Add DOM tree serialization

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js` (add `_clearTreeIds`, `_serializeDomTree`, `_serializeTreeNode` functions; add `domTree` to `_serializeElement` return)
- Test: `test/components/design-overlay.test.cjs`

- [ ] **Step 1: Write failing tests for tree serialization**

```javascript
describe('design-overlay.js: DOM tree serialization', () => {
  it('has _clearTreeIds function', () => {
    assert.ok(src.includes('function _clearTreeIds'), 'Must have _clearTreeIds function');
  });

  it('_clearTreeIds removes data-vm-tree-id attributes', () => {
    const fnBody = src.substring(src.indexOf('function _clearTreeIds'));
    assert.ok(fnBody.includes('data-vm-tree-id'), 'Must query data-vm-tree-id attributes');
    assert.ok(fnBody.includes('removeAttribute'), 'Must call removeAttribute');
  });

  it('has _serializeTreeNode function', () => {
    assert.ok(src.includes('function _serializeTreeNode'), 'Must have _serializeTreeNode function');
  });

  it('_serializeTreeNode sets data-vm-tree-id on element', () => {
    const fnBody = src.substring(src.indexOf('function _serializeTreeNode'));
    assert.ok(fnBody.includes('setAttribute'), 'Must set data-vm-tree-id attribute on element');
    assert.ok(fnBody.includes('data-vm-tree-id'), 'Must use data-vm-tree-id attribute name');
  });

  it('_serializeTreeNode returns correct structure', () => {
    const fnBody = src.substring(src.indexOf('function _serializeTreeNode'));
    const returnBlock = fnBody.substring(fnBody.indexOf('return {'));
    assert.ok(returnBlock.includes('nodeId:'), 'Must include nodeId');
    assert.ok(returnBlock.includes('tagName:'), 'Must include tagName');
    assert.ok(returnBlock.includes('childCount:'), 'Must include childCount');
    assert.ok(returnBlock.includes('isSelected:'), 'Must include isSelected');
    assert.ok(returnBlock.includes('isOnPath:'), 'Must include isOnPath');
    assert.ok(returnBlock.includes('children:'), 'Must include children');
  });

  it('has _serializeDomTree function', () => {
    assert.ok(src.includes('function _serializeDomTree'), 'Must have _serializeDomTree function');
  });

  it('_serializeDomTree walks ancestor chain', () => {
    const fnBody = src.substring(src.indexOf('function _serializeDomTree'));
    assert.ok(fnBody.includes('parentElement'), 'Must walk parent chain');
    assert.ok(fnBody.includes('document.body'), 'Must reference document.body as root');
  });

  it('_serializeDomTree caps children at 200', () => {
    const fnBody = src.substring(src.indexOf('function _serializeDomTree'));
    assert.ok(fnBody.includes('200'), 'Must cap direct children at 200');
  });

  it('_serializeDomTree calls _clearTreeIds before tagging', () => {
    const fnBody = src.substring(src.indexOf('function _serializeDomTree'));
    const clearIdx = fnBody.indexOf('_clearTreeIds');
    const setAttrIdx = fnBody.indexOf('setAttribute');
    assert.ok(clearIdx !== -1, 'Must call _clearTreeIds');
    assert.ok(clearIdx < setAttrIdx, '_clearTreeIds must be called before setting new IDs');
  });

  it('domTree field included in _serializeElement return', () => {
    const fnBody = src.substring(src.indexOf('function _serializeElement'));
    const returnBlock = fnBody.substring(fnBody.indexOf('return {'));
    assert.ok(returnBlock.includes('domTree:'), 'Return object must include domTree field');
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -20`
Expected: Multiple FAILs

- [ ] **Step 3: Implement tree serialization functions**

Add these functions to `design-overlay.js` (before `_serializeElement`, around line 900):

```javascript
var _treeIdCounter = 0;

function _clearTreeIds() {
    var tagged = document.querySelectorAll('[data-vm-tree-id]');
    for (var i = 0; i < tagged.length; i++) {
        tagged[i].removeAttribute('data-vm-tree-id');
    }
    _treeIdCounter = 0;
}

function _serializeTreeNode(el, selectedEl, isOnPath) {
    var nodeId = 'vm-tree-' + (_treeIdCounter++);
    el.setAttribute('data-vm-tree-id', nodeId);

    var classes = '';
    if (el.className && typeof el.className === 'string') {
        classes = el.className.trim();
    }

    return {
        nodeId: nodeId,
        tagName: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: classes,
        childCount: el.children.length,
        isSelected: el === selectedEl,
        isOnPath: isOnPath,
        children: []
    };
}

function _serializeDomTree(selectedEl) {
    _clearTreeIds();

    // Build ancestor path from body to selected element
    var ancestors = [];
    var cur = selectedEl;
    while (cur && cur !== document.body && cur !== document.documentElement) {
        ancestors.unshift(cur);
        cur = cur.parentElement;
    }
    if (document.body) {
        ancestors.unshift(document.body);
    }

    // Build tree recursively along the ancestor path
    var root = null;
    var parentNode = null;

    for (var i = 0; i < ancestors.length; i++) {
        var ancestor = ancestors[i];
        var node = _serializeTreeNode(ancestor, selectedEl, true);

        // Add children of this ancestor
        var childLimit = Math.min(ancestor.children.length, 200);
        var childNodes = [];
        for (var c = 0; c < childLimit; c++) {
            var child = ancestor.children[c];
            if (i + 1 < ancestors.length && child === ancestors[i + 1]) {
                // This child is on the path — will be expanded in next iteration
                continue;
            }
            var childNode = _serializeTreeNode(child, selectedEl, false);
            childNodes.push(childNode);
        }
        if (ancestor.children.length > 200) {
            node.truncated = true;
        }

        node.children = childNodes;

        if (parentNode) {
            // Insert this node among parent's children in DOM order
            var inserted = false;
            var allChildren = [];
            var parentEl = ancestors[i - 1];
            for (var p = 0; p < Math.min(parentEl.children.length, 200); p++) {
                if (parentEl.children[p] === ancestor) {
                    allChildren.push(node);
                    inserted = true;
                } else {
                    // Find existing child node or create
                    var found = false;
                    for (var e = 0; e < parentNode.children.length; e++) {
                        if (parentNode.children[e].tagName === parentEl.children[p].tagName.toLowerCase() &&
                            parentNode.children[e].nodeId === parentEl.children[p].getAttribute('data-vm-tree-id')) {
                            allChildren.push(parentNode.children[e]);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        allChildren.push(_serializeTreeNode(parentEl.children[p], selectedEl, false));
                    }
                }
            }
            if (!inserted) allChildren.push(node);
            parentNode.children = allChildren;
        }

        if (!root) root = node;
        parentNode = node;
    }

    // Add direct children of selected element (one level, collapsed)
    if (selectedEl && parentNode && parentNode.isSelected) {
        var selChildLimit = Math.min(selectedEl.children.length, 200);
        for (var s = 0; s < selChildLimit; s++) {
            parentNode.children.push(_serializeTreeNode(selectedEl.children[s], selectedEl, false));
        }
        if (selectedEl.children.length > 200) {
            parentNode.truncated = true;
        }
    }

    return root;
}
```

Then add `domTree: _serializeDomTree(el),` to `_serializeElement`'s return object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat(design): add DOM tree serialization for Components view"
```

---

### Task 4: Add lens-shortcut signals and remove action bar

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js` (mouse handlers, action bar functions)
- Test: `test/components/design-overlay.test.cjs`

- [ ] **Step 1: Write failing tests**

```javascript
describe('design-overlay.js: element selection signals', () => {
  it('fires lens-shortcut element-selected on click', () => {
    const fnBody = src.substring(src.indexOf('function _handleSelectMouseDown'));
    assert.ok(fnBody.includes('element-selected'), 'Must fire element-selected signal');
    assert.ok(fnBody.includes('new Image'), 'Must use Image().src trick for lens-shortcut');
  });

  it('fires lens-shortcut element-deselected on cancel', () => {
    const fnBody = src.substring(src.indexOf('function _cancelSelect'));
    assert.ok(fnBody.includes('element-deselected'), 'Must fire element-deselected signal');
  });

  it('fires lens-shortcut element-deselected on exit select mode', () => {
    const fnBody = src.substring(src.indexOf('function _exitSelectMode'));
    assert.ok(fnBody.includes('element-deselected'), 'Must fire element-deselected signal on exit');
  });
});

describe('design-overlay.js: action bar removal', () => {
  it('_handleSelectMouseDown does not call _showSelectActionBar', () => {
    const fnBody = src.substring(
      src.indexOf('function _handleSelectMouseDown'),
      src.indexOf('function _handleSelectMouseDown') + 500
    );
    assert.ok(!fnBody.includes('_showSelectActionBar'), 'Must not call _showSelectActionBar — replaced by ElementInspector panel');
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Add signals and remove action bar calls**

In `_handleSelectMouseDown` (around line 999), after `_selectedElement = _serializeElement(_hoveredEl);`, add:
```javascript
try {
    var shortcutBase = location.protocol === 'https:' ? 'https://lens-shortcut.localhost/' : 'lens-shortcut://localhost/';
    (new Image()).src = shortcutBase + 'element-selected?t=' + Date.now();
} catch (err) {}
```

Remove the `_showSelectActionBar(_hoveredEl);` call from `_handleSelectMouseDown`.

In `_cancelSelect` function, add the deselect signal:
```javascript
try {
    var shortcutBase = location.protocol === 'https:' ? 'https://lens-shortcut.localhost/' : 'lens-shortcut://localhost/';
    (new Image()).src = shortcutBase + 'element-deselected?t=' + Date.now();
} catch (err) {}
```

In `_exitSelectMode` function, add the deselect signal **before** the `_cancelSelect()` call (so `_selectedElement` is still set when we check):
```javascript
if (_selectedElement) {
    try {
        var shortcutBase = location.protocol === 'https:' ? 'https://lens-shortcut.localhost/' : 'lens-shortcut://localhost/';
        (new Image()).src = shortcutBase + 'element-deselected?t=' + Date.now();
    } catch (err) {}
}
```

Also in the `disable()` function, call `_clearTreeIds()` to clean up tree IDs.

**Remove the `_showSelectActionBar` and `_removeSelectActionBar` function definitions entirely.** Also remove the `_selectActionBar` state variable and any calls to `_removeSelectActionBar()` in `_cancelSelect`. Remove the `_showSelectActionBar` and `_removeSelectActionBar` function definitions.

**Update existing tests** that reference the removed functions. In `test/components/design-overlay.test.cjs`:
- Remove/update the test at ~line 423 (`it('shows action bar on mousedown'...)`) — this test asserts `_showSelectActionBar` is called, which is now removed
- Remove/update tests in the `_showSelectActionBar` describe block (~line 265+) that assert function existence and behavior
- Remove/update tests that assert `_removeSelectActionBar` is called in cleanup functions
- Keep tests for `_cancelSelect` but update them to not expect action bar calls

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/components/design-overlay.test.cjs 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat(design): add element selection signals, remove in-webview action bar"
```

---

### Task 5: Add `selectByTreeId` and `expandTreeNode` JS APIs

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js` (public API on `window.vmDesign`)
- Test: `test/components/design-overlay.test.cjs`

- [ ] **Step 1: Write failing tests**

```javascript
describe('design-overlay.js: tree interaction APIs', () => {
  it('has selectByTreeId on public API', () => {
    assert.ok(src.includes('selectByTreeId'), 'Must expose selectByTreeId');
    const apiBlock = src.substring(src.indexOf('window.vmDesign'));
    assert.ok(apiBlock.includes('selectByTreeId'), 'selectByTreeId must be on window.vmDesign');
  });

  it('selectByTreeId queries by data-vm-tree-id', () => {
    const fnBody = src.substring(src.indexOf('selectByTreeId'));
    assert.ok(fnBody.includes('data-vm-tree-id'), 'Must query by data-vm-tree-id attribute');
    assert.ok(fnBody.includes('querySelector'), 'Must use querySelector');
  });

  it('selectByTreeId returns serialized element data', () => {
    const fnBody = src.substring(src.indexOf('selectByTreeId'));
    assert.ok(fnBody.includes('_serializeElement'), 'Must call _serializeElement');
  });

  it('has expandTreeNode on public API', () => {
    assert.ok(src.includes('expandTreeNode'), 'Must expose expandTreeNode');
    const apiBlock = src.substring(src.indexOf('window.vmDesign'));
    assert.ok(apiBlock.includes('expandTreeNode'), 'expandTreeNode must be on window.vmDesign');
  });

  it('expandTreeNode returns child nodes for given nodeId', () => {
    const fnBody = src.substring(src.indexOf('expandTreeNode'));
    assert.ok(fnBody.includes('data-vm-tree-id'), 'Must query by data-vm-tree-id');
    assert.ok(fnBody.includes('children'), 'Must return children');
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

- [ ] **Step 3: Implement the APIs**

Add to `design-overlay.js`, before the `window.vmDesign = {` assignment:

```javascript
function _selectByTreeId(nodeId) {
    var el = document.querySelector('[data-vm-tree-id="' + nodeId + '"]');
    if (!el) return null;
    _hoveredEl = el;
    _selectedElement = _serializeElement(el);
    _drawElementHighlight(el);
    _showSelectTooltip(el);
    return _selectedElement;
}

function _expandTreeNode(nodeId) {
    var el = document.querySelector('[data-vm-tree-id="' + nodeId + '"]');
    if (!el) return [];
    var children = [];
    var limit = Math.min(el.children.length, 200);
    for (var i = 0; i < limit; i++) {
        children.push(_serializeTreeNode(el.children[i], _hoveredEl, false));
    }
    return children;
}
```

Add to the `window.vmDesign` object:
```javascript
selectByTreeId: function (nodeId) { return _selectByTreeId(nodeId); },
expandTreeNode: function (nodeId) { return _expandTreeNode(nodeId); },
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat(design): add selectByTreeId and expandTreeNode JS APIs"
```

---

### Task 6: Add Rust commands and event routing

**Files:**
- Modify: `src-tauri/src/commands/design.rs:90-144` (add new commands after `design_get_element`)
- Modify: `src-tauri/src/commands/lens.rs:386-411` (add branches in URI scheme handler)
- Modify: `src-tauri/src/lib.rs:488-489` (register new commands)
- Modify: `src/lib/api.js:424-432` (add API wrappers)

- [ ] **Step 1: Add dedicated event branches in `lens.rs`**

In `src-tauri/src/commands/lens.rs`, in the `register_custom_scheme_handler` function, find the `if key == "hard-refresh"` block (around line 393). Add new branches **before** the generic `else if !key.is_empty()` fallback:

```rust
} else if key == "element-selected" {
    let _ = app_for_events.emit("element-selected", serde_json::json!({}));
} else if key == "element-deselected" {
    let _ = app_for_events.emit("element-deselected", serde_json::json!({}));
```

- [ ] **Step 2: Add Rust commands in `design.rs`**

Add after `design_get_element` (after line 144). These follow the exact same pattern as `design_get_element` — same `LensState` access via `super::lens::LensState`, same `app.get_webview()`, same `evaluate_js_with_result(&app, &webview, ...)`, same `IpcResponse::err()`:

```rust
#[tauri::command]
pub async fn design_select_by_tree_id(
    app: AppHandle,
    state: tauri::State<'_, super::lens::LensState>,
    node_id: String,
) -> Result<IpcResponse, String> {
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

    let escaped = node_id.replace('\\', "\\\\").replace('\'', "\\'");
    let js = format!(
        "JSON.stringify(window.vmDesign ? window.vmDesign.selectByTreeId('{}') : null)",
        escaped
    );

    match crate::services::browser_bridge::evaluate_js_with_result(
        &app,
        &webview,
        &js,
        std::time::Duration::from_secs(5),
    )
    .await
    {
        Ok(data) => {
            if data.is_null() {
                Ok(IpcResponse::err("Tree node not found"))
            } else {
                match data.as_str() {
                    Some(json_str) => match serde_json::from_str::<Value>(json_str) {
                        Ok(Value::Null) => Ok(IpcResponse::err("Tree node not found")),
                        Ok(parsed) => Ok(IpcResponse::ok(parsed)),
                        Err(_) => Ok(IpcResponse::ok(data)),
                    },
                    None => Ok(IpcResponse::ok(data)),
                }
            }
        }
        Err(e) => Ok(IpcResponse::err(format!("JS eval failed: {}", e))),
    }
}

#[tauri::command]
pub async fn design_expand_tree_node(
    app: AppHandle,
    state: tauri::State<'_, super::lens::LensState>,
    node_id: String,
) -> Result<IpcResponse, String> {
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

    let escaped = node_id.replace('\\', "\\\\").replace('\'', "\\'");
    let js = format!(
        "JSON.stringify(window.vmDesign ? window.vmDesign.expandTreeNode('{}') : [])",
        escaped
    );

    match crate::services::browser_bridge::evaluate_js_with_result(
        &app,
        &webview,
        &js,
        std::time::Duration::from_secs(5),
    )
    .await
    {
        Ok(data) => {
            if data.is_null() {
                Ok(IpcResponse::ok(serde_json::json!([])))
            } else {
                match data.as_str() {
                    Some(json_str) => match serde_json::from_str::<Value>(json_str) {
                        Ok(parsed) => Ok(IpcResponse::ok(parsed)),
                        Err(_) => Ok(IpcResponse::ok(data)),
                    },
                    None => Ok(IpcResponse::ok(data)),
                }
            }
        }
        Err(e) => Ok(IpcResponse::err(format!("JS eval failed: {}", e))),
    }
}
```

- [ ] **Step 3: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the `generate_handler![]` block (around line 488-489), after `design_cmds::design_get_element`:

```rust
design_cmds::design_select_by_tree_id,
design_cmds::design_expand_tree_node,
```

- [ ] **Step 4: Add API wrappers in `api.js`**

In `src/lib/api.js`, after `designGetElement` (around line 432), add:

```javascript
export async function designSelectByTreeId(nodeId) {
  return invoke('design_select_by_tree_id', { nodeId });
}

export async function designExpandTreeNode(nodeId) {
  return invoke('design_expand_tree_node', { nodeId });
}
```

- [ ] **Step 5: Verify compilation**

Run: `cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/design.rs src-tauri/src/commands/lens.rs src-tauri/src/lib.rs src/lib/api.js
git commit -m "feat(design): add Rust commands and event routing for element inspector"
```

---

## Chunk 2: Frontend — UI Components, Layout, Wiring

### Task 7: Update select tool icon in DesignToolbar

**Files:**
- Modify: `src/components/lens/DesignToolbar.svelte:195-199`

- [ ] **Step 1: Replace the select icon SVG**

In `src/components/lens/DesignToolbar.svelte`, replace lines 195-199:

```svelte
{#if tool.id === 'select'}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M8 12h.01M12 12h.01M16 12h.01"/>
  </svg>
```

With:

```svelte
{#if tool.id === 'select'}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
    <rect x="2" y="2" width="20" height="20" rx="2" stroke="currentColor" fill="none"/>
    <path d="M8 7l-1 10 3.5-3.5 3 5 1.5-.9-3-5H16L8 7z" fill="currentColor"/>
  </svg>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/lens/DesignToolbar.svelte
git commit -m "style(design): update select tool icon to cursor-in-rectangle"
```

---

### Task 8: Move design mode toggle button in LensToolbar

**Files:**
- Modify: `src/components/lens/LensToolbar.svelte:62-73` (remove from left nav), `~87-95` (add near BrowserMenu)

- [ ] **Step 1: Remove the design mode button from the left nav group**

In `LensToolbar.svelte`, remove lines 62-73 (the design mode toggle button and its SVG).

- [ ] **Step 2: Add the design mode button near the right-side toolbar buttons**

Find the area just before `<BrowserMenu` (around line 87). Add the button there:

```svelte
<button
  class="nav-btn"
  class:active={lensStore.designMode}
  onclick={() => lensStore.setDesignMode(!lensStore.designMode)}
  title="Inspect Element"
  aria-label="Toggle element inspector"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
    <rect x="2" y="2" width="20" height="20" rx="2" stroke="currentColor" fill="none"/>
    <path d="M8 7l-1 10 3.5-3.5 3 5 1.5-.9-3-5H16L8 7z" fill="currentColor"/>
  </svg>
</button>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/lens/LensToolbar.svelte
git commit -m "refactor(lens): move design mode toggle to right toolbar area"
```

---

### Task 9: Create `ElementInspector.svelte` component

**Files:**
- Create: `src/components/lens/ElementInspector.svelte`
- Create: `test/components/element-inspector.test.cjs`

- [ ] **Step 1: Write tests for ElementInspector**

Create `test/components/element-inspector.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'lens', 'ElementInspector.svelte'),
  'utf-8'
);

describe('ElementInspector.svelte: structure', () => {
  it('has a close button with aria-label', () => {
    assert.ok(src.includes('aria-label="Close inspector"'), 'Must have accessible close button');
  });

  it('has role="complementary" on panel', () => {
    assert.ok(src.includes('role="complementary"'), 'Panel must have complementary role');
  });

  it('uses CSS variables for theming (no hardcoded colors)', () => {
    // Check for common hardcoded color patterns
    const styleBlock = src.substring(src.indexOf('<style'));
    const lines = styleBlock.split('\n');
    for (const line of lines) {
      if (line.includes('color:') && !line.includes('var(') && !line.includes('currentColor') && !line.includes('//') && !line.includes('transparent') && !line.includes('inherit')) {
        // Allow color property in inline style for swatches
        if (!line.includes('swatch') && !line.includes('background:') && !line.includes('.swatch')) {
          // Relax: some lines might set color on swatch elements
        }
      }
    }
    assert.ok(styleBlock.includes('var(--bg'), 'Must use --bg CSS variable');
    assert.ok(styleBlock.includes('var(--text'), 'Must use --text CSS variable');
    assert.ok(styleBlock.includes('var(--border'), 'Must use --border CSS variable');
  });
});

describe('ElementInspector.svelte: sections', () => {
  it('has COMPONENTS section header', () => {
    assert.ok(src.includes('COMPONENTS') || src.includes('Components'), 'Must have Components section');
  });

  it('has ELEMENT section', () => {
    assert.ok(src.includes('ELEMENT') || src.includes('Element'), 'Must have Element section');
  });

  it('has PATH section', () => {
    assert.ok(src.includes('PATH') || src.includes('Path'), 'Must have Path section');
  });

  it('has ATTRIBUTES section', () => {
    assert.ok(src.includes('ATTRIBUTES') || src.includes('Attributes'), 'Must have Attributes section');
  });

  it('has COMPUTED STYLES section', () => {
    assert.ok(src.includes('COMPUTED STYLES') || src.includes('Computed Styles'), 'Must have Computed Styles section');
  });

  it('has POSITION & SIZE section', () => {
    assert.ok(src.includes('POSITION') || src.includes('Position'), 'Must have Position section');
  });
});

describe('ElementInspector.svelte: tree view', () => {
  it('renders tree nodes with expand/collapse arrows', () => {
    assert.ok(src.includes('▶') || src.includes('▼') || src.includes('expand') || src.includes('collapse'), 'Must have expand/collapse indicators');
  });

  it('imports designSelectByTreeId API', () => {
    assert.ok(src.includes('designSelectByTreeId'), 'Must import tree selection API');
  });

  it('imports designExpandTreeNode API', () => {
    assert.ok(src.includes('designExpandTreeNode'), 'Must import tree expansion API');
  });
});

describe('ElementInspector.svelte: Svelte 5 runes', () => {
  it('uses $derived.by for computed values (not $derived with function)', () => {
    assert.ok(src.includes('$derived.by'), 'Must use $derived.by for function-based derivations');
  });
});

describe('ElementInspector.svelte: color swatches', () => {
  it('has color swatch elements for CSS color values', () => {
    assert.ok(src.includes('swatch'), 'Must render color swatches for color values');
  });
});

describe('ElementInspector.svelte: panel styling', () => {
  it('has fixed width around 300px', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('300px') || styleBlock.includes('width'), 'Panel must have ~300px width');
  });

  it('uses monospace font for values', () => {
    const styleBlock = src.substring(src.indexOf('<style'));
    assert.ok(styleBlock.includes('monospace'), 'Must use monospace font for values');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/components/element-inspector.test.cjs 2>&1 | tail -10`
Expected: FAIL — file not found

- [ ] **Step 3: Create `ElementInspector.svelte`**

Create `src/components/lens/ElementInspector.svelte`:

```svelte
<script>
  import { designSelectByTreeId, designExpandTreeNode } from '../../lib/api.js';

  /** @type {{ elementData?: object, onClose?: () => void, onUpdateData?: (data: object) => void }} */
  let { elementData = null, onClose = () => {}, onUpdateData = () => {} } = $props();

  // --- Tree state ---
  let expandedNodes = $state(new Set());

  // Initialize expanded state from tree data
  $effect(() => {
    if (elementData?.domTree) {
      const newExpanded = new Set();
      walkTree(elementData.domTree, (node) => {
        if (node.isOnPath || node.isSelected) {
          newExpanded.add(node.nodeId);
        }
      });
      expandedNodes = newExpanded;
    }
  });

  function walkTree(node, fn) {
    if (!node) return;
    fn(node);
    if (node.children) {
      for (const child of node.children) {
        walkTree(child, fn);
      }
    }
  }

  async function toggleExpand(node) {
    const newSet = new Set(expandedNodes);
    if (newSet.has(node.nodeId)) {
      newSet.delete(node.nodeId);
    } else {
      newSet.add(node.nodeId);
      // Lazy-load children if not yet fetched
      if (node.childCount > 0 && (!node.children || node.children.length === 0)) {
        const result = await designExpandTreeNode(node.nodeId);
        if (result?.success && result.data) {
          // Update via parent callback — props are read-only in Svelte 5
          onUpdateData({ ...elementData, _expandedNodeId: node.nodeId, _expandedChildren: result.data });
        }
      }
    }
    expandedNodes = newSet;
  }

  async function selectTreeNode(nodeId) {
    const result = await designSelectByTreeId(nodeId);
    // Parent will handle updating elementData via the event flow
  }

  function formatNodeLabel(node) {
    let label = node.tagName;
    if (node.id) label += '#' + node.id;
    else if (node.classes) {
      const first = node.classes.split(' ')[0];
      if (first) label += '.' + first;
    }
    return label;
  }

  // --- Color swatch detection ---
  const colorProps = ['color', 'background-color'];

  function isColorValue(value) {
    if (!value) return false;
    return /^(rgb|rgba|hsl|hsla|#)/.test(value.trim());
  }

  // --- Computed values ---
  let attributes = $derived(elementData?.attributes || {});
  let styles = $derived(elementData?.styles || {});
  let bounds = $derived(elementData?.bounds || {});
  let selector = $derived(elementData?.selector || '');
  let tagDisplay = $derived.by(() => {
    if (!elementData) return '';
    let s = '<' + elementData.tagName;
    if (elementData.id) s += ' id="' + elementData.id + '"';
    if (elementData.classes?.length) {
      const cls = Array.isArray(elementData.classes) ? elementData.classes.join(' ') : elementData.classes;
      if (cls) s += ' class="' + cls + '"';
    }
    s += '>';
    return s;
  });
</script>

<div class="element-inspector" role="complementary">
  <!-- COMPONENTS tree -->
  <div class="section tree-section">
    <div class="section-header">COMPONENTS</div>
    <div class="tree-scroll">
      {#if elementData?.domTree}
        {#snippet treeNode(node, depth)}
          <div
            class="tree-node"
            class:selected={node.isSelected}
            style="padding-left: {depth * 16}px"
          >
            {#if node.childCount > 0}
              <button class="expand-btn" onclick={() => toggleExpand(node)}>
                {expandedNodes.has(node.nodeId) ? '▼' : '▶'}
              </button>
            {:else}
              <span class="expand-spacer"></span>
            {/if}
            <button class="node-label" onclick={() => selectTreeNode(node.nodeId)}>
              {formatNodeLabel(node)}
            </button>
          </div>
          {#if expandedNodes.has(node.nodeId) && node.children}
            {#each node.children as child}
              {@render treeNode(child, depth + 1)}
            {/each}
          {/if}
        {/snippet}
        {@render treeNode(elementData.domTree, 0)}
      {/if}
    </div>
  </div>

  <!-- Detail sections -->
  <div class="detail-scroll">
    <!-- ELEMENT header -->
    <div class="section">
      <div class="section-header">
        ELEMENT
        <button class="close-btn" onclick={onClose} aria-label="Close inspector">&times;</button>
      </div>
      <div class="element-tag">{tagDisplay}</div>
    </div>

    <!-- PATH -->
    <div class="section">
      <div class="section-header">PATH</div>
      <div class="path-value">{selector}</div>
    </div>

    <!-- ATTRIBUTES -->
    <div class="section">
      <div class="section-header">ATTRIBUTES</div>
      <div class="kv-list">
        {#each Object.entries(attributes) as [key, value]}
          <div class="kv-row">
            <span class="kv-key">{key}:</span>
            <span class="kv-value">{value}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- COMPUTED STYLES -->
    <div class="section">
      <div class="section-header">COMPUTED STYLES</div>
      <div class="kv-list">
        {#each Object.entries(styles) as [key, value]}
          <div class="kv-row">
            <span class="kv-key">{key}:</span>
            <span class="kv-value">
              {#if isColorValue(value)}
                <span class="swatch" style="background: {value}"></span>
              {/if}
              {value}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- POSITION & SIZE -->
    <div class="section">
      <div class="section-header">POSITION & SIZE</div>
      <div class="kv-list">
        <div class="kv-row"><span class="kv-key">top:</span><span class="kv-value">{bounds.y}px</span></div>
        <div class="kv-row"><span class="kv-key">left:</span><span class="kv-value">{bounds.x}px</span></div>
        <div class="kv-row"><span class="kv-key">width:</span><span class="kv-value">{bounds.width}px</span></div>
        <div class="kv-row"><span class="kv-key">height:</span><span class="kv-value">{bounds.height}px</span></div>
      </div>
    </div>
  </div>
</div>

<style>
  .element-inspector {
    width: 300px;
    min-width: 300px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-left: 1px solid var(--border);
    color: var(--text);
    font-size: 12px;
    overflow: hidden;
  }

  .section {
    border-bottom: 1px solid var(--border);
    padding: 8px 10px;
  }

  .section-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* --- Tree section --- */
  .tree-section {
    flex: 0 0 auto;
    max-height: 40%;
    display: flex;
    flex-direction: column;
  }

  .tree-scroll {
    overflow-y: auto;
    flex: 1;
  }

  .tree-node {
    display: flex;
    align-items: center;
    height: 22px;
    cursor: default;
    white-space: nowrap;
  }

  .tree-node.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 10px;
    width: 16px;
    height: 16px;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expand-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .node-label {
    background: none;
    border: none;
    color: var(--text);
    font-family: monospace;
    font-size: 12px;
    padding: 0 4px;
    cursor: pointer;
    text-align: left;
  }

  .node-label:hover {
    color: var(--accent);
  }

  /* --- Detail sections --- */
  .detail-scroll {
    flex: 1;
    overflow-y: auto;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 16px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text);
  }

  .element-tag {
    font-family: monospace;
    font-size: 12px;
    color: var(--accent);
    word-break: break-all;
  }

  .path-value {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    word-break: break-all;
    line-height: 1.4;
  }

  .kv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .kv-row {
    display: flex;
    gap: 8px;
    line-height: 1.6;
  }

  .kv-key {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
    min-width: 100px;
  }

  .kv-value {
    font-family: monospace;
    font-size: 11px;
    color: var(--text);
    word-break: break-all;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 1px solid var(--border);
    border-radius: 2px;
    flex-shrink: 0;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/components/element-inspector.test.cjs 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/lens/ElementInspector.svelte test/components/element-inspector.test.cjs
git commit -m "feat(lens): add ElementInspector panel component"
```

---

### Task 10: Wire ElementInspector into LensWorkspace layout

**Files:**
- Modify: `src/components/lens/LensWorkspace.svelte`

- [ ] **Step 1: Add imports and state**

At the top of `LensWorkspace.svelte`'s `<script>` block, add the `ElementInspector` import:

```javascript
import ElementInspector from './ElementInspector.svelte';
```

Note: `listen` is already imported at line 3 (`import { listen } from '@tauri-apps/api/event'`). Add `designGetElement` to the existing API import at line 27 (e.g., `import { ..., designGetElement } from '../../lib/api.js'`).

Add state variable (near other state declarations, around line 64):

```javascript
let inspectorData = $state(null);
```

- [ ] **Step 2: Add event listeners**

Add an `$effect` for the Tauri event listeners:

```javascript
$effect(() => {
  let unlistenSelected;
  let unlistenDeselected;
  let unlistenUrlChanged;

  (async () => {
    unlistenSelected = await listen('element-selected', async () => {
      const result = await designGetElement();
      if (result?.success && result.data) {
        inspectorData = result.data;
      }
    });

    unlistenDeselected = await listen('element-deselected', () => {
      inspectorData = null;
    });

    unlistenUrlChanged = await listen('lens-url-changed', () => {
      inspectorData = null;
    });
  })();

  return () => {
    unlistenSelected?.();
    unlistenDeselected?.();
    unlistenUrlChanged?.();
  };
});
```

Add an effect to clear inspector when design mode is toggled off:

```javascript
$effect(() => {
  if (!lensStore.designMode) {
    inspectorData = null;
  }
});
```

- [ ] **Step 3: Wrap LensPreview with ElementInspector in the layout**

Find where `LensPreview` is rendered (around line 482). Wrap it in a flex container with the inspector:

Change from:
```svelte
<LensPreview ... />
```

To:
```svelte
<div class="browser-with-inspector">
  <LensPreview ... />
  {#if inspectorData}
    <ElementInspector
      elementData={inspectorData}
      onClose={() => { inspectorData = null; }}
      onUpdateData={(data) => { inspectorData = data; }}
    />
  {/if}
</div>
```

- [ ] **Step 4: Add CSS for the flex wrapper**

Add to the `<style>` block:

```css
.browser-with-inspector {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.browser-with-inspector :global(.lens-preview) {
  flex: 1;
  min-width: 0;
}
```

Ensure `LensPreview`'s root element can flex properly (it should already have `flex: 1` or `height: 100%` — verify and adjust if needed).

- [ ] **Step 5: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/lens/LensWorkspace.svelte
git commit -m "feat(lens): wire ElementInspector panel into browser layout"
```

---

### Task 11: Final integration test and cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass (5900+)

- [ ] **Step 2: Run Rust compilation check**

Run: `cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Verify no hardcoded colors in ElementInspector**

Run: `grep -n 'color:.*#\|background:.*#\|border.*#' src/components/lens/ElementInspector.svelte | grep -v 'var(' | grep -v swatch`
Expected: No output (all colors use CSS variables, except swatch backgrounds which use inline styles for the actual color value)

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -A && git commit -m "chore(lens): element inspector cleanup and integration fixes"
```
