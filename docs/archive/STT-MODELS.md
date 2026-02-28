# STT Models Research (February 2026)

Internal reference for speech-to-text engine options in Voice Mirror (Tauri 2 / Rust desktop app).

**Current stack:** whisper-rs 0.13 (Rust FFI to whisper.cpp/GGML), behind `whisper` feature flag. Default model: `ggml-base.en.bin` (148 MB). Config: `stt_adapter: "whisper-local"`, `stt_model_size: "base"`.

**Existing abstraction:** `SttEngine` trait + `SttAdapter` enum in `src-tauri/src/voice/stt.rs`. Already has slots for cloud adapters (`openai-cloud`, `custom-cloud`). Auto-download from HuggingFace is implemented.

---

## 1. Whisper Large-v3 (OpenAI)

OpenAI's largest Whisper model. 1.55B parameters, 32 encoder + 32 decoder layers.

| Property | Value |
|----------|-------|
| GGML file | `ggml-large-v3.bin` |
| Size (f16) | 3.1 GB |
| Size (q5_0) | 1.08 GB |
| RAM usage | ~4.7 GB |
| Languages | 99+ (multilingual) |
| WER (avg) | ~7.4% |
| License | MIT |
| HuggingFace | `ggerganov/whisper.cpp` -- `ggml-large-v3.bin` or `ggml-large-v3-q5_0.bin` |

**Drop-in compatible:** YES. Same whisper-rs / whisper.cpp / GGML infrastructure. Just point `ensure_model_exists()` at the different filename. Note: no `.en` suffix -- this is multilingual only.

**Trade-offs:** Best accuracy in the Whisper family, but 3.1 GB download and ~4.7 GB RAM makes it impractical as default for a desktop overlay. The q5_0 quantized version (1.08 GB, ~2 GB RAM) is more feasible. Inference is slow on CPU -- expect 2-5x real-time on a modern laptop without GPU.

**Recommendation:** Offer as an optional "high accuracy" download for users with capable hardware. Use q5_0 quantization.

---

## 2. Whisper Large-v3-Turbo (OpenAI)

OpenAI's speed-optimized variant. Same 32 encoder layers as large-v3 but only 4 decoder layers (down from 32). 809M parameters.

| Property | Value |
|----------|-------|
| GGML file | `ggml-large-v3-turbo.bin` |
| Size (f16) | 1.62 GB |
| Size (q5_0) | 574 MB |
| Size (q8_0) | 874 MB |
| Languages | 99+ (multilingual) |
| WER (avg) | ~7.75% (within 1-2% of large-v3) |
| RTFx | ~216x real-time (GPU) |
| License | MIT |
| HuggingFace | `ggerganov/whisper.cpp` -- `ggml-large-v3-turbo.bin` / `ggml-large-v3-turbo-q5_0.bin` |

**Drop-in compatible:** YES. Works with whisper-rs / whisper.cpp. Architecture is compatible with the same inference path.

**How it differs from distil-whisper:** Turbo uses 4 decoder layers (fine-tuned from large-v3's weights for 2 more epochs). Distil-whisper uses 2 decoder layers (knowledge distillation). Turbo retains full multilingual capability; distil-large-v3 is English-only.

**Trade-offs:** 6x faster than large-v3 with only ~0.35% WER degradation. The q5_0 at 574 MB is very practical for desktop use. Best balance of speed/accuracy/size for multilingual needs.

**Recommendation:** STRONG CANDIDATE as the default "quality" model. q5_0 at 574 MB is a reasonable download. ~1.5x larger than current base model but massively better accuracy.

---

## 3. Distil-Whisper (Hugging Face)

Knowledge-distilled variant of Whisper. Trained by Hugging Face with >98k hours of data.

### distil-large-v3

| Property | Value |
|----------|-------|
| GGML file | `ggml-distil-large-v3.bin` |
| Size | ~756 MB (est. from parameter count) |
| Parameters | 756M (32 encoder + 2 decoder layers) |
| Languages | English only |
| WER | Within 1% of large-v3 on long-form; within 1.5% on short-form |
| Speed | 5-6x faster than large-v3 |
| License | MIT |
| HuggingFace | `distil-whisper/distil-large-v3-ggml` -- `ggml-distil-large-v3.bin` |

### distil-large-v3.5 (newest, March 2025)

| Property | Value |
|----------|-------|
| GGML file | `ggml-model.bin` (from `distil-whisper/distil-large-v3.5-ggml`) |
| Training data | 98k hours (4x more than v3) |
| Languages | English only |
| Speed | ~1.5x faster than large-v3-turbo |
| License | MIT |
| HuggingFace | `distil-whisper/distil-large-v3.5-ggml` -- `ggml-model.bin` |

**Drop-in compatible:** MOSTLY. Works with whisper-rs / whisper.cpp with the sequential long-form algorithm. **Caveat:** whisper.cpp does not implement the chunked transcription strategy that distil-whisper was optimized for. Quality with whisper.cpp may be slightly lower than with the HuggingFace Transformers implementation, especially on very long audio. For Voice Mirror's use case (short voice commands, <30s), this is unlikely to matter.

**Trade-offs:** Fastest option in the Whisper family. English-only is fine for Voice Mirror's current scope. The v3.5 variant is the newest and best.

**Recommendation:** STRONG CANDIDATE as the default model for English users. Fastest inference, smallest among the "large-encoder" models. Download URL differs from the standard `ggerganov/whisper.cpp` repo -- needs a different download path in `ensure_model_exists()`.

---

## 4. Faster-Whisper (CTranslate2)

Python library that re-implements Whisper using CTranslate2 (optimized C++ inference engine for Transformers). Claims 4x speedup over vanilla Whisper.

| Property | Value |
|----------|-------|
| Language | Python (CTranslate2 C++ backend) |
| Rust bindings | `ct2rs` / `ctranslate2-rs` crates (exist but immature) |
| Model format | CTranslate2 (.bin, not GGML) |
| License | MIT |

**Drop-in compatible:** NO. Different model format, different inference engine. Would require:
1. Adding `ct2rs` or `ctranslate2-rs` as a dependency
2. Converting models to CTranslate2 format
3. Writing a new `SttEngine` implementation
4. CTranslate2 has its own set of native library dependencies

**Trade-offs:** The Rust bindings (`ct2rs`) exist but are less mature than whisper-rs. CTranslate2 itself is well-maintained. The main advantage over whisper.cpp is better batching and GPU memory management -- less relevant for a single-stream desktop app.

**Recommendation:** NOT RECOMMENDED. The Rust bindings are immature and the benefits don't justify the added complexity when whisper.cpp already works well. whisper-rs + turbo/distil models achieve similar speedups with zero migration cost.

---

## 5. Moonshine (Useful Sensors)

Real-time ASR model designed for edge devices. Uses ONNX Runtime, not whisper.cpp.

### Moonshine v1

| Property | Value |
|----------|-------|
| Tiny model | 27M params, 26 MB |
| Base model | 61M params |
| Runtime | ONNX Runtime (.ort format) |
| Languages | English, Arabic, Chinese, Japanese, Korean, Ukrainian, Vietnamese, Spanish |
| License | MIT |

### Moonshine v2 (February 2025)

| Property | Value |
|----------|-------|
| Architecture | Sliding-window self-attention (streaming) |
| Medium model | 250M params (better accuracy than Whisper Large-v3 on some benchmarks) |
| Latency | Bounded, low-latency -- TTFT independent of audio length |
| Runtime | ONNX Runtime |

**Drop-in compatible:** NO. Not a Whisper-family model. No GGML port exists. Would require:
1. ONNX Runtime integration (Voice Mirror already has `ort` crate for Kokoro TTS via the `onnx` feature flag)
2. `transcribe-rs` crate supports Moonshine as a backend
3. New `SttEngine` implementation wrapping ONNX inference

**Rust integration path:** The `transcribe-rs` crate (by the author of Handy, a Rust STT app) supports Moonshine, Whisper, Parakeet, and SenseVoice with ONNX Runtime. It provides a unified Rust API. Alternatively, use `ort` directly since Voice Mirror already depends on it.

**Trade-offs:** Extremely fast (especially the tiny model). The v2 streaming architecture is ideal for real-time voice commands. But accuracy may lag behind large Whisper models. No GGML format means can't reuse the existing whisper-rs infrastructure.

**Recommendation:** INTERESTING FUTURE OPTION. The tiny model (26 MB, instant inference) would be ideal for VAD + fast dictation. Since Voice Mirror already has `ort`, the integration path exists. Worth prototyping as an `SttAdapter::Moonshine` variant. The `transcribe-rs` crate could accelerate this.

---

## 6. Deepgram Nova-2 / Nova-3 (Cloud API)

Commercial cloud STT API. State-of-the-art accuracy with sub-300ms latency.

### Nova-2

| Property | Value |
|----------|-------|
| WER (streaming) | ~8.4% |
| WER (batch) | Lower |
| Latency | Sub-300ms |
| Languages | 36+ |
| License | Commercial (API) |

### Nova-3 (newest)

| Property | Value |
|----------|-------|
| WER (streaming) | ~6.84% (54% reduction vs Nova-2) |
| WER (batch) | ~5.26% |
| Multilingual | Real-time code-switching (mid-sentence language changes) |
| License | Commercial (API) |

### Pricing (as of Jan 2026)

| Plan | Price |
|------|-------|
| Pay-As-You-Go | $0.0077/min ($0.462/hr) |
| Growth Plan | $0.0065/min ($0.39/hr) |
| Free credits | $200 on signup |

**Integration path:** WebSocket streaming API. Deepgram provides official Rust demo code (`deepgram-demos-rust`) using `tokio-tungstenite` for WebSocket + `symphonia` for audio decoding. Pattern: audio callback -> MPSC channel -> WebSocket sender task -> response handler task.

**Drop-in compatible:** NO (cloud API, not local). Would require:
1. New `SttAdapter::Deepgram` variant
2. WebSocket client (tokio-tungstenite, already available in the ecosystem)
3. API key management (config already has `stt_api_key` and `stt_endpoint` fields)
4. Network dependency (not usable offline)

**Trade-offs:** Best-in-class accuracy and latency. Per-second billing is fair for short utterances. $200 free credits is generous for development/testing. But requires internet, costs money at scale, and adds a network dependency to the voice pipeline.

**Recommendation:** GOOD CLOUD OPTION. The existing config schema already has `stt_api_key` and `stt_endpoint` fields. Implement as `SttAdapter::Deepgram` using WebSocket streaming. Offer alongside local Whisper -- user chooses based on accuracy/privacy/cost preferences.

---

## 7. Other Cloud APIs

### OpenAI Whisper API

| Property | Value |
|----------|-------|
| Price | $0.006/min ($0.36/hr) |
| Model | whisper-1 (based on large-v2) |
| Latency | Higher than Deepgram (not real-time streaming) |
| Input | File upload (not WebSocket streaming) |
| Max file | 25 MB |

**Notes:** Cheapest cloud option but no streaming support -- must upload complete audio files. Poor fit for real-time voice commands. GPT-4o Transcribe ($0.006/min) and GPT-4o Mini Transcribe ($0.003/min) are newer alternatives with better models.

### Groq Whisper API

| Property | Value |
|----------|-------|
| Price | $0.04/hr (turbo) / $0.111/hr (large-v3) |
| Model | whisper-large-v3-turbo, whisper-large-v3 |
| Latency | Very fast (LPU inference) |
| Free tier | Yes (rate-limited) |
| Max file | 100 MB |

**Notes:** Extremely cheap ($0.04/hr for turbo). Free tier available. File upload API (not WebSocket streaming). Good option for non-real-time transcription but latency may be too high for live voice commands.

**Recommendation for cloud:** Deepgram for real-time streaming, Groq for batch/non-real-time (cheapest). OpenAI API is middle ground but lacks streaming.

---

## 8. NVIDIA Parakeet (via parakeet-rs)

NVIDIA's FastConformer-TDT architecture. CTC-based, non-autoregressive -- extremely fast inference.

| Property | Value |
|----------|-------|
| Model | parakeet-tdt-0.6b-v3 |
| Parameters | 600M |
| WER | ~6.05% (ranked #1 on Open ASR Leaderboard at one point) |
| RTFx | >2,000 (among fastest models on Open ASR) |
| Runtime | ONNX Runtime |
| Languages | English only |
| License | CC-BY-4.0 |
| Rust crate | `parakeet-rs` (uses ONNX Runtime) |

**Drop-in compatible:** NO. ONNX-based, not GGML. Would require:
1. `parakeet-rs` crate or direct ONNX Runtime integration
2. New `SttAdapter::Parakeet` variant
3. ONNX Runtime already available via `ort` crate (used for Kokoro TTS)

**Trade-offs:** Incredible speed (RTFx >2000) with competitive accuracy. The `parakeet-rs` crate is actively maintained and supports streaming with stateful encoder inference. English-only. CC-BY-4.0 license requires attribution.

**Recommendation:** STRONG FUTURE CANDIDATE. Best speed-to-accuracy ratio of any model researched. The Rust crate exists and is actively developed. Since Voice Mirror already has `ort`, integration is feasible. Worth prototyping as an alternative to whisper-rs for users who want instant transcription.

---

## 9. SenseVoice (Alibaba/FunAudioLLM)

Non-autoregressive multi-task speech model. Handles ASR + language ID + emotion recognition + audio event detection.

| Property | Value |
|----------|-------|
| Model | SenseVoice-Small |
| Speed | 70ms for 10s of audio (15x faster than Whisper-Large) |
| Languages | 50+ |
| Runtime | ONNX Runtime / FunASR |
| License | Apache 2.0 (model), MIT (code) |
| Rust crate | `sensevoice-cli` (uses ORT + Symphonia) |

**Drop-in compatible:** NO. ONNX-based. Integration via sherpa-onnx or `transcribe-rs`.

**Trade-offs:** Extremely fast, excellent multilingual support, and bonus emotion/event detection. But the Rust ecosystem is less mature than whisper-rs. The `sensevoice-cli` crate exists but is a CLI tool, not a library.

**Recommendation:** NICHE OPTION. Interesting if multilingual + emotion detection is needed. Otherwise, Parakeet is faster for English and Whisper-turbo is better-supported.

---

## 10. Vosk

Lightweight offline ASR based on Kaldi. Small models (50 MB), efficient on CPU.

| Property | Value |
|----------|-------|
| Small model | ~50 MB |
| Large model | ~1.8 GB |
| Languages | 20+ |
| Runtime | Custom C++ (Kaldi) |
| Rust support | Via `tauri-plugin-stt` (uses Vosk backend) |
| License | Apache 2.0 |

**Drop-in compatible:** NO. Different engine entirely. `tauri-plugin-stt` exists as a Tauri 2 plugin but uses Vosk internally.

**Trade-offs:** Very small models, fast on CPU, good for embedded. But accuracy is significantly lower than Whisper-family models. The Tauri plugin handles permissions and model download automatically.

**Recommendation:** NOT RECOMMENDED as primary engine. Accuracy is too low compared to modern alternatives. Could be a fallback for extremely constrained environments.

---

## 11. Candle-Whisper (Hugging Face Candle)

Pure Rust Whisper implementation using HuggingFace's Candle ML framework. No C++ FFI.

| Property | Value |
|----------|-------|
| Models | tiny through large-v3, distil variants |
| Runtime | Candle (pure Rust, GPU via CUDA/Metal) |
| WASM | Supported (runs in browser) |
| License | Apache 2.0 / MIT |
| Crate | `candle-core`, `candle-transformers` |

**Drop-in compatible:** NO. Different runtime (Candle, not GGML). Would require:
1. Replacing whisper-rs with candle-core + candle-transformers
2. Model format conversion (safetensors, not GGML)
3. New inference pipeline

**Trade-offs:** Pure Rust (no C++ build complexity), GPU support via CUDA/Metal, WASM support. But candle is still maturing and inference speed may not match whisper.cpp's highly optimized C code. Model loading is also different.

**Recommendation:** WATCH LIST. Interesting for the "pure Rust, no FFI" story. Not ready to replace whisper-rs today, but Candle is improving rapidly. Could eliminate the whisper.cpp build complexity.

---

## Summary: Model Comparison Table

| Model | Size (disk) | WER | Speed | Languages | whisper-rs? | Effort |
|-------|-------------|-----|-------|-----------|-------------|--------|
| **base.en** (current) | 148 MB | ~13% | Moderate | EN | YES | None |
| **large-v3** (q5_0) | 1.08 GB | ~7.4% | Slow | 99+ | YES | Config only |
| **large-v3-turbo** (q5_0) | 574 MB | ~7.75% | Fast | 99+ | YES | Config only |
| **distil-large-v3** | ~756 MB | ~8% | Very fast | EN | YES* | URL change |
| **distil-large-v3.5** | ~756 MB | ~7.5% | Very fast | EN | YES* | URL change |
| **Moonshine tiny** | 26 MB | Higher | Instant | 8 | NO | New adapter (ONNX) |
| **Parakeet 0.6B** | ~600 MB | ~6% | Instant | EN | NO | New adapter (ONNX) |
| **SenseVoice-Small** | ~200 MB | Good | Very fast | 50+ | NO | New adapter (ONNX) |
| **Deepgram Nova-3** | Cloud | ~5.3% | Sub-300ms | 36+ | NO | New adapter (WebSocket) |
| **Groq Whisper** | Cloud | ~7.75% | Very fast | 99+ | NO | New adapter (HTTP) |
| **OpenAI Whisper API** | Cloud | ~8% | Moderate | 99+ | NO | New adapter (HTTP) |

\* Compatible via whisper.cpp sequential algorithm. Chunked algorithm not supported -- minor quality impact on short utterances.

---

## Recommended Roadmap

### Phase 1: Drop-in upgrades (zero code changes beyond config)

1. **Add large-v3-turbo-q5_0 as a model option.** Update `ensure_model_exists()` to handle non-`.en` model filenames. Add "large-v3-turbo" to the model size selector in settings. 574 MB download, massive accuracy improvement over base.

2. **Add distil-large-v3.5 as a model option.** Different download URL (`distil-whisper/distil-large-v3.5-ggml` repo). Fastest local option for English. Label as "distil-large-v3.5 (English, fastest)".

3. **Update whisper-rs to latest (0.15.1).** Current pinned version is 0.13. Newer versions track whisper.cpp improvements.

### Phase 2: Cloud adapters (leverages existing SttAdapter architecture)

4. **Deepgram Nova-3 streaming adapter.** WebSocket-based, real-time. Use existing `stt_api_key` / `stt_endpoint` config fields. Best accuracy of any option.

5. **Groq Whisper API adapter.** HTTP file upload, very cheap. Good for non-real-time use cases.

### Phase 3: ONNX-based local engines (requires new infrastructure)

6. **Parakeet-rs integration.** Leverage existing `ort` dependency. RTFx >2000 would make dictation feel instant. English-only.

7. **Moonshine tiny as ultra-fast fallback.** 26 MB model, sub-100ms inference. Could replace or augment VAD -- transcribe every chunk instead of detecting voice activity.

### Non-goals

- **Faster-Whisper / CTranslate2:** Immature Rust bindings, marginal benefit over whisper.cpp + turbo models.
- **Vosk:** Accuracy too low for primary use.
- **Candle-Whisper:** Promising but not mature enough yet. Revisit in 6 months.
- **SenseVoice:** Niche. Interesting only if multi-language + emotion detection becomes a priority.

---

## Key Files to Modify

- `src-tauri/src/voice/stt.rs` -- `SttEngine` trait, `SttAdapter` enum, `ensure_model_exists()`
- `src-tauri/src/config/schema.rs` -- `VoiceConfig.stt_model_size` options
- `src-tauri/Cargo.toml` -- whisper-rs version, new ONNX/WebSocket deps
- `src/lib/stores/config.svelte.js` -- model selector UI options
- `src/components/settings/` -- settings panel for model selection

## Sources

- [ggerganov/whisper.cpp HuggingFace models](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
- [whisper.cpp GitHub](https://github.com/ggml-org/whisper.cpp)
- [distil-whisper/distil-large-v3-ggml](https://huggingface.co/distil-whisper/distil-large-v3-ggml)
- [distil-whisper/distil-large-v3.5](https://huggingface.co/distil-whisper/distil-large-v3.5)
- [distil-whisper/distil-large-v3.5-ggml](https://huggingface.co/distil-whisper/distil-large-v3.5-ggml)
- [openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)
- [whisper-rs crate](https://crates.io/crates/whisper-rs)
- [Deepgram pricing](https://deepgram.com/pricing)
- [Deepgram Nova-3 vs Nova-2](https://deepgram.com/learn/model-comparison-when-to-use-nova-2-vs-nova-3-for-devs)
- [Deepgram Rust demos](https://deepwiki.com/deepgram-devs/deepgram-demos-rust)
- [Moonshine GitHub](https://github.com/moonshine-ai/moonshine)
- [Moonshine v2 paper](https://arxiv.org/html/2602.12241)
- [parakeet-rs crate](https://crates.io/crates/parakeet-rs)
- [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [transcribe-rs crate](https://crates.io/crates/transcribe-rs)
- [SenseVoice GitHub](https://github.com/FunAudioLLM/SenseVoice)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [tauri-plugin-stt](https://crates.io/crates/tauri-plugin-stt)
- [candle ML framework](https://github.com/huggingface/candle)
- [Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard)
- [Northflank STT benchmark 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [Groq pricing](https://groq.com/pricing)
- [Whisper model comparison](https://amgadhasan.substack.com/p/demystifying-openais-new-whisper)
