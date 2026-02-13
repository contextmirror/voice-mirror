/**
 * Diagnostic Collector — singleton that accumulates pipeline trace data.
 * Used by hooks throughout the pipeline to capture stage data during diagnostic runs.
 */

const traces = new Map();
let activeTraceId = null;

function startTrace(traceId, message) {
    traces.set(traceId, {
        traceId,
        message,
        stages: [],
        startTime: Date.now()
    });
    activeTraceId = traceId;
}

function addStage(traceId, stage, data = {}) {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.stages.push({
        stage,
        timestamp: Date.now(),
        elapsed_ms: Date.now() - trace.startTime,
        ...data
    });
}

/**
 * Add stage using the active trace ID (for hooks that don't know the ID).
 */
function addActiveStage(stage, data = {}) {
    if (!activeTraceId) return;
    addStage(activeTraceId, stage, data);
}

function hasActiveTrace() {
    return activeTraceId !== null;
}

function getTrace(traceId) {
    return traces.get(traceId);
}

function endTrace(traceId) {
    const trace = traces.get(traceId);
    if (!trace) return null;

    trace.endTime = Date.now();
    trace.duration_ms = trace.endTime - trace.startTime;

    // Build summary
    const toolCalls = trace.stages.filter(s => s.stage === 'tool_call_detected');
    const truncations = [];

    for (const s of trace.stages) {
        if (s.stage === 'format_snapshot' && s.page_text_capped) {
            truncations.push({ stage: s.stage, detail: `page_text: ${s.page_text_capped}` });
        }
        if (s.stage === 'truncate_text' && s.truncated) {
            truncations.push({ stage: s.stage, lost_chars: s.lost, percent: `${((s.lost / s.input) * 100).toFixed(1)}%` });
        }
    }

    trace.summary = {
        duration_ms: trace.duration_ms,
        tool_calls: toolCalls.length,
        truncation_points: truncations,
        stages_captured: trace.stages.length
    };

    if (activeTraceId === traceId) {
        activeTraceId = null;
    }

    return trace;
}

function clearTrace(traceId) {
    if (activeTraceId === traceId) {
        activeTraceId = null;
    }
    traces.delete(traceId);
}

module.exports = {
    startTrace,
    addStage,
    addActiveStage,
    hasActiveTrace,
    getTrace,
    endTrace,
    clearTrace
};
