"""Parakeet STT adapter (NVIDIA NeMo model via onnx-asr)."""

import asyncio
import os
import struct
import tempfile

import numpy as np

from .base import STTAdapter


class ParakeetAdapter(STTAdapter):
    """
    Parakeet STT adapter using NVIDIA's NeMo Parakeet model.

    Fast local transcription with GPU acceleration support.
    Default model: nemo-parakeet-tdt-0.6b-v2
    """

    adapter_type = "parakeet"
    adapter_category = "local"
    pip_package = "onnx-asr"

    def __init__(self, model_name: str | None = None, **kwargs):
        super().__init__(model_name or "nemo-parakeet-tdt-0.6b-v2")
        self.supports_gpu = False

    async def load(self) -> bool:
        """Load the Parakeet model."""
        try:
            import onnx_asr

            print(f"Loading Parakeet STT model ({self.model_name})...")

            # Load with CPU provider (CUDA/Blackwell sm_120 not yet supported in ONNX Runtime)
            # RTX 50xx series requires custom builds or future ONNX Runtime versions
            self.model = onnx_asr.load_model(
                self.model_name,
                providers=["CPUExecutionProvider"]
            )
            self.supports_gpu = False
            print("[OK] Parakeet loaded (CPU mode)")
            return True

        except ImportError:
            print("[ERR] Parakeet STT not available - install with: pip install onnx-asr[gpu,hub]")
            return False

    async def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe audio using Parakeet."""
        if not self.is_loaded:
            return ""

        try:
            # Convert to 16-bit PCM bytes
            audio_bytes = (audio_data * 32767).astype(np.int16).tobytes()

            # Create WAV header
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
                len(audio_bytes)
            )
            wav_data = wav_header + audio_bytes

            # Save temp WAV file for onnx-asr
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    f.write(wav_data)
                    temp_path = f.name

                # Run in thread pool to not block async loop
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: self.model.recognize(temp_path)
                )

                if result and result.strip():
                    return result.strip()
                return ""
            finally:
                if temp_path and os.path.exists(temp_path):
                    try:
                        os.unlink(temp_path)
                    except OSError:
                        pass

        except Exception as e:
            print(f"[ERR] Parakeet STT error: {e}")
            return ""

    @property
    def name(self) -> str:
        """Return adapter name."""
        gpu_status = "GPU" if self.supports_gpu else "CPU"
        return f"Parakeet ({self.model_name}) - {gpu_status}"
