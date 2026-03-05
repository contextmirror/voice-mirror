/**
 * lsp-severity-remap.test.cjs -- Source-inspection tests for diagnostic severity remapping.
 *
 * Validates that VS Code-compatible style check codes are remapped from error to warning.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);
const clientSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/client.rs'), 'utf-8'
);

describe('types.rs: style check codes', () => {
  it('defines STYLE_CHECK_CODES constant', () => {
    assert.ok(typesSrc.includes('STYLE_CHECK_CODES'), 'Should define STYLE_CHECK_CODES');
  });

  for (const code of [6133, 6138, 6192, 6196, 7027, 7028, 7029, 7030]) {
    it(`includes code ${code}`, () => {
      assert.ok(typesSrc.includes(`${code}`), `Should include style check code ${code}`);
    });
  }
});

describe('client.rs: severity remapping', () => {
  it('references STYLE_CHECK_CODES', () => {
    assert.ok(clientSrc.includes('STYLE_CHECK_CODES'), 'Should reference STYLE_CHECK_CODES');
  });

  it('checks diagnostic code for style check remapping', () => {
    assert.ok(
      clientSrc.includes('STYLE_CHECK_CODES.contains'),
      'Should check if diagnostic code is a style check'
    );
  });

  it('remaps severity from error to warning for style checks', () => {
    assert.ok(
      clientSrc.includes('"warning"') && clientSrc.includes('STYLE_CHECK_CODES'),
      'Should remap error to warning for style check codes'
    );
  });
});
