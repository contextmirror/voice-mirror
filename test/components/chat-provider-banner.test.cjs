/**
 * chat-provider-banner.test.cjs -- guards the first-run dead-end fix (launch H1):
 * when a CLI agent is configured but not running, the chat panel must show a
 * "not running → Start" affordance instead of silently routing to a dead inbox.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/chat/ChatPanel.svelte'),
  'utf-8'
);

describe('ChatPanel: provider-not-running banner (H1)', () => {
  it('detects a configured-but-stopped CLI provider', () => {
    assert.ok(src.includes('CLI_PROVIDERS'), 'uses the CLI provider list');
    assert.ok(src.includes('needsProviderStart'), 'derives a needs-start condition');
    assert.ok(/CLI_PROVIDERS\.includes\(configuredProvider\) && !aiStatusStore\.running/.test(src),
      'banner shows only for a CLI provider that is not running');
  });

  it('renders a Start affordance wired to startProvider', () => {
    assert.ok(src.includes('provider-banner'), 'renders the banner');
    assert.ok(src.includes('handleStartProvider'), 'has a start handler');
    assert.ok(src.includes('await startProvider()'), 'start reuses the canonical startProvider');
    assert.ok(src.includes('{#if needsProviderStart}'), 'banner is conditional on needs-start');
  });
});
