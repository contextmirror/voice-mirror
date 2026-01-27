/**
 * Chrome Extension Relay Server.
 * HTTP + WebSocket server that bridges a Chrome extension to Playwright via CDP.
 *
 * Architecture:
 *   Chrome Extension ←→ /extension (WebSocket) ←→ Relay ←→ /cdp (WebSocket) ←→ Playwright
 *
 * Also serves REST endpoints:
 *   /json/version — CDP version info (with webSocketDebuggerUrl when extension connected)
 *   /json/list    — list of attached tabs
 *   /json/activate/:id — activate a tab
 *   /json/close/:id    — close a tab
 */

const http = require('http');
const WebSocket = require('ws');

/** @type {Map<number, ExtensionRelayServer>} */
const serversByPort = new Map();

/**
 * @typedef {Object} ExtensionRelayServer
 * @property {string} host
 * @property {number} port
 * @property {string} baseUrl
 * @property {string} cdpWsUrl
 * @property {() => boolean} extensionConnected
 * @property {() => Promise<void>} stop
 */

/**
 * @typedef {Object} ConnectedTarget
 * @property {string} sessionId
 * @property {string} targetId
 * @property {Object} targetInfo
 */

function isLoopbackAddress(ip) {
    if (!ip) return false;
    if (ip === '127.0.0.1') return true;
    if (ip.startsWith('127.')) return true;
    if (ip === '::1') return true;
    if (ip.startsWith('::ffff:127.')) return true;
    return false;
}

function parseBaseUrl(raw) {
    const parsed = new URL(raw.trim().replace(/\/$/, ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Extension relay cdpUrl must be http(s), got ${parsed.protocol}`);
    }
    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error(`Extension relay cdpUrl has invalid port: ${parsed.port || '(empty)'}`);
    }
    return { host, port, baseUrl: parsed.toString().replace(/\/$/, '') };
}

function rejectUpgrade(socket, status, body) {
    const buf = Buffer.from(body);
    socket.write(
        `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'ERR'}\r\n` +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${buf.length}\r\n` +
        'Connection: close\r\n' +
        '\r\n'
    );
    socket.write(buf);
    socket.end();
    try { socket.destroy(); } catch { /* ignore */ }
}

/**
 * Ensure an extension relay server is running on the given cdpUrl port.
 * @param {{ cdpUrl: string }} opts
 * @returns {Promise<ExtensionRelayServer>}
 */
async function ensureExtensionRelayServer(opts) {
    const info = parseBaseUrl(opts.cdpUrl);

    const existing = serversByPort.get(info.port);
    if (existing) return existing;

    /** @type {WebSocket|null} */
    let extensionWs = null;
    /** @type {Set<WebSocket>} */
    const cdpClients = new Set();
    /** @type {Map<string, ConnectedTarget>} */
    const connectedTargets = new Map();

    /** @type {Map<number, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    const pendingExtension = new Map();
    let nextExtensionId = 1;

    const sendToExtension = async (payload) => {
        const ws = extensionWs;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error('Chrome extension not connected');
        }
        ws.send(JSON.stringify(payload));
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingExtension.delete(payload.id);
                reject(new Error(`Extension request timeout: ${payload.params.method}`));
            }, 30000);
            pendingExtension.set(payload.id, { resolve, reject, timer });
        });
    };

    const broadcastToCdpClients = (evt) => {
        const msg = JSON.stringify(evt);
        for (const ws of cdpClients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
    };

    const sendResponseToCdp = (ws, res) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(res));
    };

    const ensureTargetEventsForClient = (ws, mode) => {
        for (const target of connectedTargets.values()) {
            if (mode === 'autoAttach') {
                ws.send(JSON.stringify({
                    method: 'Target.attachedToTarget',
                    params: {
                        sessionId: target.sessionId,
                        targetInfo: { ...target.targetInfo, attached: true },
                        waitingForDebugger: false,
                    },
                }));
            } else {
                ws.send(JSON.stringify({
                    method: 'Target.targetCreated',
                    params: { targetInfo: { ...target.targetInfo, attached: true } },
                }));
            }
        }
    };

    const routeCdpCommand = async (cmd) => {
        switch (cmd.method) {
            case 'Browser.getVersion':
                return {
                    protocolVersion: '1.3',
                    product: 'Chrome/VoiceMirror-Extension-Relay',
                    revision: '0',
                    userAgent: 'VoiceMirror-Extension-Relay',
                    jsVersion: 'V8',
                };
            case 'Browser.setDownloadBehavior':
                return {};
            case 'Target.setAutoAttach':
            case 'Target.setDiscoverTargets':
                return {};
            case 'Target.getTargets':
                return {
                    targetInfos: Array.from(connectedTargets.values()).map(t => ({
                        ...t.targetInfo, attached: true,
                    })),
                };
            case 'Target.getTargetInfo': {
                const params = cmd.params || {};
                const targetId = typeof params.targetId === 'string' ? params.targetId : undefined;
                if (targetId) {
                    for (const t of connectedTargets.values()) {
                        if (t.targetId === targetId) return { targetInfo: t.targetInfo };
                    }
                }
                if (cmd.sessionId && connectedTargets.has(cmd.sessionId)) {
                    return { targetInfo: connectedTargets.get(cmd.sessionId).targetInfo };
                }
                const first = Array.from(connectedTargets.values())[0];
                return { targetInfo: first?.targetInfo };
            }
            case 'Target.attachToTarget': {
                const params = cmd.params || {};
                const targetId = typeof params.targetId === 'string' ? params.targetId : undefined;
                if (!targetId) throw new Error('targetId required');
                for (const t of connectedTargets.values()) {
                    if (t.targetId === targetId) return { sessionId: t.sessionId };
                }
                throw new Error('target not found');
            }
            default: {
                const id = nextExtensionId++;
                return await sendToExtension({
                    id,
                    method: 'forwardCDPCommand',
                    params: {
                        method: cmd.method,
                        sessionId: cmd.sessionId,
                        params: cmd.params,
                    },
                });
            }
        }
    };

    // --- HTTP server ---
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', info.baseUrl);
        const pathname = url.pathname;

        if (req.method === 'HEAD' && pathname === '/') {
            res.writeHead(200);
            res.end();
            return;
        }
        if (pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
            return;
        }
        if (pathname === '/extension/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ connected: Boolean(extensionWs) }));
            return;
        }

        const hostHeader = req.headers.host || `${info.host}:${info.port}`;
        const cdpWsUrl = `ws://${hostHeader}/cdp`;

        if ((pathname === '/json/version' || pathname === '/json/version/') &&
            (req.method === 'GET' || req.method === 'PUT')) {
            const payload = {
                Browser: 'VoiceMirror/extension-relay',
                'Protocol-Version': '1.3',
            };
            if (extensionWs) payload.webSocketDebuggerUrl = cdpWsUrl;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
            return;
        }

        const listPaths = new Set(['/json', '/json/', '/json/list', '/json/list/']);
        if (listPaths.has(pathname) && (req.method === 'GET' || req.method === 'PUT')) {
            const list = Array.from(connectedTargets.values()).map(t => ({
                id: t.targetId,
                type: t.targetInfo.type || 'page',
                title: t.targetInfo.title || '',
                description: t.targetInfo.title || '',
                url: t.targetInfo.url || '',
                webSocketDebuggerUrl: cdpWsUrl,
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
            return;
        }

        const activateMatch = pathname.match(/^\/json\/activate\/(.+)$/);
        if (activateMatch && (req.method === 'GET' || req.method === 'PUT')) {
            const targetId = decodeURIComponent(activateMatch[1] || '').trim();
            if (!targetId) { res.writeHead(400); res.end('targetId required'); return; }
            sendToExtension({
                id: nextExtensionId++,
                method: 'forwardCDPCommand',
                params: { method: 'Target.activateTarget', params: { targetId } },
            }).catch(() => {});
            res.writeHead(200); res.end('OK');
            return;
        }

        const closeMatch = pathname.match(/^\/json\/close\/(.+)$/);
        if (closeMatch && (req.method === 'GET' || req.method === 'PUT')) {
            const targetId = decodeURIComponent(closeMatch[1] || '').trim();
            if (!targetId) { res.writeHead(400); res.end('targetId required'); return; }
            sendToExtension({
                id: nextExtensionId++,
                method: 'forwardCDPCommand',
                params: { method: 'Target.closeTarget', params: { targetId } },
            }).catch(() => {});
            res.writeHead(200); res.end('OK');
            return;
        }

        res.writeHead(404); res.end('not found');
    });

    // --- WebSocket servers ---
    const wssExtension = new WebSocket.Server({ noServer: true });
    const wssCdp = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', info.baseUrl);
        const pathname = url.pathname;
        const remote = req.socket.remoteAddress;

        if (!isLoopbackAddress(remote)) {
            rejectUpgrade(socket, 403, 'Forbidden');
            return;
        }

        if (pathname === '/extension') {
            if (extensionWs) {
                rejectUpgrade(socket, 409, 'Extension already connected');
                return;
            }
            wssExtension.handleUpgrade(req, socket, head, ws => {
                wssExtension.emit('connection', ws, req);
            });
            return;
        }

        if (pathname === '/cdp') {
            if (!extensionWs) {
                rejectUpgrade(socket, 503, 'Extension not connected');
                return;
            }
            wssCdp.handleUpgrade(req, socket, head, ws => {
                wssCdp.emit('connection', ws, req);
            });
            return;
        }

        rejectUpgrade(socket, 404, 'Not Found');
    });

    // --- Extension WebSocket handler ---
    wssExtension.on('connection', (ws) => {
        extensionWs = ws;
        console.log('[extension-relay] Chrome extension connected');

        const ping = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ method: 'ping' }));
            }
        }, 5000);

        ws.on('message', (data) => {
            let parsed;
            try { parsed = JSON.parse(String(data)); } catch { return; }

            // Response to a pending request
            if (parsed && typeof parsed.id === 'number') {
                const pending = pendingExtension.get(parsed.id);
                if (!pending) return;
                pendingExtension.delete(parsed.id);
                clearTimeout(pending.timer);
                if (typeof parsed.error === 'string' && parsed.error.trim()) {
                    pending.reject(new Error(parsed.error));
                } else {
                    pending.resolve(parsed.result);
                }
                return;
            }

            // Forwarded CDP event
            if (parsed && parsed.method === 'pong') return;
            if (parsed && parsed.method === 'forwardCDPEvent') {
                const method = parsed.params?.method;
                const params = parsed.params?.params;
                const sessionId = parsed.params?.sessionId;
                if (!method) return;

                if (method === 'Target.attachedToTarget') {
                    const attached = params || {};
                    if ((attached.targetInfo?.type || 'page') !== 'page') return;
                    if (attached.sessionId && attached.targetInfo?.targetId) {
                        const prev = connectedTargets.get(attached.sessionId);
                        const nextTargetId = attached.targetInfo.targetId;
                        const prevTargetId = prev?.targetId;
                        const changed = prev && prevTargetId && prevTargetId !== nextTargetId;
                        connectedTargets.set(attached.sessionId, {
                            sessionId: attached.sessionId,
                            targetId: nextTargetId,
                            targetInfo: attached.targetInfo,
                        });
                        if (changed && prevTargetId) {
                            broadcastToCdpClients({
                                method: 'Target.detachedFromTarget',
                                params: { sessionId: attached.sessionId, targetId: prevTargetId },
                                sessionId: attached.sessionId,
                            });
                        }
                        if (!prev || changed) {
                            broadcastToCdpClients({ method, params, sessionId });
                        }
                        return;
                    }
                }

                if (method === 'Target.detachedFromTarget') {
                    const detached = params || {};
                    if (detached.sessionId) connectedTargets.delete(detached.sessionId);
                    broadcastToCdpClients({ method, params, sessionId });
                    return;
                }

                if (method === 'Target.targetInfoChanged') {
                    const targetInfo = params?.targetInfo;
                    const targetId = targetInfo?.targetId;
                    if (targetId && (targetInfo?.type || 'page') === 'page') {
                        for (const [sid, target] of connectedTargets) {
                            if (target.targetId === targetId) {
                                connectedTargets.set(sid, {
                                    ...target,
                                    targetInfo: { ...target.targetInfo, ...targetInfo },
                                });
                            }
                        }
                    }
                }

                broadcastToCdpClients({ method, params, sessionId });
            }
        });

        ws.on('close', () => {
            clearInterval(ping);
            extensionWs = null;
            console.log('[extension-relay] Chrome extension disconnected');

            for (const [, pending] of pendingExtension) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Extension disconnected'));
            }
            pendingExtension.clear();
            connectedTargets.clear();

            for (const client of cdpClients) {
                try { client.close(1011, 'extension disconnected'); } catch { /* ignore */ }
            }
            cdpClients.clear();
        });
    });

    // --- CDP WebSocket handler ---
    wssCdp.on('connection', (ws) => {
        cdpClients.add(ws);

        ws.on('message', async (data) => {
            let cmd;
            try { cmd = JSON.parse(String(data)); } catch { return; }
            if (!cmd || typeof cmd.id !== 'number' || typeof cmd.method !== 'string') return;

            if (!extensionWs) {
                sendResponseToCdp(ws, {
                    id: cmd.id, sessionId: cmd.sessionId,
                    error: { message: 'Extension not connected' },
                });
                return;
            }

            try {
                const result = await routeCdpCommand(cmd);

                if (cmd.method === 'Target.setAutoAttach' && !cmd.sessionId) {
                    ensureTargetEventsForClient(ws, 'autoAttach');
                }
                if (cmd.method === 'Target.setDiscoverTargets') {
                    if (cmd.params?.discover === true) {
                        ensureTargetEventsForClient(ws, 'discover');
                    }
                }
                if (cmd.method === 'Target.attachToTarget') {
                    const targetId = cmd.params?.targetId;
                    if (targetId) {
                        const target = Array.from(connectedTargets.values()).find(t => t.targetId === targetId);
                        if (target) {
                            ws.send(JSON.stringify({
                                method: 'Target.attachedToTarget',
                                params: {
                                    sessionId: target.sessionId,
                                    targetInfo: { ...target.targetInfo, attached: true },
                                    waitingForDebugger: false,
                                },
                            }));
                        }
                    }
                }

                sendResponseToCdp(ws, { id: cmd.id, sessionId: cmd.sessionId, result });
            } catch (err) {
                sendResponseToCdp(ws, {
                    id: cmd.id, sessionId: cmd.sessionId,
                    error: { message: err instanceof Error ? err.message : String(err) },
                });
            }
        });

        ws.on('close', () => {
            cdpClients.delete(ws);
        });
    });

    // --- Start listening ---
    await new Promise((resolve, reject) => {
        server.listen(info.port, info.host, () => resolve());
        server.once('error', reject);
    });

    const addr = server.address();
    const port = addr?.port || info.port;
    const host = info.host;
    const baseUrl = `http://${host}:${port}`;

    console.log(`[extension-relay] Listening on ${baseUrl}`);

    const relay = {
        host,
        port,
        baseUrl,
        cdpWsUrl: `ws://${host}:${port}/cdp`,
        extensionConnected: () => Boolean(extensionWs),
        stop: async () => {
            serversByPort.delete(port);
            try { extensionWs?.close(1001, 'server stopping'); } catch { /* ignore */ }
            for (const ws of cdpClients) {
                try { ws.close(1001, 'server stopping'); } catch { /* ignore */ }
            }
            await new Promise(resolve => { server.close(() => resolve()); });
            wssExtension.close();
            wssCdp.close();
        },
    };

    serversByPort.set(port, relay);
    return relay;
}

/**
 * Stop an extension relay server by cdpUrl.
 * @param {{ cdpUrl: string }} opts
 * @returns {Promise<boolean>}
 */
async function stopExtensionRelayServer(opts) {
    const info = parseBaseUrl(opts.cdpUrl);
    const existing = serversByPort.get(info.port);
    if (!existing) return false;
    await existing.stop();
    return true;
}

module.exports = {
    ensureExtensionRelayServer,
    stopExtensionRelayServer,
};
