"""Whisper STT adapters (OpenAI Whisper and Faster-Whisper)."""

import asyncio

import numpy as np

from .base import STTAdapter


class WhisperAdapter(STTAdapter):
    """
    OpenAI Whisper adapter using the official openai-whisper library.

    More accurate but slower than Parakeet. Good for testing transcription quality.
    Default model: base (good balance of speed/accuracy)

    Available models: tiny, base, small, medium, large
    """

    adapter_type = "whisper"
    adapter_category = "local"
    pip_package = "openai-whisper"

    def __init__(self, model_name: str | None = None, **kwargs):
        super().__init__(model_name or "base")

    async def load(self) -> bool:
        """Load the Whisper model."""
        try:
            import whisper

            print(f"Loading Whisper model ({self.model_name})...")
            loop = asyncio.get_event_loop()
            self.model = await loop.run_in_executor(
                None,
                lambda: whisper.load_model(self.model_name)
            )
            print(f"[OK] Whisper loaded ({self.model_name})")
            return True

        except ImportError:
            print("[ERR] Whisper not available - install with: pip install openai-whisper")
            return False
        except Exception as e:
            print(f"[WARN] Failed to load Whisper: {e}")
            return False

    async def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe audio using Whisper."""
        if not self.is_loaded:
            return ""

        try:
            # Whisper expects float32 audio normalized to [-1, 1]
            # If sample_rate isn't 16kHz, Whisper will resample internally

            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self.model.transcribe(
                    audio_data,
                    language="en",
                    fp16=False  # Use FP32 for CPU compatibility
                )
            )

            text = result.get("text", "").strip()
            return text

        except Exception as e:
            print(f"[ERR] Whisper STT error: {e}")
            return ""

    @property
    def name(self) -> str:
        """Return adapter name."""
        return f"Whisper ({self.model_name})"


class FasterWhisperAdapter(STTAdapter):
    """
    Faster-Whisper adapter using CTranslate2 (optimized Whisper).

    Faster than openai-whisper with similar accuracy. Best of both worlds.
    Default model: base

    Available models: tiny, base, small, medium, large-v2, large-v3
    """

    adapter_type = "faster-whisper"
    adapter_category = "local"
    pip_package = "faster-whisper"

    def __init__(self, model_name: str | None = None, **kwargs):
        super().__init__(model_name or "base")
        self.device = "auto"  # auto-detect CUDA or CPU

    async def load(self) -> bool:
        """Load the Faster-Whisper model."""
        try:
            from faster_whisper import WhisperModel

            print(f"Loading Faster-Whisper model ({self.model_name})...")

            # Try CUDA first, fall back to CPU
            try:
                loop = asyncio.get_event_loop()
                self.model = await loop.run_in_executor(
                    None,
                    lambda: WhisperModel(
                        self.model_name,
                        device="cuda",
                        compute_type="float16"
                    )
                )
                self.device = "cuda"
                print(f"[OK] Faster-Whisper loaded ({self.model_name}, GPU)")
                return True
            except Exception:
                # Fall back to CPU
                loop = asyncio.get_event_loop()
                self.model = await loop.run_in_executor(
                    None,
                    lambda: WhisperModel(
                        self.model_name,
                        device="cpu",
                        compute_type="int8"
                    )
                )
                self.device = "cpu"
                print(f"[OK] Faster-Whisper loaded ({self.model_name}, CPU)")
                return True

        except ImportError:
            print("[ERR] Faster-Whisper not available - install with: pip install faster-whisper")
            return False
        except Exception as e:
            print(f"[WARN] Failed to load Faster-Whisper: {e}")
            return False

    async def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe audio using Faster-Whisper."""
        if not self.is_loaded:
            return ""

        try:
            # Faster-Whisper expects float32 normalized to [-1, 1]
            loop = asyncio.get_event_loop()

            def _transcribe():
                segments, info = self.model.transcribe(
                    audio_data,
                    language="en",
                    beam_size=5,
                    vad_filter=True  # Voice activity detection to skip silence
                )
                # Combine all segments
                return " ".join([segment.text for segment in segments]).strip()

            text = await loop.run_in_executor(None, _transcribe)
            return text

        except Exception as e:
            print(f"[ERR] Faster-Whisper STT error: {e}")
            return ""

    @property
    def name(self) -> str:
        """Return adapter name."""
        return f"Faster-Whisper ({self.model_name}, {self.device.upper()})"
