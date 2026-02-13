const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatResults } = require('../../electron/browser/search-utils');

describe('electron/browser/search-utils', () => {
    it('formats search results with numbered entries', () => {
        const results = [
            { title: 'Page One', snippet: 'First result', url: 'https://example.com/1' },
            { title: 'Page Two', snippet: 'Second result', url: 'https://example.com/2' },
        ];
        const out = formatResults('test query', results);

        assert.equal(out.ok, true);
        assert.equal(out.action, 'search');
        assert.ok(out.result.includes('1. Page One'));
        assert.ok(out.result.includes('2. Page Two'));
        assert.ok(out.result.includes('https://example.com/1'));
        assert.ok(out.result.includes('test query'));
    });

    it('includes snippets in the formatted result string', () => {
        const results = [
            { title: 'Title', snippet: 'A helpful snippet', url: 'https://example.com' },
        ];
        const out = formatResults('query', results);
        assert.ok(out.result.includes('A helpful snippet'));
    });

    it('handles results without snippets', () => {
        const results = [
            { title: 'No Snippet', url: 'https://example.com' },
        ];
        const out = formatResults('query', results);
        assert.ok(out.result.includes('1. No Snippet'));
        assert.ok(out.result.includes('https://example.com'));
    });

    it('returns structured results array with title, snippet, url', () => {
        const results = [
            { title: 'T', snippet: 'S', url: 'https://x.com' },
        ];
        const out = formatResults('q', results);
        assert.equal(out.results.length, 1);
        assert.deepStrictEqual(out.results[0], { title: 'T', snippet: 'S', url: 'https://x.com' });
    });

    it('uses custom engine name in the result string', () => {
        const results = [{ title: 'R', url: 'https://x.com' }];
        const out = formatResults('q', results, 'DuckDuckGo');
        assert.ok(out.result.includes('DuckDuckGo results for'));
    });

    it('defaults engine name to "Search"', () => {
        const results = [{ title: 'R', url: 'https://x.com' }];
        const out = formatResults('q', results);
        assert.ok(out.result.includes('Search results for'));
    });

    it('handles empty results array', () => {
        const out = formatResults('nothing', []);
        assert.equal(out.ok, true);
        assert.equal(out.results.length, 0);
    });
});
