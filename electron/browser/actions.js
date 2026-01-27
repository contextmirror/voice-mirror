/**
 * Browser action execution.
 * All actions follow: getPage → ensureState → restoreRefs → refLocator → execute → friendlyError
 */

const { getPageForTargetId, ensurePageState, restoreRoleRefsForTarget } = require('./pw-session');
const { refLocator } = require('./role-refs');

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
    if (msg.includes('strict mode violation') || msg.includes('resolved to')) {
        return new Error(`Element "${ref}" matched multiple elements. Run a new snapshot and use a more specific ref.`);
    }
    if (msg.includes('Timeout') || msg.includes('waiting for')) {
        return new Error(`Element "${ref}" not found or not actionable within timeout. The page may have changed — run a new snapshot.`);
    }
    if (msg.includes('not attached') || msg.includes('detached')) {
        return new Error(`Element "${ref}" is no longer attached to the DOM. Run a new snapshot.`);
    }
    return err;
}

async function prepareAction(opts) {
    const page = await getPageForTargetId({ cdpUrl: opts.cdpUrl, targetId: opts.targetId });
    ensurePageState(page);
    restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
    return page;
}

// --- Actions ---

/**
 * Click an element.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @param {string} opts.ref
 * @param {boolean} [opts.doubleClick]
 * @param {'left'|'right'|'middle'} [opts.button]
 * @param {string[]} [opts.modifiers]
 * @param {number} [opts.timeoutMs]
 */
async function clickAction(opts) {
    const page = await prepareAction(opts);
    const ref = requireRef(opts.ref);
    const locator = refLocator(page, ref);
    const timeout = clampTimeout(opts.timeoutMs);
    try {
        if (opts.doubleClick) {
            await locator.dblclick({ timeout, button: opts.button, modifiers: opts.modifiers });
        } else {
            await locator.click({ timeout, button: opts.button, modifiers: opts.modifiers });
        }
        return { ok: true, action: 'click', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

/**
 * Type text into an element.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @param {string} opts.ref
 * @param {string} opts.text
 * @param {boolean} [opts.submit] - Press Enter after typing
 * @param {boolean} [opts.slowly] - Type character by character (75ms delay)
 * @param {number} [opts.timeoutMs]
 */
async function typeAction(opts) {
    const page = await prepareAction(opts);
    const ref = requireRef(opts.ref);
    const text = String(opts.text ?? '');
    const locator = refLocator(page, ref);
    const timeout = clampTimeout(opts.timeoutMs);
    try {
        if (opts.slowly) {
            await locator.click({ timeout });
            await locator.type(text, { timeout, delay: 75 });
        } else {
            await locator.fill(text, { timeout });
        }
        if (opts.submit) {
            await locator.press('Enter', { timeout });
        }
        return { ok: true, action: 'type', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

/**
 * Fill multiple form fields at once.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @param {Array<{ref: string, type: string, value: any}>} opts.fields
 * @param {number} [opts.timeoutMs]
 */
async function fillFormAction(opts) {
    const page = await prepareAction(opts);
    const timeout = clampTimeout(opts.timeoutMs);
    for (const field of (opts.fields || [])) {
        const ref = (field.ref || '').trim();
        const type = (field.type || '').trim();
        if (!ref || !type) continue;

        const locator = refLocator(page, ref);
        const value = typeof field.value === 'string' ? field.value
            : (typeof field.value === 'number' || typeof field.value === 'boolean') ? String(field.value)
            : '';

        try {
            if (type === 'checkbox' || type === 'radio') {
                const checked = field.value === true || field.value === 1 || field.value === '1' || field.value === 'true';
                await locator.setChecked(checked, { timeout });
            } else {
                await locator.fill(value, { timeout });
            }
        } catch (err) {
            throw toAIFriendlyError(err, ref);
        }
    }
    return { ok: true, action: 'fill', fieldCount: (opts.fields || []).length };
}

/**
 * Hover over an element.
 */
async function hoverAction(opts) {
    const page = await prepareAction(opts);
    const ref = requireRef(opts.ref);
    const timeout = clampTimeout(opts.timeoutMs);
    try {
        await refLocator(page, ref).hover({ timeout });
        return { ok: true, action: 'hover', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

/**
 * Drag from one element to another.
 */
async function dragAction(opts) {
    const page = await prepareAction(opts);
    const startRef = requireRef(opts.startRef);
    const endRef = requireRef(opts.endRef);
    const timeout = clampTimeout(opts.timeoutMs);
    try {
        await refLocator(page, startRef).dragTo(refLocator(page, endRef), { timeout });
        return { ok: true, action: 'drag', startRef, endRef };
    } catch (err) {
        throw toAIFriendlyError(err, `${startRef} -> ${endRef}`);
    }
}

/**
 * Select option(s) in a dropdown.
 */
async function selectAction(opts) {
    const page = await prepareAction(opts);
    const ref = requireRef(opts.ref);
    if (!opts.values?.length) throw new Error('values are required for select');
    const timeout = clampTimeout(opts.timeoutMs);
    try {
        await refLocator(page, ref).selectOption(opts.values, { timeout });
        return { ok: true, action: 'select', ref };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

/**
 * Press a keyboard key (global, no ref needed).
 */
async function pressAction(opts) {
    const page = await prepareAction(opts);
    const key = (opts.key || '').trim();
    if (!key) throw new Error('key is required (e.g. "Enter", "Tab", "ArrowDown")');
    await page.keyboard.press(key, {
        delay: Math.max(0, Math.floor(opts.delayMs ?? 0))
    });
    return { ok: true, action: 'press', key };
}

/**
 * Evaluate JavaScript in the page.
 */
async function evaluateAction(opts) {
    const page = await prepareAction(opts);
    const fn = (opts.fn || '').trim();
    if (!fn) throw new Error('fn (JavaScript code) is required');

    if (opts.ref) {
        const locator = refLocator(page, opts.ref);
        const result = await locator.evaluate((el, fnBody) => {
            try {
                const candidate = eval('(' + fnBody + ')');
                return typeof candidate === 'function' ? candidate(el) : candidate;
            } catch (err) {
                throw new Error('Invalid evaluate function: ' + (err?.message || String(err)));
            }
        }, fn);
        return { ok: true, action: 'evaluate', result };
    }

    const result = await page.evaluate((fnBody) => {
        try {
            const candidate = eval('(' + fnBody + ')');
            return typeof candidate === 'function' ? candidate() : candidate;
        } catch (err) {
            throw new Error('Invalid evaluate function: ' + (err?.message || String(err)));
        }
    }, fn);
    return { ok: true, action: 'evaluate', result };
}

/**
 * Wait for a condition.
 */
async function waitAction(opts) {
    const page = await prepareAction(opts);
    const timeout = clampTimeout(opts.timeoutMs, 20000);

    if (typeof opts.timeMs === 'number' && Number.isFinite(opts.timeMs)) {
        await page.waitForTimeout(Math.max(0, opts.timeMs));
    }
    if (opts.text) {
        await page.getByText(opts.text).first().waitFor({ state: 'visible', timeout });
    }
    if (opts.textGone) {
        await page.getByText(opts.textGone).first().waitFor({ state: 'hidden', timeout });
    }
    if (opts.selector) {
        await page.locator(opts.selector).first().waitFor({ state: 'visible', timeout });
    }
    if (opts.url) {
        await page.waitForURL(opts.url, { timeout });
    }
    if (opts.loadState) {
        await page.waitForLoadState(opts.loadState, { timeout });
    }
    if (opts.fn) {
        await page.waitForFunction(opts.fn, { timeout });
    }
    return { ok: true, action: 'wait' };
}

/**
 * Take a screenshot of the page or a specific element.
 */
async function screenshotAction(opts) {
    const page = await prepareAction(opts);
    const type = opts.type || 'png';

    let buffer;
    if (opts.ref) {
        const locator = refLocator(page, opts.ref);
        buffer = await locator.screenshot({ type });
    } else if (opts.element) {
        const locator = page.locator(opts.element).first();
        buffer = await locator.screenshot({ type });
    } else {
        buffer = await page.screenshot({ type, fullPage: Boolean(opts.fullPage) });
    }

    return {
        ok: true,
        action: 'screenshot',
        buffer,
        base64: buffer.toString('base64'),
        contentType: type === 'jpeg' ? 'image/jpeg' : 'image/png'
    };
}

/**
 * Navigate to a URL.
 */
async function navigateAction(opts) {
    const url = (opts.url || '').trim();
    if (!url) throw new Error('url is required');
    const page = await prepareAction(opts);
    await page.goto(url, {
        timeout: Math.max(1000, Math.min(120000, opts.timeoutMs ?? 20000))
    });
    return { ok: true, action: 'navigate', url: page.url() };
}

/**
 * Upload file(s) to a file input.
 */
async function uploadAction(opts) {
    const page = await prepareAction(opts);
    if (!opts.paths?.length) throw new Error('paths are required');
    const ref = opts.ref || opts.inputRef;
    if (!ref) throw new Error('ref or inputRef is required');
    const locator = refLocator(page, ref);

    try {
        await locator.setInputFiles(opts.paths);
        // Dispatch events for frameworks that need them
        try {
            const handle = await locator.elementHandle();
            if (handle) {
                await handle.evaluate((el) => {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
            }
        } catch { /* best effort */ }
        return { ok: true, action: 'upload', fileCount: opts.paths.length };
    } catch (err) {
        throw toAIFriendlyError(err, ref);
    }
}

/**
 * Resize the browser viewport.
 */
async function resizeAction(opts) {
    const page = await prepareAction(opts);
    if (!opts.width || !opts.height) throw new Error('width and height are required');
    await page.setViewportSize({
        width: Math.max(1, Math.floor(opts.width)),
        height: Math.max(1, Math.floor(opts.height))
    });
    return { ok: true, action: 'resize', width: opts.width, height: opts.height };
}

/**
 * Dispatch an action request by kind.
 * @param {Object} request - { kind: string, ...params }
 * @param {Object} context - { cdpUrl, targetId }
 * @returns {Promise<Object>}
 */
async function executeAction(request, context) {
    const opts = { ...context, ...request };

    switch (request.kind) {
        case 'click':     return await clickAction(opts);
        case 'type':      return await typeAction(opts);
        case 'fill':      return await fillFormAction(opts);
        case 'hover':     return await hoverAction(opts);
        case 'drag':      return await dragAction(opts);
        case 'select':    return await selectAction(opts);
        case 'press':     return await pressAction(opts);
        case 'evaluate':  return await evaluateAction(opts);
        case 'wait':      return await waitAction(opts);
        case 'screenshot':return await screenshotAction(opts);
        case 'navigate':  return await navigateAction(opts);
        case 'upload':    return await uploadAction(opts);
        case 'resize':    return await resizeAction(opts);
        default:
            throw new Error(`Unknown action kind: "${request.kind}". Supported: click, type, fill, hover, drag, select, press, evaluate, wait, screenshot, navigate, upload, resize.`);
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
    executeAction
};
