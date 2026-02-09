"""Voice Activity Detection (VAD) using Silero ONNX model with energy fallback."""

import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# Silero VAD expects 512-sample windows at 16kHz
_WINDOW_SIZE = 512
_SAMPLE_RATE = 16000

# Mode-specific speech probability thresholds
_THRESHOLDS = {
    "call": 0.3,
    "recording": 0.5,
    "follow_up": 0.5,
}

# Fallback energy thresholds (used when model is not loaded)
_ENERGY_THRESHOLDS = {
    "call": 0.008,
    "recording": 0.01,
    "follow_up": 0.03,
}


class SileroVAD:
    """Silero neural VAD with ONNX Runtime inference and energy-based fallback."""

    def __init__(self):
        self._session = None
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._buffer = np.array([], dtype=np.float32)

    @property
    def is_loaded(self) -> bool:
        return self._session is not None

    def load(self, model_dir: Path | None = None) -> bool:
        """Load the Silero ONNX model. Returns True on success."""
        if model_dir is None:
            model_dir = Path(__file__).resolve().parent.parent / "models"
        model_path = model_dir / "silero_vad.onnx"

        if not model_path.exists():
            logger.warning("Silero VAD model not found at %s — using energy fallback", model_path)
            return False

        try:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.inter_op_num_threads = 1
            opts.intra_op_num_threads = 1
            self._session = ort.InferenceSession(str(model_path), sess_options=opts)
            self.reset()
            logger.info("Silero VAD loaded from %s", model_path)
            return True
        except Exception as e:
            logger.warning("Failed to load Silero VAD: %s — using energy fallback", e)
            self._session = None
            return False

    def reset(self):
        """Clear LSTM hidden state and sample buffer."""
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._buffer = np.array([], dtype=np.float32)

    def _infer_window(self, window: np.ndarray) -> float:
        """Run a single 512-sample window through the model. Returns speech probability."""
        inp = window.reshape(1, _WINDOW_SIZE).astype(np.float32)
        sr = np.array(_SAMPLE_RATE, dtype=np.int64)

        out, self._state = self._session.run(
            None,
            {"input": inp, "state": self._state, "sr": sr},
        )
        return float(out.squeeze())

    def process(self, audio_chunk: np.ndarray, mode: str = "recording") -> tuple[bool, float]:
        """
        Process an audio chunk and return (is_speech, probability).

        The chunk is appended to an internal buffer and consumed in 512-sample
        windows.  The returned probability is the maximum across all windows
        processed in this call (or 0.0 if no full window was available).

        Args:
            audio_chunk: float32 mono samples at 16 kHz (any length).
            mode: one of 'call', 'recording', 'follow_up'.

        Returns:
            (is_speech, probability) where probability is 0-1.
        """
        if not self.is_loaded:
            return self._energy_fallback(audio_chunk, mode)

        # Append to buffer
        self._buffer = np.concatenate([self._buffer, audio_chunk.astype(np.float32)])

        max_prob = 0.0
        while len(self._buffer) >= _WINDOW_SIZE:
            window = self._buffer[:_WINDOW_SIZE]
            self._buffer = self._buffer[_WINDOW_SIZE:]
            prob = self._infer_window(window)
            if prob > max_prob:
                max_prob = prob

        threshold = _THRESHOLDS.get(mode, 0.5)
        return (max_prob >= threshold, max_prob)

    # ------------------------------------------------------------------
    # Energy-based fallback (used when ONNX model is not available)
    # ------------------------------------------------------------------

    @staticmethod
    def _energy_fallback(audio_chunk: np.ndarray, mode: str) -> tuple[bool, float]:
        """Simple energy-based VAD as fallback."""
        energy = float(np.abs(audio_chunk).mean())
        threshold = _ENERGY_THRESHOLDS.get(mode, 0.01)
        return (energy > threshold, energy)
