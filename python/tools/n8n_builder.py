"""
n8n Workflow Builder - Qwen tool handler using shared N8nClient.

This gives Qwen the same n8n workflow building capabilities as Claude Code.
Qwen can create, update, and manage n8n workflows via voice commands.

Example voice commands:
- "Create a webhook that sends to Discord"
- "List my n8n workflows"
- "Activate the Gmail workflow"
"""

import json
import sys
from pathlib import Path
from typing import Dict, Any

# Add parent to path for shared imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.n8n_client import N8nClient


class N8nBuilderHandler:
    """
    Qwen tool handler for n8n workflow building.

    Uses the shared N8nClient - same backend as Claude's MCP tools.
    """

    def __init__(self):
        self.client = N8nClient()

    async def execute(self, action: str, **kwargs) -> str:
        """
        Execute an n8n action.

        Actions:
            Node Discovery:
                search_nodes - Search for nodes by keyword
                get_node - Get node details and configuration

            Workflow Management:
                list_workflows - List all workflows
                get_workflow - Get workflow details
                create_workflow - Create new workflow
                update_workflow - Update existing workflow
                delete_workflow - Delete a workflow
                activate_workflow - Activate a workflow
                deactivate_workflow - Deactivate a workflow
                validate_workflow - Validate workflow configuration
                trigger_workflow - Trigger via webhook

            Execution Management:
                get_executions - Get execution history
                get_execution - Get execution details
                retry_execution - Retry failed execution

            Templates:
                deploy_template - Deploy template from n8n.io

        Args depend on action. Common ones:
            query: Search query for search_nodes
            workflow_id: ID for get/update/delete/activate/trigger
            name: Workflow name for create
            nodes: Node array for create
            connections: Connection map for create
            template_id: Template ID for deploy_template
        """
        action_handlers = {
            # Node discovery
            "search_nodes": self._search_nodes,
            "get_node": self._get_node,
            # Workflow management
            "list_workflows": self._list_workflows,
            "list": self._list_workflows,  # alias
            "get_workflow": self._get_workflow,
            "create_workflow": self._create_workflow,
            "create": self._create_workflow,  # alias
            "update_workflow": self._update_workflow,
            "update": self._update_workflow,  # alias
            "delete_workflow": self._delete_workflow,
            "delete": self._delete_workflow,  # alias
            "activate_workflow": self._activate_workflow,
            "activate": self._activate_workflow,  # alias
            "deactivate_workflow": self._deactivate_workflow,
            "deactivate": self._deactivate_workflow,  # alias
            "validate_workflow": self._validate_workflow,
            "validate": self._validate_workflow,  # alias
            "trigger_workflow": self._trigger_workflow,
            "trigger": self._trigger_workflow,  # alias
            # Execution management
            "get_executions": self._get_executions,
            "executions": self._get_executions,  # alias
            "get_execution": self._get_execution,
            "retry_execution": self._retry_execution,
            "retry": self._retry_execution,  # alias
            # Templates
            "deploy_template": self._deploy_template,
            "template": self._deploy_template,  # alias
            # Tags
            "list_tags": self._list_tags,
            "create_tag": self._create_tag,
            # Credentials
            "get_credential_schema": self._get_credential_schema,
        }

        handler = action_handlers.get(action)
        if not handler:
            return f"Unknown action: {action}. Available: {', '.join(sorted(set(action_handlers.keys())))}"

        try:
            result = await handler(**kwargs)
            return self._format_result(result)
        except Exception as e:
            return f"Error: {e}"

    def _format_result(self, result: Dict) -> str:
        """Format result dict for voice output."""
        if not result.get("success", True):
            error = result.get("error", "Unknown error")
            hint = result.get("hint", "")
            return f"Error: {error}. {hint}" if hint else f"Error: {error}"

        # For list results, format nicely
        if "workflows" in result:
            count = result.get("count", 0)
            if count == 0:
                return "No workflows found"
            workflows = result["workflows"]
            lines = [f"Found {count} workflow{'s' if count != 1 else ''}:"]
            for w in workflows[:10]:
                status = "active" if w.get("active") else "inactive"
                lines.append(f"  - {w.get('name')} ({status})")
            return "\n".join(lines)

        if "executions" in result:
            count = result.get("count", 0)
            if count == 0:
                return "No executions found"
            execs = result["executions"]
            lines = [f"Found {count} execution{'s' if count != 1 else ''}:"]
            for e in execs[:5]:
                lines.append(f"  - {e.get('id')}: {e.get('status')}")
            return "\n".join(lines)

        if "results" in result:
            results = result["results"]
            if not results:
                hint = result.get("hint", "")
                return f"No results. {hint}" if hint else "No results found"
            lines = ["Found nodes:"]
            for r in results[:10]:
                lines.append(f"  - {r.get('nodeType')}: {r.get('description', '')[:50]}")
            return "\n".join(lines)

        if "workflow_id" in result:
            msg = result.get("message", "Success")
            wid = result.get("workflow_id")
            hint = result.get("hint", "")
            return f"{msg}. ID: {wid}. {hint}" if hint else f"{msg}. ID: {wid}"

        if "message" in result:
            return result["message"]

        # Default: JSON dump
        return json.dumps(result, indent=2)

    # =========================================================================
    # Node Discovery
    # =========================================================================

    async def _search_nodes(self, query: str = "", limit: int = 10, **kwargs) -> Dict:
        return await self.client.search_nodes(query=query, limit=limit)

    async def _get_node(self, node_type: str = "", **kwargs) -> Dict:
        return await self.client.get_node(node_type=node_type)

    # =========================================================================
    # Workflow Management
    # =========================================================================

    async def _list_workflows(self, active_only: bool = False, **kwargs) -> Dict:
        return await self.client.list_workflows(active_only=active_only)

    async def _get_workflow(self, workflow_id: str = "", **kwargs) -> Dict:
        return await self.client.get_workflow(workflow_id=workflow_id)

    async def _create_workflow(self, name: str = "", nodes: list = None,
                              connections: dict = None, **kwargs) -> Dict:
        return await self.client.create_workflow(
            name=name,
            nodes=nodes or [],
            connections=connections
        )

    async def _update_workflow(self, workflow_id: str = "", workflow_data: dict = None,
                              operations: list = None, **kwargs) -> Dict:
        return await self.client.update_workflow(
            workflow_id=workflow_id,
            workflow_data=workflow_data,
            operations=operations
        )

    async def _delete_workflow(self, workflow_id: str = "", **kwargs) -> Dict:
        return await self.client.delete_workflow(workflow_id=workflow_id)

    async def _activate_workflow(self, workflow_id: str = "", **kwargs) -> Dict:
        return await self.client.activate_workflow(workflow_id=workflow_id)

    async def _deactivate_workflow(self, workflow_id: str = "", **kwargs) -> Dict:
        return await self.client.deactivate_workflow(workflow_id=workflow_id)

    async def _validate_workflow(self, workflow_id: str = None,
                                workflow_json: dict = None, **kwargs) -> Dict:
        return await self.client.validate_workflow(
            workflow_id=workflow_id,
            workflow_json=workflow_json
        )

    async def _trigger_workflow(self, workflow_id: str = None,
                               webhook_path: str = None,
                               data: dict = None, **kwargs) -> Dict:
        return await self.client.trigger_workflow(
            workflow_id=workflow_id,
            webhook_path=webhook_path,
            data=data
        )

    # =========================================================================
    # Execution Management
    # =========================================================================

    async def _get_executions(self, workflow_id: str = None,
                             status: str = None, limit: int = 10, **kwargs) -> Dict:
        return await self.client.get_executions(
            workflow_id=workflow_id,
            status=status,
            limit=limit
        )

    async def _get_execution(self, execution_id: str = "",
                            include_data: bool = False, **kwargs) -> Dict:
        return await self.client.get_execution(
            execution_id=execution_id,
            include_data=include_data
        )

    async def _retry_execution(self, execution_id: str = "", **kwargs) -> Dict:
        return await self.client.retry_execution(execution_id=execution_id)

    # =========================================================================
    # Templates
    # =========================================================================

    async def _deploy_template(self, template_id: int = None,
                              name: str = None, **kwargs) -> Dict:
        return await self.client.deploy_template(
            template_id=template_id,
            name=name
        )

    # =========================================================================
    # Tags
    # =========================================================================

    async def _list_tags(self, **kwargs) -> Dict:
        return await self.client.list_tags()

    async def _create_tag(self, name: str = "", **kwargs) -> Dict:
        return await self.client.create_tag(name=name)

    # =========================================================================
    # Credentials
    # =========================================================================

    async def _get_credential_schema(self, credential_type: str = "", **kwargs) -> Dict:
        return await self.client.get_credential_schema(credential_type=credential_type)


def register_n8n_builder_tools() -> dict:
    """Create and return n8n builder tool handler."""
    return {
        "n8n_builder": N8nBuilderHandler(),
    }
