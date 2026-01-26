"""n8n workflow automation tool handler.

Allows Voice Mirror to trigger n8n workflows via webhooks.
Use cases:
- "Check my emails" -> triggers email summary workflow
- "Organize my inbox" -> triggers email classification workflow
- "What workflows do I have?" -> lists available workflows

For complex workflow creation, route to Claude which has full n8n-mcp access.
"""

import json
import urllib.request
import urllib.error
from typing import Dict, Any, List, Callable, Awaitable, Optional
from pathlib import Path

# n8n API configuration
N8N_API_URL = "http://localhost:5678"
N8N_API_KEY_FILE = Path.home() / ".config" / "n8n" / "api_key"

# Fallback: read from environment or hardcode for dev
def _get_api_key() -> Optional[str]:
    """Get n8n API key from file or environment."""
    import os

    # Try file first
    if N8N_API_KEY_FILE.exists():
        return N8N_API_KEY_FILE.read_text().strip()

    # Try environment
    return os.environ.get("N8N_API_KEY")


class N8nHandler:
    """
    Interface with n8n for workflow automation.

    This handler provides direct n8n access for simple operations.
    For complex workflow building, Voice Mirror routes to Claude.
    """

    def __init__(self, llm_caller: Optional[Callable[[List[Dict]], Awaitable[str]]] = None):
        """
        Args:
            llm_caller: Optional LLM for natural language responses
        """
        self.llm_caller = llm_caller
        self.api_key = _get_api_key()
        self._workflow_cache: Optional[List[Dict]] = None

    async def execute(self, action: str = "list", workflow_id: str = "",
                     webhook_path: str = "", data: Dict = None, **kwargs) -> str:
        """
        Execute n8n action.

        Args:
            action: "list", "trigger", "status"
            workflow_id: ID of workflow for trigger/status
            webhook_path: Path for webhook trigger
            data: Data to send to webhook
        """
        if not self.api_key:
            return "n8n API key not configured. Set N8N_API_KEY or create ~/.config/n8n/api_key"

        try:
            if action == "list":
                return await self._list_workflows()
            elif action == "trigger":
                return await self._trigger_workflow(workflow_id, webhook_path, data or {})
            elif action == "status":
                return await self._get_workflow_status(workflow_id)
            else:
                return f"Unknown action: {action}. Use: list, trigger, or status"
        except Exception as e:
            return f"n8n error: {e}"

    async def _api_request(self, endpoint: str, method: str = "GET",
                          data: Dict = None) -> Dict:
        """Make authenticated request to n8n API."""
        import asyncio

        url = f"{N8N_API_URL}/api/v1{endpoint}"
        headers = {
            "X-N8N-API-KEY": self.api_key,
            "Content-Type": "application/json",
        }

        def _fetch():
            req = urllib.request.Request(url, headers=headers, method=method)
            if data:
                req.data = json.dumps(data).encode()

            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch)

    async def _list_workflows(self) -> str:
        """List available workflows."""
        try:
            result = await self._api_request("/workflows")
            workflows = result.get("data", [])

            if not workflows:
                return "No workflows found. Ask Claude to create one for you!"

            # Cache for later reference
            self._workflow_cache = workflows

            # Format for voice output
            active = [w for w in workflows if w.get("active")]
            inactive = [w for w in workflows if not w.get("active")]

            parts = []
            if active:
                names = ", ".join(w.get("name", "Unnamed") for w in active[:5])
                parts.append(f"Active workflows: {names}")
            if inactive:
                names = ", ".join(w.get("name", "Unnamed") for w in inactive[:3])
                parts.append(f"Inactive: {names}")

            return ". ".join(parts) if parts else "You have workflows but none are active."

        except urllib.error.HTTPError as e:
            if e.code == 401:
                return "n8n API key is invalid"
            return f"n8n API error: {e.code}"
        except urllib.error.URLError:
            return "Can't connect to n8n. Is it running?"

    async def _trigger_workflow(self, workflow_id: str, webhook_path: str,
                               data: Dict) -> str:
        """Trigger a workflow via webhook."""
        import asyncio

        if not webhook_path and not workflow_id:
            return "Need either workflow_id or webhook_path to trigger a workflow"

        # Try webhook trigger first (more reliable for active workflows)
        if webhook_path:
            url = f"{N8N_API_URL}/webhook/{webhook_path}"
        else:
            # Look up webhook path from workflow
            url = f"{N8N_API_URL}/webhook/test/{workflow_id}"

        def _trigger():
            req = urllib.request.Request(
                url,
                headers={"Content-Type": "application/json"},
                method="POST",
                data=json.dumps(data).encode() if data else b"{}"
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read().decode())
                    return result
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return {"error": "Webhook not found. Is the workflow active?"}
                return {"error": f"HTTP {e.code}"}

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _trigger)

        if "error" in result:
            return result["error"]

        # Format result for voice
        if isinstance(result, dict):
            if "message" in result:
                return result["message"]
            return "Workflow triggered successfully."

        return str(result)[:200]  # Truncate for voice

    async def _get_workflow_status(self, workflow_id: str) -> str:
        """Get status of a workflow."""
        if not workflow_id:
            return "Need a workflow ID to check status"

        try:
            result = await self._api_request(f"/workflows/{workflow_id}")

            name = result.get("name", "Unknown")
            active = result.get("active", False)
            status = "active" if active else "inactive"

            return f"{name} is {status}."

        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "Workflow not found"
            return f"Error checking status: {e.code}"


class N8nListWorkflowsHandler:
    """Simple handler for listing workflows."""

    def __init__(self, parent: N8nHandler):
        self.parent = parent

    async def execute(self, **kwargs) -> str:
        return await self.parent.execute(action="list")


class N8nTriggerHandler:
    """Handler for triggering workflows."""

    def __init__(self, parent: N8nHandler):
        self.parent = parent

    async def execute(self, workflow_id: str = "", webhook_path: str = "",
                     data: Dict = None, **kwargs) -> str:
        return await self.parent.execute(
            action="trigger",
            workflow_id=workflow_id,
            webhook_path=webhook_path,
            data=data or {}
        )


def register_n8n_tools(tool_registry, llm_caller=None) -> dict:
    """Create and return n8n tool handlers.

    Args:
        tool_registry: Not used (kept for API compatibility)
        llm_caller: Optional LLM for natural language responses

    Returns:
        Dict of tool_name -> handler
    """
    parent = N8nHandler(llm_caller)

    return {
        "n8n_list_workflows": N8nListWorkflowsHandler(parent),
        "n8n_trigger_workflow": N8nTriggerHandler(parent),
    }
