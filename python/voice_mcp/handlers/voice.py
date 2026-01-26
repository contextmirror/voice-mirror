"""
Voice Tool Handler for Voice Mirror MCP

Provides voice control and status tools.
"""

import json
import asyncio
from pathlib import Path
from typing import Any, Dict
from datetime import datetime


# MCP inbox path for Voice Mirror
INBOX_PATH = Path.home() / ".config" / "voice-mirror-electron" / "data" / "inbox.json"


class VoiceToolHandler:
    """Handle voice-related operations."""

    def __init__(self):
        pass

    async def handle(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Route tool call to appropriate method."""
        handlers = {
            "voice_status": self._get_status,
            "voice_speak": self._speak,
        }

        handler = handlers.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}

        try:
            return await handler(args)
        except Exception as e:
            return {"error": str(e)}

    async def _get_status(self, args: Dict) -> Dict:
        """Get Voice Mirror status."""
        # Check if Voice Mirror is likely running by checking for recent messages
        status = {
            "service": "Voice Mirror",
            "status": "unknown",
            "features": {
                "wake_word": "Hey Claude",
                "stt_engine": "Parakeet (NVIDIA)",
                "tts_engine": "Kokoro",
                "smart_home": True,
                "web_search": True,
                "n8n_integration": True
            }
        }

        # Check inbox for recent voice messages
        if INBOX_PATH.exists():
            try:
                with open(INBOX_PATH, 'r') as f:
                    data = json.load(f)

                messages = data.get("messages", [])
                voice_messages = [
                    m for m in messages
                    if m.get("from") == "nathan" or m.get("thread_id") == "voice-mirror"
                ]

                if voice_messages:
                    # Get most recent
                    latest = max(voice_messages, key=lambda m: m.get("timestamp", ""))
                    status["last_voice_activity"] = latest.get("timestamp")
                    status["status"] = "active"
                else:
                    status["status"] = "idle"
            except Exception:
                status["status"] = "unknown"

        return {"success": True, **status}

    async def _speak(self, args: Dict) -> Dict:
        """Send a message to be spoken by Voice Mirror TTS."""
        message = args.get("message", "")

        if not message:
            return {"error": "message required"}

        # Write to inbox for Voice Mirror to pick up
        try:
            if INBOX_PATH.exists():
                with open(INBOX_PATH, 'r') as f:
                    data = json.load(f)
            else:
                INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
                data = {"messages": []}

            import uuid
            msg = {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "from": "claude-code",
                "type": "tts_request",
                "message": message,
                "timestamp": datetime.now().isoformat(),
                "thread_id": "voice-mirror",
                "read_by": []
            }

            data["messages"].append(msg)

            with open(INBOX_PATH, 'w') as f:
                json.dump(data, f, indent=2)

            return {
                "success": True,
                "message": "TTS request sent to Voice Mirror",
                "text": message[:100] + "..." if len(message) > 100 else message
            }

        except Exception as e:
            return {"error": f"Failed to send TTS request: {e}"}
