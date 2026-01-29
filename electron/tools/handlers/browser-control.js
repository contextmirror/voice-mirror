/**
 * Browser control tool handler for local LLMs.
 *
 * Provides a unified "browser_control" tool that local models can use to:
 * - Navigate the embedded webview browser
 * - Open URLs, search the web
 * - Take snapshots of page content (accessibility tree)
 * - Click, type, and interact with page elements
 * - Take screenshots
 * - Read console logs
 *
 * Uses the embedded <webview> via webview-cdp (no external Chrome).
 */

const controller = require('../../browser/browser-controller');

/**
 * Execute a browser control action.
 *
 * @param {Object} args
 * @param {string} args.action - Action to perform
 * @param {string} [args.url] - URL for open/navigate
 * @param {string} [args.query] - Search query
 * @param {string} [args.ref] - Element ref from snapshot (e1, e2, ...)
 * @param {string} [args.text] - Text to type/fill
 * @param {string} [args.key] - Key to press
 * @param {string} [args.expression] - JS expression for evaluate
 * @param {boolean} [args.interactive] - Only interactive elements in snapshot
 * @returns {Promise<Object>} Result with success flag and result text
 */
async function browserControl(args = {}) {
    const action = (args.action || '').toLowerCase().trim();

    if (!action) {
        return { success: false, error: 'action is required. Use: search, open, snapshot, click, type, fill, press, navigate, screenshot, console, status, stop' };
    }

    try {
        switch (action) {
            case 'search': {
                const query = args.query || args.url || args.text;
                if (!query) return { success: false, error: 'query is required for search' };

                await controller.ensureBrowserAvailable();
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
                await controller.navigateTab(searchUrl);

                await new Promise(r => setTimeout(r, 2500));

                // Dismiss Google consent if present
                await _dismissGoogleConsent();

                const snap = await controller.snapshotTab({
                    format: 'role',
                    compact: true,
                });

                if (!snap.ok) {
                    return { success: false, error: 'Failed to snapshot search results' };
                }

                const formatted = formatSnapshotForLLM(snap, query);
                console.log('[BrowserControl] Full snapshot text:\n' + (snap.snapshot || '').substring(0, 3000));
                console.log('[BrowserControl] Page text (' + (snap.pageText || '').length + ' chars):\n' + (snap.pageText || '').substring(0, 1500));
                console.log('[BrowserControl] Formatted result length: ' + formatted.length);
                return { success: true, result: formatted };
            }

            case 'open': {
                const url = args.url;
                if (!url) return { success: false, error: 'url is required for open' };

                await controller.ensureBrowserAvailable();
                await controller.navigateTab(url);
                await new Promise(r => setTimeout(r, 2500));

                const snap = await controller.snapshotTab({
                    format: 'role',
                    compact: true,
                });

                if (snap.ok) {
                    return { success: true, result: `Opened ${url}\n\n${formatSnapshotForLLM(snap, url)}` };
                }
                return { success: true, result: `Opened ${url}` };
            }

            case 'snapshot': {
                await controller.ensureBrowserAvailable();
                const snap = await controller.snapshotTab({
                    format: 'role',
                    interactive: args.interactive || false,
                    compact: true,
                });

                if (!snap.ok) {
                    return { success: false, error: 'Failed to take snapshot' };
                }
                return { success: true, result: formatSnapshotForLLM(snap) };
            }

            case 'click': {
                if (!args.ref) return { success: false, error: 'ref is required for click (e.g. "e1")' };
                await controller.ensureBrowserAvailable();
                const result = await controller.actOnTab({ kind: 'click', ref: args.ref });
                return { success: true, result: `Clicked ${args.ref}. ${result.message || ''}`.trim() };
            }

            case 'type': {
                if (!args.ref) return { success: false, error: 'ref is required for type' };
                if (!args.text) return { success: false, error: 'text is required for type' };
                await controller.ensureBrowserAvailable();
                await controller.actOnTab({ kind: 'type', ref: args.ref, text: args.text });
                return { success: true, result: `Typed "${args.text}" into ${args.ref}` };
            }

            case 'fill': {
                if (!args.ref) return { success: false, error: 'ref is required for fill' };
                if (!args.text) return { success: false, error: 'text is required for fill' };
                await controller.ensureBrowserAvailable();
                await controller.actOnTab({ kind: 'fill', ref: args.ref, text: args.text });
                return { success: true, result: `Filled ${args.ref} with "${args.text}"` };
            }

            case 'press': {
                if (!args.key) return { success: false, error: 'key is required for press (e.g. "Enter")' };
                await controller.ensureBrowserAvailable();
                await controller.actOnTab({ kind: 'press', key: args.key, ref: args.ref });
                return { success: true, result: `Pressed ${args.key}` };
            }

            case 'navigate': {
                if (!args.url) return { success: false, error: 'url is required for navigate' };
                await controller.ensureBrowserAvailable();
                await controller.navigateTab(args.url);
                await new Promise(r => setTimeout(r, 2500));

                const snap = await controller.snapshotTab({
                    format: 'role',
                    compact: true,
                });

                if (snap.ok) {
                    return { success: true, result: `Navigated to ${args.url}\n\n${formatSnapshotForLLM(snap, args.url)}` };
                }
                return { success: true, result: `Navigated to ${args.url}` };
            }

            case 'screenshot': {
                await controller.ensureBrowserAvailable();
                const result = await controller.screenshotTab({
                    fullPage: args.fullPage,
                    ref: args.ref,
                });

                if (result.base64) {
                    return {
                        success: true,
                        result: 'Screenshot captured.',
                        image_data: result.base64,
                        content_type: result.contentType || 'image/png'
                    };
                }
                return { success: true, result: 'Screenshot captured (no image data returned)' };
            }

            case 'console': {
                await controller.ensureBrowserAvailable();
                const logs = await controller.getConsoleLog();
                if (!logs.console?.length && !logs.errors?.length) {
                    return { success: true, result: 'No console output.' };
                }
                let text = '';
                if (logs.errors?.length) {
                    text += `Errors (${logs.errors.length}):\n${logs.errors.slice(-10).map(e => e.message || e).join('\n')}\n\n`;
                }
                if (logs.console?.length) {
                    text += `Console (${logs.console.length}):\n${logs.console.slice(-20).map(c => c.message || c).join('\n')}`;
                }
                return { success: true, result: text.trim() };
            }

            case 'status': {
                const status = await controller.getStatus();
                return {
                    success: true,
                    result: `Browser: ${status.running ? 'running' : 'stopped'}, ` +
                            `Attached: ${status.attached ? 'yes' : 'no'}, ` +
                            `URL: ${status.url || 'none'}, ` +
                            `Driver: ${status.driver}`
                };
            }

            case 'stop': {
                await controller.stopBrowser();
                return { success: true, result: 'Browser stopped.' };
            }

            default:
                return {
                    success: false,
                    error: `Unknown action: ${action}. Available: search, open, snapshot, click, type, fill, press, navigate, screenshot, console, status, stop`
                };
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Browser ${action} failed: ${message}` };
    }
}

/**
 * Format a snapshot result into concise text for the LLM.
 */
function formatSnapshotForLLM(snap, context) {
    const lines = [];

    if (context) {
        lines.push(`Page: ${context}`);
    }

    if (snap.stats) {
        lines.push(`Elements: ${snap.stats.interactive || 0} interactive, ${snap.stats.lines || 0} lines`);
    }

    // Page text FIRST — this is the readable content the model should use for answers
    // (scores, weather, prices, tables, etc. that may not appear in the element tree)
    if (snap.pageText) {
        const trimmed = snap.pageText.trim();
        if (trimmed.length > 20) {
            lines.push('\n--- Page Content (answer questions using this) ---');
            lines.push(trimmed.substring(0, 3000));
        }
    }

    // Element tree for interaction (click, type, etc.)
    lines.push('\n--- Interactive Elements ---');
    const snapshotText = snap.snapshot || '';
    const maxChars = 8000;
    if (snapshotText.length > maxChars) {
        lines.push(snapshotText.slice(0, maxChars));
        lines.push('\n...(element tree truncated)...');
    } else {
        lines.push(snapshotText);
    }

    if (snap.refs && Object.keys(snap.refs).length > 0) {
        lines.push('\nTo interact with elements, use their ref (e.g. click e1, type into e3)');
    }

    return lines.join('\n');
}

/**
 * Dismiss Google consent dialog if present.
 */
async function _dismissGoogleConsent() {
    try {
        const snap = await controller.snapshotTab({
            format: 'role',
            interactive: true,
            compact: true,
        });

        if (!snap.ok || !snap.snapshot) return;

        const text = snap.snapshot;
        if (!text.includes('Before you continue') && !text.includes('consent')) return;

        console.log('[BrowserControl] Google consent dialog detected, dismissing...');

        const lines = text.split('\n');
        let rejectRef = null;
        let acceptRef = null;

        for (const line of lines) {
            const lower = line.toLowerCase();
            if (lower.includes('reject all')) {
                const match = line.match(/\[ref=(e\d+)\]/);
                if (match) rejectRef = match[1];
            }
            if (lower.includes('accept all')) {
                const match = line.match(/\[ref=(e\d+)\]/);
                if (match) acceptRef = match[1];
            }
        }

        const clickRef = rejectRef || acceptRef;
        if (clickRef) {
            await controller.actOnTab({ kind: 'click', ref: clickRef });
            await new Promise(r => setTimeout(r, 2000));
            console.log('[BrowserControl] Consent dismissed via ref click');
        }
    } catch (err) {
        console.log('[BrowserControl] Consent dismiss failed (non-fatal):', err.message);
    }
}

module.exports = { browserControl };
