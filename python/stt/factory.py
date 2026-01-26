"""Factory for creating STT adapters."""

from typing import Optional, List, Dict
from .base import STTAdapter
from .parakeet import ParakeetAdapter
from .whisper import WhisperAdapter, FasterWhisperAdapter


# Registry of available adapters
ADAPTERS: Dict[str, type] = {
    "parakeet": ParakeetAdapter,
    "whisper": WhisperAdapter,
    "faster-whisper": FasterWhisperAdapter,
}


def create_stt_adapter(
    adapter_name: str,
    model_name: Optional[str] = None
) -> STTAdapter:
    """
    Create an STT adapter by name.

    Args:
        adapter_name: Name of the adapter ("parakeet", "whisper", "faster-whisper")
        model_name: Optional specific model to use (adapter-dependent)

    Returns:
        STTAdapter instance

    Raises:
        ValueError: If adapter_name is not recognized
    """
    adapter_name = adapter_name.lower()

    if adapter_name not in ADAPTERS:
        available = ", ".join(ADAPTERS.keys())
        raise ValueError(
            f"Unknown STT adapter: {adapter_name}. "
            f"Available: {available}"
        )

    adapter_class = ADAPTERS[adapter_name]
    return adapter_class(model_name=model_name)


def list_available_adapters() -> List[str]:
    """
    List all available STT adapter names.

    Returns:
        List of adapter names
    """
    return list(ADAPTERS.keys())
