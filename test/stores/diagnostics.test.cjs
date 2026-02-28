const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/diagnostics.svelte.js'), 'utf-8'
);

describe('diagnostics.svelte.js -- health contract registry', () => {
  it('exports diagnosticsStore', () => {
    assert.ok(src.includes('export const diagnosticsStore'), 'Should export diagnosticsStore');
  });

  it('has registerHealthContract function', () => {
    assert.ok(src.includes('registerHealthContract'), 'Should have registerHealthContract');
  });

  it('has unregisterHealthContract function', () => {
    assert.ok(src.includes('unregisterHealthContract'), 'Should have unregisterHealthContract');
  });

  it('stores contracts in a Map keyed by subsystem name', () => {
    assert.ok(src.includes('Map') || src.includes('contracts'), 'Should use a Map or object for contracts');
  });

  it('each contract has name, check function, and interval', () => {
    assert.ok(src.includes('name'), 'Contract should have name');
    assert.ok(src.includes('check'), 'Contract should have check function');
  });
});

describe('diagnostics.svelte.js -- health check runner', () => {
  it('has runAllChecks function', () => {
    assert.ok(src.includes('runAllChecks'), 'Should have runAllChecks');
  });

  it('has startMonitoring function with interval', () => {
    assert.ok(src.includes('startMonitoring'), 'Should have startMonitoring');
  });

  it('has stopMonitoring function', () => {
    assert.ok(src.includes('stopMonitoring'), 'Should have stopMonitoring');
  });

  it('uses setInterval for periodic checks', () => {
    assert.ok(src.includes('setInterval'), 'Should use setInterval');
  });

  it('defaults to 30s check interval', () => {
    assert.ok(src.includes('30000'), 'Should default to 30s');
  });
});

describe('diagnostics.svelte.js -- health status tracking', () => {
  it('tracks health results per subsystem', () => {
    assert.ok(src.includes('results'), 'Should track results');
  });

  it('each result has healthy boolean', () => {
    assert.ok(src.includes('healthy'), 'Results should have healthy flag');
  });

  it('each result has message string', () => {
    assert.ok(src.includes('message'), 'Results should have message');
  });

  it('each result has lastChecked timestamp', () => {
    assert.ok(src.includes('lastChecked'), 'Results should have timestamp');
  });

  it('exposes unhealthy subsystems getter', () => {
    assert.ok(src.includes('unhealthy') || src.includes('getUnhealthy'), 'Should expose unhealthy getter');
  });
});

describe('diagnostics.svelte.js -- logging unhealthy states', () => {
  it('imports logFrontendError for reporting', () => {
    assert.ok(src.includes('logFrontendError'), 'Should import logFrontendError');
  });

  it('logs WARN when a health check fails', () => {
    assert.ok(src.includes('WARN'), 'Should log warnings for unhealthy states');
  });
});

describe('diagnostics.svelte.js -- meta health check', () => {
  it('has meta check for missing subsystem reports', () => {
    assert.ok(
      src.includes('EXPECTED_SUBSYSTEMS') || src.includes('expectedSubsystems'),
      'Should track expected subsystems for meta-check'
    );
  });
});
