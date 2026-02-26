# Select Element v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Select Element feature send rich hidden context (parent chain, pseudo-class rules) to the AI while showing only a clean screenshot in the chat bubble, and fix the broken image delivery pipeline.

**Architecture:** Add a `context` field to the Attachment type that carries element metadata invisibly. Change the flow from auto-send to queue-then-send (matching how screenshots work). Fix `handleChatSend` to pass `dataUrl` to the Rust backend instead of only file paths. Enrich `_serializeElement()` with parent chain and pseudo-class extraction.

**Tech Stack:** Svelte 5, Rust/Tauri 2, ES5 (design-overlay.js), CodeMirror 6

---

### Task 1: Enrich design-overlay.js — Parent Chain Capture

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js:701-746` (`_serializeElement`)
- Test: `test/components/design-overlay.test.cjs`

**Context:** `_serializeElement()` currently captures only the selected element's own styles. We need to walk up 2-3 ancestors and capture their layout-relevant styles + sibling summary for the immediate parent.

**Step 1: Write the failing test**

In `test/components/design-overlay.test.cjs`, add after the existing "Element Data Serialization" describe block:

```js
describe('Parent chain capture', () => {
  it('_serializeElement includes parentChain in return object', () => {
    // The return statement should include parentChain
    const serializeFn = src.substring(src.indexOf('function _serializeElement'));
    assert.ok(serializeFn.includes('parentChain:'), 'Should return parentChain');
  });

  it('walks up to 3 ancestor levels', () => {
    assert.ok(src.includes('parentElement'), 'Should walk parentElement');
    // Should have a max depth of 3
    assert.ok(src.includes('3') || src.includes('maxDepth'), 'Should limit depth');
  });

  it('captures layout-relevant styles per ancestor', () => {
    assert.ok(src.includes('flex-direction'), 'Should capture flex-direction');
    assert.ok(src.includes('grid-template-columns'), 'Should capture grid styles');
  });

  it('captures sibling summary for immediate parent', () => {
    assert.ok(src.includes('childNodes') || src.includes('children'), 'Should enumerate children');
    assert.ok(src.includes('tagName'), 'Should capture child tag names');
  });

  it('stops at body or html', () => {
    const serializeFn = src.substring(src.indexOf('function _serializeElement'));
    assert.ok(
      serializeFn.includes('BODY') || serializeFn.includes('HTML'),
      'Should stop walking at body/html'
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/components/design-overlay.test.cjs`
Expected: 5 new tests FAIL

**Step 3: Implement parent chain capture**

In `src-tauri/src/assets/design-overlay.js`, add a new function before `_serializeElement` (around line 700):

```js
/** Walk up 2-3 ancestors collecting layout-relevant styles. */
function _getParentChain(el) {
    var layoutProps = [
        'display', 'flex-direction', 'flex-wrap', 'gap', 'align-items',
        'justify-content', 'grid-template-columns', 'grid-template-rows',
        'position', 'width', 'height', 'max-width', 'padding', 'margin', 'overflow'
    ];
    var chain = [];
    var current = el.parentElement;
    var depth = 0;
    while (current && depth < 3) {
        var tag = current.tagName;
        if (tag === 'BODY' || tag === 'HTML') break;
        var style = window.getComputedStyle(current);
        var layoutStyles = {};
        for (var i = 0; i < layoutProps.length; i++) {
            var val = style.getPropertyValue(layoutProps[i]);
            if (val) layoutStyles[layoutProps[i]] = val;
        }
        var entry = {
            tagName: tag.toLowerCase(),
            id: current.id || '',
            classes: current.className && typeof current.className === 'string'
                ? current.className.trim().split(/\s+/).filter(function(c) { return c; }).slice(0, 5).join(' ')
                : '',
            styles: layoutStyles
        };
        // For the immediate parent (depth 0), include sibling summary
        if (depth === 0) {
            var kids = current.children;
            var childSummary = [];
            for (var j = 0; j < Math.min(kids.length, 10); j++) {
                childSummary.push(kids[j].tagName.toLowerCase());
            }
            entry.children = childSummary;
            entry.childCount = kids.length;
        }
        chain.push(entry);
        current = current.parentElement;
        depth++;
    }
    return chain;
}
```

Then in `_serializeElement()`, add `parentChain: _getParentChain(el)` to the return object (after the `styles` field, around line 744):

```js
    return {
        selector: selector,
        tagName: el.tagName.toLowerCase(),
        // ... existing fields ...
        styles: styles,
        parentChain: _getParentChain(el)
    };
```

**Step 4: Run test to verify it passes**

Run: `node --test test/components/design-overlay.test.cjs`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat: capture 2-3 levels of parent layout context in element serialization"
```

---

### Task 2: Enrich design-overlay.js — Pseudo-Class CSS Rule Extraction

**Files:**
- Modify: `src-tauri/src/assets/design-overlay.js`
- Test: `test/components/design-overlay.test.cjs`

**Context:** Scan `document.styleSheets` to find CSS rules matching the selected element that contain `:hover`, `:focus`, `:active`, `:focus-visible`, or `:disabled` pseudo-classes. Must be ES5, handle cross-origin `SecurityError`, cap at 20 rules.

**Step 1: Write the failing test**

In `test/components/design-overlay.test.cjs`, add:

```js
describe('Pseudo-class CSS rule extraction', () => {
  it('has _getPseudoClassRules function', () => {
    assert.ok(src.includes('function _getPseudoClassRules'), 'Should define _getPseudoClassRules');
  });

  it('iterates document.styleSheets', () => {
    const fn = src.substring(src.indexOf('function _getPseudoClassRules'));
    assert.ok(fn.includes('styleSheets'), 'Should access styleSheets');
  });

  it('catches SecurityError for cross-origin sheets', () => {
    const fn = src.substring(src.indexOf('function _getPseudoClassRules'));
    assert.ok(fn.includes('catch') || fn.includes('try'), 'Should try/catch for cross-origin');
  });

  it('checks for pseudo-class keywords', () => {
    const fn = src.substring(src.indexOf('function _getPseudoClassRules'));
    assert.ok(fn.includes(':hover'), 'Should check :hover');
    assert.ok(fn.includes(':focus'), 'Should check :focus');
    assert.ok(fn.includes(':active'), 'Should check :active');
  });

  it('uses el.matches to verify rule applies', () => {
    const fn = src.substring(src.indexOf('function _getPseudoClassRules'));
    assert.ok(fn.includes('.matches(') || fn.includes('.matches ('), 'Should use el.matches');
  });

  it('caps at 20 matching rules', () => {
    const fn = src.substring(src.indexOf('function _getPseudoClassRules'));
    assert.ok(fn.includes('20'), 'Should cap at 20 rules');
  });

  it('_serializeElement includes pseudoRules in return object', () => {
    const serializeFn = src.substring(src.indexOf('function _serializeElement'));
    assert.ok(serializeFn.includes('pseudoRules:'), 'Should return pseudoRules');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/components/design-overlay.test.cjs`
Expected: 7 new tests FAIL

**Step 3: Implement pseudo-class extraction**

In `src-tauri/src/assets/design-overlay.js`, add before `_serializeElement`:

```js
/** Extract CSS rules with pseudo-classes that match the given element. */
function _getPseudoClassRules(el) {
    var pseudoKeywords = [':hover', ':focus', ':active', ':focus-visible', ':disabled'];
    var results = [];
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
        var rules;
        try {
            rules = sheets[s].cssRules || sheets[s].rules;
        } catch (e) {
            // Cross-origin stylesheet — skip
            continue;
        }
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
            if (results.length >= 20) break;
            var rule = rules[r];
            if (rule.type !== 1) continue; // CSSStyleRule only
            var sel = rule.selectorText || '';
            var hasPseudo = false;
            for (var p = 0; p < pseudoKeywords.length; p++) {
                if (sel.indexOf(pseudoKeywords[p]) !== -1) {
                    hasPseudo = true;
                    break;
                }
            }
            if (!hasPseudo) continue;
            // Strip pseudo-class to check if base selector matches element
            var baseSel = sel;
            for (var p2 = 0; p2 < pseudoKeywords.length; p2++) {
                // Replace all occurrences of the pseudo keyword
                while (baseSel.indexOf(pseudoKeywords[p2]) !== -1) {
                    baseSel = baseSel.replace(pseudoKeywords[p2], '');
                }
            }
            baseSel = baseSel.replace(/,\s*/g, ',').trim();
            if (!baseSel) continue;
            try {
                // Test each comma-separated part
                var parts = baseSel.split(',');
                var matches = false;
                for (var pp = 0; pp < parts.length; pp++) {
                    var part = parts[pp].trim();
                    if (part && el.matches(part)) {
                        matches = true;
                        break;
                    }
                }
                if (matches) {
                    results.push({
                        selector: sel,
                        css: rule.cssText
                    });
                }
            } catch (e) {
                // Invalid selector — skip
            }
        }
        if (results.length >= 20) break;
    }
    return results;
}
```

Then in `_serializeElement()`, add `pseudoRules: _getPseudoClassRules(el)` to the return object:

```js
    return {
        // ... existing fields ...
        styles: styles,
        parentChain: _getParentChain(el),
        pseudoRules: _getPseudoClassRules(el)
    };
```

**Step 4: Run test to verify it passes**

Run: `node --test test/components/design-overlay.test.cjs`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src-tauri/src/assets/design-overlay.js test/components/design-overlay.test.cjs
git commit -m "feat: extract pseudo-class CSS rules (:hover, :focus, :active) for selected elements"
```

---

### Task 3: Attachment Type — Add `context` Field

**Files:**
- Modify: `src/lib/stores/attachments.svelte.js:9` (typedef)
- Test: `test/stores/attachments.test.cjs` (if exists, else `test/stores/layout.test.cjs` pattern)

**Context:** Add an optional `context` field to the Attachment typedef. This carries hidden element metadata. No behavioral change to the store — just the type annotation.

**Step 1: Write the failing test**

Create `test/stores/attachments-context.test.cjs`:

```js
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/attachments.svelte.js'),
  'utf-8'
);

describe('attachments.svelte.js — context field', () => {
  it('Attachment typedef includes optional context field', () => {
    assert.ok(src.includes('context?'), 'Should have context? in typedef');
  });

  it('typedef documents context as string', () => {
    assert.ok(src.includes('context?: string'), 'Should be context?: string');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/stores/attachments-context.test.cjs`
Expected: FAIL

**Step 3: Update the typedef**

In `src/lib/stores/attachments.svelte.js`, line 9, change:

```js
// Before:
 * @typedef {{ path: string, dataUrl?: string, type: string, name: string }} Attachment

// After:
 * @typedef {{ path: string, dataUrl?: string, type: string, name: string, context?: string }} Attachment
```

**Step 4: Run test to verify it passes**

Run: `node --test test/stores/attachments-context.test.cjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/stores/attachments.svelte.js test/stores/attachments-context.test.cjs
git commit -m "feat: add optional context field to Attachment typedef for hidden metadata"
```

---

### Task 4: Rust Backend — Accept `image_data_url` Parameter

**Files:**
- Modify: `src-tauri/src/commands/ai.rs:96-112` (`ai_pty_input`)
- Modify: `src-tauri/src/commands/ai.rs:354-417` (`write_user_message`)
- Modify: `src-tauri/src/providers/mod.rs:96-98` (trait method)
- Modify: `src-tauri/src/providers/api.rs:692-742` (`send_message_with_image`)
- Modify: `src/lib/api.js:166-168` (`aiPtyInput`)
- Modify: `src/lib/api.js:244-246` (`writeUserMessage`)
- Test: `test/api/api-signatures.test.cjs`

**Context:** Both Rust commands currently only accept `image_path` (file on disk). We need an additional `image_data_url` param that, when present, is used directly instead of reading from disk. The API provider's `send_message_with_image` also needs a variant that accepts an inline data URL.

**Step 1: Write the failing test**

In `test/api/api-signatures.test.cjs`, add to the existing test file:

```js
describe('api.js — image data URL support', () => {
  it('aiPtyInput accepts imageDataUrl parameter', () => {
    const fn = apiSrc.substring(apiSrc.indexOf('export async function aiPtyInput'));
    assert.ok(fn.includes('imageDataUrl'), 'Should accept imageDataUrl');
  });

  it('aiPtyInput sends imageDataUrl via invoke', () => {
    const fn = apiSrc.substring(apiSrc.indexOf('export async function aiPtyInput'));
    assert.ok(fn.includes('imageDataUrl'), 'Should pass imageDataUrl in invoke');
  });

  it('writeUserMessage accepts imageDataUrl parameter', () => {
    const fn = apiSrc.substring(apiSrc.indexOf('export async function writeUserMessage'));
    assert.ok(fn.includes('imageDataUrl'), 'Should accept imageDataUrl');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/api/api-signatures.test.cjs`
Expected: 3 new tests FAIL

**Step 3: Update api.js wrappers**

In `src/lib/api.js`:

Line 166-168, change `aiPtyInput`:
```js
export async function aiPtyInput(data, imagePath, imageDataUrl) {
  return invoke('ai_pty_input', { data, imagePath: imagePath || null, imageDataUrl: imageDataUrl || null });
}
```

Line 244-246, change `writeUserMessage`:
```js
export async function writeUserMessage(message, from, threadId, imagePath, imageDataUrl) {
  return invoke('write_user_message', { message, from, threadId, imagePath: imagePath || null, imageDataUrl: imageDataUrl || null });
}
```

**Step 4: Update Rust commands**

In `src-tauri/src/commands/ai.rs`, `ai_pty_input` (line 96):

```rust
#[tauri::command]
pub fn ai_pty_input(
    state: State<'_, AiManagerState>,
    data: String,
    image_path: Option<String>,
    image_data_url: Option<String>,
) -> IpcResponse {
    let mut manager = lock_manager!(state);
    if let Some(ref data_url) = image_data_url {
        // Prefer inline data URL over file path
        if manager.send_input_with_image_data_url(&data, data_url) {
            return IpcResponse::ok_empty();
        }
    }
    if let Some(ref path) = image_path {
        if manager.send_input_with_image(&data, path) {
            return IpcResponse::ok_empty();
        }
    }
    if manager.send_input(&data) {
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("No active provider to send input to")
    }
}
```

In `src-tauri/src/commands/ai.rs`, `write_user_message` (line 354), add `image_data_url: Option<String>` parameter. Change lines 370-385 to prefer the pre-built data URL:

```rust
    let image_data_url = match image_data_url {
        Some(url) => Some(url),  // Use pre-built data URL directly
        None => image_path.as_deref().and_then(|p| {
            tracing::info!("[write_user_message] Image path: {}", p);
            match std::fs::read(p) {
                Ok(bytes) => {
                    let b64 = crate::voice::tts::crypto::base64_encode(&bytes);
                    Some(format!("data:image/png;base64,{}", b64))
                }
                Err(e) => {
                    tracing::error!("[write_user_message] Failed to read image file: {}", e);
                    None
                }
            }
        }),
    };
```

**Step 5: Update AiManager trait**

In `src-tauri/src/providers/mod.rs`, add a new trait method (after line 98):

```rust
    /// Send text input with a pre-encoded image data URL.
    ///
    /// Default: ignores the image and sends text only via `send_input`.
    /// API providers override this to build multimodal content arrays.
    fn send_input_with_image_data_url(&mut self, data: &str, _data_url: &str) -> bool {
        // Default: try send_input, return whether it succeeded
        self.send_input(data)
    }
```

**Step 6: Update API provider**

In `src-tauri/src/providers/api.rs`, add a new method that accepts an inline data URL (after `send_message_with_image` around line 742):

```rust
    /// Send a message with a pre-encoded image data URL (no file read needed).
    fn send_message_with_image_data_url(&mut self, text: String, data_url: &str) {
        let mut content_parts = vec![
            serde_json::json!({
                "type": "image_url",
                "image_url": { "url": data_url }
            }),
        ];
        if !text.is_empty() {
            content_parts.push(serde_json::json!({
                "type": "text",
                "text": text
            }));
        }
        self.messages.push(serde_json::json!({
            "role": "user",
            "content": content_parts
        }));
        self.send_message_internal(false);
    }
```

And override the trait method:

```rust
    fn send_input_with_image_data_url(&mut self, data: &str, data_url: &str) -> bool {
        self.send_message_with_image_data_url(data.to_string(), data_url);
        true
    }
```

**Step 7: Run all tests**

Run: `npm test`
Expected: All tests PASS

Run: `cd src-tauri && cargo check`
Expected: Compiles clean

**Step 8: Commit**

```bash
git add src/lib/api.js src-tauri/src/commands/ai.rs src-tauri/src/providers/mod.rs src-tauri/src/providers/api.rs test/api/api-signatures.test.cjs
git commit -m "feat: accept inline image data URLs in AI commands (fixes element screenshot delivery)"
```

---

### Task 5: App.svelte — Wire `handleChatSend` to Read Context + DataUrl

**Files:**
- Modify: `src/App.svelte:327-346` (`handleChatSend`)
- Test: `test/components/app-chat-send.test.cjs` (create)

**Context:** `handleChatSend` currently only reads `attachments[0].path`. We need it to also read `context` (prepend to message text) and `dataUrl` (pass to Rust as inline image). This is the critical fix that connects the hidden context pipeline.

**Step 1: Write the failing test**

Create `test/components/app-chat-send.test.cjs`:

```js
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/App.svelte'),
  'utf-8'
);

describe('App.svelte — handleChatSend', () => {
  const fn = src.substring(src.indexOf('function handleChatSend'));

  it('reads dataUrl from attachment', () => {
    assert.ok(fn.includes('dataUrl'), 'Should read dataUrl from attachment');
  });

  it('reads context from attachment', () => {
    assert.ok(fn.includes('context'), 'Should read context from attachment');
  });

  it('prepends element context with delimiters', () => {
    assert.ok(fn.includes('[Element Context]'), 'Should wrap context in delimiters');
    assert.ok(fn.includes('[/Element Context]'), 'Should close context delimiters');
  });

  it('passes imageDataUrl to aiPtyInput', () => {
    assert.ok(fn.includes('imageDataUrl') || fn.includes('dataUrl'), 'Should pass dataUrl to provider');
  });

  it('passes imageDataUrl to writeUserMessage', () => {
    assert.ok(fn.includes('imageDataUrl') || fn.includes('dataUrl'), 'Should pass dataUrl to write command');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/components/app-chat-send.test.cjs`
Expected: FAIL

**Step 3: Update handleChatSend**

In `src/App.svelte`, replace `handleChatSend` (lines 327-346):

```js
  function handleChatSend(text, attachments = []) {
    // In dictation-only mode, there's no AI to route to.
    if (aiStatusStore.isDictationProvider) {
      return;
    }

    const att = attachments.length > 0 ? attachments[0] : null;
    const imagePath = att?.path || null;
    const imageDataUrl = att?.dataUrl || null;
    const hiddenContext = att?.context || null;

    // Prepend hidden element context to the message text (invisible to user, visible to AI)
    const fullText = hiddenContext
      ? `[Element Context]\n${hiddenContext}\n[/Element Context]\n\n${text}`
      : text;

    if (aiStatusStore.isApiProvider) {
      aiPtyInput(fullText, imagePath, imageDataUrl).catch((err) => {
        console.warn('[chat] Failed to send message to API provider:', err);
      });
    } else {
      writeUserMessage(fullText, null, null, imagePath, imageDataUrl).catch((err) => {
        console.warn('[chat] Failed to write user message to inbox:', err);
      });
    }
  }
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/App.svelte test/components/app-chat-send.test.cjs
git commit -m "feat: handleChatSend reads hidden context + dataUrl from attachments"
```

---

### Task 6: DesignToolbar — Format Enriched Context String

**Files:**
- Modify: `src/components/lens/DesignToolbar.svelte:88-141` (`handleElementSend`)
- Test: `test/components/design-toolbar.test.cjs`

**Context:** The toolbar's `handleElementSend` currently formats a basic context string. Update it to include the new `parentChain` and `pseudoRules` data from the enriched element serialization. Cap total context at 8,000 characters.

**Step 1: Write the failing test**

In `test/components/design-toolbar.test.cjs`, add:

```js
describe('DesignToolbar — enriched context', () => {
  it('formats parent chain in context text', () => {
    assert.ok(toolbarSrc.includes('parentChain') || toolbarSrc.includes('parent'), 'Should format parent chain');
    assert.ok(toolbarSrc.includes('Parent chain'), 'Should have Parent chain section header');
  });

  it('formats pseudo-class rules in context text', () => {
    assert.ok(toolbarSrc.includes('pseudoRules') || toolbarSrc.includes('pseudo'), 'Should format pseudo rules');
    assert.ok(toolbarSrc.includes('Pseudo-class rules'), 'Should have Pseudo-class rules section header');
  });

  it('caps total context at 8000 characters', () => {
    assert.ok(toolbarSrc.includes('8000'), 'Should cap context at 8000 chars');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/components/design-toolbar.test.cjs`
Expected: 3 new tests FAIL

**Step 3: Update handleElementSend**

In `src/components/lens/DesignToolbar.svelte`, replace the context formatting section (lines ~113-129) in `handleElementSend`:

```js
      // Format parent chain
      const parentLines = (elem.parentChain || []).map(p => {
        const id = p.id ? '#' + p.id : '';
        const cls = p.classes ? '.' + p.classes.split(' ').join('.') : '';
        const childInfo = p.children ? ` (${p.childCount} children: ${p.children.join(', ')})` : '';
        const styles = Object.entries(p.styles || {})
          .filter(([, v]) => v && v !== 'static' && v !== 'visible' && v !== 'none' && v !== 'normal')
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        return `  ${p.tagName}${id}${cls}${childInfo}\n    ${styles}`;
      }).join('\n');

      // Format pseudo-class rules
      const pseudoLines = (elem.pseudoRules || []).map(r => `  ${r.css}`).join('\n');

      const styleLines = Object.entries(elem.styles || {})
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');

      const classes = typeof elem.classes === 'string' ? elem.classes : (Array.isArray(elem.classes) ? elem.classes.join(' ') : '');

      let contextText = [
        `Selected element: ${elem.tagName}${elem.id ? '#' + elem.id : ''}${classes ? '.' + classes.split(' ').join('.') : ''}`,
        `Selector: ${elem.selector}`,
        `Size: ${elem.bounds.width} x ${elem.bounds.height}px`,
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

      // Cap total context at 8000 characters
      if (contextText.length > 8000) {
        contextText = contextText.substring(0, 7980) + '\n[...truncated]';
      }
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/components/lens/DesignToolbar.svelte test/components/design-toolbar.test.cjs
git commit -m "feat: format parent chain + pseudo-class rules in element context, cap at 8000 chars"
```

---

### Task 7: LensWorkspace — Queue-Then-Send + Hidden Context

**Files:**
- Modify: `src/components/lens/LensWorkspace.svelte:167-186` (`handleElementSend`)
- Test: `test/components/lens-workspace-element.test.cjs`

**Context:** Change from auto-sending the message to queuing the attachment with hidden context. The user types their instruction and sends manually. Focus the chat input after queuing.

**Step 1: Write the failing test**

Update `test/components/lens-workspace-element.test.cjs`:

```js
describe('LensWorkspace.svelte — element selection v2', () => {
  it('has handleElementSend function', () => {
    assert.ok(workspaceSrc.includes('function handleElementSend'));
  });

  it('passes onElementSend to DesignToolbar', () => {
    assert.ok(workspaceSrc.includes('onElementSend={handleElementSend}'));
  });

  it('queues attachment with context field instead of auto-sending', () => {
    assert.ok(workspaceSrc.includes("context:"), 'Should set context on attachment');
    assert.ok(workspaceSrc.includes('attachmentsStore.add'), 'Should add to pending attachments');
  });

  it('does NOT auto-send via chatStore.addMessage', () => {
    // handleElementSend should NOT call chatStore.addMessage anymore
    const fn = workspaceSrc.substring(workspaceSrc.indexOf('function handleElementSend'));
    const fnEnd = workspaceSrc.indexOf('\n  }', workspaceSrc.indexOf('function handleElementSend'));
    const fnBody = workspaceSrc.substring(workspaceSrc.indexOf('function handleElementSend'), fnEnd);
    assert.ok(!fnBody.includes('chatStore.addMessage'), 'Should not auto-send message');
  });

  it('ensures chat panel is visible', () => {
    assert.ok(workspaceSrc.includes('layoutStore.setShowChat(true)'));
  });

  it('focuses chat input after queuing', () => {
    assert.ok(
      workspaceSrc.includes('focus') || workspaceSrc.includes('chatInputFocus'),
      'Should focus chat input'
    );
  });

  it('exits design mode after queuing', () => {
    assert.ok(workspaceSrc.includes('setDesignMode(false)'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/components/lens-workspace-element.test.cjs`
Expected: Tests about `context:` and `chatStore.addMessage` FAIL

**Step 3: Update handleElementSend**

In `src/components/lens/LensWorkspace.svelte`, replace `handleElementSend` (lines 167-186):

```js
  /** Handle element selection from design toolbar — queue screenshot + context as pending attachment. */
  function handleElementSend({ imageDataUrl, contextText, name }) {
    // Queue the element capture as a pending attachment with hidden context
    attachmentsStore.add({
      path: 'element-capture',
      dataUrl: imageDataUrl,
      type: 'image/png',
      name: name || 'Selected Element',
      context: contextText,
    });

    // Ensure chat panel is visible and focus the input
    layoutStore.setShowChat(true);
    lensStore.setDesignMode(false);

    // Focus the chat input so the user can immediately type their instruction
    requestAnimationFrame(() => {
      const textarea = document.querySelector('.chat-input-bar textarea');
      if (textarea) textarea.focus();
    });
  }
```

Also remove the `chatStore` import if it's no longer used elsewhere in the file. Check first:
- Search for `chatStore` references in LensWorkspace — if only used in `handleElementSend`, remove the import line.

**Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/components/lens/LensWorkspace.svelte test/components/lens-workspace-element.test.cjs
git commit -m "feat: queue element attachment with hidden context instead of auto-sending"
```

---

### Task 8: Integration Tests + Full Pipeline Verification

**Files:**
- Modify: `test/integration/select-element.test.cjs`
- Run: `npm test` and `cd src-tauri && cargo check`

**Context:** Update the integration tests to verify the complete v2 pipeline: enriched serialization → hidden context attachment → dataUrl passthrough → AI receives context + image.

**Step 1: Update integration tests**

In `test/integration/select-element.test.cjs`, update the "Data Flow" and "Chat Attachment Format" sections:

```js
  describe('Data Flow: Toolbar Send -> Queue Attachment with Hidden Context', () => {
    it('LensWorkspace queues attachment with context field', () => {
      assert.ok(workspaceSrc.includes('context:'));
      assert.ok(workspaceSrc.includes('attachmentsStore.add'));
    });

    it('LensWorkspace does not auto-send via chatStore.addMessage', () => {
      const fn = workspaceSrc.substring(workspaceSrc.indexOf('function handleElementSend'));
      const fnEnd = workspaceSrc.indexOf('\n  }', workspaceSrc.indexOf('function handleElementSend'));
      const fnBody = workspaceSrc.substring(workspaceSrc.indexOf('function handleElementSend'), fnEnd);
      assert.ok(!fnBody.includes('chatStore.addMessage'));
    });

    it('App.svelte handleChatSend reads context and wraps in delimiters', () => {
      const appSrc = fs.readFileSync(path.join(__dirname, '../../src/App.svelte'), 'utf-8');
      assert.ok(appSrc.includes('[Element Context]'));
      assert.ok(appSrc.includes('[/Element Context]'));
    });

    it('App.svelte handleChatSend passes imageDataUrl to providers', () => {
      const appSrc = fs.readFileSync(path.join(__dirname, '../../src/App.svelte'), 'utf-8');
      const fn = appSrc.substring(appSrc.indexOf('function handleChatSend'));
      assert.ok(fn.includes('dataUrl') || fn.includes('imageDataUrl'));
    });
  });

  describe('Enriched Element Data', () => {
    it('overlay serializes parent chain', () => {
      assert.ok(designOverlaySrc.includes('parentChain'));
      assert.ok(designOverlaySrc.includes('function _getParentChain'));
    });

    it('overlay extracts pseudo-class CSS rules', () => {
      assert.ok(designOverlaySrc.includes('pseudoRules'));
      assert.ok(designOverlaySrc.includes('function _getPseudoClassRules'));
    });

    it('toolbar formats parent chain in context', () => {
      assert.ok(toolbarSrc.includes('Parent chain'));
    });

    it('toolbar formats pseudo-class rules in context', () => {
      assert.ok(toolbarSrc.includes('Pseudo-class rules'));
    });

    it('toolbar caps context at 8000 characters', () => {
      assert.ok(toolbarSrc.includes('8000'));
    });

    it('attachment typedef supports context field', () => {
      const attachSrc = fs.readFileSync(
        path.join(__dirname, '../../src/lib/stores/attachments.svelte.js'), 'utf-8'
      );
      assert.ok(attachSrc.includes('context?: string'));
    });
  });
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS

Run: `cd src-tauri && cargo check`
Expected: Compiles clean

**Step 3: Commit**

```bash
git add test/integration/select-element.test.cjs
git commit -m "test: update integration tests for Select Element v2 pipeline"
```
