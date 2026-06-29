//! Kokoro TTS engine (local ONNX inference).
//!
//! Two variants: real ONNX inference behind `#[cfg(feature = "onnx")]`,
//! and a simple stub when the feature is disabled. The stub preserves
//! the existing test-compatible API (new(voice, speed) -> Self).

// ── Kokoro TTS (real ONNX implementation) ───────────────────────────
#[cfg(feature = "onnx")]
mod inner {
    use std::collections::HashMap;
    use std::io::{Cursor, Read as _};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use byteorder::{LittleEndian, ReadBytesExt};
    use tracing::{debug, info, warn};

    use crate::voice::tts::{TtsEngine, TtsError};

    const SAMPLE_RATE: u32 = 22050;
    /// Kokoro model context length minus 2 (for start/end pad tokens).
    const MAX_PHONEME_TOKENS: usize = 510;
    /// Style embedding dimension.
    const STYLE_DIM: usize = 256;

    /// Per-voice style embeddings: maps voice name -> flat f32 array of shape (N, 1, 256).
    struct VoiceData {
        /// Raw f32 data, length = num_entries * STYLE_DIM
        data: Vec<f32>,
        /// Number of style entries (== data.len() / STYLE_DIM)
        num_entries: usize,
    }

    impl VoiceData {
        /// Get the style vector for a given token count. Shape: (1, 256).
        fn style_for_len(&self, token_count: usize) -> Result<Vec<f32>, TtsError> {
            if self.num_entries == 0 {
                return Err(TtsError::SynthesisError(
                    "Voice style data is empty".into(),
                ));
            }
            let idx = token_count.min(self.num_entries - 1);
            let start = idx * STYLE_DIM;
            Ok(self.data[start..start + STYLE_DIM].to_vec())
        }
    }

    /// Local Kokoro ONNX TTS engine.
    ///
    /// Loads an ONNX model and voice embeddings from disk, then runs
    /// inference to synthesize speech from text via espeak-ng phonemes.
    pub struct KokoroTts {
        voice: Mutex<String>,
        speed: f32,
        cancelled: Arc<AtomicBool>,
        session: Mutex<ort::session::Session>,
        voices: HashMap<String, VoiceData>,
        vocab: HashMap<char, i64>,
    }

    // SAFETY: ort::Session is Send but not Sync by default; we protect it
    // with a Mutex so only one thread runs inference at a time.
    unsafe impl Sync for KokoroTts {}

    impl KokoroTts {
        /// Create a new Kokoro TTS engine loading model from `model_dir`.
        ///
        /// Expected files:
        /// - `{model_dir}/kokoro-v1.0.onnx` -- ONNX model
        /// - `{model_dir}/voices-v1.0.bin` -- Voice embeddings (NPZ)
        pub fn new(model_dir: &Path, voice: &str, speed: f32) -> Result<Self, TtsError> {
            let model_path = model_dir.join("kokoro-v1.0.onnx");
            let voices_path = model_dir.join("voices-v1.0.bin");

            if !model_path.exists() {
                return Err(TtsError::SynthesisError(format!(
                    "Kokoro model not found: {}. Download from HuggingFace.",
                    model_path.display()
                )));
            }
            if !voices_path.exists() {
                return Err(TtsError::SynthesisError(format!(
                    "Kokoro voices not found: {}. Download from HuggingFace.",
                    voices_path.display()
                )));
            }

            let session = ort::session::Session::builder()
                .map_err(|e| {
                    TtsError::SynthesisError(format!("ONNX session builder failed: {}", e))
                })?
                .commit_from_file(&model_path)
                .map_err(|e| {
                    TtsError::SynthesisError(format!("ONNX model load failed: {}", e))
                })?;

            let voices = load_voices_npz(&voices_path)?;
            info!(
                model = %model_path.display(),
                voices = voices.len(),
                "Kokoro TTS model loaded"
            );

            let vocab = build_vocab();

            Ok(Self {
                voice: Mutex::new(voice.to_string()),
                speed,
                cancelled: Arc::new(AtomicBool::new(false)),
                session: Mutex::new(session),
                voices,
                vocab,
            })
        }

        /// Change the active voice.
        pub fn set_voice(&mut self, voice: &str) {
            match self.voice.lock() {
                Ok(mut g) => *g = voice.to_string(),
                Err(e) => warn!("voice mutex poisoned in set_voice: {e}"),
            }
        }

        /// Change the playback speed.
        pub fn set_speed(&mut self, speed: f32) {
            self.speed = speed;
        }

        /// Find espeak-ng executable.
        fn find_espeak_ng() -> Option<(PathBuf, Option<PathBuf>)> {
            // 1. Check if espeak-ng is on PATH
            let mut version_cmd = Command::new("espeak-ng");
            version_cmd.arg("--version");
            crate::util::hidden(&mut version_cmd);
            if let Ok(output) = version_cmd.output() {
                if output.status.success() {
                    return Some((PathBuf::from("espeak-ng"), None));
                }
            }

            // 2. Check bundled location relative to current exe
            if let Ok(exe_path) = std::env::current_exe() {
                let mut dir = exe_path.parent();
                for _ in 0..5 {
                    if let Some(d) = dir {
                        let tools_dir = d.join("tools").join("espeak-ng");
                        let tools_exe = tools_dir.join("espeak-ng.exe");
                        if tools_exe.exists() {
                            return Some((tools_exe, Some(tools_dir)));
                        }
                        dir = d.parent();
                    }
                }
            }

            // 3. Check packaged location: resources/bin/espeak-ng/
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    let pkg_dir = exe_dir.join("espeak-ng");
                    let packaged = pkg_dir.join("espeak-ng.exe");
                    if packaged.exists() {
                        return Some((packaged, Some(pkg_dir)));
                    }
                }
            }

            None
        }

        /// Convert text to IPA phonemes using espeak-ng CLI.
        fn phonemize(text: &str, lang: &str) -> Result<String, TtsError> {
            let (espeak_bin, data_path) = Self::find_espeak_ng().ok_or_else(|| {
                TtsError::SynthesisError(
                    "espeak-ng not found. Install espeak-ng or place it in tools/espeak-ng/"
                        .into(),
                )
            })?;

            let mut cmd = Command::new(&espeak_bin);
            cmd.args(["--ipa", "-q", "-v", lang]).arg(text);

            if let Some(ref data) = data_path {
                cmd.env("ESPEAK_DATA_PATH", data);
            }

            crate::util::hidden(&mut cmd);
            match cmd.output() {
                Ok(out) if out.status.success() => {
                    let phonemes = String::from_utf8_lossy(&out.stdout)
                        .trim()
                        .replace('\n', " ")
                        .replace("  ", " ");
                    Ok(phonemes)
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    Err(TtsError::SynthesisError(format!(
                        "espeak-ng failed: {}",
                        stderr.trim()
                    )))
                }
                Err(e) => Err(TtsError::SynthesisError(format!(
                    "espeak-ng at {} failed to execute: {}",
                    espeak_bin.display(),
                    e
                ))),
            }
        }

        /// Convert IPA phoneme string to token IDs.
        fn tokenize(&self, phonemes: &str) -> Vec<i64> {
            phonemes
                .chars()
                .filter_map(|c| self.vocab.get(&c).copied())
                .collect()
        }

        /// Run inference for a single chunk of tokens.
        fn infer_chunk(
            &self,
            tokens: &[i64],
            voice_data: &VoiceData,
        ) -> Result<Vec<f32>, TtsError> {
            let token_count = tokens.len();
            let style = voice_data.style_for_len(token_count)?;

            // Pad with 0 at start and end: [0, ...tokens, 0]
            let mut padded = Vec::with_capacity(token_count + 2);
            padded.push(0i64);
            padded.extend_from_slice(tokens);
            padded.push(0i64);

            let input_len = padded.len();

            let input_ids = ort::value::Tensor::from_array((
                vec![1i64, input_len as i64],
                padded.into_boxed_slice(),
            ))
            .map_err(|e| {
                TtsError::SynthesisError(format!("ONNX input tensor failed: {}", e))
            })?;

            let style_tensor = ort::value::Tensor::from_array((
                vec![1i64, STYLE_DIM as i64],
                style.into_boxed_slice(),
            ))
            .map_err(|e| {
                TtsError::SynthesisError(format!("ONNX style tensor failed: {}", e))
            })?;

            let speed_tensor = ort::value::Tensor::from_array((
                vec![1i64],
                vec![self.speed].into_boxed_slice(),
            ))
            .map_err(|e| {
                TtsError::SynthesisError(format!("ONNX speed tensor failed: {}", e))
            })?;

            let mut session = self.session.lock().map_err(|e| {
                TtsError::SynthesisError(format!("session mutex poisoned: {e}"))
            })?;
            let outputs = session
                .run(ort::inputs! {
                    "tokens" => input_ids,
                    "style" => style_tensor,
                    "speed" => speed_tensor
                })
                .map_err(|e| {
                    TtsError::SynthesisError(format!("ONNX inference failed: {}", e))
                })?;

            let audio_value = &outputs[0];
            let (_shape, audio_data) = audio_value
                .try_extract_tensor::<f32>()
                .map_err(|e| {
                    TtsError::SynthesisError(format!(
                        "ONNX output extraction failed: {}",
                        e
                    ))
                })?;
            Ok(audio_data.to_vec())
        }
    }

    impl TtsEngine for KokoroTts {
        fn synthesize(
            &self,
            text: &str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<f32>, TtsError>> + Send + '_>,
        > {
            let text = text.to_string();
            Box::pin(async move {
                self.cancelled.store(false, Ordering::SeqCst);

                if text.trim().is_empty() {
                    return Ok(Vec::new());
                }

                let voice_name = self.voice.lock()
                    .map_err(|e| TtsError::SynthesisError(format!("voice mutex poisoned: {e}")))?
                    .clone();

                let voice_data = self.voices.get(&voice_name).ok_or_else(|| {
                    TtsError::SynthesisError(format!("Unknown Kokoro voice: {}", voice_name))
                })?;

                // Detect language from voice prefix
                let lang = match voice_name.chars().next() {
                    Some('a') => "en-us",
                    Some('b') => "en-gb",
                    _ => "en-us",
                };

                let phonemes = Self::phonemize(&text, lang)?;
                let mut tokens = self.tokenize(&phonemes);

                if tokens.is_empty() {
                    return Err(TtsError::SynthesisError(
                        "No phoneme tokens for input text".into(),
                    ));
                }

                debug!(
                    phoneme_count = phonemes.len(),
                    token_count = tokens.len(),
                    "Phonemized"
                );

                let mut all_audio = Vec::new();
                const SPACE_TOKEN: i64 = 16;

                while !tokens.is_empty() {
                    if self.cancelled.load(Ordering::SeqCst) {
                        debug!("Kokoro synthesis interrupted");
                        break;
                    }

                    let chunk = if tokens.len() <= MAX_PHONEME_TOKENS {
                        std::mem::take(&mut tokens)
                    } else {
                        let search_end = MAX_PHONEME_TOKENS;
                        let split_at = tokens[..search_end]
                            .iter()
                            .rposition(|&t| t == SPACE_TOKEN)
                            .map(|p| p + 1)
                            .unwrap_or(search_end);
                        tokens.drain(..split_at).collect()
                    };

                    let audio = self.infer_chunk(&chunk, voice_data)?;
                    all_audio.extend_from_slice(&audio);
                }

                if all_audio.is_empty() {
                    return Err(TtsError::SynthesisError(
                        "No audio generated for input text".into(),
                    ));
                }

                info!(
                    samples = all_audio.len(),
                    duration_secs = all_audio.len() as f64 / SAMPLE_RATE as f64,
                    "Kokoro synthesis complete"
                );

                Ok(all_audio)
            })
        }

        fn stop(&self) {
            self.cancelled.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            let voice = match self.voice.lock() {
                Ok(g) => g.clone(),
                Err(_) => "unknown".to_string(),
            };
            format!("Kokoro ({})", voice)
        }

        fn sample_rate(&self) -> u32 {
            SAMPLE_RATE
        }
    }

    /// Load voice embeddings from an NPZ file (ZIP of .npy arrays).
    fn load_voices_npz(path: &Path) -> Result<HashMap<String, VoiceData>, TtsError> {
        let file = std::fs::File::open(path).map_err(|e| {
            TtsError::SynthesisError(format!("Failed to open voices file: {}", e))
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            TtsError::SynthesisError(format!("Failed to read voices NPZ: {}", e))
        })?;
        let mut voices = HashMap::new();

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| {
                TtsError::SynthesisError(format!("NPZ entry read failed: {}", e))
            })?;
            let name = entry.name().to_string();

            let voice_name = name.strip_suffix(".npy").unwrap_or(&name).to_string();

            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| {
                TtsError::SynthesisError(format!("NPZ entry decompress failed: {}", e))
            })?;

            let data = parse_npy_f32(&buf)?;
            let num_entries = data.len() / STYLE_DIM;
            if data.len() % STYLE_DIM != 0 {
                warn!(
                    voice = %voice_name,
                    len = data.len(),
                    "Voice data not evenly divisible by style dim, skipping"
                );
                continue;
            }

            voices.insert(voice_name, VoiceData { data, num_entries });
        }

        Ok(voices)
    }

    /// Parse a .npy file (NumPy array format) containing float32 data.
    fn parse_npy_f32(data: &[u8]) -> Result<Vec<f32>, TtsError> {
        let mut cursor = Cursor::new(data);

        let mut magic = [0u8; 6];
        cursor.read_exact(&mut magic).map_err(|e| {
            TtsError::SynthesisError(format!("NPY read magic failed: {}", e))
        })?;
        if &magic != b"\x93NUMPY" {
            return Err(TtsError::SynthesisError(
                "Invalid NPY magic number".into(),
            ));
        }

        let major = cursor.read_u8().map_err(|e| {
            TtsError::SynthesisError(format!("NPY read version failed: {}", e))
        })?;
        let _minor = cursor.read_u8().map_err(|e| {
            TtsError::SynthesisError(format!("NPY read version failed: {}", e))
        })?;

        let header_len = if major >= 2 {
            cursor
                .read_u32::<LittleEndian>()
                .map_err(|e| {
                    TtsError::SynthesisError(format!("NPY read header len failed: {}", e))
                })? as usize
        } else {
            cursor
                .read_u16::<LittleEndian>()
                .map_err(|e| {
                    TtsError::SynthesisError(format!("NPY read header len failed: {}", e))
                })? as usize
        };

        let mut header_bytes = vec![0u8; header_len];
        cursor.read_exact(&mut header_bytes).map_err(|e| {
            TtsError::SynthesisError(format!("NPY read header failed: {}", e))
        })?;

        let header_str = String::from_utf8_lossy(&header_bytes);
        if !header_str.contains("<f4") && !header_str.contains("float32") {
            if header_str.contains(">f4") {
                return Err(TtsError::SynthesisError(
                    "Big-endian float32 not supported".into(),
                ));
            }
            warn!(header = %header_str, "NPY header doesn't clearly indicate float32");
        }

        let remaining = data.len() - cursor.position() as usize;
        let num_floats = remaining / 4;
        let mut result = Vec::with_capacity(num_floats);
        for _ in 0..num_floats {
            result.push(cursor.read_f32::<LittleEndian>().map_err(|e| {
                TtsError::SynthesisError(format!("NPY read f32 failed: {}", e))
            })?);
        }

        Ok(result)
    }

    /// Build the phoneme-to-token-ID vocabulary.
    /// Extracted from kokoro-onnx's config.json DEFAULT_VOCAB (88 entries).
    fn build_vocab() -> HashMap<char, i64> {
        let entries: &[(char, i64)] = &[
            (';', 1),
            (':', 2),
            (',', 3),
            ('.', 4),
            ('!', 5),
            ('?', 6),
            ('\u{2014}', 9),  // em dash
            ('\u{2026}', 10), // ellipsis
            ('"', 11),
            ('(', 12),
            (')', 13),
            ('\u{201c}', 14), // left double quote
            ('\u{201d}', 15), // right double quote
            (' ', 16),
            ('\u{0303}', 17), // combining tilde
            ('\u{02a3}', 18),
            ('\u{02a5}', 19),
            ('\u{02a6}', 20),
            ('\u{02a8}', 21),
            ('\u{1d5d}', 22),
            ('\u{ab67}', 23),
            ('A', 24),
            ('I', 25),
            ('O', 31),
            ('Q', 33),
            ('S', 35),
            ('T', 36),
            ('W', 39),
            ('Y', 41),
            ('\u{1d4a}', 42),
            ('a', 43),
            ('b', 44),
            ('c', 45),
            ('d', 46),
            ('e', 47),
            ('f', 48),
            ('h', 50),
            ('i', 51),
            ('j', 52),
            ('k', 53),
            ('l', 54),
            ('m', 55),
            ('n', 56),
            ('o', 57),
            ('p', 58),
            ('q', 59),
            ('r', 60),
            ('s', 61),
            ('t', 62),
            ('u', 63),
            ('v', 64),
            ('w', 65),
            ('x', 66),
            ('y', 67),
            ('z', 68),
            ('\u{0251}', 69),
            ('\u{0250}', 70),
            ('\u{0252}', 71),
            ('\u{00e6}', 72),
            ('\u{03b2}', 75),
            ('\u{0254}', 76),
            ('\u{0255}', 77),
            ('\u{00e7}', 78),
            ('\u{0256}', 80),
            ('\u{00f0}', 81),
            ('\u{02a4}', 82),
            ('\u{0259}', 83),
            ('\u{025a}', 85),
            ('\u{025b}', 86),
            ('\u{025c}', 87),
            ('\u{025f}', 90),
            ('\u{0261}', 92),
            ('\u{0265}', 99),
            ('\u{0268}', 101),
            ('\u{026a}', 102),
            ('\u{029d}', 103),
            ('\u{026f}', 110),
            ('\u{0270}', 111),
            ('\u{014b}', 112),
            ('\u{0273}', 113),
            ('\u{0272}', 114),
            ('\u{0274}', 115),
            ('\u{00f8}', 116),
            ('\u{0278}', 118),
            ('\u{03b8}', 119),
            ('\u{0153}', 120),
            ('\u{0279}', 123),
            ('\u{027e}', 125),
            ('\u{027b}', 126),
            ('\u{0281}', 128),
            ('\u{027d}', 129),
            ('\u{0282}', 130),
            ('\u{0283}', 131),
            ('\u{0288}', 132),
            ('\u{02a7}', 133),
            ('\u{028a}', 135),
            ('\u{028b}', 136),
            ('\u{028c}', 138),
            ('\u{0263}', 139),
            ('\u{0264}', 140),
            ('\u{03c7}', 142),
            ('\u{028e}', 143),
            ('\u{0292}', 147),
            ('\u{0294}', 148),
            ('\u{02c8}', 156),
            ('\u{02cc}', 157),
            ('\u{02d0}', 158),
            ('\u{02b0}', 162),
            ('\u{02b2}', 164),
            ('\u{2193}', 169),
            ('\u{2192}', 171),
            ('\u{2197}', 172),
            ('\u{2198}', 173),
            ('\u{1d7b}', 177),
        ];
        entries.iter().copied().collect()
    }
}

// ── Kokoro TTS (stub when onnx feature disabled) ────────────────────
#[cfg(not(feature = "onnx"))]
mod inner {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use crate::voice::tts::{TtsEngine, TtsError};

    /// Local Kokoro ONNX TTS engine (stub).
    ///
    /// When compiled without the `onnx` feature, Kokoro TTS creates
    /// successfully but synthesis returns a short sine wave with a
    /// warning log. This keeps the engine factory and tests working.
    pub struct KokoroTts {
        /// Voice name (e.g., "af_bella", "am_michael").
        voice: String,
        /// Speed multiplier.
        speed: f32,
        /// Cancellation flag.
        cancelled: Arc<AtomicBool>,
    }

    impl KokoroTts {
        /// Create a new Kokoro TTS engine (stub mode).
        pub fn new(voice: &str, speed: f32) -> Self {
            tracing::info!(
                voice = %voice,
                speed = speed,
                "KokoroTts created (stub mode -- compile with --features onnx for real inference)"
            );
            Self {
                voice: voice.to_string(),
                speed,
                cancelled: Arc::new(AtomicBool::new(false)),
            }
        }

        /// Change the active voice.
        pub fn set_voice(&mut self, voice: &str) {
            self.voice = voice.to_string();
        }

        /// Change the playback speed.
        pub fn set_speed(&mut self, speed: f32) {
            self.speed = speed;
        }
    }

    impl TtsEngine for KokoroTts {
        fn synthesize(
            &self,
            text: &str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<f32>, TtsError>> + Send + '_>,
        > {
            let text = text.to_string();
            Box::pin(async move {
                if self.cancelled.load(Ordering::SeqCst) {
                    return Err(TtsError::Cancelled);
                }

                if text.trim().is_empty() {
                    return Ok(Vec::new());
                }

                tracing::warn!(
                    voice = %self.voice,
                    speed = %self.speed,
                    text_len = text.len(),
                    "KokoroTts.synthesize() called (stub -- compile with --features onnx)"
                );

                // Stub: generate a short sine wave
                let sample_rate = 22050;
                let duration_secs = 0.1_f32;
                let frequency = 523.25_f32; // C5 note
                let num_samples = (sample_rate as f32 * duration_secs) as usize;
                let samples: Vec<f32> = (0..num_samples)
                    .map(|i| {
                        let t = i as f32 / sample_rate as f32;
                        (2.0 * std::f32::consts::PI * frequency * t).sin() * 0.3
                    })
                    .collect();

                Ok(samples)
            })
        }

        fn stop(&self) {
            self.cancelled.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            format!("Kokoro ({}) [stub]", self.voice)
        }

        fn sample_rate(&self) -> u32 {
            22050
        }
    }
}

pub use inner::KokoroTts;
