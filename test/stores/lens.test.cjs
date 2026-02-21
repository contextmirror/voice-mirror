/**
 * lens.test.js -- Source-inspection tests for lens.svelte.js
 *
 * Validates exports, reactive state, getters, methods, and URL normalization
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'lens.svelte.js'),
  'utf-8'
);

describe('lens: exports', () => {
  it('exports lensStore', () => {
    assert.ok(src.includes('export const lensStore'), 'Should export lensStore');
  });

  it('exports DEFAULT_URL', () => {
    assert.ok(
      src.includes('export { DEFAULT_URL }') || src.includes('export const DEFAULT_URL'),
      'Should export DEFAULT_URL'
    );
  });

  it('creates store via createLensStore factory', () => {
    assert.ok(src.includes('function createLensStore()'), 'Should define createLensStore factory');
  });
});

describe('lens: $state reactivity', () => {
  it('uses $state for url', () => {
    assert.ok(/let\s+url\s*=\s*\$state\(/.test(src), 'Should use $state for url');
  });

  it('uses $state for inputUrl', () => {
    assert.ok(/let\s+inputUrl\s*=\s*\$state\(/.test(src), 'Should use $state for inputUrl');
  });

  it('uses $state for loading', () => {
    assert.ok(/let\s+loading\s*=\s*\$state\(/.test(src), 'Should use $state for loading');
  });

  it('uses $state for canGoBack', () => {
    assert.ok(/let\s+canGoBack\s*=\s*\$state\(/.test(src), 'Should use $state for canGoBack');
  });

  it('uses $state for canGoForward', () => {
    assert.ok(/let\s+canGoForward\s*=\s*\$state\(/.test(src), 'Should use $state for canGoForward');
  });

  it('uses $state for webviewReady', () => {
    assert.ok(/let\s+webviewReady\s*=\s*\$state\(/.test(src), 'Should use $state for webviewReady');
  });

  it('uses $state for hidden', () => {
    assert.ok(/let\s+hidden\s*=\s*\$state\(/.test(src), 'Should use $state for hidden');
  });

  it('uses $state for pageTitle', () => {
    assert.ok(/let\s+pageTitle\s*=\s*\$state\(/.test(src), 'Should use $state for pageTitle');
  });
});

describe('lens: store getters', () => {
  const getters = ['url', 'inputUrl', 'loading', 'canGoBack', 'canGoForward', 'webviewReady', 'hidden', 'pageTitle'];

  for (const getter of getters) {
    it(`has getter "${getter}"`, () => {
      assert.ok(src.includes(`get ${getter}()`), `Should have getter "${getter}"`);
    });
  }
});

describe('lens: store setters', () => {
  const setters = ['setUrl', 'setInputUrl', 'setLoading', 'setCanGoBack', 'setCanGoForward', 'setWebviewReady', 'setHidden', 'setPageTitle'];

  for (const setter of setters) {
    it(`has setter "${setter}"`, () => {
      assert.ok(src.includes(`${setter}(`), `Should have setter "${setter}"`);
    });
  }
});

describe('lens: store methods', () => {
  for (const method of ['navigate', 'goBack', 'goForward', 'reload', 'reset', 'freeze', 'unfreeze']) {
    it(`has ${method} method`, () => {
      assert.ok(src.includes(`${method}(`), `Should have ${method} method`);
    });
  }
});

describe('lens: URL normalization', () => {
  it('adds https:// to bare domains', () => {
    assert.ok(src.includes("'https://'"), 'Should add https:// prefix');
  });

  it('checks for existing protocol', () => {
    assert.ok(src.includes('https?:'), 'Should check for existing protocol');
  });

  it('trims input', () => {
    assert.ok(src.includes('.trim()'), 'Should trim URL input');
  });
});

describe('lens: DEFAULT_URL', () => {
  it('DEFAULT_URL is a string', () => {
    assert.ok(/const\s+DEFAULT_URL\s*=\s*'/.test(src), 'DEFAULT_URL should be a string constant');
  });

  it('DEFAULT_URL is a valid URL', () => {
    assert.ok(src.includes('https://'), 'DEFAULT_URL should be an https URL');
  });
});

describe('lens: imports', () => {
  it('imports lensNavigate from api', () => {
    assert.ok(src.includes('lensNavigate'), 'Should import lensNavigate');
  });

  it('imports lensGoBack from api', () => {
    assert.ok(src.includes('lensGoBack'), 'Should import lensGoBack');
  });

  it('imports lensGoForward from api', () => {
    assert.ok(src.includes('lensGoForward'), 'Should import lensGoForward');
  });

  it('imports lensReload from api', () => {
    assert.ok(src.includes('lensReload'), 'Should import lensReload');
  });

  it('imports from ../api.js', () => {
    assert.ok(
      src.includes("'../api.js'") || src.includes('"../api.js"'),
      'Should import from ../api.js'
    );
  });
});

describe('lens: error handling', () => {
  it('handles navigation errors', () => {
    assert.ok(src.includes('Navigation failed'), 'Should log navigation failures');
  });

  it('uses try/catch in navigate', () => {
    assert.ok(src.includes('catch'), 'Should have error handling');
  });
});
