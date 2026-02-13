"""Piper TTS adapter for fast local synthesis."""

import asyncio
import os
import struct
import tempfile
from collections.abc import Callable

from .base import TTSAdapter
from .utils import _chunk_text


# Available Piper voices
PIPER_VOICES = [
    "en_US-amy-medium",
    "en_US-lessac-medium",
    "en_US-libritts_r-medium",
    "en_GB-cori-medium",
    "en_GB-alan-medium",
]


class PiperAdapter(TTSAdapter):
    """TTS adapter using Piper for fast, lightweight local synthesis."""

    adapter_type = "piper"
    adapter_category = "local"
    pip_package = "piper-tts"
    supports_model_path = True

    def __init__(self, voice: str | None = None, model_path: str | None = None, **kwargs):
        """
        Initialize Piper adapter.

        Args:
            voice: Piper voice name (default: "en_US-amy-medium")
            model_path: Optional path to a local .onnx model file
        """
        super().__init__(voice=voice or "en_US-amy-medium")
        self._model_path = model_path

    def load(self) -> bool:
        """Load the Piper TTS model."""
        try:
            from piper import PiperVoice

            print(f"Loading Piper TTS model ({self.voice})...")

            if self._model_path:
                print(f"  Loading from: {self._model_path}")
                self.model = PiperVoice.load(self._model_path)
            else:
                # Auto-download model by voice name
                from piper.download import ensure_voice_exists, find_voice, get_voices

                data_dir = os.path.join(os.path.expanduser("~"), ".local", "share", "piper_tts")
                os.makedirs(data_dir, exist_ok=True)

                print("  (First run downloads voice model, please wait...)")
                voices_info = get_voices(data_dir, update_voices=True)
                ensure_voice_exists(self.voice, data_dir, data_dir, voices_info)
                model_path, config_path = find_voice(self.voice, data_dir)
                self.model = PiperVoice.load(model_path, config_path=config_path)

            print(f"[OK] Piper TTS loaded (voice: {self.voice})")
            return True

        except ImportError:
            print("[ERR] Piper TTS not available - install with: pip install piper-tts")
            self.model = None
            return False
        except Exception as e:
            print(f"[WARN] Failed to load Piper TTS: {e}")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None,
    ) -> None:
        """Synthesize text and play audio using Piper with chunked streaming."""
        text = self.strip_markdown(text)
        print(f"[TTS] Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        temp_files = []
        try:
            if self.model is None:
                print("[ERR] Piper TTS not loaded")
                return

            chunks = _chunk_text(text)
            loop = asyncio.get_event_loop()

            def _synthesize(chunk_text, idx):
                """Synthesize a chunk and write to file. Returns file path."""
                # Piper outputs raw PCM audio — build WAV manually
                audio_bytes = b""
                for audio_chunk in self.model.synthesize_stream_raw(chunk_text):
                    audio_bytes += audio_chunk

                # Build WAV file with proper header
                sample_rate = self.model.config.sample_rate
                sample_width = 2  # 16-bit PCM
                num_channels = 1
                wav_header = struct.pack(
                    '<4sI4s4sIHHIIHH4sI',
                    b'RIFF',
                    36 + len(audio_bytes),
                    b'WAVE',
                    b'fmt ',
                    16,  # Subchunk1Size
                    1,   # AudioFormat (PCM)
                    num_channels,
                    sample_rate,
                    sample_rate * num_channels * sample_width,  # ByteRate
                    num_channels * sample_width,  # BlockAlign
                    sample_width * 8,  # BitsPerSample
                    b'data',
                    len(audio_bytes),
                )

                audio_file = os.path.join(tempfile.gettempdir(), f"voice_mirror_tts_{idx}.wav")
                with open(audio_file, "wb") as f:
                    f.write(wav_header + audio_bytes)
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
            print(f"[ERR] Piper TTS error: {e}")
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
        return f"Piper ({self.voice})"

    @property
    def available_voices(self) -> list[str]:
        """Return available Piper voice IDs."""
        return PIPER_VOICES.copy()
