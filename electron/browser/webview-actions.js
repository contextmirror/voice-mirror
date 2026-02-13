/**
 * Browser actions using raw CDP commands via webview-cdp.
 * Replaces Playwright-based actions.js with direct CDP Input/DOM/Runtime calls.
 */

const cdp = require('./webview-cdp');

// --- Helpers ---

function clampTimeout(ms, defaultMs = 8000) {
    return Math.max(500, Math.min(60000, Math.floor(ms ?? defaultMs)));
}

function requireRef(ref) {
    const trimmed = (ref || '').trim();
    if (!trimmed) throw new Error('ref is required. Run browser_snapshot first to get element refs.');
    return trimmed;
}

function toAIFriendlyError(err, ref) {
    const msg = err?.message || String(err);
    if (msg.includes('Could not find node') || msg.includes('No node found')) {
        return new Error(`Element "${ref}" not found. The page may have changed — run a new snapshot.`);
    }
    if (msg.includes('Timeout') || msg.includes('timed out')) {
        return new Error(`Element "${ref}" not found or not actionable within timeout. The page may have changed — run a new snapshot.`);
    }
    if (msg.includes('not attached') || msg.includes('detached') || msg.includes('stale')) {
        return new Error(`Element "${ref}" is no longer attached to the DOM. Run a new snapshot.`);
    }
    return err;
}

/** @type {Object} Cached role refs from last snapshot */
let cachedRefs = {};

/**
 * Store refs from a snapshot for later resolution.
 * @param {Object} refs - {e1: {role, name, nth}, ...}
 * @param {string} [mode='role']
 */
function storeRefs(refs, mode = 'role') {
    cachedRefs = refs || {};
}

/**
 * Resolve an element ref (e1, e2, etc.) to a CDP RemoteObjectId
 * by finding the matching element in the DOM using role + name.
 * @param {string} ref - Element ref like "e1"
 * @returns {Promise<{objectId: string, nodeId?: number}>}
 */
async function resolveRef(ref) {
    const normalized = ref.startsWith('@') ? ref.slice(1)
        : ref.startsWith('ref=') ? ref.slice(4)
        : ref;

    if (!/^e\d+$/.test(normalized)) {
        throw new Error(`Invalid ref "${ref}". Expected format: e1, e2, etc.`);
    }

    const info = cachedRefs[normalized];
    if (!info) {
        throw new Error(`Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`);
    }

    // Fast path: use data-vmref attribute if available (set during DOM snapshot)
    if (info.vmref) {
        const vmResult = await cdp.evaluate(
            `document.querySelector('[data-vmref="${info.vmref}"]')`,
            { returnByValue: false }
        );
        if (vmResult.result && vmResult.result.type !== 'undefined' && vmResult.result.subtype !== 'null') {
            return { objectId: vmResult.result.objectId };
        }
        // vmref element gone — fall through to role+name matching
        console.log(`[webview-actions] vmref ${info.vmref} not found, falling back to role+name`);
    }

    // Fallback: find element by role + name in the DOM
    const { role, name, nth } = info;

    // Build a query expression that finds elements by ARIA role and accessible name
    const expression = `(() => {
        const role = ${JSON.stringify(role)};
        const name = ${JSON.stringify(name || '')};
        const nthIndex = ${JSON.stringify(nth ?? 0)};

        // Query elements by role attribute or implicit role
        const allElements = document.querySelectorAll('*');
        const matches = [];

        for (const el of allElements) {
            // Check explicit role
            const elRole = el.getAttribute('role') || getImplicitRole(el);
            if (elRole !== role) continue;

            // Check accessible name
            const elName = getAccessibleName(el);
            if (name && !elName.includes(name) && name !== elName) continue;

            matches.push(el);
        }

        // For unnamed elements, be more lenient - match any with the role
        if (matches.length === 0 && !name) {
            for (const el of allElements) {
                const elRole = el.getAttribute('role') || getImplicitRole(el);
                if (elRole === role) matches.push(el);
            }
        }

        const target = matches[nthIndex] || matches[0];
        if (!target) return null;
        return target;

        function getImplicitRole(el) {
            const tag = el.tagName?.toLowerCase();
            const type = (el.type || '').toLowerCase();
            if (tag === 'button' || (tag === 'input' && type === 'button') || (tag === 'input' && type === 'submit') || (tag === 'input' && type === 'reset')) return 'button';
            if (tag === 'a' && el.href) return 'link';
            if (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === 'tel' || type === 'search' || type === 'password' || type === '')) return 'textbox';
            if (tag === 'textarea') return 'textbox';
            if (tag === 'input' && type === 'checkbox') return 'checkbox';
            if (tag === 'input' && type === 'radio') return 'radio';
            if (tag === 'select') return 'combobox';
            if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
            if (tag === 'img') return 'img';
            if (tag === 'nav') return 'navigation';
            if (tag === 'main') return 'main';
            if (tag === 'header') return 'banner';
            if (tag === 'footer') return 'contentinfo';
            if (tag === 'aside') return 'complementary';
            if (tag === 'ul' || tag === 'ol') return 'list';
            if (tag === 'li') return 'listitem';
            if (tag === 'table') return 'table';
            if (tag === 'tr') return 'row';
            if (tag === 'td') return 'cell';
            if (tag === 'th') return 'columnheader';
            if (tag === 'article') return 'article';
            if (tag === 'section' && el.getAttribute('aria-label')) return 'region';
            if (tag === 'form') return 'form';
            if (tag === 'input' && type === 'range') return 'slider';
            if (tag === 'input' && type === 'number') return 'spinbutton';
            if (tag === 'details') return 'group';
            if (tag === 'summary') return 'button';
            if (tag === 'dialog') return 'dialog';
            if (tag === 'progress') return 'progressbar';
            if (tag === 'meter') return 'meter';
            if (tag === 'option') return 'option';
            if (tag === 'output') return 'status';
            return null;
        }

        function getAccessibleName(el) {
            // aria-label
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;
            // aria-labelledby
            const labelledBy = el.getAttribute('aria-labelledby');
            if (labelledBy) {
                const ref = document.getElementById(labelledBy);
                if (ref) return ref.textContent?.trim() || '';
            }
            // alt for images
            if (el.tagName?.toLowerCase() === 'img') return el.alt || '';
            // value/label for inputs
            if (el.tagName?.toLowerCase() === 'input' && el.type === 'submit') return el.value || '';
            // label element
            if (el.id) {
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) return label.textContent?.trim() || '';
            }
            // title attribute
            if (el.title) return el.title;
            // Text content for buttons, links, etc.
            const textContent = el.textContent?.trim();
            if (textContent && textContent.length < 200) return textContent;
            return '';
        }
    })()`;

    const result = await cdp.evaluate(expression, { returnByValue: false });

    if (!result.result || result.result.type === 'undefined' || result.result.subtype === 'null') {
        throw new Error(`Could not find node for ref "${normalized}" (role=${role}, name=${JSON.stringify(name)})`);
    }

    return { objectId: result.result.objectId };
}

/**
 * Get the bounding box center of an element by its objectId.
 * @param {string} objectId
 * @returns {Promise<{x: number, y: number, width: number, height: number}>}
 */
async function getElementCenter(objectId) {
    // Use Runtime.callFunctionOn to get bounding rect
    const result = await cdp.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
            const rect = this.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }`,
        returnByValue: true
    });

    const box = result?.result?.value;
    if (!box || !box.width || !box.height) {
        throw new Error('Element has no visible bounding box (may be hidden or zero-size).');
    }

    return {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
        width: box.width,
        height: box.height
    };
}

/**
 * Scroll element into view.
 * @param {string} objectId
 */
async function scrollIntoView(objectId) {
    await cdp.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.scrollIntoView({ block: 'center', inline: 'center' }); }`,
        returnByValue: true
    });
    // Small delay for scroll to settle
    await new Promise(r => setTimeout(r, 100));
}

/**
 * Focus an element.
 * @param {string} objectId
 */
async function focusElement(objectId) {
    await cdp.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.focus(); }`,
        returnByValue: true
    });
}

/**
 * Dispatch a mouse click at given coordinates.
 */
async function dispatchClick(x, y, opts = {}) {
    const button = opts.button || 'left';
    const clickCount = opts.clickCount || 1;
    const modifiers = encodeModifiers(opts.modifiers);

    await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, modifiers
    });
    await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button, clickCount, modifiers
    });
    await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button, clickCount, modifiers
    });
}

/**
 * Encode modifier keys array to CDP modifier bitmask.
 * @param {string[]} [modifiers]
 * @returns {number}
 */
function encodeModifiers(modifiers) {
    if (!modifiers?.length) return 0;
    let mask = 0;
    for (const m of modifiers) {
        switch (m.toLowerCase()) {
            case 'alt': mask |= 1; break;
            case 'control': case 'ctrl': mask |= 2; break;
            case 'meta': case 'command': mask |= 4; break;
            case 'shift': mask |= 8; break;
        }
    }
    return mask;
}

/**
 * Map key names to CDP key definitions.
 * @param {string} key
 * @returns {{ key: string, code: string, keyCode: number, text?: string }}
 */
function keyDefinition(key) {
    const defs = {
        'Enter':     { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
        'Tab':       { key: 'Tab', code: 'Tab', keyCode: 9 },
        'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        'Delete':    { key: 'Delete', code: 'Delete', keyCode: 46 },
        'Escape':    { key: 'Escape', code: 'Escape', keyCode: 27 },
        'ArrowUp':   { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        'ArrowRight':{ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        'Home':      { key: 'Home', code: 'Home', keyCode: 36 },
        'End':       { key: 'End', code: 'End', keyCode: 35 },
        'PageUp':    { key: 'PageUp', code: 'PageUp', keyCode: 33 },
        'PageDown':  { key: 'PageDown', code: 'PageDown', keyCode: 34 },
        'Space':     { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
        ' ':         { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    };
    if (defs[key]) return defs[key];
    // Single character
    if (key.length === 1) {
        return { key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0), text: key };
    }
    // F-keys
    const fMatch = key.match(/^F(\d+)$/i);
    if (fMatch) {
        const n = parseInt(fMatch[1]);
        return { key: `F${n}`, code: `F${n}`, keyCode: 111 + n };
    }
    return { key, code: key, keyCode: 0 };
}

// --- Actions ---

async function clickAction(opts) {
    const ref = requireRef(opts.ref);
    try {
        const { objectId } = await resolveRef(ref);
        await scrollIntoView(objectId);
        const center = await getElementCenter(objectId);
        const clickCount = opts.doubleClick ? 2 : 1;
        await dispatchClick(center.x, center.y, {
            button: opts.button || 'left',
            clickCount,
            modifiers: opts.modifiers
        });
        if (opts.doubleClick) {
            // Second click for dblclick
            await dispatchClick(center.x, center.y, {
                button: opts.button || 'left',
                clickCount: 2,
                modifiers: opts.modifiers
            });
        }
        return { ok: true, action: 'click', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

async function typeAction(opts) {
    const ref = requireRef(opts.ref);
    const text = String(opts.text ?? '');
    try {
        const { objectId } = await resolveRef(ref);
        await scrollIntoView(objectId);
        await focusElement(objectId);

        if (opts.slowly) {
            // Click first, then type char by char
            const center = await getElementCenter(objectId);
            await dispatchClick(center.x, center.y);
            for (const char of text) {
                const def = keyDefinition(char);
                await cdp.sendCommand('Input.dispatchKeyEvent', {
                    type: 'keyDown', key: def.key, code: def.code,
                    windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode,
                    text: def.text
                });
                await cdp.sendCommand('Input.dispatchKeyEvent', {
                    type: 'keyUp', key: def.key, code: def.code,
                    windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode
                });
                await new Promise(r => setTimeout(r, 75));
            }
        } else {
            // Fast fill: set value directly via JS
            await cdp.sendCommand('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: `function(text) {
                    // Clear and set value
                    if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') {
                        this.value = text;
                        this.dispatchEvent(new Event('input', { bubbles: true }));
                        this.dispatchEvent(new Event('change', { bubbles: true }));
                    } else if (this.isContentEditable) {
                        this.textContent = text;
                        this.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }`,
                arguments: [{ value: text }],
                returnByValue: true
            });
        }

        if (opts.submit) {
            const def = keyDefinition('Enter');
            await cdp.sendCommand('Input.dispatchKeyEvent', {
                type: 'keyDown', key: def.key, code: def.code,
                windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode,
                text: def.text
            });
            await cdp.sendCommand('Input.dispatchKeyEvent', {
                type: 'keyUp', key: def.key, code: def.code,
                windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode
            });
        }

        return { ok: true, action: 'type', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

async function fillFormAction(opts) {
    for (const field of (opts.fields || [])) {
        const ref = (field.ref || '').trim();
        const type = (field.type || '').trim();
        if (!ref || !type) continue;

        const value = typeof field.value === 'string' ? field.value
            : (typeof field.value === 'number' || typeof field.value === 'boolean') ? String(field.value)
            : '';

        try {
            const { objectId } = await resolveRef(ref);
            await scrollIntoView(objectId);

            if (type === 'checkbox' || type === 'radio') {
                const checked = field.value === true || field.value === 1 || field.value === '1' || field.value === 'true';
                await cdp.sendCommand('Runtime.callFunctionOn', {
                    objectId,
                    functionDeclaration: `function(checked) {
                        if (this.checked !== checked) {
                            this.checked = checked;
                            this.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }`,
                    arguments: [{ value: checked }],
                    returnByValue: true
                });
            } else {
                await cdp.sendCommand('Runtime.callFunctionOn', {
                    objectId,
                    functionDeclaration: `function(val) {
                        this.value = val;
                        this.dispatchEvent(new Event('input', { bubbles: true }));
                        this.dispatchEvent(new Event('change', { bubbles: true }));
                    }`,
                    arguments: [{ value }],
                    returnByValue: true
                });
            }
        } catch (err) {
            throw toAIFriendlyError(err, ref);
        }
    }
    return { ok: true, action: 'fill', fieldCount: (opts.fields || []).length };
}

async function hoverAction(opts) {
    const ref = requireRef(opts.ref);
    try {
        const { objectId } = await resolveRef(ref);
        await scrollIntoView(objectId);
        const center = await getElementCenter(objectId);
        await cdp.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: center.x, y: center.y
        });
        return { ok: true, action: 'hover', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

async function dragAction(opts) {
    const startRef = requireRef(opts.startRef);
    const endRef = requireRef(opts.endRef);
    try {
        const start = await resolveRef(startRef);
        const end = await resolveRef(endRef);
        await scrollIntoView(start.objectId);
        const startCenter = await getElementCenter(start.objectId);
        const endCenter = await getElementCenter(end.objectId);

        // Mouse down at start
        await cdp.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: startCenter.x, y: startCenter.y
        });
        await cdp.sendCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: startCenter.x, y: startCenter.y, button: 'left', clickCount: 1
        });

        // Interpolate steps for smooth drag
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const x = Math.round(startCenter.x + (endCenter.x - startCenter.x) * (i / steps));
            const y = Math.round(startCenter.y + (endCenter.y - startCenter.y) * (i / steps));
            await cdp.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x, y
            });
        }

        // Mouse up at end
        await cdp.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: endCenter.x, y: endCenter.y, button: 'left', clickCount: 1
        });

        return { ok: true, action: 'drag', startRef, endRef };
    } catch (err) {
        throw toAIFriendlyError(err, `${startRef} -> ${endRef}`);
    }
}

async function selectAction(opts) {
    const ref = requireRef(opts.ref);
    if (!opts.values?.length) throw new Error('values are required for select');
    try {
        const { objectId } = await resolveRef(ref);
        await cdp.sendCommand('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function(values) {
                if (this.tagName !== 'SELECT') throw new Error('Element is not a <select>');
                for (const opt of this.options) {
                    opt.selected = values.includes(opt.value) || values.includes(opt.text);
                }
                this.dispatchEvent(new Event('change', { bubbles: true }));
            }`,
            arguments: [{ value: opts.values }],
            returnByValue: true
        });
        return { ok: true, action: 'select', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

async function pressAction(opts) {
    const key = (opts.key || '').trim();
    if (!key) throw new Error('key is required (e.g. "Enter", "Tab", "ArrowDown")');
    const def = keyDefinition(key);
    const delay = Math.max(0, Math.floor(opts.delayMs ?? 0));

    // Ensure page content has focus so key events reach the document (fixes PageDown/Up scroll)
    await cdp.evaluate('document.body?.focus()').catch(() => {});

    await cdp.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown', key: def.key, code: def.code,
        windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode,
        ...(def.text ? { text: def.text } : {})
    });
    if (delay) await new Promise(r => setTimeout(r, delay));
    await cdp.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp', key: def.key, code: def.code,
        windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode
    });

    return { ok: true, action: 'press', key };
}

async function evaluateAction(opts) {
    // Accept both 'fn' and 'expression' (MCP schema uses 'expression')
    const fn = (opts.fn || opts.expression || '').trim();
    if (!fn) throw new Error('fn or expression (JavaScript code) is required');

    const timeout = clampTimeout(opts.timeoutMs, 15000);

    const withTimeout = (promise) => Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Evaluate timed out after ${timeout}ms`)), timeout)
        )
    ]);

    if (opts.ref) {
        // For element-scoped evaluation, wrap in a function with `this` bound to the element.
        // Try as expression first (return (expr)), fall back to multi-statement (no auto-return).
        const { objectId } = await resolveRef(opts.ref);
        let result = await withTimeout(cdp.sendCommand('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function() { return (${fn}); }`,
            returnByValue: true
        })).catch(() => null);

        if (!result || result.exceptionDetails) {
            result = await withTimeout(cdp.sendCommand('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: `function() { ${fn} }`,
                returnByValue: true
            }));
        }

        if (result?.exceptionDetails) {
            const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
            return { ok: true, action: 'evaluate', error: desc };
        }
        return { ok: true, action: 'evaluate', result: result?.result?.value };
    }

    // Global page evaluate — use CDP Runtime.evaluate directly.
    // This supports multi-statement code (const, let, loops, etc.) and returns the
    // completion value of the last expression, just like the browser console.
    const result = await withTimeout(cdp.evaluate(fn));

    if (result?.exceptionDetails) {
        const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        return { ok: true, action: 'evaluate', error: desc };
    }
    return { ok: true, action: 'evaluate', result: result?.result?.value };
}

async function waitAction(opts) {
    const timeout = clampTimeout(opts.timeoutMs, 20000);

    if (typeof opts.timeMs === 'number' && Number.isFinite(opts.timeMs)) {
        await new Promise(r => setTimeout(r, Math.max(0, opts.timeMs)));
    }

    if (opts.text) {
        await pollFor(timeout, async () => {
            const r = await cdp.evaluate(
                `document.body?.innerText?.includes(${JSON.stringify(opts.text)}) || false`
            );
            return r?.result?.value === true;
        }, `text "${opts.text}" to appear`);
    }

    if (opts.textGone) {
        await pollFor(timeout, async () => {
            const r = await cdp.evaluate(
                `!document.body?.innerText?.includes(${JSON.stringify(opts.textGone)})`
            );
            return r?.result?.value === true;
        }, `text "${opts.textGone}" to disappear`);
    }

    if (opts.selector) {
        await pollFor(timeout, async () => {
            const r = await cdp.evaluate(
                `!!document.querySelector(${JSON.stringify(opts.selector)})`
            );
            return r?.result?.value === true;
        }, `selector "${opts.selector}" to appear`);
    }

    if (opts.url) {
        await pollFor(timeout, async () => {
            const currentUrl = await cdp.getUrl();
            if (opts.url instanceof RegExp) return opts.url.test(currentUrl);
            return currentUrl.includes(opts.url);
        }, `URL to match "${opts.url}"`);
    }

    if (opts.loadState) {
        // Wait for document ready state
        const targetState = opts.loadState === 'networkidle' ? 'complete'
            : opts.loadState === 'domcontentloaded' ? 'interactive'
            : 'complete';
        await pollFor(timeout, async () => {
            const r = await cdp.evaluate(`document.readyState`);
            const state = r?.result?.value;
            if (targetState === 'interactive') return state === 'interactive' || state === 'complete';
            return state === 'complete';
        }, `load state "${opts.loadState}"`);
    }

    if (opts.fn) {
        await pollFor(timeout, async () => {
            const r = await cdp.evaluate(`!!(${opts.fn})`);
            return r?.result?.value === true;
        }, `function to return truthy`);
    }

    return { ok: true, action: 'wait' };
}

/**
 * Poll a condition until it's true or timeout.
 */
async function pollFor(timeoutMs, conditionFn, description) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            if (await conditionFn()) return;
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}

async function screenshotAction(opts) {
    const type = opts.type || 'png';

    if (opts.ref) {
        // Element screenshot via CDP clip
        const { objectId } = await resolveRef(opts.ref);
        await scrollIntoView(objectId);
        const box = await getElementCenter(objectId);
        // Get full box (not center)
        const boxResult = await cdp.sendCommand('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function() {
                const rect = this.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            }`,
            returnByValue: true
        });
        const clip = boxResult?.result?.value;
        if (clip) clip.scale = 1;

        const result = await cdp.sendCommand('Page.captureScreenshot', {
            format: type,
            ...(clip ? { clip } : {}),
            fromSurface: true
        });
        const buffer = Buffer.from(result.data, 'base64');
        return { ok: true, action: 'screenshot', buffer, base64: result.data, contentType: type === 'jpeg' ? 'image/jpeg' : 'image/png' };
    }

    const buffer = await cdp.captureScreenshot({ format: type, fullPage: opts.fullPage });
    return {
        ok: true, action: 'screenshot',
        buffer,
        base64: buffer.toString('base64'),
        contentType: type === 'jpeg' ? 'image/jpeg' : 'image/png'
    };
}

async function navigateAction(opts) {
    const url = (opts.url || '').trim();
    if (!url) throw new Error('url is required');
    const timeout = Math.max(1000, Math.min(120000, opts.timeoutMs ?? 20000));

    await cdp.navigate(url, timeout);
    const currentUrl = await cdp.getUrl();
    return { ok: true, action: 'navigate', url: currentUrl };
}

async function uploadAction(opts) {
    if (!opts.paths?.length) throw new Error('paths are required');
    const ref = opts.ref || opts.inputRef;
    if (!ref) throw new Error('ref or inputRef is required');

    try {
        const { objectId } = await resolveRef(ref);
        // Get the nodeId from objectId
        const nodeResult = await cdp.sendCommand('DOM.requestNode', { objectId });
        const nodeId = nodeResult?.nodeId;
        if (!nodeId) throw new Error('Could not get DOM nodeId for file input');

        await cdp.sendCommand('DOM.setFileInputFiles', {
            files: opts.paths,
            nodeId
        });

        // Dispatch events
        await cdp.sendCommand('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function() {
                this.dispatchEvent(new Event('input', { bubbles: true }));
                this.dispatchEvent(new Event('change', { bubbles: true }));
            }`,
            returnByValue: true
        });

        return { ok: true, action: 'upload', fileCount: opts.paths.length };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

async function resizeAction(opts) {
    if (!opts.width || !opts.height) throw new Error('width and height are required');
    await cdp.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: Math.max(1, Math.floor(opts.width)),
        height: Math.max(1, Math.floor(opts.height)),
        deviceScaleFactor: 1,
        mobile: false
    });
    return { ok: true, action: 'resize', width: opts.width, height: opts.height };
}

async function dialogAcceptAction(opts) {
    const params = { accept: true };
    if (opts.promptText != null) {
        params.promptText = String(opts.promptText);
    }
    await cdp.sendCommand('Page.handleJavaScriptDialog', params);
    return { ok: true, action: 'dialog_accept' };
}

async function dialogDismissAction(opts) {
    await cdp.sendCommand('Page.handleJavaScriptDialog', { accept: false });
    return { ok: true, action: 'dialog_dismiss' };
}

/**
 * Dispatch an action request by kind.
 * @param {Object} request - { kind: string, ...params }
 * @returns {Promise<Object>}
 */
async function executeAction(request) {
    switch (request.kind) {
        case 'click':      return await clickAction(request);
        case 'type':       return await typeAction(request);
        case 'fill':       return await fillFormAction(request);
        case 'hover':      return await hoverAction(request);
        case 'drag':       return await dragAction(request);
        case 'select':     return await selectAction(request);
        case 'press':      return await pressAction(request);
        case 'evaluate':   return await evaluateAction(request);
        case 'wait':       return await waitAction(request);
        case 'screenshot': return await screenshotAction(request);
        case 'navigate':   return await navigateAction(request);
        case 'upload':         return await uploadAction(request);
        case 'resize':         return await resizeAction(request);
        case 'dialog_accept':  return await dialogAcceptAction(request);
        case 'dialog_dismiss': return await dialogDismissAction(request);
        default:
            throw new Error(`Unknown action kind: "${request.kind}". Supported: click, type, fill, hover, drag, select, press, evaluate, wait, screenshot, navigate, upload, resize, dialog_accept, dialog_dismiss.`);
    }
}

module.exports = {
    clickAction,
    typeAction,
    fillFormAction,
    hoverAction,
    dragAction,
    selectAction,
    pressAction,
    evaluateAction,
    waitAction,
    screenshotAction,
    navigateAction,
    uploadAction,
    resizeAction,
    dialogAcceptAction,
    dialogDismissAction,
    executeAction,
    storeRefs,
    resolveRef
};
