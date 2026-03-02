const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../../src/lib/tab-utils.js');

describe('tab-utils.js', () => {
  it('source file exists', () => {
    assert.ok(fs.existsSync(srcPath), 'src/lib/tab-utils.js should exist');
  });

  const src = fs.existsSync(srcPath) ? fs.readFileSync(srcPath, 'utf-8') : '';

  it('exports getTabIcon as a named export', () => {
    assert.ok(
      src.includes('export function getTabIcon'),
      'Should export getTabIcon as a named function'
    );
  });

  it('accepts a tab parameter', () => {
    assert.match(src, /function getTabIcon\(\s*tab\s*\)/,
      'Should accept a tab parameter');
  });

  it('returns "diff" for diff tabs', () => {
    assert.ok(
      src.includes("tab.type === 'diff'") && src.includes("return 'diff'"),
      'Should return "diff" when tab.type is "diff"'
    );
  });

  it('extracts file extension from tab.title', () => {
    assert.ok(
      src.includes("tab.title?.split('.').pop()?.toLowerCase()"),
      'Should extract extension from tab.title using split/pop/toLowerCase'
    );
  });

  it('maps JS/TS extensions to "code"', () => {
    assert.ok(
      src.includes("'js'") && src.includes("'ts'") && src.includes("'tsx'"),
      'Should handle js, ts, tsx extensions'
    );
  });

  it('maps CSS extensions to "palette"', () => {
    assert.ok(
      src.includes("'css'") && src.includes("return 'palette'"),
      'Should map CSS to "palette"'
    );
  });

  it('maps JSON/TOML/YAML to "settings"', () => {
    assert.ok(
      src.includes("'json'") && src.includes("'toml'") && src.includes("return 'settings'"),
      'Should map config files to "settings"'
    );
  });

  it('maps markdown/text to "doc"', () => {
    assert.ok(
      src.includes("'md'") && src.includes("'txt'") && src.includes("return 'doc'"),
      'Should map md/txt to "doc"'
    );
  });

  it('maps image extensions to "image"', () => {
    assert.ok(
      src.includes("'png'") && src.includes("'svg'") && src.includes("return 'image'"),
      'Should map image extensions to "image"'
    );
  });

  it('defaults to "file" for unknown extensions', () => {
    assert.ok(
      src.includes("return 'file'"),
      'Should default to "file"'
    );
  });

  it('has JSDoc documentation', () => {
    assert.ok(src.includes('/**'), 'Should have JSDoc comment');
    assert.ok(src.includes('@param'), 'Should have @param tag');
    assert.ok(src.includes('@returns'), 'Should have @returns tag');
  });
});

describe('getTabIcon consumers', () => {
  const consumers = [
    { file: 'src/components/lens/TabBar.svelte', label: 'TabBar' },
    { file: 'src/components/lens/GroupTabBar.svelte', label: 'GroupTabBar' },
  ];

  for (const { file, label } of consumers) {
    const fullPath = path.join(__dirname, '../../', file);

    it(`${label} imports getTabIcon from $lib/tab-utils.js`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        content.includes("import { getTabIcon } from '$lib/tab-utils.js'") ||
        content.includes("import { getTabIcon } from '$lib/tab-utils'") ||
        content.includes("import {getTabIcon} from '$lib/tab-utils.js'"),
        `${label} should import getTabIcon from $lib/tab-utils.js`
      );
    });

    it(`${label} does not have a local getTabIcon function`, () => {
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        !content.includes('function getTabIcon(tab)'),
        `${label} should no longer have a local getTabIcon function`
      );
    });
  }
});
