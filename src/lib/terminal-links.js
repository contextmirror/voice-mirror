/**
 * terminal-links.js -- Pure-JS terminal link detection.
 *
 * Detects URLs and file paths with line:col in terminal output text.
 */

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
// Trailing punctuation to strip from URLs — note: ')' is NOT here,
// it's handled separately by the balanced-parens logic
const TRAILING_PUNCT = /[.,;:!?]+$/;

/**
 * Detect URLs in a line of terminal text.
 * @param {string} text
 * @returns {Array<{start: number, end: number, url: string}>}
 */
export function detectURLs(text) {
  const matches = [];
  URL_REGEX.lastIndex = 0;
  let m;
  while ((m = URL_REGEX.exec(text)) !== null) {
    let url = m[0];
    let end = m.index + url.length;

    // Strip trailing unmatched closing parentheses
    while (url.endsWith(')')) {
      const openCount = (url.match(/\(/g) || []).length;
      const closeCount = (url.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        url = url.slice(0, -1);
        end--;
      } else {
        break;
      }
    }

    // Strip trailing punctuation (excluding parens, handled above)
    const trailingMatch = url.match(TRAILING_PUNCT);
    if (trailingMatch) {
      url = url.slice(0, -trailingMatch[0].length);
      end -= trailingMatch[0].length;
    }

    matches.push({ start: m.index, end, url });
  }
  return matches;
}

// File extensions we recognize — longer variants MUST come before shorter
// ones (tsx before ts, jsx before js) so regex alternation picks the longest
const EXTENSIONS = '(?:jsx|tsx|mjs|cjs|svelte|html|toml|yaml|graphql|prisma|bash|astro|lock|conf|cpp|hpp|yml|css|json|vue|xml|sql|env|cfg|ini|log|txt|ps1|zsh|js|ts|rs|py|md|go|rb|sh|java|c|h)';

// Pattern: optional prefix (-->) + path with known extension + optional :line:col or (line,col)
const FILE_PATH_REGEX = new RegExp(
  '(?:-->\\s*)?' +
  '(' +
    '(?:[A-Za-z]:\\\\[^\\s:()]*\\\\[^:()]*\\.' + EXTENSIONS + ')' +  // Windows absolute: C:\path\file.ext (allows spaces)
    '|' +
    '(?:\\.{0,2}/[^\\s:()]+)' +               // Unix relative/absolute: ./path, ../path, /path
    '|' +
    '(?:[a-zA-Z_][a-zA-Z0-9_./\\\\-]*\\.' + EXTENSIONS + ')' +  // bare path: src/file.ext
  ')' +
  '(?:' +
    ':(\\d+)(?::(\\d+))?' +                   // :line or :line:col
    '|' +
    '\\((\\d+)(?:,(\\d+))?\\)' +              // (line) or (line,col)
  ')?',
  'g'
);

/**
 * Detect file paths (with optional line:col) in terminal text.
 * @param {string} text
 * @param {string} cwd - Working directory for resolving relative paths
 * @returns {Array<{start: number, end: number, path: string, line?: number, col?: number}>}
 */
export function detectFilePaths(text, cwd) {
  const matches = [];
  FILE_PATH_REGEX.lastIndex = 0;
  let m;
  while ((m = FILE_PATH_REGEX.exec(text)) !== null) {
    let filePath = m[1];
    const line = parseInt(m[2] || m[4], 10) || undefined;
    const col = parseInt(m[3] || m[5], 10) || undefined;

    // Skip if it looks like a URL
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) continue;

    // Resolve relative paths against cwd
    if (!filePath.match(/^[A-Za-z]:\\/) && !filePath.startsWith('/')) {
      filePath = (cwd ? cwd + '/' : '') + filePath.replace(/^\.\//, '');
    } else if (filePath.startsWith('./') || filePath.startsWith('../')) {
      filePath = (cwd ? cwd + '/' : '') + filePath.replace(/^\.\//, '');
    }

    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      path: filePath,
      line,
      col,
    });
  }
  return matches;
}
