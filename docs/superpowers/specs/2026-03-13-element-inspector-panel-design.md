# Element Inspector Panel — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Branch:** feature/lens

## Summary

Add a Cursor-style Element Inspector panel that slides in on the right side of the browser area when the user selects an element using the design overlay's select tool. Replace the current minimal tooltip + "Deselect" action bar with a rich, theme-aware sidebar showing a Components tree (DOM hierarchy) at the top and element detail sections (ELEMENT, PATH, ATTRIBUTES, COMPUTED STYLES, POSITION & SIZE) below. Also update the select tool icon and relocate the design mode toggle button.

## Motivation

The current element picker shows a one-line tooltip (`tag#id.class | W x H`) and a "Deselect" button. All rich data (attributes, styles, parent chain, accessibility) is only visible after sending to chat. Cursor's element picker shows a detailed info panel immediately on selection, giving the user instant context without leaving their workflow.

## Changes

### 1. Icon Change

Replace the select tool icon in `DesignToolbar.svelte` from three-dots-in-rectangle to a mouse-cursor-in-rectangle SVG:

```svg
<svg viewBox="0 0 24 24">
  <rect x="2" y="2" width="20" height="20" rx="2" stroke="currentColor" fill="none" stroke-width="1.5"/>
  <path d="M8 7l-1 10 3.5-3.5 3 5 1.5-.9-3-5H16L8 7z" fill="currentColor"/>
</svg>
```

### 2. Move Design Mode Toggle Button

The design mode toggle button currently lives in `LensToolbar.svelte`'s left nav group (next to back/forward/reload). Move it to the **right side** of `LensToolbar`, near the existing `BrowserMenu` (`...`) / zoom / downloads / history buttons. This groups it with other browser-level actions and frees the left area for future buttons (e.g., Console).

### 3. Extend Element Serialization

Add an `attributes` field to `_serializeElement()` in `design-overlay.js` that captures ALL HTML attributes as a key-value object:

```javascript
var attrs = {};
for (var k = 0; k < el.attributes.length; k++) {
    attrs[el.attributes[k].name] = el.attributes[k].value;
}
```

This supplements the existing `tagName`, `id`, `classes`, `bounds`, `html`, `text`, `styles`, `parentChain`, `pseudoRules`, and `accessibility` fields.

### 3b. DOM Tree Serialization

Add a `domTree` field to the serialized element data that captures the DOM hierarchy for the Components tree view. The tree is scoped to keep payload size reasonable:

**What to include:**
- Full ancestor chain from `document.body` to the selected element (all expanded)
- Direct children of each ancestor (siblings of the path — shown but collapsed)
- Direct children of the selected element (one level, collapsed)

**Tree node structure:**
```javascript
{
    nodeId: 'vm-tree-0',   // unique ID for this node, also set as data-vm-tree-id attribute on the DOM element
    tagName: 'div',
    id: '',                 // HTML id attribute
    classes: 'RNNXgb',     // space-separated class string
    childCount: 3,          // total children count (to show expand arrow even when children not loaded)
    isSelected: false,      // is this the picked element
    isOnPath: true,         // is this on the ancestor path (determines initial expanded state)
    children: [...]         // nested tree nodes (only populated for expanded/on-path nodes)
}
```

**Serialization function `_serializeDomTree(selectedEl)`:**
1. Walk from `document.body` down to `selectedEl` via the ancestor chain
2. At each ancestor level, serialize direct children as tree nodes (cap at 200 children per parent; if exceeded, set `truncated: true` on the parent node)
3. For children that are on the path to `selectedEl`, recurse and include their children
4. For children NOT on the path, set `children: []` (collapsed — can be expanded later)
5. Tag each serialized DOM element with `data-vm-tree-id` attribute for later selection

**Tree ID cleanup:** Before tagging elements, remove all existing `data-vm-tree-id` attributes from the page (query `[data-vm-tree-id]` and strip). Also strip all tree IDs when:
- Design mode is disabled (`disable()`)
- A new element is selected (strip before re-tagging)
- The overlay is destroyed

**Lazy expansion:** When the user expands a collapsed node in the tree, the frontend calls a new design command `design_expand_tree_node(nodeId)` which runs JS in the webview to serialize that subtree and return it. This avoids serializing the entire DOM upfront.

**Tree node selection:** When the user clicks a node in the Components tree, the frontend calls a new design command `design_select_by_tree_id(nodeId)` which uses `evaluate_js_with_result()` to run JS in the webview and return the result directly:
1. Finds the element via `document.querySelector('[data-vm-tree-id="nodeId"]')`
2. Sets it as the selected element
3. Re-serializes element data + tree (strips old tree IDs, re-tags)
4. Returns the full serialized data directly to the frontend (no `lens-shortcut` round-trip needed — the frontend initiated this call, so it gets the response via the Tauri command return value)

Note: `lens-shortcut://element-selected` is only used for user-initiated clicks in the webview (where JS is the initiator). For tree node clicks, the Svelte frontend is the initiator, so a direct return via `evaluate_js_with_result()` is cleaner.

### 4. Element Selection Signals (WebView2 → Rust → Frontend)

**Problem:** `design-overlay.js` runs inside the child WebView2 and has no direct communication path to the Svelte frontend.

**Solution:** Use the existing `lens-shortcut://` URI scheme for fire-and-forget signals. The URI scheme handler is synchronous and cannot call async functions, so it only emits a lightweight Tauri event. The Svelte frontend handles the async data fetch.

**Important:** `design-overlay.js` runs in the child WebView2, so the handler that fires is `register_custom_scheme_handler()` in `src-tauri/src/commands/lens.rs` (not the main app handler in `lib.rs`).

**Event routing:** The `lens.rs` `register_custom_scheme_handler()` currently has explicit branches for `hard-refresh` and `url-changed`, with a generic fallback that emits `lens-shortcut` with `{ key }`. Add **dedicated `else if` branches** for `element-selected` and `element-deselected` that emit them as separate Tauri events (not via the generic `lens-shortcut` event). This matches the pattern used by `url-changed` → `lens-url-changed`. The Svelte frontend listens for these dedicated events directly via `listen('element-selected', ...)` in `LensWorkspace.svelte`.

**Selection flow:**
1. User clicks element in webview
2. `design-overlay.js` serializes element data to `_selectedElement` (existing behavior)
3. Fires: `new Image().src = 'lens-shortcut://element-selected'`
4. Child WebView2 URI scheme handler in `lens.rs` catches `element-selected` (dedicated branch), emits Tauri event `element-selected` (no payload)
5. `LensWorkspace.svelte` listens for `element-selected` event, calls `designGetElement()` (existing async Tauri command) to fetch the full serialized data
6. Populates `ElementInspector` panel with the returned data

**Deselection flow:**
1. User clicks X in panel, clicks page background, or presses Escape
2. `design-overlay.js` fires: `new Image().src = 'lens-shortcut://element-deselected'`
3. Child WebView2 handler emits `element-deselected` event (dedicated branch, no payload)
4. `LensWorkspace.svelte` clears element data state, hides panel

**Additional deselection triggers:**
- **Navigation:** Listen for existing `lens-url-changed` event — clear the panel when the user navigates to a different URL (design-overlay.js state is destroyed on navigation)
- **Design mode off:** When `lensStore.designMode` is toggled off, clear the panel

**In-webview action bar removal:** Remove `_showSelectActionBar()` and `_removeSelectActionBar()` from `design-overlay.js`. The in-webview "Deselect" button is replaced by the ElementInspector panel's X button. The hover tooltip remains.

### 5. New Component: `ElementInspector.svelte`

**Location:** `src/components/lens/ElementInspector.svelte`

**Width:** ~300px fixed (not resizable in this iteration)

**Theme:** Uses CSS variables throughout — `var(--bg)`, `var(--text)`, `var(--border)`, `var(--text-secondary)`, etc. No hardcoded colors.

**Typography:** Monospace font for values, section headers in uppercase with subtle separator lines.

**Panel layout (top to bottom):**

#### COMPONENTS (tree view — top portion, ~40% of panel height, independently scrollable)

Matches Cursor's "Components" section. A collapsible DOM tree showing the hierarchy.

**Rendering:**
- Each node rendered as: `tagName.className` or `tagName#id` or just `tagName`
  - Examples: `div.RNNXgb`, `textarea#APjFqb`, `style`
- Indentation via `padding-left: depth * 16px`
- Expand/collapse arrow (`▶`/`▼`) on nodes with `childCount > 0`
- Selected element highlighted with accent background color (`var(--accent)` at low opacity)
- Ancestor path nodes shown expanded by default
- Non-path siblings shown collapsed by default

**Interactions:**
- Click arrow to expand/collapse a subtree (lazy-loads children if not yet fetched)
- Click node label to select that element (triggers re-pick via `design_select_by_tree_id`)
- Hover node to highlight the corresponding element in the webview (nice-to-have, not required for v1)

**Separator** — thin border line between Components tree and detail sections below

#### ELEMENT (header)
- Close (X) button aligned right
- Element tag rendered as: `<textarea id="APjFqb" class="gLFyf">`

#### PATH
- Full CSS selector path from `_buildSelector()`, word-wrapping enabled
- Uses existing selector format (nth-of-type for disambiguation, stops at IDs)
- Example: `div.L3eUgb > div.o3j99 > form > div:nth-of-type(1) > div.A8SBwf > div.RNNXgb > div.SDkEP > div.a4blc > textarea#APjFqb`

#### ATTRIBUTES
- Two-column key-value layout (attribute name left, value right)
- All HTML attributes listed
- Empty values shown as blank (not omitted)

#### COMPUTED STYLES
- Key computed style properties with values
- Color values display an inline color swatch (small square) before the RGB value
- Properties shown: `color`, `background-color`, `font-size`, `font-family`, `display`, `position`
  - These match Cursor's selection; all 22 properties from existing serialization are available in the data and can be shown with a "Show all" toggle in a future iteration
  - Use kebab-case consistently (matching CSS property names and existing serialization)

#### POSITION & SIZE
- `top`, `left`, `width`, `height` values from `getBoundingClientRect()`
- Values shown with decimal precision (e.g., `443.36px`)
- Note: existing `_serializeElement` uses `Math.round()` for bounds — change to `Math.round(x * 100) / 100` to preserve 2 decimal places

**Accessibility:**
- Close button: `aria-label="Close inspector"`
- Panel container: `role="complementary"`

**Interactions:**
- X button deselects element and closes panel
- Clicking a different element in the webview updates the panel in-place
- Escape key deselects (existing behavior in design-overlay.js)

### 6. Layout Change in `LensWorkspace.svelte`

Wrap the `LensPreview` area in a horizontal flex container:

```
┌──────────────────────────────┬─────────────────┐
│                              │ ElementInspector │
│  LensPreview (WebView2)     │ (~300px, right)  │
│  (flex: 1, shrinks to fit)  │                  │
│                              │ Scrollable       │
└──────────────────────────────┴─────────────────┘
```

- The `ElementInspector` is conditionally rendered when element data exists
- `LensPreview` uses `flex: 1` and shrinks when the panel appears
- The panel appears/disappears without animation (simple conditional render)

### 7. Updated Toolbar Stack

```
BrowserTabBar
LensToolbar (URL bar, nav, ..., [inspect icon], zoom, downloads, history)
DesignToolbar (conditional — drawing tools, when design mode on)
FindBar
┌──────────────────────────────┬─────────────────┐
│  LensPreview                 │ ElementInspector │
└──────────────────────────────┴─────────────────┘
```

## Not In Scope

- Console button (separate future brainstorm)
- Resizable inspector panel (can upgrade to SplitPanel later)
- Changes to the "Send to Chat" flow (still works via DesignToolbar button)
- Hover tooltip changes (stays as-is: one-line `tag#id.class | W x H`)

## Files Affected

| File | Change |
|------|--------|
| `src/components/lens/DesignToolbar.svelte` | New select icon SVG |
| `src/components/lens/LensToolbar.svelte` | Move design mode toggle to right side (near BrowserMenu) |
| `src/components/lens/ElementInspector.svelte` | **New file** — inspector panel |
| `src/components/lens/LensWorkspace.svelte` | Layout: flex wrapper around LensPreview + ElementInspector; listen for element events |
| `src-tauri/src/assets/design-overlay.js` | Add `attributes` + `domTree` to serialization, add lens-shortcut signals, remove action bar, use decimal-precision bounds, add `selectByTreeId()` + `expandTreeNode()` APIs |
| `src-tauri/src/commands/design.rs` | Add `design_select_by_tree_id` and `design_expand_tree_node` Tauri commands |
| `src-tauri/src/commands/lens.rs` | Add dedicated `element-selected`/`element-deselected` branches in `register_custom_scheme_handler()` |
| `src-tauri/src/lib.rs` | Register new Tauri commands (`design_select_by_tree_id`, `design_expand_tree_node`) in `generate_handler![]` |
| `src/lib/api.js` | Add `designSelectByTreeId()` and `designExpandTreeNode()` API wrappers |
| `test/components/design-overlay.test.cjs` | Tests for new attributes field, domTree serialization, tree ID cleanup, lens-shortcut signals, action bar removal |
| `test/components/element-inspector.test.cjs` | **New file** — tests for ElementInspector component |
