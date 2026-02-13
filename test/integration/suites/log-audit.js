/**
 * Log audit test suite — 6 log analysis tests.
 */

const fs = require('fs');
const {
    createTestContext, getLogLines, searchLog, countErrors,
    VMR_LOG_PATH, LOCK_PATH,
} = require('../lib/harness');

async function run(options = {}) {
    const t = createTestContext('log-audit');

    // Check log exists
    if (!fs.existsSync(VMR_LOG_PATH)) {
        t.skip('All log-audit tests', 'vmr.log not found — app may not have been started');
        return t.getResults();
    }

    const allLines = getLogLines(VMR_LOG_PATH);

    // 1. No uncaught exceptions
    const uncaught = searchLog(/uncaught\s*exception|unhandled\s*rejection/i, VMR_LOG_PATH);
    t.assert(uncaught.length === 0, `No uncaught exceptions (found ${uncaught.length})`);

    // 2. No ENOENT errors
    const enoent = searchLog(/ENOENT/i, VMR_LOG_PATH);
    t.assert(enoent.length === 0, `No ENOENT file-not-found errors (found ${enoent.length})`);

    // 3. No repeated errors (>5 repeats of same pattern)
    const errorLines = allLines.filter(l => /\bERROR\b/i.test(l));
    const errorGroups = {};
    for (const line of errorLines) {
        // Normalize: strip timestamps and numbers for grouping
        const key = line.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g, '')
                       .replace(/\d+/g, 'N')
                       .trim().slice(0, 100);
        errorGroups[key] = (errorGroups[key] || 0) + 1;
    }
    const repeatedErrors = Object.entries(errorGroups).filter(([, count]) => count > 5);
    t.assert(repeatedErrors.length === 0, `No repeated errors >5x (found ${repeatedErrors.length} patterns)`);

    // 4. Startup complete (MCP server or app ready marker)
    const startupLines = searchLog(/mcp.*server.*ready|app.*ready|listening|initialized/i, VMR_LOG_PATH);
    if (startupLines.length > 0) {
        t.assert(true, 'Startup complete marker found in log');
    } else {
        t.skip('Startup marker', 'No startup marker pattern found');
    }

    // 5. No stale locks
    if (fs.existsSync(LOCK_PATH)) {
        try {
            const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8'));
            const lockAge = Date.now() - new Date(lock.timestamp || lock.created || 0).getTime();
            t.assert(lockAge < 70000, `Listener lock not stale (age: ${(lockAge / 1000).toFixed(0)}s)`);
        } catch {
            t.skip('Lock staleness', 'Could not parse lock file');
        }
    } else {
        t.assert(true, 'No listener lock file (clean state)');
    }

    // 6. Timing audit — flag any logged operation >5s
    const slowOps = allLines.filter(line => {
        const match = line.match(/(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/);
        if (match) return parseFloat(match[1]) > 5000;
        const secMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:s|seconds)/);
        if (secMatch) return parseFloat(secMatch[1]) > 5;
        return false;
    });
    t.assert(slowOps.length === 0, `No operations >5s logged (found ${slowOps.length})`);

    return t.getResults();
}

module.exports = { run };
