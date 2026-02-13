/**
 * Report generator — markdown + JSON output.
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

function generateReport(suiteResults, options = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const duration = suiteResults.reduce((sum, s) => sum + s.duration, 0);

    let totalPassed = 0, totalFailed = 0, totalSkipped = 0;
    for (const s of suiteResults) {
        totalPassed += s.passed;
        totalFailed += s.failed;
        totalSkipped += s.skipped;
    }
    const total = totalPassed + totalFailed + totalSkipped;

    // Markdown
    const lines = [
        `# Voice Mirror Integration Test Report`,
        `Date: ${new Date().toISOString()}`,
        `Duration: ${(duration / 1000).toFixed(1)}s`,
        `Result: ${totalPassed}/${total} PASSED, ${totalFailed} FAILED, ${totalSkipped} SKIPPED`,
        '',
        '| Suite | Pass | Fail | Skip |',
        '|-------|------|------|------|',
    ];

    for (const s of suiteResults) {
        lines.push(`| ${s.suite.padEnd(18)} | ${String(s.passed).padEnd(4)} | ${String(s.failed).padEnd(4)} | ${String(s.skipped).padEnd(4)} |`);
    }

    // Failures
    const failures = suiteResults.flatMap(s => s.results.filter(r => r.passed === false));
    if (failures.length > 0) {
        lines.push('', '## Failures');
        for (const f of failures) {
            lines.push(`### ${f.suite}/${f.label}`);
            if (f.detail) lines.push(f.detail);
            lines.push('');
        }
    }

    // Skipped
    const skipped = suiteResults.flatMap(s => s.results.filter(r => r.skipped));
    if (skipped.length > 0) {
        lines.push('', '## Skipped');
        for (const s of skipped) {
            lines.push(`- **${s.suite}/${s.label}**: ${s.detail || 'No reason given'}`);
        }
    }

    const markdown = lines.join('\n');

    // JSON data
    const jsonData = {
        timestamp: new Date().toISOString(),
        duration,
        total, passed: totalPassed, failed: totalFailed, skipped: totalSkipped,
        suites: suiteResults,
    };

    // Write files
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const mdPath = path.join(RESULTS_DIR, `report-${timestamp}.md`);
    const jsonPath = path.join(RESULTS_DIR, `report-${timestamp}.json`);

    fs.writeFileSync(mdPath, markdown, 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');

    return { mdPath, jsonPath, markdown, jsonData };
}

module.exports = { generateReport };
