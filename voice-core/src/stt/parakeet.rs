//! Parakeet ONNX STT via a persistent Python worker process.
//!
//! Spawns `stt-worker.py` once at startup (which loads the 600MB model into
//! memory), then communicates via JSON-line stdin/stdout for each transcription
//! request.  This avoids the 30+ second model reload penalty of spawning
//! `onnx-asr` as a fresh subprocess for every call.
//!
//! When the `onnx` feature is disabled a stub is provided that always
//! returns an error, mirroring the pattern used by the whisper adapter.

// ── onnx enabled ─────────────────────────────────────────────────
#[cfg(feature = "onnx")]
mod inner {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::{Child, ChildStdin, ChildStdout, Command};
    use tracing::{debug, info};

    use crate::stt::SttEngine;

    /// Minimum audio duration in samples at 16 kHz (0.4 s = 6400 samples).
    const MIN_SAMPLES: usize = 6_400;

    /// Timeout for individual transcription requests (seconds).
    const TRANSCRIBE_TIMEOUT_SECS: u64 = 30;

    /// Timeout for the worker to start and load the model (seconds).
    const STARTUP_TIMEOUT_SECS: u64 = 120;

    pub struct ParakeetStt {
        /// Tokio child stdin/stdout handles (behind Mutex for &self access).
        worker_stdin: Mutex<Option<ChildStdin>>,
        worker_stdout: Mutex<Option<BufReader<ChildStdout>>>,
        /// Keep the child alive so it doesn't get dropped.
        _child: Mutex<Option<Child>>,
    }

    impl ParakeetStt {
        /// Create a new Parakeet adapter by spawning the persistent worker.
        ///
        /// Blocks (async) until the worker signals `{"ready": true}` or times
        /// out after `STARTUP_TIMEOUT_SECS`.
        pub async fn new(data_dir: &Path) -> anyhow::Result<Self> {
            let python = find_python()?;
            let worker_script = find_worker_script()?;
            let model_cache = data_dir.join("models").join("parakeet");
            let _ = tokio::fs::create_dir_all(&model_cache).await;

            info!(
                python = %python.display(),
                script = %worker_script.display(),
                cache = %model_cache.display(),
                "Spawning persistent STT worker"
            );

            let mut child = Command::new(&python)
                .arg(&worker_script)
                .arg(&model_cache)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .map_err(|e| anyhow::anyhow!("Failed to spawn STT worker: {}", e))?;

            let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("No stdin"))?;
            let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("No stdout"))?;

            // Drain stderr on a background task so it doesn't block
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    let reader = BufReader::new(stderr);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if !line.trim().is_empty() {
                            debug!(target: "stt_worker_stderr", "{}", line);
                        }
                    }
                });
            }

            let mut stdout_reader = BufReader::new(stdout);

            // Wait for {"ready": true} from the worker
            let mut line_buf = String::new();
            let ready = tokio::time::timeout(
                std::time::Duration::from_secs(STARTUP_TIMEOUT_SECS),
                stdout_reader.read_line(&mut line_buf),
            )
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "STT worker timed out after {}s loading model — is onnx-asr installed in the Python venv?",
                    STARTUP_TIMEOUT_SECS
                )
            })?
            .map_err(|e| anyhow::anyhow!("STT worker stdout read error: {}", e))?;

            if ready == 0 {
                anyhow::bail!("STT worker closed stdout before sending ready signal");
            }

            let parsed: serde_json::Value = serde_json::from_str(line_buf.trim())
                .map_err(|e| anyhow::anyhow!("STT worker sent invalid JSON: {} (line: {})", e, line_buf.trim()))?;

            if let Some(err) = parsed.get("error") {
                anyhow::bail!("STT worker failed to start: {}", err);
            }

            if parsed.get("ready").and_then(|v| v.as_bool()) != Some(true) {
                anyhow::bail!("STT worker sent unexpected first message: {}", line_buf.trim());
            }

            info!("Parakeet STT worker ready (model loaded)");

            Ok(Self {
                worker_stdin: Mutex::new(Some(stdin)),
                worker_stdout: Mutex::new(Some(stdout_reader)),
                _child: Mutex::new(Some(child)),
            })
        }
    }

    impl SttEngine for ParakeetStt {
        async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
            if audio.len() < MIN_SAMPLES {
                return Ok(String::new());
            }

            // Write audio to a temporary WAV file
            let tmp_dir = std::env::temp_dir();
            let wav_path = tmp_dir.join(format!("vmr-parakeet-{}.wav", uuid::Uuid::new_v4()));
            let wav_bytes = encode_wav(audio, 16_000);
            tokio::fs::write(&wav_path, &wav_bytes).await?;

            debug!(
                wav = %wav_path.display(),
                bytes = wav_bytes.len(),
                duration_secs = audio.len() as f64 / 16000.0,
                "Sending WAV to STT worker"
            );

            // Send request to worker
            let request = serde_json::json!({
                "wav": wav_path.to_string_lossy()
            });
            let mut request_line = serde_json::to_string(&request)?;
            request_line.push('\n');

            // Take handles out of Mutex so we can use them across await points
            // (MutexGuard is !Send so it can't be held across .await)
            let mut stdin_opt = self.worker_stdin.lock().unwrap().take();
            let mut stdout_opt = self.worker_stdout.lock().unwrap().take();

            let result = async {
                let stdin = stdin_opt.as_mut().ok_or_else(|| anyhow::anyhow!("STT worker stdin unavailable"))?;
                let stdout = stdout_opt.as_mut().ok_or_else(|| anyhow::anyhow!("STT worker stdout unavailable"))?;

                stdin.write_all(request_line.as_bytes()).await?;
                stdin.flush().await?;

                // Read response with timeout
                let mut response_line = String::new();
                let bytes_read = tokio::time::timeout(
                    std::time::Duration::from_secs(TRANSCRIBE_TIMEOUT_SECS),
                    stdout.read_line(&mut response_line),
                )
                .await
                .map_err(|_| anyhow::anyhow!("STT worker timed out after {}s", TRANSCRIBE_TIMEOUT_SECS))?
                .map_err(|e| anyhow::anyhow!("STT worker read error: {}", e))?;

                if bytes_read == 0 {
                    anyhow::bail!("STT worker closed stdout unexpectedly");
                }

                let parsed: serde_json::Value = serde_json::from_str(response_line.trim())
                    .map_err(|e| anyhow::anyhow!("STT worker invalid JSON response: {}", e))?;

                if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
                    anyhow::bail!("STT worker error: {}", err);
                }

                let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                Ok::<String, anyhow::Error>(text)
            }
            .await;

            // Put handles back
            *self.worker_stdin.lock().unwrap() = stdin_opt;
            *self.worker_stdout.lock().unwrap() = stdout_opt;

            // Clean up temp file
            let _ = tokio::fs::remove_file(&wav_path).await;

            result
        }
    }

    /// Find the Python executable in the bundled venv.
    fn find_python() -> anyhow::Result<PathBuf> {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));

        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Some(ref exe) = exe_dir {
            let project_root = exe.join("..").join("..").join("..");
            #[cfg(target_os = "windows")]
            candidates.push(project_root.join("python").join(".venv").join("Scripts").join("python.exe"));
            #[cfg(not(target_os = "windows"))]
            candidates.push(project_root.join("python").join(".venv").join("bin").join("python3"));
        }

        // Also check system Python
        #[cfg(target_os = "windows")]
        candidates.push(PathBuf::from("python"));
        #[cfg(not(target_os = "windows"))]
        candidates.push(PathBuf::from("python3"));

        for candidate in &candidates {
            if candidate.exists() {
                debug!(path = %candidate.display(), "Found Python");
                return Ok(candidate.clone());
            }
            // For bare command names, try which-style resolution
            if !candidate.is_absolute() {
                return Ok(candidate.clone());
            }
        }

        anyhow::bail!("Python not found — needed for Parakeet STT worker")
    }

    /// Find the stt-worker.py script.
    fn find_worker_script() -> anyhow::Result<PathBuf> {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));

        if let Some(ref exe) = exe_dir {
            // Dev layout: binary in voice-core/target/release/
            // Script at voice-core/stt-worker.py
            let mut dir = Some(exe.as_path());
            for _ in 0..5 {
                if let Some(d) = dir {
                    let script = d.join("stt-worker.py");
                    if script.exists() {
                        return Ok(script);
                    }
                    dir = d.parent();
                }
            }

            // Also check packaged location
            let packaged = exe.join("stt-worker.py");
            if packaged.exists() {
                return Ok(packaged);
            }
        }

        anyhow::bail!("stt-worker.py not found")
    }

    /// Encode f32 audio samples as 16-bit PCM WAV bytes (16 kHz mono).
    fn encode_wav(audio: &[f32], sample_rate: u32) -> Vec<u8> {
        let num_samples = audio.len() as u32;
        let bytes_per_sample: u16 = 2;
        let num_channels: u16 = 1;
        let data_size = num_samples * bytes_per_sample as u32;
        let file_size = 36 + data_size;

        let mut buf = Vec::with_capacity(44 + data_size as usize);

        // RIFF header
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&file_size.to_le_bytes());
        buf.extend_from_slice(b"WAVE");

        // fmt sub-chunk
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
        buf.extend_from_slice(&num_channels.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        let byte_rate = sample_rate * num_channels as u32 * bytes_per_sample as u32;
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        let block_align = num_channels * bytes_per_sample;
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&(bytes_per_sample * 8).to_le_bytes());

        // data sub-chunk
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_size.to_le_bytes());
        for &sample in audio {
            let clamped = sample.clamp(-1.0, 1.0);
            let pcm = (clamped * 32767.0) as i16;
            buf.extend_from_slice(&pcm.to_le_bytes());
        }

        buf
    }
}

// ── onnx disabled (stub) ─────────────────────────────────────────
#[cfg(not(feature = "onnx"))]
mod inner {
    use std::path::Path;

    use tracing::warn;

    use crate::stt::SttEngine;

    pub struct ParakeetStt;

    impl ParakeetStt {
        pub async fn new(_data_dir: &Path) -> anyhow::Result<Self> {
            warn!("Parakeet STT requested but onnx feature is disabled");
            anyhow::bail!(
                "Parakeet STT is not available (compile with --features onnx)"
            )
        }
    }

    impl SttEngine for ParakeetStt {
        async fn transcribe(&self, _audio: &[f32]) -> anyhow::Result<String> {
            anyhow::bail!("Parakeet STT is not available (compile with --features onnx)")
        }
    }
}

pub use inner::ParakeetStt;
