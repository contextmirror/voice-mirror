"""OpenAI TTS adapter for cloud synthesis."""

import asyncio
import os
import tempfile
from collections.abc import Callable

from .base import TTSAdapter
from .utils import _chunk_text


# Available OpenAI TTS voices
OPENAI_VOICES = [
    "alloy",
    "echo",
    "fable",
    "onyx",
    "nova",
    "shimmer",
]


class OpenAITTSAdapter(TTSAdapter):
    """TTS adapter using OpenAI's text-to-speech API."""

    adapter_type = "openai-tts"
    adapter_category = "cloud"
    pip_package = "openai"
    requires_api_key = True

    def __init__(self, voice: str | None = None, api_key: str | None = None, model: str = "tts-1", **kwargs):
        """
        Initialize OpenAI TTS adapter.

        Args:
            voice: OpenAI voice name (default: "alloy")
            api_key: OpenAI API key (falls back to OPENAI_API_KEY env var)
            model: OpenAI TTS model ("tts-1" or "tts-1-hd")
        """
        super().__init__(voice=voice or "alloy")
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._model = model
        self._client = None

    def load(self) -> bool:
        """Create OpenAI client."""
        try:
            import openai

            if not self._api_key:
                print("[ERR] OpenAI TTS requires an API key (set OPENAI_API_KEY or pass api_key)")
                self.model = None
                return False

            self._client = openai.OpenAI(api_key=self._api_key)
            self.model = True
            print(f"[OK] OpenAI TTS ready (voice: {self.voice}, model: {self._model})")
            return True

        except ImportError:
            print("[ERR] OpenAI TTS not available - install with: pip install openai")
            self.model = None
            return False
        except Exception as e:
            print(f"[WARN] Failed to initialize OpenAI TTS: {e}")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None,
    ) -> None:
        """Synthesize text and play audio using OpenAI TTS with chunked streaming."""
        text = self.strip_markdown(text)
        print(f"[TTS] Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        temp_files = []
        try:
            if self._client is None:
                print("[ERR] OpenAI TTS not loaded")
                return

            chunks = _chunk_text(text)
            loop = asyncio.get_event_loop()

            def _synthesize(chunk_text, idx):
                """Synthesize a chunk via OpenAI API and save to file."""
                response = self._client.audio.speech.create(
                    model=self._model,
                    voice=self.voice,
                    input=chunk_text,
                )
                audio_file = os.path.join(tempfile.gettempdir(), f"voice_mirror_tts_{idx}.mp3")
                response.stream_to_file(audio_file)
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
            print(f"[ERR] OpenAI TTS error: {e}")
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
        return f"OpenAI TTS ({self.voice})"

    @property
    def available_voices(self) -> list[str]:
        """Return available OpenAI TTS voice IDs."""
        return OPENAI_VOICES.copy()
