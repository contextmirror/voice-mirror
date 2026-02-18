//! Audio capture via cpal.
//!
//! Opens the default (or named) input device, captures audio at its native
//! sample rate, resamples to 16 kHz mono f32 if needed, and writes 1280-sample
//! chunks to a ring buffer for consumption by the processing thread.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use tracing::{error, info};

use super::ring_buffer::AudioProducer;

/// Target sample rate for the processing pipeline.
const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Chunk size in samples (80 ms at 16 kHz). Matches OpenWakeWord input.
const CHUNK_SAMPLES: usize = 1280;

/// List available input device names.
pub fn list_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for dev in devices {
            if let Ok(name) = dev.name() {
                names.push(name);
            }
        }
    }
    names
}

/// List available output device names.
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.output_devices() {
        for dev in devices {
            if let Ok(name) = dev.name() {
                names.push(name);
            }
        }
    }
    names
}

/// Resolved info about the audio input we will use.
struct CaptureConfig {
    device: cpal::Device,
    stream_config: StreamConfig,
    native_rate: u32,
}

/// Find and configure the input device.
fn resolve_device(device_name: Option<&str>) -> Result<CaptureConfig, String> {
    let host = cpal::default_host();

    let device = if let Some(name) = device_name {
        host.input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {e}"))?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            .ok_or_else(|| format!("Input device not found: {name}"))?
    } else {
        host.default_input_device()
            .ok_or_else(|| "No default input device available".to_string())?
    };

    let dev_name = device.name().unwrap_or_else(|_| "unknown".into());
    info!(device = %dev_name, "Selected input device");

    // Prefer 16 kHz if supported, otherwise use default config and resample.
    let default_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {e}"))?;

    let native_rate = default_config.sample_rate().0;
    let channels = default_config.channels();

    // We always request f32 format. Use 1 channel if possible.
    let stream_config = StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(native_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    info!(
        native_rate,
        channels,
        "Input device config (will resample to {}Hz mono if needed)",
        TARGET_SAMPLE_RATE,
    );

    Ok(CaptureConfig {
        device,
        stream_config,
        native_rate,
    })
}

/// Simple linear resampler from `from_rate` to `to_rate`.
/// Operates on mono f32 samples.
fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx.floor() as usize;
        let frac = (src_idx - idx0 as f64) as f32;
        let s0 = input.get(idx0).copied().unwrap_or(0.0);
        let s1 = input.get(idx0 + 1).copied().unwrap_or(s0);
        output.push(s0 + frac * (s1 - s0));
    }
    output
}

/// Down-mix multi-channel audio to mono by averaging channels.
fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let ch = channels as usize;
    samples
        .chunks_exact(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Start audio capture. Returns the cpal `Stream` (must be kept alive).
///
/// Audio is resampled to 16 kHz mono and pushed into the ring buffer producer.
/// `device_name` of `None` uses the system default input.
pub fn start_capture(
    mut producer: AudioProducer,
    device_name: Option<&str>,
) -> Result<Stream, String> {
    let cfg = resolve_device(device_name)?;
    let native_rate = cfg.native_rate;
    let channels = cfg.stream_config.channels;
    let needs_resample = native_rate != TARGET_SAMPLE_RATE;
    let needs_downmix = channels > 1;

    // Accumulator for building full 1280-sample chunks before pushing.
    let mut chunk_buf: Vec<f32> = Vec::with_capacity(CHUNK_SAMPLES * 2);

    let stream = cfg
        .device
        .build_input_stream(
            &cfg.stream_config,
            move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                // Convert to mono
                let mono = if needs_downmix {
                    to_mono(data, channels)
                } else {
                    data.to_vec()
                };

                // Resample to 16 kHz if needed
                let resampled = if needs_resample {
                    resample_linear(&mono, native_rate, TARGET_SAMPLE_RATE)
                } else {
                    mono
                };

                // Accumulate and push full chunks
                chunk_buf.extend_from_slice(&resampled);
                while chunk_buf.len() >= CHUNK_SAMPLES {
                    let chunk: Vec<f32> = chunk_buf.drain(..CHUNK_SAMPLES).collect();
                    let written = producer.push_slice(&chunk);
                    if written < CHUNK_SAMPLES {
                        // Ring buffer full — oldest audio will be lost.
                        // This is acceptable; the consumer will catch up.
                    }
                }
            },
            move |err| {
                error!("Audio input stream error: {}", err);
            },
            None, // no timeout
        )
        .map_err(|e| format!("Failed to build input stream: {e}"))?;

    stream.play().map_err(|e| format!("Failed to start input stream: {e}"))?;

    info!("Audio capture started");

    Ok(stream)
}
