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
import base64
import json
import os
import queue
import sys
import threading
import uuid
from datetime import datetime
from io import StringIO
from pathlib import Path
from shared.paths import get_config_base, get_data_dir

# Force UTF-8 output on Windows (cp1252 can't encode emoji used in log output)
if sys.platform == 'win32':
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')


# Command queue for stdin commands
command_queue = queue.Queue()

# GlobalHotkey listener is now owned by VoiceMirror agent (started after audio stream opens)

# Keep reference to original stdout for emitting events
_original_stdout = sys.stdout

# File logging
_log_file = None

# ANSI color codes for terminal output
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    # Foreground colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"
    # Bright variants
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"

# Log level colors and icons
LOG_STYLES = {
    'EVENT': (Colors.CYAN, '→'),
    'VOICE': (Colors.MAGENTA, '🎤'),
    'CLAUDE': (Colors.BLUE, '🤖'),
    'TTS': (Colors.GREEN, '🔊'),
    'ERROR': (Colors.RED, '✗'),
    'WARN': (Colors.YELLOW, '⚠'),
    'INFO': (Colors.WHITE, '•'),
    'PYTHON': (Colors.DIM, '⚙'),
}

# Events to skip logging (too noisy)
SKIP_EVENTS = {'listening', 'conversation_active', 'pong'}

# Events to log with minimal data
MINIMAL_DATA_EVENTS = {'recording_start', 'recording_stop', 'speaking_start'}

def init_log_file():
    """Initialize the log file for Python-side logging."""
    global _log_file
    try:
        log_dir = get_data_dir()
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "vmr.log"
        # Append mode so both Electron and Python can write
        _log_file = open(log_path, 'a', encoding='utf-8')
        write_log('INFO', 'Voice Mirror started')
    except Exception as e:
        print(f"Failed to init log file: {e}", file=sys.stderr)

def write_log(level: str, message: str):
    """Write a color-coded log entry to the file."""
    if _log_file:
        timestamp = datetime.now().strftime('%H:%M:%S')
        color, icon = LOG_STYLES.get(level, (Colors.WHITE, '•'))
        # Write with color codes
        _log_file.write(f"{Colors.DIM}[{timestamp}]{Colors.RESET} {color}{icon} {message}{Colors.RESET}\n")
        _log_file.flush()

def close_log_file():
    """Close the log file."""
    global _log_file
    if _log_file:
        write_log('PYTHON', 'Shutting down')
        _log_file.close()
        _log_file = None

def emit_event(event: str, data: dict = None):
    """Send a JSON event to Electron via stdout."""
    payload = {"event": event, "data": data or {}}
    _original_stdout.write(json.dumps(payload) + "\n")
    try:
        _original_stdout.flush()
    except OSError:
        pass  # Flush can fail on Windows unbuffered pipes

    # Log to file (skip noisy events)
    if event in SKIP_EVENTS:
        return

    # Format the log message based on event type
    if event == 'wake_word':
        model = data.get('model', 'unknown') if data else 'unknown'
        score = data.get('score', 0) if data else 0
        write_log('VOICE', f"Wake word ({model}: {score:.0%})")
    elif event == 'recording_start':
        rec_type = data.get('type', 'normal') if data else 'normal'
        write_log('VOICE', f"Recording started ({rec_type})")
    elif event == 'recording_stop':
        write_log('VOICE', "Recording stopped")
    elif event == 'sent_to_inbox':
        msg = data.get('message', '') if data else ''
        preview = msg[:200] if len(msg) > 200 else msg
        msg_id = data.get('msgId', '') if data else ''
        suffix = f" | {msg_id}" if msg_id else ''
        if preview:
            write_log('VOICE', f"Sent: \"{preview}\"{suffix}")
        else:
            write_log('VOICE', f"Sent to provider{suffix}")
    elif event == 'response':
        text = data.get('text', '') if data else ''
        chars = len(text)
        msg_id = data.get('msgId', '') if data else ''
        # Extract just the message, not the prefix (supports any provider)
        import re
        provider_match = re.match(r'^(\w+(?:\s+\(\w+\))?): (.+)', text, re.DOTALL)
        if provider_match:
            provider, content = provider_match.groups()
            preview = content[:200] if len(content) > 200 else content
            write_log('CLAUDE', f"\"{preview}\" ({chars} chars){f' | {msg_id}' if msg_id else ''}")
        else:
            preview = text[:200] if len(text) > 200 else text
            write_log('CLAUDE', f"\"{preview}\" ({chars} chars){f' | {msg_id}' if msg_id else ''}")
    elif event == 'speaking_start':
        text = data.get('text', '') if data else ''
        preview = text[:200] if len(text) > 200 else text
        write_log('TTS', f"Speaking: \"{preview}\"")
    elif event == 'mode_change':
        mode = data.get('mode', 'unknown') if data else 'unknown'
        write_log('INFO', f"Mode: {mode}")
    elif event == 'error':
        msg = data.get('message', 'Unknown error') if data else 'Unknown error'
        write_log('ERROR', msg)
    elif event == 'transcription':
        text = data.get('text', '') if data else ''
        preview = text[:200] if len(text) > 200 else text
        write_log('VOICE', f"Transcribed: \"{preview}\" ({len(text)} chars)")
    elif event == 'ptt_start':
        write_log('PTT', "PTT start")
    elif event == 'ptt_stop':
        write_log('PTT', "PTT stop → transcribing")
    elif event in ('starting', 'ready'):
        write_log('INFO', event.capitalize())
    else:
        # Default: log event name only (no JSON dump)
        write_log('EVENT', event)

def emit_error(message: str):
    """Send an error event."""
    emit_event("error", {"message": message})

class ElectronOutputCapture:
    """Capture print statements and convert to JSON events."""

    # Patterns to ignore completely (noisy debug output)
    IGNORE_PATTERNS = [
        '🎤 Audio:',           # Audio level debug
        '📞 Call mode energy', # Call mode energy debug
        '🔊 █',                # Audio level bar
        'Audio status:',       # sounddevice status
    ]

    def __init__(self, original_stdout):
        self.original = original_stdout
        self.buffer = StringIO()

    def write(self, text):
        if not text.strip():
            return

        stripped = text.strip()

        # Skip noisy debug output BEFORE printing
        for pattern in self.IGNORE_PATTERNS:
            if pattern in stripped:
                return

        # Color-code the output for terminal viewing
        colored_text = self._colorize(stripped)
        try:
            self.original.write(colored_text + "\n")
        except UnicodeEncodeError:
            self.original.write(colored_text.encode('ascii', 'replace').decode('ascii') + "\n")
        try:
            self.original.flush()
        except OSError:
            pass  # Flush can fail on Windows unbuffered pipes

        # Parse known patterns and emit events
        text = stripped

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
            except Exception:
                emit_event("wake_word", {})

        # Recording states - differentiate by source
        elif "Recording (PTT)" in text:
            emit_event("recording_start", {"type": "ptt"})
        elif "Recording (call)" in text:
            emit_event("recording_start", {"type": "call"})
        elif "Recording follow-up" in text:
            emit_event("recording_start", {"type": "follow-up"})
        elif "Recording..." in text and "speak now" in text:
            emit_event("recording_start", {"type": "wake-word"})

        elif "Silence detected" in text or "PTT released" in text:
            emit_event("recording_stop", {})

        # Speaking
        elif "Speaking:" in text:
            # Extract the text being spoken
            spoken_text = text.replace("🔊 Speaking:", "").strip()
            emit_event("speaking_start", {"text": spoken_text})
        elif "Speaking done" in text:
            emit_event("speaking_end", {})

        # Transcription result
        elif "You said:" in text:
            transcript = text.replace("📝 You said:", "").strip()
            emit_event("transcription", {"text": transcript})

        # Response
        elif text.startswith("💬 "):
            response_text = text[2:].strip()
            emit_event("response", {"text": response_text})

        # Sent to inbox
        elif "Sent to inbox" in text:
            # Extract the message preview if available
            import re
            match = re.search(r'Sent to inbox: (.+?)\.\.\.', text)
            msg = match.group(1) if match else ""
            emit_event("sent_to_inbox", {"message": msg})

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

    def _colorize(self, text: str) -> str:
        """Add ANSI color codes based on message content."""
        # Wake word / listening
        if "Wake word" in text or "👂 Listening" in text:
            return f"{Colors.MAGENTA}{text}{Colors.RESET}"
        # Recording
        elif "🔴 Recording" in text or "Recording..." in text:
            return f"{Colors.BRIGHT_RED}{text}{Colors.RESET}"
        # Transcription
        elif "📝 You said:" in text:
            return f"{Colors.CYAN}{text}{Colors.RESET}"
        # Speaking / TTS
        elif "🔊 Speaking" in text:
            return f"{Colors.GREEN}{text}{Colors.RESET}"
        # AI response (Claude, Ollama, etc.)
        elif text.startswith("💬 "):
            return f"{Colors.BLUE}{text}{Colors.RESET}"
        # Sent to inbox
        elif "📬 Sent to inbox" in text:
            return f"{Colors.YELLOW}{text}{Colors.RESET}"
        # Waiting / processing
        elif "⏳" in text:
            return f"{Colors.DIM}{text}{Colors.RESET}"
        # Mode changes
        elif "🔄" in text or "Mode:" in text:
            return f"{Colors.BRIGHT_MAGENTA}{text}{Colors.RESET}"
        # Errors
        elif "Error" in text or "✗" in text:
            return f"{Colors.BRIGHT_RED}{text}{Colors.RESET}"
        # Ready / success
        elif "✅" in text or "Ready" in text:
            return f"{Colors.BRIGHT_GREEN}{text}{Colors.RESET}"
        # Conversation mode
        elif "Conversation mode" in text or "window" in text.lower():
            return f"{Colors.DIM}{text}{Colors.RESET}"
        # Default: dim for less important output
        else:
            return f"{Colors.DIM}{text}{Colors.RESET}"

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
                image_data = cmd.get("data", "")
                filename = cmd.get("filename", "screenshot.png")
                prompt = cmd.get("prompt", "What's in this image?")

                # Save to ~/.context-mirror/images/
                images_dir = get_data_dir() / "images"
                images_dir.mkdir(parents=True, exist_ok=True)

                image_filename = f"screen_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
                image_path = images_dir / image_filename

                with open(image_path, 'wb') as f:
                    f.write(base64.b64decode(image_data))

                emit_event("image_received", {"path": str(image_path)})

                # Send to Claude via MCP inbox
                inbox_path = get_data_dir() / "inbox.json"

                if inbox_path.exists():
                    try:
                        with open(inbox_path, encoding='utf-8') as f:
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

                with open(inbox_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)

                emit_event("sent_to_inbox", {"message": prompt, "image": str(image_path)})

            elif command == "query":
                # Direct query (text and/or image)
                text = cmd.get("text", "")
                image = cmd.get("image")  # base64 image data
                image_path = None

                if image:
                    # Handle image query - save to persistent location
                    # Save to ~/.context-mirror/images/ for persistence
                    images_dir = get_data_dir() / "images"
                    images_dir.mkdir(parents=True, exist_ok=True)

                    # Unique filename with timestamp
                    filename = f"screen_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
                    image_path = images_dir / filename

                    with open(image_path, 'wb') as f:
                        f.write(base64.b64decode(image))

                    emit_event("image_received", {"path": str(image_path)})

                    # Send image to Claude via MCP inbox
                    inbox_path = get_data_dir() / "inbox.json"
                    inbox_path.parent.mkdir(parents=True, exist_ok=True)

                    # Load existing messages
                    if inbox_path.exists():
                        try:
                            with open(inbox_path, encoding='utf-8') as f:
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

                    with open(inbox_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2)

                    emit_event("sent_to_inbox", {"message": msg["message"], "image": str(image_path)})

                elif text:
                    # Text-only query - route through the agent's normal processing
                    emit_event("processing", {"text": text})
                    # TODO: Call agent's query method directly

            elif command == "set_mode":
                mode = cmd.get("mode", "auto")
                # Write to voice_mode.json
                mode_path = get_data_dir() / "voice_mode.json"
                mode_path.parent.mkdir(parents=True, exist_ok=True)
                with open(mode_path, 'w', encoding='utf-8') as f:
                    json.dump({"mode": mode}, f)
                emit_event("mode_change", {"mode": mode})

            elif command == "config_update":
                # Handle config updates from Electron settings panel
                cfg = cmd.get("config", {})

                # Write config to file for voice_agent to read
                config_path = get_data_dir() / "voice_config.json"
                config_path.parent.mkdir(parents=True, exist_ok=True)

                # Merge with existing config
                existing = {}
                if config_path.exists():
                    try:
                        with open(config_path, encoding='utf-8') as f:
                            existing = json.load(f)
                    except Exception:
                        pass

                existing.update(cfg)

                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, indent=2)

                emit_event("config_updated", {"config": existing})

                # Apply activation mode immediately
                activation_mode = cfg.get("activationMode")
                ptt_key = cfg.get("pttKey")
                if activation_mode:
                    call_path = get_data_dir() / "voice_call.json"
                    with open(call_path, 'w', encoding='utf-8') as f:
                        json.dump({"active": activation_mode == "callMode"}, f)
                    emit_event("mode_change", {"mode": activation_mode})

                    # Start/stop global hotkey listener based on mode
                    hotkey = getattr(agent, '_hotkey_listener', None)
                    if activation_mode == "pushToTalk":
                        key = ptt_key or "MouseButton4"
                        if hotkey:
                            hotkey.update_key(key)
                        else:
                            # Create hotkey listener if it doesn't exist yet
                            try:
                                from global_hotkey import GlobalHotkeyListener
                                agent._hotkey_listener = GlobalHotkeyListener()
                                agent._hotkey_listener.start(key)
                                print(f"[GlobalHotkey] Started via config_update: {key}")
                            except Exception as e:
                                print(f"[GlobalHotkey] Failed to start via config_update: {e}")
                    else:
                        if hotkey:
                            hotkey.stop()
                elif ptt_key:
                    # PTT key changed without mode change
                    hotkey = getattr(agent, '_hotkey_listener', None)
                    if hotkey:
                        hotkey.update_key(ptt_key)

                # Apply TTS settings changes immediately
                voice_cfg = cfg.get("voice", {})
                tts_adapter = voice_cfg.get("ttsAdapter")
                tts_voice = voice_cfg.get("ttsVoice")
                tts_model_size = voice_cfg.get("ttsModelSize")

                tts_volume = voice_cfg.get("ttsVolume")

                if tts_adapter or tts_voice or tts_model_size or tts_volume is not None:
                    # Update voice_settings.json (read by voice_agent)
                    settings_path = get_data_dir() / "voice_settings.json"
                    try:
                        voice_settings = {}
                        if settings_path.exists():
                            with open(settings_path, encoding='utf-8') as f:
                                voice_settings = json.load(f)

                        # Update only the fields that were provided
                        if tts_adapter:
                            voice_settings["tts_adapter"] = tts_adapter
                        if tts_voice:
                            voice_settings["tts_voice"] = tts_voice
                        if tts_model_size:
                            voice_settings["tts_model_size"] = tts_model_size
                        if tts_volume is not None:
                            voice_settings["tts_volume"] = float(tts_volume)

                        with open(settings_path, 'w', encoding='utf-8') as f:
                            json.dump(voice_settings, f, indent=2)

                        # Tell the agent to refresh TTS settings
                        if hasattr(agent, 'refresh_tts_settings'):
                            agent.refresh_tts_settings()
                    except Exception as e:
                        emit_error(f"Failed to update TTS settings: {e}")

            elif command == "list_audio_devices":
                # Enumerate audio input/output devices (prefer WASAPI on Windows)
                try:
                    import sounddevice as sd
                    devices = sd.query_devices()
                    hostapis = sd.query_hostapis()

                    # Find WASAPI host API index (Windows only, has full device names)
                    wasapi_idx = None
                    for idx, api in enumerate(hostapis):
                        if 'WASAPI' in api.get('name', ''):
                            wasapi_idx = idx
                            break

                    input_devs = []
                    output_devs = []
                    seen_input = set()
                    seen_output = set()
                    for i, d in enumerate(devices):
                        # Filter to WASAPI devices if available
                        if wasapi_idx is not None and d.get('hostapi') != wasapi_idx:
                            continue
                        name = d['name']
                        if d['max_input_channels'] > 0 and name not in seen_input:
                            input_devs.append({"id": i, "name": name})
                            seen_input.add(name)
                        if d['max_output_channels'] > 0 and name not in seen_output:
                            output_devs.append({"id": i, "name": name})
                            seen_output.add(name)
                    emit_event("audio_devices", {"input": input_devs, "output": output_devs})
                except Exception as e:
                    emit_event("audio_devices", {"input": [], "output": [], "error": str(e)})

            elif command == "start_recording":
                # Push-to-talk: start recording immediately
                # Don't emit here - ElectronOutputCapture will emit when voice_agent prints
                ptt_path = get_data_dir() / "ptt_trigger.json"
                ptt_path.parent.mkdir(parents=True, exist_ok=True)
                with open(ptt_path, 'w', encoding='utf-8') as f:
                    json.dump({"action": "start", "timestamp": datetime.now().isoformat()}, f)

            elif command == "stop_recording":
                # Push-to-talk: stop recording
                # Don't emit here - ElectronOutputCapture will emit when voice_agent prints
                ptt_path = get_data_dir() / "ptt_trigger.json"
                with open(ptt_path, 'w', encoding='utf-8') as f:
                    json.dump({"action": "stop", "timestamp": datetime.now().isoformat()}, f)

            elif command == "system_speak":
                # Speak text via TTS without entering conversation mode or touching inbox
                text = cmd.get("text", "")
                if text and agent:
                    emit_event("speaking_start", {"text": text})
                    await agent.speak(text, enter_conversation_mode=False)
                    emit_event("speaking_end", {})

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

    # Initialize file logging
    init_log_file()

    # Emit startup event immediately
    emit_event("starting", {})

    # Redirect stdout to capture print statements from voice_agent
    _original_stdout = sys.stdout  # Update global reference
    sys.stdout = ElectronOutputCapture(_original_stdout)

    # Start stdin reader thread
    stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
    stdin_thread.start()

    # GlobalHotkey listener is started by voice_agent.run() AFTER the audio
    # stream is active, so PTT triggers aren't lost during model loading.

    try:
        # Import and run VoiceMirror
        emit_event("loading", {"step": "Importing modules..."})
        from voice_agent import VoiceMirror

        emit_event("loading", {"step": "Initializing..."})
        agent = VoiceMirror()

        # Start command processor
        command_task = asyncio.create_task(process_commands(agent))

        # Run the agent
        emit_event("loading", {"step": "Loading models..."})
        await agent.run()

    except ImportError as e:
        emit_error(f"Failed to import voice_agent: {e}")
        close_log_file()
        sys.exit(1)
    except Exception as e:
        emit_error(f"Voice Mirror error: {e}")
        close_log_file()
        sys.exit(1)
    finally:
        close_log_file()


if __name__ == "__main__":
    asyncio.run(main())
