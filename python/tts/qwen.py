"""Qwen3-TTS adapter for voice synthesis with cloning support."""

import asyncio
import subprocess
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from .base import TTSAdapter


# Available preset speakers for CustomVoice model
QWEN_SPEAKERS = [
    "Vivian",
    "Serena",
    "Uncle_Fu",
    "Dylan",
    "Eric",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
]

# Supported languages
QWEN_LANGUAGES = [
    "Auto",  # Auto-detect
    "English",
    "Chinese",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]


class QwenTTSAdapter(TTSAdapter):
    """
    TTS adapter using Qwen3-TTS for high-quality synthesis.

    Supports:
    - Preset speaker voices (CustomVoice model)
    - Voice cloning from reference audio (Base model)
    - Natural language voice design (VoiceDesign model)
    """

    def __init__(
        self,
        voice: Optional[str] = None,
        model_size: str = "1.7B",
        language: str = "Auto",
        ref_audio: Optional[str] = None,
        ref_text: Optional[str] = None,
    ):
        """
        Initialize Qwen3-TTS adapter.

        Args:
            voice: Speaker name (e.g., "Ryan", "Vivian") or "clone" for voice cloning
            model_size: Model size - "0.6B" or "1.7B" (default: "1.7B")
            language: Language for synthesis (default: "Auto")
            ref_audio: Path to reference audio for voice cloning
            ref_text: Transcript of reference audio for voice cloning
        """
        super().__init__(voice=voice or "Ryan")
        self.model_size = model_size
        self.language = language
        self.ref_audio = ref_audio
        self.ref_text = ref_text
        self._soundfile = None
        self._torch = None
        self._voice_clone_prompt = None  # Cached for efficiency

    def _get_model_name(self) -> str:
        """Get the HuggingFace model name based on mode."""
        if self.ref_audio:
            # Voice cloning mode
            return f"Qwen/Qwen3-TTS-12Hz-{self.model_size}-Base"
        else:
            # Preset speaker mode
            return f"Qwen/Qwen3-TTS-12Hz-{self.model_size}-CustomVoice"

    def load(self) -> bool:
        """Load the Qwen3-TTS model."""
        try:
            import torch
            from qwen_tts import Qwen3TTSModel
            import soundfile as sf

            self._torch = torch
            self._soundfile = sf

            model_name = self._get_model_name()
            print(f"Loading Qwen3-TTS model: {model_name}")
            print("  (First run downloads model, please wait...)")

            # Determine device and dtype
            if torch.cuda.is_available():
                device = "cuda:0"
                dtype = torch.bfloat16
                attn_impl = "flash_attention_2"
                print(f"  Using CUDA with FlashAttention2")
            else:
                device = "cpu"
                dtype = torch.float32
                attn_impl = "eager"
                print(f"  Using CPU (slower, consider using CUDA)")

            # Try to load with flash attention, fall back if not available
            try:
                self.model = Qwen3TTSModel.from_pretrained(
                    model_name,
                    device_map=device,
                    dtype=dtype,
                    attn_implementation=attn_impl,
                )
            except Exception as e:
                if "flash" in str(e).lower():
                    print(f"  FlashAttention not available, using eager attention")
                    self.model = Qwen3TTSModel.from_pretrained(
                        model_name,
                        device_map=device,
                        dtype=dtype,
                        attn_implementation="eager",
                    )
                else:
                    raise

            # Pre-compute voice clone prompt if using cloning
            if self.ref_audio and self.ref_text:
                print(f"  Creating voice clone prompt from: {self.ref_audio}")
                self._voice_clone_prompt = self.model.create_voice_clone_prompt(
                    ref_audio=self.ref_audio,
                    ref_text=self.ref_text,
                    x_vector_only_mode=False,
                )

            print(f"✅ Qwen3-TTS loaded (voice: {self.voice}, lang: {self.language})")
            return True

        except ImportError:
            print("❌ Qwen3-TTS not available - install with: pip install qwen-tts")
            self.model = None
            return False
        except Exception as e:
            print(f"⚠️ Failed to load Qwen3-TTS: {e}")
            self.model = None
            return False

    async def speak(
        self,
        text: str,
        on_start: Optional[Callable[[], None]] = None,
        on_end: Optional[Callable[[], None]] = None,
        instruct: Optional[str] = None,
    ) -> None:
        """
        Synthesize text and play audio using Qwen3-TTS.

        Args:
            text: Text to speak
            on_start: Callback when speech starts
            on_end: Callback when speech ends
            instruct: Optional style/emotion instruction (e.g., "speak warmly")
        """
        text = self.strip_markdown(text)
        print(f"🔊 Speaking: {text[:50]}...")

        self._is_speaking = True

        if on_start:
            on_start()

        try:
            if self.model is None:
                print("❌ Qwen3-TTS not loaded")
                return

            if self._soundfile is None:
                import soundfile as sf
                self._soundfile = sf

            # Run synthesis in thread pool
            loop = asyncio.get_event_loop()
            audio_data, sample_rate = await loop.run_in_executor(
                None,
                lambda: self._synthesize(text, instruct)
            )

            if audio_data is None:
                print("❌ Qwen3-TTS synthesis failed")
                return

            # Save to temp file
            audio_file = Path("/tmp/voice_mirror_tts.wav")
            self._soundfile.write(str(audio_file), audio_data, sample_rate)

            # Play using ffplay (interruptible) - run in executor to not block event loop
            if self._interrupted:
                return
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._play_audio, str(audio_file))
        except Exception as e:
            print(f"❌ Qwen3-TTS error: {e}")
        finally:
            self._playback_process = None
            self._is_speaking = False
            was_interrupted = self._interrupted
            self._interrupted = False
            if not was_interrupted:
                await asyncio.sleep(0.3)
            if on_end:
                on_end()

    def _synthesize(self, text: str, instruct: Optional[str] = None) -> Tuple[any, int]:
        """
        Synthesize speech (runs in thread pool).

        Returns:
            Tuple of (audio_data, sample_rate)
        """
        try:
            if self._voice_clone_prompt:
                # Voice cloning mode
                wavs, sr = self.model.generate_voice_clone(
                    text=text,
                    language=self.language,
                    voice_clone_prompt=self._voice_clone_prompt,
                )
            else:
                # Preset speaker mode
                wavs, sr = self.model.generate_custom_voice(
                    text=text,
                    language=self.language,
                    speaker=self.voice,
                    instruct=instruct or "",
                )
            return wavs[0], sr
        except Exception as e:
            print(f"❌ Synthesis error: {e}")
            return None, 0

    def set_voice_clone(self, ref_audio: str, ref_text: str) -> bool:
        """
        Set up voice cloning with a new reference.

        Args:
            ref_audio: Path to reference audio file
            ref_text: Transcript of reference audio

        Returns:
            True if successful
        """
        if self.model is None:
            print("❌ Model not loaded")
            return False

        try:
            # Check if we need to switch to Base model for voice cloning
            # CustomVoice model doesn't support voice cloning
            current_model_name = self._get_model_name()
            if "CustomVoice" in current_model_name:
                print("🔄 Switching from CustomVoice to Base model for voice cloning...")
                self.ref_audio = ref_audio  # Set this so _get_model_name returns Base
                self.ref_text = ref_text

                # Reload with Base model
                if not self._reload_for_cloning():
                    return False
            else:
                self.ref_audio = ref_audio
                self.ref_text = ref_text

            self._voice_clone_prompt = self.model.create_voice_clone_prompt(
                ref_audio=ref_audio,
                ref_text=ref_text,
                x_vector_only_mode=False,
            )
            print(f"✅ Voice clone prompt created from: {ref_audio}")
            return True
        except Exception as e:
            print(f"❌ Failed to create voice clone: {e}")
            return False

    def _reload_for_cloning(self) -> bool:
        """Reload model as Base variant for voice cloning support."""
        try:
            import torch
            from qwen_tts import Qwen3TTSModel

            model_name = self._get_model_name()  # Now returns Base model
            print(f"📥 Loading Base model: {model_name}")

            # Determine device and dtype
            if torch.cuda.is_available():
                device = "cuda:0"
                dtype = torch.bfloat16
                attn_impl = "flash_attention_2"
            else:
                device = "cpu"
                dtype = torch.float32
                attn_impl = "eager"

            # Unload old model to free VRAM
            del self.model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Load Base model
            try:
                self.model = Qwen3TTSModel.from_pretrained(
                    model_name,
                    device_map=device,
                    dtype=dtype,
                    attn_implementation=attn_impl,
                )
            except Exception as e:
                if "flash" in str(e).lower():
                    print(f"  FlashAttention not available, using eager attention")
                    self.model = Qwen3TTSModel.from_pretrained(
                        model_name,
                        device_map=device,
                        dtype=dtype,
                        attn_implementation="eager",
                    )
                else:
                    raise

            print(f"✅ Base model loaded for voice cloning")
            return True

        except Exception as e:
            print(f"❌ Failed to reload model for cloning: {e}")
            return False

    def clear_voice_clone(self):
        """Clear voice cloning and return to preset speaker mode."""
        was_cloning = self._voice_clone_prompt is not None
        self._voice_clone_prompt = None
        self.ref_audio = None
        self.ref_text = None

        # If we were using voice cloning, reload CustomVoice model
        if was_cloning and self.model is not None:
            print("🔄 Switching back to CustomVoice model...")
            self._reload_for_preset()

    def _reload_for_preset(self):
        """Reload model as CustomVoice variant for preset speakers."""
        try:
            import torch
            from qwen_tts import Qwen3TTSModel

            model_name = self._get_model_name()  # Now returns CustomVoice model
            print(f"📥 Loading CustomVoice model: {model_name}")

            # Determine device and dtype
            if torch.cuda.is_available():
                device = "cuda:0"
                dtype = torch.bfloat16
                attn_impl = "flash_attention_2"
            else:
                device = "cpu"
                dtype = torch.float32
                attn_impl = "eager"

            # Unload old model to free VRAM
            del self.model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Load CustomVoice model
            try:
                self.model = Qwen3TTSModel.from_pretrained(
                    model_name,
                    device_map=device,
                    dtype=dtype,
                    attn_implementation=attn_impl,
                )
            except Exception as e:
                if "flash" in str(e).lower():
                    self.model = Qwen3TTSModel.from_pretrained(
                        model_name,
                        device_map=device,
                        dtype=dtype,
                        attn_implementation="eager",
                    )
                else:
                    raise

            print(f"✅ CustomVoice model loaded")

        except Exception as e:
            print(f"❌ Failed to reload CustomVoice model: {e}")

    @property
    def name(self) -> str:
        """Return display name."""
        mode = "clone" if self._voice_clone_prompt else self.voice
        return f"Qwen3-TTS {self.model_size} ({mode})"

    @property
    def available_voices(self) -> List[str]:
        """Return available speaker names."""
        return QWEN_SPEAKERS.copy()

    @property
    def available_languages(self) -> List[str]:
        """Return supported languages."""
        return QWEN_LANGUAGES.copy()
