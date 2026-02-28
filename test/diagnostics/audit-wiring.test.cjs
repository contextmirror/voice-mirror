const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const tabsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/tabs.svelte.js'), 'utf-8'
);
const terminalTabsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js'), 'utf-8'
);
const lensSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/lens.svelte.js'), 'utf-8'
);

describe('tabs.svelte.js -- audit wiring', () => {
  it('imports audit-log', () => {
    assert.ok(tabsSrc.includes('audit-log'), 'Should import from audit-log');
  });

  it('audits file open', () => {
    assert.ok(tabsSrc.includes('auditEditor'), 'Should call auditEditor');
  });
});

describe('terminal-tabs.svelte.js -- audit wiring', () => {
  it('imports audit-log', () => {
    assert.ok(terminalTabsSrc.includes('audit-log'), 'Should import from audit-log');
  });

  it('audits terminal actions', () => {
    assert.ok(terminalTabsSrc.includes('auditTerminal'), 'Should call auditTerminal');
  });
});

describe('lens.svelte.js -- audit wiring', () => {
  it('imports audit-log', () => {
    assert.ok(lensSrc.includes('audit-log'), 'Should import from audit-log');
  });

  it('audits navigation', () => {
    assert.ok(lensSrc.includes('auditNav'), 'Should call auditNav');
  });
});
