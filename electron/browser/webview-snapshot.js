/**
 * Page snapshot system using webview CDP.
 * Two formats: ARIA (accessibility tree) and Role (e1/e2 refs).
 * AI snapshot removed (was Playwright-internal API).
 */

const cdp = require('./webview-cdp');
const { buildRoleSnapshotFromAriaSnapshot, getRoleSnapshotStats } = require('./role-refs');
const { storeRefs } = require('./webview-actions');

/**
 * Take a snapshot of the page in the specified format.
 * @param {Object} opts
 * @param {'aria'|'role'} [opts.format='role']
 * @param {boolean} [opts.interactive] - Only interactive elements (role format)
 * @param {boolean} [opts.compact] - Remove unnamed structural elements (role format)
 * @param {number} [opts.maxDepth] - Max tree depth (role format)
 * @param {number} [opts.limit] - Max nodes (aria format)
 * @returns {Promise<Object>}
 */
async function takeSnapshot(opts = {}) {
    const format = opts.format || 'role';

    switch (format) {
        case 'aria':
            return await takeAriaSnapshot(opts);
        case 'ai':
            // AI snapshot was Playwright-internal, fall back to role
            console.log('[webview-snapshot] AI format not available, using role format');
            return await takeRoleSnapshot(opts);
        case 'role':
        default:
            return await takeRoleSnapshot(opts);
    }
}

/**
 * ARIA snapshot: accessibility tree via CDP.
 */
async function takeAriaSnapshot(opts = {}) {
    const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 500)));

    const nodes = await cdp.getAccessibilityTree();
    const formatted = formatAriaSnapshot(nodes, limit);

    return {
        ok: true,
        format: 'aria',
        nodes: formatted,
        stats: { nodeCount: formatted.length }
    };
}

/**
 * Role snapshot: builds e1/e2/... refs from the accessibility tree.
 * Uses CDP Accessibility.getFullAXTree + the existing role-refs parser.
 */
async function takeRoleSnapshot(opts = {}) {
    let ariaText = '(empty page)';
    let axTreeWorked = false;

    try {
        const nodes = await cdp.getAccessibilityTree();
        if (nodes.length > 0) {
            ariaText = formatAxTreeToAriaText(nodes);
            const lineCount = ariaText.split('\n').filter(l => l.trim().startsWith('- ')).length;
            axTreeWorked = lineCount > 3;
            if (!axTreeWorked) {
                console.log(`[webview-snapshot] AX tree returned only ${lineCount} lines, falling back to DOM`);
            }
        }
    } catch (err) {
        console.log('[webview-snapshot] AX tree failed:', err.message);
    }

    // If AX tree didn't produce useful results, use DOM-based extraction
    if (!axTreeWorked) {
        ariaText = await takeDomSnapshot();
    }

    // Build role snapshot with refs using existing parser
    const options = {
        interactive: opts.interactive,
        compact: opts.compact,
        maxDepth: opts.maxDepth
    };
    const built = buildRoleSnapshotFromAriaSnapshot(ariaText, options);

    // Cache refs for action resolution
    storeRefs(built.refs, 'role');

    const stats = getRoleSnapshotStats(built.snapshot, built.refs);

    // Extract visible page text to supplement the tree (captures scores, data, etc.)
    let pageText = '';
    try {
        pageText = await getPageText();
    } catch (err) {
        console.log('[webview-snapshot] Page text extraction failed:', err.message);
    }

    return {
        ok: true,
        format: 'role',
        snapshot: built.snapshot,
        pageText,
        refs: built.refs,
        stats
    };
}

/**
 * DOM-based snapshot fallback.
 * Walks the DOM via Runtime.evaluate and produces Playwright ariaSnapshot-style text.
 * Used when Accessibility.getFullAXTree returns insufficient data.
 */
async function takeDomSnapshot() {
    // First, clear any previous ref markers
    await cdp.evaluate(`(function() {
        var old = document.querySelectorAll('[data-vmref]');
        for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-vmref');
    })()`);

    const { result } = await cdp.evaluate(`(function() {
    var lines = [];
    var count = 0;
    var MAX = 1200;
    var refCounter = 0;

    var roleMap = {
        'a': 'link', 'button': 'button', 'input': 'textbox',
        'textarea': 'textbox', 'select': 'combobox', 'img': 'img',
        'h1': 'heading', 'h2': 'heading', 'h3': 'heading',
        'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
        'nav': 'navigation', 'main': 'main', 'aside': 'complementary',
        'footer': 'contentinfo', 'header': 'banner', 'form': 'form',
        'table': 'table', 'tr': 'row', 'th': 'columnheader', 'td': 'cell',
        'ul': 'list', 'ol': 'list', 'li': 'listitem',
        'summary': 'button', 'dialog': 'dialog',
        'section': 'region', 'article': 'article'
    };

    function getRole(el) {
        var explicit = el.getAttribute && el.getAttribute('role');
        if (explicit) return explicit;
        var tag = (el.tagName || '').toLowerCase();
        var r = roleMap[tag] || '';
        if (tag === 'input') {
            var type = (el.type || 'text').toLowerCase();
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'submit' || type === 'button') return 'button';
            if (type === 'search') return 'searchbox';
            return 'textbox';
        }
        return r;
    }

    function getName(el) {
        if (!el.getAttribute) return '';
        return el.getAttribute('aria-label')
            || el.getAttribute('alt')
            || el.getAttribute('title')
            || el.getAttribute('placeholder')
            || '';
    }

    function directText(el) {
        var t = '';
        for (var i = 0; i < el.childNodes.length; i++) {
            if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent;
        }
        return t.trim().substring(0, 200);
    }

    function fullText(el) {
        var t = (el.textContent || '').trim();
        return t.substring(0, 300);
    }

    function isVisible(el) {
        if (!el.getBoundingClientRect) return true;
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        var s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
    }

    function walk(el, depth) {
        if (count >= MAX || !el || !el.tagName) return;
        var tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || tag === 'link' || tag === 'meta') return;
        if (!isVisible(el)) return;

        var role = getRole(el);
        var name = getName(el);
        var dt = directText(el);
        var indent = '';
        for (var i = 0; i < Math.min(depth, 10); i++) indent += '  ';

        var ch = el.children;
        var hasKids = false;
        for (var j = 0; j < ch.length; j++) {
            var ct = (ch[j].tagName || '').toLowerCase();
            if (ct && ct !== 'script' && ct !== 'style') { hasKids = true; break; }
        }

        if (role) {
            count++;
            refCounter++;
            el.setAttribute('data-vmref', 'vm' + refCounter);
            var line = indent + '- ' + role;
            var label = name || (hasKids ? dt : fullText(el));
            if (label) line += ' "' + label.replace(/"/g, "'").substring(0, 200) + '"';
            if (role === 'heading') {
                var lvl = tag.charAt(1);
                if (lvl) line += ' [level=' + lvl + ']';
            }
            if (el.value && (role === 'textbox' || role === 'searchbox' || role === 'combobox')) {
                line += ' [value="' + el.value.substring(0, 50) + '"]';
            }
            line += ' [vmref=vm' + refCounter + ']';
            if (hasKids) line += ':';
            lines.push(line);
        } else if (!hasKids) {
            var ft = fullText(el);
            if (ft && ft.length > 1) {
                count++;
                lines.push(indent + '- text "' + ft.replace(/"/g, "'").substring(0, 300) + '"');
            }
        }

        var cdepth = role ? depth + 1 : depth;
        for (var k = 0; k < ch.length; k++) walk(ch[k], cdepth);
    }

    walk(document.body, 0);
    return lines.join('\\n');
})()`);

    return result?.value || '(empty page)';
}

/**
 * Extract visible page text content (innerText).
 * Supplements the role tree snapshot with readable text that may not
 * appear in the structured tree (scores, stats, dates, etc.).
 * @returns {Promise<string>}
 */
async function getPageText() {
    const { result } = await cdp.evaluate(`(function() {
        try {
            var text = document.body.innerText || '';
            return text.substring(0, 4000);
        } catch(e) {
            return '(page text error: ' + e.message + ')';
        }
    })()`);
    const raw = result?.value || '';
    // Collapse excessive whitespace and merge short lines (scores like "3\n-\n2" → "3 - 2")
    let text = raw
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
    // Apply short-line merge twice to handle consecutive short lines (e.g. "3\n-\n2")
    for (let i = 0; i < 3; i++) {
        text = text.replace(/\n([^\n]{1,3})\n/g, ' $1 ');
    }
    // Clean up Google animated digit roller garbage (stock tickers, counters)
    // Pattern: sequences of single digits separated by spaces like "9 8 7 6 5 4 3 2 1 0"
    text = text.replace(/(?:\d ?){10,}/g, (match) => {
        const stripped = match.replace(/ /g, '');
        // Digit roller: countdown/countup patterns
        if (/9876543210|0123456789/.test(stripped)) return '';
        // Long concatenated single-digit chart data (e.g. "12124432332344433334...")
        // Real numbers like phone/ID have structure; chart data is random-looking digits
        if (stripped.length > 15) return ''; // Too long to be a real number
        // Short-ish sequences (10-15 digits) — keep as real numbers (phone, zip, etc.)
        return stripped;
    });
    // Clean up concatenated time strings (e.g. "02:0005:0008:0011:00")
    text = text.replace(/(\d{2}:\d{2})(\d{2}:\d{2})/g, '$1 $2');
    // Second pass for remaining concatenated times
    text = text.replace(/(\d{2}:\d{2})(\d{2}:\d{2})/g, '$1 $2');
    // Remove repeated time labels (weather charts repeat "02:00 05:00 08:00..." many times)
    // Keep only the first occurrence of a time sequence
    text = text.replace(/((?:\d{2}:\d{2}\s*){4,})(?:[\s\S]*?\1)+/g, '$1');
    // Remove long runs of small numbers from chart/graph data (e.g. "1 2 1 2 4 4 3 2 3 3")
    text = text.replace(/(?:\b\d{1,2}\b[ ,]+){8,}/g, '');
    return text
        .replace(/  +/g, ' ')
        .replace(/\n /g, '\n')
        .trim();
}

/**
 * Format raw CDP AX tree nodes into flat reference list.
 * Reused from the old cdp-client.js.
 * @param {Array} nodes
 * @param {number} limit
 * @returns {Array}
 */
function formatAriaSnapshot(nodes, limit) {
    const byId = new Map();
    for (const n of nodes) {
        if (n.nodeId) byId.set(n.nodeId, n);
    }

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

/**
 * Convert CDP Accessibility tree to a text format compatible with
 * buildRoleSnapshotFromAriaSnapshot() — mimics Playwright's ariaSnapshot() output.
 *
 * Playwright format:
 *   - heading "Page Title" [level=1]
 *   - navigation "Main":
 *     - link "Home"
 *     - link "About"
 *   - textbox "Search"
 *   - button "Submit"
 *
 * @param {Array} nodes - Raw CDP accessibility nodes
 * @returns {string}
 */
function formatAxTreeToAriaText(nodes) {
    if (!nodes.length) return '(empty page)';

    const byId = new Map();
    for (const n of nodes) {
        if (n.nodeId) byId.set(n.nodeId, n);
    }

    // Find root
    const referenced = new Set();
    for (const n of nodes) {
        for (const c of (n.childIds || [])) referenced.add(c);
    }
    const root = nodes.find(n => n.nodeId && !referenced.has(n.nodeId)) || nodes[0];
    if (!root?.nodeId) return '(empty page)';

    const lines = [];
    const maxNodes = 1000;

    function walk(nodeId, depth) {
        if (lines.length >= maxNodes) return;
        const n = byId.get(nodeId);
        if (!n) return;

        const role = axValue(n.role);
        const name = axValue(n.name);

        // Skip invisible/ignored nodes
        if (role === 'none' || role === 'presentation') return;
        if (n.ignored) return;

        // Build indent
        const indent = '  '.repeat(depth);
        const children = (n.childIds || []).filter(c => byId.has(c));
        const hasChildren = children.length > 0;

        // Skip generic/group containers without names (flatten them)
        const skipNode = (role === 'generic' || role === 'group' || role === 'WebArea' || role === 'RootWebArea')
            && !name;

        if (!skipNode && role) {
            let line = `${indent}- ${role}`;
            if (name) line += ` "${name}"`;

            // Add level for headings
            if (role === 'heading' && n.properties) {
                const levelProp = n.properties.find(p => p.name === 'level');
                if (levelProp?.value?.value !== undefined) {
                    line += ` [level=${levelProp.value.value}]`;
                }
            }

            // Add value for inputs
            const value = axValue(n.value);
            if (value && role !== 'heading') {
                line += ` [value="${value}"]`;
            }

            // Add checked state for checkboxes/radios
            if (n.properties) {
                const checked = n.properties.find(p => p.name === 'checked');
                if (checked?.value?.value !== undefined) {
                    line += ` [checked=${checked.value.value}]`;
                }
            }

            if (hasChildren) line += ':';
            lines.push(line);
        }

        // Walk children at appropriate depth
        const childDepth = skipNode ? depth : depth + 1;
        for (const childId of children) {
            walk(childId, childDepth);
        }
    }

    walk(root.nodeId, 0);

    return lines.join('\n') || '(empty page)';
}

function axValue(v) {
    if (!v || typeof v !== 'object') return '';
    const val = v.value;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return '';
}

module.exports = {
    takeSnapshot,
    takeAriaSnapshot,
    takeRoleSnapshot,
    takeDomSnapshot,
    getPageText,
    formatAriaSnapshot,
    formatAxTreeToAriaText
};
