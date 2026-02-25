/**
 * design.test.cjs -- Source-inspection tests for design commands
 *
 * Verifies the Rust design command module has the expected functions,
 * uses the correct patterns, and is registered in lib.rs.
 */

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const designSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/design.rs'),
  'utf-8'
);

const libSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lib.rs'),
  'utf-8'
);

describe('design.rs — commands', () => {
  it('has design_command function', () => {
    assert.ok(designSrc.includes('pub fn design_command'));
  });

  it('has design_get_element async command', () => {
    assert.ok(designSrc.includes('pub async fn design_get_element'));
  });

  it('design_get_element uses evaluate_js_with_result', () => {
    assert.ok(designSrc.includes('evaluate_js_with_result'));
  });

  it('design_get_element reads getSelectedElement from vmDesign', () => {
    assert.ok(designSrc.includes('getSelectedElement'));
  });

  it('design_get_element is registered in lib.rs', () => {
    assert.ok(libSrc.includes('design_get_element'));
  });

  it('design_command is registered in lib.rs', () => {
    assert.ok(libSrc.includes('design_command'));
  });

  it('design_get_element returns Result<IpcResponse, String>', () => {
    assert.ok(designSrc.includes('Result<IpcResponse, String>'));
  });

  it('design_get_element uses LensState', () => {
    assert.ok(designSrc.includes('super::lens::LensState'));
  });
});
