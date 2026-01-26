#!/usr/bin/env python3
"""
Voice Mirror - Local Voice Agent

Listens for "Hey Claude" wake word, transcribes speech with Parakeet (local STT),
and routes to either Claude Code (via MCP inbox) or local Qwen (via Ollama).

Smart routing: Auto mode detects smart home commands and routes to Qwen for speed,
everything else goes to Claude Code. Mode can be overridden via status bar toggle.

Usage:
    ./run.sh

Requirements:
    - Microphone access
    - Models: hey_claude_v2.onnx, kokoro-v1.0.onnx, voices-v1.0.bin
"""

import asyncio
import atexit
import json
import os
import signal
import subprocess
import sys
import time
import uuid
import threading
from datetime import datetime
from pathlib import Path
from collections import deque

import numpy as np

# Smart Home integration
from smart_home import SmartHome, handle_smart_home_command
# Qwen handler for local LLM routing
from qwen_handler import QwenHandler, is_smart_home_command
# Settings (includes STT configuration)
from settings import load_voice_settings
# STT adapters
from stt import create_stt_adapter

import sounddevice as sd
from openwakeword.model import Model as OWWModel

# Local TTS (Kokoro)
try:
    from kokoro_onnx import Kokoro
    import soundfile as sf
    KOKORO_AVAILABLE = True
except ImportError:
    KOKORO_AVAILABLE = False

# Configuration
PARAKEET_MODEL = os.getenv("PARAKEET_MODEL", "nemo-parakeet-tdt-0.6b-v2")
TTS_VOICE = os.getenv("TTS_VOICE", "af_bella")  # Female voice, change to am_puck for male
WAKE_WORD_MODEL = "models/hey_claude_v2.onnx"
WAKE_WORD_THRESHOLD = 0.98  # Strict but usable
SILENCE_TIMEOUT = 3.0  # seconds of silence before stopping recording
CONVERSATION_WINDOW = 5.0  # seconds to wait for follow-up without wake word

# Voice Mirror data directory (standalone - NOT Context Mirror)
VM_DATA_DIR = Path.home() / ".config" / "voice-mirror-electron" / "data"
VM_DATA_DIR.mkdir(parents=True, exist_ok=True)

# MCP inbox path
INBOX_PATH = VM_DATA_DIR / "inbox.json"

# Voice mode config
VOICE_MODE_PATH = VM_DATA_DIR / "voice_mode.json"

# Voice call state
VOICE_CALL_PATH = VM_DATA_DIR / "voice_call.json"

# Voice modes
class VoiceMode:
    AUTO = "auto"        # Smart routing: smart home → Qwen, else → Claude
    LOCAL = "local"      # All to local Qwen
    CLAUDE = "claude"    # All to Claude Code inbox

# Audio settings
SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_SAMPLES = 1280  # 80ms at 16kHz for OpenWakeWord

# Inbox cleanup settings
INBOX_CLEANUP_HOURS = 2  # Clear messages older than this on startup

# Notification watcher settings
NOTIFICATION_POLL_INTERVAL = 2.0  # Check inbox every 2 seconds
NOTIFICATION_ENABLED = True  # Enable background notification watcher


def cleanup_inbox(max_age_hours: float = INBOX_CLEANUP_HOURS) -> int:
    """
    Clean up old messages from the MCP inbox on startup.
    Returns the number of messages removed.
    """
    if not INBOX_PATH.exists():
        return 0

    try:
        with open(INBOX_PATH, 'r') as f:
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
            with open(INBOX_PATH, 'w') as f:
                json.dump(data, f, indent=2)

        return removed

    except Exception as e:
        print(f"⚠️ Inbox cleanup failed: {e}")
        return 0


class VoiceMirror:
    """Voice agent with wake word detection, STT, and smart routing."""

    def __init__(self):
        self.oww_model = None
        self.stt_adapter = None  # STT adapter (parakeet, whisper, etc.)
        self.kokoro_model = None  # Kokoro TTS model
        self.is_listening = True
        self.is_recording = False
        self.is_processing = False  # Prevent double processing
        self.audio_buffer = []
        self.last_speech_time = 0
        self.oww_buffer = []
        self._lock = threading.Lock()  # Protect audio_buffer
        self._inbox_lock = threading.Lock()  # Protect inbox writes
        self._last_message_hash = None  # Deduplication
        self._last_message_time = 0  # Deduplication cooldown
        self.smart_home = SmartHome()  # Smart home integration
        self.qwen_handler = QwenHandler(self.smart_home)  # Local LLM handler
        self._voice_mode = VoiceMode.AUTO  # Current routing mode
        self._mode_check_time = 0  # Last time we checked the mode file
        self._in_conversation = False  # Conversation mode active
        self._conversation_end_time = 0  # When conversation window expires
        self._last_seen_message_id = None  # Track last seen Claude message for notifications
        self._notification_queue = asyncio.Queue()  # Queue for background notifications
        self._is_speaking = False  # Prevent notification interrupts during speech

    def load_models(self):
        """Load OpenWakeWord and Parakeet models."""
        # Clean up old inbox messages on startup
        removed = cleanup_inbox()
        if removed > 0:
            print(f"🧹 Cleaned {removed} old message(s) from inbox")

        print("Loading wake word model...")
        script_dir = Path(__file__).parent
        model_path = script_dir / WAKE_WORD_MODEL

        # OpenWakeWord needs the preprocessor models (melspectrogram, embedding)
        # We have them in our models/ directory, need to copy to package location or specify paths
        melspec_path = script_dir / "models" / "melspectrogram.onnx"
        embedding_path = script_dir / "models" / "embedding_model.onnx"

        self.oww_model = OWWModel(
            wakeword_model_paths=[str(model_path)],
        )
        print(f"Loaded: {WAKE_WORD_MODEL}")

        # Load STT adapter from settings
        settings = load_voice_settings()
        adapter_name = settings.get("stt_adapter", "parakeet")
        model_name = settings.get("stt_model", None)

        try:
            print(f"Loading STT adapter: {adapter_name}")
            if model_name:
                print(f"  Model: {model_name}")
            else:
                print(f"  Using default model")

            self.stt_adapter = create_stt_adapter(adapter_name, model_name)

            # Load the adapter (async, so we'll do it in the event loop later)
            # For now just create the instance
            print(f"  (First run may download model, please wait...)")

        except Exception as e:
            print(f"❌ Failed to create STT adapter: {e}")
            print(f"   Falling back to parakeet")
            try:
                self.stt_adapter = create_stt_adapter("parakeet")
            except Exception:
                self.stt_adapter = None

        # Load Kokoro TTS model if available
        if KOKORO_AVAILABLE:
            print(f"Loading Kokoro TTS model...")
            print("  (First run downloads model, please wait...)")
            try:
                self.kokoro_model = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
                print(f"✅ Kokoro TTS loaded (voice: {TTS_VOICE})")
            except Exception as e:
                print(f"⚠️ Failed to load Kokoro TTS: {e}")
                self.kokoro_model = None
        else:
            print("❌ Kokoro TTS not available - install with: pip install kokoro-onnx")

    def get_voice_mode(self) -> str:
        """
        Get current voice routing mode from config file.
        Caches result for 1 second to avoid excessive file reads.
        """
        now = time.time()
        # Only check file every 1 second
        if now - self._mode_check_time < 1.0:
            return self._voice_mode

        self._mode_check_time = now

        try:
            if VOICE_MODE_PATH.exists():
                with open(VOICE_MODE_PATH, 'r') as f:
                    data = json.load(f)
                    mode = data.get("mode", VoiceMode.AUTO)
                    if mode in (VoiceMode.AUTO, VoiceMode.LOCAL, VoiceMode.CLAUDE):
                        if mode != self._voice_mode:
                            print(f"🔄 Voice mode changed to: {mode}")
                        self._voice_mode = mode
        except Exception as e:
            pass  # Silently use cached mode

        return self._voice_mode

    def is_call_active(self) -> bool:
        """
        Check if a voice call is currently active.
        When active, skip wake word detection and listen continuously.
        Caches result for 0.5 seconds to avoid excessive file reads.
        """
        now = time.time()
        if now - getattr(self, '_call_check_time', 0) < 0.5:
            return getattr(self, '_call_active', False)

        self._call_check_time = now

        try:
            if VOICE_CALL_PATH.exists():
                with open(VOICE_CALL_PATH, 'r') as f:
                    data = json.load(f)
                    active = data.get("active", False)
                    if active != getattr(self, '_call_active', False):
                        if active:
                            print(f"\n📞 Call started - listening without wake word")
                        else:
                            print(f"\n📞 Call ended - returning to wake word mode")
                    self._call_active = active
                    return active
        except Exception:
            pass

        self._call_active = False
        return False

    def should_route_to_qwen(self, text: str) -> bool:
        """
        Determine if this text should be routed to local Qwen.
        Based on current mode and smart home detection.
        """
        mode = self.get_voice_mode()

        if mode == VoiceMode.LOCAL:
            return True
        elif mode == VoiceMode.CLAUDE:
            return False
        else:  # AUTO mode
            # Smart routing: smart home commands go to Qwen
            return is_smart_home_command(text)

    def send_to_inbox(self, message: str):
        """Send transcribed message to MCP inbox."""
        with self._inbox_lock:
            # Deduplication: skip if same message within 2 seconds
            msg_hash = hash(message.strip().lower())
            now = time.time()
            if msg_hash == self._last_message_hash and (now - self._last_message_time) < 2.0:
                print(f"⏭️  Skipping duplicate: {message[:30]}...")
                return None

            self._last_message_hash = msg_hash
            self._last_message_time = now

            INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)

            # Load existing messages
            if INBOX_PATH.exists():
                try:
                    with open(INBOX_PATH, 'r') as f:
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
                "from": "nathan",
                "message": message,
                "timestamp": datetime.now().isoformat(),
                "thread_id": "voice-mirror",
                "read_by": []
            }

            data["messages"].append(msg)

            with open(INBOX_PATH, 'w') as f:
                json.dump(data, f, indent=2)

            print(f"📬 Sent to inbox: {message[:50]}...")
            return msg["id"]

    async def wait_for_claude_response(self, my_message_id: str, timeout: float = 60.0) -> str:
        """Wait for Claude to respond to our message via inbox polling."""
        print(f"⏳ Waiting for Claude to respond...")

        start_time = time.time()
        poll_interval = 0.5  # Check every 500ms

        while (time.time() - start_time) < timeout:
            await asyncio.sleep(poll_interval)

            with self._inbox_lock:
                if not INBOX_PATH.exists():
                    continue

                try:
                    with open(INBOX_PATH, 'r') as f:
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

                # Look for Claude's response after my message
                for msg in messages[my_msg_idx + 1:]:
                    sender = msg.get("from", "")
                    # Accept responses from any Claude instance
                    if "claude" in sender.lower() and msg.get("thread_id") == "voice-mirror":
                        response = msg.get("message", "")
                        if response:
                            print(f"✅ Got response from {sender}")
                            # Mark as seen so notification watcher doesn't repeat it
                            self._last_seen_message_id = msg.get("id")
                            return response

        print(f"⏰ Timeout waiting for Claude response")
        return ""

    async def get_claude_response_cli(self, message: str) -> str:
        """Get response from Claude via CLI (uses your existing auth)."""
        print(f"🤖 Asking Claude...")

        prompt = f'''Voice message from Nathan: "{message}"

Respond briefly and conversationally. Keep it to 1-2 sentences.
Don't use markdown or special formatting - this will be spoken aloud.'''

        try:
            # Run claude CLI in a thread to not block
            # Use stdin to pass prompt (avoids argument parsing issues)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    ["claude", "-p"],
                    input=prompt,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
            else:
                print(f"❌ Claude error: {result.stderr[:100] if result.stderr else 'no output'}")
                return ""
        except Exception as e:
            print(f"❌ Error: {e}")
            return ""

    async def get_claude_response_api(self, message: str) -> str:
        """Get response from Claude API (requires ANTHROPIC_API_KEY)."""
        import anthropic

        print(f"🤖 Asking Claude...")
        try:
            client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY env var
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=150,
                messages=[
                    {
                        "role": "user",
                        "content": f"Voice message from Nathan: \"{message}\"\n\nRespond briefly and conversationally. Keep it to 1-2 sentences. Don't use markdown or special formatting - this will be spoken aloud."
                    }
                ]
            )
            return response.content[0].text
        except Exception as e:
            print(f"❌ Claude API error: {e}")
            return ""

    def trigger_claude(self, message: str):
        """Send message to Claude Code via CLI in background (legacy)."""
        prompt = f'''Voice message from Nathan: "{message}"

Respond briefly to this voice message. Your response will be shown to Nathan.
Keep it concise - 1-2 sentences max.'''

        def run_claude():
            print(f"🤖 Triggering Claude...")
            try:
                result = subprocess.run(
                    ["claude", "-p", prompt],
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                if result.returncode == 0 and result.stdout.strip():
                    response = result.stdout.strip()
                    print(f"💬 Claude: {response}")
                    # Write response to inbox
                    self.write_claude_response(response)
                else:
                    print(f"❌ Claude error: {result.stderr[:100] if result.stderr else 'no output'}")
            except Exception as e:
                print(f"❌ Error: {e}")

        # Run in background thread so we don't block listening
        threading.Thread(target=run_claude, daemon=True).start()

    def write_claude_response(self, response: str):
        """Write Claude's response to the inbox."""
        with self._inbox_lock:
            if INBOX_PATH.exists():
                try:
                    with open(INBOX_PATH, 'r') as f:
                        data = json.load(f)
                except:
                    data = {"messages": []}
            else:
                data = {"messages": []}

            msg = {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "from": "claude-voice",
                "message": response,
                "timestamp": datetime.now().isoformat(),
                "thread_id": "voice-mirror",
                "read_by": []
            }

            data["messages"].append(msg)

            with open(INBOX_PATH, 'w') as f:
                json.dump(data, f, indent=2)

            print(f"📬 Response saved to inbox")

    def _strip_markdown_for_tts(self, text: str) -> str:
        """Strip markdown syntax that sounds bad when spoken aloud."""
        import re
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

    async def speak(self, text: str, enter_conversation_mode: bool = True):
        """Convert text to speech and play it using local Kokoro TTS."""
        # Strip markdown before speaking (safety net for responses that bypass summarizer)
        text = self._strip_markdown_for_tts(text)
        print(f"🔊 Speaking: {text[:50]}...")

        # Mark as speaking (prevents notification interrupts)
        self._is_speaking = True
        # Pause wake word detection while speaking (avoid self-triggering)
        self.is_listening = False

        try:
            if self.kokoro_model is None:
                print("❌ Kokoro TTS not available")
                return

            # Run Kokoro in thread pool to not block async loop
            loop = asyncio.get_event_loop()
            audio_data, sample_rate = await loop.run_in_executor(
                None,
                lambda: self.kokoro_model.create(text, voice=TTS_VOICE)
            )

            # Save to temp file
            audio_file = Path("/tmp/voice_mirror_tts.wav")
            sf.write(str(audio_file), audio_data, sample_rate)

            # Play using ffplay
            subprocess.run(
                ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(audio_file)],
                timeout=60
            )
        except Exception as e:
            print(f"❌ Kokoro TTS error: {e}")
        finally:
            # Resume listening after TTS completes
            self.is_listening = True
            self._is_speaking = False
            # Clear any audio that accumulated during TTS
            self.oww_buffer = []
            # Small delay to let audio system settle
            await asyncio.sleep(0.3)

            # Enter conversation mode - listen without wake word for a few seconds
            # Skip if call mode is active (already listening continuously)
            if enter_conversation_mode and not self.is_call_active():
                self._in_conversation = True
                self._conversation_end_time = time.time() + CONVERSATION_WINDOW
                print(f"💬 Conversation mode active ({CONVERSATION_WINDOW}s window - speak without wake word)")

    async def transcribe(self, audio_data: np.ndarray) -> str:
        """Transcribe audio using configured STT adapter."""
        if self.stt_adapter is None:
            print("❌ No STT adapter available")
            return ""

        # Load adapter if not already loaded
        if not self.stt_adapter.is_loaded:
            loaded = await self.stt_adapter.load()
            if not loaded:
                print("❌ Failed to load STT adapter")
                return ""

        # Transcribe using the adapter
        try:
            text = await self.stt_adapter.transcribe(audio_data, SAMPLE_RATE)
            return text
        except Exception as e:
            print(f"❌ STT transcription error: {e}")
            return ""

    def process_wake_word(self, audio_chunk: np.ndarray) -> bool:
        """Check for wake word in audio chunk. Returns True if detected."""
        # Accumulate audio
        self.oww_buffer.append(audio_chunk)
        total_samples = sum(len(chunk) for chunk in self.oww_buffer)

        while total_samples >= CHUNK_SAMPLES:
            combined = np.concatenate(self.oww_buffer)
            chunk = combined[:CHUNK_SAMPLES]
            remainder = combined[CHUNK_SAMPLES:]
            self.oww_buffer = [remainder] if len(remainder) > 0 else []
            total_samples = len(remainder)

            # Convert to int16 for OpenWakeWord
            chunk_int16 = (chunk * 32767).astype(np.int16)
            predictions = self.oww_model.predict(chunk_int16)

            if predictions:
                for model_name, score in predictions.items():
                    if score >= WAKE_WORD_THRESHOLD:
                        print(f"\n🎤 Wake word detected! ({model_name}: {score:.2f})")
                        return True

        return False

    def audio_callback(self, indata, frames, time_info, status):
        """Callback for audio stream."""
        if status:
            print(f"Audio status: {status}")

        # Debug: show audio level every 60 frames (~1 second)
        if not hasattr(self, '_audio_debug_counter'):
            self._audio_debug_counter = 0
        self._audio_debug_counter += 1

        level = np.abs(indata).max()
        energy = np.abs(indata[:, 0]).mean()

        # Print audio debug every ~1 second
        if self._audio_debug_counter % 60 == 0:
            call_active = self.is_call_active()
            print(f"🎤 Audio: level={level:.4f}, energy={energy:.4f}, listening={self.is_listening}, call={call_active}")

        if level > 0.05:
            bars = int(level * 20)
            print(f"🔊 {'█' * bars}", end="\r")

        audio = indata[:, 0].copy()  # Mono

        if self.is_listening and not self.is_recording:
            # Check if in call mode (no wake word needed, no timeout)
            if self.is_call_active():
                # In call mode - detect speech start without wake word
                energy = np.abs(audio).mean()
                # Debug: show energy level in call mode
                if energy > 0.005:
                    print(f"📞 Call mode energy: {energy:.4f}", end="\r")
                if energy > 0.008:  # Very sensitive threshold for speech detection
                    self.is_recording = True
                    self.audio_buffer = []
                    self.last_speech_time = time.time()
                    print(f"\n🔴 Recording (call)... energy={energy:.4f} (speak now)")
            # Check if in conversation mode (no wake word needed, with timeout)
            elif self._in_conversation:
                # Check if conversation window expired
                if time.time() > self._conversation_end_time:
                    self._in_conversation = False
                    print("\n👂 Conversation window closed. Say 'Hey Claude' to continue.")
                else:
                    # In conversation mode - detect speech start without wake word
                    energy = np.abs(audio).mean()
                    if energy > 0.03:  # Speech threshold (slightly higher to avoid noise)
                        self.is_recording = True
                        self.audio_buffer = []
                        self.last_speech_time = time.time()
                        self._in_conversation = False  # Exit conversation mode once recording starts
                        print("🔴 Recording follow-up... (speak now)")
            else:
                # Normal mode - check for wake word
                if self.process_wake_word(audio):
                    self.is_recording = True
                    self.audio_buffer = []
                    self.last_speech_time = time.time()
                    self.oww_model.reset()
                    print("🔴 Recording... (speak now)")

        elif self.is_recording and not self.is_processing:
            # Record audio (thread-safe)
            with self._lock:
                self.audio_buffer.append(audio)

            # Simple VAD: check if there's significant audio
            energy = np.abs(audio).mean()
            if energy > 0.01:  # Lowered threshold for VAD
                self.last_speech_time = time.time()

    async def process_recording(self):
        """Process recorded audio after silence timeout."""
        # Atomically grab the buffer and clear it
        with self._lock:
            if not self.audio_buffer:
                return
            audio_data = np.concatenate(self.audio_buffer)
            self.audio_buffer = []

        print("⏳ Transcribing...")

        text = await self.transcribe(audio_data)

        # Filter out garbage transcriptions (single chars, very short, or common artifacts)
        if text and len(text.strip()) < 3:
            print(f"🗑️ Ignoring short transcription: '{text}'")
            return

        if text:
            print(f"📝 You said: {text}")

            # Determine routing based on mode and content
            if self.should_route_to_qwen(text):
                # Route to local Qwen
                mode = self.get_voice_mode()
                if mode == VoiceMode.LOCAL:
                    print(f"🏠 Routing to Qwen (LOCAL mode)")
                else:
                    print(f"🏠 Routing to Qwen (smart home detected)")

                response = await self.qwen_handler.process(text)
                if response:
                    print(f"💬 Qwen: {response}")
                    await self.speak(response)
                else:
                    await self.speak("Sorry, I couldn't process that.")
            else:
                # Route to Claude Code via inbox
                mode = self.get_voice_mode()
                if mode == VoiceMode.CLAUDE:
                    print(f"🤖 Routing to Claude Code (CLAUDE mode)")
                else:
                    print(f"🤖 Routing to Claude Code (general query)")

                msg_id = self.send_to_inbox(text)

                # Wait for Claude Code to respond via inbox
                response = await self.wait_for_claude_response(msg_id, timeout=30.0)
                if response:
                    print(f"💬 Claude: {response}")
                    await self.speak(response)
                else:
                    print("⏰ No response from Claude Code. Make sure the terminal is running!")
                    await self.speak("I didn't get a response. Make sure Claude Code is running.")
        else:
            print("❌ No speech detected")

    def _get_latest_claude_message(self) -> tuple:
        """
        Get the latest Claude message from inbox.
        Returns (message_id, message_text) or (None, None) if no new message.
        """
        with self._inbox_lock:
            if not INBOX_PATH.exists():
                return None, None

            try:
                with open(INBOX_PATH, 'r') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, KeyError):
                return None, None

            messages = data.get("messages", [])
            if not messages:
                return None, None

            # Find the latest Claude message in voice-mirror thread
            for msg in reversed(messages):
                sender = msg.get("from", "")
                if "claude" in sender.lower() and msg.get("thread_id") == "voice-mirror":
                    return msg.get("id"), msg.get("message", "")

            return None, None

    def _check_compaction_event(self) -> tuple:
        """
        Check if there's a pending compaction event in inbox.
        Returns (event_id, event_data) or (None, None) if no compaction event.
        """
        with self._inbox_lock:
            if not INBOX_PATH.exists():
                return None, None

            try:
                with open(INBOX_PATH, 'r') as f:
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

    def _mark_compaction_read(self, event_id: str):
        """Mark a compaction event as read."""
        with self._inbox_lock:
            if not INBOX_PATH.exists():
                return

            try:
                with open(INBOX_PATH, 'r') as f:
                    data = json.load(f)

                messages = data if isinstance(data, list) else data.get("messages", [])

                for msg in messages:
                    if msg.get("id") == event_id:
                        msg["read"] = True
                        break

                with open(INBOX_PATH, 'w') as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                print(f"⚠️ Error marking compaction read: {e}")

    async def _notification_watcher(self):
        """
        Background task that watches inbox for new Claude messages.
        Speaks them via TTS even when not in active voice conversation.
        Also handles compaction events from PreCompact hook.
        """
        print("📢 Notification watcher started")

        # Initialize with current latest message (don't speak old ones)
        msg_id, _ = self._get_latest_claude_message()
        self._last_seen_message_id = msg_id

        # Track compaction state
        self._awaiting_compact_resume = False
        self._compact_start_time = None

        while True:
            try:
                await asyncio.sleep(NOTIFICATION_POLL_INTERVAL)

                # Check for compaction events first (high priority)
                compact_id, compact_event = self._check_compaction_event()
                if compact_id and not self._awaiting_compact_resume:
                    self._awaiting_compact_resume = True
                    self._compact_start_time = time.time()
                    self._mark_compaction_read(compact_id)
                    print(f"\n⏳ Claude is reorganizing context... conversation will resume shortly")
                    # Optionally speak a brief notification
                    if not self._is_speaking:
                        await self.speak("One moment, I'm reorganizing my thoughts.", enter_conversation_mode=False)
                    continue

                # If awaiting compact resume, check for Claude's response
                if self._awaiting_compact_resume:
                    # Timeout after 60 seconds
                    if time.time() - self._compact_start_time > 60:
                        print("⚠️ Compact resume timeout - Claude may need a nudge")
                        self._awaiting_compact_resume = False
                        continue

                    # Check if Claude has responded (compact finished)
                    msg_id, message = self._get_latest_claude_message()
                    if msg_id and msg_id != self._last_seen_message_id and message:
                        self._last_seen_message_id = msg_id
                        self._awaiting_compact_resume = False
                        print(f"\n✅ Claude resumed after compaction!")
                        await self.speak(message, enter_conversation_mode=True)
                        print("\n👂 Listening for 'Hey Claude'...")
                    continue

                # Skip if currently speaking, recording, or processing
                if self._is_speaking or self.is_recording or self.is_processing:
                    continue

                # Skip if in active conversation mode (user is interacting)
                if self._in_conversation:
                    continue

                # Check for new Claude message
                msg_id, message = self._get_latest_claude_message()

                if msg_id and msg_id != self._last_seen_message_id and message:
                    self._last_seen_message_id = msg_id
                    print(f"\n📢 New notification from Claude!")
                    # Speak without entering conversation mode (it's a notification)
                    await self.speak(message, enter_conversation_mode=False)
                    print("\n👂 Listening for 'Hey Claude'...")

            except Exception as e:
                print(f"⚠️ Notification watcher error: {e}")
                await asyncio.sleep(5)  # Back off on error

    async def run(self):
        """Main loop."""
        self.load_models()

        # Get initial mode
        mode = self.get_voice_mode()
        mode_display = {
            VoiceMode.AUTO: "🎤 Auto (smart routing)",
            VoiceMode.LOCAL: "🏠 Local (all to Qwen)",
            VoiceMode.CLAUDE: "🤖 Claude (all to inbox)"
        }

        print("\n" + "=" * 50)
        print("Voice Mirror - Ready")
        print("=" * 50)
        print(f"Wake word: Hey Claude")
        if self.stt_adapter is not None and self.stt_adapter.is_loaded:
            print(f"STT: {self.stt_adapter.name}")
        else:
            print(f"STT: Not loaded yet (will load on first use)")
        if self.kokoro_model is not None:
            print(f"TTS: Kokoro (voice: {TTS_VOICE}) - LOCAL")
        else:
            print(f"TTS: Not available")
        print(f"Inbox: {INBOX_PATH}")
        print(f"Mode: {mode_display.get(mode, mode)}")
        print(f"Smart Home: {len(self.smart_home.devices)} devices")
        print("=" * 50)
        print("\n👂 Listening for 'Hey Claude'...")
        print("   Say 'Hey Claude' then speak your command!")
        print(f"\n   Conversation mode: {CONVERSATION_WINDOW}s follow-up window")
        print("   (After a response, speak again without wake word)")
        print("\n   Routing modes:")
        print("   - Auto: Smart home → Qwen, General → Claude Code")
        print("   - Local: Everything goes to Qwen")
        print("   - Claude: Everything goes to Claude Code")
        print("\n   Change mode via Context Mirror status bar")
        print("   or edit ~/.context-mirror/voice_mode.json")
        if NOTIFICATION_ENABLED:
            print("\n   📢 Notifications: ON (Claude messages will be spoken)")
        print("   (Press Ctrl+C to quit)\n")

        # List available input devices
        print("\n📢 Available input devices:")
        for i, d in enumerate(sd.query_devices()):
            if d['max_input_channels'] > 0:
                print(f"   {i}: {d['name']} ({d['max_input_channels']} ch)")

        # Try to find a good input device (prefer USB microphones)
        input_device = None
        for i, d in enumerate(sd.query_devices()):
            name = d['name'].lower()
            if d['max_input_channels'] > 0:
                if 'seiren' in name or 'usb' in name and 'audio' in name:
                    input_device = i
                    print(f"   ✅ Selected: {i} - {d['name']}")
                    break
        if input_device is None:
            # Fall back to default
            print("   Using default input device")

        # Start audio stream
        stream = sd.InputStream(
            device=input_device,
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=np.float32,
            blocksize=CHUNK_SAMPLES,
            callback=self.audio_callback
        )

        with stream:
            # Start notification watcher in background
            notification_task = None
            if NOTIFICATION_ENABLED:
                notification_task = asyncio.create_task(self._notification_watcher())

            try:
                while True:
                    await asyncio.sleep(0.1)

                    # Check for silence timeout during recording
                    if self.is_recording and not self.is_processing:
                        elapsed = time.time() - self.last_speech_time
                        if elapsed >= SILENCE_TIMEOUT:
                            print("⏹️ Silence detected, processing...")
                            self.is_recording = False
                            self.is_processing = True
                            await self.process_recording()
                            self.is_processing = False
                            # Show appropriate status based on mode
                            if self.is_call_active():
                                print("\n📞 Call active - speak anytime...")
                            elif self._in_conversation:
                                remaining = max(0, self._conversation_end_time - time.time())
                                print(f"\n💬 Conversation active ({remaining:.1f}s) - speak without wake word...")
                            else:
                                print("\n👂 Listening for 'Hey Claude'...")

            except KeyboardInterrupt:
                print("\n\n👋 Goodbye!")
            finally:
                # Cancel notification watcher
                if notification_task:
                    notification_task.cancel()
                    try:
                        await notification_task
                    except asyncio.CancelledError:
                        pass


async def main():
    agent = VoiceMirror()
    await agent.run()


def cleanup_on_exit():
    """Kill any child processes on exit."""
    import psutil
    try:
        current = psutil.Process()
        children = current.children(recursive=True)
        for child in children:
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        # Give them a moment to terminate
        psutil.wait_procs(children, timeout=2)
        # Force kill any remaining
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
    except Exception:
        pass  # Best effort cleanup


def signal_handler(signum, frame):
    """Handle termination signals gracefully."""
    print("\n👋 Shutting down Voice Mirror...")
    cleanup_on_exit()
    sys.exit(0)


if __name__ == "__main__":
    # Register cleanup handlers
    atexit.register(cleanup_on_exit)
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    # SIGHUP for when terminal closes
    if hasattr(signal, 'SIGHUP'):
        signal.signal(signal.SIGHUP, signal_handler)

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Shutting down Voice Mirror...")
        cleanup_on_exit()
