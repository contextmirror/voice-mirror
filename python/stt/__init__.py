"""
STT (Speech-to-Text) adapters for Voice Mirror.

Provides a flexible system for swapping between different transcription models.
Each adapter implements the same interface, making it easy to test and compare.

Available adapters:
- ParakeetAdapter: Fast local model (nemo-parakeet-tdt-0.6b-v2)
- WhisperAdapter: OpenAI Whisper via openai-whisper library
- FasterWhisperAdapter: Optimized Whisper via faster-whisper library

Usage:
    from stt import create_stt_adapter

    adapter = create_stt_adapter("parakeet")  # or "whisper", "faster-whisper"
    text = await adapter.transcribe(audio_data, sample_rate=16000)
"""

from .base import STTAdapter
from .factory import create_stt_adapter, list_available_adapters

__all__ = ["STTAdapter", "create_stt_adapter", "list_available_adapters"]
