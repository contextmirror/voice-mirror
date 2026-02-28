/**
 * terminal-search.js -- Pure-JS terminal buffer search logic.
 *
 * Searches through terminal text lines using string or regex matching.
 * Returns match positions (row, startCol, endCol) for highlighting.
 */

/**
 * Search through a terminal buffer.
 * @param {(y: number) => string|null} getLine - Returns text for line y
 * @param {number} lineCount - Total number of lines
 * @param {string} query - Search string or regex pattern
 * @param {{ caseSensitive?: boolean, regex?: boolean }} options
 * @returns {{ matches: Array<{row: number, startCol: number, endCol: number}>, total: number }}
 */
export function searchBuffer(getLine, lineCount, query, options = {}) {
  if (!query) return { matches: [], total: 0 };

  const { caseSensitive = false, regex = false } = options;
  const matches = [];

  let pattern;
  if (regex) {
    try {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch {
      return { matches: [], total: 0 };
    }
  }

  for (let y = 0; y < lineCount; y++) {
    const line = getLine(y);
    if (line == null) continue;

    if (regex) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        matches.push({ row: y, startCol: m.index, endCol: m.index + m[0].length });
        if (m[0].length === 0) pattern.lastIndex++; // prevent infinite loop
      }
    } else {
      const haystack = caseSensitive ? line : line.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      let idx = 0;
      while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        matches.push({ row: y, startCol: idx, endCol: idx + needle.length });
        idx += needle.length || 1;
      }
    }
  }

  return { matches, total: matches.length };
}

/**
 * Get the next match index (wraps around).
 * @param {number} total
 * @param {number} current
 * @returns {number}
 */
export function nextMatch(total, current) {
  if (total === 0) return 0;
  return (current + 1) % total;
}

/**
 * Get the previous match index (wraps around).
 * @param {number} total
 * @param {number} current
 * @returns {number}
 */
export function prevMatch(total, current) {
  if (total === 0) return 0;
  return (current - 1 + total) % total;
}

/**
 * Find the match index nearest to (or at/after) the cursor position.
 * @param {Array<{row: number, startCol: number}>} matches
 * @param {number} cursorRow
 * @param {number} cursorCol
 * @returns {number}
 */
export function getMatchIndex(matches, cursorRow, cursorCol) {
  if (matches.length === 0) return 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.row > cursorRow || (m.row === cursorRow && m.startCol >= cursorCol)) {
      return i;
    }
  }
  return 0; // wrap to first
}
