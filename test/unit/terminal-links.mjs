import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectURLs, detectFilePaths } from '../../src/lib/terminal-links.js';

describe('terminal-links', () => {
  describe('detectURLs', () => {
    it('detects https URL', () => {
      const matches = detectURLs('visit https://example.com for info');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('detects http URL', () => {
      const matches = detectURLs('http://localhost:3000/api');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].url, 'http://localhost:3000/api');
    });

    it('detects URL with query string', () => {
      const matches = detectURLs('https://example.com/path?q=search&page=2');
      assert.equal(matches.length, 1);
      assert.ok(matches[0].url.includes('?q=search'));
    });

    it('detects URL with fragment', () => {
      const matches = detectURLs('https://example.com/docs#section');
      assert.equal(matches.length, 1);
      assert.ok(matches[0].url.includes('#section'));
    });

    it('strips trailing period', () => {
      const matches = detectURLs('See https://example.com.');
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('strips trailing comma', () => {
      const matches = detectURLs('https://example.com, more text');
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('strips trailing parenthesis if unmatched', () => {
      const matches = detectURLs('(see https://example.com)');
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('keeps matched parentheses in URL', () => {
      const matches = detectURLs('https://en.wikipedia.org/wiki/Foo_(bar)');
      assert.ok(matches[0].url.includes('(bar)'));
    });

    it('detects multiple URLs on one line', () => {
      const matches = detectURLs('https://a.com and https://b.com');
      assert.equal(matches.length, 2);
    });

    it('returns start and end positions', () => {
      const matches = detectURLs('xx https://example.com yy');
      assert.equal(matches[0].start, 3);
      assert.equal(matches[0].end, 3 + 'https://example.com'.length);
    });

    it('returns empty for no URLs', () => {
      assert.equal(detectURLs('no urls here').length, 0);
    });

    it('detects URL with port', () => {
      const matches = detectURLs('http://127.0.0.1:8080/path');
      assert.equal(matches.length, 1);
    });
  });

  describe('detectFilePaths', () => {
    it('detects relative Unix path with line number', () => {
      const matches = detectFilePaths('  src/App.svelte:42:5', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].path, '/project/src/App.svelte');
      assert.equal(matches[0].line, 42);
      assert.equal(matches[0].col, 5);
    });

    it('detects ./relative path', () => {
      const matches = detectFilePaths('./src/main.js:10', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 10);
    });

    it('detects path with line only', () => {
      const matches = detectFilePaths('src/foo.ts:7', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 7);
      assert.equal(matches[0].col, undefined);
    });

    it('detects Windows absolute path', () => {
      const matches = detectFilePaths('E:\\Projects\\Voice Mirror\\src\\main.js:5', '');
      assert.equal(matches.length, 1);
      assert.ok(matches[0].path.includes('main.js'));
      assert.equal(matches[0].line, 5);
    });

    it('detects parenthesized line:col format', () => {
      const matches = detectFilePaths('src/foo.rs(42,5): error', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 42);
      assert.equal(matches[0].col, 5);
    });

    it('returns start and end positions', () => {
      const matches = detectFilePaths('error in src/foo.js:5', '/project');
      assert.ok(matches[0].start >= 0);
      assert.ok(matches[0].end > matches[0].start);
    });

    it('does not match plain words without extensions', () => {
      const matches = detectFilePaths('hello world', '/project');
      assert.equal(matches.length, 0);
    });

    it('returns empty array for no matches', () => {
      assert.equal(detectFilePaths('no files here', '/project').length, 0);
    });

    it('matches common extensions', () => {
      for (const ext of ['.js', '.ts', '.rs', '.py', '.css', '.html', '.svelte', '.json', '.md', '.toml']) {
        const matches = detectFilePaths('file' + ext + ':1', '/p');
        assert.ok(matches.length >= 1, 'should match ' + ext);
      }
    });

    it('detects paths in TypeScript compiler output', () => {
      const matches = detectFilePaths('src/components/App.tsx(15,3): error TS2304:', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 15);
      assert.equal(matches[0].col, 3);
    });

    it('detects paths in Rust compiler output', () => {
      const matches = detectFilePaths('  --> src/main.rs:42:10', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 42);
      assert.equal(matches[0].col, 10);
    });
  });
});
