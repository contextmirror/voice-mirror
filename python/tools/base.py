"""Base tool handler and shared utilities."""

from typing import Protocol, Dict, Any, runtime_checkable


@runtime_checkable
class ToolHandler(Protocol):
    """Protocol for tool handlers."""

    async def execute(self, **kwargs) -> str:
        """Execute the tool with given arguments."""
        ...


class SmartHomeToolHandler:
    """Base class for smart home tools that need SmartHome access."""

    def __init__(self, smart_home):
        self.smart_home = smart_home

    def _require_smart_home(self) -> str | None:
        """Return error message if smart_home not available, else None."""
        if not self.smart_home:
            return "Smart home not available"
        return None
