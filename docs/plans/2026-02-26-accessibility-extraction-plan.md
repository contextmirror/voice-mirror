# Accessibility Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add lightweight accessibility data (ARIA roles, attributes, HTML states) to the element picker's serialized output and context formatting.

**Architecture:** New `_getAccessibility(el)` helper in `design-overlay.js` (ES5 IIFE), wired into `_serializeElement()`. Context formatting in `DesignToolbar.svelte` adds Role/ARIA/States lines. TDD — tests first.

**Tech Stack:** Vanilla ES5 (design-overlay.js is injected into arbitrary WebView2 pages), Svelte 5 (DesignToolbar), node:test source-inspection tests.

**Design doc:** `docs/plans/2026-02-26-accessibility-extraction-design.md`

---

### Task 1: Write failing tests for `_getAccessibility` helper

**Files:**
- Modify: `test/components/design-overlay.test.cjs:800` (append before final line)

**Step 1: Write the failing tests**

Add this new describe block at the end of the file, before the closing line (after the "listener references" block at line 800):

```js
// =========================================================================
// Accessibility extraction
// =========================================================================

describe('design-overlay.js: _getAccessibility helper', () => {
  it('defines _getAccessibility function', () => {
    assert.ok(src.includes('function _getAccessibility(el)'), 'Should define _getAccessibility');
  });

  it('checks for explicit role attribute first', () => {
    assert.ok(src.includes("el.getAttribute('role')"), 'Should check explicit role attr');
  });

  it('has implicit role lookup table for semantic HTML tags', () => {
    // Key tags that must have implicit roles
    assert.ok(src.includes("'button': 'button'"), 'button -> button');
    assert.ok(src.includes("'nav': 'navigation'"), 'nav -> navigation');
    assert.ok(src.includes("'main': 'main'"), 'main -> main');
    assert.ok(src.includes("'aside': 'complementary'"), 'aside -> complementary');
    assert.ok(src.includes("'header': 'banner'"), 'header -> banner');
    assert.ok(src.includes("'footer': 'contentinfo'"), 'footer -> contentinfo');
    assert.ok(src.includes("'textarea': 'textbox'"), 'textarea -> textbox');
    assert.ok(src.includes("'select': 'combobox'"), 'select -> combobox');
    assert.ok(src.includes("'table': 'table'"), 'table -> table');
    assert.ok(src.includes("'img': 'img'"), 'img -> img');
    assert.ok(src.includes("'dialog': 'dialog'"), 'dialog -> dialog');
    assert.ok(src.includes("'article': 'article'"), 'article -> article');
    assert.ok(src.includes("'progress': 'progressbar'"), 'progress -> progressbar');
  });

  it('has implicit roles for heading tags', () => {
    assert.ok(src.includes("'h1': 'heading'"), 'h1 -> heading');
    assert.ok(src.includes("'h6': 'heading'"), 'h6 -> heading');
  });

  it('has implicit roles for list tags', () => {
    assert.ok(src.includes("'ul': 'list'"), 'ul -> list');
    assert.ok(src.includes("'ol': 'list'"), 'ol -> list');
    assert.ok(src.includes("'li': 'listitem'"), 'li -> listitem');
  });

  it('has input type to role mapping', () => {
    assert.ok(src.includes("'checkbox': 'checkbox'"), 'checkbox input -> checkbox');
    assert.ok(src.includes("'radio': 'radio'"), 'radio input -> radio');
    assert.ok(src.includes("'range': 'slider'"), 'range input -> slider');
    assert.ok(src.includes("'number': 'spinbutton'"), 'number input -> spinbutton');
  });

  it('collects all aria-* attributes from the element', () => {
    assert.ok(src.includes("'aria-'"), 'Should check for aria- prefix');
    assert.ok(src.includes('el.attributes'), 'Should iterate el.attributes');
  });

  it('checks truthy HTML state attributes', () => {
    var states = ['disabled', 'required', 'checked', 'readonly', 'hidden', 'contenteditable'];
    states.forEach(function (state) {
      assert.ok(src.includes("'" + state + "'"), 'Should check for ' + state + ' state');
    });
  });

  it('captures input type for INPUT elements', () => {
    assert.ok(src.includes('el.type'), 'Should read el.type for input elements');
    assert.ok(src.includes("'INPUT'"), 'Should check for INPUT tagName');
  });

  it('returns object with role, ariaAttributes, htmlStates, inputType', () => {
    assert.ok(src.includes('role:'), 'Should return role field');
    assert.ok(src.includes('ariaAttributes:'), 'Should return ariaAttributes field');
    assert.ok(src.includes('htmlStates:'), 'Should return htmlStates field');
    assert.ok(src.includes('inputType:'), 'Should return inputType field');
  });
});

describe('design-overlay.js: _serializeElement includes accessibility', () => {
  it('calls _getAccessibility and includes result', () => {
    assert.ok(src.includes('accessibility: _getAccessibility(el)'), 'Should include accessibility in serialized output');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "accessibility|_getAccessibility|_serializeElement includes accessibility" 2>&1 | tail -20`
Expected: All new tests FAIL (the function doesn't exist yet).

---

### Task 2: Implement `_getAccessibility(el)` helper

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js:756-757` (insert between `_getParentChain` end and `_getPseudoClassRules` JSDoc)

**Step 1: Add the helper function**

Insert after line 756 (`return chain; }`) and before line 758 (`/** ... _getPseudoClassRules ...`):

```js

    /**
     * Extract lightweight accessibility data from an element.
     * Returns: { role, ariaAttributes, htmlStates, inputType }
     */
    function _getAccessibility(el) {
        // --- Implicit role lookup ---
        var tagRoles = {
            'a': 'link', 'button': 'button', 'textarea': 'textbox',
            'select': 'combobox', 'img': 'img', 'table': 'table',
            'nav': 'navigation', 'main': 'main', 'header': 'banner',
            'footer': 'contentinfo', 'aside': 'complementary',
            'form': 'form', 'section': 'region', 'article': 'article',
            'dialog': 'dialog', 'details': 'group', 'summary': 'button',
            'progress': 'progressbar', 'meter': 'meter', 'output': 'status',
            'option': 'option', 'fieldset': 'group', 'hr': 'separator',
            'ul': 'list', 'ol': 'list', 'li': 'listitem',
            'h1': 'heading', 'h2': 'heading', 'h3': 'heading',
            'h4': 'heading', 'h5': 'heading', 'h6': 'heading'
        };

        var inputTypeRoles = {
            'checkbox': 'checkbox', 'radio': 'radio',
            'range': 'slider', 'number': 'spinbutton',
            'text': 'textbox', 'search': 'searchbox',
            'email': 'textbox', 'tel': 'textbox', 'url': 'textbox',
            'password': 'textbox'
        };

        var tag = el.tagName.toLowerCase();

        // Explicit role attribute wins
        var role = el.getAttribute('role') || null;
        if (!role) {
            if (tag === 'input' && el.type) {
                role = inputTypeRoles[el.type] || null;
            } else if (tag === 'a' && el.hasAttribute('href')) {
                role = 'link';
            } else {
                role = tagRoles[tag] || null;
            }
        }

        // Collect all aria-* attributes
        var ariaAttributes = {};
        var attrs = el.attributes;
        for (var i = 0; i < attrs.length; i++) {
            var name = attrs[i].name;
            if (name.indexOf('aria-') === 0) {
                ariaAttributes[name] = attrs[i].value;
            }
        }

        // Check truthy HTML state attributes
        var stateNames = ['disabled', 'required', 'checked', 'readonly', 'hidden', 'contenteditable'];
        var htmlStates = [];
        for (var j = 0; j < stateNames.length; j++) {
            if (el.hasAttribute(stateNames[j])) {
                htmlStates.push(stateNames[j]);
            }
        }

        // Input type (only for INPUT elements)
        var inputType = el.tagName.toUpperCase() === 'INPUT' ? (el.type || null) : null;

        return {
            role: role,
            ariaAttributes: ariaAttributes,
            htmlStates: htmlStates,
            inputType: inputType
        };
    }
```

**Step 2: Wire into `_serializeElement()`**

Change the return block at line 864-881. Replace:

```js
            parentChain: _getParentChain(el),
            pseudoRules: _getPseudoClassRules(el)
```

With:

```js
            parentChain: _getParentChain(el),
            pseudoRules: _getPseudoClassRules(el),
            accessibility: _getAccessibility(el)
```

**Step 3: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "accessibility|_getAccessibility|_serializeElement includes accessibility"`
Expected: All new tests from Task 1 PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat: add _getAccessibility helper to element picker

Extracts ARIA roles (explicit + implicit from tag), aria-* attributes,
HTML states (disabled/required/checked/readonly/hidden/contenteditable),
and input type. Wired into _serializeElement() output."
```

---

### Task 3: Write failing tests for context formatting

**Files:**
- Modify: `test/components/design-toolbar.test.cjs:83` (append new describe block)

**Step 1: Write the failing tests**

Append after the last describe block:

```js

describe('DesignToolbar — accessibility context formatting', () => {
  it('formats accessibility role in context text', () => {
    assert.ok(toolbarSrc.includes('.accessibility'), 'Should reference accessibility field');
    assert.ok(toolbarSrc.includes('Role:'), 'Should have Role: label in context');
  });

  it('formats ARIA attributes in context text', () => {
    assert.ok(toolbarSrc.includes('ariaAttributes'), 'Should reference ariaAttributes');
    assert.ok(toolbarSrc.includes('ARIA:'), 'Should have ARIA: label in context');
  });

  it('formats HTML states in context text', () => {
    assert.ok(toolbarSrc.includes('htmlStates'), 'Should reference htmlStates');
    assert.ok(toolbarSrc.includes('States:'), 'Should have States: label in context');
  });

  it('only includes accessibility lines when data is present', () => {
    // Should use conditional checks before adding lines
    assert.ok(toolbarSrc.includes('.role'), 'Should check role exists');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "accessibility context formatting"`
Expected: FAIL — DesignToolbar.svelte doesn't reference accessibility yet.

---

### Task 4: Implement context formatting in DesignToolbar.svelte

**Files:**
- Modify: `src/components/lens/DesignToolbar.svelte:132-149` (add accessibility lines to contextText array)

**Step 1: Add accessibility formatting**

After the `classes` line (line 132) and before the `contextText` array (line 134), add:

```js
      // Format accessibility info
      const a11y = elem.accessibility || {};
      const roleLine = a11y.role ? `Role: ${a11y.role}` : null;
      const ariaEntries = Object.entries(a11y.ariaAttributes || {});
      const ariaLine = ariaEntries.length > 0
        ? `ARIA: ${ariaEntries.map(([k, v]) => `${k}="${v}"`).join('; ')}`
        : null;
      const statesLine = (a11y.htmlStates || []).length > 0
        ? `States: ${a11y.htmlStates.join(', ')}`
        : null;
```

Then update the `contextText` array to insert the accessibility lines after Size/Text and before the blank line + HTML. Replace lines 134-149:

```js
      let contextText = [
        `Selected element: ${elem.tagName}${elem.id ? '#' + elem.id : ''}${classes ? '.' + classes.split(' ').join('.') : ''}`,
        `Selector: ${elem.selector}`,
        `Size: ${elem.bounds.width} x ${elem.bounds.height}px`,
        roleLine,
        ariaLine,
        statesLine,
        elem.text ? `Text: "${elem.text}"` : null,
        '',
        'HTML:',
        elem.html,
        parentLines ? '\nParent chain:' : null,
        parentLines || null,
        pseudoLines ? '\nPseudo-class rules:' : null,
        pseudoLines || null,
        '',
        'Computed styles:',
        styleLines
      ].filter(v => v !== null && v !== undefined).join('\n');
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "accessibility context formatting"`
Expected: All PASS.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All 3400+ tests pass. No regressions.

**Step 4: Commit**

```bash
git add src/components/lens/DesignToolbar.svelte test/components/design-toolbar.test.cjs
git commit -m "feat: format accessibility data in element picker context

Adds Role, ARIA, and States lines to the hidden context sent to the AI.
Lines only appear when data is present to conserve the 8000 char budget."
```

---

### Task 5: Final verification

**Step 1: Run full test suite one more time**

Run: `npm test`
Expected: All tests pass.

**Step 2: Verify ES5 compliance of new code**

Run: `grep -n 'const \|let \|=>\|`' src-tauri/src/assets/design-overlay.js | head -5`
Expected: No matches — the overlay file must remain ES5 (no const, let, arrow functions, template literals).

**Step 3: Verify the new function integrates cleanly**

Run: `grep -c '_getAccessibility' src-tauri/src/assets/design-overlay.js`
Expected: At least 3 (function definition, call in _serializeElement, public API or return reference).

---

## Summary of Changes

| File | Change | Lines |
|------|--------|-------|
| `src-tauri/src/assets/design-overlay.js` | New `_getAccessibility(el)` helper + wire into `_serializeElement()` | ~65 added |
| `src/components/lens/DesignToolbar.svelte` | Format Role/ARIA/States in context text | ~10 added |
| `test/components/design-overlay.test.cjs` | Test helper function, role lookup, ARIA, states, input type | ~70 added |
| `test/components/design-toolbar.test.cjs` | Test context formatting includes accessibility lines | ~20 added |
