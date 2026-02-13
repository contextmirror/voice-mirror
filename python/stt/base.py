"""Base STT adapter interface."""

from abc import ABC, abstractmethod

import numpy as np


class STTAdapter(ABC):
    """
    Base class for Speech-to-Text adapters.

    All STT implementations must inherit from this class and implement
    the transcribe method.
    """

    adapter_type: str = ""
    adapter_category: str = "local"  # "local" or "cloud"
    pip_package: str = ""
    requires_api_key: bool = False
    requires_endpoint: bool = False

    def __init__(self, model_name: str | None = None):
        """
        Initialize the STT adapter.

        Args:
            model_name: Optional specific model name/path to use
        """
        self.model_name = model_name
        self.model = None

    @abstractmethod
    async def load(self) -> bool:
        """
        Load the STT model.

        Returns:
            True if loaded successfully, False otherwise
        """
        pass

    @abstractmethod
    async def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        """
        Transcribe audio to text.

        Args:
            audio_data: Audio samples as numpy array (float32, normalized -1 to 1)
            sample_rate: Sample rate in Hz (default 16000)

        Returns:
            Transcribed text, or empty string if transcription failed
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the display name of this adapter."""
        pass

    @property
    def is_loaded(self) -> bool:
        """Check if the model is loaded."""
        return self.model is not None

    def unload(self):
        """Unload the model to free memory."""
        self.model = None
