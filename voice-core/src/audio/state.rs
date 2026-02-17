//! Atomic audio state machine.
//!
//! Thread-safe state tracking for the audio pipeline using `AtomicU8`.
//! Shared between the capture thread, processing thread, and IPC handler.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

/// Audio pipeline states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AudioState {
    /// No active audio processing. Microphone may still be capturing for
    /// wake-word / VAD but we are not recording user speech.
    Idle = 0,
    /// Actively listening for wake word or VAD trigger.
    Listening = 1,
    /// Recording user speech (triggered by wake word, PTT, or dictation).
    Recording = 2,
    /// Recorded audio is being processed (STT, LLM, etc.).
    Processing = 3,
}

impl AudioState {
    fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Idle,
            1 => Self::Listening,
            2 => Self::Recording,
            3 => Self::Processing,
            _ => Self::Idle,
        }
    }
}

impl std::fmt::Display for AudioState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Idle => write!(f, "idle"),
            Self::Listening => write!(f, "listening"),
            Self::Recording => write!(f, "recording"),
            Self::Processing => write!(f, "processing"),
        }
    }
}

/// What triggered the current recording session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RecordingSource {
    None = 0,
    WakeWord = 1,
    Ptt = 2,
    Dictation = 4,
}

impl RecordingSource {
    fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::WakeWord,
            2 => Self::Ptt,
            4 => Self::Dictation,
            _ => Self::None,
        }
    }
}

impl std::fmt::Display for RecordingSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => write!(f, "none"),
            Self::WakeWord => write!(f, "wake_word"),
            Self::Ptt => write!(f, "ptt"),
            Self::Dictation => write!(f, "dictation"),
        }
    }
}

/// Thread-safe audio state, shareable via `Arc`.
#[derive(Debug)]
pub struct AudioStateMachine {
    state: AtomicU8,
    source: AtomicU8,
}

impl AudioStateMachine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: AtomicU8::new(AudioState::Idle as u8),
            source: AtomicU8::new(RecordingSource::None as u8),
        })
    }

    /// Current state.
    pub fn current_state(&self) -> AudioState {
        AudioState::from_u8(self.state.load(Ordering::Acquire))
    }

    /// Current recording source (only meaningful when state == Recording).
    pub fn recording_source(&self) -> RecordingSource {
        RecordingSource::from_u8(self.source.load(Ordering::Acquire))
    }

    /// Transition to Listening state (from Idle).
    pub fn start_listening(&self) -> bool {
        self.state
            .compare_exchange(
                AudioState::Idle as u8,
                AudioState::Listening as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    /// Transition to Recording state with a given source.
    /// Allowed from Listening or Idle.
    pub fn start_recording(&self, source: RecordingSource) -> bool {
        let current = self.state.load(Ordering::Acquire);
        if current == AudioState::Listening as u8 || current == AudioState::Idle as u8 {
            self.source.store(source as u8, Ordering::Release);
            self.state
                .store(AudioState::Recording as u8, Ordering::Release);
            true
        } else {
            false
        }
    }

    /// Transition from Recording to Processing.
    pub fn stop_recording(&self) -> bool {
        self.state
            .compare_exchange(
                AudioState::Recording as u8,
                AudioState::Processing as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    /// Transition from Processing back to Listening.
    pub fn finish_processing(&self) -> bool {
        self.state
            .compare_exchange(
                AudioState::Processing as u8,
                AudioState::Listening as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    /// Force back to Idle (e.g. on error or shutdown).
    pub fn reset(&self) {
        self.source
            .store(RecordingSource::None as u8, Ordering::Release);
        self.state.store(AudioState::Idle as u8, Ordering::Release);
    }

}

impl Default for AudioStateMachine {
    fn default() -> Self {
        Self {
            state: AtomicU8::new(AudioState::Idle as u8),
            source: AtomicU8::new(RecordingSource::None as u8),
        }
    }
}
