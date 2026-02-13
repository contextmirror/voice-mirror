"""
Tests for the double-speak race condition fix.

Verifies that the NotificationWatcher skips TTS when the voice_agent
is actively waiting for a response (inbox.awaiting_response == True)
or speaking a response (inbox.speaking_response == True).
"""

import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


class TestInboxAwaitingResponse(unittest.TestCase):
    """Test the awaiting_response flag on InboxManager."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.inbox_path = Path(self.tmpdir) / "inbox.json"
        # Write empty inbox
        with open(self.inbox_path, 'w') as f:
            json.dump({"messages": []}, f)

    def _make_inbox(self):
        from providers.inbox import InboxManager
        return InboxManager(
            inbox_path=self.inbox_path,
            ai_provider_getter=lambda: {"provider": "claude", "name": "Claude (llama3.1)"},
            sender_name_getter=lambda: "nathan",
        )

    def test_awaiting_response_starts_false(self):
        inbox = self._make_inbox()
        self.assertFalse(inbox.awaiting_response)

    def test_speaking_response_starts_false(self):
        inbox = self._make_inbox()
        self.assertFalse(inbox.speaking_response)

    def test_awaiting_response_set_during_wait(self):
        """awaiting_response should be True while wait_for_response is polling."""
        inbox = self._make_inbox()

        # Write a user message
        user_msg_id = "msg-test-user"
        with open(self.inbox_path, 'w') as f:
            json.dump({"messages": [
                {"id": user_msg_id, "from": "nathan", "message": "hello", "thread_id": "voice-mirror", "timestamp": "2026-01-01T00:00:00"}
            ]}, f)

        flag_was_true = False

        async def run_test():
            nonlocal flag_was_true

            async def check_flag():
                # Wait briefly for wait_for_response to start
                await asyncio.sleep(0.2)
                nonlocal flag_was_true
                flag_was_true = inbox.awaiting_response
                # Now write a response so wait_for_response completes
                with open(self.inbox_path, 'w') as f:
                    json.dump({"messages": [
                        {"id": user_msg_id, "from": "nathan", "message": "hello", "thread_id": "voice-mirror", "timestamp": "2026-01-01T00:00:00"},
                        {"id": "msg-response", "from": "voice-claude", "message": "hi there", "thread_id": "voice-mirror", "timestamp": "2026-01-01T00:00:01"},
                    ]}, f)

            check_task = asyncio.create_task(check_flag())
            response = await inbox.wait_for_response(user_msg_id, timeout=5.0)
            await check_task
            return response

        response = asyncio.run(run_test())
        self.assertTrue(flag_was_true, "awaiting_response should be True during wait_for_response")
        self.assertEqual(response, "hi there")
        self.assertFalse(inbox.awaiting_response, "awaiting_response should be False after wait_for_response completes")

    def test_awaiting_response_reset_on_timeout(self):
        """awaiting_response should be False after timeout."""
        inbox = self._make_inbox()

        user_msg_id = "msg-test-timeout"
        with open(self.inbox_path, 'w') as f:
            json.dump({"messages": [
                {"id": user_msg_id, "from": "nathan", "message": "hello", "thread_id": "voice-mirror", "timestamp": "2026-01-01T00:00:00"}
            ]}, f)

        async def run_test():
            response = await inbox.wait_for_response(user_msg_id, timeout=1.0)
            return response

        response = asyncio.run(run_test())
        self.assertEqual(response, "")
        self.assertFalse(inbox.awaiting_response, "awaiting_response should be False after timeout")


class TestNotificationWatcherSkipsDuringAwait(unittest.TestCase):
    """Test that NotificationWatcher skips TTS when inbox.awaiting_response is True."""

    def test_notification_watcher_skips_when_awaiting(self):
        """Simulate the race condition scenario and verify no double-speak."""
        from notifications import NotificationWatcher

        # Mock inbox
        mock_inbox = MagicMock()
        mock_inbox.awaiting_response = True
        mock_inbox.speaking_response = False
        mock_inbox.last_seen_message_id = None
        mock_inbox.get_latest_ai_message.return_value = ("msg-new", "Test response")
        mock_inbox.check_compaction_event.return_value = (None, None)

        # Mock TTS
        mock_tts = MagicMock()
        mock_tts.is_speaking = False
        mock_tts.speak = AsyncMock()

        watcher = NotificationWatcher(
            inbox=mock_inbox,
            tts=mock_tts,
            poll_interval=0.1,
            is_recording=lambda: False,
            is_processing=lambda: False,
            in_conversation=lambda: False,
        )

        speak_called = False

        async def run_test():
            nonlocal speak_called

            # Run the watcher for a few iterations
            async def stop_after_delay():
                await asyncio.sleep(0.5)
                raise asyncio.CancelledError()

            try:
                await asyncio.gather(watcher.run(), stop_after_delay())
            except asyncio.CancelledError:
                pass

            speak_called = mock_tts.speak.called

        asyncio.run(run_test())
        self.assertFalse(speak_called, "TTS should NOT be called when inbox.awaiting_response is True")

    def test_notification_watcher_skips_when_speaking(self):
        """Verify no TTS when voice_agent is speaking a response (speaking_response=True)."""
        from notifications import NotificationWatcher

        mock_inbox = MagicMock()
        mock_inbox.awaiting_response = False
        mock_inbox.speaking_response = True
        mock_inbox.last_seen_message_id = None
        mock_inbox.get_latest_ai_message.return_value = ("msg-new", "Test response")
        mock_inbox.check_compaction_event.return_value = (None, None)

        mock_tts = MagicMock()
        mock_tts.is_speaking = False
        mock_tts.speak = AsyncMock()

        watcher = NotificationWatcher(
            inbox=mock_inbox,
            tts=mock_tts,
            poll_interval=0.1,
            is_recording=lambda: False,
            is_processing=lambda: False,
            in_conversation=lambda: False,
        )

        async def run_test():
            async def stop_after_delay():
                await asyncio.sleep(0.5)
                raise asyncio.CancelledError()

            try:
                await asyncio.gather(watcher.run(), stop_after_delay())
            except asyncio.CancelledError:
                pass

        asyncio.run(run_test())
        self.assertFalse(mock_tts.speak.called, "TTS should NOT be called when inbox.speaking_response is True")

    def test_notification_watcher_speaks_when_not_awaiting(self):
        """When awaiting_response is False, NotificationWatcher should speak normally."""
        from notifications import NotificationWatcher

        mock_inbox = MagicMock()
        mock_inbox.awaiting_response = False
        mock_inbox.speaking_response = False
        mock_inbox.last_seen_message_id = None
        # First call returns None (initialization), subsequent calls return the new message
        mock_inbox.get_latest_ai_message.side_effect = [
            (None, None),  # init seed
            ("msg-new", "Test response"),  # first poll — new message
            ("msg-new", "Test response"),  # subsequent polls
            ("msg-new", "Test response"),
            ("msg-new", "Test response"),
        ]
        mock_inbox.check_compaction_event.return_value = (None, None)

        mock_tts = MagicMock()
        mock_tts.is_speaking = False
        mock_tts.speak = AsyncMock()

        watcher = NotificationWatcher(
            inbox=mock_inbox,
            tts=mock_tts,
            poll_interval=0.1,
            is_recording=lambda: False,
            is_processing=lambda: False,
            in_conversation=lambda: False,
        )

        async def run_test():
            async def stop_after_delay():
                await asyncio.sleep(0.5)
                raise asyncio.CancelledError()

            try:
                await asyncio.gather(watcher.run(), stop_after_delay())
            except asyncio.CancelledError:
                pass

        asyncio.run(run_test())
        self.assertTrue(mock_tts.speak.called, "TTS should be called when inbox.awaiting_response is False")


if __name__ == "__main__":
    unittest.main()
