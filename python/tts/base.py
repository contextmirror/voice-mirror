"""Base TTS adapter interface."""

import re
import subprocess
import time
from abc import ABC, abstractmethod
from collections.abc import Callable


class TTSAdapter(ABC):
    """
    Base class for Text-to-Speech adapters.

    All TTS implementations must inherit from this class and implement
    the required methods.
    """

    adapter_type: str = ""  # Override in subclasses: "kokoro", "qwen", etc.

    def __init__(self, voice: str | None = None):
        """
        Initialize the TTS adapter.

        Args:
            voice: Optional voice ID to use (adapter-dependent)
        """
        self.voice = voice
        self.volume = 1.0  # Volume multiplier (0.1–2.0, 1.0 = no change)
        self.model = None
        self._is_speaking = False
        self._playback_process = None
        self._interrupted = False

    @abstractmethod
    def load(self) -> bool:
        """
        Load the TTS model. This is synchronous as model loading
        typically happens at startup before the event loop runs.

        Returns:
            True if loaded successfully, False otherwise
        """
        pass

    @abstractmethod
    async def speak(
        self,
        text: str,
        on_start: Callable[[], None] | None = None,
        on_end: Callable[[], None] | None = None
    ) -> None:
        """
        Synthesize text and play audio.

        Args:
            text: Text to speak
            on_start: Callback when speech starts (for pausing listeners)
            on_end: Callback when speech ends (for resuming listeners)
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the display name of this adapter."""
        pass

    @property
    @abstractmethod
    def available_voices(self) -> list[str]:
        """Return list of available voice IDs for this adapter."""
        pass

    @property
    def is_loaded(self) -> bool:
        """Check if the model is loaded."""
        return self.model is not None

    @property
    def is_speaking(self) -> bool:
        """Check if currently speaking."""
        return self._is_speaking

    def stop_speaking(self) -> bool:
        """Interrupt current speech. Returns True if interrupted."""
        if not self._is_speaking:
            return False
        self._interrupted = True
        proc = self._playback_process
        if proc and proc.poll() is None:
            proc.kill()
            proc.wait(timeout=2)
        return True

    def _play_audio(self, audio_file: str) -> None:
        """Play audio via ffplay, interruptible via _interrupted flag."""
        cmd = ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"]
        if self.volume != 1.0:
            cmd.extend(["-af", f"volume={self.volume:.1f}"])
        cmd.append(audio_file)
        self._playback_process = subprocess.Popen(cmd)
        # Local copy for thread-safe polling — another thread (stop_speaking)
        # can set self._playback_process = None at any time
        proc = self._playback_process
        # Poll instead of blocking .wait() so stop_speaking() can interrupt
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                break  # Process finished naturally
            if self._interrupted:
                try:
                    proc.kill()
                except OSError:
                    pass  # Already terminated (race with stop_speaking)
                proc.wait(timeout=2)
                break
            time.sleep(0.05)  # 50ms poll interval
        else:
            # Timed out after 60s
            try:
                proc.kill()
            except OSError:
                pass
            proc.wait(timeout=2)

    def unload(self) -> None:
        """Unload the model to free memory."""
        self.model = None

    def set_voice(self, voice: str) -> bool:
        """
        Change the voice for this adapter.

        Args:
            voice: New voice ID to use

        Returns:
            True if voice was changed successfully
        """
        if voice in self.available_voices:
            self.voice = voice
            print(f"[TTS] TTS voice changed to: {voice}")
            return True
        else:
            print(f"[WARN] Unknown voice: {voice}. Available: {', '.join(self.available_voices)}")
            return False

    @staticmethod
    def strip_markdown(text: str) -> str:
        """
        Strip markdown syntax that sounds bad when spoken aloud.

        Args:
            text: Text potentially containing markdown

        Returns:
            Cleaned text suitable for TTS
        """
        # Remove headers (## Header -> Header)
        text = re.sub(r'#{1,6}\s*', '', text)
        # Remove bold (**text** -> text)
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
        # Remove italic (*text* -> text)
        text = re.sub(r'\*([^*]+)\*', r'\1', text)
        # Remove bullet points at line start
        text = re.sub(r'^[-*]\s+', '', text, flags=re.MULTILINE)
        # Remove numbered lists (1. item -> item)
        text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
        # Remove code blocks
        text = re.sub(r'```[^`]*```', '', text, flags=re.DOTALL)
        # Remove inline code (`code` -> code)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        # Remove horizontal rules
        text = re.sub(r'^---+$', '', text, flags=re.MULTILINE)
        # Clean up extra whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
