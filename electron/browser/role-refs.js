/**
 * Role reference system for agent-browser interaction.
 * Generates e1, e2, ... refs from accessibility snapshots and resolves them
 * back to Playwright locators for action execution.
 */

const { ensurePageState, restoreRoleRefsForTarget } = require('./pw-session');

// Interactive ARIA roles that get assigned refs
const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio',
    'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'searchbox', 'slider',
    'spinbutton', 'switch', 'tab', 'treeitem'
]);

const CONTENT_ROLES = new Set([
    'heading', 'cell', 'gridcell', 'columnheader', 'rowheader',
    'listitem', 'article', 'region', 'main', 'navigation'
]);

const STRUCTURAL_ROLES = new Set([
    'generic', 'group', 'list', 'table', 'row', 'rowgroup',
    'grid', 'treegrid', 'menu', 'menubar', 'toolbar', 'tablist',
    'tree', 'directory', 'document', 'application', 'presentation', 'none'
]);

/**
 * Build a role snapshot from Playwright's ariaSnapshot() output.
 * Parses each line, assigns e1/e2/... refs to interactive elements.
 *
 * @param {string} ariaSnapshot - Text output from locator.ariaSnapshot()
 * @param {Object} [options]
 * @param {boolean} [options.interactive] - Only include interactive elements (flat list)
 * @param {number} [options.maxDepth] - Max tree depth
 * @param {boolean} [options.compact] - Remove unnamed structural elements
 * @returns {{snapshot: string, refs: Object}}
 */
function buildRoleSnapshotFromAriaSnapshot(ariaSnapshot, options = {}) {
    const lines = ariaSnapshot.split('\n');
    const refs = {};
    const tracker = createRoleNameTracker();
    let counter = 0;
    const nextRef = () => `e${++counter}`;

    if (options.interactive) {
        // Flat list of interactive elements only
        const result = [];
        for (const line of lines) {
            const depth = getIndentLevel(line);
            if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

            const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
            if (!match) continue;
            const [, , roleRaw, name, suffix] = match;
            if (roleRaw.startsWith('/')) continue;

            const role = roleRaw.toLowerCase();
            if (!INTERACTIVE_ROLES.has(role)) continue;

            const ref = nextRef();
            const nth = tracker.getNextIndex(role, name);
            tracker.trackRef(role, name, ref);
            refs[ref] = { role, name, nth };

            let enhanced = `- ${roleRaw}`;
            if (name) enhanced += ` "${name}"`;
            enhanced += ` [ref=${ref}]`;
            if (nth > 0) enhanced += ` [nth=${nth}]`;
            if (suffix.includes('[')) enhanced += suffix;
            result.push(enhanced);
        }

        removeNthFromNonDuplicates(refs, tracker);
        return { snapshot: result.join('\n') || '(no interactive elements)', refs };
    }

    // Full tree with refs on interactive + named content elements
    const result = [];
    for (const line of lines) {
        const processed = processLine(line, refs, options, tracker, nextRef);
        if (processed !== null) result.push(processed);
    }

    removeNthFromNonDuplicates(refs, tracker);
    const tree = result.join('\n') || '(empty)';
    return {
        snapshot: options.compact ? compactTree(tree) : tree,
        refs
    };
}

/**
 * Resolve a ref string (e.g. "e1", "@e1", "ref=e1") to a Playwright locator.
 * @param {import('playwright-core').Page} page
 * @param {string} ref
 * @returns {import('playwright-core').Locator}
 */
function refLocator(page, ref) {
    const normalized = ref.startsWith('@') ? ref.slice(1)
        : ref.startsWith('ref=') ? ref.slice(4)
        : ref;

    if (/^e\d+$/.test(normalized)) {
        const state = ensurePageState(page);

        // Mode "aria": use Playwright's built-in aria-ref
        if (state?.roleRefsMode === 'aria') {
            const scope = state.roleRefsFrameSelector
                ? page.frameLocator(state.roleRefsFrameSelector)
                : page;
            return scope.locator(`aria-ref=${normalized}`);
        }

        // Mode "role": use getByRole with cached role+name
        const info = state?.roleRefs?.[normalized];
        if (!info) {
            throw new Error(`Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`);
        }

        const scope = state?.roleRefsFrameSelector
            ? page.frameLocator(state.roleRefsFrameSelector)
            : page;

        const locator = info.name
            ? scope.getByRole(info.role, { name: info.name, exact: true })
            : scope.getByRole(info.role);

        return info.nth !== undefined ? locator.nth(info.nth) : locator;
    }

    // Fallback: raw aria-ref
    return page.locator(`aria-ref=${normalized}`);
}

/**
 * Get snapshot stats.
 * @param {string} snapshot
 * @param {Object} refs
 * @returns {{lines: number, chars: number, refs: number, interactive: number}}
 */
function getRoleSnapshotStats(snapshot, refs) {
    const interactive = Object.values(refs).filter(r => INTERACTIVE_ROLES.has(r.role)).length;
    return {
        lines: snapshot.split('\n').length,
        chars: snapshot.length,
        refs: Object.keys(refs).length,
        interactive
    };
}

// --- Internal helpers ---

function getIndentLevel(line) {
    const match = line.match(/^(\s*)/);
    return match ? Math.floor(match[1].length / 2) : 0;
}

function createRoleNameTracker() {
    const counts = new Map();
    const refsByKey = new Map();
    return {
        getKey(role, name) { return `${role}:${name ?? ''}`; },
        getNextIndex(role, name) {
            const key = this.getKey(role, name);
            const current = counts.get(key) || 0;
            counts.set(key, current + 1);
            return current;
        },
        trackRef(role, name, ref) {
            const key = this.getKey(role, name);
            const list = refsByKey.get(key) || [];
            list.push(ref);
            refsByKey.set(key, list);
        },
        getDuplicateKeys() {
            const out = new Set();
            for (const [key, refList] of refsByKey) {
                if (refList.length > 1) out.add(key);
            }
            return out;
        }
    };
}

function removeNthFromNonDuplicates(refs, tracker) {
    const duplicates = tracker.getDuplicateKeys();
    for (const [ref, data] of Object.entries(refs)) {
        const key = tracker.getKey(data.role, data.name);
        if (!duplicates.has(key)) delete refs[ref].nth;
    }
}

function processLine(line, refs, options, tracker, nextRef) {
    const depth = getIndentLevel(line);
    if (options.maxDepth !== undefined && depth > options.maxDepth) return null;

    const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
    if (!match) return options.interactive ? null : line;

    const [, prefix, roleRaw, name, suffix] = match;
    if (roleRaw.startsWith('/')) return options.interactive ? null : line;

    const role = roleRaw.toLowerCase();
    const isInteractive = INTERACTIVE_ROLES.has(role);
    const isContent = CONTENT_ROLES.has(role);
    const isStructural = STRUCTURAL_ROLES.has(role);

    if (options.interactive && !isInteractive) return null;
    if (options.compact && isStructural && !name) return null;

    const shouldHaveRef = isInteractive || (isContent && name);
    if (!shouldHaveRef) return line;

    const ref = nextRef();
    const nth = tracker.getNextIndex(role, name);
    tracker.trackRef(role, name, ref);
    refs[ref] = { role, name, nth };

    let enhanced = `${prefix}${roleRaw}`;
    if (name) enhanced += ` "${name}"`;
    enhanced += ` [ref=${ref}]`;
    if (nth > 0) enhanced += ` [nth=${nth}]`;
    if (suffix) enhanced += suffix;
    return enhanced;
}

function compactTree(tree) {
    const lines = tree.split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('[ref=')) { result.push(line); continue; }
        if (line.includes(':') && !line.trimEnd().endsWith(':')) { result.push(line); continue; }

        const currentIndent = getIndentLevel(line);
        let hasRelevantChildren = false;
        for (let j = i + 1; j < lines.length; j++) {
            if (getIndentLevel(lines[j]) <= currentIndent) break;
            if (lines[j]?.includes('[ref=')) { hasRelevantChildren = true; break; }
        }
        if (hasRelevantChildren) result.push(line);
    }
    return result.join('\n');
}

module.exports = {
    INTERACTIVE_ROLES,
    CONTENT_ROLES,
    STRUCTURAL_ROLES,
    buildRoleSnapshotFromAriaSnapshot,
    refLocator,
    getRoleSnapshotStats
};
