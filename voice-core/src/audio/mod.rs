//! Audio capture, state management, and ring buffer.

pub mod capture;
pub mod ring_buffer;
pub mod state;

pub use capture::{list_devices, start_capture};
pub use ring_buffer::{audio_ring_buffer, AudioConsumer};
pub use state::{AudioState, AudioStateMachine, RecordingSource};
