"""OpenAI Whisper API STT adapter for cloud transcription."""

import asyncio
import os
import struct
import tempfile

import numpy as np

from .base import STTAdapter


class OpenAISTTAdapter(STTAdapter):
    """STT adapter using OpenAI's Whisper API for cloud transcription."""

    adapter_type = "openai-whisper-api"
    adapter_category = "cloud"
    pip_package = "openai"
    requires_api_key = True

    def __init__(self, model_name: str | None = None, api_key: str | None = None, **kwargs):
        """
        Initialize OpenAI Whisper API adapter.

        Args:
            model_name: Whisper model name (default: "whisper-1")
            api_key: OpenAI API key (falls back to OPENAI_API_KEY env var)
        """
        super().__init__(model_name=model_name or "whisper-1")
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._client = None

    async def load(self) -> bool:
        """Create OpenAI client."""
        try:
            import openai

            if not self._api_key:
                print("[ERR] OpenAI Whisper API requires an API key (set OPENAI_API_KEY or pass api_key)")
                self.model = None
                return False

            self._client = openai.OpenAI(api_key=self._api_key)
            self.model = True
            print(f"[OK] OpenAI Whisper API ready (model: {self.model_name})")
            return True

        except ImportError:
            print("[ERR] OpenAI Whisper API not available - install with: pip install openai")
            self.model = None
            return False
        except Exception as e:
            print(f"[WARN] Failed to initialize OpenAI Whisper API: {e}")
            self.model = None
            return False

    async def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe audio using OpenAI Whisper API."""
        if not self.is_loaded or self._client is None:
            return ""

        try:
            # Convert to 16-bit PCM bytes
            audio_bytes = (audio_data * 32767).astype(np.int16).tobytes()

            # Create WAV header (same pattern as parakeet.py)
            wav_header = struct.pack(
                '<4sI4s4sIHHIIHH4sI',
                b'RIFF',
                36 + len(audio_bytes),
                b'WAVE',
                b'fmt ',
                16,  # Subchunk1Size
                1,   # AudioFormat (PCM)
                1,   # NumChannels
                sample_rate,
                sample_rate * 2,  # ByteRate
                2,   # BlockAlign
                16,  # BitsPerSample
                b'data',
                len(audio_bytes),
            )
            wav_data = wav_header + audio_bytes

            # Save temp WAV file
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    f.write(wav_data)
                    temp_path = f.name

                loop = asyncio.get_event_loop()

                def _transcribe():
                    with open(temp_path, "rb") as wav_file:
                        result = self._client.audio.transcriptions.create(
                            model=self.model_name,
                            file=wav_file,
                        )
                    return result.text

                text = await loop.run_in_executor(None, _transcribe)
                return text.strip() if text else ""

            finally:
                if temp_path and os.path.exists(temp_path):
                    try:
                        os.unlink(temp_path)
                    except OSError:
                        pass

        except Exception as e:
            print(f"[ERR] OpenAI Whisper API error: {e}")
            return ""

    @property
    def name(self) -> str:
        """Return adapter name."""
        return f"OpenAI Whisper API ({self.model_name})"
