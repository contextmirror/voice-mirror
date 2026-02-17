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
import threading
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
from audio.state import AudioState
from audio.vad import SileroVAD
from audio.wake_word import WakeWordProcessor
from notifications import NotificationWatcher

# Modular components
from providers.config import (
    ActivationMode,
    get_activation_mode,
    get_ai_provider,
    strip_provider_prefix,
)
from providers.inbox import MCP_CLI_PROVIDERS, InboxManager
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
from shared.paths import get_data_dir, safe_path
VM_DATA_DIR = get_data_dir()
VM_DATA_DIR.mkdir(parents=True, exist_ok=True)

# MCP inbox path
INBOX_PATH = VM_DATA_DIR / "inbox.json"
safe_path(INBOX_PATH, VM_DATA_DIR)

# Push-to-talk trigger file (written by Electron)
PTT_TRIGGER_PATH = VM_DATA_DIR / "ptt_trigger.json"
safe_path(PTT_TRIGGER_PATH, VM_DATA_DIR)

# Dictation trigger file (written by Electron)
DICTATION_TRIGGER_PATH = VM_DATA_DIR / "dictation_trigger.json"
safe_path(DICTATION_TRIGGER_PATH, VM_DATA_DIR)

# Voice cloning IPC files (written by MCP server)
VOICE_CLONE_REQUEST_PATH = VM_DATA_DIR / "voice_clone_request.json"
safe_path(VOICE_CLONE_REQUEST_PATH, VM_DATA_DIR)
VOICE_CLONE_RESPONSE_PATH = VM_DATA_DIR / "voice_clone_response.json"
safe_path(VOICE_CLONE_RESPONSE_PATH, VM_DATA_DIR)

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
        def _get_sender_name():
            try:
                config_path = VM_DATA_DIR / "voice_config.json"
                safe_path(config_path, VM_DATA_DIR)
                if config_path.exists():
                    with open(config_path, encoding='utf-8') as f:
                        name = json.load(f).get("userName")
                        return name.lower() if name else "user"
            except Exception:
                pass
            return "user"
        self.inbox = InboxManager(INBOX_PATH, lambda: self._ai_provider, sender_name_getter=_get_sender_name)
        self.audio_state = AudioState()  # Shared audio state
        self.vad = SileroVAD()  # Neural VAD (loaded in load_models)
        self.stt_adapter = None  # STT adapter (parakeet, whisper, etc.)

        self._activation_mode = ActivationMode.WAKE_WORD  # Will be set in load_models
        self._ai_provider = {"provider": "claude", "name": "Claude", "model": None}  # Will be set in load_models

        # Thread-safe events for trigger polling (set in main loop, read in audio callback)
        self._ptt_action: str | None = None  # Set by main loop from check_ptt_trigger()
        self._dictation_action: str | None = None  # Set by main loop from check_dictation_trigger()

        # Deferred model loading state
        self._stt_settings: dict = {}  # STT kwargs saved from load_models
        self._tts_settings: dict = {}  # TTS kwargs saved from load_models

    def get_listening_status(self) -> str:
        """Get the appropriate listening status message based on activation mode."""
        if self._activation_mode == ActivationMode.WAKE_WORD:
            wake_phrase = self._ai_provider.get('wakePhrase', 'Hey Claude')
            return f"[LISTEN] Listening for '{wake_phrase}'..."
        elif self._activation_mode == ActivationMode.PUSH_TO_TALK:
            return "[MIC] Push-to-talk mode - press key to speak..."
        else:
            return "[LISTEN] Listening..."

    def refresh_ai_provider(self):
        """
        Re-read AI provider config from Electron config file.
        Called before sending/waiting for responses to ensure we use the current provider.
        """
        old_provider = self._ai_provider.get('provider')
        self._ai_provider = get_ai_provider()
        new_provider = self._ai_provider.get('provider')

        if old_provider != new_provider:
            print(f"[RELOAD] AI Provider changed: {old_provider} -> {new_provider} ({self._ai_provider['name']})")

    def refresh_tts_settings(self):
        """
        Re-read TTS settings from config and update/reload the TTS adapter.
        Called when settings are updated from Electron.
        Handles both voice changes and adapter type changes.
        """
        settings = load_voice_settings()
        new_adapter = settings.get("tts_adapter", "kokoro")
        new_voice = settings.get("tts_voice")
        new_model_size = settings.get("tts_model_size", "0.6B")

        # Collect extra kwargs for cloud/custom adapters
        adapter_kwargs = {}
        if settings.get("tts_api_key"):
            adapter_kwargs["api_key"] = settings["tts_api_key"]
        if settings.get("tts_endpoint"):
            adapter_kwargs["endpoint"] = settings["tts_endpoint"]
        if settings.get("tts_model_path"):
            adapter_kwargs["model_path"] = settings["tts_model_path"]

        # Rebuild the TTS adapter if: type changed, adapter is None, or model
        # failed to load previously (e.g. pip package was just installed)
        adapter_broken = self.tts is not None and getattr(self.tts, 'model', None) is None
        need_rebuild = self.tts is None or new_adapter != self.tts.adapter_type or adapter_broken
        if need_rebuild:
            old_type = self.tts.adapter_type if self.tts else "none"
            print(f"[RELOAD] TTS adapter changed: {old_type} -> {new_adapter}")
            # Stop any in-progress playback before replacing the adapter
            if self.tts:
                try:
                    self.tts.stop_speaking()
                except Exception:
                    pass
            try:
                self.tts = create_tts_adapter(new_adapter, voice=new_voice, model_size=new_model_size, **adapter_kwargs)
                self.tts.volume = float(settings.get("tts_volume", 1.0))
                self.tts.load()
                print(f"[OK] TTS adapter reloaded: {new_adapter} (voice: {new_voice})")
            except Exception as e:
                print(f"[ERR] Failed to reload TTS adapter: {e}")
            return

        # Update volume
        new_volume = settings.get("tts_volume", 1.0)
        if self.tts:
            self.tts.volume = float(new_volume)

        # Same adapter, just update voice if changed
        if self.tts and new_voice and new_voice != self.tts.voice:
            if self.tts.set_voice(new_voice):
                print(f"[OK] TTS voice updated to: {new_voice}")

    def load_models(self):
        """Load OpenWakeWord and Parakeet models."""
        # Clean up old inbox messages on startup
        removed = cleanup_inbox()
        if removed > 0:
            print(f"[CLEAN] Cleaned {removed} old message(s) from inbox")

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

        # Load Silero VAD model
        if self.vad.load(script_dir / "models"):
            print("Silero VAD loaded")
        else:
            print("Silero VAD not available, using energy fallback")

        # Create STT adapter (deferred loading — loads on first transcribe())
        settings = load_voice_settings()
        adapter_name = settings.get("stt_adapter", "parakeet")
        model_name = settings.get("stt_model", None)

        # Collect extra STT kwargs for cloud/custom adapters
        stt_kwargs = {}
        if settings.get("stt_api_key"):
            stt_kwargs["api_key"] = settings["stt_api_key"]
        if settings.get("stt_endpoint"):
            stt_kwargs["endpoint"] = settings["stt_endpoint"]
        if settings.get("stt_model_name"):
            stt_kwargs["model_name"] = settings["stt_model_name"]

        try:
            print(f"STT adapter: {adapter_name} (deferred load)")
            if model_name:
                print(f"  Model: {model_name}")

            self.stt_adapter = create_stt_adapter(adapter_name, model_name, **stt_kwargs)

        except Exception as e:
            print(f"[ERR] Failed to create STT adapter: {e}")
            print("   Falling back to parakeet")
            try:
                self.stt_adapter = create_stt_adapter("parakeet")
            except Exception:
                self.stt_adapter = None

        # Create TTS adapter (deferred loading — loads on first speak())
        tts_adapter = settings.get("tts_adapter", "kokoro")
        tts_voice = settings.get("tts_voice", TTS_VOICE)
        tts_model_size = settings.get("tts_model_size", "0.6B")

        # Collect extra TTS kwargs for cloud/custom adapters
        tts_kwargs = {}
        if settings.get("tts_api_key"):
            tts_kwargs["api_key"] = settings["tts_api_key"]
        if settings.get("tts_endpoint"):
            tts_kwargs["endpoint"] = settings["tts_endpoint"]
        if settings.get("tts_model_path"):
            tts_kwargs["model_path"] = settings["tts_model_path"]

        try:
            print(f"TTS adapter: {tts_adapter} (deferred load)")
            print(f"  Voice: {tts_voice}")
            if tts_adapter == "qwen":
                print(f"  Model size: {tts_model_size}")
            self.tts = create_tts_adapter(tts_adapter, voice=tts_voice, model_size=tts_model_size, **tts_kwargs)
        except ValueError as e:
            print(f"[WARN] {e}")
            print("   Falling back to kokoro")
            self.tts = create_tts_adapter("kokoro", voice=tts_voice)

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
                safe_path(PTT_TRIGGER_PATH, VM_DATA_DIR)
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

    def check_dictation_trigger(self) -> str | None:
        """
        Check for dictation trigger from Electron.
        Returns 'start', 'stop', or None.
        Reads and clears the trigger file.
        """
        now = time.time()
        # Check at most every 50ms to avoid excessive file reads
        if now - self.audio_state.dictation_last_check < 0.05:
            return None
        self.audio_state.dictation_last_check = now

        try:
            if DICTATION_TRIGGER_PATH.exists():
                safe_path(DICTATION_TRIGGER_PATH, VM_DATA_DIR)
                with open(DICTATION_TRIGGER_PATH, encoding='utf-8') as f:
                    data = json.load(f)
                    action = data.get("action")

                # Clear the trigger file after reading
                DICTATION_TRIGGER_PATH.unlink()

                if action == "start" and not self.audio_state.dictation_active:
                    self.audio_state.dictation_active = True
                    return "start"
                elif action == "stop" and self.audio_state.dictation_active:
                    self.audio_state.dictation_active = False
                    return "stop"
        except json.JSONDecodeError:
            # File might be partially written, try again next time
            pass
        except FileNotFoundError:
            # File was already processed
            pass
        except Exception as e:
            # Log other errors but don't crash
            print(f"Dictation trigger error: {e}")

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

            safe_path(VOICE_CLONE_REQUEST_PATH, VM_DATA_DIR)
            with open(VOICE_CLONE_REQUEST_PATH, encoding='utf-8') as f:
                request = json.load(f)

            # Clear request file immediately to avoid re-processing
            VOICE_CLONE_REQUEST_PATH.unlink()

            action = request.get('action')
            print(f"[MIC] Voice clone request: {action}")

            if action == 'clone':
                await self._handle_voice_clone(request)
            elif action == 'clear':
                await self._handle_voice_clone_clear()
            else:
                print(f"[WARN] Unknown voice clone action: {action}")

        except json.JSONDecodeError:
            pass  # File might be partially written
        except FileNotFoundError:
            pass  # Already processed
        except Exception as e:
            print(f"[ERR] Voice clone request error: {e}")
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
            print("[MIC] Auto-transcribing reference audio...")
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
                print(f"[STT] Transcription: \"{transcript}\"")

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
        print(f"[MIC] Setting up voice clone: {voice_name}")
        try:
            success = self.tts.set_voice_clone(audio_path, transcript)
            if success:
                print(f"[OK] Voice clone '{voice_name}' activated!")
                self._write_voice_clone_response(True, transcript=transcript)
            else:
                self._write_voice_clone_response(False, "Failed to create voice clone prompt")
        except Exception as e:
            self._write_voice_clone_response(False, f"Voice clone setup failed: {e}")

    async def _handle_voice_clone_clear(self):
        """Clear current voice clone."""
        if hasattr(self.tts, 'clear_voice_clone'):
            self.tts.clear_voice_clone()
            print("[OK] Voice clone cleared, using preset voice")
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

        safe_path(VOICE_CLONE_RESPONSE_PATH, VM_DATA_DIR)
        with open(VOICE_CLONE_RESPONSE_PATH, 'w', encoding='utf-8') as f:
            json.dump(response, f, indent=2)

    async def wait_for_claude_response(self, my_message_id: str, timeout: float = 60.0) -> str:
        """Wait for AI provider to respond to our message via inbox polling."""
        self.refresh_ai_provider()
        return await self.inbox.wait_for_response(my_message_id, timeout)

    async def speak(self, text: str, enter_conversation_mode: bool = True):
        """Convert text to speech and play it using TTSManager."""
        # Lazy load TTS on first use
        if self.tts and not self.tts.is_loaded:
            try:
                from electron_bridge import emit_event
                emit_event('tts_loading')
            except Exception:
                pass
            print("[TTS] Loading model (first use)...")
            try:
                self.tts.load()
            except Exception as e:
                print(f"[WARN] TTS failed to load: {e}")
                print("   Voice output will be unavailable. Run setup to fix.")
                self.tts = None
                return

        def on_speech_start():
            self.audio_state.is_listening = False

        def on_speech_end():
            print("[TTS] Speaking done")
            self.audio_state.is_listening = True
            self.wake_word.clear_buffer()

            # Enter conversation mode only for wake word or follow-up interactions
            should_enter_conversation = (
                enter_conversation_mode and
                self.audio_state.recording_source in ('wake_word', 'follow_up')
            )
            if should_enter_conversation:
                self.audio_state.in_conversation = True
                self.audio_state.conversation_end_time = time.time() + CONVERSATION_WINDOW
                print(f"[CHAT] Conversation mode active ({CONVERSATION_WINDOW}s window - speak without wake word)")

        await self.tts.speak(text, on_start=on_speech_start, on_end=on_speech_end)

    async def transcribe(self, audio_data: np.ndarray) -> str:
        """Transcribe audio using configured STT adapter."""
        if self.stt_adapter is None:
            print("[ERR] No STT adapter available")
            return ""

        # Lazy load adapter on first use
        if not self.stt_adapter.is_loaded:
            try:
                from electron_bridge import emit_event
                emit_event('stt_loading')
            except Exception:
                pass
            print("[STT] Loading model (first use)...")
            loaded = await self.stt_adapter.load()
            if not loaded:
                print("[ERR] Failed to load STT adapter")
                return ""

        # Transcribe using the adapter
        try:
            text = await self.stt_adapter.transcribe(audio_data, SAMPLE_RATE)
            return text
        except Exception as e:
            print(f"[ERR] STT transcription error: {e}")
            return ""

    def process_wake_word(self, audio_chunk: np.ndarray) -> bool:
        """Check for wake word in audio chunk. Returns True if detected."""
        detected, model_name, score = self.wake_word.process(audio_chunk)
        if detected:
            print(f"\n[MIC] Wake word detected! ({model_name}: {score:.2f})")
        return detected

    def audio_callback(self, indata, frames, time_info, status):
        """Callback for audio stream.

        Thread safety note: This runs in the audio I/O thread. Shared state
        mutations (is_recording, is_processing, ptt_active, etc.) are simple
        boolean/integer attribute assignments, which are atomic under CPython's
        GIL. No additional locking is needed for these. The audio buffer is
        protected by AudioState's internal lock.
        """
        if status:
            print(f"Audio status: {status}")

        # Debug: show audio level every 60 frames (~1 second)
        if not hasattr(self, '_audio_debug_counter'):
            self._audio_debug_counter = 0
        self._audio_debug_counter += 1

        # Only compute audio levels when needed (every 60th frame)
        if self._audio_debug_counter % 60 == 0:
            level = np.abs(indata).max()
            energy = np.abs(indata[:, 0]).mean()
            print(f"[MIC] Audio: level={level:.4f}, energy={energy:.4f}, listening={self.audio_state.is_listening}")

        audio = indata[:, 0].copy()  # Mono

        # Read trigger actions (set by main loop, avoids file I/O in audio callback)
        ptt_action = self._ptt_action
        if ptt_action:
            self._ptt_action = None
        if ptt_action == "start" and not self.audio_state.is_recording:
            # Interrupt TTS if speaking
            if self.tts.is_speaking:
                self.tts.stop_speaking()
                print("[TTS] TTS interrupted by PTT")
            self.audio_state.start_recording('ptt')
            self.audio_state._ptt_start_time = time.time()
            print('[REC] Recording (PTT)... (speak now)')
        elif ptt_action == "stop" and self.audio_state.is_recording:
            # PTT released - process immediately (don't wait for silence)
            print('[STOP] PTT released, processing...{"event": "recording_stop", "data": {}}')
            self.audio_state.is_recording = False
            self.audio_state.is_processing = True
            # Schedule processing (we're in audio callback, can't await here)
            # Use a flag to trigger processing in main loop
            self.audio_state.ptt_process_pending = True

        # Safety: force-stop PTT recording if it exceeds 120s (missed stop trigger)
        if (self.audio_state.is_recording
                and self.audio_state.recording_source == 'ptt'
                and hasattr(self.audio_state, '_ptt_start_time')):
            if time.time() - self.audio_state._ptt_start_time > 120:
                print('[WARN] PTT recording timeout (120s), force-stopping')
                self.audio_state.is_recording = False
                self.audio_state.ptt_active = False
                self.audio_state.is_processing = True
                self.audio_state.ptt_process_pending = True

        # Read dictation trigger (set by main loop, avoids file I/O in audio callback)
        dictation_action = self._dictation_action
        if dictation_action:
            self._dictation_action = None
        if dictation_action == "start" and not self.audio_state.is_recording:
            if self.tts.is_speaking:
                self.tts.stop_speaking()
            self.audio_state.start_recording('dictation')
            self.audio_state._dictation_start_time = time.time()
            print('Recording (dictation)...')
        elif dictation_action == "stop" and self.audio_state.is_recording and self.audio_state.recording_source == 'dictation':
            self.audio_state.is_recording = False
            self.audio_state.is_processing = True
            self.audio_state.dictation_process_pending = True
            print('Dictation recording stopped')

        # Safety: force-stop dictation recording after 120s
        if (self.audio_state.is_recording
                and self.audio_state.recording_source == 'dictation'
                and hasattr(self.audio_state, '_dictation_start_time')):
            if time.time() - self.audio_state._dictation_start_time > 120:
                print('Dictation recording timeout (120s), force-stopping')
                self.audio_state.is_recording = False
                self.audio_state.dictation_active = False
                self.audio_state.is_processing = True
                self.audio_state.dictation_process_pending = True

        if self.audio_state.is_listening and not self.audio_state.is_recording:
            # Push-to-talk mode: only record when PTT is pressed (handled above)
            if self._activation_mode == ActivationMode.PUSH_TO_TALK:
                # In PTT mode, don't auto-detect speech - wait for PTT trigger
                pass
            # Check if in conversation mode (no wake word needed, with timeout)
            elif self.audio_state.in_conversation:
                # Check if conversation window expired
                if time.time() > self.audio_state.conversation_end_time:
                    self.audio_state.in_conversation = False
                    if self._activation_mode == ActivationMode.WAKE_WORD:
                        wake_phrase = self._ai_provider.get('wakePhrase', 'Hey Claude')
                        print(f"\n[LISTEN] Conversation window closed. Say '{wake_phrase}' to continue.")
                    else:
                        print(f"\n{self.get_listening_status()}")
                else:
                    # In conversation mode - detect speech start without wake word
                    is_speech, prob = self.vad.process(audio, 'follow_up')
                    if is_speech:
                        self.audio_state.start_recording('follow_up')
                        self.audio_state.in_conversation = False  # Exit conversation mode once recording starts
                        print(f"[REC] Recording follow-up... VAD={prob:.3f} (speak now)")
            elif self._activation_mode == ActivationMode.WAKE_WORD and self.wake_word.is_loaded:
                # Wake word mode - check for wake word
                if self.process_wake_word(audio):
                    self.audio_state.start_recording('wake_word')
                    self.wake_word.reset()
                    print("[REC] Recording (wake word)... (speak now)")

        elif self.audio_state.is_recording and not self.audio_state.is_processing:
            # Record audio (thread-safe via AudioState)
            self.audio_state.append_audio(audio)

            # Neural VAD: check if there's speech activity
            is_speech, prob = self.vad.process(audio, 'recording')
            if is_speech:
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
            print(f"[SKIP] Recording too short ({duration_ms}ms), discarding")
            self.audio_state.is_processing = False
            return

        duration_ms_total = int(len(audio_data) / 16000 * 1000)
        peak = np.abs(audio_data).max()
        print(f"[MIC] Recording: {duration_ms_total}ms, peak={peak:.4f}")

        print("[WAIT] Transcribing...")

        text = await self.transcribe(audio_data)

        # Filter out garbage transcriptions (single chars, very short, or common artifacts)
        if text and len(text.strip()) < 3:
            print(f"[SKIP] Ignoring short transcription: '{text}'")
            return

        if text:
            print(f"[STT] You said: {text}")

            # Send to AI provider via inbox
            msg_id = self.send_to_inbox(text)

            # Release processing lock before waiting for response
            # so PTT/dictation can be used again while waiting.
            # Run the wait+speak in a background task so the main loop
            # stays free to process new PTT/dictation triggers.
            self.audio_state.is_processing = False

            async def _wait_and_speak(msg_id):
                try:
                    response = await self.wait_for_claude_response(msg_id, timeout=90.0)
                    if response:
                        provider_id = self._ai_provider.get('provider', '')
                        if provider_id in MCP_CLI_PROVIDERS:
                            # MCP providers: InboxWatcher handles chat UI, just log for debugging
                            print(f"[OK] {self._ai_provider['name']} responded ({len(response)} chars)")
                        else:
                            # Non-MCP providers: 💬 prefix triggers chat message via electron_bridge
                            print(f"[CHAT] {self._ai_provider['name']}: {response}")
                        clean_response = strip_provider_prefix(response)
                        # Guard against double-speak: keep flag set while TTS is active
                        # (awaiting_response already cleared by wait_for_response, but
                        # NotificationWatcher could poll before TTS sets is_speaking)
                        self.inbox.speaking_response = True
                        await self.speak(clean_response)
                    else:
                        print(f"[TIMEOUT] No response from {self._ai_provider['name']} (timeout - this is normal if thinking)")
                except Exception as e:
                    print(f"Error waiting for response: {e}")
                finally:
                    self.inbox.speaking_response = False

            asyncio.create_task(_wait_and_speak(msg_id))
        else:
            print("[ERR] No speech detected")

    async def process_dictation(self):
        """Process recorded audio for dictation (transcribe and inject text, no AI)."""
        audio_data = self.audio_state.get_and_clear_buffer()
        if audio_data is None:
            return

        # Minimum duration check (0.4s = 6400 samples at 16kHz)
        min_samples = int(0.4 * 16000)
        if len(audio_data) < min_samples:
            duration_ms = int(len(audio_data) / 16000 * 1000)
            print(f"Dictation too short ({duration_ms}ms), discarding")
            return

        text = await self.transcribe(audio_data)

        if text and len(text.strip()) >= 3:
            from text_injector import inject_text
            if inject_text(text):
                print(f"Dictation: {text}")
            else:
                print(f"Dictation inject failed: {text}")
        elif text:
            print(f"Dictation too short to inject: '{text}'")
        else:
            print("Dictation: no speech detected")

    async def run(self):
        """Main loop."""
        self.load_models()

        # Load voice config for device selection
        self._voice_config = {}
        try:
            from providers.config import ELECTRON_CONFIG_PATH
            from shared.paths import get_config_base
            safe_path(ELECTRON_CONFIG_PATH, get_config_base() / "voice-mirror-electron")
            if ELECTRON_CONFIG_PATH.exists():
                with open(ELECTRON_CONFIG_PATH, encoding='utf-8') as f:
                    self._voice_config = json.load(f).get("voice", {})
        except Exception:
            pass

        print("\n" + "=" * 50)
        print("Voice Mirror - Ready")
        # Show activation mode info
        activation_display = {
            ActivationMode.WAKE_WORD: "[MIC] Wake Word",
            ActivationMode.PUSH_TO_TALK: "[MIC] Push-to-Talk"
        }
        stt_name = self.stt_adapter.name if (self.stt_adapter and self.stt_adapter.is_loaded) else "lazy-load"
        tts_name = self.tts.name if (self.tts and self.tts.is_loaded) else "none"
        print(f"  Mode: {activation_display.get(self._activation_mode, self._activation_mode)}")
        print(f"  STT: {stt_name} | TTS: {tts_name}")
        print(f"  AI: {self._ai_provider['name']}")
        if NOTIFICATION_ENABLED:
            print("  Notifications: ON")
        print("=" * 50)

        # Select input device: config override > known mic brands > generic USB > default
        input_device = None
        all_devices = sd.query_devices()

        # Check config for explicit device override
        config_device = self._voice_config.get("inputDevice")
        if config_device is not None:
            if isinstance(config_device, int):
                input_device = config_device
            elif isinstance(config_device, str):
                for i, d in enumerate(all_devices):
                    if d['max_input_channels'] > 0 and config_device.lower() in d['name'].lower():
                        input_device = i
                        break

        # Two-pass auto-detection: known mic brands first, then generic USB
        if input_device is None:
            known_mics = ['seiren', 'yeti', 'snowball', 'at2020', 'elgato', 'hyperx',
                          'blue', 'rode', 'fifine', 'tonor', 'samson']
            for i, d in enumerate(all_devices):
                name = d['name'].lower()
                if d['max_input_channels'] > 0:
                    if any(mic in name for mic in known_mics):
                        input_device = i
                        break
        if input_device is None:
            for i, d in enumerate(all_devices):
                name = d['name'].lower()
                if d['max_input_channels'] > 0:
                    if 'usb' in name and 'audio' in name:
                        input_device = i
                        break

        if input_device is not None:
            print(f"   [OK] Input: {all_devices[input_device]['name']}")
        else:
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
            # Uses a SINGLE listener with multiple bindings so Windows only installs
            # one low-level mouse hook — required for reliable event suppression.
            try:
                from global_hotkey import GlobalHotkeyListener
                from providers.config import ELECTRON_CONFIG_PATH
                from shared.paths import get_config_base
                safe_path(ELECTRON_CONFIG_PATH, get_config_base() / "voice-mirror-electron")

                config = {}
                if ELECTRON_CONFIG_PATH.exists():
                    with open(ELECTRON_CONFIG_PATH, encoding='utf-8') as f:
                        config = json.load(f).get("behavior", {})

                self._hotkey_listener = GlobalHotkeyListener()

                # PTT binding (only in push-to-talk mode)
                if self._activation_mode == ActivationMode.PUSH_TO_TALK:
                    ptt_key = config.get("pttKey", "MouseButton4")
                    self._hotkey_listener.add_binding(ptt_key, "ptt_trigger.json")
                    print(f"[GlobalHotkey] PTT binding: {ptt_key}")

                # Dictation binding (always active, independent of activation mode)
                dictation_key = config.get("dictationKey", "MouseButton5")
                self._hotkey_listener.add_binding(dictation_key, "dictation_trigger.json")
                print(f"[GlobalHotkey] Dictation binding: {dictation_key}")

                self._hotkey_listener.start()
            except Exception as e:
                print(f"[GlobalHotkey] Failed to start: {e}")

            # Start notification watcher in background
            notification_task = None
            if NOTIFICATION_ENABLED:
                # Create notification watcher with callbacks
                def on_notification_speech_start():
                    self.audio_state.is_listening = False

                def on_notification_speech_end(enter_conversation_mode: bool):
                    print("[TTS] Speaking done")
                    self.audio_state.is_listening = True
                    self.wake_word.clear_buffer()
                    if enter_conversation_mode:
                        self.audio_state.enter_conversation_mode(CONVERSATION_WINDOW)
                        print(f"[CHAT] Conversation mode active ({CONVERSATION_WINDOW}s window)")

                notification_watcher = NotificationWatcher(
                    inbox=self.inbox,
                    tts=lambda: self.tts,
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

            # Preload STT model in background so first recording doesn't freeze
            # the system (ONNX model loading is CPU-intensive and blocks the cursor
            # for ~2 seconds when done on-demand during the first transcription).
            if self.stt_adapter and not self.stt_adapter.is_loaded:
                async def _preload_stt():
                    await asyncio.sleep(3)  # let TTS greeting finish first
                    if self.stt_adapter and not self.stt_adapter.is_loaded:
                        print("[STT] Preloading model...")
                        try:
                            loaded = await self.stt_adapter.load()
                            if loaded:
                                print(f"[OK] STT model preloaded")
                        except Exception as e:
                            print(f"[WARN] STT preload failed: {e}")
                asyncio.create_task(_preload_stt())

            try:
                while True:
                    await asyncio.sleep(0.1)

                    # Poll trigger files in main loop (not in audio callback)
                    ptt = self.check_ptt_trigger()
                    if ptt:
                        self._ptt_action = ptt
                    dictation = self.check_dictation_trigger()
                    if dictation:
                        self._dictation_action = dictation

                    # Check for voice clone requests from MCP server
                    await self.check_voice_clone_request()

                    # Check for PTT release (process immediately)
                    if self.audio_state.ptt_process_pending:
                        self.audio_state.ptt_process_pending = False
                        await self.process_recording()
                        self.vad.reset()
                        self.audio_state.is_processing = False
                        continue

                    # Check for dictation release (transcribe + inject, no AI)
                    if self.audio_state.dictation_process_pending:
                        self.audio_state.dictation_process_pending = False
                        await self.process_dictation()
                        self.vad.reset()
                        self.audio_state.is_processing = False
                        continue

                    # Check for silence timeout during recording
                    # Skip for dictation — user controls stop via button release,
                    # pauses in speech are normal. The 120s safety timeout still applies.
                    if (self.audio_state.is_recording
                            and not self.audio_state.is_processing
                            and self.audio_state.recording_source not in ('dictation', 'ptt')):
                        elapsed = time.time() - self.audio_state.last_speech_time
                        if elapsed >= SILENCE_TIMEOUT:
                            print("[STOP] Silence detected, processing...")
                            self.audio_state.is_recording = False
                            self.audio_state.is_processing = True
                            # Route dictation recordings to process_dictation (not AI)
                            if self.audio_state.recording_source == 'dictation':
                                await self.process_dictation()
                            else:
                                await self.process_recording()
                            self.vad.reset()
                            self.audio_state.is_processing = False
                            # Only show status for conversational modes where context changes
                            if self.audio_state.in_conversation:
                                remaining = max(0, self.audio_state.conversation_end_time - time.time())
                                print(f"\n[CHAT] Conversation active ({remaining:.1f}s) - speak without wake word...")

            except KeyboardInterrupt:
                print("\n\nGoodbye!")
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
    print("\nShutting down Voice Mirror...")
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
        print("\nShutting down Voice Mirror...")
        cleanup_on_exit()
