"""ElevenLabs TTS adapter for high-quality cloud synthesis."""

import asyncio
import os
import tempfile
from collections.abc import Callable

from .base import TTSAdapter
from .utils import _chunk_text


# Available ElevenLabs voices (default voice IDs)
ELEVENLABS_VOICES = [
    "Rachel",
    "Domi",
    "Bella",
    "Antoni",
    "Elli",
    "Josh",
    "Arnold",
    "Adam",
    "Sam",
]


class ElevenLabsAdapter(TTSAdapter):
    """TTS adapter using ElevenLabs for high-quality cloud synthesis."""

    adapter_type = "elevenlabs"
    adapter_category = "cloud"
    pip_package = "elevenlabs"
    requires_api_key = True

    def __init__(self, voice: str | None = None, api_key: str | None = None, **kwargs):
        """
        Initialize ElevenLabs adapter.

        Args:
            voice: ElevenLabs voice name or ID (default: "Rachel")
            api_key: ElevenLabs API key (falls back to ELEVENLABS_API_KEY env var)
        """
        super().__init__(voice=voice or "Rachel")
        self._api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
        self._client = None

    def load(self) -> bool:
        """Create ElevenLabs client."""
        try:
            from elevenlabs.client import ElevenLabs

            if not self._api_key:
                print("[ERR] ElevenLabs TTS requires an API key (set ELEVENLABS_API_KEY or pass api_key)")
                self.model = None
                return False

            self._client = ElevenLabs(api_key=self._api_key)
            self.model = True
            print(f"[OK] ElevenLabs TTS ready (voice: {self.voice})")
            return True

        except ImportError:
            print("[ERR] ElevenLabs TTS not available - install with: pip install elevenlabs")
            self.model = None
            return False
        except Exception as e:
            print(f"[WARN] Failed to initialize ElevenLabs TTS: {e}")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None,
    ) -> None:
        """Synthesize text and play audio using ElevenLabs with chunked streaming."""
        text = self.strip_markdown(text)
        print(f"[TTS] Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        temp_files = []
        try:
            if self._client is None:
                print("[ERR] ElevenLabs TTS not loaded")
                return

            chunks = _chunk_text(text)
            loop = asyncio.get_event_loop()

            def _synthesize(chunk_text, idx):
                """Synthesize a chunk via ElevenLabs API and save to file."""
                audio_iterator = self._client.text_to_speech.convert(
                    text=chunk_text,
                    voice_id=self.voice,
                    output_format="mp3_44100_128",
                )
                audio_file = os.path.join(tempfile.gettempdir(), f"voice_mirror_tts_{idx}.mp3")
                with open(audio_file, "wb") as f:
                    for audio_chunk in audio_iterator:
                        f.write(audio_chunk)
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
            print(f"[ERR] ElevenLabs TTS error: {e}")
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
        return f"ElevenLabs ({self.voice})"

    @property
    def available_voices(self) -> list[str]:
        """Return available ElevenLabs voice names."""
        return ELEVENLABS_VOICES.copy()
