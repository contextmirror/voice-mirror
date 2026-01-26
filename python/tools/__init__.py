"""Voice Mirror tools - smart home, web search, n8n, gmail, github ci, weather, etc."""

from .smart_home import register_smart_home_tools
from .web_search import register_web_search_tools
from .n8n import register_n8n_tools
from .gmail import register_gmail_tools
from .github_ci import register_github_ci_tools
from .weather import register_weather_tools
from .n8n_builder import register_n8n_builder_tools

__all__ = [
    "register_smart_home_tools",
    "register_web_search_tools",
    "register_n8n_tools",
    "register_gmail_tools",
    "register_github_ci_tools",
    "register_weather_tools",
    "register_n8n_builder_tools",
]
