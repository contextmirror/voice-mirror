import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchBuffer,
  nextMatch,
  prevMatch,
  getMatchIndex,
} from '../../src/lib/terminal-search.js';

function mockBuffer(lines) {
  return {
    getLine: (y) => lines[y] || null,
    lineCount: lines.length,
  };
}

describe('terminal-search', () => {
  describe('searchBuffer', () => {
    it('finds a single match', () => {
      const { getLine, lineCount } = mockBuffer(['hello world', 'foo bar']);
      const result = searchBuffer(getLine, lineCount, 'world', {});
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].row, 0);
      assert.equal(result.matches[0].startCol, 6);
      assert.equal(result.matches[0].endCol, 11);
    });

    it('finds multiple matches on same line', () => {
      const { getLine, lineCount } = mockBuffer(['abcabc']);
      const result = searchBuffer(getLine, lineCount, 'abc', {});
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].startCol, 0);
      assert.equal(result.matches[1].startCol, 3);
    });

    it('finds matches across multiple lines', () => {
      const { getLine, lineCount } = mockBuffer(['error here', 'no match', 'error there']);
      const result = searchBuffer(getLine, lineCount, 'error', {});
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].row, 0);
      assert.equal(result.matches[1].row, 2);
    });

    it('returns empty for no matches', () => {
      const { getLine, lineCount } = mockBuffer(['hello world']);
      const result = searchBuffer(getLine, lineCount, 'xyz', {});
      assert.equal(result.matches.length, 0);
      assert.equal(result.total, 0);
    });

    it('returns empty for empty query', () => {
      const { getLine, lineCount } = mockBuffer(['hello world']);
      const result = searchBuffer(getLine, lineCount, '', {});
      assert.equal(result.matches.length, 0);
    });

    it('case-insensitive by default', () => {
      const { getLine, lineCount } = mockBuffer(['Hello WORLD']);
      const result = searchBuffer(getLine, lineCount, 'hello', {});
      assert.equal(result.matches.length, 1);
    });

    it('respects caseSensitive option', () => {
      const { getLine, lineCount } = mockBuffer(['Hello WORLD']);
      const result = searchBuffer(getLine, lineCount, 'hello', { caseSensitive: true });
      assert.equal(result.matches.length, 0);
    });

    it('supports regex search', () => {
      const { getLine, lineCount } = mockBuffer(['error: line 42', 'warning: line 7']);
      const result = searchBuffer(getLine, lineCount, 'line \\d+', { regex: true });
      assert.equal(result.matches.length, 2);
    });

    it('handles invalid regex gracefully', () => {
      const { getLine, lineCount } = mockBuffer(['hello']);
      const result = searchBuffer(getLine, lineCount, '[invalid', { regex: true });
      assert.equal(result.matches.length, 0);
    });

    it('handles null lines', () => {
      const getLine = (y) => (y === 0 ? 'hello' : null);
      const result = searchBuffer(getLine, 3, 'hello', {});
      assert.equal(result.matches.length, 1);
    });

    it('handles unicode/emoji in text', () => {
      const { getLine, lineCount } = mockBuffer(['hello 🌍 world']);
      const result = searchBuffer(getLine, lineCount, 'hello', {});
      assert.equal(result.matches.length, 1);
    });
  });

  describe('nextMatch / prevMatch', () => {
    it('wraps to start from end', () => {
      assert.equal(nextMatch(5, 4), 0);
    });
    it('increments normally', () => {
      assert.equal(nextMatch(5, 2), 3);
    });
    it('wraps to end from start', () => {
      assert.equal(prevMatch(5, 0), 4);
    });
    it('decrements normally', () => {
      assert.equal(prevMatch(5, 3), 2);
    });
    it('returns 0 for single match', () => {
      assert.equal(nextMatch(1, 0), 0);
      assert.equal(prevMatch(1, 0), 0);
    });
  });

  describe('getMatchIndex', () => {
    it('returns nearest match at or after cursor position', () => {
      const matches = [
        { row: 0, startCol: 5 },
        { row: 2, startCol: 10 },
        { row: 5, startCol: 0 },
      ];
      assert.equal(getMatchIndex(matches, 0, 0), 0);
      assert.equal(getMatchIndex(matches, 2, 10), 1);
      assert.equal(getMatchIndex(matches, 3, 0), 2);
    });
    it('returns 0 for empty matches', () => {
      assert.equal(getMatchIndex([], 0, 0), 0);
    });
    it('wraps to first match if cursor is past all matches', () => {
      const matches = [{ row: 0, startCol: 0 }, { row: 1, startCol: 0 }];
      assert.equal(getMatchIndex(matches, 100, 0), 0);
    });
  });
});
