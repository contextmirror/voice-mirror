use std::fs;
use std::sync::Arc;

use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use super::output::{OutputLayer, OutputStore};
use super::platform;

/// Initialize the structured logging system.
///
/// Sets up:
/// - File output: rolling log files in `{data_dir}/voice-mirror/logs/vmr.log`
///   with daily rotation, keeping the latest 5 files.
/// - Console output (stderr): human-readable format for development.
/// - Output channel layer: captures events into ring buffers for live diagnostics.
/// - Environment filter: defaults to `info`, configurable via `RUST_LOG`.
///
/// Returns an `Arc<OutputStore>` that should be registered as Tauri managed state
/// so that commands can query the ring buffers.
///
/// # Panics
///
/// Panics if the tracing subscriber cannot be set (e.g., called twice).
/// Use `try_init()` if you need fallible initialization.
pub fn init() -> Arc<OutputStore> {
    let log_dir = platform::get_log_dir();
    let _ = fs::create_dir_all(&log_dir);

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("vmr")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&log_dir)
        .expect("Failed to create log file appender");

    let file_layer = fmt::layer()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true);

    let console_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .with_target(true)
        .compact();

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("info,ort=warn,tao=warn,reqwest=warn,mio=warn,hyper=warn")
    });

    // Output channel system — ring buffers for live diagnostics
    let output_store = Arc::new(OutputStore::new());
    let output_layer = OutputLayer::new(Arc::clone(&output_store));

    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(console_layer)
        .with(output_layer)
        .init();

    tracing::info!(
        log_dir = %log_dir.display(),
        "Logger initialized"
    );

    output_store
}

/// Try to initialize the logger, returning an error instead of panicking
/// if it has already been initialized.
pub fn try_init() -> Result<Arc<OutputStore>, String> {
    let result = std::panic::catch_unwind(init);
    match result {
        Ok(store) => Ok(store),
        Err(_) => Err("Logger already initialized or initialization failed".into()),
    }
}
