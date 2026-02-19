//! Voice Activity Detection (VAD).
//!
//! Provides energy-based voice activity detection for determining when
//! a user is speaking. This is the fallback approach used when neural
//! VAD models (Silero) are not available.
//!
//! The energy-based approach computes the mean absolute amplitude of
//! audio frames and compares against a configurable threshold.

use std::time::{Duration, Instant};

// ── Energy Detection ────────────────────────────────────────────────

/// Compute the energy level of an audio frame.
///
/// Returns the mean absolute value of the samples -- a simple proxy for
/// signal energy that works well enough for speech/silence discrimination.
pub fn compute_energy(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s.abs()).sum();
    sum / samples.len() as f32
}

/// Compute the energy level from i16 samples.
///
/// Converts to f32 range (-1.0 to 1.0) internally.
pub fn compute_energy_i16(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|&s| (s as f32 / 32768.0).abs()).sum();
    sum / samples.len() as f32
}

// ── VAD Processor ───────────────────────────────────────────────────

/// Voice Activity Detection processor.
///
/// Uses energy-based detection with configurable threshold and
/// silence duration tracking for determining speech boundaries.
pub struct VadProcessor {
    /// Energy threshold below which audio is considered silence.
    /// Typical values: 0.005 - 0.05 depending on mic/environment.
    threshold: f32,

    /// How long silence has persisted since the last detected speech.
    silence_start: Option<Instant>,

    /// Whether speech was detected in the most recent frame.
    is_speech: bool,

    /// Running average energy for adaptive thresholding (optional).
    avg_energy: f32,

    /// Number of frames processed (for running average).
    frame_count: u64,
}

impl VadProcessor {
    /// Create a new VAD processor with the given silence threshold.
    ///
    /// # Arguments
    /// * `threshold` - Energy level below which audio is silence.
    ///   Recommended starting value: `0.01` for typical desktop microphones.
    pub fn new(threshold: f32) -> Self {
        Self {
            threshold,
            silence_start: None,
            is_speech: false,
            avg_energy: 0.0,
            frame_count: 0,
        }
    }

    /// Process an audio frame (f32 samples, expected 16kHz mono).
    ///
    /// Returns `true` if speech is detected in this frame.
    pub fn process_frame(&mut self, audio: &[f32]) -> bool {
        let energy = compute_energy(audio);
        self.update_state(energy)
    }

    /// Process an audio frame of i16 samples.
    ///
    /// Returns `true` if speech is detected in this frame.
    pub fn process_frame_i16(&mut self, audio: &[i16]) -> bool {
        let energy = compute_energy_i16(audio);
        self.update_state(energy)
    }

    /// Update internal state based on computed energy level.
    fn update_state(&mut self, energy: f32) -> bool {
        // Update running average
        self.frame_count += 1;
        let alpha = 0.01_f32;
        self.avg_energy = self.avg_energy * (1.0 - alpha) + energy * alpha;

        // Determine speech/silence
        self.is_speech = energy > self.threshold;

        if self.is_speech {
            // Speech detected: reset silence timer
            self.silence_start = None;
        } else if self.silence_start.is_none() {
            // Silence just started
            self.silence_start = Some(Instant::now());
        }

        self.is_speech
    }

    /// Get how long silence has persisted since the last speech.
    ///
    /// Returns `None` if speech was detected in the most recent frame
    /// (i.e., there is no ongoing silence period).
    pub fn silence_duration(&self) -> Option<Duration> {
        self.silence_start.map(|start| start.elapsed())
    }

    /// Check if silence has exceeded the given duration.
    ///
    /// Useful for implementing silence-timeout recording stops.
    pub fn silence_exceeded(&self, timeout: Duration) -> bool {
        self.silence_duration()
            .map(|d| d >= timeout)
            .unwrap_or(false)
    }

    /// Whether speech was detected in the most recent frame.
    pub fn is_speech(&self) -> bool {
        self.is_speech
    }

    /// Get the current silence threshold.
    pub fn threshold(&self) -> f32 {
        self.threshold
    }

    /// Update the silence threshold.
    pub fn set_threshold(&mut self, threshold: f32) {
        self.threshold = threshold;
    }

    /// Get the running average energy level.
    pub fn average_energy(&self) -> f32 {
        self.avg_energy
    }

    /// Reset all internal state.
    pub fn reset(&mut self) {
        self.silence_start = None;
        self.is_speech = false;
        self.avg_energy = 0.0;
        self.frame_count = 0;
    }
}

impl Default for VadProcessor {
    fn default() -> Self {
        Self::new(0.01)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_energy_empty() {
        assert_eq!(compute_energy(&[]), 0.0);
    }

    #[test]
    fn test_compute_energy_silence() {
        let silence = vec![0.0f32; 1280];
        assert_eq!(compute_energy(&silence), 0.0);
    }

    #[test]
    fn test_compute_energy_signal() {
        // A signal with alternating +0.5 and -0.5 should have energy 0.5
        let signal: Vec<f32> = (0..1280).map(|i| if i % 2 == 0 { 0.5 } else { -0.5 }).collect();
        let energy = compute_energy(&signal);
        assert!((energy - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_compute_energy_i16() {
        let silence = vec![0i16; 1280];
        assert_eq!(compute_energy_i16(&silence), 0.0);
    }

    #[test]
    fn test_vad_silence_detection() {
        let mut vad = VadProcessor::new(0.01);
        let silence = vec![0.0f32; 1280];

        let result = vad.process_frame(&silence);
        assert!(!result, "silence should not be detected as speech");
        assert!(!vad.is_speech());
    }

    #[test]
    fn test_vad_speech_detection() {
        let mut vad = VadProcessor::new(0.01);
        // Generate a signal well above threshold
        let speech: Vec<f32> = (0..1280).map(|i| (i as f32 * 0.01).sin() * 0.5).collect();

        let result = vad.process_frame(&speech);
        assert!(result, "loud signal should be detected as speech");
        assert!(vad.is_speech());
    }

    #[test]
    fn test_vad_silence_duration_tracking() {
        let mut vad = VadProcessor::new(0.01);
        let silence = vec![0.0f32; 1280];

        // Process silence frame
        vad.process_frame(&silence);
        assert!(vad.silence_duration().is_some());
    }

    #[test]
    fn test_vad_silence_reset_on_speech() {
        let mut vad = VadProcessor::new(0.01);
        let silence = vec![0.0f32; 1280];
        let speech: Vec<f32> = vec![0.5f32; 1280];

        // Start with silence
        vad.process_frame(&silence);
        assert!(vad.silence_duration().is_some());

        // Speech resets silence timer
        vad.process_frame(&speech);
        assert!(vad.silence_duration().is_none());
    }

    #[test]
    fn test_vad_reset() {
        let mut vad = VadProcessor::new(0.01);
        let speech: Vec<f32> = vec![0.5f32; 1280];

        vad.process_frame(&speech);
        assert!(vad.is_speech());

        vad.reset();
        assert!(!vad.is_speech());
        assert!(vad.silence_duration().is_none());
        assert_eq!(vad.average_energy(), 0.0);
    }

    #[test]
    fn test_vad_threshold_adjustment() {
        let mut vad = VadProcessor::new(0.01);
        assert_eq!(vad.threshold(), 0.01);

        vad.set_threshold(0.05);
        assert_eq!(vad.threshold(), 0.05);
    }
}
