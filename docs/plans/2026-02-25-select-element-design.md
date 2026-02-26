# Select Element — Design Document

**Date:** 2026-02-25
**Status:** Approved

## Summary

Add a "Select Element" tool to the Design Mode toolbar that lets users click on any element in the browser preview, captures a cropped screenshot + code context (HTML, computed styles, CSS selector), and sends it to the chat as context for any AI provider.

## Decisions

| Decision | Choice |
|----------|--------|
| Data captured | Cropped screenshot + CSS selector + outerHTML + computed styles |
| Button location | Inside Design Toolbar (new tool alongside pen, rect, arrow, etc.) |
| Scope | Any website (localhost, external sites, anything in the browser tab) |
| Hover visual | Chrome DevTools style (blue content, green padding, orange margin + tooltip) |
| Implementation | Extend `design-overlay.js` with element select mode (Approach A) |

## UX Flow

### Activating

1. User enters Design Mode (existing button)
2. Clicks "Select Element" tool (cursor-in-box icon)
3. Design overlay switches to element inspection mode

### Hovering

- Mousemove tracks `elementFromPoint(x, y)` on the underlying page
- Chrome DevTools-style highlight renders on the canvas:
  - Blue semi-transparent fill = content box
  - Green = padding area
  - Orange = margin area
  - Tooltip near cursor: `div.container` / `512 x 48`
- Cursor: crosshair

### Selecting

- Click locks the highlight in place
- Small floating action bar appears: **"Send to Chat"** / **"Cancel"**
- "Send to Chat" captures element data + cropped screenshot
- Element select mode returns to hover state (can select another)

### Cancelling

- Escape or "Cancel" → return to hover mode
- Click different tool → exit element select entirely

## Data Captured

When "Send to Chat" is triggered, three categories of data are captured:

### A. Visual (How it looks)

Cropped screenshot of just the selected element (PNG data URL), produced by taking a full `CapturePreview()` screenshot and cropping to the element's `getBoundingClientRect()` on the frontend via OffscreenCanvas.

### B. Code Context (What to write/modify)

- **outerHTML** — the element's HTML structure (max ~2000 chars, `<script>`/`<style>` stripped, `<!-- truncated -->` if cut)
- **textContent** — plain text inside the element (max ~200 chars, for understanding what the element says)
- **Computed styles** (key properties only):
  - Layout: `display`, `position`, `width`, `height`, `padding`, `margin`, `gap`, `flex-direction`, `align-items`, `justify-content`, `grid-template-*`
  - Visual: `color`, `background`, `background-color`, `border`, `border-radius`, `box-shadow`, `opacity`
  - Typography: `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`
- **CSS selector path** — e.g., `div.container > header.nav-bar > button.menu-toggle`
- **Bounding box** — `{ x, y, width, height }` viewport-relative

### C. Chat Format

The attachment sent to chat:

```
[Cropped screenshot attached as image]

Selected element: button.submit-btn
Selector: div.form-wrapper > form > button.submit-btn
Size: 120 x 40px
Text: "Submit Order"

HTML:
<button class="submit-btn" type="submit">
  <svg>...</svg>
  <span>Submit Order</span>
</button>

Computed styles:
  display: flex; align-items: center; gap: 8px;
  background-color: #4f46e5; color: #ffffff; border-radius: 8px;
  padding: 8px 16px; font-size: 14px; font-weight: 600;
```

## Technical Architecture

### Data Flow

```
"Select Element" tool clicked in DesignToolbar
  |
  v
designCommand('set_tool', { tool: 'select' })
  |
  v
Rust → webview.eval("window.vmDesign.setTool('select')")
  |
  v
design-overlay.js enters element select mode:
  - mousemove → pointer-events:none on canvas → elementFromPoint(x,y) → pointer-events:auto
  - getComputedStyle() + getBoundingClientRect() on hovered element
  - Draw DevTools-style highlight boxes on canvas
  - Show tooltip (tag.class / width x height)
  |
  v
User clicks → highlight locks
  - Serialize: outerHTML (trimmed), computed styles, selector, bounds, textContent
  - Store in window.vmDesign._selectedElement
  - Show action bar overlay ("Send to Chat" / "Cancel")
  |
  v
"Send to Chat" clicked
  |
  v
DesignToolbar.svelte:
  1. designCommand('get_selected_element') → ExecuteScript reads _selectedElement
  2. lensCapturePreview() → full page screenshot (CapturePreview PNG)
  3. Crop screenshot to element bounds via OffscreenCanvas
  4. Format context text (selector + HTML + styles)
  5. Add to chat: image attachment + context text
  6. Reset element select mode
```

### Files Modified

| File | Change | ~Lines |
|------|--------|--------|
| `src-tauri/src/assets/design-overlay.js` | Element select mode: hover detection, DevTools highlight renderer, tooltip, data serializer, action bar | +150-200 |
| `src/components/lens/DesignToolbar.svelte` | New "Select Element" button + "Send to Chat" flow (get element data, capture screenshot, crop, format, attach to chat) | +60-80 |
| `src-tauri/src/commands/design.rs` | Handle `get_selected_element` action via ExecuteScript (read `window.vmDesign._selectedElement`) | +15-20 |

### No New Files

Everything extends existing infrastructure:
- Design overlay JS (injection, canvas, tools)
- Design commands (Rust → webview.eval)
- Screenshot capture (CapturePreview)
- Chat attachments (image + text)

## Technical Concerns & Solutions

### 1. Canvas blocks elementFromPoint()

The design overlay canvas sits at `z-index: 999999`. Calling `elementFromPoint()` returns the canvas, not the page element.

**Solution:** Temporarily disable pointer events on the canvas during hit-testing:
```js
canvas.style.pointerEvents = 'none';
const el = document.elementFromPoint(x, y);
canvas.style.pointerEvents = 'auto';
```
Single-frame invisible toggle. Standard technique used by Chrome DevTools overlay.

### 2. outerHTML can be massive

Complex components (tables, SVG charts, etc.) can dump thousands of lines.

**Solution:**
- Strip `<script>` and `<style>` blocks
- Truncate at ~2000 chars with `<!-- truncated -->` marker
- Include `textContent` (200 chars) separately so the AI knows what the element says even when HTML is cut

### 3. Scroll position affects crop

`getBoundingClientRect()` returns viewport-relative coordinates, but `CapturePreview()` captures the visible viewport. If an element is partially off-screen, the crop math is wrong.

**Solution:** Element bounds from `getBoundingClientRect()` are already viewport-relative, matching the screenshot viewport. For elements partially off-screen, we clamp the crop to visible bounds. Fully off-screen elements get a "scroll to reveal" prompt instead.

### 4. Cross-origin iframes

`elementFromPoint()` cannot penetrate cross-origin iframes.

**Solution:** Accept the limitation for V1. The element picker selects the `<iframe>` element itself. Document this in the tooltip: "iframe (cross-origin — select iframe element)".

## CSS Selector Builder

Build a minimal, unique selector for the selected element:

```js
function buildSelector(el) {
  // 1. ID is unique — use it
  if (el.id) return `#${el.id}`;

  // 2. Build path from element to body
  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`#${current.id}`);
      break;  // ID is unique anchor
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      if (classes.length) selector += '.' + classes.join('.');
    }
    // Add nth-child if ambiguous
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(s => s.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-child(${idx})`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}
```

## DevTools-Style Highlight Renderer

Draws four overlay boxes from `getComputedStyle()` and `getBoundingClientRect()`:

```
+------ margin (orange, semi-transparent) ------+
|  +---- padding (green, semi-transparent) ----+ |
|  |  +-- content (blue, semi-transparent) --+  | |
|  |  |          element content             |  | |
|  |  +-------------------------------------+  | |
|  +--------------------------------------------+ |
+--------------------------------------------------+
```

Parse `margin`, `padding` from computed styles. Content box = `getBoundingClientRect()` minus padding. Draw each box as a filled rect with low alpha.

Tooltip floats below (or above if near bottom) showing: `tag.className — width x height`

## V2: Multi-Element Selection (Future)

- Shift+click adds elements to a selection set
- Each gets its own card/attachment in chat
- "Select similar" auto-finds elements matching the same selector pattern
- Useful for: "make these three buttons consistent", "this nav looks different from this nav"

## Prior Art

- [Lovable "Select & Edit"](https://lovable.dev/) — click elements to describe updates
- [Chrome DevTools Inspect Mode](https://developer.chrome.com/docs/devtools/inspect-mode) — the visual standard we're following
- [Chrome DevTools MCP #268](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/268) — proposal for AI element selection
- [Figma Dev Mode](https://www.figma.com/) — element inspection for design-to-code handoff
