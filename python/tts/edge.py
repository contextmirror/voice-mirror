"""Edge TTS adapter for free Microsoft cloud synthesis."""

import asyncio
import os
import tempfile
from collections.abc import Callable

from .base import TTSAdapter
from .utils import _chunk_text


# Available Edge TTS voices
EDGE_VOICES = [
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-AU-NatashaNeural",
]


class EdgeTTSAdapter(TTSAdapter):
    """TTS adapter using Microsoft Edge TTS (free cloud voices)."""

    adapter_type = "edge"
    adapter_category = "cloud"
    pip_package = "edge-tts"

    def __init__(self, voice: str | None = None, **kwargs):
        """
        Initialize Edge TTS adapter.

        Args:
            voice: Edge TTS voice name (default: "en-US-AriaNeural")
        """
        super().__init__(voice=voice or "en-US-AriaNeural")

    def load(self) -> bool:
        """Verify edge-tts is available."""
        try:
            import edge_tts  # noqa: F401
            self.model = True  # No model to load — just verify import
            print(f"[OK] Edge TTS ready (voice: {self.voice})")
            return True
        except ImportError:
            print("[ERR] Edge TTS not available - install with: pip install edge-tts")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None,
    ) -> None:
        """Synthesize text and play audio using Edge TTS with chunked streaming."""
        text = self.strip_markdown(text)
        print(f"[TTS] Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        temp_files = []
        try:
            if self.model is None:
                print("[ERR] Edge TTS not loaded")
                return

            import edge_tts

            chunks = _chunk_text(text)
            loop = asyncio.get_event_loop()

            async def _synthesize(chunk_text, idx):
                """Synthesize a chunk via Edge TTS and save to file."""
                audio_file = os.path.join(tempfile.gettempdir(), f"voice_mirror_tts_{idx}.wav")
                communicate = edge_tts.Communicate(chunk_text, self.voice)
                await communicate.save(audio_file)
                return audio_file

            for i, chunk in enumerate(chunks):
                if self._interrupted:
                    break

                audio_file = await _synthesize(chunk, i)

                if audio_file:
                    temp_files.append(audio_file)

                if self._interrupted:
                    break

                # Play (non-blocking to event loop)
                await loop.run_in_executor(None, self._play_audio, audio_file)

        except Exception as e:
            print(f"[ERR] Edge TTS error: {e}")
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
        return f"Edge TTS ({self.voice})"

    @property
    def available_voices(self) -> list[str]:
        """Return available Edge TTS voice IDs."""
        return EDGE_VOICES.copy()
