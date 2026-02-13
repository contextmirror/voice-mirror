"""Custom API STT adapter for OpenAI-compatible transcription endpoints."""

import asyncio
import io
import os
import struct
import tempfile
import urllib.request

import numpy as np

from .base import STTAdapter


class CustomAPISTTAdapter(STTAdapter):
    """STT adapter for OpenAI-compatible transcription API endpoints."""

    adapter_type = "custom-api-stt"
    adapter_category = "cloud"
    requires_api_key = True
    requires_endpoint = True

    def __init__(
        self,
        model_name: str | None = None,
        api_key: str | None = None,
        endpoint: str | None = None,
        **kwargs,
    ):
        """
        Initialize Custom API STT adapter.

        Args:
            model_name: Model name for the API (default: "whisper-1")
            api_key: API key for authentication
            endpoint: Base URL of the OpenAI-compatible API
        """
        super().__init__(model_name=model_name or "whisper-1")
        self._api_key = api_key
        self._endpoint = endpoint

    async def load(self) -> bool:
        """Verify endpoint is configured."""
        if not self._endpoint:
            print("[ERR] Custom API STT requires an endpoint URL")
            self.model = None
            return False

        if not self._api_key:
            print("[ERR] Custom API STT requires an API key")
            self.model = None
            return False

        # Normalize endpoint (strip trailing slash)
        self._endpoint = self._endpoint.rstrip("/")

        self.model = True
        print(f"[OK] Custom API STT ready (endpoint: {self._endpoint})")
        return True

    async def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe audio using custom API endpoint."""
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
                    url = f"{self._endpoint}/v1/audio/transcriptions"

                    # Build multipart form data
                    boundary = "----VoiceMirrorBoundary"
                    body = io.BytesIO()

                    # Add model field
                    body.write(f"--{boundary}\r\n".encode())
                    body.write(b"Content-Disposition: form-data; name=\"model\"\r\n\r\n")
                    body.write(f"{self.model_name}\r\n".encode())

                    # Add file field
                    body.write(f"--{boundary}\r\n".encode())
                    body.write(b"Content-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n")
                    body.write(b"Content-Type: audio/wav\r\n\r\n")
                    with open(temp_path, "rb") as wav_file:
                        body.write(wav_file.read())
                    body.write(b"\r\n")

                    # End boundary
                    body.write(f"--{boundary}--\r\n".encode())

                    body_bytes = body.getvalue()

                    req = urllib.request.Request(
                        url,
                        data=body_bytes,
                        headers={
                            "Content-Type": f"multipart/form-data; boundary={boundary}",
                            "Authorization": f"Bearer {self._api_key}",
                        },
                        method="POST",
                    )

                    with urllib.request.urlopen(req, timeout=30) as resp:
                        import json
                        result = json.loads(resp.read().decode("utf-8"))
                        return result.get("text", "")

                text = await loop.run_in_executor(None, _transcribe)
                return text.strip() if text else ""

            finally:
                if temp_path and os.path.exists(temp_path):
                    try:
                        os.unlink(temp_path)
                    except OSError:
                        pass

        except Exception as e:
            print(f"[ERR] Custom API STT error: {e}")
            return ""

    @property
    def name(self) -> str:
        """Return adapter name."""
        return f"Custom API STT ({self._endpoint})"
