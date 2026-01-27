"""AI provider configuration - activation modes, provider detection, and config reading."""

import json
import re
from pathlib import Path

# Electron config file path
ELECTRON_CONFIG_PATH = Path.home() / ".config" / "voice-mirror-electron" / "config.json"


class ActivationMode:
    """Voice activation modes from Electron config."""
    WAKE_WORD = "wakeWord"
    CALL_MODE = "callMode"
    PUSH_TO_TALK = "pushToTalk"


# Provider display names mapping
PROVIDER_DISPLAY_NAMES = {
    "claude": "Claude",
    "ollama": "Ollama",
    "lmstudio": "LM Studio",
    "jan": "Jan",
    "openai": "OpenAI",
    "gemini": "Gemini",
    "grok": "Grok",
    "groq": "Groq",
    "mistral": "Mistral",
    "openrouter": "OpenRouter",
    "deepseek": "DeepSeek"
}


def get_ai_provider() -> dict:
    """
    Get AI provider settings from Electron config.
    Returns dict with 'provider', 'name', and 'model' keys.
    """
    try:
        if ELECTRON_CONFIG_PATH.exists():
            with open(ELECTRON_CONFIG_PATH) as f:
                config = json.load(f)
                ai = config.get("ai", {})
                provider_id = ai.get("provider", "claude")
                model = ai.get("model")

                # Get display name
                name = PROVIDER_DISPLAY_NAMES.get(provider_id, provider_id.title())
                if model:
                    short_model = model.split(':')[0]
                    name = f"{name} ({short_model})"

                return {
                    "provider": provider_id,
                    "name": name,
                    "model": model
                }
    except Exception as e:
        print(f"⚠️ Could not read AI provider: {e}")

    return {"provider": "claude", "name": "Claude", "model": None}


def strip_provider_prefix(text: str) -> str:
    """
    Strip provider prefix from response text for cleaner TTS output.
    Handles patterns like "Claude: ", "Ollama: ", "Claude (model): ", etc.
    """
    if not text:
        return text
    # Match provider names with optional model suffix in parentheses
    pattern = r'^(?:Claude|Ollama|OpenAI|Gemini|Grok|Groq|Mistral|DeepSeek|LM Studio|Jan)(?:\s*\([^)]+\))?:\s*'
    return re.sub(pattern, '', text, flags=re.IGNORECASE).strip()


def get_activation_mode() -> str:
    """
    Read activation mode from Electron config file.
    Returns 'wakeWord', 'callMode', or 'pushToTalk'.
    Defaults to 'wakeWord' if config not found.
    """
    try:
        if ELECTRON_CONFIG_PATH.exists():
            with open(ELECTRON_CONFIG_PATH) as f:
                config = json.load(f)
                return config.get("behavior", {}).get("activationMode", ActivationMode.WAKE_WORD)
    except Exception as e:
        print(f"⚠️ Could not read activation mode: {e}")
    return ActivationMode.WAKE_WORD
