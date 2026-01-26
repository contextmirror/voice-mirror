"""Voice settings management - location, timezone, units."""

import json
from pathlib import Path
from typing import Optional, Dict, Any

VOICE_SETTINGS_PATH = Path.home() / ".config" / "voice-mirror-electron" / "data" / "voice_settings.json"


def get_location_from_ip() -> Optional[str]:
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


def load_voice_settings() -> Dict[str, Any]:
    """Load user's voice settings (location from IP, or cached)."""
    defaults = {
        "location": "United Kingdom",
        "timezone": "Europe/London",
        "units": "metric",
        "stt_adapter": "parakeet",  # parakeet, whisper, faster-whisper
        "stt_model": None,  # None = use adapter's default model
        "tts_adapter": "kokoro",  # kokoro, qwen (future: piper, coqui, elevenlabs)
        "tts_voice": "af_bella",  # Voice ID (adapter-dependent)
    }

    # Try to load cached settings first
    if VOICE_SETTINGS_PATH.exists():
        try:
            settings = json.loads(VOICE_SETTINGS_PATH.read_text())
            return {**defaults, **settings}
        except Exception:
            pass

    # No cached settings - try IP geolocation
    ip_location = get_location_from_ip()
    if ip_location:
        defaults["location"] = ip_location
        save_voice_settings(defaults)

    return defaults


def save_voice_settings(settings: Dict[str, Any]) -> bool:
    """Save user's voice settings to disk."""
    try:
        VOICE_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        VOICE_SETTINGS_PATH.write_text(json.dumps(settings, indent=2))
        return True
    except Exception:
        return False
