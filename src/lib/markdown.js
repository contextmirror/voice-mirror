/**
 * markdown.js -- Markdown rendering utilities using `marked`.
 *
 * Provides a configured marked instance suitable for chat messages.
 * All output is sanitized with DOMPurify to prevent XSS from untrusted content.
 */

import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';

/** Lines threshold — code blocks longer than this get collapsed. */
const COLLAPSE_LINE_THRESHOLD = 10;

// ── Custom renderer: collapsible code blocks ──
const renderer = new Renderer();
const defaultCode = renderer.code.bind(renderer);

/** @param {import('marked').Tokens.Code} token */
renderer.code = function (token) {
  const { text, lang, escaped } = token;
  const lineCount = (text.match(/\n/g) || []).length + 1;
  const html = defaultCode({ text, lang, escaped });
  if (lineCount <= COLLAPSE_LINE_THRESHOLD) return html;

  const label = lang ? `${lang} — ${lineCount} lines` : `${lineCount} lines`;
  return `<details class="code-collapse"><summary>${label}</summary>${html}</details>`;
};

// Configure marked for safe, chat-friendly rendering
marked.setOptions({
  breaks: true,       // GFM line breaks
  gfm: true,          // GitHub-flavored markdown
  async: false,       // Ensure synchronous parsing
  renderer,
});

/** DOMPurify config — allow collapsible blocks through sanitizer */
const PURIFY_CONFIG = {
  ADD_TAGS: ['details', 'summary'],
  ADD_ATTR: ['open', 'class'],
};

/**
 * Render a markdown string to HTML.
 * @param {string} text - Raw markdown text
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(text) {
  if (!text) return '';
  const raw = /** @type {string} */ (marked.parse(text));
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
