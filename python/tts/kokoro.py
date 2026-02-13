"""Kokoro TTS adapter."""

import asyncio
import os
from collections.abc import Callable

from .base import TTSAdapter
from .utils import _chunk_text


# Available Kokoro voices
KOKORO_VOICES = [
    "af_bella",    # American Female - Bella
    "af_nicole",   # American Female - Nicole
    "af_sarah",    # American Female - Sarah
    "af_sky",      # American Female - Sky
    "am_adam",     # American Male - Adam
    "am_michael",  # American Male - Michael
    "bf_emma",     # British Female - Emma
    "bf_isabella", # British Female - Isabella
    "bm_george",   # British Male - George
    "bm_lewis",    # British Male - Lewis
]


class KokoroAdapter(TTSAdapter):
    """TTS adapter using Kokoro ONNX for local synthesis."""

    adapter_type = "kokoro"
    adapter_category = "local"
    pip_package = "kokoro-onnx"

    def __init__(self, voice: str | None = None, **kwargs):
        """
        Initialize Kokoro adapter.

        Args:
            voice: Kokoro voice ID (default: "af_bella")
        """
        super().__init__(voice=voice or "af_bella")
        self._soundfile = None

    def load(self) -> bool:
        """Load the Kokoro TTS model."""
        try:
            import soundfile as sf
            from kokoro_onnx import Kokoro
            self._soundfile = sf

            print("Loading Kokoro TTS model...")
            print("  (First run downloads model, please wait...)")
            self.model = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
            print(f"[OK] Kokoro TTS loaded (voice: {self.voice})")
            return True
        except ImportError:
            print("[ERR] Kokoro TTS not available - install with: pip install kokoro-onnx")
            self.model = None
            return False
        except Exception as e:
            print(f"[WARN] Failed to load Kokoro TTS: {e}")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None
    ) -> None:
        """Synthesize text and play audio using Kokoro with chunked streaming."""
        # Strip markdown before speaking
        text = self.strip_markdown(text)
        print(f"[TTS] Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        temp_files = []
        try:
            if self.model is None:
                print("[ERR] Kokoro TTS not loaded")
                return

            if self._soundfile is None:
                import soundfile as sf
                self._soundfile = sf

            chunks = _chunk_text(text)
            loop = asyncio.get_event_loop()

            # Pipeline: pre-synthesize next chunk while current one plays
            next_future = None

            def _synthesize(chunk_text, idx):
                """Synthesize a chunk and write to file. Returns the file path."""
                audio_data, sample_rate = self.model.create(chunk_text, voice=self.voice)
                import tempfile
                audio_file = os.path.join(tempfile.gettempdir(), f"voice_mirror_tts_{idx}.wav")
                self._soundfile.write(audio_file, audio_data, sample_rate)
                return audio_file

            for i, chunk in enumerate(chunks):
                if self._interrupted:
                    break

                # Get audio file: either from pre-fetched future or synthesize now
                if next_future is not None:
                    audio_file = await next_future
                    next_future = None
                else:
                    audio_file = await loop.run_in_executor(
                        None, _synthesize, chunk, i
                    )

                if audio_file:
                    temp_files.append(audio_file)

                if self._interrupted:
                    break

                # Start pre-synthesizing the NEXT chunk while this one plays
                if i + 1 < len(chunks):
                    next_future = loop.run_in_executor(
                        None, _synthesize, chunks[i + 1], i + 1
                    )

                # Play this chunk (non-blocking to event loop)
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
            print(f"[ERR] Kokoro TTS error: {e}")
        finally:
            # Clean up all temp audio files
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
        return f"Kokoro ({self.voice})"

    @property
    def available_voices(self) -> list[str]:
        """Return available Kokoro voice IDs."""
        return KOKORO_VOICES.copy()
