#!/usr/bin/env python3
"""
Record voice samples for custom wake word verifier training.

Run this and say "Hey Claude" when prompted. Press Enter after each recording.
Records 20 samples of you saying the wake word.
"""

import os
import time
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

# Configuration
SAMPLE_RATE = 16000
DURATION = 2.0  # seconds per sample
NUM_SAMPLES = 20
OUTPUT_DIR = Path(__file__).parent / "voice_samples"

def record_sample(index: int) -> np.ndarray:
    """Record a single sample."""
    print(f"\n[{index}/{NUM_SAMPLES}] Press Enter, then say 'Hey Claude'...")
    input()
    print("🔴 Recording...")

    audio = sd.rec(
        int(DURATION * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype=np.int16
    )
    sd.wait()

    print("✅ Done!")
    return audio.flatten()

def save_wav(audio: np.ndarray, filepath: Path):
    """Save audio as WAV file."""
    with wave.open(str(filepath), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    print("=" * 50)
    print("Voice Sample Recorder for 'Hey Claude'")
    print("=" * 50)
    print(f"\nWill record {NUM_SAMPLES} samples to: {OUTPUT_DIR}")
    print("\nInstructions:")
    print("1. Press Enter when ready")
    print("2. Say 'Hey Claude' clearly")
    print("3. Wait for 'Done!' message")
    print("\nTry varying your:")
    print("- Distance from mic (near/far)")
    print("- Volume (quiet/normal/loud)")
    print("- Speed (slow/normal/fast)")
    print("\nPress Enter to start...")
    input()

    samples = []
    for i in range(1, NUM_SAMPLES + 1):
        audio = record_sample(i)
        samples.append(audio)

        # Save immediately
        filepath = OUTPUT_DIR / f"hey_claude_{i:02d}.wav"
        save_wav(audio, filepath)
        print(f"   Saved: {filepath.name}")

    print(f"\n✅ All {NUM_SAMPLES} samples saved to {OUTPUT_DIR}")
    print("\nNow run the verifier training:")
    print("  python train_verifier.py")

if __name__ == "__main__":
    main()
