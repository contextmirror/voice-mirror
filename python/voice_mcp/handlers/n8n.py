"""
n8n Tool Handler for Voice Mirror MCP

Wraps the shared N8nClient for MCP protocol access.
Claude Code uses this via MCP tools.
"""

# Import the shared client
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.n8n_client import N8nClient


class N8nToolHandler:
    """
    MCP wrapper around the shared N8nClient.

    Routes MCP tool calls to the shared client methods.
    """

    def __init__(self):
        self.client = N8nClient()

    async def handle(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Route tool call to appropriate method."""
        handlers = {
            # Node discovery
            "n8n_search_nodes": self._search_nodes,
            "n8n_get_node": self._get_node,
            # Workflow management
            "n8n_list_workflows": self._list_workflows,
            "n8n_get_workflow": self._get_workflow,
            "n8n_create_workflow": self._create_workflow,
            "n8n_update_workflow": self._update_workflow,
            "n8n_delete_workflow": self._delete_workflow,
            "n8n_validate_workflow": self._validate_workflow,
            "n8n_trigger_workflow": self._trigger_workflow,
            # Execution management
            "n8n_get_executions": self._get_executions,
            "n8n_get_execution": self._get_execution,
            "n8n_delete_execution": self._delete_execution,
            "n8n_retry_execution": self._retry_execution,
            # Credentials management
            "n8n_list_credentials": self._list_credentials,
            "n8n_create_credential": self._create_credential,
            "n8n_delete_credential": self._delete_credential,
            "n8n_get_credential_schema": self._get_credential_schema,
            # Tags management
            "n8n_list_tags": self._list_tags,
            "n8n_create_tag": self._create_tag,
            "n8n_delete_tag": self._delete_tag,
            # Variables
            "n8n_list_variables": self._list_variables,
            # Templates
            "n8n_deploy_template": self._deploy_template,
        }

        handler = handlers.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}

        try:
            return await handler(args)
        except Exception as e:
            return {"error": str(e)}

    # =========================================================================
    # Node Discovery
    # =========================================================================

    async def _search_nodes(self, args: dict) -> dict:
        return await self.client.search_nodes(
            query=args.get("query", ""),
            limit=args.get("limit", 10)
        )

    async def _get_node(self, args: dict) -> dict:
        return await self.client.get_node(
            node_type=args.get("node_type", ""),
            detail=args.get("detail", "standard")
        )

    # =========================================================================
    # Workflow Management
    # =========================================================================

    async def _list_workflows(self, args: dict) -> dict:
        return await self.client.list_workflows(
            active_only=args.get("active_only", False)
        )

    async def _get_workflow(self, args: dict) -> dict:
        return await self.client.get_workflow(
            workflow_id=args.get("workflow_id")
        )

    async def _create_workflow(self, args: dict) -> dict:
        return await self.client.create_workflow(
            name=args.get("name"),
            nodes=args.get("nodes", []),
            connections=args.get("connections", {})
        )

    async def _update_workflow(self, args: dict) -> dict:
        return await self.client.update_workflow(
            workflow_id=args.get("workflow_id"),
            workflow_data=args.get("workflow_data"),
            operations=args.get("operations", [])
        )

    async def _delete_workflow(self, args: dict) -> dict:
        return await self.client.delete_workflow(
            workflow_id=args.get("workflow_id")
        )

    async def _validate_workflow(self, args: dict) -> dict:
        return await self.client.validate_workflow(
            workflow_id=args.get("workflow_id"),
            workflow_json=args.get("workflow_json")
        )

    async def _trigger_workflow(self, args: dict) -> dict:
        return await self.client.trigger_workflow(
            workflow_id=args.get("workflow_id"),
            webhook_path=args.get("webhook_path"),
            data=args.get("data", {})
        )

    # =========================================================================
    # Execution Management
    # =========================================================================

    async def _get_executions(self, args: dict) -> dict:
        return await self.client.get_executions(
            workflow_id=args.get("workflow_id"),
            status=args.get("status"),
            limit=args.get("limit", 10)
        )

    async def _get_execution(self, args: dict) -> dict:
        return await self.client.get_execution(
            execution_id=args.get("execution_id"),
            include_data=args.get("include_data", False)
        )

    async def _delete_execution(self, args: dict) -> dict:
        return await self.client.delete_execution(
            execution_id=args.get("execution_id")
        )

    async def _retry_execution(self, args: dict) -> dict:
        return await self.client.retry_execution(
            execution_id=args.get("execution_id"),
            load_workflow=args.get("load_workflow", True)
        )

    # =========================================================================
    # Credentials Management
    # =========================================================================

    async def _list_credentials(self, args: dict) -> dict:
        """n8n public API does not support listing credentials."""
        return {
            "success": False,
            "error": "n8n public API does not support listing credentials",
            "hint": "Use the n8n UI at http://localhost:5678 to view credentials.",
            "available_operations": [
                "n8n_create_credential - Create a new credential",
                "n8n_delete_credential - Delete by ID",
                "n8n_get_credential_schema - Get schema for a credential type"
            ]
        }

    async def _create_credential(self, args: dict) -> dict:
        return await self.client.create_credential(
            name=args.get("name"),
            cred_type=args.get("type"),
            data=args.get("data", {})
        )

    async def _delete_credential(self, args: dict) -> dict:
        return await self.client.delete_credential(
            credential_id=args.get("credential_id")
        )

    async def _get_credential_schema(self, args: dict) -> dict:
        return await self.client.get_credential_schema(
            credential_type=args.get("credential_type")
        )

    # =========================================================================
    # Tags Management
    # =========================================================================

    async def _list_tags(self, args: dict) -> dict:
        return await self.client.list_tags()

    async def _create_tag(self, args: dict) -> dict:
        return await self.client.create_tag(
            name=args.get("name")
        )

    async def _delete_tag(self, args: dict) -> dict:
        return await self.client.delete_tag(
            tag_id=args.get("tag_id")
        )

    # =========================================================================
    # Variables
    # =========================================================================

    async def _list_variables(self, args: dict) -> dict:
        """Variables require n8n Enterprise license."""
        return {
            "success": False,
            "error": "Variables require n8n Enterprise license",
            "hint": "The Variables feature is only available on paid n8n plans."
        }

    # =========================================================================
    # Templates
    # =========================================================================

    async def _deploy_template(self, args: dict) -> dict:
        return await self.client.deploy_template(
            template_id=args.get("template_id"),
            name=args.get("name")
        )
