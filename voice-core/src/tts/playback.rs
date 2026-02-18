//! Audio playback via rodio.
//!
//! Plays f32 PCM audio through the default (or named) output device with volume
//! control and interruptible playback.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle, Sink};
use tracing::info;

/// Audio player that plays f32 PCM samples through an output device.
pub struct AudioPlayer {
    _stream: OutputStream,
    _stream_handle: OutputStreamHandle,
    sink: Arc<Sink>,
    playing: Arc<AtomicBool>,
}

impl AudioPlayer {
    /// Open an audio output device. If `device_name` is provided, try to find
    /// that specific device; otherwise fall back to the system default.
    pub fn new(device_name: Option<&str>) -> anyhow::Result<Self> {
        let (stream, stream_handle) = if let Some(name) = device_name {
            // Try to find the named device
            let host = cpal::default_host();
            let device = host
                .output_devices()
                .map_err(|e| anyhow::anyhow!("Failed to enumerate output devices: {e}"))?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false));

            match device {
                Some(dev) => {
                    let dev_name = dev.name().unwrap_or_else(|_| "unknown".into());
                    info!(device = %dev_name, "Selected output device");
                    OutputStream::try_from_device(&dev)
                        .map_err(|e| anyhow::anyhow!("Failed to open output device '{}': {}", name, e))?
                }
                None => {
                    info!(requested = %name, "Output device not found, falling back to default");
                    OutputStream::try_default()
                        .map_err(|e| anyhow::anyhow!("Failed to open default audio output: {}", e))?
                }
            }
        } else {
            OutputStream::try_default()
                .map_err(|e| anyhow::anyhow!("Failed to open audio output: {}", e))?
        };

        let sink = Sink::try_new(&stream_handle)
            .map_err(|e| anyhow::anyhow!("Failed to create audio sink: {}", e))?;

        Ok(Self {
            _stream: stream,
            _stream_handle: stream_handle,
            sink: Arc::new(sink),
            playing: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Set playback volume (0.0 = silent, 1.0 = full volume).
    pub fn set_volume(&self, volume: f32) {
        self.sink.set_volume(volume.clamp(0.0, 1.0));
    }

    /// Get a clonable handle to the underlying sink (for external stop).
    pub fn sink_handle(&self) -> Arc<Sink> {
        Arc::clone(&self.sink)
    }

    /// Stop current playback immediately.
    pub fn stop(&self) {
        self.sink.stop();
        self.playing.store(false, Ordering::SeqCst);
    }

    /// Check if audio is currently playing.
    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::SeqCst)
    }
}

// SAFETY: OutputStream is marked !Send due to a PhantomData<*mut ()> in cpal's
// platform abstraction.  On Windows (WASAPI) the underlying COM handles are
// apartment-threaded but we only access them from the thread that owns the
// AudioPlayer (the main/tokio thread), so sending the *struct* across threads
// is safe as long as we don't call into the stream from multiple threads
// simultaneously — which our Mutex<AppState> guarantees.
unsafe impl Send for AudioPlayer {}
