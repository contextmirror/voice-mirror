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
