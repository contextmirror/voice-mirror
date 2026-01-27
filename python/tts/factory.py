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

    # Future adapters can be added here:
    # - piper: Fast, lightweight, offline
    # - coqui: Voice cloning, expressive
    # - elevenlabs: Cloud, highest quality
    # - openai: Cloud, good quality
    # - edge: Free Microsoft voices


# Register on module load
_register_adapters()


def create_tts_adapter(
    adapter_name: str,
    voice: str | None = None,
    model_size: str | None = None,
) -> TTSAdapter:
    """
    Create a TTS adapter by name.

    Args:
        adapter_name: Name of the adapter ("kokoro", "qwen", etc.)
        voice: Optional voice ID to use (adapter-dependent)
        model_size: Optional model size for adapters that support it (e.g., "0.6B", "1.7B" for Qwen)

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

    # Pass model_size to adapters that support it (e.g., Qwen)
    if adapter_name == "qwen" and model_size:
        return adapter_class(voice=voice, model_size=model_size)

    return adapter_class(voice=voice)


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
