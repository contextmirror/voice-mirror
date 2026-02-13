#!/usr/bin/env node
/**
 * Integration Test Runner
 *
 * Usage:
 *   node test/integration/runner.js                  Run all file-based suites
 *   node test/integration/runner.js --suite config   Run specific suite
 *   node test/integration/runner.js --suite memory --mode plan   Output MCP test plan
 *   node test/integration/runner.js --verbose        Show details
 */

const path = require('path');
const { generateReport } = require('./lib/report');
const { backupConfig, restoreConfig } = require('./lib/harness');

// Suite registry
const SUITES = {
    config:           () => require('./suites/config'),
    messaging:        () => require('./suites/messaging'),
    'tool-groups':    () => require('./suites/tool-groups'),
    memory:           () => require('./suites/memory'),
    screen:           () => require('./suites/screen'),
    'provider-switch':() => require('./suites/provider-switch'),
    stress:           () => require('./suites/stress'),
    'log-audit':      () => require('./suites/log-audit'),
};

const FILE_BASED = ['config', 'messaging', 'provider-switch', 'stress', 'log-audit'];
const MCP_DRIVEN = ['tool-groups', 'memory', 'screen'];

function parseArgs(argv) {
    const args = { suite: null, mode: 'run', verbose: false };
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--suite': args.suite = argv[++i]; break;
            case '--mode': args.mode = argv[++i]; break;
            case '--verbose': case '-v': args.verbose = true; break;
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);

    console.log('╔══════════════════════════════════════════╗');
    console.log('║   Voice Mirror Integration Tests         ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log();

    // Determine which suites to run
    let suiteNames;
    if (args.suite) {
        if (!SUITES[args.suite]) {
            console.error(`Unknown suite: ${args.suite}`);
            console.error(`Available: ${Object.keys(SUITES).join(', ')}`);
            process.exit(1);
        }
        suiteNames = [args.suite];
    } else {
        // Default: run file-based suites only
        suiteNames = FILE_BASED;
    }

    // MCP plan mode: output test plan JSON for Claude to execute
    if (args.mode === 'plan') {
        const mcpSuites = suiteNames.filter(s => MCP_DRIVEN.includes(s));
        if (mcpSuites.length === 0) {
            console.error('No MCP-driven suites selected. Use --suite tool-groups|memory|screen');
            process.exit(1);
        }
        for (const name of mcpSuites) {
            const suite = SUITES[name]();
            if (suite.getPlan) {
                console.log(JSON.stringify(suite.getPlan(), null, 2));
            }
        }
        return;
    }

    // Backup config before any tests
    const backedUp = backupConfig();
    if (backedUp) console.log('Config backed up.');

    const allResults = [];

    for (const name of suiteNames) {
        const isMcp = MCP_DRIVEN.includes(name);
        if (isMcp && args.mode !== 'verify') {
            console.log(`⏭  ${name} (MCP-driven — use --mode plan to get test plan)`);
            continue;
        }

        console.log(`\n▶ Running: ${name}`);
        console.log('─'.repeat(50));

        try {
            const suite = SUITES[name]();
            const result = await suite.run({ verbose: args.verbose });
            allResults.push(result);

            // Print results
            for (const r of result.results) {
                if (r.skipped) {
                    console.log(`  ⏭  ${r.label} (SKIPPED: ${r.detail || ''})`);
                } else if (r.passed) {
                    console.log(`  ✅ ${r.label}`);
                } else {
                    console.log(`  ❌ ${r.label}`);
                    if (r.detail) console.log(`     └─ ${r.detail}`);
                }
            }

            console.log(`  → ${result.passed}/${result.passed + result.failed + result.skipped} passed (${(result.duration / 1000).toFixed(1)}s)`);
        } catch (err) {
            console.error(`  ERROR: ${err.message}`);
            allResults.push({
                suite: name, duration: 0, results: [],
                passed: 0, failed: 1, skipped: 0,
            });
        }
    }

    // Restore config
    if (backedUp) {
        restoreConfig();
        console.log('\nConfig restored.');
    }

    // Report
    if (allResults.length > 0) {
        const { mdPath, jsonData } = generateReport(allResults);
        console.log('\n' + '═'.repeat(50));
        console.log(`TOTAL: ${jsonData.passed}/${jsonData.total} passed, ${jsonData.failed} failed, ${jsonData.skipped} skipped`);
        console.log(`Report: ${mdPath}`);
        process.exit(jsonData.failed > 0 ? 1 : 0);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    restoreConfig();
    process.exit(2);
});
