"""AI provider configuration - activation modes, provider detection, and config reading."""

import json
import re
from pathlib import Path

from shared.paths import get_config_base

# Electron config file path (cross-platform: APPDATA on Windows, ~/.config on Linux, ~/Library on macOS)
ELECTRON_CONFIG_PATH = get_config_base() / "voice-mirror-electron" / "config.json"


class ActivationMode:
    """Voice activation modes from Electron config."""
    WAKE_WORD = "wakeWord"
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
    "deepseek": "DeepSeek",
    "opencode": "OpenCode",
    "kimi-cli": "Kimi CLI"
}

# CLI providers where the model is controlled by the CLI tool itself, not Voice Mirror
_CLI_MANAGED_MODEL_PROVIDERS = frozenset(('claude', 'opencode', 'kimi-cli'))


def get_ai_provider() -> dict:
    """
    Get AI provider settings from Electron config.
    Returns dict with 'provider', 'name', and 'model' keys.
    """
    try:
        if ELECTRON_CONFIG_PATH.exists():
            with open(ELECTRON_CONFIG_PATH, encoding='utf-8') as f:
                config = json.load(f)
                ai = config.get("ai", {})
                provider_id = ai.get("provider", "claude")
                model = ai.get("model") or ai.get("localModel")

                # Get display name
                name = PROVIDER_DISPLAY_NAMES.get(provider_id, provider_id.title())
                # CLI-managed providers control their own model — don't append stale model names
                if model and provider_id not in _CLI_MANAGED_MODEL_PROVIDERS:
                    short_model = model.split(':')[0]
                    name = f"{name} ({short_model})"

                return {
                    "provider": provider_id,
                    "name": name,
                    "model": model
                }
    except Exception as e:
        print(f"⚠️ Could not read AI provider: {e}")

    print("⚠️ No AI provider configured, defaulting to Claude")
    return {"provider": "claude", "name": "Claude", "model": None}


def strip_provider_prefix(text: str) -> str:
    """
    Strip provider prefix from response text for cleaner TTS output.
    Handles patterns like "Claude: ", "Ollama: ", "Claude (model): ", etc.
    """
    if not text:
        return text
    # Match provider names with optional model suffix in parentheses
    pattern = r'^(?:Claude|Ollama|OpenAI|Gemini|Grok|Groq|Mistral|DeepSeek|LM Studio|Jan|OpenCode|Kimi CLI)(?:\s*\([^)]+\))?:\s*'
    return re.sub(pattern, '', text, flags=re.IGNORECASE).strip()


def get_activation_mode() -> str:
    """
    Read activation mode from Electron config file.
    Returns 'wakeWord' or 'pushToTalk'.
    Defaults to 'wakeWord' if config not found.
    """
    try:
        if ELECTRON_CONFIG_PATH.exists():
            with open(ELECTRON_CONFIG_PATH, encoding='utf-8') as f:
                config = json.load(f)
                return config.get("behavior", {}).get("activationMode", ActivationMode.WAKE_WORD)
    except Exception as e:
        print(f"⚠️ Could not read activation mode: {e}")
    return ActivationMode.WAKE_WORD
