//! Diagnostic handler: `pipeline_trace`
//!
//! Port of `mcp-server/handlers/diagnostic.js`.
//!
//! Sends a test message through the live app pipeline and returns trace data
//! via file-based IPC with the app's diagnostic system.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};
use tracing::debug;

use super::McpToolResult;

/// Get the MCP data directory.
fn get_mcp_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror-electron")
        .join("data")
}

/// Generate a unique trace ID.
fn generate_trace_id() -> String {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let rand: u32 = (ts % 1_000_000) as u32; // Simple pseudo-random suffix
    format!("diag-{}-{:06x}", ts, rand)
}

/// Get current time as a simple timestamp string.
fn now_iso() -> String {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}ms", ts)
}

/// Clean up old diagnostic trace files (older than 60 seconds).
fn cleanup_old_traces(data_dir: &std::path::Path) {
    let entries = match fs::read_dir(data_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let now = SystemTime::now();
    let max_age = Duration::from_secs(60);

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.starts_with("diagnostic_trace_") {
            continue;
        }

        if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                if let Ok(age) = now.duration_since(mtime) {
                    if age > max_age {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

/// Format trace data into readable markdown output.
fn format_trace_output(trace: &Value) -> String {
    let mut lines: Vec<String> = vec![];

    let message = trace
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("(unknown)");
    let trace_id = trace
        .get("traceId")
        .and_then(|v| v.as_str())
        .unwrap_or("(unknown)");
    let duration_ms = trace
        .get("duration_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let stages = trace
        .get("stages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    lines.push(format!("# Pipeline Trace: \"{}\"", message));
    lines.push(format!("Trace ID: {}", trace_id));
    lines.push(format!("Duration: {}ms", duration_ms));
    lines.push(format!("Stages captured: {}", stages.len()));
    lines.push(String::new());

    // Summary
    if let Some(summary) = trace.get("summary") {
        lines.push("## Summary".into());
        lines.push(format!(
            "Tool calls: {}",
            summary.get("tool_calls").and_then(|v| v.as_u64()).unwrap_or(0)
        ));

        if let Some(truncation_points) = summary.get("truncation_points").and_then(|v| v.as_array()) {
            if !truncation_points.is_empty() {
                lines.push("Truncation points:".into());
                for t in truncation_points {
                    let stage = t.get("stage").and_then(|v| v.as_str()).unwrap_or("?");
                    let detail = t
                        .get("detail")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| {
                            let lost = t.get("lost_chars").and_then(|v| v.as_u64()).unwrap_or(0);
                            let pct = t
                                .get("percent")
                                .and_then(|v| v.as_str())
                                .unwrap_or("?%");
                            format!("{} chars lost ({})", lost, pct)
                        });
                    lines.push(format!("  - {}: {}", stage, detail));
                }
            } else {
                lines.push("Truncation: None".into());
            }
        } else {
            lines.push("Truncation: None".into());
        }
        lines.push(String::new());
    }

    // Stages
    lines.push("## Stages".into());
    lines.push(String::new());

    for stage in &stages {
        let stage_name = stage.get("stage").and_then(|v| v.as_str()).unwrap_or("?");
        let elapsed = stage.get("elapsed_ms").and_then(|v| v.as_u64()).unwrap_or(0);
        lines.push(format!("### {} (+{}ms)", stage_name, elapsed));

        // Output stage data (skip reserved keys)
        if let Some(obj) = stage.as_object() {
            for (key, value) in obj {
                if matches!(key.as_str(), "stage" | "timestamp" | "elapsed_ms") {
                    continue;
                }

                if let Some(s) = value.as_str() {
                    if s.len() > 500 {
                        lines.push(format!("{}: ({} chars)", key, s.len()));
                        lines.push("```".into());
                        lines.push(format!("{}...", &s[..500]));
                        lines.push("```".into());
                    } else {
                        lines.push(format!("{}: {}", key, s));
                    }
                } else if value.is_object() || value.is_array() {
                    let formatted = serde_json::to_string_pretty(value).unwrap_or_else(|_| format!("{:?}", value));
                    lines.push(format!("{}: {}", key, formatted));
                } else {
                    lines.push(format!("{}: {}", key, value));
                }
            }
        }
        lines.push(String::new());
    }

    lines.join("\n")
}

/// `pipeline_trace` -- Send message through pipeline and trace every stage.
pub async fn handle_pipeline_trace(args: &Value, _data_dir: &Path) -> McpToolResult {
    let message = match args.get("message").and_then(|v| v.as_str()) {
        Some(m) if !m.is_empty() => m.to_string(),
        _ => return McpToolResult::error("message is required"),
    };

    let timeout_seconds = args
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(30);

    let trace_id = generate_trace_id();
    let data_dir = get_mcp_data_dir();

    let request_path = data_dir.join("diagnostic_request.json");
    let trace_path = data_dir.join(format!("diagnostic_trace_{}.json", trace_id));

    // Clean up old trace files
    cleanup_old_traces(&data_dir);

    // Write request
    let request = json!({
        "trace_id": trace_id,
        "message": message,
        "timeout_seconds": timeout_seconds,
        "timestamp": now_iso(),
    });

    let request_json = serde_json::to_string_pretty(&request).unwrap_or_else(|_| "{}".into());

    if let Err(e) = fs::write(&request_path, request_json) {
        return McpToolResult::error(format!("Failed to write diagnostic request: {}", e));
    }

    // Poll for trace result
    let timeout = Duration::from_secs(timeout_seconds + 5); // Extra 5s buffer
    let start = Instant::now();
    let poll_interval = Duration::from_secs(1);

    loop {
        if start.elapsed() >= timeout {
            return McpToolResult::error(format!(
                "Pipeline trace timed out after {}s. Is the Voice Mirror app running?",
                timeout_seconds
            ));
        }

        tokio::time::sleep(poll_interval).await;

        if trace_path.exists() {
            match fs::read_to_string(&trace_path) {
                Ok(raw) => {
                    match serde_json::from_str::<Value>(&raw) {
                        Ok(trace) => {
                            // Clean up trace file
                            let _ = fs::remove_file(&trace_path);

                            let output = format_trace_output(&trace);
                            return McpToolResult::text(output);
                        }
                        Err(e) => {
                            debug!("Trace file parse error (will retry): {}", e);
                            // Partial write, retry
                        }
                    }
                }
                Err(e) => {
                    debug!("Trace file read error (will retry): {}", e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_trace_id() {
        let id = generate_trace_id();
        assert!(id.starts_with("diag-"));
        assert!(id.len() > 10);
    }

    #[test]
    fn test_format_trace_output_minimal() {
        let trace = json!({
            "message": "hello",
            "traceId": "diag-123",
            "duration_ms": 42,
            "stages": [],
        });

        let output = format_trace_output(&trace);
        assert!(output.contains("Pipeline Trace"));
        assert!(output.contains("hello"));
        assert!(output.contains("42ms"));
    }

    #[test]
    fn test_format_trace_output_with_stages() {
        let trace = json!({
            "message": "test",
            "traceId": "diag-456",
            "duration_ms": 100,
            "stages": [{
                "stage": "stt",
                "elapsed_ms": 50,
                "text": "recognized text"
            }],
            "summary": {
                "tool_calls": 2,
                "truncation_points": []
            }
        });

        let output = format_trace_output(&trace);
        assert!(output.contains("stt"));
        assert!(output.contains("+50ms"));
        assert!(output.contains("recognized text"));
        assert!(output.contains("Tool calls: 2"));
        assert!(output.contains("Truncation: None"));
    }
}
