# Element Inspector Panel — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Branch:** feature/lens

## Summary

Add a Cursor-style Element Inspector panel that slides in on the right side of the browser area when the user selects an element using the design overlay's select tool. Replace the current minimal tooltip + "Deselect" action bar with a rich, theme-aware sidebar showing ELEMENT, PATH, ATTRIBUTES, COMPUTED STYLES, and POSITION & SIZE sections. Also update the select tool icon and relocate the design mode toggle button.

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

### 4. Element Selection Signals (WebView2 → Rust → Frontend)

**Problem:** `design-overlay.js` runs inside the child WebView2 and has no direct communication path to the Svelte frontend.

**Solution:** Use the existing `lens-shortcut://` URI scheme for fire-and-forget signals. The URI scheme handler is synchronous and cannot call async functions, so it only emits a lightweight Tauri event. The Svelte frontend handles the async data fetch.

**Important:** `design-overlay.js` runs in the child WebView2, so the handler that fires is `register_custom_scheme_handler()` in `src-tauri/src/commands/lens.rs` (not the main app handler in `lib.rs`).

**Selection flow:**
1. User clicks element in webview
2. `design-overlay.js` serializes element data to `_selectedElement` (existing behavior)
3. Fires: `new Image().src = 'lens-shortcut://element-selected'`
4. Child WebView2 URI scheme handler in `lens.rs` catches `element-selected`, emits Tauri event `element-selected` (no payload — fire-and-forget)
5. Svelte frontend listens for `element-selected` event, calls `designGetElement()` (existing async Tauri command) to fetch the full serialized data
6. Populates `ElementInspector` panel with the returned data

**Deselection flow:**
1. User clicks X in panel, clicks page background, or presses Escape
2. `design-overlay.js` fires: `new Image().src = 'lens-shortcut://element-deselected'`
3. Child WebView2 handler emits `element-deselected` event (no payload)
4. Svelte clears element data state, hides panel

**Additional deselection triggers:**
- **Navigation:** Listen for existing `lens-url-changed` event — clear the panel when the user navigates to a different URL (design-overlay.js state is destroyed on navigation)
- **Design mode off:** When `lensStore.designMode` is toggled off, clear the panel

**In-webview action bar removal:** Remove `_showSelectActionBar()` and `_removeSelectActionBar()` from `design-overlay.js`. The in-webview "Deselect" button is replaced by the ElementInspector panel's X button. The hover tooltip remains.

### 5. New Component: `ElementInspector.svelte`

**Location:** `src/components/lens/ElementInspector.svelte`

**Width:** ~300px fixed (not resizable in this iteration)

**Theme:** Uses CSS variables throughout — `var(--bg)`, `var(--text)`, `var(--border)`, `var(--text-secondary)`, etc. No hardcoded colors.

**Typography:** Monospace font for values, section headers in uppercase with subtle separator lines.

**Sections (top to bottom, scrollable):**

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

- Components tree / DOM hierarchy view
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
| `src-tauri/src/assets/design-overlay.js` | Add `attributes` to serialization, add lens-shortcut signals, remove action bar, use decimal-precision bounds |
| `src-tauri/src/commands/lens.rs` | Handle `element-selected`/`element-deselected` routes in child WebView2's `register_custom_scheme_handler()` |
| `test/components/design-overlay.test.cjs` | Tests for new attributes field, lens-shortcut signals, action bar removal |
| `test/components/element-inspector.test.cjs` | **New file** — tests for ElementInspector component |
