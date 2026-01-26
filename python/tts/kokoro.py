"""Kokoro TTS adapter."""

import asyncio
import subprocess
from pathlib import Path
from typing import Callable, List, Optional

from .base import TTSAdapter


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

    def __init__(self, voice: Optional[str] = None):
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
            from kokoro_onnx import Kokoro
            import soundfile as sf
            self._soundfile = sf

            print(f"Loading Kokoro TTS model...")
            print("  (First run downloads model, please wait...)")
            self.model = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
            print(f"✅ Kokoro TTS loaded (voice: {self.voice})")
            return True
        except ImportError:
            print("❌ Kokoro TTS not available - install with: pip install kokoro-onnx")
            self.model = None
            return False
        except Exception as e:
            print(f"⚠️ Failed to load Kokoro TTS: {e}")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Optional[Callable[[], None]] = None,
        on_end: Optional[Callable[[], None]] = None
    ) -> None:
        """Synthesize text and play audio using Kokoro."""
        # Strip markdown before speaking
        text = self.strip_markdown(text)
        print(f"🔊 Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        try:
            if self.model is None:
                print("❌ Kokoro TTS not loaded")
                return

            if self._soundfile is None:
                import soundfile as sf
                self._soundfile = sf

            # Run Kokoro in thread pool to not block async loop
            loop = asyncio.get_event_loop()
            audio_data, sample_rate = await loop.run_in_executor(
                None,
                lambda: self.model.create(text, voice=self.voice)
            )

            # Save to temp file
            audio_file = Path("/tmp/voice_mirror_tts.wav")
            self._soundfile.write(str(audio_file), audio_data, sample_rate)

            # Play using ffplay
            subprocess.run(
                ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(audio_file)],
                timeout=60
            )
        except Exception as e:
            print(f"❌ Kokoro TTS error: {e}")
        finally:
            self._is_speaking = False
            await asyncio.sleep(0.3)
            if on_end:
                on_end()

    @property
    def name(self) -> str:
        """Return display name."""
        return f"Kokoro ({self.voice})"

    @property
    def available_voices(self) -> List[str]:
        """Return available Kokoro voice IDs."""
        return KOKORO_VOICES.copy()
