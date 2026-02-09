"""Tests for SileroVAD."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# Ensure the python package root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from audio.vad import SileroVAD, _THRESHOLDS, _ENERGY_THRESHOLDS, _WINDOW_SIZE


# ---------------------------------------------------------------------------
# Basic lifecycle
# ---------------------------------------------------------------------------

class TestInit:
    def test_not_loaded_initially(self):
        vad = SileroVAD()
        assert not vad.is_loaded

    def test_reset_clears_state(self):
        vad = SileroVAD()
        # Feed some data into the buffer
        vad._buffer = np.ones(100, dtype=np.float32)
        vad._state = np.ones((2, 1, 128), dtype=np.float32)
        vad.reset()
        assert len(vad._buffer) == 0
        assert np.all(vad._state == 0)


# ---------------------------------------------------------------------------
# Energy-based fallback
# ---------------------------------------------------------------------------

class TestEnergyFallback:
    def test_fallback_when_not_loaded(self):
        vad = SileroVAD()
        # Loud audio should trigger in call mode
        loud = np.full(1280, 0.5, dtype=np.float32)
        is_speech, energy = vad.process(loud, "call")
        assert is_speech is True
        assert energy > _ENERGY_THRESHOLDS["call"]

    def test_fallback_silence(self):
        vad = SileroVAD()
        silence = np.zeros(1280, dtype=np.float32)
        is_speech, energy = vad.process(silence, "call")
        assert is_speech is False
        assert energy == 0.0

    def test_fallback_mode_thresholds(self):
        vad = SileroVAD()
        # Energy just above call threshold but below follow_up
        level = (_ENERGY_THRESHOLDS["call"] + _ENERGY_THRESHOLDS["follow_up"]) / 2
        audio = np.full(1280, level, dtype=np.float32)

        is_call, _ = vad.process(audio, "call")
        assert is_call is True

        is_followup, _ = vad.process(audio, "follow_up")
        assert is_followup is False


# ---------------------------------------------------------------------------
# Reframing (buffer management)
# ---------------------------------------------------------------------------

class TestReframing:
    def _make_loaded_vad(self):
        """Create a VAD with a mock ONNX session."""
        vad = SileroVAD()
        mock_session = MagicMock()
        # Return (output, stateN)
        mock_session.run.return_value = (
            np.array([[0.8]], dtype=np.float32),
            np.zeros((2, 1, 128), dtype=np.float32),
        )
        vad._session = mock_session
        return vad

    def test_1280_samples_produces_2_windows_with_remainder(self):
        """1280 / 512 = 2 windows + 256 remainder."""
        vad = self._make_loaded_vad()
        audio = np.random.randn(1280).astype(np.float32)
        is_speech, prob = vad.process(audio, "recording")

        assert vad._session.run.call_count == 2
        assert len(vad._buffer) == 256  # 1280 - 2*512
        assert is_speech is True
        assert prob == pytest.approx(0.8)

    def test_512_exact_no_remainder(self):
        vad = self._make_loaded_vad()
        audio = np.random.randn(512).astype(np.float32)
        vad.process(audio, "recording")

        assert vad._session.run.call_count == 1
        assert len(vad._buffer) == 0

    def test_short_chunk_buffered(self):
        """Chunks shorter than 512 are buffered, no inference runs."""
        vad = self._make_loaded_vad()
        audio = np.random.randn(256).astype(np.float32)
        is_speech, prob = vad.process(audio, "recording")

        assert vad._session.run.call_count == 0
        assert len(vad._buffer) == 256
        assert prob == 0.0
        assert is_speech is False

    def test_remainder_consumed_on_next_call(self):
        """Leftover buffer from one call is consumed when more data arrives."""
        vad = self._make_loaded_vad()

        # First call: 300 samples -> buffered, no inference
        vad.process(np.random.randn(300).astype(np.float32), "recording")
        assert vad._session.run.call_count == 0
        assert len(vad._buffer) == 300

        # Second call: 300 samples -> total 600, one 512-window, 88 remainder
        vad.process(np.random.randn(300).astype(np.float32), "recording")
        assert vad._session.run.call_count == 1
        assert len(vad._buffer) == 88


# ---------------------------------------------------------------------------
# Mode thresholds (with mock model)
# ---------------------------------------------------------------------------

class TestModeThresholds:
    def _make_vad_with_prob(self, prob: float):
        vad = SileroVAD()
        mock_session = MagicMock()
        mock_session.run.return_value = (
            np.array([[prob]], dtype=np.float32),
            np.zeros((2, 1, 128), dtype=np.float32),
        )
        vad._session = mock_session
        return vad

    def test_call_mode_low_threshold(self):
        """Call mode threshold is 0.3 — prob=0.35 should trigger."""
        vad = self._make_vad_with_prob(0.35)
        audio = np.random.randn(512).astype(np.float32)
        is_speech, _ = vad.process(audio, "call")
        assert is_speech is True

    def test_recording_mode_high_threshold(self):
        """Recording mode threshold is 0.5 — prob=0.35 should NOT trigger."""
        vad = self._make_vad_with_prob(0.35)
        audio = np.random.randn(512).astype(np.float32)
        is_speech, _ = vad.process(audio, "recording")
        assert is_speech is False

    def test_follow_up_mode(self):
        """Follow-up threshold is 0.5."""
        vad = self._make_vad_with_prob(0.55)
        audio = np.random.randn(512).astype(np.float32)
        is_speech, _ = vad.process(audio, "follow_up")
        assert is_speech is True

    def test_unknown_mode_defaults_to_0_5(self):
        vad = self._make_vad_with_prob(0.45)
        audio = np.random.randn(512).astype(np.float32)
        is_speech, _ = vad.process(audio, "unknown_mode")
        assert is_speech is False


# ---------------------------------------------------------------------------
# Integration test (requires actual model file)
# ---------------------------------------------------------------------------

_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "silero_vad.onnx"

try:
    import onnxruntime  # noqa: F401
    _HAS_ORT = True
except ImportError:
    _HAS_ORT = False


@pytest.mark.skipif(
    not _MODEL_PATH.exists() or not _HAS_ORT,
    reason="silero_vad.onnx not found or onnxruntime not installed",
)
class TestIntegration:
    def test_model_loads(self):
        vad = SileroVAD()
        assert vad.load(_MODEL_PATH.parent)
        assert vad.is_loaded

    def test_silence_low_probability(self):
        vad = SileroVAD()
        vad.load(_MODEL_PATH.parent)
        silence = np.zeros(1280, dtype=np.float32)
        is_speech, prob = vad.process(silence, "recording")
        assert not is_speech
        assert prob < 0.1

    def test_loud_noise_single_chunk(self):
        """A single chunk of random noise — just verify it doesn't crash."""
        vad = SileroVAD()
        vad.load(_MODEL_PATH.parent)
        noise = np.random.randn(1280).astype(np.float32) * 0.5
        is_speech, prob = vad.process(noise, "recording")
        # Don't assert speech/no-speech for random noise, just check types
        assert isinstance(is_speech, bool)
        assert 0.0 <= prob <= 1.0
