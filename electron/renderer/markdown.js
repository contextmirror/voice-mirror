/**
 * markdown.js - Markdown rendering with LRU cache
 * Based on clawdbot's implementation with DOMPurify sanitization
 */

import { escapeHtml } from './utils.js';
import { createLog } from './log.js';
const log = createLog('[Markdown]');
import {
    markdownCache,
    MARKDOWN_CACHE_LIMIT,
    MARKDOWN_CACHE_MAX_CHARS,
    MARKDOWN_CHAR_LIMIT
} from './state.js';

// Allowed HTML tags (security whitelist)
const allowedTags = [
    'a', 'b', 'i', 'em', 'strong', 'code', 'del', 's',
    'p', 'br', 'hr', 'blockquote',
    'ul', 'ol', 'li',
    'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'h1', 'h2', 'h3', 'h4'
];

const allowedAttrs = ['class', 'href', 'rel', 'target', 'title', 'start'];

// URL pattern for auto-linking (matches http/https URLs not already in markdown syntax)
const URL_REGEX = /(?<![(<\[])(https?:\/\/[^\s<>\[\]()]+)/g;

/**
 * Auto-link plain URLs in text
 * Converts "https://example.com" to "<https://example.com>" for GFM autolink
 * Skips URLs already in markdown link syntax or angle brackets
 */
function autoLinkUrls(text) {
    return text.replace(URL_REGEX, '<$1>');
}

/**
 * Initialize markdown renderer
 * Configure DOMPurify and marked options
 */
export function initMarkdown() {
    // Configure DOMPurify hook for link security
    if (typeof DOMPurify !== 'undefined') {
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
            if (!(node instanceof HTMLAnchorElement)) return;
            const href = node.getAttribute('href');
            if (!href) return;
            // Security: open links in new tab with noopener
            node.setAttribute('rel', 'noreferrer noopener');
            node.setAttribute('target', '_blank');
        });
    }

    // Configure marked options
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            gfm: true,       // GitHub Flavored Markdown
            breaks: true,    // Convert \n to <br>
        });
    }
}

/**
 * Get cached markdown result (LRU)
 */
function getCachedMarkdown(key) {
    const cached = markdownCache.get(key);
    if (cached === undefined) return null;
    // Move to end (LRU)
    markdownCache.delete(key);
    markdownCache.set(key, cached);
    return cached;
}

/**
 * Set cached markdown result (with size limits)
 */
function setCachedMarkdown(key, value) {
    if (key.length > MARKDOWN_CACHE_MAX_CHARS) return;
    // Evict oldest if at limit
    if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
        const firstKey = markdownCache.keys().next().value;
        markdownCache.delete(firstKey);
    }
    markdownCache.set(key, value);
}

/**
 * Render markdown to sanitized HTML
 * @param {string} text - Raw markdown text
 * @returns {string} - Sanitized HTML
 */
export function renderMarkdown(text) {
    if (!text) return '';

    // Check cache first
    const cached = getCachedMarkdown(text);
    if (cached !== null) return cached;

    // Truncate very long text
    let processText = text;
    let suffix = '';
    if (text.length > MARKDOWN_CHAR_LIMIT) {
        processText = text.slice(0, MARKDOWN_CHAR_LIMIT);
        suffix = '\n\n*[Content truncated...]*';
    }

    let html;
    try {
        // Auto-link plain URLs before parsing
        const linkedText = autoLinkUrls(processText + suffix);

        // Parse markdown
        if (typeof marked !== 'undefined') {
            html = marked.parse(linkedText);
        } else {
            // Fallback: escape HTML and convert newlines
            html = escapeHtml(processText + suffix).replace(/\n/g, '<br>');
        }

        // Sanitize with DOMPurify
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, {
                ALLOWED_TAGS: allowedTags,
                ALLOWED_ATTR: allowedAttrs
            });
        }
    } catch (err) {
        log.error('Parse error:', err);
        html = escapeHtml(text).replace(/\n/g, '<br>');
    }

    // Cache result
    setCachedMarkdown(text, html);
    return html;
}
