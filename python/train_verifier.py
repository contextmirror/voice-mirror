#!/usr/bin/env python3
"""
Train a custom voice-specific verifier for "Hey Claude" wake word.

Uses OpenWakeWord's train_custom_verifier to create a personalized model
based on YOUR voice samples.
"""

import os
from pathlib import Path

from openwakeword import train_custom_verifier

# Paths
SCRIPT_DIR = Path(__file__).parent
VOICE_SAMPLES_DIR = SCRIPT_DIR / "voice_samples"
BASE_MODEL = SCRIPT_DIR / "models" / "hey_claude.onnx"
OUTPUT_MODEL = SCRIPT_DIR / "models" / "hey_claude_verifier.pkl"

def main():
    # Check for voice samples
    if not VOICE_SAMPLES_DIR.exists():
        print(f"❌ No voice samples found at {VOICE_SAMPLES_DIR}")
        print("   Run: python record_samples.py")
        return

    wav_files = list(VOICE_SAMPLES_DIR.glob("*.wav"))
    if len(wav_files) < 5:
        print(f"❌ Need at least 5 voice samples, found {len(wav_files)}")
        print("   Run: python record_samples.py")
        return

    print("=" * 50)
    print("Custom Verifier Training")
    print("=" * 50)
    print(f"Voice samples: {len(wav_files)} files")
    print(f"Base model: {BASE_MODEL}")
    print(f"Output: {OUTPUT_MODEL}")
    print()

    # Get positive clips (your voice saying "hey claude")
    positive_clips = [str(f) for f in wav_files]

    # Train the verifier
    print("Training verifier model...")
    train_custom_verifier(
        positive_clips=positive_clips,
        negative_clips=[],  # Will use built-in negative data
        output_path=str(OUTPUT_MODEL),
        model_name=str(BASE_MODEL),
    )

    print(f"\n✅ Verifier model saved to: {OUTPUT_MODEL}")
    print("\nTo use it, update voice_agent.py:")
    print("""
    from openwakeword.model import Model as OWWModel

    oww_model = OWWModel(
        wakeword_models=["models/hey_claude.onnx"],
        custom_verifier_models={"hey_claude": "models/hey_claude_verifier.pkl"},
        custom_verifier_threshold=0.3,
    )
    """)

if __name__ == "__main__":
    main()
