# Accessibility Extraction for Element Picker (Lightweight)

**Date:** 2026-02-26
**Branch:** feature/lens
**Scope:** `design-overlay.js`, `DesignToolbar.svelte`, tests

## Problem

The element picker captures CSS selectors, computed styles, parent chain, and pseudo-class rules, but zero accessibility data. ARIA roles, attributes, and HTML states are high-signal context that helps the AI generate semantic, accessible code. Playwright MCP proved that accessibility data is the single highest-value signal for AI element understanding.

## Approach

**Approach B: Separate `_getAccessibility(el)` helper** — follows the existing pattern of `_getParentChain()` and `_getPseudoClassRules()`. Extensible for future medium/comprehensive tiers.

## Data Captured

### `_getAccessibility(el)` return shape

```js
{
  role: "button",                         // explicit role attr OR implicit from tag
  ariaAttributes: {                       // all aria-* attrs as key-value pairs
    "aria-label": "Close dialog",
    "aria-expanded": "false"
  },
  htmlStates: ["disabled", "required"],   // truthy boolean HTML attributes
  inputType: "email"                      // only for <input>, null otherwise
}
```

### Implicit Role Lookup

Explicit `role` attribute wins. Otherwise, derive from tag:

| Tag | Role | Tag | Role |
|-----|------|-----|------|
| `a` (with href) | link | `nav` | navigation |
| `button` | button | `main` | main |
| `input[text]` | textbox | `header` | banner |
| `input[checkbox]` | checkbox | `footer` | contentinfo |
| `input[radio]` | radio | `aside` | complementary |
| `input[range]` | slider | `form` | form |
| `input[number]` | spinbutton | `section` | region |
| `select` | combobox | `ul` / `ol` | list |
| `textarea` | textbox | `li` | listitem |
| `img` | img | `dialog` | dialog |
| `table` | table | `progress` | progressbar |
| `h1`-`h6` | heading | `details` | group |
| `summary` | button | `output` | status |
| `meter` | meter | `option` | option |
| `fieldset` | group | `legend` | — |
| `article` | article | `hr` | separator |

If neither explicit nor implicit role matches, `role` is `null`.

### ARIA Attributes

Iterate `el.attributes`, collect any with name starting with `aria-`. No filtering — every ARIA attribute is potentially useful.

### HTML States

Fixed checklist: `disabled`, `required`, `checked`, `readonly`, `hidden`, `contenteditable`. Only include truthy values.

### Input Type

If `el.tagName === 'INPUT'`, capture `el.type`. Otherwise `null`.

## Integration

### `_serializeElement()` change

```js
return {
    selector: selector,
    tagName: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: ...,
    bounds: ...,
    html: html,
    text: text,
    styles: styles,
    parentChain: _getParentChain(el),
    pseudoRules: _getPseudoClassRules(el),
    accessibility: _getAccessibility(el)   // NEW
};
```

### Context formatting (DesignToolbar.svelte)

Add accessibility lines between element header and HTML, only when non-empty:

```
Selected element: button#submit.btn.primary
Selector: form > button#submit.btn.primary
Size: 120 x 40px
Role: button
ARIA: aria-label="Submit form"; aria-disabled="false"
States: disabled
Text: "Submit"

HTML:
<button id="submit" class="btn primary" ...>
```

## Files Changed

1. `src-tauri/src/assets/design-overlay.js` — new `_getAccessibility(el)` helper, wire into `_serializeElement()`
2. `src/components/lens/DesignToolbar.svelte` — format accessibility fields in context text
3. `test/components/design-overlay.test.cjs` — test helper function, role lookup, ARIA collection, states, input type
4. `test/components/design-toolbar.test.cjs` — test context formatting includes Role/ARIA/States lines

## Out of Scope

- `computeAccessibleName()` (medium tier, future)
- Landmark/heading hierarchy walk (comprehensive tier, future)
- Related element resolution (aria-labelledby target text)
- `tabindex` (implicit role already signals interactivity)
