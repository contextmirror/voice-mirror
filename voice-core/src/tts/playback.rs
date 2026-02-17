//! Audio playback via rodio.
//!
//! Plays f32 PCM audio through the default output device with volume
//! control and interruptible playback.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rodio::buffer::SamplesBuffer;
use rodio::{OutputStream, OutputStreamHandle, Sink};

/// Audio player that plays f32 PCM samples through the default output device.
pub struct AudioPlayer {
    _stream: OutputStream,
    stream_handle: OutputStreamHandle,
    sink: Arc<Sink>,
    playing: Arc<AtomicBool>,
}

impl AudioPlayer {
    /// Open the default audio output device.
    pub fn new() -> anyhow::Result<Self> {
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| anyhow::anyhow!("Failed to open audio output: {}", e))?;
        let sink = Sink::try_new(&stream_handle)
            .map_err(|e| anyhow::anyhow!("Failed to create audio sink: {}", e))?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink: Arc::new(sink),
            playing: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Play f32 PCM audio samples at the given sample rate (blocking until done).
    pub fn play(&self, samples: &[f32], sample_rate: u32) -> anyhow::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }

        self.playing.store(true, Ordering::SeqCst);

        let source = SamplesBuffer::new(1, sample_rate, samples.to_vec());
        self.sink.append(source);
        self.sink.sleep_until_end();

        self.playing.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Set playback volume (0.0 = silent, 1.0 = full volume).
    pub fn set_volume(&self, volume: f32) {
        self.sink.set_volume(volume.clamp(0.0, 1.0));
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
