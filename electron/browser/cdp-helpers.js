/**
 * CDP (Chrome DevTools Protocol) helper utilities.
 * Raw WebSocket communication with Chrome's debugging protocol.
 */

const WebSocket = require('ws');

/**
 * Check if an IP address is loopback.
 * @param {string} ip
 * @returns {boolean}
 */
function isLoopbackAddress(ip) {
    if (!ip) return false;
    if (ip === '127.0.0.1') return true;
    if (ip.startsWith('127.')) return true;
    if (ip === '::1') return true;
    if (ip.startsWith('::ffff:127.')) return true;
    return false;
}

/**
 * Append a path to a CDP URL, preserving auth and query params.
 * @param {string} baseUrl
 * @param {string} urlPath
 * @returns {string}
 */
function appendCdpPath(baseUrl, urlPath) {
    const parsed = new URL(baseUrl);
    parsed.pathname = urlPath;
    return parsed.toString();
}

/**
 * Fetch JSON from a URL with timeout.
 * @param {string} url
 * @param {number} [timeoutMs=1500]
 * @returns {Promise<any>}
 */
async function fetchJson(url, timeoutMs = 1500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Normalize a CDP WebSocket URL to use the correct host from cdpUrl.
 * Chrome sometimes returns ws://0.0.0.0 or ws://127.0.0.1 which may not match.
 * @param {string} wsUrl
 * @param {string} cdpUrl
 * @returns {string}
 */
function normalizeCdpWsUrl(wsUrl, cdpUrl) {
    const ws = new URL(wsUrl);
    const cdp = new URL(cdpUrl);
    const isWsLoopback = isLoopbackAddress(ws.hostname) || ws.hostname === 'localhost';
    const isCdpLoopback = isLoopbackAddress(cdp.hostname) || cdp.hostname === 'localhost';

    if (isWsLoopback && !isCdpLoopback) {
        ws.hostname = cdp.hostname;
        const cdpPort = cdp.port || (cdp.protocol === 'https:' ? '443' : '80');
        if (cdpPort) ws.port = cdpPort;
        ws.protocol = cdp.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    if (cdp.protocol === 'https:' && ws.protocol === 'ws:') {
        ws.protocol = 'wss:';
    }
    return ws.toString();
}

/**
 * Get Chrome's WebSocket debugger URL from the /json/version endpoint.
 * @param {string} cdpUrl - e.g. "http://127.0.0.1:19210"
 * @param {number} [timeoutMs=1500]
 * @returns {Promise<string|null>}
 */
async function getChromeWebSocketUrl(cdpUrl, timeoutMs = 1500) {
    try {
        const version = await fetchJson(appendCdpPath(cdpUrl, '/json/version'), timeoutMs);
        const wsUrl = String(version?.webSocketDebuggerUrl || '').trim();
        if (!wsUrl) return null;
        return normalizeCdpWsUrl(wsUrl, cdpUrl);
    } catch {
        return null;
    }
}

/**
 * Test if a WebSocket URL is connectable.
 * @param {string} wsUrl
 * @param {number} [timeoutMs=800]
 * @returns {Promise<boolean>}
 */
async function canOpenWebSocket(wsUrl, timeoutMs = 800) {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrl, { handshakeTimeout: timeoutMs });
        const timer = setTimeout(() => {
            try { ws.terminate(); } catch { /* ignore */ }
            resolve(false);
        }, Math.max(50, timeoutMs + 25));

        ws.once('open', () => {
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            resolve(true);
        });
        ws.once('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

/**
 * Open a raw CDP WebSocket and execute a function with a send helper.
 * Auto-closes the socket when done.
 *
 * @param {string} wsUrl
 * @param {(send: (method: string, params?: any) => Promise<any>) => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function withCdpSocket(wsUrl, fn) {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
    let nextId = 1;
    const pending = new Map();

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            for (const [, p] of pending) {
                clearTimeout(p.timer);
                p.reject(new Error('WebSocket closed'));
            }
            pending.clear();
            try { ws.close(); } catch { /* ignore */ }
        };

        ws.on('open', async () => {
            try {
                const result = await fn(send);
                cleanup();
                resolve(result);
            } catch (err) {
                cleanup();
                reject(err);
            }
        });

        ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { return; }
            if (typeof msg.id === 'number') {
                const p = pending.get(msg.id);
                if (!p) return;
                pending.delete(msg.id);
                clearTimeout(p.timer);
                if (msg.error) {
                    p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                } else {
                    p.resolve(msg.result);
                }
            }
        });

        ws.on('error', (err) => {
            cleanup();
            reject(err);
        });

        ws.on('close', () => {
            cleanup();
        });

        function send(method, params) {
            return new Promise((res, rej) => {
                const id = nextId++;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    rej(new Error(`CDP timeout: ${method}`));
                }, 30000);
                pending.set(id, { resolve: res, reject: rej, timer });
                const msg = JSON.stringify({ id, method, ...(params ? { params } : {}) });
                ws.send(msg);
            });
        }
    });
}

module.exports = {
    isLoopbackAddress,
    appendCdpPath,
    fetchJson,
    normalizeCdpWsUrl,
    getChromeWebSocketUrl,
    canOpenWebSocket,
    withCdpSocket
};
