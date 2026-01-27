"""Wake word detection using OpenWakeWord."""

from pathlib import Path

import numpy as np


class WakeWordProcessor:
    """Handles wake word detection using OpenWakeWord models."""

    def __init__(self, model_path: str, threshold: float = 0.98, chunk_samples: int = 1280):
        """
        Initialize wake word processor.

        Args:
            model_path: Path to the .onnx wake word model (relative to script dir or absolute)
            threshold: Detection threshold (0.0-1.0, default 0.98)
            chunk_samples: Audio chunk size for processing (default 1280 = 80ms at 16kHz)
        """
        self.model_path = model_path
        self.threshold = threshold
        self.chunk_samples = chunk_samples
        self.model = None
        self.buffer = []

    def load(self, script_dir: Path | None = None) -> bool:
        """
        Load the OpenWakeWord model.

        Args:
            script_dir: Base directory for relative model paths

        Returns:
            True if model loaded successfully
        """
        try:
            from openwakeword.model import Model as OWWModel

            if script_dir:
                full_path = script_dir / self.model_path
            else:
                full_path = Path(self.model_path)

            self.model = OWWModel(
                wakeword_model_paths=[str(full_path)],
            )
            print(f"✅ Wake word model loaded: {self.model_path}")
            return True
        except Exception as e:
            print(f"⚠️ Failed to load wake word model: {e}")
            self.model = None
            return False

    def process(self, audio_chunk: np.ndarray) -> tuple[bool, str | None, float]:
        """
        Check for wake word in audio chunk.

        Args:
            audio_chunk: Audio samples as numpy array (float, -1.0 to 1.0)

        Returns:
            Tuple of (detected, model_name, score)
            - detected: True if wake word detected
            - model_name: Name of the model that detected (or None)
            - score: Detection confidence score (0.0-1.0)
        """
        if self.model is None:
            return False, None, 0.0

        # Accumulate audio in buffer
        self.buffer.append(audio_chunk)
        total_samples = sum(len(chunk) for chunk in self.buffer)

        # Process when we have enough samples
        while total_samples >= self.chunk_samples:
            combined = np.concatenate(self.buffer)
            chunk = combined[:self.chunk_samples]
            remainder = combined[self.chunk_samples:]
            self.buffer = [remainder] if len(remainder) > 0 else []
            total_samples = len(remainder)

            # Convert to int16 for OpenWakeWord
            chunk_int16 = (chunk * 32767).astype(np.int16)
            predictions = self.model.predict(chunk_int16)

            if predictions:
                for model_name, score in predictions.items():
                    if score >= self.threshold:
                        return True, model_name, score

        return False, None, 0.0

    def reset(self):
        """Reset the model state (call after detection to clear internal state)."""
        if self.model is not None:
            self.model.reset()

    def clear_buffer(self):
        """Clear the audio buffer."""
        self.buffer = []

    @property
    def is_loaded(self) -> bool:
        """Check if the model is loaded."""
        return self.model is not None
