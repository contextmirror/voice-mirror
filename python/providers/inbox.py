"""MCP inbox communication for Voice Mirror."""

import asyncio
import json
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path


def cleanup_inbox(inbox_path: Path, max_age_hours: float = 2.0) -> int:
    """
    Clean up old messages from the MCP inbox on startup.

    Args:
        inbox_path: Path to inbox.json
        max_age_hours: Maximum message age in hours (default 2)

    Returns:
        Number of messages removed
    """
    if not inbox_path.exists():
        return 0

    try:
        with open(inbox_path, encoding='utf-8') as f:
            data = json.load(f)

        messages = data.get("messages", [])
        if not messages:
            return 0

        cutoff = datetime.now().timestamp() - (max_age_hours * 3600)
        original_count = len(messages)

        # Filter to keep only recent messages
        recent_messages = []
        for msg in messages:
            try:
                ts = msg.get("timestamp", "")
                # Parse ISO timestamp
                msg_time = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
                if msg_time > cutoff:
                    recent_messages.append(msg)
            except (ValueError, TypeError):
                # Keep messages we can't parse (be conservative)
                recent_messages.append(msg)

        removed = original_count - len(recent_messages)

        if removed > 0:
            data["messages"] = recent_messages
            with open(inbox_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)

        return removed

    except Exception as e:
        print(f"⚠️ Inbox cleanup failed: {e}")
        return 0


# MCP-based CLI providers that use claude_send (sender will be "voice-claude")
MCP_CLI_PROVIDERS = frozenset(('claude', 'opencode', 'kimi-cli'))


class InboxManager:
    """Manages MCP inbox communication."""

    def __init__(self, inbox_path: Path, ai_provider_getter: Callable[[], dict], sender_name_getter: Callable[[], str] | None = None):
        """
        Initialize inbox manager.

        Args:
            inbox_path: Path to inbox.json file
            ai_provider_getter: Callback to get current AI provider config
            sender_name_getter: Callback to get user's configured name (default: "user")
        """
        self.inbox_path = inbox_path
        self._get_ai_provider = ai_provider_getter
        self._get_sender_name = sender_name_getter or (lambda: "user")
        self._lock = threading.Lock()
        self._last_message_hash = None
        self._last_message_time = 0.0
        self._last_seen_message_id = None
        self.awaiting_response = False  # True while wait_for_response() is active

    @staticmethod
    def _sender_matches(sender: str, provider_id: str) -> bool:
        """Check if an inbox sender matches the expected AI provider.

        MCP-based CLI providers (OpenCode, Kimi CLI) all use claude_send,
        so the sender will be "voice-claude" regardless of the actual provider.
        """
        lower = sender.lower()
        if provider_id in lower:
            return True
        # MCP CLI providers use claude_send → sender contains "claude"
        if provider_id in MCP_CLI_PROVIDERS and "claude" in lower:
            return True
        return False

    def send(self, message: str) -> str | None:
        """
        Send a message to the MCP inbox.

        Args:
            message: Message text to send

        Returns:
            Message ID if sent, None if deduplicated/skipped
        """
        with self._lock:
            # Deduplication: skip if same message within 2 seconds
            msg_hash = hash(message.strip().lower())
            now = time.time()
            if msg_hash == self._last_message_hash and (now - self._last_message_time) < 2.0:
                print(f"⏭️  Skipping duplicate: {message[:30]}...")
                return None

            self._last_message_hash = msg_hash
            self._last_message_time = now

            self.inbox_path.parent.mkdir(parents=True, exist_ok=True)

            # Load existing messages
            if self.inbox_path.exists():
                try:
                    with open(self.inbox_path, encoding='utf-8') as f:
                        data = json.load(f)
                    if "messages" not in data:
                        data = {"messages": []}
                except (json.JSONDecodeError, KeyError):
                    data = {"messages": []}
            else:
                data = {"messages": []}

            # Create new message
            msg = {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "from": self._get_sender_name(),
                "message": message,
                "timestamp": datetime.now().isoformat(),
                "thread_id": "voice-mirror",
                "read_by": []
            }

            data["messages"].append(msg)

            with open(self.inbox_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)

            print(f"📬 Sent to inbox: {message[:50]}...")
            return msg["id"]

    async def wait_for_response(self, my_message_id: str, timeout: float = 60.0) -> str:
        """
        Wait for AI provider to respond to our message.

        Args:
            my_message_id: ID of the message we sent
            timeout: Maximum wait time in seconds

        Returns:
            Response text, or empty string on timeout
        """
        ai_provider = self._get_ai_provider()
        print(f"⏳ Waiting for {ai_provider['name']} to respond...")

        self.awaiting_response = True
        start_time = time.time()
        poll_interval = 0.5  # Check every 500ms

        try:
            return await self._poll_for_response(ai_provider, my_message_id, timeout, start_time, poll_interval)
        finally:
            self.awaiting_response = False

    async def _poll_for_response(self, ai_provider, my_message_id, timeout, start_time, poll_interval):
        """Internal polling loop for wait_for_response."""
        while (time.time() - start_time) < timeout:
            await asyncio.sleep(poll_interval)

            with self._lock:
                if not self.inbox_path.exists():
                    continue

                try:
                    with open(self.inbox_path, encoding='utf-8') as f:
                        data = json.load(f)
                except (json.JSONDecodeError, KeyError):
                    continue

                messages = data.get("messages", [])

                # Find my message index
                my_msg_idx = None
                for i, msg in enumerate(messages):
                    if msg.get("id") == my_message_id:
                        my_msg_idx = i
                        break

                if my_msg_idx is None:
                    continue

                # Look for AI provider's response after my message
                provider_id = ai_provider['provider']
                for msg in messages[my_msg_idx + 1:]:
                    sender = msg.get("from", "")
                    # Accept responses from the configured AI provider
                    if self._sender_matches(sender, provider_id) and msg.get("thread_id") == "voice-mirror":
                        response = msg.get("message", "")
                        if response:
                            print(f"✅ Got response from {sender}")
                            # Mark as seen so notification watcher doesn't repeat it
                            self._last_seen_message_id = msg.get("id")
                            return response

        print("⏰ Timeout waiting for AI response")
        return ""

    def write_response(self, response: str):
        """
        Write an AI response to the inbox.

        Args:
            response: Response text to write
        """
        with self._lock:
            if self.inbox_path.exists():
                try:
                    with open(self.inbox_path, encoding='utf-8') as f:
                        data = json.load(f)
                except Exception:
                    data = {"messages": []}
            else:
                data = {"messages": []}

            ai_provider = self._get_ai_provider()
            provider_id = ai_provider['provider']
            msg = {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "from": f"{provider_id}-voice",
                "message": response,
                "timestamp": datetime.now().isoformat(),
                "thread_id": "voice-mirror",
                "read_by": []
            }

            data["messages"].append(msg)

            with open(self.inbox_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)

            print("📬 Response saved to inbox")

    def get_latest_ai_message(self) -> tuple[str | None, str | None]:
        """
        Get the latest AI provider message from inbox.

        Returns:
            Tuple of (message_id, message_text) or (None, None) if no message
        """
        with self._lock:
            if not self.inbox_path.exists():
                return None, None

            try:
                with open(self.inbox_path, encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, KeyError):
                return None, None

            messages = data.get("messages", [])
            if not messages:
                return None, None

            # Find the latest AI provider message in voice-mirror thread
            ai_provider = self._get_ai_provider()
            provider_id = ai_provider['provider']
            for msg in reversed(messages):
                sender = msg.get("from", "")
                if self._sender_matches(sender, provider_id) and msg.get("thread_id") == "voice-mirror":
                    return msg.get("id"), msg.get("message", "")

            return None, None

    def check_compaction_event(self) -> tuple[str | None, dict | None]:
        """
        Check if there's a pending compaction event in inbox.

        Returns:
            Tuple of (event_id, event_data) or (None, None) if no event
        """
        with self._lock:
            if not self.inbox_path.exists():
                return None, None

            try:
                with open(self.inbox_path, encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, KeyError):
                return None, None

            messages = data if isinstance(data, list) else data.get("messages", [])
            if not messages:
                return None, None

            # Find unread compaction events
            for msg in reversed(messages):
                if msg.get("type") == "system_event" and msg.get("event") == "pre_compact":
                    if not msg.get("read", False):
                        return msg.get("id"), msg

            return None, None

    def mark_compaction_read(self, event_id: str):
        """
        Mark a compaction event as read.

        Args:
            event_id: ID of the compaction event to mark
        """
        with self._lock:
            if not self.inbox_path.exists():
                return

            try:
                with open(self.inbox_path, encoding='utf-8') as f:
                    data = json.load(f)

                messages = data if isinstance(data, list) else data.get("messages", [])

                for msg in messages:
                    if msg.get("id") == event_id:
                        msg["read"] = True
                        break

                with open(self.inbox_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                print(f"⚠️ Error marking compaction read: {e}")

    @property
    def last_seen_message_id(self) -> str | None:
        """Get the last seen message ID."""
        return self._last_seen_message_id

    @last_seen_message_id.setter
    def last_seen_message_id(self, value: str | None):
        """Set the last seen message ID."""
        self._last_seen_message_id = value
