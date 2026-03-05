/**
 * hover-markdown.js -- Lightweight markdown renderer for LSP hover tooltips.
 *
 * Uses highlight.js for syntax-highlighted code blocks inside hover tooltips.
 * Separate from the chat markdown.js renderer (no collapsible blocks, no GFM breaks).
 *
 * @module hover-markdown
 */

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';

// Register only the languages we support in the editor
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import rust from 'highlight.js/lib/languages/rust';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('css', css);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);

const hoverMarked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
  {
    gfm: true,
    async: false,
  }
);

/**
 * Render markdown text to HTML for hover tooltips.
 * @param {string} text - Raw markdown from LSP hover response
 * @returns {string} Sanitized HTML with syntax-highlighted code blocks
 */
export function renderHoverMarkdown(text) {
  if (!text) return '';
  const raw = /** @type {string} */ (hoverMarked.parse(text));
  return DOMPurify.sanitize(raw);
}
