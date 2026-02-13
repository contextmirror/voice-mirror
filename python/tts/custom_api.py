"""Custom API TTS adapter for OpenAI-compatible endpoints."""

import asyncio
import json
import os
import tempfile
import urllib.request
from collections.abc import Callable

from .base import TTSAdapter
from .utils import _chunk_text


class CustomAPITTSAdapter(TTSAdapter):
    """TTS adapter for OpenAI-compatible TTS API endpoints."""

    adapter_type = "custom-api"
    adapter_category = "cloud"
    requires_api_key = True
    requires_endpoint = True

    def __init__(
        self,
        voice: str | None = None,
        api_key: str | None = None,
        endpoint: str | None = None,
        model: str = "tts-1",
        **kwargs,
    ):
        """
        Initialize Custom API TTS adapter.

        Args:
            voice: Voice name for the API (default: "default")
            api_key: API key for authentication
            endpoint: Base URL of the OpenAI-compatible API
            model: Model name to use (default: "tts-1")
        """
        super().__init__(voice=voice or "default")
        self._api_key = api_key
        self._endpoint = endpoint
        self._model = model

    def load(self) -> bool:
        """Verify endpoint is configured."""
        if not self._endpoint:
            print("[ERR] Custom API TTS requires an endpoint URL")
            self.model = None
            return False

        if not self._api_key:
            print("[ERR] Custom API TTS requires an API key")
            self.model = None
            return False

        # Normalize endpoint (strip trailing slash)
        self._endpoint = self._endpoint.rstrip("/")

        self.model = True
        print(f"[OK] Custom API TTS ready (endpoint: {self._endpoint})")
        return True

    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None,
    ) -> None:
        """Synthesize text and play audio using custom API with chunked streaming."""
        text = self.strip_markdown(text)
        print(f"[TTS] Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        temp_files = []
        try:
            if self.model is None:
                print("[ERR] Custom API TTS not loaded")
                return

            chunks = _chunk_text(text)
            loop = asyncio.get_event_loop()

            def _synthesize(chunk_text, idx):
                """Synthesize a chunk via API and save to file."""
                url = f"{self._endpoint}/v1/audio/speech"
                payload = json.dumps({
                    "model": self._model,
                    "voice": self.voice,
                    "input": chunk_text,
                }).encode("utf-8")

                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self._api_key}",
                    },
                    method="POST",
                )

                audio_file = os.path.join(tempfile.gettempdir(), f"voice_mirror_tts_{idx}.mp3")
                with urllib.request.urlopen(req, timeout=30) as resp:
                    with open(audio_file, "wb") as f:
                        while True:
                            chunk = resp.read(8192)
                            if not chunk:
                                break
                            f.write(chunk)
                return audio_file

            next_future = None

            for i, chunk in enumerate(chunks):
                if self._interrupted:
                    break

                if next_future is not None:
                    audio_file = await next_future
                    next_future = None
                else:
                    audio_file = await loop.run_in_executor(None, _synthesize, chunk, i)

                if audio_file:
                    temp_files.append(audio_file)

                if self._interrupted:
                    break

                # Pre-synthesize next chunk while this one plays
                if i + 1 < len(chunks):
                    next_future = loop.run_in_executor(None, _synthesize, chunks[i + 1], i + 1)

                await loop.run_in_executor(None, self._play_audio, audio_file)

            # Collect any remaining pre-synthesized file
            if next_future is not None:
                try:
                    remaining = await next_future
                    if remaining:
                        temp_files.append(remaining)
                except Exception:
                    pass

        except Exception as e:
            print(f"[ERR] Custom API TTS error: {e}")
        finally:
            for f in temp_files:
                try:
                    if os.path.exists(f):
                        os.unlink(f)
                except OSError:
                    pass
            self._playback_process = None
            self._is_speaking = False
            was_interrupted = self._interrupted
            self._interrupted = False
            if not was_interrupted:
                await asyncio.sleep(0.3)
            if on_end and not was_interrupted:
                on_end()

    @property
    def name(self) -> str:
        """Return display name."""
        return f"Custom API ({self._endpoint})"

    @property
    def available_voices(self) -> list[str]:
        """Return available voices (user-configurable)."""
        return ["default"]
