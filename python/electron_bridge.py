#!/usr/bin/env python3
"""
Electron Bridge for Voice Mirror

Wraps VoiceMirror with JSON IPC for communication with Electron.
Outputs structured JSON events to stdout, reads commands from stdin.

Usage:
    python electron_bridge.py

Events sent to Electron (stdout):
    {"event": "ready", "data": {...}}
    {"event": "wake_word", "data": {"model": "hey_claude", "score": 0.98}}
    {"event": "recording_start", "data": {}}
    {"event": "recording_stop", "data": {}}
    {"event": "transcription", "data": {"text": "..."}}
    {"event": "response", "data": {"text": "...", "source": "claude|qwen"}}
    {"event": "speaking_start", "data": {"text": "..."}}
    {"event": "speaking_end", "data": {}}
    {"event": "error", "data": {"message": "..."}}

Commands from Electron (stdin):
    {"command": "query", "text": "...", "image": "base64..."}
    {"command": "set_mode", "mode": "auto|local|claude"}
    {"command": "stop"}
"""

import asyncio
import json
import sys
import threading
import queue
from io import StringIO

# Command queue for stdin commands
command_queue = queue.Queue()

# Keep reference to original stdout for emitting events
_original_stdout = sys.stdout

def emit_event(event: str, data: dict = None):
    """Send a JSON event to Electron via stdout."""
    payload = {"event": event, "data": data or {}}
    _original_stdout.write(json.dumps(payload) + "\n")
    _original_stdout.flush()

def emit_error(message: str):
    """Send an error event."""
    emit_event("error", {"message": message})

class ElectronOutputCapture:
    """Capture print statements and convert to JSON events."""

    def __init__(self, original_stdout):
        self.original = original_stdout
        self.buffer = StringIO()

    def write(self, text):
        # Forward to original stdout for debugging (visible in Electron terminal)
        self.original.write(text)
        self.original.flush()

        if not text.strip():
            return

        # Parse known patterns and emit events
        text = text.strip()

        # Wake word detection
        if "Wake word detected" in text:
            # Extract score if possible
            try:
                import re
                match = re.search(r'\((\w+): ([\d.]+)\)', text)
                if match:
                    emit_event("wake_word", {
                        "model": match.group(1),
                        "score": float(match.group(2))
                    })
                else:
                    emit_event("wake_word", {})
            except:
                emit_event("wake_word", {})

        # Recording states
        elif "Recording" in text and "speak now" in text:
            emit_event("recording_start", {"type": "follow-up" if "follow-up" in text else "normal"})

        elif "Silence detected" in text:
            emit_event("recording_stop", {})

        # Listening state
        elif "Listening for" in text:
            emit_event("listening", {})

        # Speaking
        elif "Speaking:" in text:
            # Extract the text being spoken
            spoken_text = text.replace("🔊 Speaking:", "").strip()
            emit_event("speaking_start", {"text": spoken_text})

        # Transcription/Processing
        elif "Asking Claude" in text or "Asking Qwen" in text:
            source = "claude" if "Claude" in text else "qwen"
            emit_event("processing", {"source": source})

        # Response
        elif text.startswith("💬 "):
            response_text = text[2:].strip()
            emit_event("response", {"text": response_text})

        # Sent to inbox
        elif "Sent to inbox" in text:
            emit_event("sent_to_inbox", {})

        # Call mode
        elif "Call started" in text:
            emit_event("call_start", {})
        elif "Call ended" in text:
            emit_event("call_end", {})

        # Mode change
        elif "Voice mode changed" in text:
            mode = text.split(":")[-1].strip() if ":" in text else "unknown"
            emit_event("mode_change", {"mode": mode})

        # Ready state
        elif "Voice Mirror - Ready" in text:
            emit_event("ready", {})

        # Conversation mode
        elif "Conversation active" in text:
            emit_event("conversation_active", {})

    def flush(self):
        pass


def stdin_reader():
    """Read commands from stdin in a separate thread."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            command_queue.put(cmd)
        except json.JSONDecodeError as e:
            emit_error(f"Invalid JSON command: {e}")


async def process_commands(agent):
    """Process commands from Electron."""
    while True:
        try:
            # Non-blocking check for commands
            try:
                cmd = command_queue.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.1)
                continue

            command = cmd.get("command")
            cmd_type = cmd.get("type")  # Alternative: Electron sends type instead of command

            # Handle image type (from Electron main.js sendImageToPython)
            if cmd_type == "image":
                import base64
                from pathlib import Path
                from datetime import datetime
                import uuid

                image_data = cmd.get("data", "")
                filename = cmd.get("filename", "screenshot.png")
                prompt = cmd.get("prompt", "What's in this image?")

                # Save to ~/.context-mirror/images/
                images_dir = Path.home() / ".config" / "voice-mirror-electron" / "data" / "images"
                images_dir.mkdir(parents=True, exist_ok=True)

                image_filename = f"screen_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
                image_path = images_dir / image_filename

                with open(image_path, 'wb') as f:
                    f.write(base64.b64decode(image_data))

                emit_event("image_received", {"path": str(image_path)})

                # Send to Claude via MCP inbox
                inbox_path = Path.home() / ".config" / "voice-mirror-electron" / "data" / "inbox.json"

                if inbox_path.exists():
                    try:
                        with open(inbox_path, 'r') as f:
                            data = json.load(f)
                        if "messages" not in data:
                            data = {"messages": []}
                    except (json.JSONDecodeError, KeyError):
                        data = {"messages": []}
                else:
                    data = {"messages": []}

                msg = {
                    "id": f"msg-{uuid.uuid4().hex[:12]}",
                    "from": "nathan",
                    "message": prompt,
                    "timestamp": datetime.now().isoformat(),
                    "thread_id": "voice-mirror",
                    "read_by": [],
                    "image_path": str(image_path)
                }

                data["messages"].append(msg)

                with open(inbox_path, 'w') as f:
                    json.dump(data, f, indent=2)

                emit_event("sent_to_inbox", {"message": prompt, "image": str(image_path)})

            elif command == "query":
                # Direct query (text and/or image)
                text = cmd.get("text", "")
                image = cmd.get("image")  # base64 image data
                image_path = None

                if image:
                    # Handle image query - save to persistent location
                    import tempfile
                    import base64
                    from pathlib import Path
                    from datetime import datetime
                    import uuid

                    # Save to ~/.context-mirror/images/ for persistence
                    images_dir = Path.home() / ".config" / "voice-mirror-electron" / "data" / "images"
                    images_dir.mkdir(parents=True, exist_ok=True)

                    # Unique filename with timestamp
                    filename = f"screen_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
                    image_path = images_dir / filename

                    with open(image_path, 'wb') as f:
                        f.write(base64.b64decode(image))

                    emit_event("image_received", {"path": str(image_path)})

                    # Send image to Claude via MCP inbox
                    inbox_path = Path.home() / ".config" / "voice-mirror-electron" / "data" / "inbox.json"
                    inbox_path.parent.mkdir(parents=True, exist_ok=True)

                    # Load existing messages
                    if inbox_path.exists():
                        try:
                            with open(inbox_path, 'r') as f:
                                data = json.load(f)
                            if "messages" not in data:
                                data = {"messages": []}
                        except (json.JSONDecodeError, KeyError):
                            data = {"messages": []}
                    else:
                        data = {"messages": []}

                    # Create message with image attachment
                    msg = {
                        "id": f"msg-{uuid.uuid4().hex[:12]}",
                        "from": "nathan",
                        "message": text if text else "What do you see in this image?",
                        "timestamp": datetime.now().isoformat(),
                        "thread_id": "voice-mirror",
                        "read_by": [],
                        "image_path": str(image_path)  # Attach image path
                    }

                    data["messages"].append(msg)

                    with open(inbox_path, 'w') as f:
                        json.dump(data, f, indent=2)

                    emit_event("sent_to_inbox", {"message": msg["message"], "image": str(image_path)})

                elif text:
                    # Text-only query - route through the agent's normal processing
                    emit_event("processing", {"text": text})
                    # TODO: Call agent's query method directly

            elif command == "set_mode":
                mode = cmd.get("mode", "auto")
                # Write to voice_mode.json
                import json
                from pathlib import Path
                mode_path = Path.home() / ".config" / "voice-mirror-electron" / "data" / "voice_mode.json"
                mode_path.parent.mkdir(parents=True, exist_ok=True)
                with open(mode_path, 'w') as f:
                    json.dump({"mode": mode}, f)
                emit_event("mode_change", {"mode": mode})

            elif command == "stop":
                emit_event("stopping", {})
                break

            elif command == "ping":
                emit_event("pong", {})

        except Exception as e:
            emit_error(str(e))


async def main():
    """Main entry point for Electron bridge."""
    global _original_stdout

    # Emit startup event immediately
    emit_event("starting", {})

    # Redirect stdout to capture print statements from voice_agent
    _original_stdout = sys.stdout  # Update global reference
    sys.stdout = ElectronOutputCapture(_original_stdout)

    # Start stdin reader thread
    stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
    stdin_thread.start()

    try:
        # Import and run VoiceMirror
        from voice_agent import VoiceMirror

        agent = VoiceMirror()

        # Start command processor
        command_task = asyncio.create_task(process_commands(agent))

        # Run the agent
        await agent.run()

    except ImportError as e:
        emit_error(f"Failed to import voice_agent: {e}")
        sys.exit(1)
    except Exception as e:
        emit_error(f"Voice Mirror error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
