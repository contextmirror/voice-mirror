use std::fs;

use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use super::platform;

/// Initialize the structured logging system.
///
/// Sets up:
/// - File output: rolling log files in `{data_dir}/voice-mirror/logs/vmr.log`
///   with daily rotation, keeping the latest 5 files.
/// - Console output (stderr): human-readable format for development.
/// - Environment filter: defaults to `info`, configurable via `RUST_LOG`.
///
/// # Panics
///
/// Panics if the tracing subscriber cannot be set (e.g., called twice).
/// Use `try_init()` if you need fallible initialization.
pub fn init() {
    let log_dir = platform::get_log_dir();

    // Ensure the log directory exists
    let _ = fs::create_dir_all(&log_dir);

    // Rolling file appender: daily rotation, keeping 5 files, max ~10MB each.
    // tracing-appender's RollingFileAppender handles rotation by date.
    // For size-based rotation, we rely on daily rotation being sufficient
    // for a desktop app (typical daily output is well under 10MB).
    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("vmr")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&log_dir)
        .expect("Failed to create log file appender");

    // File layer: JSON-like structured format for machine parsing
    let file_layer = fmt::layer()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true);

    // Console layer: human-readable for development
    let console_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .with_target(true)
        .compact();

    // Environment filter: RUST_LOG env var, defaulting to info
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(console_layer)
        .init();

    tracing::info!(
        log_dir = %log_dir.display(),
        "Logger initialized"
    );
}

/// Try to initialize the logger, returning an error instead of panicking
/// if it has already been initialized.
pub fn try_init() -> Result<(), String> {
    // Use a catch to handle double-init gracefully
    let result = std::panic::catch_unwind(init);
    match result {
        Ok(()) => Ok(()),
        Err(_) => Err("Logger already initialized or initialization failed".into()),
    }
}
