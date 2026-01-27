/**
 * Browser control tool handler for local LLMs.
 *
 * Provides a unified "browser_control" tool that local models can use to:
 * - Launch a visible Chrome browser
 * - Open URLs, navigate, search the web
 * - Take snapshots of page content (accessibility tree)
 * - Click, type, and interact with page elements
 * - Take screenshots
 * - Read console logs
 *
 * This calls the browser-controller module directly (runs in Electron process).
 */

const controller = require('../../browser/browser-controller');

/**
 * Execute a browser control action.
 *
 * @param {Object} args
 * @param {string} args.action - Action to perform (see below)
 * @param {string} [args.url] - URL for open/navigate
 * @param {string} [args.query] - Search query (shortcut for open+google)
 * @param {string} [args.targetId] - Tab target ID
 * @param {string} [args.ref] - Element ref from snapshot (e1, e2, ...)
 * @param {string} [args.text] - Text to type/fill
 * @param {string} [args.key] - Key to press (Enter, Tab, etc.)
 * @param {string} [args.expression] - JS expression for evaluate
 * @param {string} [args.selector] - CSS selector for scoped snapshot
 * @param {boolean} [args.interactive] - Only interactive elements in snapshot
 * @param {string} [args.profile] - Browser profile name
 * @returns {Promise<Object>} Result with success flag and result text
 *
 * Actions:
 *   search   - Search Google in the browser (opens Chrome, navigates, returns page text)
 *   open     - Open a URL in a new tab
 *   snapshot - Get page structure with element refs (e1, e2, ...)
 *   click    - Click an element by ref
 *   type     - Type text into an element by ref
 *   fill     - Fill/replace text in an element by ref
 *   press    - Press a key (Enter, Tab, Escape, etc.)
 *   navigate - Navigate current tab to a URL
 *   screenshot - Take a screenshot (returns description, not image)
 *   tabs     - List open tabs
 *   close    - Close a tab
 *   console  - Get console logs/errors
 *   status   - Get browser status
 *   stop     - Stop the browser
 */
async function browserControl(args = {}) {
    const action = (args.action || '').toLowerCase().trim();
    const profile = args.profile;

    if (!action) {
        return { success: false, error: 'action is required. Use: search, open, snapshot, click, type, fill, press, navigate, tabs, close, console, status, stop' };
    }

    try {
        switch (action) {
            case 'search': {
                // High-level: start browser, open Google search, snapshot results
                const query = args.query || args.url || args.text;
                if (!query) return { success: false, error: 'query is required for search' };

                await controller.ensureBrowserAvailable(profile);
                // Use hl=en and consent params to reduce cookie consent dialogs
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
                const tab = await controller.openTab(searchUrl, profile);

                // Wait for page to load
                await new Promise(r => setTimeout(r, 2000));

                // Check for and dismiss Google consent dialog
                await _dismissGoogleConsent(tab.targetId, profile);

                // Take a snapshot to get page content
                const snap = await controller.snapshotTab({
                    targetId: tab.targetId,
                    format: 'role',
                    compact: true,
                }, profile);

                if (!snap.ok) {
                    return { success: false, error: 'Failed to snapshot search results' };
                }

                // Format snapshot for the LLM
                const resultText = formatSnapshotForLLM(snap, query);

                return { success: true, result: resultText };
            }

            case 'open': {
                const url = args.url;
                if (!url) return { success: false, error: 'url is required for open' };

                await controller.ensureBrowserAvailable(profile);
                const tab = await controller.openTab(url, profile);

                // Wait for page to load
                await new Promise(r => setTimeout(r, 2000));

                // Auto-snapshot the opened page
                const snap = await controller.snapshotTab({
                    targetId: tab.targetId,
                    format: 'role',
                    compact: true,
                }, profile);

                if (snap.ok) {
                    const text = formatSnapshotForLLM(snap, url);
                    return { success: true, result: `Opened ${url}\n\n${text}` };
                }

                return { success: true, result: `Opened ${url} (tab: ${tab.targetId})` };
            }

            case 'snapshot': {
                await controller.ensureBrowserAvailable(profile);
                const snap = await controller.snapshotTab({
                    targetId: args.targetId,
                    format: 'role',
                    interactive: args.interactive || false,
                    compact: true,
                    selector: args.selector,
                }, profile);

                if (!snap.ok) {
                    return { success: false, error: 'Failed to take snapshot' };
                }

                const text = formatSnapshotForLLM(snap);
                return { success: true, result: text };
            }

            case 'click': {
                if (!args.ref) return { success: false, error: 'ref is required for click (e.g. "e1")' };
                await controller.ensureBrowserAvailable(profile);
                const result = await controller.actOnTab(
                    { kind: 'click', ref: args.ref },
                    args.targetId, profile
                );
                return { success: true, result: `Clicked ${args.ref}. ${result.message || ''}`.trim() };
            }

            case 'type': {
                if (!args.ref) return { success: false, error: 'ref is required for type' };
                if (!args.text) return { success: false, error: 'text is required for type' };
                await controller.ensureBrowserAvailable(profile);
                await controller.actOnTab(
                    { kind: 'type', ref: args.ref, text: args.text },
                    args.targetId, profile
                );
                return { success: true, result: `Typed "${args.text}" into ${args.ref}` };
            }

            case 'fill': {
                if (!args.ref) return { success: false, error: 'ref is required for fill' };
                if (!args.text) return { success: false, error: 'text is required for fill' };
                await controller.ensureBrowserAvailable(profile);
                await controller.actOnTab(
                    { kind: 'fill', ref: args.ref, text: args.text },
                    args.targetId, profile
                );
                return { success: true, result: `Filled ${args.ref} with "${args.text}"` };
            }

            case 'press': {
                if (!args.key) return { success: false, error: 'key is required for press (e.g. "Enter")' };
                await controller.ensureBrowserAvailable(profile);
                await controller.actOnTab(
                    { kind: 'press', key: args.key, ref: args.ref },
                    args.targetId, profile
                );
                return { success: true, result: `Pressed ${args.key}` };
            }

            case 'navigate': {
                if (!args.url) return { success: false, error: 'url is required for navigate' };
                await controller.ensureBrowserAvailable(profile);
                await controller.navigateTab(args.url, args.targetId, profile);

                // Wait and auto-snapshot
                await new Promise(r => setTimeout(r, 2000));
                const snap = await controller.snapshotTab({
                    targetId: args.targetId,
                    format: 'role',
                    compact: true,
                }, profile);

                if (snap.ok) {
                    const text = formatSnapshotForLLM(snap, args.url);
                    return { success: true, result: `Navigated to ${args.url}\n\n${text}` };
                }
                return { success: true, result: `Navigated to ${args.url}` };
            }

            case 'screenshot': {
                await controller.ensureBrowserAvailable(profile);
                const result = await controller.screenshotTab({
                    targetId: args.targetId,
                    fullPage: args.fullPage,
                    ref: args.ref,
                }, profile);

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

            case 'tabs': {
                await controller.ensureBrowserAvailable(profile);
                const tabs = await controller.listTabs(profile);
                if (tabs.length === 0) {
                    return { success: true, result: 'No tabs open.' };
                }
                const list = tabs.map((t, i) =>
                    `${i + 1}. [${t.targetId}] ${t.title || '(no title)'} - ${t.url || ''}`
                ).join('\n');
                return { success: true, result: `Open tabs:\n${list}` };
            }

            case 'close': {
                if (!args.targetId) return { success: false, error: 'targetId is required for close' };
                await controller.closeTab(args.targetId, profile);
                return { success: true, result: `Closed tab ${args.targetId}` };
            }

            case 'console': {
                await controller.ensureBrowserAvailable(profile);
                const logs = await controller.getConsoleLog(args.targetId, profile);
                if (!logs.console?.length && !logs.errors?.length) {
                    return { success: true, result: 'No console output.' };
                }
                let text = '';
                if (logs.errors?.length) {
                    text += `Errors (${logs.errors.length}):\n${logs.errors.slice(-10).join('\n')}\n\n`;
                }
                if (logs.console?.length) {
                    text += `Console (${logs.console.length}):\n${logs.console.slice(-20).join('\n')}`;
                }
                return { success: true, result: text.trim() };
            }

            case 'status': {
                const status = await controller.getStatus(profile);
                return {
                    success: true,
                    result: `Browser: ${status.running ? 'running' : 'stopped'}, ` +
                            `CDP: ${status.cdpReady ? 'ready' : 'not ready'}, ` +
                            `Tabs: ${status.tabCount}, ` +
                            `Driver: ${status.driver}`
                };
            }

            case 'stop': {
                await controller.stopBrowser(profile);
                return { success: true, result: 'Browser stopped.' };
            }

            default:
                return {
                    success: false,
                    error: `Unknown action: ${action}. Available: search, open, snapshot, click, type, fill, press, navigate, screenshot, tabs, close, console, status, stop`
                };
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Browser ${action} failed: ${message}` };
    }
}

/**
 * Format a snapshot result into concise text for the LLM.
 * Truncates to fit local model context windows.
 */
function formatSnapshotForLLM(snap, context) {
    const lines = [];

    if (context) {
        lines.push(`Page: ${context}`);
    }

    if (snap.stats) {
        lines.push(`Elements: ${snap.stats.refs || 0} interactive, ${snap.stats.lines || 0} lines`);
    }

    lines.push('');

    // Include the snapshot tree (truncated)
    const snapshotText = snap.snapshot || '';
    const maxChars = 6000; // Leave room for other context
    if (snapshotText.length > maxChars) {
        lines.push(snapshotText.slice(0, maxChars));
        lines.push('\n...(page content truncated)...');
    } else {
        lines.push(snapshotText);
    }

    // Add ref usage hint
    if (snap.refs && Object.keys(snap.refs).length > 0) {
        lines.push('\nTo interact with elements, use their ref (e.g. click e1, type into e3)');
    }

    return lines.join('\n');
}

/**
 * Dismiss Google's "Before you continue" cookie consent dialog if present.
 * Tries to click "Reject all" or "Accept all" button via snapshot refs.
 * Falls back to JS injection if refs don't work.
 */
async function _dismissGoogleConsent(targetId, profile) {
    try {
        const snap = await controller.snapshotTab({
            targetId,
            format: 'role',
            interactive: true,
            compact: true,
        }, profile);

        if (!snap.ok || !snap.snapshot) return;

        const text = snap.snapshot;
        // Check if consent dialog is present
        if (!text.includes('Before you continue') && !text.includes('consent')) return;

        console.log('[BrowserControl] Google consent dialog detected, dismissing...');

        // Look for "Reject all" or "Accept all" button refs
        // The snapshot text contains lines like: [ref=e5] button "Reject all"
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
            await controller.actOnTab(
                { kind: 'click', ref: clickRef },
                targetId, profile
            );
            // Wait for consent to clear and page to reload
            await new Promise(r => setTimeout(r, 2000));
            console.log('[BrowserControl] Consent dismissed via ref click');
        } else {
            console.log('[BrowserControl] No consent button ref found, skipping');
        }
    } catch (err) {
        console.log('[BrowserControl] Consent dismiss failed (non-fatal):', err.message);
    }
}

module.exports = { browserControl };
