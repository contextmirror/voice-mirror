"""Background notification watcher for Voice Mirror."""

import asyncio
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

from providers.config import strip_provider_prefix

if TYPE_CHECKING:
    from providers.inbox import InboxManager
    from tts.base import TTSAdapter


class NotificationWatcher:
    """
    Background task that watches inbox for new AI messages.
    Speaks them via TTS even when not in active voice conversation.
    Also handles compaction events from PreCompact hook.
    """

    def __init__(
        self,
        inbox: "InboxManager",
        tts: "TTSAdapter",
        poll_interval: float = 2.0,
        # State checkers (callbacks to check VoiceMirror state)
        is_recording: Callable[[], bool] = lambda: False,
        is_processing: Callable[[], bool] = lambda: False,
        in_conversation: Callable[[], bool] = lambda: False,
        # Actions
        provider_refresh: Callable[[], None] | None = None,
        get_listening_status: Callable[[], str] = lambda: "[LISTEN] Listening...",
        get_ai_provider_name: Callable[[], str] = lambda: "Claude",
        # TTS callbacks for state management
        on_speech_start: Callable[[], None] | None = None,
        on_speech_end: Callable[[bool], None] | None = None,  # arg: enter_conversation_mode
    ):
        """
        Initialize notification watcher.

        Args:
            inbox: InboxManager instance
            tts: TTSAdapter instance
            poll_interval: How often to check for new messages (seconds)
            is_recording: Callback to check if currently recording
            is_processing: Callback to check if currently processing
            in_conversation: Callback to check if in active conversation
            provider_refresh: Callback to refresh AI provider config
            get_listening_status: Callback to get current listening status message
            get_ai_provider_name: Callback to get AI provider display name
            on_speech_start: Callback when TTS starts
            on_speech_end: Callback when TTS ends (with enter_conversation_mode flag)
        """
        self.inbox = inbox
        self.tts = tts
        self.poll_interval = poll_interval

        # State checkers
        self._is_recording = is_recording
        self._is_processing = is_processing
        self._in_conversation = in_conversation

        # Actions
        self._refresh_provider = provider_refresh
        self._get_listening_status = get_listening_status
        self._get_ai_provider_name = get_ai_provider_name
        self._on_speech_start = on_speech_start
        self._on_speech_end = on_speech_end

        # Internal compaction tracking
        self._awaiting_compact_resume = False
        self._compact_start_time = None

    async def run(self):
        """Main notification watching loop."""
        print("[NOTIFY] Notification watcher started")

        # Initialize with current latest message (don't speak old ones)
        msg_id, _ = self.inbox.get_latest_ai_message()
        self.inbox.last_seen_message_id = msg_id

        # Track current provider to detect switches
        last_provider_name = self._get_ai_provider_name()

        while True:
            try:
                await asyncio.sleep(self.poll_interval)

                # Refresh provider config periodically in case user changed it
                if self._refresh_provider:
                    self._refresh_provider()

                # Detect provider switch — reseed last_seen to avoid speaking
                # stale messages from the new provider's old inbox history
                current_provider_name = self._get_ai_provider_name()
                if current_provider_name != last_provider_name:
                    print(f"[NOTIFY] Provider switched ({last_provider_name} -> {current_provider_name}), reseeding notification state")
                    msg_id, _ = self.inbox.get_latest_ai_message()
                    self.inbox.last_seen_message_id = msg_id
                    last_provider_name = current_provider_name
                    # Reset compaction state — old provider's compact is irrelevant
                    self._awaiting_compact_resume = False
                    self._compact_start_time = None
                    continue

                # Check for compaction events first (high priority)
                compact_id, compact_event = self.inbox.check_compaction_event()
                if compact_id and not self._awaiting_compact_resume:
                    self._awaiting_compact_resume = True
                    self._compact_start_time = time.time()
                    self.inbox.mark_compaction_read(compact_id)
                    provider_name = self._get_ai_provider_name()
                    print(f"\n[WAIT] {provider_name} is reorganizing context... conversation will resume shortly")
                    # Optionally speak a brief notification
                    if not self.tts.is_speaking:
                        await self._speak("One moment, I'm reorganizing my thoughts.", enter_conversation_mode=False)
                    continue

                # If awaiting compact resume, check for AI response
                if self._awaiting_compact_resume:
                    # Timeout after 60 seconds
                    if time.time() - self._compact_start_time > 60:
                        print("[WARN] Compact resume timeout - AI may need a nudge")
                        self._awaiting_compact_resume = False
                        continue

                    # Check if AI provider has responded (compact finished)
                    msg_id, message = self.inbox.get_latest_ai_message()
                    if msg_id and msg_id != self.inbox.last_seen_message_id and message:
                        self.inbox.last_seen_message_id = msg_id
                        self._awaiting_compact_resume = False
                        provider_name = self._get_ai_provider_name()
                        print(f"\n[OK] {provider_name} resumed after compaction!")
                        clean_message = strip_provider_prefix(message)
                        await self._speak(clean_message, enter_conversation_mode=True)
                        print(f"\n{self._get_listening_status()}")
                    continue

                # Skip if currently speaking, recording, or processing
                if self.tts.is_speaking or self._is_recording() or self._is_processing():
                    continue

                # Skip if voice_agent is actively waiting for a response
                # (it will handle TTS itself — avoids double-speak race condition)
                if self.inbox.awaiting_response:
                    continue

                # Skip if in active conversation mode (user is interacting)
                if self._in_conversation():
                    continue

                # Check for new AI message
                msg_id, message = self.inbox.get_latest_ai_message()

                if msg_id and msg_id != self.inbox.last_seen_message_id and message:
                    self.inbox.last_seen_message_id = msg_id
                    provider_name = self._get_ai_provider_name()
                    print(f"\n[NOTIFY] New notification from {provider_name}!")
                    # Strip provider prefix and speak (it's a notification)
                    clean_message = strip_provider_prefix(message)
                    await self._speak(clean_message, enter_conversation_mode=False)
                    print(f"\n{self._get_listening_status()}")

            except Exception as e:
                print(f"[WARN] Notification watcher error: {e}")
                await asyncio.sleep(5)  # Back off on error

    async def _speak(self, text: str, enter_conversation_mode: bool):
        """
        Speak text via TTS with proper callbacks.

        Args:
            text: Text to speak
            enter_conversation_mode: Whether to enter conversation mode after
        """
        await self.tts.speak(
            text,
            on_start=self._on_speech_start,
            on_end=lambda: self._on_speech_end(enter_conversation_mode) if self._on_speech_end else None
        )
