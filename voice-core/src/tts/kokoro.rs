//! Kokoro ONNX local TTS engine.
//!
//! The real implementation is gated behind `#[cfg(feature = "onnx")]`.
//! When the feature is disabled, a stub is provided that always returns an error.

use super::TtsEngine;

// ── onnx enabled ────────────────────────────────────────────────
#[cfg(feature = "onnx")]
mod inner {
    use std::collections::HashMap;
    use std::future::Future;
    use std::io::{Cursor, Read as _};
    use std::path::{Path, PathBuf};
    use std::pin::Pin;
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use byteorder::{LittleEndian, ReadBytesExt};
    use tracing::{debug, info, warn};

    use super::TtsEngine;

    const SAMPLE_RATE: u32 = 24000;
    /// Kokoro model context length minus 2 (for start/end pad tokens).
    const MAX_PHONEME_TOKENS: usize = 510;
    /// Style embedding dimension.
    const STYLE_DIM: usize = 256;

    /// Per-voice style embeddings: maps voice name -> flat f32 array of shape (N, 1, 256).
    /// Index by token count to get the style vector for that length.
    struct VoiceData {
        /// Raw f32 data, length = num_entries * STYLE_DIM
        data: Vec<f32>,
        /// Number of style entries (== data.len() / STYLE_DIM)
        num_entries: usize,
    }

    impl VoiceData {
        /// Get the style vector for a given token count. Shape: (1, 256).
        fn style_for_len(&self, token_count: usize) -> anyhow::Result<Vec<f32>> {
            if token_count >= self.num_entries {
                anyhow::bail!(
                    "Token count {} exceeds voice style entries ({})",
                    token_count,
                    self.num_entries
                );
            }
            let start = token_count * STYLE_DIM;
            Ok(self.data[start..start + STYLE_DIM].to_vec())
        }
    }

    pub struct KokoroTts {
        #[allow(dead_code)]
        model_dir: PathBuf,
        voice: Mutex<String>,
        interrupted: AtomicBool,
        session: Mutex<ort::session::Session>,
        voices: HashMap<String, VoiceData>,
        vocab: HashMap<char, i64>,
    }

    impl KokoroTts {
        pub fn new(model_dir: &Path) -> anyhow::Result<Self> {
            let model_path = model_dir.join("kokoro-v1.0.onnx");
            let voices_path = model_dir.join("voices-v1.0.bin");

            if !model_path.exists() {
                anyhow::bail!(
                    "Kokoro model not found: {}. Download from HuggingFace.",
                    model_path.display()
                );
            }
            if !voices_path.exists() {
                anyhow::bail!(
                    "Kokoro voices not found: {}. Download from HuggingFace.",
                    voices_path.display()
                );
            }

            let session = ort::session::Session::builder()?
                .commit_from_file(&model_path)?;

            let voices = load_voices_npz(&voices_path)?;
            info!(
                model = %model_path.display(),
                voices = voices.len(),
                "Kokoro TTS model loaded"
            );

            let vocab = build_vocab();

            Ok(Self {
                model_dir: model_dir.to_path_buf(),
                voice: Mutex::new("af_bella".to_string()),
                interrupted: AtomicBool::new(false),
                session: Mutex::new(session),
                voices,
                vocab,
            })
        }

        pub fn set_voice(&mut self, voice: &str) {
            *self.voice.lock().unwrap() = voice.to_string();
        }

        /// Find espeak-ng executable.
        /// Checks: PATH first, then bundled tools/espeak-ng/ relative to the binary.
        fn find_espeak_ng() -> Option<(PathBuf, Option<PathBuf>)> {
            // 1. Check if espeak-ng is on PATH
            if let Ok(output) = Command::new("espeak-ng").arg("--version").output() {
                if output.status.success() {
                    return Some((PathBuf::from("espeak-ng"), None));
                }
            }

            // 2. Check bundled location: relative to current exe
            //    Binary is at <project>/voice-core/target/release/voice-core.exe
            //    Tools are at <project>/tools/espeak-ng/espeak-ng.exe
            //    ESPEAK_DATA_PATH should point to the dir *containing* espeak-ng-data/
            if let Ok(exe_path) = std::env::current_exe() {
                // Walk up from binary to find project root
                let mut dir = exe_path.parent();
                for _ in 0..5 {
                    if let Some(d) = dir {
                        let tools_dir = d.join("tools").join("espeak-ng");
                        let tools_exe = tools_dir.join("espeak-ng.exe");
                        if tools_exe.exists() {
                            // ESPEAK_DATA_PATH = parent of espeak-ng-data (i.e. tools/espeak-ng/)
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
        fn phonemize(text: &str, lang: &str) -> anyhow::Result<String> {
            let (espeak_bin, data_path) = Self::find_espeak_ng().ok_or_else(|| {
                anyhow::anyhow!(
                    "espeak-ng not found. Install espeak-ng or place it in tools/espeak-ng/"
                )
            })?;

            let mut cmd = Command::new(&espeak_bin);
            cmd.args(["--ipa", "-q", "-v", lang]).arg(text);

            // Set ESPEAK_DATA_PATH if we found bundled data
            if let Some(ref data) = data_path {
                cmd.env("ESPEAK_DATA_PATH", data);
            }

            let output = cmd.output();

            match output {
                Ok(out) if out.status.success() => {
                    let phonemes = String::from_utf8_lossy(&out.stdout)
                        .trim()
                        .replace('\n', " ")
                        .replace("  ", " ");
                    Ok(phonemes)
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    anyhow::bail!("espeak-ng failed: {}", stderr.trim());
                }
                Err(e) => {
                    anyhow::bail!(
                        "espeak-ng at {} failed to execute: {}",
                        espeak_bin.display(),
                        e
                    );
                }
            }
        }

        /// Convert IPA phoneme string to token IDs, filtering through vocab.
        fn tokenize(&self, phonemes: &str) -> Vec<i64> {
            phonemes
                .chars()
                .filter_map(|c| self.vocab.get(&c).copied())
                .collect()
        }

        /// Split text into sentences at punctuation boundaries.
        fn split_sentences(text: &str) -> Vec<String> {
            let mut sentences = Vec::new();
            let mut current = String::new();

            for ch in text.chars() {
                current.push(ch);
                if matches!(ch, '.' | '!' | '?' | ';') {
                    let trimmed = current.trim().to_string();
                    if !trimmed.is_empty() {
                        sentences.push(trimmed);
                    }
                    current.clear();
                }
            }

            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }

            sentences
        }

        /// Run inference for a single chunk of tokens.
        fn infer_chunk(
            &self,
            tokens: &[i64],
            voice_data: &VoiceData,
        ) -> anyhow::Result<Vec<f32>> {
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
            ))?;
            let style_tensor = ort::value::Tensor::from_array((
                vec![1i64, STYLE_DIM as i64],
                style.into_boxed_slice(),
            ))?;
            let speed_tensor = ort::value::Tensor::from_array((
                vec![1i64],
                vec![1.0f32].into_boxed_slice(),
            ))?;

            let mut session = self.session.lock().unwrap();
            let outputs = session.run(ort::inputs! {
                "tokens" => input_ids,
                "style" => style_tensor,
                "speed" => speed_tensor
            })?;

            let audio_value = &outputs[0];
            let (_shape, audio_data) = audio_value.try_extract_tensor::<f32>()?;
            Ok(audio_data.to_vec())
        }
    }

    impl TtsEngine for KokoroTts {
        fn speak(
            &self,
            text: &str,
        ) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
            let text = text.to_string();
            Box::pin(async move {
                self.interrupted.store(false, Ordering::SeqCst);
                let voice_name = self.voice.lock().unwrap().clone();

                let voice_data = self
                    .voices
                    .get(&voice_name)
                    .ok_or_else(|| anyhow::anyhow!("Unknown voice: {}", voice_name))?;

                // Detect language from voice prefix
                let lang = match voice_name.chars().next() {
                    Some('a') => "en-us",
                    Some('b') => "en-gb",
                    _ => "en-us",
                };

                let sentences = Self::split_sentences(&text);
                let mut all_audio = Vec::new();

                /// Silence gap between sentences (150ms at 24kHz).
                const SENTENCE_GAP_SAMPLES: usize = 3600;

                for (i, sentence) in sentences.iter().enumerate() {
                    if self.interrupted.load(Ordering::SeqCst) {
                        debug!("Kokoro synthesis interrupted");
                        break;
                    }

                    let phonemes = Self::phonemize(sentence, lang)?;
                    let mut tokens = self.tokenize(&phonemes);

                    if tokens.is_empty() {
                        continue;
                    }

                    // Add silence gap between sentences (not before the first)
                    if i > 0 && !all_audio.is_empty() {
                        all_audio.extend(std::iter::repeat(0.0f32).take(SENTENCE_GAP_SAMPLES));
                    }

                    // Chunk tokens if exceeding max length
                    while !tokens.is_empty() {
                        if self.interrupted.load(Ordering::SeqCst) {
                            break;
                        }

                        let chunk_len = tokens.len().min(MAX_PHONEME_TOKENS);
                        let chunk: Vec<i64> = tokens.drain(..chunk_len).collect();
                        let audio = self.infer_chunk(&chunk, voice_data)?;
                        all_audio.extend_from_slice(&audio);
                    }
                }

                if all_audio.is_empty() {
                    anyhow::bail!("No audio generated for input text");
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
            self.interrupted.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            let voice = self.voice.lock().unwrap();
            format!("Kokoro ({})", voice)
        }
    }

    /// Load voice embeddings from an NPZ file (ZIP of .npy arrays).
    ///
    /// Each entry is named like "af_bella.npy" and contains a float32 array
    /// of shape (N, 1, 256).
    fn load_voices_npz(path: &Path) -> anyhow::Result<HashMap<String, VoiceData>> {
        let file = std::fs::File::open(path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        let mut voices = HashMap::new();

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let name = entry.name().to_string();

            // Strip .npy extension to get voice name
            let voice_name = name.strip_suffix(".npy").unwrap_or(&name).to_string();

            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;

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
    ///
    /// NPY format v1/v2:
    ///   - Magic: \x93NUMPY
    ///   - Major version: u8
    ///   - Minor version: u8
    ///   - Header length: u16 (v1) or u32 (v2)
    ///   - Header: Python dict string with 'descr', 'fortran_order', 'shape'
    ///   - Data: raw bytes
    fn parse_npy_f32(data: &[u8]) -> anyhow::Result<Vec<f32>> {
        let mut cursor = Cursor::new(data);

        // Magic number: \x93NUMPY
        let mut magic = [0u8; 6];
        cursor.read_exact(&mut magic)?;
        if &magic != b"\x93NUMPY" {
            anyhow::bail!("Invalid NPY magic number");
        }

        let major = cursor.read_u8()?;
        let _minor = cursor.read_u8()?;

        // Header length
        let header_len = if major >= 2 {
            cursor.read_u32::<LittleEndian>()? as usize
        } else {
            cursor.read_u16::<LittleEndian>()? as usize
        };

        // Skip header (we know it's float32 little-endian)
        let mut header_bytes = vec![0u8; header_len];
        cursor.read_exact(&mut header_bytes)?;

        // Verify it's float32 from the header
        let header_str = String::from_utf8_lossy(&header_bytes);
        if !header_str.contains("<f4") && !header_str.contains("float32") {
            // Could be a different dtype - check for little-endian float32 indicators
            if header_str.contains(">f4") {
                anyhow::bail!("Big-endian float32 not supported, expected little-endian");
            }
            warn!(header = %header_str, "NPY header doesn't clearly indicate float32, proceeding anyway");
        }

        // Read remaining data as f32 values
        let remaining = data.len() - cursor.position() as usize;
        let num_floats = remaining / 4;
        let mut result = Vec::with_capacity(num_floats);
        for _ in 0..num_floats {
            result.push(cursor.read_f32::<LittleEndian>()?);
        }

        Ok(result)
    }

    /// Build the phoneme-to-token-ID vocabulary.
    /// Extracted from kokoro-onnx's config.json DEFAULT_VOCAB (88 entries).
    fn build_vocab() -> HashMap<char, i64> {
        // Exact mapping from kokoro-onnx Python package config.json
        let entries: &[(char, i64)] = &[
            (';', 1), (':', 2), (',', 3), ('.', 4), ('!', 5), ('?', 6),
            ('\u{2014}', 9),   // — (em dash)
            ('\u{2026}', 10),  // … (ellipsis)
            ('"', 11), ('(', 12), (')', 13),
            ('\u{201c}', 14),  // " (left double quote)
            ('\u{201d}', 15),  // " (right double quote)
            (' ', 16),
            ('\u{0303}', 17),  // ̃ (combining tilde)
            ('\u{02a3}', 18),  // ʣ
            ('\u{02a5}', 19),  // ʥ
            ('\u{02a6}', 20),  // ʦ
            ('\u{02a8}', 21),  // ʨ
            ('\u{1d5d}', 22),  // ᵝ
            ('\u{ab67}', 23),  // ꭧ
            ('A', 24), ('I', 25),
            ('O', 31), ('Q', 33), ('S', 35), ('T', 36), ('W', 39), ('Y', 41),
            ('\u{1d4a}', 42),  // ᵊ
            // a-z (no 'g' at 49 — it's absent from Kokoro vocab)
            ('a', 43), ('b', 44), ('c', 45), ('d', 46), ('e', 47), ('f', 48),
            ('h', 50), ('i', 51), ('j', 52), ('k', 53), ('l', 54), ('m', 55),
            ('n', 56), ('o', 57), ('p', 58), ('q', 59), ('r', 60), ('s', 61),
            ('t', 62), ('u', 63), ('v', 64), ('w', 65), ('x', 66), ('y', 67),
            ('z', 68),
            ('\u{0251}', 69),  // ɑ
            ('\u{0250}', 70),  // ɐ
            ('\u{0252}', 71),  // ɒ
            ('\u{00e6}', 72),  // æ
            ('\u{03b2}', 75),  // β
            ('\u{0254}', 76),  // ɔ
            ('\u{0255}', 77),  // ɕ
            ('\u{00e7}', 78),  // ç
            ('\u{0256}', 80),  // ɖ
            ('\u{00f0}', 81),  // ð
            ('\u{02a4}', 82),  // ʤ
            ('\u{0259}', 83),  // ə
            ('\u{025a}', 85),  // ɚ
            ('\u{025b}', 86),  // ɛ
            ('\u{025c}', 87),  // ɜ
            ('\u{025f}', 90),  // ɟ
            ('\u{0261}', 92),  // ɡ (IPA lowercase g)
            ('\u{0265}', 99),  // ɥ
            ('\u{0268}', 101), // ɨ
            ('\u{026a}', 102), // ɪ
            ('\u{029d}', 103), // ʝ
            ('\u{026f}', 110), // ɯ
            ('\u{0270}', 111), // ɰ
            ('\u{014b}', 112), // ŋ
            ('\u{0273}', 113), // ɳ
            ('\u{0272}', 114), // ɲ
            ('\u{0274}', 115), // ɴ
            ('\u{00f8}', 116), // ø
            ('\u{0278}', 118), // ɸ
            ('\u{03b8}', 119), // θ
            ('\u{0153}', 120), // œ
            ('\u{0279}', 123), // ɹ
            ('\u{027e}', 125), // ɾ
            ('\u{027b}', 126), // ɻ
            ('\u{0281}', 128), // ʁ
            ('\u{027d}', 129), // ɽ
            ('\u{0282}', 130), // ʂ
            ('\u{0283}', 131), // ʃ
            ('\u{0288}', 132), // ʈ
            ('\u{02a7}', 133), // ʧ
            ('\u{028a}', 135), // ʊ
            ('\u{028b}', 136), // ʋ
            ('\u{028c}', 138), // ʌ
            ('\u{0263}', 139), // ɣ
            ('\u{0264}', 140), // ɤ
            ('\u{03c7}', 142), // χ
            ('\u{028e}', 143), // ʎ
            ('\u{0292}', 147), // ʒ
            ('\u{0294}', 148), // ʔ
            ('\u{02c8}', 156), // ˈ (primary stress)
            ('\u{02cc}', 157), // ˌ (secondary stress)
            ('\u{02d0}', 158), // ː (long)
            ('\u{02b0}', 162), // ʰ (aspiration)
            ('\u{02b2}', 164), // ʲ (palatalization)
            ('\u{2193}', 169), // ↓
            ('\u{2192}', 171), // →
            ('\u{2197}', 172), // ↗
            ('\u{2198}', 173), // ↘
            ('\u{1d7b}', 177), // ᵻ
        ];
        entries.iter().copied().collect()
    }
}

// ── onnx disabled (stub) ────────────────────────────────────────
#[cfg(not(feature = "onnx"))]
mod inner {
    use std::future::Future;
    use std::path::Path;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};

    use tracing::warn;

    use super::TtsEngine;

    pub struct KokoroTts {
        voice: String,
        interrupted: AtomicBool,
    }

    impl KokoroTts {
        pub fn new(model_dir: &Path) -> anyhow::Result<Self> {
            warn!(
                model_dir = %model_dir.display(),
                "Kokoro TTS requested but onnx feature is disabled"
            );
            anyhow::bail!(
                "Local Kokoro TTS is not available (compile with --features onnx)"
            )
        }

        pub fn set_voice(&mut self, voice: &str) {
            self.voice = voice.to_string();
        }
    }

    impl TtsEngine for KokoroTts {
        fn speak(&self, _text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
            Box::pin(async {
                anyhow::bail!("Local Kokoro TTS is not available (compile with --features onnx)")
            })
        }

        fn stop(&self) {
            self.interrupted.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            format!("Kokoro [disabled] ({})", self.voice)
        }
    }
}

pub use inner::KokoroTts;
