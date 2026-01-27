/**
 * CDP client functions for direct Chrome DevTools Protocol operations.
 * Uses raw WebSocket via cdp-helpers for low-level browser control.
 */

const { withCdpSocket, getChromeWebSocketUrl, normalizeCdpWsUrl, fetchJson, appendCdpPath } = require('./cdp-helpers');

/**
 * Capture a screenshot via CDP.
 * @param {Object} opts
 * @param {string} opts.wsUrl - WebSocket debugger URL for the target
 * @param {boolean} [opts.fullPage] - Capture full scrollable page
 * @param {'png'|'jpeg'} [opts.format] - Image format
 * @param {number} [opts.quality] - JPEG quality (0-100)
 * @returns {Promise<Buffer>}
 */
async function captureScreenshot(opts) {
    return await withCdpSocket(opts.wsUrl, async (send) => {
        await send('Page.enable');

        let clip;
        if (opts.fullPage) {
            const metrics = await send('Page.getLayoutMetrics');
            const size = metrics?.cssContentSize || metrics?.contentSize;
            const width = Number(size?.width || 0);
            const height = Number(size?.height || 0);
            if (width > 0 && height > 0) {
                clip = { x: 0, y: 0, width, height, scale: 1 };
            }
        }

        const format = opts.format || 'png';
        const quality = format === 'jpeg'
            ? Math.max(0, Math.min(100, Math.round(opts.quality ?? 85)))
            : undefined;

        const result = await send('Page.captureScreenshot', {
            format,
            ...(quality !== undefined ? { quality } : {}),
            fromSurface: true,
            captureBeyondViewport: true,
            ...(clip ? { clip } : {})
        });

        const base64 = result?.data;
        if (!base64) throw new Error('Screenshot failed: missing data');
        return Buffer.from(base64, 'base64');
    });
}

/**
 * Evaluate JavaScript in the page via CDP.
 * @param {Object} opts
 * @param {string} opts.wsUrl
 * @param {string} opts.expression
 * @param {boolean} [opts.awaitPromise]
 * @param {boolean} [opts.returnByValue]
 * @returns {Promise<{result: Object, exceptionDetails?: Object}>}
 */
async function evaluateJavaScript(opts) {
    return await withCdpSocket(opts.wsUrl, async (send) => {
        await send('Runtime.enable').catch(() => {});
        const evaluated = await send('Runtime.evaluate', {
            expression: opts.expression,
            awaitPromise: Boolean(opts.awaitPromise),
            returnByValue: opts.returnByValue ?? true,
            userGesture: true,
            includeCommandLineAPI: true
        });

        const result = evaluated?.result;
        if (!result) throw new Error('CDP Runtime.evaluate returned no result');
        return { result, exceptionDetails: evaluated.exceptionDetails };
    });
}

/**
 * Get the ARIA accessibility tree snapshot via CDP.
 * @param {Object} opts
 * @param {string} opts.wsUrl
 * @param {number} [opts.limit=500] - Max nodes to return
 * @returns {Promise<{nodes: Array}>}
 */
async function snapshotAria(opts) {
    const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 500)));
    return await withCdpSocket(opts.wsUrl, async (send) => {
        await send('Accessibility.enable').catch(() => {});
        const res = await send('Accessibility.getFullAXTree');
        const nodes = Array.isArray(res?.nodes) ? res.nodes : [];
        return { nodes: formatAriaSnapshot(nodes, limit) };
    });
}

/**
 * Format raw AX tree nodes into a flat depth-first list.
 * @param {Array} nodes - Raw CDP accessibility nodes
 * @param {number} limit - Max output nodes
 * @returns {Array<{ref: string, role: string, name: string, value?: string, description?: string, depth: number}>}
 */
function formatAriaSnapshot(nodes, limit) {
    const byId = new Map();
    for (const n of nodes) {
        if (n.nodeId) byId.set(n.nodeId, n);
    }

    // Find root: node not referenced as any child
    const referenced = new Set();
    for (const n of nodes) {
        for (const c of (n.childIds || [])) referenced.add(c);
    }
    const root = nodes.find(n => n.nodeId && !referenced.has(n.nodeId)) || nodes[0];
    if (!root?.nodeId) return [];

    const out = [];
    const stack = [{ id: root.nodeId, depth: 0 }];
    while (stack.length && out.length < limit) {
        const { id, depth } = stack.pop();
        const n = byId.get(id);
        if (!n) continue;

        const role = axValue(n.role);
        const name = axValue(n.name);
        const value = axValue(n.value);
        const description = axValue(n.description);
        const ref = `ax${out.length + 1}`;

        out.push({
            ref,
            role: role || 'unknown',
            name: name || '',
            ...(value ? { value } : {}),
            ...(description ? { description } : {}),
            ...(typeof n.backendDOMNodeId === 'number' ? { backendDOMNodeId: n.backendDOMNodeId } : {}),
            depth
        });

        const children = (n.childIds || []).filter(c => byId.has(c));
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ id: children[i], depth: depth + 1 });
        }
    }

    return out;
}

function axValue(v) {
    if (!v || typeof v !== 'object') return '';
    const val = v.value;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return '';
}

/**
 * Get a DOM snapshot by injecting JavaScript that walks the tree.
 * @param {Object} opts
 * @param {string} opts.wsUrl
 * @param {number} [opts.limit=800]
 * @param {number} [opts.maxTextChars=220]
 * @returns {Promise<{nodes: Array}>}
 */
async function snapshotDom(opts) {
    const limit = Math.max(1, Math.min(5000, Math.floor(opts.limit ?? 800)));
    const maxTextChars = Math.max(0, Math.min(5000, Math.floor(opts.maxTextChars ?? 220)));

    const expression = `(() => {
        const maxNodes = ${JSON.stringify(limit)};
        const maxText = ${JSON.stringify(maxTextChars)};
        const nodes = [];
        const root = document.documentElement;
        if (!root) return { nodes };
        const stack = [{ el: root, depth: 0, parentRef: null }];
        while (stack.length && nodes.length < maxNodes) {
            const cur = stack.pop();
            const el = cur.el;
            if (!el || el.nodeType !== 1) continue;
            const ref = "n" + String(nodes.length + 1);
            const tag = (el.tagName || "").toLowerCase();
            const id = el.id ? String(el.id) : undefined;
            const className = el.className ? String(el.className).slice(0, 300) : undefined;
            const role = el.getAttribute && el.getAttribute("role") ? String(el.getAttribute("role")) : undefined;
            const name = el.getAttribute && el.getAttribute("aria-label") ? String(el.getAttribute("aria-label")) : undefined;
            let text = "";
            try { text = String(el.innerText || "").trim(); } catch {}
            if (maxText && text.length > maxText) text = text.slice(0, maxText) + "\\u2026";
            const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
            const type = (el.type !== undefined && el.type !== null) ? String(el.type) : undefined;
            const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;
            nodes.push({
                ref, parentRef: cur.parentRef, depth: cur.depth, tag,
                ...(id ? { id } : {}), ...(className ? { className } : {}),
                ...(role ? { role } : {}), ...(name ? { name } : {}),
                ...(text ? { text } : {}), ...(href ? { href } : {}),
                ...(type ? { type } : {}), ...(value ? { value } : {}),
            });
            const children = el.children ? Array.from(el.children) : [];
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ el: children[i], depth: cur.depth + 1, parentRef: ref });
            }
        }
        return { nodes };
    })()`;

    const evaluated = await evaluateJavaScript({
        wsUrl: opts.wsUrl,
        expression,
        awaitPromise: true,
        returnByValue: true
    });

    const value = evaluated.result?.value;
    if (!value || typeof value !== 'object') return { nodes: [] };
    return { nodes: Array.isArray(value.nodes) ? value.nodes : [] };
}

/**
 * Create a new tab via CDP Target.createTarget.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} opts.url
 * @returns {Promise<{targetId: string}>}
 */
async function createTargetViaCdp(opts) {
    const version = await fetchJson(appendCdpPath(opts.cdpUrl, '/json/version'), 1500);
    const wsUrlRaw = String(version?.webSocketDebuggerUrl || '').trim();
    const wsUrl = wsUrlRaw ? normalizeCdpWsUrl(wsUrlRaw, opts.cdpUrl) : '';
    if (!wsUrl) throw new Error('CDP /json/version missing webSocketDebuggerUrl');

    return await withCdpSocket(wsUrl, async (send) => {
        const created = await send('Target.createTarget', { url: opts.url });
        const targetId = String(created?.targetId || '').trim();
        if (!targetId) throw new Error('CDP Target.createTarget returned no targetId');
        return { targetId };
    });
}

module.exports = {
    captureScreenshot,
    evaluateJavaScript,
    snapshotAria,
    snapshotDom,
    createTargetViaCdp,
    formatAriaSnapshot
};
