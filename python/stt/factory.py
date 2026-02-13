"""Factory for creating STT adapters."""


from .base import STTAdapter

# Registry of available adapters (populated by imports below)
ADAPTERS: dict[str, type] = {}


def _register_adapters():
    """Register available STT adapters."""
    global ADAPTERS

    # Parakeet - fast local model (default)
    try:
        from .parakeet import ParakeetAdapter
        ADAPTERS["parakeet"] = ParakeetAdapter
    except ImportError:
        pass

    # OpenAI Whisper (local)
    try:
        from .whisper import WhisperAdapter
        ADAPTERS["whisper"] = WhisperAdapter
    except ImportError:
        pass

    # Faster-Whisper (local, optimized)
    try:
        from .whisper import FasterWhisperAdapter
        ADAPTERS["faster-whisper"] = FasterWhisperAdapter
    except ImportError:
        pass

    # OpenAI Whisper API (cloud)
    try:
        from .openai_stt import OpenAISTTAdapter
        ADAPTERS["openai-whisper-api"] = OpenAISTTAdapter
    except ImportError:
        pass

    # Custom API STT (cloud)
    try:
        from .custom_api import CustomAPISTTAdapter
        ADAPTERS["custom-api-stt"] = CustomAPISTTAdapter
    except ImportError:
        pass


# Register on module load
_register_adapters()


def create_stt_adapter(
    adapter_name: str,
    model_name: str | None = None,
    **kwargs,
) -> STTAdapter:
    """
    Create an STT adapter by name.

    Args:
        adapter_name: Name of the adapter ("parakeet", "whisper", "faster-whisper", etc.)
        model_name: Optional specific model to use (adapter-dependent)
        **kwargs: Additional adapter-specific options (e.g., api_key, endpoint)

    Returns:
        STTAdapter instance

    Raises:
        ValueError: If adapter_name is not recognized
    """
    adapter_name = adapter_name.lower()

    if adapter_name not in ADAPTERS:
        available = ", ".join(ADAPTERS.keys()) if ADAPTERS else "none"
        raise ValueError(
            f"Unknown STT adapter: {adapter_name}. "
            f"Available: {available}"
        )

    adapter_class = ADAPTERS[adapter_name]
    return adapter_class(model_name=model_name, **kwargs)


def list_available_adapters() -> list[str]:
    """
    List all available STT adapter names.

    Returns:
        List of adapter names
    """
    return list(ADAPTERS.keys())
