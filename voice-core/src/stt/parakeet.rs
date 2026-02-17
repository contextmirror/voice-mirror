//! Parakeet ONNX STT via the `onnx-asr` CLI.
//!
//! Shells out to `onnx-asr nemo-parakeet-tdt-0.6b-v2 <wav_file>` for
//! transcription.  The CLI is provided by the `onnx_asr` Python package
//! (installed in the bundled Python venv).
//!
//! When the `onnx` feature is disabled a stub is provided that always
//! returns an error, mirroring the pattern used by the whisper adapter.

// ── onnx enabled ─────────────────────────────────────────────────
#[cfg(feature = "onnx")]
mod inner {
    use std::path::{Path, PathBuf};

    use tokio::process::Command;
    use tracing::{debug, info, warn};

    use crate::stt::SttEngine;

    const MODEL_NAME: &str = "nemo-parakeet-tdt-0.6b-v2";

    /// Minimum audio duration in samples at 16 kHz (0.4 s = 6400 samples).
    const MIN_SAMPLES: usize = 6_400;

    pub struct ParakeetStt {
        /// Resolved path to the `onnx-asr` executable.
        cli_path: PathBuf,
        /// Optional model cache directory (`-p` flag).
        model_cache: Option<PathBuf>,
    }

    impl ParakeetStt {
        /// Create a new Parakeet adapter.
        ///
        /// `data_dir` is the Voice Mirror data directory.  We look for the
        /// `onnx-asr` CLI in the bundled Python venv first, then fall back to
        /// `PATH`.
        pub fn new(data_dir: &Path) -> anyhow::Result<Self> {
            let cli_path = find_onnx_asr_cli(data_dir)?;
            let model_cache = data_dir.join("models").join("parakeet");
            info!(cli = %cli_path.display(), "Parakeet STT adapter ready");
            Ok(Self {
                cli_path,
                model_cache: Some(model_cache),
            })
        }
    }

    impl SttEngine for ParakeetStt {
        async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
            if audio.len() < MIN_SAMPLES {
                return Ok(String::new());
            }

            // Write audio to a temporary WAV file.
            let tmp_dir = std::env::temp_dir();
            let wav_path = tmp_dir.join(format!("vmr-parakeet-{}.wav", uuid::Uuid::new_v4()));
            let wav_bytes = encode_wav(audio, 16_000);
            tokio::fs::write(&wav_path, &wav_bytes).await?;

            debug!(
                wav = %wav_path.display(),
                bytes = wav_bytes.len(),
                "Invoking onnx-asr CLI"
            );

            let mut cmd = Command::new(&self.cli_path);
            cmd.arg(MODEL_NAME);
            if let Some(cache) = &self.model_cache {
                // Ensure the cache directory exists.
                let _ = tokio::fs::create_dir_all(cache).await;
                cmd.arg("-p").arg(cache);
            }
            cmd.arg(&wav_path);

            let output = cmd.output().await.map_err(|e| {
                anyhow::anyhow!("Failed to run onnx-asr CLI at {}: {}", self.cli_path.display(), e)
            })?;

            // Clean up temp file (best-effort).
            let _ = tokio::fs::remove_file(&wav_path).await;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                anyhow::bail!("onnx-asr exited with {}: {}", output.status, stderr.trim());
            }

            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(text)
        }
    }

    /// Locate the `onnx-asr` CLI executable.
    ///
    /// Search order:
    /// 1. Bundled Python venv: `<project>/python/.venv/Scripts/onnx-asr.exe`
    ///    (Windows) or `<project>/python/.venv/bin/onnx-asr` (Unix).
    /// 2. System PATH.
    fn find_onnx_asr_cli(data_dir: &Path) -> anyhow::Result<PathBuf> {
        // The project root is two levels above data_dir in a typical install:
        //   <appdata>/voice-mirror-electron/data  ->  project is elsewhere.
        // But we also check relative to the executable's location.
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));

        // Candidate paths for the bundled venv CLI.
        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Some(ref exe) = exe_dir {
            // Typical dev layout: voice-core binary is in target/debug or target/release,
            // python venv is at ../../python/.venv
            let project_root = exe.join("..").join("..").join("..");
            #[cfg(target_os = "windows")]
            candidates.push(project_root.join("python").join(".venv").join("Scripts").join("onnx-asr.exe"));
            #[cfg(not(target_os = "windows"))]
            candidates.push(project_root.join("python").join(".venv").join("bin").join("onnx-asr"));
        }

        // Also check a venv alongside data_dir (production installs may place it here).
        #[cfg(target_os = "windows")]
        candidates.push(data_dir.join("python").join(".venv").join("Scripts").join("onnx-asr.exe"));
        #[cfg(not(target_os = "windows"))]
        candidates.push(data_dir.join("python").join(".venv").join("bin").join("onnx-asr"));

        for candidate in &candidates {
            let canonical = candidate.canonicalize().ok();
            if let Some(ref p) = canonical {
                if p.exists() {
                    debug!(path = %p.display(), "Found bundled onnx-asr CLI");
                    return Ok(p.clone());
                }
            }
            // Also try without canonicalize (in case of symlink issues)
            if candidate.exists() {
                debug!(path = %candidate.display(), "Found bundled onnx-asr CLI");
                return Ok(candidate.clone());
            }
        }

        // Fall back: let the OS resolve it from PATH at runtime.
        #[cfg(target_os = "windows")]
        let name = "onnx-asr.exe";
        #[cfg(not(target_os = "windows"))]
        let name = "onnx-asr";

        warn!("onnx-asr CLI not found in bundled venv; will try bare command name on PATH");
        Ok(PathBuf::from(name))
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
        pub fn new(_data_dir: &Path) -> anyhow::Result<Self> {
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
