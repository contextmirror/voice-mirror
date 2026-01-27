"""AI provider configuration and inbox communication."""

from .config import (
    ELECTRON_CONFIG_PATH,
    PROVIDER_DISPLAY_NAMES,
    ActivationMode,
    get_activation_mode,
    get_ai_provider,
    strip_provider_prefix,
)
from .inbox import InboxManager, cleanup_inbox

__all__ = [
    "ELECTRON_CONFIG_PATH",
    "PROVIDER_DISPLAY_NAMES",
    "ActivationMode",
    "InboxManager",
    "cleanup_inbox",
    "get_activation_mode",
    "get_ai_provider",
    "strip_provider_prefix",
]
