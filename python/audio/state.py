"""Shared audio state container."""

import threading
from dataclasses import dataclass, field

import numpy as np


@dataclass
class AudioState:
    """
    Shared mutable state for audio processing.

    This dataclass holds all state that needs to be shared between
    the audio callback (real-time thread) and the main async loop.

    Thread-safety: Uses a lock for audio_buffer access.
    """

    # Recording state
    is_listening: bool = True
    is_recording: bool = False
    is_processing: bool = False
    recording_source: str | None = None  # 'wake_word', 'ptt', 'call', 'follow_up'

    # Audio buffer (protected by lock)
    audio_buffer: list[np.ndarray] = field(default_factory=list)
    last_speech_time: float = 0.0

    # Push-to-talk state
    ptt_active: bool = False
    ptt_last_check: float = 0.0
    ptt_process_pending: bool = False

    # Conversation mode
    in_conversation: bool = False
    conversation_end_time: float = 0.0

    # Thread safety
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def append_audio(self, audio: np.ndarray):
        """Thread-safe append to audio buffer."""
        with self._lock:
            self.audio_buffer.append(audio)

    def get_and_clear_buffer(self) -> np.ndarray | None:
        """Thread-safe get and clear audio buffer."""
        with self._lock:
            if not self.audio_buffer:
                return None
            audio_data = np.concatenate(self.audio_buffer)
            self.audio_buffer = []
            return audio_data

    def clear_buffer(self):
        """Thread-safe clear audio buffer."""
        with self._lock:
            self.audio_buffer = []

    def start_recording(self, source: str):
        """Start recording from a specific source."""
        import time
        self.is_recording = True
        self.recording_source = source
        self.audio_buffer = []
        self.last_speech_time = time.time()

    def stop_recording(self, start_processing: bool = True):
        """Stop recording and optionally start processing."""
        self.is_recording = False
        if start_processing:
            self.is_processing = True

    def enter_conversation_mode(self, window_seconds: float = 5.0):
        """Enter conversation mode with timeout."""
        import time
        self.in_conversation = True
        self.conversation_end_time = time.time() + window_seconds

    def exit_conversation_mode(self):
        """Exit conversation mode."""
        self.in_conversation = False
        self.conversation_end_time = 0.0

    def check_conversation_expired(self) -> bool:
        """Check if conversation mode has expired."""
        import time
        if self.in_conversation and time.time() > self.conversation_end_time:
            self.in_conversation = False
            return True
        return False
