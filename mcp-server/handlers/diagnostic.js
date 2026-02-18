/**
 * Diagnostic handler: pipeline_trace
 * Sends a test message through the live app pipeline and returns trace data.
 */

const fs = require('fs');
const path = require('path');
const { HOME_DATA_DIR } = require('../paths');

/**
 * pipeline_trace - Send message through pipeline and trace every stage.
 */
async function handlePipelineTrace(args) {
    const message = args?.message;
    if (!message) {
        return {
            content: [{ type: 'text', text: 'message is required' }],
            isError: true
        };
    }

    const timeoutSeconds = args?.timeout_seconds || 30;
    const traceId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Write diagnostic request for Electron to pick up
    const requestPath = path.join(HOME_DATA_DIR, 'diagnostic_request.json');
    const tracePath = path.join(HOME_DATA_DIR, `diagnostic_trace_${traceId}.json`);

    // Clean up old trace files
    try {
        const files = fs.readdirSync(HOME_DATA_DIR).filter(f => f.startsWith('diagnostic_trace_'));
        for (const f of files) {
            const fPath = path.join(HOME_DATA_DIR, f);
            const stat = fs.statSync(fPath);
            if (Date.now() - stat.mtimeMs > 60000) {
                fs.unlinkSync(fPath);
            }
        }
    } catch (e) { console.error('[MCP]', 'diagnostic trace cleanup error:', e?.message); }

    // Write request
    fs.writeFileSync(requestPath, JSON.stringify({
        trace_id: traceId,
        message,
        timeout_seconds: timeoutSeconds,
        timestamp: new Date().toISOString()
    }, null, 2));

    // Poll for trace result
    const startTime = Date.now();
    const timeoutMs = (timeoutSeconds + 5) * 1000; // Extra 5s buffer

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (fs.existsSync(tracePath)) {
            try {
                const trace = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));

                // Clean up trace file
                try { fs.unlinkSync(tracePath); } catch (e) { console.error('[MCP]', 'diagnostic trace file cleanup error:', e?.message); }

                // Format output
                return {
                    content: [{ type: 'text', text: formatTraceOutput(trace) }]
                };
            } catch (e) {
                console.error('[MCP]', 'diagnostic trace parse error (will retry):', e?.message);
            }
        }
    }

    return {
        content: [{
            type: 'text',
            text: `Pipeline trace timed out after ${timeoutSeconds}s. Is the Voice Mirror app running?`
        }],
        isError: true
    };
}

/**
 * Format trace data into readable output.
 */
function formatTraceOutput(trace) {
    const lines = [];

    lines.push(`# Pipeline Trace: "${trace.message}"`);
    lines.push(`Trace ID: ${trace.traceId}`);
    lines.push(`Duration: ${trace.duration_ms}ms`);
    lines.push(`Stages captured: ${trace.stages?.length || 0}`);
    lines.push('');

    // Summary
    if (trace.summary) {
        lines.push('## Summary');
        lines.push(`Tool calls: ${trace.summary.tool_calls}`);
        if (trace.summary.truncation_points?.length > 0) {
            lines.push('Truncation points:');
            for (const t of trace.summary.truncation_points) {
                lines.push(`  - ${t.stage}: ${t.detail || `${t.lost_chars} chars lost (${t.percent})`}`);
            }
        } else {
            lines.push('Truncation: None');
        }
        lines.push('');
    }

    // Stages
    lines.push('## Stages');
    lines.push('');

    for (const stage of (trace.stages || [])) {
        lines.push(`### ${stage.stage} (+${stage.elapsed_ms}ms)`);

        // Stage-specific formatting
        const { stage: _, timestamp: __, elapsed_ms: ___, ...data } = stage;
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string' && value.length > 500) {
                lines.push(`${key}: (${value.length} chars)`);
                lines.push('```');
                lines.push(value.substring(0, 500) + '...');
                lines.push('```');
            } else if (typeof value === 'object') {
                lines.push(`${key}: ${JSON.stringify(value, null, 2)}`);
            } else {
                lines.push(`${key}: ${value}`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

module.exports = { handlePipelineTrace };
