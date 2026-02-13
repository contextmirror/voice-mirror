/**
 * Provider switch test suite — 8 tests (hybrid: file-based + MCP plan).
 *
 * File-based: config write verification, log patterns, spawner log.
 * MCP plan: message send/receive via claude_send/claude_inbox.
 *
 * Note: The app does NOT watch config.json on disk. Provider switching
 * only works through Electron IPC (ai-set-provider). Config file writes
 * update the file but the running app ignores them. Live provider
 * response tests require MCP tools.
 */

const fs = require('fs');
const {
    createTestContext, readConfig, patchConfig, getConfigValue,
    searchLog, VMR_LOG_PATH, SPAWNER_LOG_PATH, CONFIG_PATH,
} = require('../lib/harness');

function getPlan() {
    return {
        suite: 'provider-switch',
        mode: 'mcp',
        description: 'Provider switch response tests via MCP (requires running app)',
        steps: [
            {
                id: 'send-message',
                description: 'Send a test message via MCP and verify it appears in inbox',
                mcpCall: { tool: 'claude_send', args: { instance_id: 'voice-claude', message: 'Integration test: What is 2+2?' } },
                verify: 'Message should be sent successfully',
            },
            {
                id: 'check-inbox',
                description: 'Read inbox to verify message round-trip',
                mcpCall: { tool: 'claude_inbox', args: { instance_id: 'voice-claude', limit: 5 } },
                verify: 'Inbox should contain the test message',
            },
        ],
    };
}

async function run(options = {}) {
    const t = createTestContext('provider-switch');

    const originalConfig = readConfig();
    const originalProvider = originalConfig?.ai?.provider || 'claude';

    // 1. Config writes provider to ollama
    patchConfig('ai.provider', 'ollama');
    t.assertConfigValue('ai.provider', 'ollama', 'Config writes provider to ollama');

    // 2. Config writes back to claude
    patchConfig('ai.provider', 'claude');
    t.assertConfigValue('ai.provider', 'claude', 'Config writes provider back to claude');

    // 3. Rapid config toggle — no JSON corruption
    for (const p of ['ollama', 'claude', 'ollama', 'claude', 'ollama']) {
        patchConfig('ai.provider', p);
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        t.assert(parsed?.ai?.provider === 'ollama', 'Rapid config toggle — JSON intact, last value correct');
    } catch {
        t.assert(false, 'Rapid config toggle — JSON corrupted');
    }

    // 4. Spawner debug log exists
    if (fs.existsSync(SPAWNER_LOG_PATH)) {
        const stat = fs.statSync(SPAWNER_LOG_PATH);
        t.assert(stat.size > 0, 'Claude spawner debug log exists and non-empty');
    } else {
        t.skip('Spawner debug log', 'File not found — Claude PTY may not have been started this session');
    }

    // 5. No crash errors in log
    if (fs.existsSync(VMR_LOG_PATH)) {
        const crashes = searchLog(/uncaught\s*exception|unhandled\s*rejection|fatal|CRASH/i, VMR_LOG_PATH);
        t.assert(crashes.length === 0, `No crash errors in vmr.log (found ${crashes.length})`);
    } else {
        t.skip('Crash error check', 'vmr.log not found');
    }

    // 6. Log shows provider events (from current session)
    if (fs.existsSync(VMR_LOG_PATH)) {
        const providerLogs = searchLog(
            /\[AIManager\] Starting AI provider|\[Voice Mirror\] AI provider set to|\[InboxWatcher\] Re-seeded/i,
            VMR_LOG_PATH
        );
        if (providerLogs.length > 0) {
            t.assert(true, `Log contains provider events (${providerLogs.length} entries)`);
        } else {
            const broadLogs = searchLog(/provider|AIManager|ai.*set/i, VMR_LOG_PATH);
            if (broadLogs.length > 0) {
                t.assert(true, `Log contains provider-related entries (${broadLogs.length} entries)`);
            } else {
                t.skip('Provider log events', 'No provider events in log — provider may not have been switched this session');
            }
        }
    } else {
        t.skip('Provider log events', 'vmr.log not found');
    }

    // 7-8. MCP response tests (plan mode only)
    t.skip('Send message via MCP', 'MCP-driven — use --mode plan');
    t.skip('Get response via MCP', 'MCP-driven — use --mode plan');

    // Restore original provider in config
    patchConfig('ai.provider', originalProvider);

    return t.getResults();
}

module.exports = { run, getPlan };
