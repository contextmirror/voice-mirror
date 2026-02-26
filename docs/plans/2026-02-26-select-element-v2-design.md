# Select Element v2 — Hidden Context, Parent Chain, Pseudo-Class Extraction

## Goal

Improve the Select Element feature so the AI receives rich context (screenshot, HTML, styles, parent layout, hover/focus rules) while the user sees only a clean screenshot thumbnail in chat. Enable the user to type/speak their instruction alongside the element selection before sending.

## Architecture

Three changes layered on top of the existing Select Element v1:

1. **Hidden context attachment** — element metadata rides on the attachment's `context` field, invisible to the user but prepended to the AI message
2. **Parent chain capture** — 2-3 levels of ancestor layout styles
3. **Pseudo-class CSS rule extraction** — scan stylesheets for `:hover`, `:focus`, `:active` rules

Plus a **pipeline fix**: `handleChatSend` currently drops element screenshots because it only reads files from disk. The fix adds `dataUrl` passthrough to the Rust backend.

## UX Flow

1. User selects element in design mode, clicks "Send to Chat" in toolbar
2. Cropped screenshot appears as a thumbnail in the ChatInput attachment strip
3. Design mode exits, chat panel opens, chat input is focused
4. User types/speaks their instruction: "Make this button rounder and blue"
5. User sends → chat bubble shows only the screenshot + their message text
6. AI receives: image (base64) + hidden element context prepended to the message

## Hidden Context Format

The `context` field on the attachment contains a structured text block. When routing to the AI, `handleChatSend` wraps it in delimiters and prepends it to the user's message:

```
[Element Context]
Selected element: button
Selector: section#FormControl > div > button.Primer_Brand_Button...
Size: 202 x 48px
Text: "Sign up for GitHub"

HTML:
<button class="...">Sign up for GitHub</button>

Parent chain:
  div.CtaFormControl-container (3 children: input, button, a)
    display: flex; gap: 16px; align-items: center;
  section#hero
    display: flex; flex-direction: column; padding: 48px 0;
  main.application-main
    display: block; max-width: 1280px; margin: 0 auto;

Pseudo-class rules:
  .Primer_Brand_Button:hover { background-color: #2ea44f; }
  .Primer_Brand_Button:focus { outline: 2px solid #0969da; }
  .Primer_Brand_Button:active { background-color: #1a7f37; }

Computed styles:
  background: rgb(26, 127, 55) none repeat scroll 0% 0% / auto padding-box border-box;
  border-radius: 6px;
  color: rgb(255, 255, 255);
  font-family: "Mona Sans", sans-serif;
  font-size: 16px;
  ...
[/Element Context]

Make this button rounder and blue
```

Total context is capped at 8,000 characters. HTML is already capped at 2,000. Truncation appends `[...truncated]`.

## Attachment Type Change

```js
// Before
@typedef {{ path: string, dataUrl?: string, type: string, name: string }} Attachment

// After
@typedef {{ path: string, dataUrl?: string, type: string, name: string, context?: string }} Attachment
```

The `context` field is optional. Only element captures set it. Regular screenshots and file attachments are unchanged.

## Parent Chain Capture

Walks `el.parentElement` up to 3 levels (stopping at `<body>` or `<html>`).

Per ancestor, captures:
- Tag name, id, key classes
- Layout-relevant computed styles: `display`, `flex-direction`, `flex-wrap`, `gap`, `align-items`, `justify-content`, `grid-template-columns`, `grid-template-rows`, `position`, `width`, `height`, `max-width`, `padding`, `margin`, `overflow`
- For the immediate parent: direct children count and tag names

Implementation location: `design-overlay.js` → `_serializeElement()`.

## Pseudo-Class CSS Rule Extraction

Scans `document.styleSheets` for rules matching the selected element that contain pseudo-class selectors.

Algorithm:
1. Iterate `document.styleSheets` → `sheet.cssRules`
2. Skip cross-origin sheets (catch `SecurityError`)
3. For each `CSSStyleRule`, check if `selectorText` contains `:hover`, `:focus`, `:active`, `:focus-visible`, or `:disabled`
4. Strip the pseudo-class from the selector, test `el.matches(strippedSelector)`
5. If match, collect `{ selector: selectorText, css: rule.cssText }`
6. Cap at 20 matching rules

Implementation location: `design-overlay.js` → new `_getPseudoClassRules(el)` function, called from `_serializeElement()`.

## Data Pipeline Fix

**Bug**: `handleChatSend` in `App.svelte` only sends `attachments[0].path` to Rust. For element captures, `path = 'element-capture'` (fake) → Rust fails to read → image lost.

**Fix**: Pass `dataUrl` alongside `path`. Rust commands prefer `dataUrl` when present, fall back to reading from `path`.

### Changes by file:

| File | Change |
|------|--------|
| `App.svelte` | `handleChatSend` reads `context` + `dataUrl` from attachment, prepends context to text |
| `api.js` | `aiPtyInput()` and `writeUserMessage()` accept optional `imageDataUrl` param |
| `commands/ai.rs` | Both commands accept `image_data_url: Option<String>`, prefer over file read |
| `providers/api.rs` | `send_message_with_image()` accepts optional inline data URL |
| `providers/cli.rs` | CLI provider passes `image_data_url` through to MCP pipe message |

## Chat Rendering

- **ChatBubble**: No changes needed. Already renders attachments as `<img>` tags using `att.dataUrl || att.path`. The `context` field is simply never accessed during rendering.
- **ChatInput**: No changes to the thumbnail strip. The `context` field is ignored during preview.
- **ChatInput focus**: After queuing the element attachment, the chat input textarea receives focus so the user can immediately type.

## Queue-Then-Send vs Auto-Send

v1 auto-sends the message immediately. v2 changes to queue-then-send:

- Element screenshot becomes a pending attachment in the ChatInput strip
- User types/speaks their instruction
- User hits Enter to send
- This matches how screenshots already work
- Allows the user to compose a thoughtful request alongside the visual

## Context Size Limits

| Content | Cap |
|---------|-----|
| HTML (`outerHTML`) | 2,000 chars (existing) |
| Computed styles | ~30 properties (existing) |
| Parent chain | 3 levels max |
| Pseudo-class rules | 20 rules max |
| Total context string | 8,000 chars |

## Files to Modify

| File | Purpose |
|------|---------|
| `src-tauri/src/assets/design-overlay.js` | Parent chain + pseudo-class extraction in `_serializeElement()` |
| `src/lib/stores/attachments.svelte.js` | Add `context?: string` to typedef |
| `src/components/lens/LensWorkspace.svelte` | Queue attachment instead of auto-send, set context field, focus input |
| `src/components/lens/DesignToolbar.svelte` | Format enriched context string |
| `src/App.svelte` | `handleChatSend` reads context + dataUrl from attachment |
| `src/lib/api.js` | Update `aiPtyInput`, `writeUserMessage` wrappers |
| `src-tauri/src/commands/ai.rs` | Accept `image_data_url` param |
| `src-tauri/src/providers/api.rs` | Support inline data URL |
| `src-tauri/src/providers/cli.rs` | Pass `image_data_url` to MCP |

## Real-World Testing Results (2026-02-26)

First live test of Select Element v2 with Claude Code (Opus 4.6) in voice mode, testing against two sites:

### Test 1: contextmirror.com (localhost:4321, Astro + Tailwind)

**Element**: "Get Started" button (`a.glow-hover`)

**Results**: Excellent. Full data captured:
- Selector path: accurate, navigable CSS selector through section → div → a
- HTML: clean anchor tag with SVG arrow icon
- Parent chain: 3 levels — flex container (gap 16px), block wrapper (padding-top 80px), 2-column grid (gap 48px, 592px columns)
- Pseudo-class rules: ✅ Captured `.glow-hover:hover` with `box-shadow` and `border-color` — this is a Tailwind `@layer` rule and it was successfully extracted
- Computed styles: all 20+ properties present — border-radius (pill), padding, font, colors

**AI assessment**: Could recreate this element at ~95-100% fidelity from the captured data alone. The pseudo-class hover data was especially valuable — provides the full glow effect specification.

### Test 2: stripe.com (production, custom design system "hds")

**Element**: "Get started" button (`a.hds-button.hds-button--primary`)

**Results**: Very good, with one notable gap:
- Selector path: accurate, includes Stripe's BEM-style class names
- HTML: anchor with SVG hover-arrow icon, `data-analytics-label` attribute
- Parent chain: 3 levels — flex button group (gap 8px), 12-column grid (twelve 88px columns, interesting responsive grid), centered container (max-width 1266px)
- Pseudo-class rules: ❌ **None captured** — Stripe likely uses CSS-in-JS or scoped/constructed stylesheets that `document.styleSheets` iteration can't access
- Computed styles: complete — purple background (rgb 83, 58, 253), sohne-var font, 4px border-radius, asymmetric padding (15.5px top, 16.5px bottom for optical centering)

**AI assessment**: Could recreate at ~90% fidelity. Missing hover/active/focus states. The 12-column grid parent chain data was particularly useful for understanding Stripe's layout system.

### Key Findings

| Aspect | contextmirror | stripe.com | Notes |
|--------|--------------|------------|-------|
| Selector accuracy | ✅ | ✅ | Both produced navigable, unique selectors |
| HTML capture | ✅ | ✅ | Clean, includes inline SVGs |
| Parent chain | ✅ 3 levels | ✅ 3 levels | Grid template data was especially useful |
| Pseudo-class rules | ✅ Captured | ❌ Missing | Stripe's CSS-in-JS defeats `document.styleSheets` scan |
| Computed styles | ✅ Complete | ✅ Complete | ~20 properties each, sufficient for recreation |
| AI recreation confidence | 95-100% | ~90% | Gap is hover/transition states |

### Gaps Identified

1. **CSS-in-JS / Constructed Stylesheets**: Sites using styled-components, Emotion, or native `CSSStyleSheet()` (adopted stylesheets) may not expose rules through `document.styleSheets`. Stripe is a likely example. **Fix**: Also check `document.adoptedStyleSheets` and shadow DOM `adoptedStyleSheets`.

2. **Transition/Animation Properties**: Neither capture included `transition`, `animation`, `transform`, or `will-change` in the computed styles list. These are critical for recreating interactive feel. **Fix**: Add to the computed style property list in `_serializeElement()`.

3. **Font Files**: The AI knows the font name (`sohne-var`, `Inter`) but not whether it's a web font, system font, or variable font. **Fix**: Check `document.fonts` API for the matched font face and include `@font-face` src if available.

4. **Hover State Capture**: No way to capture the element in its hovered state. The pseudo-class CSS extraction works for stylesheet rules, but misses JavaScript-driven hover effects. **Potential fix**: Programmatically dispatch `mouseenter`/`mouseover` events, capture computed styles, then dispatch `mouseleave` — comparing before/after to surface JS-driven hover changes.

5. **Responsive Behavior**: Only captures styles at current viewport width. Cannot infer how the element adapts. **Fix**: See v3 `@media` rule extraction below.

## Potential v3 Enhancements

Ideas surfaced from real-world testing with Claude Code:

### Accessibility Attributes
Capture `aria-*`, `role`, `tabindex`, `alt`, and `lang` attributes on the selected element. These are lightweight to extract (already available on the DOM node) and would let the AI suggest accessibility improvements alongside visual changes. Implementation: add an `accessibility` object to `_serializeElement()` return value.

### Responsive Breakpoint Behavior
Scan `document.styleSheets` for `@media` rules that match the selected element, similar to the pseudo-class extraction. This would tell the AI how the element adapts across screen sizes (e.g., `@media (max-width: 768px) { .hero { flex-direction: column; } }`). Implementation: extend `_getPseudoClassRules` pattern to also walk `CSSMediaRule` → `CSSStyleRule` children, testing `el.matches()` on each.

### Adopted Stylesheets Support
Check `document.adoptedStyleSheets` and shadow root `adoptedStyleSheets` for CSS-in-JS frameworks that use constructed stylesheets. This would close the Stripe-style gap where pseudo-class rules were missing.

### Transition & Animation Capture
Add `transition`, `animation`, `transform`, `will-change`, and `animation-*` properties to the computed style extraction list. These are essential for recreating interactive behavior.

### Hover State Diff
Programmatically trigger hover state, capture computed styles, compare with resting state, and include only the changed properties as a "hover diff." This would catch JavaScript-driven hover effects that CSS rule scanning misses.
