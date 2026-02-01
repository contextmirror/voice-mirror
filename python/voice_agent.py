#!/usr/bin/env python3
"""
Voice Mirror - Local Voice Agent

Listens for "Hey Claude" wake word, transcribes speech with local STT,
and sends to AI provider via MCP inbox.

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
import sys
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
from audio.state import AudioState
from audio.wake_word import WakeWordProcessor
from notifications import NotificationWatcher

# Modular components
from providers.config import (
    ActivationMode,
    get_activation_mode,
    get_ai_provider,
    strip_provider_prefix,
)
from providers.inbox import InboxManager
from providers.inbox import cleanup_inbox as _cleanup_inbox

# Settings (includes STT configuration)
from settings import load_voice_settings

# STT adapters
from stt import create_stt_adapter
from tts import create_tts_adapter

# Configuration
TTS_VOICE = os.getenv("TTS_VOICE", "af_bella")  # Female voice, change to am_puck for male
WAKE_WORD_MODEL = "models/hey_claude_v2.onnx"
WAKE_WORD_THRESHOLD = 0.98  # Strict but usable
SILENCE_TIMEOUT = 10.0  # seconds of silence before stopping recording
CONVERSATION_WINDOW = 5.0  # seconds to wait for follow-up without wake word

# Voice Mirror data directory (cross-platform)
from shared.paths import get_data_dir
VM_DATA_DIR = get_data_dir()
VM_DATA_DIR.mkdir(parents=True, exist_ok=True)

# MCP inbox path
INBOX_PATH = VM_DATA_DIR / "inbox.json"

# Voice call state
VOICE_CALL_PATH = VM_DATA_DIR / "voice_call.json"

# Push-to-talk trigger file (written by Electron)
PTT_TRIGGER_PATH = VM_DATA_DIR / "ptt_trigger.json"

# Voice cloning IPC files (written by MCP server)
VOICE_CLONE_REQUEST_PATH = VM_DATA_DIR / "voice_clone_request.json"
VOICE_CLONE_RESPONSE_PATH = VM_DATA_DIR / "voice_clone_response.json"

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
    """Wrapper for inbox cleanup using INBOX_PATH."""
    return _cleanup_inbox(INBOX_PATH, max_age_hours)


class VoiceMirror:
    """Voice agent with wake word detection, STT, and smart routing."""

    def __init__(self):
        # Modular components
        self.wake_word = WakeWordProcessor(
            model_path=WAKE_WORD_MODEL,
            threshold=WAKE_WORD_THRESHOLD,
            chunk_samples=CHUNK_SAMPLES
        )
        self.tts = None  # TTS adapter (kokoro, qwen, etc.) - loaded in load_models()
        self.inbox = InboxManager(INBOX_PATH, lambda: self._ai_provider)
        self.audio_state = AudioState()  # Shared audio state
        self.stt_adapter = None  # STT adapter (parakeet, whisper, etc.)

        self._activation_mode = ActivationMode.WAKE_WORD  # Will be set in load_models
        self._ai_provider = {"provider": "claude", "name": "Claude", "model": None}  # Will be set in load_models

    def get_listening_status(self) -> str:
        """Get the appropriate listening status message based on activation mode."""
        if self._activation_mode == ActivationMode.WAKE_WORD:
            wake_phrase = self._ai_provider.get('wakePhrase', 'Hey Claude')
            return f"👂 Listening for '{wake_phrase}'..."
        elif self._activation_mode == ActivationMode.CALL_MODE:
            return "📞 Call mode active - speak anytime..."
        elif self._activation_mode == ActivationMode.PUSH_TO_TALK:
            return "🎙️ Push-to-talk mode - press key to speak..."
        else:
            return "👂 Listening..."

    def refresh_ai_provider(self):
        """
        Re-read AI provider config from Electron config file.
        Called before sending/waiting for responses to ensure we use the current provider.
        """
        old_provider = self._ai_provider.get('provider')
        self._ai_provider = get_ai_provider()
        new_provider = self._ai_provider.get('provider')

        if old_provider != new_provider:
            print(f"🔄 AI Provider changed: {old_provider} -> {new_provider} ({self._ai_provider['name']})")

    def refresh_tts_settings(self):
        """
        Re-read TTS settings from config and update the TTS adapter if voice changed.
        Called when settings are updated from Electron.
        """
        settings = load_voice_settings()
        new_voice = settings.get("tts_voice")

        if self.tts and new_voice and new_voice != self.tts.voice:
            if self.tts.set_voice(new_voice):
                print(f"✅ TTS voice updated to: {new_voice}")

    def load_models(self):
        """Load OpenWakeWord and Parakeet models."""
        # Clean up old inbox messages on startup
        removed = cleanup_inbox()
        if removed > 0:
            print(f"🧹 Cleaned {removed} old message(s) from inbox")

        # Get activation mode from Electron config
        self._activation_mode = get_activation_mode()
        print(f"Activation mode: {self._activation_mode}")

        # Get AI provider from Electron config
        self._ai_provider = get_ai_provider()
        print(f"AI Provider: {self._ai_provider['name']}")

        # Only load wake word model if wake word mode is enabled
        if self._activation_mode == ActivationMode.WAKE_WORD:
            script_dir = Path(__file__).parent
            self.wake_word.load(script_dir)
        else:
            print(f"Skipping wake word model (mode: {self._activation_mode})")

        script_dir = Path(__file__).parent

        # Load STT adapter from settings
        settings = load_voice_settings()
        adapter_name = settings.get("stt_adapter", "parakeet")
        model_name = settings.get("stt_model", None)

        try:
            print(f"Loading STT adapter: {adapter_name}")
            if model_name:
                print(f"  Model: {model_name}")
            else:
                print("  Using default model")

            self.stt_adapter = create_stt_adapter(adapter_name, model_name)

            # Load the adapter (async, so we'll do it in the event loop later)
            # For now just create the instance
            print("  (First run may download model, please wait...)")

        except Exception as e:
            print(f"❌ Failed to create STT adapter: {e}")
            print("   Falling back to parakeet")
            try:
                self.stt_adapter = create_stt_adapter("parakeet")
            except Exception:
                self.stt_adapter = None

        # Load TTS adapter from settings
        tts_adapter = settings.get("tts_adapter", "kokoro")
        tts_voice = settings.get("tts_voice", TTS_VOICE)
        tts_model_size = settings.get("tts_model_size", "0.6B")

        try:
            print(f"Loading TTS adapter: {tts_adapter}")
            print(f"  Voice: {tts_voice}")
            if tts_adapter == "qwen":
                print(f"  Model size: {tts_model_size}")
            self.tts = create_tts_adapter(tts_adapter, voice=tts_voice, model_size=tts_model_size)
        except ValueError as e:
            print(f"⚠️ {e}")
            print("   Falling back to kokoro")
            self.tts = create_tts_adapter("kokoro", voice=tts_voice)

        # Load TTS model
        self.tts.load()

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
                with open(VOICE_CALL_PATH, encoding='utf-8') as f:
                    data = json.load(f)
                    active = data.get("active", False)
                    if active != getattr(self, '_call_active', False):
                        if active:
                            print("\n📞 Call started - listening without wake word")
                        else:
                            print("\n📞 Call ended - returning to wake word mode")
                    self._call_active = active
                    return active
        except Exception:
            pass

        self._call_active = False
        return False

    def check_ptt_trigger(self) -> str | None:
        """
        Check for push-to-talk trigger from Electron.
        Returns 'start', 'stop', or None.
        Reads and clears the trigger file.
        """
        now = time.time()
        # Check at most every 50ms to avoid excessive file reads
        if now - self.audio_state.ptt_last_check < 0.05:
            return None
        self.audio_state.ptt_last_check = now

        try:
            if PTT_TRIGGER_PATH.exists():
                with open(PTT_TRIGGER_PATH, encoding='utf-8') as f:
                    data = json.load(f)
                    action = data.get("action")

                # Clear the trigger file after reading
                PTT_TRIGGER_PATH.unlink()

                if action == "start" and not self.audio_state.ptt_active:
                    self.audio_state.ptt_active = True
                    return "start"
                elif action == "stop" and self.audio_state.ptt_active:
                    self.audio_state.ptt_active = False
                    return "stop"
        except json.JSONDecodeError:
            # File might be partially written, try again next time
            pass
        except FileNotFoundError:
            # File was already processed
            pass
        except Exception as e:
            # Log other errors but don't crash
            print(f"PTT trigger error: {e}")

        return None

    def send_to_inbox(self, message: str):
        """Send transcribed message to MCP inbox."""
        return self.inbox.send(message)

    async def check_voice_clone_request(self):
        """
        Check for voice clone requests from MCP server.
        Handles clone and clear actions.
        """
        try:
            if not VOICE_CLONE_REQUEST_PATH.exists():
                return

            with open(VOICE_CLONE_REQUEST_PATH, encoding='utf-8') as f:
                request = json.load(f)

            # Clear request file immediately to avoid re-processing
            VOICE_CLONE_REQUEST_PATH.unlink()

            action = request.get('action')
            print(f"🎤 Voice clone request: {action}")

            if action == 'clone':
                await self._handle_voice_clone(request)
            elif action == 'clear':
                await self._handle_voice_clone_clear()
            else:
                print(f"⚠️ Unknown voice clone action: {action}")

        except json.JSONDecodeError:
            pass  # File might be partially written
        except FileNotFoundError:
            pass  # Already processed
        except Exception as e:
            print(f"❌ Voice clone request error: {e}")
            self._write_voice_clone_response(False, str(e))

    async def _handle_voice_clone(self, request: dict):
        """Process a voice cloning request."""
        audio_path = request.get('audio_path')
        voice_name = request.get('voice_name', 'custom')
        transcript = request.get('transcript')

        if not audio_path or not Path(audio_path).exists():
            self._write_voice_clone_response(False, f"Audio file not found: {audio_path}")
            return

        # Check if TTS adapter supports voice cloning (Qwen)
        if not hasattr(self.tts, 'set_voice_clone'):
            self._write_voice_clone_response(
                False,
                "Current TTS adapter does not support voice cloning. Switch to Qwen3-TTS in settings."
            )
            return

        # Auto-transcribe if no transcript provided
        if not transcript:
            print("🎤 Auto-transcribing reference audio...")
            try:
                import soundfile as sf
                audio_data, sr = sf.read(audio_path)

                # Ensure STT is loaded
                if not self.stt_adapter.is_loaded:
                    await self.stt_adapter.load()

                # Transcribe (expects float32 mono at 16kHz)
                if len(audio_data.shape) > 1:
                    audio_data = audio_data[:, 0]  # Mono
                if sr != SAMPLE_RATE:
                    # Resample if needed (ffmpeg should have done this, but just in case)
                    import scipy.signal
                    audio_data = scipy.signal.resample(
                        audio_data,
                        int(len(audio_data) * SAMPLE_RATE / sr)
                    )
                audio_data = audio_data.astype(np.float32)

                transcript = await self.stt_adapter.transcribe(audio_data, SAMPLE_RATE)
                print(f"📝 Transcription: \"{transcript}\"")

                if not transcript or len(transcript.strip()) < 2:
                    self._write_voice_clone_response(
                        False,
                        "Could not transcribe audio. Please provide a transcript manually."
                    )
                    return

            except Exception as e:
                self._write_voice_clone_response(False, f"Transcription failed: {e}")
                return

        # Set up voice clone
        print(f"🎤 Setting up voice clone: {voice_name}")
        try:
            success = self.tts.set_voice_clone(audio_path, transcript)
            if success:
                print(f"✅ Voice clone '{voice_name}' activated!")
                self._write_voice_clone_response(True, transcript=transcript)
            else:
                self._write_voice_clone_response(False, "Failed to create voice clone prompt")
        except Exception as e:
            self._write_voice_clone_response(False, f"Voice clone setup failed: {e}")

    async def _handle_voice_clone_clear(self):
        """Clear current voice clone."""
        if hasattr(self.tts, 'clear_voice_clone'):
            self.tts.clear_voice_clone()
            print("✅ Voice clone cleared, using preset voice")
            self._write_voice_clone_response(True)
        else:
            self._write_voice_clone_response(True)  # No-op for adapters without cloning

    def _write_voice_clone_response(self, success: bool, error: str = None, transcript: str = None):
        """Write response file for MCP server."""
        response = {
            'success': success,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S')
        }
        if error:
            response['error'] = error
        if transcript:
            response['transcript'] = transcript

        with open(VOICE_CLONE_RESPONSE_PATH, 'w', encoding='utf-8') as f:
            json.dump(response, f, indent=2)

    async def wait_for_claude_response(self, my_message_id: str, timeout: float = 60.0) -> str:
        """Wait for AI provider to respond to our message via inbox polling."""
        self.refresh_ai_provider()
        return await self.inbox.wait_for_response(my_message_id, timeout)

    async def speak(self, text: str, enter_conversation_mode: bool = True):
        """Convert text to speech and play it using TTSManager."""
        def on_speech_start():
            self.audio_state.is_listening = False

        def on_speech_end():
            print("🔇 Speaking done")
            self.audio_state.is_listening = True
            self.wake_word.clear_buffer()

            # Enter conversation mode only for wake word or follow-up interactions
            should_enter_conversation = (
                enter_conversation_mode and
                not self.is_call_active() and
                self.audio_state.recording_source in ('wake_word', 'follow_up')
            )
            if should_enter_conversation:
                self.audio_state.in_conversation = True
                self.audio_state.conversation_end_time = time.time() + CONVERSATION_WINDOW
                print(f"💬 Conversation mode active ({CONVERSATION_WINDOW}s window - speak without wake word)")
            elif self.audio_state.recording_source == 'ptt':
                print("👂 PTT finished. Press key to speak again.")
            elif self.is_call_active():
                print("📞 Call active - speak anytime...")

        await self.tts.speak(text, on_start=on_speech_start, on_end=on_speech_end)

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
        detected, model_name, score = self.wake_word.process(audio_chunk)
        if detected:
            print(f"\n🎤 Wake word detected! ({model_name}: {score:.2f})")
        return detected

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
            print(f"🎤 Audio: level={level:.4f}, energy={energy:.4f}, listening={self.audio_state.is_listening}, call={call_active}")

        if level > 0.05:
            bars = int(level * 20)
            print(f"🔊 {'█' * bars}", end="\r")

        audio = indata[:, 0].copy()  # Mono

        # Check for push-to-talk trigger (from Electron)
        ptt_action = self.check_ptt_trigger()
        if ptt_action == "start" and not self.audio_state.is_recording:
            # Interrupt TTS if speaking
            if self.tts.is_speaking:
                self.tts.stop_speaking()
                print("🔇 TTS interrupted by PTT")
            self.audio_state.start_recording('ptt')
            self.audio_state._ptt_start_time = time.time()
            print('🔴 Recording (PTT)... (speak now)')
        elif ptt_action == "stop" and self.audio_state.is_recording and not self.audio_state.is_processing:
            # PTT released - process immediately (don't wait for silence)
            print('⏹️ PTT released, processing...{"event": "recording_stop", "data": {}}')
            self.audio_state.is_recording = False
            self.audio_state.is_processing = True
            # Schedule processing (we're in audio callback, can't await here)
            # Use a flag to trigger processing in main loop
            self.audio_state.ptt_process_pending = True

        # Safety: force-stop PTT recording if it exceeds 30 seconds (missed stop trigger)
        if self.audio_state.is_recording and hasattr(self.audio_state, '_ptt_start_time'):
            if time.time() - self.audio_state._ptt_start_time > 120:
                print('⚠️ PTT recording timeout (120s), force-stopping')
                self.audio_state.is_recording = False
                self.audio_state.ptt_active = False
                self.audio_state.is_processing = True
                self.audio_state.ptt_process_pending = True

        if self.audio_state.is_listening and not self.audio_state.is_recording:
            # Push-to-talk mode: only record when PTT is pressed (handled above)
            if self._activation_mode == ActivationMode.PUSH_TO_TALK:
                # In PTT mode, don't auto-detect speech - wait for PTT trigger
                pass
            # Check if in call mode (setting or file-based)
            elif self._activation_mode == ActivationMode.CALL_MODE or self.is_call_active():
                # In call mode - detect speech start without wake word
                energy = np.abs(audio).mean()
                # Debug: show energy level in call mode
                if energy > 0.005:
                    print(f"📞 Call mode energy: {energy:.4f}", end="\r")
                if energy > 0.008:  # Very sensitive threshold for speech detection
                    self.audio_state.start_recording('call')
                    print(f"\n🔴 Recording (call)... energy={energy:.4f} (speak now)")
            # Check if in conversation mode (no wake word needed, with timeout)
            elif self.audio_state.in_conversation:
                # Check if conversation window expired
                if time.time() > self.audio_state.conversation_end_time:
                    self.audio_state.in_conversation = False
                    if self._activation_mode == ActivationMode.WAKE_WORD:
                        wake_phrase = self._ai_provider.get('wakePhrase', 'Hey Claude')
                        print(f"\n👂 Conversation window closed. Say '{wake_phrase}' to continue.")
                    else:
                        print(f"\n{self.get_listening_status()}")
                else:
                    # In conversation mode - detect speech start without wake word
                    energy = np.abs(audio).mean()
                    if energy > 0.03:  # Speech threshold (slightly higher to avoid noise)
                        self.audio_state.start_recording('follow_up')
                        self.audio_state.in_conversation = False  # Exit conversation mode once recording starts
                        print("🔴 Recording follow-up... (speak now)")
            elif self._activation_mode == ActivationMode.WAKE_WORD and self.wake_word.is_loaded:
                # Wake word mode - check for wake word
                if self.process_wake_word(audio):
                    self.audio_state.start_recording('wake_word')
                    self.wake_word.reset()
                    print("🔴 Recording (wake word)... (speak now)")

        elif self.audio_state.is_recording and not self.audio_state.is_processing:
            # Record audio (thread-safe via AudioState)
            self.audio_state.append_audio(audio)

            # Simple VAD: check if there's significant audio
            energy = np.abs(audio).mean()
            if energy > 0.01:  # Lowered threshold for VAD
                self.audio_state.last_speech_time = time.time()

    async def process_recording(self):
        """Process recorded audio after silence timeout."""
        # Atomically grab the buffer and clear it (thread-safe via AudioState)
        audio_data = self.audio_state.get_and_clear_buffer()
        if audio_data is None:
            return

        # Minimum duration check — discard very short recordings (accidental PTT taps, noise)
        # At 16kHz sample rate, 0.4s = 6400 samples
        min_samples = int(0.4 * 16000)
        if len(audio_data) < min_samples:
            duration_ms = int(len(audio_data) / 16000 * 1000)
            print(f"🗑️ Recording too short ({duration_ms}ms), discarding")
            self.audio_state.is_processing = False
            return

        duration_ms_total = int(len(audio_data) / 16000 * 1000)
        peak = np.abs(audio_data).max()
        print(f"🎙️ Recording: {duration_ms_total}ms, peak={peak:.4f}")

        print("⏳ Transcribing...")

        text = await self.transcribe(audio_data)

        # Filter out garbage transcriptions (single chars, very short, or common artifacts)
        if text and len(text.strip()) < 3:
            print(f"🗑️ Ignoring short transcription: '{text}'")
            return

        if text:
            print(f"📝 You said: {text}")

            # Send to AI provider via inbox
            msg_id = self.send_to_inbox(text)

            # Wait for AI provider to respond via inbox
            response = await self.wait_for_claude_response(msg_id, timeout=90.0)
            if response:
                print(f"💬 {self._ai_provider['name']}: {response}")
                # Strip provider prefix before speaking (e.g., "Claude: " -> "")
                clean_response = strip_provider_prefix(response)
                await self.speak(clean_response)
            else:
                print(f"⏰ No response from {self._ai_provider['name']} (timeout - this is normal if thinking)")
        else:
            print("❌ No speech detected")

    async def run(self):
        """Main loop."""
        self.load_models()

        # Load voice config for device selection
        self._voice_config = {}
        try:
            from providers.config import ELECTRON_CONFIG_PATH
            if ELECTRON_CONFIG_PATH.exists():
                with open(ELECTRON_CONFIG_PATH, encoding='utf-8') as f:
                    self._voice_config = json.load(f).get("voice", {})
        except Exception:
            pass

        print("\n" + "=" * 50)
        print("Voice Mirror - Ready")
        print("=" * 50)
        # Show activation mode info
        activation_display = {
            ActivationMode.WAKE_WORD: "🎤 Wake Word (Hey Claude)",
            ActivationMode.CALL_MODE: "📞 Call Mode (always listening)",
            ActivationMode.PUSH_TO_TALK: "🎙️ Push-to-Talk"
        }
        print(f"Activation: {activation_display.get(self._activation_mode, self._activation_mode)}")
        if self.stt_adapter is not None and self.stt_adapter.is_loaded:
            print(f"STT: {self.stt_adapter.name}")
        else:
            print("STT: Not loaded yet (will load on first use)")
        if self.tts and self.tts.is_loaded:
            print(f"TTS: {self.tts.name} - LOCAL")
        else:
            print("TTS: Not available")
        print(f"Inbox: {INBOX_PATH}")
        print(f"Routing: 🤖 {self._ai_provider['name']} (via MCP inbox)")
        print("=" * 50)

        # Show activation mode specific instructions
        print(f"\n{self.get_listening_status()}")
        if self._activation_mode == ActivationMode.WAKE_WORD:
            wake_phrase = self._ai_provider.get('wakePhrase', 'Hey Claude')
            print(f"   Say '{wake_phrase}' then speak your command!")
            print(f"\n   Conversation mode: {CONVERSATION_WINDOW}s follow-up window")
            print("   (After a response, speak again without wake word)")
        elif self._activation_mode == ActivationMode.CALL_MODE:
            print("   Just start speaking - no wake word needed!")
        elif self._activation_mode == ActivationMode.PUSH_TO_TALK:
            print("   Hold your PTT key and speak, release to process.")

        if NOTIFICATION_ENABLED:
            print("\n   📢 Notifications: ON (Claude messages will be spoken)")
        print("   (Press Ctrl+C to quit)\n")

        # List available input devices
        print("\n📢 Available input devices:")
        for i, d in enumerate(sd.query_devices()):
            if d['max_input_channels'] > 0:
                print(f"   {i}: {d['name']} ({d['max_input_channels']} ch)")

        # Select input device: config override > known mic brands > generic USB > default
        input_device = None

        # Check config for explicit device override
        config_device = self._voice_config.get("inputDevice")
        if config_device is not None:
            if isinstance(config_device, int):
                input_device = config_device
                print(f"   ✅ Selected (config): {input_device} - {sd.query_devices(input_device)['name']}")
            elif isinstance(config_device, str):
                for i, d in enumerate(sd.query_devices()):
                    if d['max_input_channels'] > 0 and config_device.lower() in d['name'].lower():
                        input_device = i
                        print(f"   ✅ Selected (config match): {i} - {d['name']}")
                        break

        # Two-pass auto-detection: known mic brands first, then generic USB
        if input_device is None:
            known_mics = ['seiren', 'yeti', 'snowball', 'at2020', 'elgato', 'hyperx',
                          'blue', 'rode', 'fifine', 'tonor', 'samson']
            for i, d in enumerate(sd.query_devices()):
                name = d['name'].lower()
                if d['max_input_channels'] > 0:
                    if any(mic in name for mic in known_mics):
                        input_device = i
                        print(f"   ✅ Selected: {i} - {d['name']}")
                        break
        if input_device is None:
            for i, d in enumerate(sd.query_devices()):
                name = d['name'].lower()
                if d['max_input_channels'] > 0:
                    if 'usb' in name and 'audio' in name:
                        input_device = i
                        print(f"   ✅ Selected: {i} - {d['name']}")
                        break
        if input_device is None:
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
            # Start GlobalHotkey listener NOW that the audio stream is active
            # (must be after stream start so PTT triggers aren't lost during model loading)
            try:
                from electron_bridge import _hotkey_listener
                if self._activation_mode == ActivationMode.PUSH_TO_TALK and not _hotkey_listener._running:
                    ptt_key = self._voice_config.get("pttKey") or \
                              self._voice_config.get("activationMode") and "MouseButton4"
                    # Read PTT key from main config
                    from providers.config import ELECTRON_CONFIG_PATH
                    if ELECTRON_CONFIG_PATH.exists():
                        with open(ELECTRON_CONFIG_PATH, encoding='utf-8') as f:
                            behavior = json.load(f).get("behavior", {})
                            ptt_key = behavior.get("pttKey", "MouseButton4")
                    _hotkey_listener.start(ptt_key or "MouseButton4")
            except Exception as e:
                print(f"[GlobalHotkey] Failed to start from voice_agent: {e}")

            # Start notification watcher in background
            notification_task = None
            if NOTIFICATION_ENABLED:
                # Create notification watcher with callbacks
                def on_notification_speech_start():
                    self.audio_state.is_listening = False

                def on_notification_speech_end(enter_conversation_mode: bool):
                    print("🔇 Speaking done")
                    self.audio_state.is_listening = True
                    self.wake_word.clear_buffer()
                    if enter_conversation_mode:
                        self.audio_state.enter_conversation_mode(CONVERSATION_WINDOW)
                        print(f"💬 Conversation mode active ({CONVERSATION_WINDOW}s window)")

                notification_watcher = NotificationWatcher(
                    inbox=self.inbox,
                    tts=self.tts,
                    poll_interval=NOTIFICATION_POLL_INTERVAL,
                    is_recording=lambda: self.audio_state.is_recording,
                    is_processing=lambda: self.audio_state.is_processing,
                    in_conversation=lambda: self.audio_state.in_conversation,
                    provider_refresh=self.refresh_ai_provider,
                    get_listening_status=self.get_listening_status,
                    get_ai_provider_name=lambda: self._ai_provider['name'],
                    on_speech_start=on_notification_speech_start,
                    on_speech_end=on_notification_speech_end,
                )
                notification_task = asyncio.create_task(notification_watcher.run())

            try:
                while True:
                    await asyncio.sleep(0.1)

                    # Check for voice clone requests from MCP server
                    await self.check_voice_clone_request()

                    # Check for PTT release (process immediately)
                    if self.audio_state.ptt_process_pending:
                        self.audio_state.ptt_process_pending = False
                        await self.process_recording()
                        self.audio_state.is_processing = False
                        print(f"\n{self.get_listening_status()}")
                        continue

                    # Check for silence timeout during recording
                    if self.audio_state.is_recording and not self.audio_state.is_processing:
                        elapsed = time.time() - self.audio_state.last_speech_time
                        if elapsed >= SILENCE_TIMEOUT:
                            print("⏹️ Silence detected, processing...")
                            self.audio_state.is_recording = False
                            self.audio_state.is_processing = True
                            await self.process_recording()
                            self.audio_state.is_processing = False
                            # Show appropriate status based on mode
                            if self.is_call_active():
                                print("\n📞 Call active - speak anytime...")
                            elif self.audio_state.in_conversation:
                                remaining = max(0, self.audio_state.conversation_end_time - time.time())
                                print(f"\n💬 Conversation active ({remaining:.1f}s) - speak without wake word...")
                            else:
                                print(f"\n{self.get_listening_status()}")

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
