/**
 * Diagnostic Watcher — watches for pipeline_trace requests from MCP.
 * Injects messages into the live pipeline and collects trace data.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const collector = require('./diagnostic-collector');
const { createLogger } = require('./logger');
const logger = createLogger();

let watcher = null;
let dataDir = null;

function start(dir) {
    if (watcher) return;

    const { getDataDir } = require('./platform-paths');
    dataDir = dir || getDataDir();

    let processing = false;

    async function processRequest() {
        if (processing) return;
        processing = true;
        try {
            const requestPath = path.join(dataDir, 'diagnostic_request.json');

            let raw;
            try {
                raw = await fsPromises.readFile(requestPath, 'utf-8');
            } catch {
                return; // File doesn't exist
            }

            const request = JSON.parse(raw);

            // Stale check (10s)
            if (Date.now() - new Date(request.timestamp).getTime() > 10000) {
                try { await fsPromises.unlink(requestPath); } catch {}
                return;
            }

            // Remove request immediately
            try { await fsPromises.unlink(requestPath); } catch {}

            const traceId = request.trace_id;
            const message = request.message;
            const timeout = (request.timeout_seconds || 30) * 1000;

            logger.info('[Diagnostic]', `Starting trace: ${traceId} — "${message}"`);

            // Start trace
            collector.startTrace(traceId, message);

            // Inject message into inbox (format: { messages: [...] })
            const inboxPath = path.join(dataDir, 'inbox.json');
            let data = { messages: [] };
            try {
                const inboxRaw = await fsPromises.readFile(inboxPath, 'utf-8');
                const parsed = JSON.parse(inboxRaw);
                if (parsed && Array.isArray(parsed.messages)) {
                    data = parsed;
                } else if (Array.isArray(parsed)) {
                    data = { messages: parsed };
                }
            } catch { data = { messages: [] }; }

            const msgId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const msg = {
                id: msgId,
                from: (() => { try { const c = require('../config'); return (c.get('user.name') || 'user').toLowerCase(); } catch { return 'user'; } })(),
                message: message,
                timestamp: new Date().toISOString(),
                read_by: [],
                thread_id: 'voice-mirror'
            };

            data.messages.push(msg);
            if (data.messages.length > 100) data.messages = data.messages.slice(-100);
            await fsPromises.writeFile(inboxPath, JSON.stringify(data), 'utf-8');

            collector.addStage(traceId, 'inbox_write', {
                message_id: msgId,
                message
            });

            // Wait for trace completion (poll for inbox_response stage or timeout)
            const startTime = Date.now();
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    const trace = collector.getTrace(traceId);
                    const hasResponse = trace?.stages.some(s => s.stage === 'inbox_response');
                    const timedOut = Date.now() - startTime > timeout;

                    if (hasResponse || timedOut) {
                        clearInterval(check);
                        if (timedOut && !hasResponse) {
                            collector.addStage(traceId, 'timeout', {
                                waited_ms: Date.now() - startTime,
                                stages_captured: trace?.stages.length || 0
                            });
                        }
                        resolve();
                    }
                }, 500);
            });

            // Finalize and write trace
            const trace = collector.endTrace(traceId);
            if (trace) {
                const tracePath = path.join(dataDir, `diagnostic_trace_${traceId}.json`);
                await fsPromises.writeFile(tracePath, JSON.stringify(trace, null, 2), 'utf-8');
                logger.info('[Diagnostic]', `Trace complete: ${trace.stages.length} stages, ${trace.duration_ms}ms`);
            }

            collector.clearTrace(traceId);

        } catch (err) {
            logger.error('[Diagnostic]', 'Error:', err.message);
        } finally {
            processing = false;
        }
    }

    // Use fs.watch instead of 1s polling
    try {
        const fsWatcher = fs.watch(dataDir, (eventType, filename) => {
            if (filename === 'diagnostic_request.json') {
                processRequest();
            }
        });
        fsWatcher.on('error', (err) => {
            logger.error('[Diagnostic]', 'fs.watch error, falling back to polling:', err.message);
            watcher = setInterval(() => processRequest(), 2000);
        });
        watcher = fsWatcher;
    } catch (err) {
        logger.error('[Diagnostic]', 'fs.watch unavailable, using polling fallback:', err.message);
        watcher = setInterval(() => processRequest(), 2000);
    }

    logger.info('[Diagnostic]', 'Watcher started');
}

function stop() {
    if (watcher) {
        if (typeof watcher.close === 'function') {
            watcher.close();
        } else {
            clearInterval(watcher);
        }
        watcher = null;
    }
}

function isRunning() {
    return watcher !== null;
}

module.exports = { start, stop, isRunning };
