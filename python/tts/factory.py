"""Factory for creating TTS adapters."""


from .base import TTSAdapter

# Registry of available adapters (populated by imports below)
ADAPTERS: dict[str, type] = {}


def _register_adapters():
    """Register available TTS adapters."""
    global ADAPTERS

    # Kokoro - always available as default
    try:
        from .kokoro import KokoroAdapter
        ADAPTERS["kokoro"] = KokoroAdapter
    except ImportError:
        pass

    # Qwen3-TTS - optional
    try:
        from .qwen import QwenTTSAdapter
        ADAPTERS["qwen"] = QwenTTSAdapter
    except ImportError:
        pass

    # Piper - fast, lightweight, offline
    try:
        from .piper import PiperAdapter
        ADAPTERS["piper"] = PiperAdapter
    except ImportError:
        pass

    # Edge TTS - free Microsoft voices (cloud)
    try:
        from .edge import EdgeTTSAdapter
        ADAPTERS["edge"] = EdgeTTSAdapter
    except ImportError:
        pass

    # OpenAI TTS - paid cloud
    try:
        from .openai_tts import OpenAITTSAdapter
        ADAPTERS["openai-tts"] = OpenAITTSAdapter
    except ImportError:
        pass

    # ElevenLabs TTS - paid cloud
    try:
        from .elevenlabs import ElevenLabsAdapter
        ADAPTERS["elevenlabs"] = ElevenLabsAdapter
    except ImportError:
        pass

    # Custom API - OpenAI-compatible endpoint
    try:
        from .custom_api import CustomAPITTSAdapter
        ADAPTERS["custom-api"] = CustomAPITTSAdapter
    except ImportError:
        pass


# Register on module load
_register_adapters()


def create_tts_adapter(
    adapter_name: str,
    voice: str | None = None,
    **kwargs,
) -> TTSAdapter:
    """
    Create a TTS adapter by name.

    Args:
        adapter_name: Name of the adapter ("kokoro", "qwen", "piper", etc.)
        voice: Optional voice ID to use (adapter-dependent)
        **kwargs: Additional adapter-specific options (e.g., model_size, api_key, endpoint)

    Returns:
        TTSAdapter instance

    Raises:
        ValueError: If adapter_name is not recognized
    """
    adapter_name = adapter_name.lower()

    if adapter_name not in ADAPTERS:
        available = ", ".join(ADAPTERS.keys()) if ADAPTERS else "none"
        raise ValueError(
            f"Unknown TTS adapter: {adapter_name}. "
            f"Available: {available}"
        )

    adapter_class = ADAPTERS[adapter_name]
    return adapter_class(voice=voice, **kwargs)


def list_available_adapters() -> list[str]:
    """
    List all available TTS adapter names.

    Returns:
        List of adapter names
    """
    return list(ADAPTERS.keys())


def get_default_adapter() -> str:
    """
    Get the default TTS adapter name.

    Returns:
        Default adapter name, or raises if none available
    """
    if "kokoro" in ADAPTERS:
        return "kokoro"
    if ADAPTERS:
        return next(iter(ADAPTERS.keys()))
    raise RuntimeError("No TTS adapters available")
