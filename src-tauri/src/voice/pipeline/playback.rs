//! Rodio audio playback functions for TTS output.
//!
//! Provides both streaming (chunk-by-chunk) and one-shot playback
//! strategies via rodio Sink.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, Sink};
use tauri::Emitter;

use super::{PipelineShared, VoiceEvent};
use crate::voice::tts::{self, TtsEngine};
use crate::voice::VoiceState;

use super::{state_to_u8, VoiceMode};

/// Max time to wait for a single phrase to synthesize before giving up.
///
/// Synthesis returns no length info until it completes, so we can't size this
/// from expected audio. A healthy phrase synthesizes in well under a second
/// (even cloud TTS); 60s means the engine (or its network call) has wedged.
/// On timeout we abort THIS phrase and continue, so the pipeline never hangs
/// indefinitely in Speaking.
const SYNTH_TIMEOUT: Duration = Duration::from_secs(60);

/// Compute a generous playback cap from the known audio length:
/// `max(30s, expected * 3 + 10s)`. Used to bound the rodio drain loops so a
/// stalled audio device can't hang the Speaking state forever.
fn playback_cap(samples_len: usize, sample_rate: u32) -> Duration {
    let expected_secs = samples_len as f64 / sample_rate.max(1) as f64;
    let cap_secs = (expected_secs * 3.0 + 10.0).max(30.0);
    Duration::from_secs_f64(cap_secs)
}

/// Transition to Speaking state and emit events.
pub(crate) fn set_speaking_state(shared: &Arc<PipelineShared>, text: &str) {
    shared
        .state
        .store(state_to_u8(VoiceState::Speaking), Ordering::Release);
    let _ = shared.app_handle.emit(
        "voice-event",
        VoiceEvent::StateChange {
            state: "speaking".into(),
        },
    );
    let _ = shared.app_handle.emit(
        "voice-event",
        VoiceEvent::SpeakingStart {
            text: text.to_string(),
        },
    );
}

/// Take the TTS engine from shared state. Returns None if unavailable.
pub(crate) fn take_tts_engine(shared: &Arc<PipelineShared>) -> Option<Box<dyn TtsEngine>> {
    match shared.tts_engine.lock() {
        Ok(mut guard) => guard.take(),
        Err(e) => {
            tracing::error!("Failed to lock tts_engine: {}", e);
            None
        }
    }
}

/// Speak text using streaming synthesis for low first-audio latency.
///
/// Splits text into phrases, synthesizes each one individually, and streams
/// audio chunks to a rodio Sink via an async channel. First audio plays
/// within ~400ms instead of waiting for full synthesis.
///
/// Falls back to single-shot synthesis for short text (1 phrase).
///
/// Uses a per-request cancel token so that when a new speak() call cancels
/// the previous one, the old playback thread stays cancelled even after the
/// new request resets the shared `tts_cancel` flag.
pub(super) async fn speak(shared: &Arc<PipelineShared>, text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    // If already speaking, cancel current playback and wait for the TTS engine
    // to be restored before starting new synthesis (prevents overlapping audio).
    let current = super::state_from_u8(shared.state.load(Ordering::Acquire));
    if current == VoiceState::Speaking {
        tracing::info!("Cancelling previous TTS for new speech request");
        shared.tts_cancel.store(true, Ordering::SeqCst);
        // Cancel the previous request's playback token directly — this ensures
        // the old rodio Sink drain loop stops even after we reset tts_cancel.
        if let Ok(guard) = shared.active_playback_cancel.lock() {
            if let Some(ref prev_cancel) = *guard {
                prev_cancel.store(true, Ordering::SeqCst);
            }
        }
        // Wait up to 2 seconds for the engine to be returned AND the previous
        // playback handle to finish.
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let engine_available = shared.tts_engine.lock().map(|g| g.is_some()).unwrap_or(false);
            let no_longer_speaking = super::state_from_u8(shared.state.load(Ordering::Acquire)) != VoiceState::Speaking;
            if engine_available && no_longer_speaking {
                break;
            }
            if engine_available {
                tokio::time::sleep(Duration::from_millis(100)).await;
                break;
            }
        }
    }

    // Reset cancellation flag for the new request
    shared.tts_cancel.store(false, Ordering::SeqCst);

    // Create a per-request cancel token. This ensures the playback thread for
    // THIS request stays cancelled even if a subsequent speak() call resets
    // the shared tts_cancel flag.
    let request_cancel = Arc::new(AtomicBool::new(false));

    // Register this token so external callers (barge-in, stop_speaking) can cancel it
    if let Ok(mut guard) = shared.active_playback_cancel.lock() {
        *guard = Some(Arc::clone(&request_cancel));
    }

    // Set state to Speaking + emit events
    set_speaking_state(shared, text);

    // Take the TTS engine
    let engine = match take_tts_engine(shared) {
        Some(e) => e,
        None => {
            tracing::warn!("No TTS engine available, skipping speech");
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: "No TTS engine available".into(),
                },
            );
            finish_speaking(shared);
            return Err("No TTS engine available".into());
        }
    };

    // Check cancellation before synthesis
    if shared.tts_cancel.load(Ordering::SeqCst) {
        tracing::info!("TTS cancelled before synthesis");
        restore_tts_engine(shared, engine);
        finish_speaking(shared);
        return Ok(());
    }

    let sample_rate = engine.sample_rate();
    let volume = shared.config.tts_volume;
    let output_device = shared.config.output_device.clone();

    // Split into phrases for streaming
    let phrases = tts::split_into_phrases(text);

    if phrases.is_empty() {
        restore_tts_engine(shared, engine);
        finish_speaking(shared);
        return Ok(());
    }

    // For single phrase, use simpler non-streaming path (less overhead)
    if phrases.len() <= 1 {
        let result = speak_oneshot(shared, engine, &phrases[0], sample_rate, volume, output_device, Arc::clone(&request_cancel)).await;
        finish_speaking(shared);
        return result;
    }

    // Streaming: synthesize phrase by phrase, queue in rodio Sink
    tracing::info!(
        phrases = phrases.len(),
        "Starting streaming TTS ({} phrases)",
        phrases.len()
    );

    let (chunk_tx, chunk_rx) = tokio::sync::mpsc::channel::<Vec<f32>>(4);
    let playback_cancel = Arc::clone(&request_cancel);

    // Spawn playback thread: creates Sink, receives chunks via channel.
    // Uses the per-request cancel token so it stays cancelled even if the
    // shared tts_cancel flag is reset by a subsequent speak() call.
    let playback_handle = tokio::task::spawn_blocking(move || {
        play_chunks_rodio(
            chunk_rx,
            sample_rate,
            volume,
            output_device.as_deref(),
            &playback_cancel,
        )
    });

    // Synthesize phrases and send to playback
    for (i, phrase) in phrases.iter().enumerate() {
        if shared.tts_cancel.load(Ordering::SeqCst) {
            tracing::info!("TTS cancelled during streaming synthesis");
            // Propagate to per-request token so playback thread also stops
            request_cancel.store(true, Ordering::SeqCst);
            break;
        }

        match tokio::time::timeout(SYNTH_TIMEOUT, engine.synthesize(phrase)).await {
            Ok(Ok(samples)) if !samples.is_empty() => {
                tracing::debug!(
                    phrase = i + 1,
                    samples = samples.len(),
                    duration_secs = format!("{:.2}", samples.len() as f64 / sample_rate as f64),
                    "Phrase synthesized"
                );
                if chunk_tx.send(samples).await.is_err() {
                    tracing::warn!("Playback channel closed, stopping synthesis");
                    break;
                }
            }
            Ok(Ok(_)) => {
                tracing::debug!(phrase = i + 1, "Phrase produced no audio, skipping");
            }
            Ok(Err(e)) => {
                tracing::warn!(phrase = i + 1, error = %e, "Phrase synthesis failed, skipping");
                // Continue with remaining phrases
            }
            Err(_) => {
                // Synthesis wedged past SYNTH_TIMEOUT — abort this phrase and
                // continue so Speaking can't hang forever.
                tracing::warn!(
                    phrase = i + 1,
                    timeout_secs = SYNTH_TIMEOUT.as_secs(),
                    "Phrase synthesis timed out, skipping"
                );
            }
        }
    }

    // Drop sender to signal playback thread that no more chunks are coming
    drop(chunk_tx);

    // Wait for playback to finish
    restore_tts_engine(shared, engine);

    match playback_handle.await {
        Ok(Ok(())) => {
            tracing::info!("Streaming TTS playback complete");
        }
        Ok(Err(e)) => {
            tracing::error!("Streaming TTS playback error: {}", e);
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: format!("TTS playback error: {}", e),
                },
            );
        }
        Err(e) => {
            tracing::error!("Streaming TTS playback task panicked: {}", e);
        }
    }

    finish_speaking(shared);
    Ok(())
}

/// Single-shot (non-streaming) synthesis + playback for short text.
async fn speak_oneshot(
    shared: &Arc<PipelineShared>,
    engine: Box<dyn TtsEngine>,
    text: &str,
    sample_rate: u32,
    volume: f32,
    output_device: Option<String>,
    request_cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let synthesize_result = match tokio::time::timeout(SYNTH_TIMEOUT, engine.synthesize(text)).await
    {
        Ok(result) => result,
        Err(_) => {
            // Synthesis wedged — abort, restore engine, and finish cleanly so
            // the pipeline never hangs in Speaking.
            tracing::warn!(
                timeout_secs = SYNTH_TIMEOUT.as_secs(),
                "TTS synthesis timed out, aborting speech"
            );
            restore_tts_engine(shared, engine);
            return Ok(());
        }
    };

    match synthesize_result {
        Ok(samples) => {
            if samples.is_empty() {
                tracing::debug!("TTS produced no audio samples");
                restore_tts_engine(shared, engine);
                return Ok(());
            }

            tracing::info!(
                samples = samples.len(),
                sample_rate,
                duration_secs = format!("{:.2}", samples.len() as f64 / sample_rate as f64),
                "TTS synthesis complete, starting playback"
            );

            if shared.tts_cancel.load(Ordering::SeqCst) {
                tracing::info!("TTS cancelled after synthesis");
                request_cancel.store(true, Ordering::SeqCst);
                restore_tts_engine(shared, engine);
                return Ok(());
            }

            let playback_result = tokio::task::spawn_blocking(move || {
                play_samples_rodio(
                    samples,
                    sample_rate,
                    volume,
                    output_device.as_deref(),
                    &request_cancel,
                )
            })
            .await;

            restore_tts_engine(shared, engine);

            match playback_result {
                Ok(Ok(())) => tracing::info!("TTS playback complete"),
                Ok(Err(e)) => {
                    tracing::error!("TTS playback error: {}", e);
                    let _ = shared.app_handle.emit(
                        "voice-event",
                        VoiceEvent::Error {
                            message: format!("TTS playback error: {}", e),
                        },
                    );
                }
                Err(e) => tracing::error!("TTS playback task panicked: {}", e),
            }
        }
        Err(e) => {
            tracing::error!("TTS synthesis failed: {}", e);
            restore_tts_engine(shared, engine);
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: format!("TTS synthesis failed: {}", e),
                },
            );
        }
    }

    Ok(())
}

/// Restore the TTS engine into shared state after use.
pub(crate) fn restore_tts_engine(shared: &Arc<PipelineShared>, engine: Box<dyn TtsEngine>) {
    match shared.tts_engine.lock() {
        Ok(mut guard) => {
            *guard = Some(engine);
        }
        Err(e) => {
            tracing::error!("Failed to lock tts_engine to restore: {}", e);
        }
    }
}

/// Transition the pipeline out of Speaking state.
///
/// Uses compare-and-swap: only transitions if still in Speaking state.
/// If a barge-in already moved the state to Recording, this is a no-op
/// (the SpeakingEnd event is still emitted for the frontend).
///
/// WakeWord -> Listening (resume auto-detection).
/// PTT / Toggle -> Idle (wait for key press).
pub(crate) fn finish_speaking(shared: &Arc<PipelineShared>) {
    let mode = shared.mode.lock().map(|g| *g).unwrap_or(VoiceMode::PushToTalk);
    let next_state = match mode {
        VoiceMode::WakeWord => VoiceState::Listening,
        VoiceMode::PushToTalk | VoiceMode::Toggle => VoiceState::Idle,
    };

    // Only transition if we're still in Speaking state.
    // If barge-in already moved us to Recording, don't overwrite.
    let swapped = shared.state.compare_exchange(
        state_to_u8(VoiceState::Speaking),
        state_to_u8(next_state),
        Ordering::SeqCst,
        Ordering::Relaxed,
    );

    // Always emit SpeakingEnd so the frontend knows TTS is done
    let _ = shared
        .app_handle
        .emit("voice-event", VoiceEvent::SpeakingEnd {});

    if swapped.is_ok() {
        let _ = shared.app_handle.emit(
            "voice-event",
            VoiceEvent::StateChange {
                state: next_state.to_string(),
            },
        );
    } else {
        tracing::debug!("finish_speaking: state already changed (barge-in?), skipping state transition");
    }
}

/// Open the audio output stream for a named or default device.
fn open_output_stream(
    output_device_name: Option<&str>,
) -> Result<(OutputStream, rodio::OutputStreamHandle), String> {
    if let Some(name) = output_device_name {
        let host = cpal::default_host();
        let device = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {}", e))?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false));

        match device {
            Some(dev) => {
                tracing::info!(device = %name, "Using configured output device");
                OutputStream::try_from_device(&dev)
                    .map_err(|e| format!("Failed to open output device '{}': {}", name, e))
            }
            None => {
                tracing::warn!(
                    device = %name,
                    "Configured output device not found, falling back to default"
                );
                OutputStream::try_default()
                    .map_err(|e| format!("No audio output device available: {}", e))
            }
        }
    } else {
        OutputStream::try_default()
            .map_err(|e| format!("No audio output device available: {}", e))
    }
}

/// Check if cancellation has been requested (per-request token).
#[inline]
fn is_cancelled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::SeqCst)
}

/// Play f32 PCM samples through the audio output device using rodio.
///
/// This runs on a blocking thread. It creates a rodio `OutputStream` and
/// `Sink`, loads the samples as a buffer source, and blocks until playback
/// finishes or cancellation is requested.
///
/// The `cancel` flag is a per-request token that stays true even if a new
/// speak() call resets the shared tts_cancel flag.
fn play_samples_rodio(
    samples: Vec<f32>,
    sample_rate: u32,
    volume: f32,
    output_device_name: Option<&str>,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (_stream, stream_handle) = open_output_stream(output_device_name)?;

    let sink = Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create audio sink: {}", e))?;

    // Set volume (rodio volume: 1.0 = normal)
    sink.set_volume(volume.clamp(0.0, 2.0));

    // Cap how long we'll wait for this known-length buffer to drain, so a
    // stalled audio device can't hang the Speaking state forever.
    let cap = playback_cap(samples.len(), sample_rate);

    // Create a rodio source from the f32 samples (mono, engine sample rate)
    let source = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
    sink.append(source);

    // Poll for completion or cancellation
    let start = Instant::now();
    while !sink.empty() {
        if is_cancelled(cancel) {
            tracing::info!("TTS playback cancelled");
            sink.stop();
            return Ok(());
        }
        if start.elapsed() > cap {
            tracing::warn!(
                cap_secs = cap.as_secs(),
                "TTS playback exceeded expected duration, stopping (audio device stalled?)"
            );
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}

/// Play audio chunks received from an async channel via rodio Sink.
///
/// This runs on a blocking thread. It receives synthesized audio chunks
/// from the streaming TTS pipeline and appends each to the Sink for
/// gapless playback. First audio plays as soon as the first chunk arrives.
///
/// The `cancel` flag is a per-request token that stays true even if a new
/// speak() call resets the shared tts_cancel flag.
fn play_chunks_rodio(
    rx: tokio::sync::mpsc::Receiver<Vec<f32>>,
    sample_rate: u32,
    volume: f32,
    output_device_name: Option<&str>,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (_stream, stream_handle) = open_output_stream(output_device_name)?;

    let sink = Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create audio sink: {}", e))?;

    sink.set_volume(volume.clamp(0.0, 2.0));

    // Use the current tokio runtime handle to block_on channel receives
    let rt = tokio::runtime::Handle::current();
    let mut rx = rx;

    // Poll the channel with a short timeout so we keep re-checking the cancel
    // flag during gaps between phrases, and bail if synthesis goes silent for
    // too long (a wedged engine) instead of blocking on recv() forever.
    const RECV_POLL: Duration = Duration::from_millis(250);
    /// Max time to wait for the next chunk before assuming synthesis is wedged.
    /// Must comfortably exceed SYNTH_TIMEOUT (60s) so a slow-but-healthy phrase
    /// is never cut off.
    const RECV_MAX_IDLE: Duration = Duration::from_secs(75);

    let mut total_samples: usize = 0;
    let mut idle = Duration::ZERO;

    // Receive and play chunks as they arrive
    loop {
        if is_cancelled(cancel) {
            tracing::info!("Streaming TTS playback cancelled");
            sink.stop();
            return Ok(());
        }

        match rt.block_on(async { tokio::time::timeout(RECV_POLL, rx.recv()).await }) {
            Ok(Some(samples)) => {
                idle = Duration::ZERO;
                total_samples += samples.len();
                let source = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
                sink.append(source);
            }
            Ok(None) => {
                // Channel closed — all chunks sent, wait for playback to finish
                break;
            }
            Err(_) => {
                // No chunk this interval — keep looping (re-checks cancel) until
                // synthesis has been silent past RECV_MAX_IDLE.
                idle += RECV_POLL;
                if idle >= RECV_MAX_IDLE {
                    tracing::warn!(
                        idle_secs = idle.as_secs(),
                        "Streaming TTS received no audio chunk, stopping (synthesis wedged?)"
                    );
                    sink.stop();
                    return Ok(());
                }
            }
        }
    }

    // Wait for all queued audio to finish playing, bounded by the expected
    // duration so a stalled audio device can't hang Speaking forever.
    let cap = playback_cap(total_samples, sample_rate);
    let start = Instant::now();
    while !sink.empty() {
        if is_cancelled(cancel) {
            tracing::info!("Streaming TTS playback cancelled during drain");
            sink.stop();
            return Ok(());
        }
        if start.elapsed() > cap {
            tracing::warn!(
                cap_secs = cap.as_secs(),
                "Streaming TTS drain exceeded expected duration, stopping (audio device stalled?)"
            );
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}
