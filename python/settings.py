"""Voice settings management - location, timezone, units."""

import json
from pathlib import Path
from typing import Any

from shared.paths import get_data_dir
VOICE_SETTINGS_PATH = get_data_dir() / "voice_settings.json"


def get_location_from_ip() -> str | None:
    """Get location from IP address using free ip-api.com service."""
    try:
        import urllib.request
        with urllib.request.urlopen(
            "http://ip-api.com/json/?fields=city,regionName,country",
            timeout=5
        ) as resp:
            data = json.loads(resp.read().decode())
            city = data.get("city", "")
            region = data.get("regionName", "")
            country = data.get("country", "")
            parts = [p for p in [city, region, country] if p]
            return ", ".join(parts) if parts else None
    except Exception:
        return None


def load_voice_settings() -> dict[str, Any]:
    """Load user's voice settings (location from IP, or cached)."""
    defaults = {
        "location": "United Kingdom",
        "timezone": "Europe/London",
        "units": "metric",
        "stt_adapter": "parakeet",  # parakeet, whisper, faster-whisper, openai-whisper-api, custom-api-stt
        "stt_model": None,  # None = use adapter's default model
        "stt_api_key": None,  # API key for cloud STT
        "stt_endpoint": None,  # Custom STT endpoint URL
        "stt_model_name": None,  # Specific model name (e.g. "large-v3")
        "tts_adapter": "kokoro",  # kokoro, qwen, piper, edge, openai-tts, elevenlabs, custom-api
        "tts_voice": "af_bella",  # Voice ID (adapter-dependent)
        "tts_model_size": "0.6B",  # Qwen3-TTS model size: "0.6B" (faster, ~2GB VRAM) or "1.7B" (better quality, ~4GB VRAM)
        "tts_volume": 1.0,  # Volume multiplier (0.1-2.0, 1.0 = 100%)
        "tts_api_key": None,  # API key for cloud TTS
        "tts_endpoint": None,  # Custom endpoint URL
        "tts_model_path": None,  # Local model file path (Piper)
    }

    # Try to load cached settings first
    if VOICE_SETTINGS_PATH.exists():
        try:
            settings = json.loads(VOICE_SETTINGS_PATH.read_text(encoding="utf-8"))
            return {**defaults, **settings}
        except Exception:
            pass

    # No cached settings - try IP geolocation
    ip_location = get_location_from_ip()
    if ip_location:
        defaults["location"] = ip_location
        save_voice_settings(defaults)

    return defaults


def save_voice_settings(settings: dict[str, Any]) -> bool:
    """Save user's voice settings to disk."""
    try:
        VOICE_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        VOICE_SETTINGS_PATH.write_text(json.dumps(settings, indent=2), encoding="utf-8")
        return True
    except Exception:
        return False
