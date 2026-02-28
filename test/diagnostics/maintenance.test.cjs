const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const claudeMd = fs.readFileSync(
  path.join(__dirname, '../../CLAUDE.md'), 'utf-8'
);
const diagnosticsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/diagnostics.svelte.js'), 'utf-8'
);

describe('CLAUDE.md -- wiring checklist includes health contracts', () => {
  it('mentions health contract in wiring checklist', () => {
    assert.ok(
      claudeMd.includes('Health') && claudeMd.includes('contract'),
      'Wiring checklist should mention health contracts'
    );
  });

  it('mentions diagnostics store', () => {
    assert.ok(
      claudeMd.includes('diagnostics'),
      'Should mention diagnostics store'
    );
  });
});

describe('diagnostics.svelte.js -- EXPECTED_SUBSYSTEMS is documented', () => {
  it('has comment explaining how to add new subsystems', () => {
    assert.ok(
      diagnosticsSrc.includes('Update this list') || diagnosticsSrc.includes('adding'),
      'Should document how to add new expected subsystems'
    );
  });
});

describe('CLAUDE.md -- session-start diagnostic protocol', () => {
  it('instructs Claude to read frontend.jsonl on session start', () => {
    assert.ok(
      claudeMd.includes('frontend.jsonl'),
      'Should instruct reading frontend.jsonl'
    );
  });

  it('mentions checking for errors at session start', () => {
    assert.ok(
      claudeMd.includes('Session-Start Diagnostic') || claudeMd.includes('session-start diagnostic'),
      'Should have session-start diagnostic protocol'
    );
  });
});
