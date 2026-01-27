"""
Shared n8n API Client

This client is used by both:
- MCP handler (voice_mcp/handlers/n8n.py) for Claude Code access
- Qwen tool handler (tools/n8n_builder.py) for local LLM access

One implementation, two interfaces.
"""

import asyncio
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

# n8n API configuration
N8N_API_URL = "http://localhost:5678"
N8N_API_KEY_FILE = Path.home() / ".config" / "n8n" / "api_key"


def _get_api_key() -> str | None:
    """Get n8n API key from file or environment."""
    if N8N_API_KEY_FILE.exists():
        return N8N_API_KEY_FILE.read_text().strip()
    return os.environ.get("N8N_API_KEY")


class N8nClient:
    """
    Shared n8n API client.

    Provides all n8n operations that both Claude (via MCP) and Qwen can use.

    Key patterns:
    - Node type formats differ: 'nodes-base.*' (search) vs 'n8n-nodes-base.*' (workflows)
    - Connections use node NAMES not IDs
    - Validate after every change
    - Build iteratively, not all at once
    """

    def __init__(self, base_url: str = None, api_key: str = None):
        self.api_key = api_key or _get_api_key()
        self.base_url = base_url or N8N_API_URL

    async def _api_request(self, endpoint: str, method: str = "GET",
                          data: dict = None) -> dict:
        """Make authenticated request to n8n API."""
        if not self.api_key:
            raise Exception("n8n API key not configured. Set in ~/.config/n8n/api_key or N8N_API_KEY env var.")

        url = f"{self.base_url}/api/v1{endpoint}"
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

    # =========================================================================
    # Node Discovery
    # =========================================================================

    # Common node reference for quick lookups
    COMMON_NODES = {
        "gmail": {
            "nodeType": "nodes-base.gmail",
            "workflowNodeType": "n8n-nodes-base.gmail",
            "description": "Read/send Gmail messages, manage labels",
            "operations": ["message.get", "message.getMany", "message.send", "label.create"]
        },
        "webhook": {
            "nodeType": "nodes-base.webhook",
            "workflowNodeType": "n8n-nodes-base.webhook",
            "description": "Trigger workflow via HTTP request",
            "operations": ["receive HTTP requests"]
        },
        "http": {
            "nodeType": "nodes-base.httpRequest",
            "workflowNodeType": "n8n-nodes-base.httpRequest",
            "description": "Make HTTP requests to any API",
            "operations": ["GET", "POST", "PUT", "DELETE", "PATCH"]
        },
        "slack": {
            "nodeType": "nodes-base.slack",
            "workflowNodeType": "n8n-nodes-base.slack",
            "description": "Send messages, manage channels",
            "operations": ["message.send", "channel.create"]
        },
        "discord": {
            "nodeType": "nodes-base.discord",
            "workflowNodeType": "n8n-nodes-base.discord",
            "description": "Send messages to Discord channels/users",
            "operations": ["message.send", "webhook"]
        },
        "github": {
            "nodeType": "nodes-base.github",
            "workflowNodeType": "n8n-nodes-base.github",
            "description": "Manage repos, issues, PRs",
            "operations": ["issue.create", "pr.get", "repo.get"]
        },
        "code": {
            "nodeType": "nodes-base.code",
            "workflowNodeType": "n8n-nodes-base.code",
            "description": "Run custom JavaScript or Python code",
            "operations": ["javascript", "python"]
        },
        "set": {
            "nodeType": "nodes-base.set",
            "workflowNodeType": "n8n-nodes-base.set",
            "description": "Set or modify data values",
            "operations": ["set values", "transform data"]
        },
        "if": {
            "nodeType": "nodes-base.if",
            "workflowNodeType": "n8n-nodes-base.if",
            "description": "Conditional branching",
            "operations": ["true branch", "false branch"]
        },
        "switch": {
            "nodeType": "nodes-base.switch",
            "workflowNodeType": "n8n-nodes-base.switch",
            "description": "Multi-way branching based on rules",
            "operations": ["route to different outputs"]
        },
        "schedule": {
            "nodeType": "nodes-base.scheduleTrigger",
            "workflowNodeType": "n8n-nodes-base.scheduleTrigger",
            "description": "Trigger on schedule (cron)",
            "operations": ["interval", "cron"]
        },
        "google": {
            "nodeType": "nodes-base.googleSheets",
            "workflowNodeType": "n8n-nodes-base.googleSheets",
            "description": "Read/write Google Sheets",
            "operations": ["read", "append", "update"]
        },
        "calendar": {
            "nodeType": "nodes-base.googleCalendar",
            "workflowNodeType": "n8n-nodes-base.googleCalendar",
            "description": "Manage Google Calendar events",
            "operations": ["event.create", "event.get", "event.update"]
        },
        "respond": {
            "nodeType": "nodes-base.respondToWebhook",
            "workflowNodeType": "n8n-nodes-base.respondToWebhook",
            "description": "Send response back to webhook caller",
            "operations": ["respond with data"]
        },
    }

    # Node configuration templates
    NODE_CONFIGS = {
        "nodes-base.gmail": {
            "typeVersion": 2.1,
            "requiredCredentials": "gmailOAuth2Api",
            "resources": ["message", "label", "draft", "thread"],
            "commonOperations": {
                "message.getMany": {
                    "parameters": {
                        "resource": "message",
                        "operation": "getMany",
                        "returnAll": False,
                        "limit": 10
                    }
                },
                "message.send": {
                    "parameters": {
                        "resource": "message",
                        "operation": "send",
                        "sendTo": "{{ $json.email }}",
                        "subject": "Subject",
                        "emailType": "text",
                        "message": "Body"
                    }
                }
            },
            "hint": "Requires OAuth2 credentials. Set up in n8n UI first."
        },
        "nodes-base.webhook": {
            "typeVersion": 2.1,
            "requiredCredentials": None,
            "parameters": {
                "httpMethod": "POST",
                "path": "my-webhook",
                "responseMode": "lastNode"
            },
            "hint": "Path becomes: /webhook/{path} or /webhook-test/{path}"
        },
        "nodes-base.httpRequest": {
            "typeVersion": 4.2,
            "requiredCredentials": "optional",
            "parameters": {
                "method": "GET",
                "url": "https://api.example.com",
                "authentication": "none"
            },
            "hint": "For APIs with auth, set authentication and provide credentials"
        },
        "nodes-base.set": {
            "typeVersion": 3.4,
            "requiredCredentials": None,
            "parameters": {
                "mode": "manual",
                "assignments": {
                    "assignments": [
                        {"name": "fieldName", "value": "value", "type": "string"}
                    ]
                }
            },
            "hint": "Use expressions like {{ $json.field }} to reference input data"
        },
        "nodes-base.code": {
            "typeVersion": 2,
            "requiredCredentials": None,
            "parameters": {
                "language": "javaScript",
                "jsCode": "// Access input: $input.all()\n// Return items: return items;"
            },
            "hint": "Use $input.all() for all items, $input.first() for first item"
        },
        "nodes-base.switch": {
            "typeVersion": 3.2,
            "requiredCredentials": None,
            "parameters": {
                "mode": "rules",
                "options": {},
                "rules": {
                    "rules": []
                }
            },
            "hint": "Each rule creates an output. Index 0 = first rule, etc. Last index = fallback."
        },
        "nodes-base.respondToWebhook": {
            "typeVersion": 1.1,
            "requiredCredentials": None,
            "parameters": {
                "respondWith": "json",
                "responseBody": "={{ $json }}"
            },
            "hint": "Use with webhook responseMode='responseNode'"
        },
    }

    async def search_nodes(self, query: str, limit: int = 10) -> dict:
        """Search for n8n nodes by keyword."""
        query_lower = query.lower()
        results = []

        for key, node in self.COMMON_NODES.items():
            if query_lower in key or query_lower in node["description"].lower():
                results.append(node)

        if results:
            return {
                "success": True,
                "results": results[:limit],
                "hint": "Use workflowNodeType when creating workflows, nodeType for validation"
            }

        return {
            "success": True,
            "results": [],
            "hint": f"No common nodes match '{query}'. Try: gmail, webhook, http, slack, discord, github, code, set, if, switch, schedule"
        }

    async def get_node(self, node_type: str, _detail: str = "standard") -> dict:
        """Get detailed node information."""
        config = self.NODE_CONFIGS.get(node_type)
        if config:
            return {
                "success": True,
                "nodeType": node_type,
                "workflowNodeType": node_type.replace("nodes-base.", "n8n-nodes-base."),
                **config
            }

        return {
            "success": False,
            "error": f"Node '{node_type}' not in knowledge base",
            "hint": "Try searching first with search_nodes()"
        }

    # =========================================================================
    # Workflow Management
    # =========================================================================

    async def list_workflows(self, active_only: bool = False) -> dict:
        """List all workflows."""
        try:
            result = await self._api_request("/workflows")
            workflows = result.get("data", [])

            if active_only:
                workflows = [w for w in workflows if w.get("active")]

            return {
                "success": True,
                "count": len(workflows),
                "workflows": [
                    {
                        "id": w.get("id"),
                        "name": w.get("name"),
                        "active": w.get("active"),
                        "createdAt": w.get("createdAt"),
                        "updatedAt": w.get("updatedAt")
                    }
                    for w in workflows
                ]
            }
        except urllib.error.HTTPError as e:
            return {"success": False, "error": f"API error: {e.code}"}
        except urllib.error.URLError:
            return {"success": False, "error": "Cannot connect to n8n. Is it running?"}

    async def get_workflow(self, workflow_id: str) -> dict:
        """Get workflow details."""
        if not workflow_id:
            return {"error": "workflow_id required"}

        try:
            result = await self._api_request(f"/workflows/{workflow_id}")
            return {
                "success": True,
                "workflow": {
                    "id": result.get("id"),
                    "name": result.get("name"),
                    "active": result.get("active"),
                    "nodes": result.get("nodes", []),
                    "connections": result.get("connections", {}),
                    "settings": result.get("settings", {})
                }
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Workflow not found"}
            return {"success": False, "error": f"API error: {e.code}"}

    async def create_workflow(self, name: str, nodes: list[dict],
                             connections: dict = None) -> dict:
        """Create a new workflow."""
        if not name:
            return {"error": "name required"}
        if not nodes:
            return {"error": "nodes required"}

        workflow_data = {
            "name": name,
            "nodes": nodes,
            "connections": connections or {},
            "settings": {
                "executionOrder": "v1"
            }
        }

        try:
            result = await self._api_request("/workflows", method="POST", data=workflow_data)
            return {
                "success": True,
                "workflow_id": result.get("id"),
                "name": result.get("name"),
                "hint": "Workflow created but inactive. Use activate_workflow() to enable."
            }
        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode()
            except Exception:
                pass
            return {"success": False, "error": f"API error: {e.code}", "details": error_body}

    async def update_workflow(self, workflow_id: str, workflow_data: dict = None,
                             operations: list[dict] = None) -> dict:
        """
        Update workflow with operations or full workflow replacement.

        Modes:
        1. Full update: Pass workflow_data with nodes, connections, etc.
        2. Operations: Pass list of operations (activate, updateNode, addNode, etc.)
        """
        if not workflow_id:
            return {"error": "workflow_id required"}

        # Mode 1: Full workflow update
        if workflow_data:
            try:
                existing = await self._api_request(f"/workflows/{workflow_id}")
                update_payload = {
                    "name": workflow_data.get("name", existing.get("name")),
                    "nodes": workflow_data.get("nodes", existing.get("nodes", [])),
                    "connections": workflow_data.get("connections", existing.get("connections", {})),
                    "settings": workflow_data.get("settings", existing.get("settings", {})),
                }

                result = await self._api_request(
                    f"/workflows/{workflow_id}",
                    method="PUT",
                    data=update_payload
                )
                return {
                    "success": True,
                    "message": "Workflow updated",
                    "workflow_id": result.get("id"),
                    "name": result.get("name"),
                    "nodeCount": len(result.get("nodes", []))
                }
            except urllib.error.HTTPError as e:
                error_body = ""
                try:
                    error_body = e.read().decode()
                except Exception:
                    pass
                return {"success": False, "error": f"Update failed: {e.code}", "details": error_body}

        # Mode 2: Operations mode
        if not operations:
            return {"error": "Either operations or workflow_data required"}

        try:
            workflow = await self._api_request(f"/workflows/{workflow_id}")
        except urllib.error.HTTPError as e:
            return {"success": False, "error": f"Cannot fetch workflow: {e.code}"}

        nodes = workflow.get("nodes", [])
        connections = workflow.get("connections", {})
        modified = False

        for op in operations:
            op_type = op.get("type")

            if op_type == "activateWorkflow":
                return await self.activate_workflow(workflow_id)

            elif op_type == "deactivateWorkflow":
                return await self.deactivate_workflow(workflow_id)

            elif op_type == "updateNode":
                node_name = op.get("nodeName")
                new_params = op.get("parameters", {})

                for i, node in enumerate(nodes):
                    if node.get("name") == node_name:
                        node["parameters"] = {**node.get("parameters", {}), **new_params}
                        nodes[i] = node
                        modified = True
                        break
                else:
                    return {"success": False, "error": f"Node '{node_name}' not found"}

            elif op_type == "updateNodeCode":
                node_name = op.get("nodeName")
                js_code = op.get("jsCode")

                if not js_code:
                    return {"error": "jsCode required for updateNodeCode"}

                for i, node in enumerate(nodes):
                    if node.get("name") == node_name:
                        if "code" not in node.get("type", "").lower():
                            return {"error": f"Node '{node_name}' is not a code node"}
                        node["parameters"]["jsCode"] = js_code
                        nodes[i] = node
                        modified = True
                        break
                else:
                    return {"success": False, "error": f"Node '{node_name}' not found"}

            elif op_type == "addNode":
                new_node = op.get("node")
                if not new_node:
                    return {"error": "node required for addNode"}
                nodes.append(new_node)
                modified = True

            elif op_type == "removeNode":
                node_name = op.get("nodeName")
                original_len = len(nodes)
                nodes = [n for n in nodes if n.get("name") != node_name]
                if len(nodes) == original_len:
                    return {"success": False, "error": f"Node '{node_name}' not found"}
                connections.pop(node_name, None)
                for source in list(connections.keys()):
                    for output in connections[source].get("main", []):
                        connections[source]["main"] = [
                            [c for c in conns if c.get("node") != node_name]
                            for conns in connections[source].get("main", [])
                        ]
                modified = True

            elif op_type == "addConnection":
                from_node = op.get("fromNode")
                to_node = op.get("toNode")
                from_index = op.get("fromIndex", 0)
                to_index = op.get("toIndex", 0)

                if from_node not in connections:
                    connections[from_node] = {"main": [[]]}

                while len(connections[from_node]["main"]) <= from_index:
                    connections[from_node]["main"].append([])

                connections[from_node]["main"][from_index].append({
                    "node": to_node,
                    "type": "main",
                    "index": to_index
                })
                modified = True

            elif op_type == "removeConnection":
                from_node = op.get("fromNode")
                to_node = op.get("toNode")

                if from_node in connections:
                    for i, output in enumerate(connections[from_node].get("main", [])):
                        connections[from_node]["main"][i] = [
                            c for c in output if c.get("node") != to_node
                        ]
                    modified = True

        if modified:
            try:
                update_payload = {
                    "name": workflow.get("name"),
                    "nodes": nodes,
                    "connections": connections,
                    "settings": workflow.get("settings", {}),
                }

                result = await self._api_request(
                    f"/workflows/{workflow_id}",
                    method="PUT",
                    data=update_payload
                )
                return {
                    "success": True,
                    "message": "Workflow updated",
                    "workflow_id": result.get("id"),
                    "nodeCount": len(result.get("nodes", []))
                }
            except urllib.error.HTTPError as e:
                error_body = ""
                try:
                    error_body = e.read().decode()
                except Exception:
                    pass
                return {"success": False, "error": f"Update failed: {e.code}", "details": error_body}

        return {"success": True, "message": "No changes made"}

    async def delete_workflow(self, workflow_id: str) -> dict:
        """Delete a workflow by ID."""
        if not workflow_id:
            return {"error": "workflow_id required"}

        try:
            result = await self._api_request(f"/workflows/{workflow_id}", method="DELETE")
            return {
                "success": True,
                "message": f"Workflow {workflow_id} deleted",
                "deleted_workflow": {
                    "id": result.get("id"),
                    "name": result.get("name")
                }
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Workflow not found"}
            return {"success": False, "error": f"Delete failed: {e.code}"}

    async def activate_workflow(self, workflow_id: str) -> dict:
        """Activate a workflow."""
        try:
            result = await self._api_request(
                f"/workflows/{workflow_id}/activate",
                method="POST"
            )
            return {
                "success": True,
                "message": "Workflow activated",
                "active": True
            }
        except urllib.error.HTTPError as e:
            return {"success": False, "error": f"Activation failed: {e.code}"}

    async def deactivate_workflow(self, workflow_id: str) -> dict:
        """Deactivate a workflow."""
        try:
            result = await self._api_request(
                f"/workflows/{workflow_id}/deactivate",
                method="POST"
            )
            return {
                "success": True,
                "message": "Workflow deactivated",
                "active": False
            }
        except urllib.error.HTTPError as e:
            return {"success": False, "error": f"Deactivation failed: {e.code}"}

    async def validate_workflow(self, workflow_id: str = None,
                               workflow_json: dict = None) -> dict:
        """Validate workflow configuration."""
        if workflow_id:
            workflow_result = await self.get_workflow(workflow_id)
            if not workflow_result.get("success"):
                return workflow_result
            workflow = workflow_result.get("workflow", {})
        elif workflow_json:
            workflow = workflow_json
        else:
            return {"error": "Either workflow_id or workflow_json required"}

        errors = []
        warnings = []

        nodes = workflow.get("nodes", [])
        connections = workflow.get("connections", {})

        if not nodes:
            errors.append("Workflow has no nodes")

        trigger_nodes = [n for n in nodes if "trigger" in n.get("type", "").lower()]
        if not trigger_nodes:
            warnings.append("No trigger node found. Workflow won't start automatically.")

        node_names = {n.get("name") for n in nodes}
        for source, targets in connections.items():
            if source not in node_names:
                errors.append(f"Connection from unknown node: {source}")
            for output in targets.get("main", []):
                for conn in output:
                    if conn.get("node") not in node_names:
                        errors.append(f"Connection to unknown node: {conn.get('node')}")

        return {
            "success": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "nodeCount": len(nodes),
            "connectionCount": len(connections)
        }

    async def trigger_workflow(self, workflow_id: str = None,
                              webhook_path: str = None,
                              data: dict = None) -> dict:
        """Trigger workflow via webhook."""
        if not workflow_id and not webhook_path:
            return {"error": "Either workflow_id or webhook_path required"}

        if webhook_path:
            url = f"{self.base_url}/webhook/{webhook_path}"
        else:
            workflow_result = await self.get_workflow(workflow_id)
            if not workflow_result.get("success"):
                return workflow_result

            nodes = workflow_result.get("workflow", {}).get("nodes", [])
            webhook_nodes = [n for n in nodes if "webhook" in n.get("type", "").lower()]

            if not webhook_nodes:
                return {"error": "No webhook node found in workflow"}

            path = webhook_nodes[0].get("parameters", {}).get("path", "")
            if not path:
                return {"error": "Webhook node has no path configured"}

            url = f"{self.base_url}/webhook/{path}"

        def _trigger():
            req = urllib.request.Request(
                url,
                headers={"Content-Type": "application/json"},
                method="POST",
                data=json.dumps(data or {}).encode()
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return {"error": "Webhook not found. Is the workflow active?"}
                return {"error": f"HTTP {e.code}"}

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _trigger)

        if "error" in result:
            return {"success": False, **result}

        return {
            "success": True,
            "response": result
        }

    # =========================================================================
    # Execution Management
    # =========================================================================

    async def get_executions(self, workflow_id: str = None,
                            status: str = None, limit: int = 10) -> dict:
        """Get workflow executions."""
        params = [f"limit={limit}"]
        if workflow_id:
            params.append(f"workflowId={workflow_id}")
        if status:
            params.append(f"status={status}")

        query = "&".join(params)

        try:
            result = await self._api_request(f"/executions?{query}")
            executions = result.get("data", [])

            return {
                "success": True,
                "count": len(executions),
                "executions": [
                    {
                        "id": e.get("id"),
                        "workflowId": e.get("workflowId"),
                        "status": e.get("status"),
                        "startedAt": e.get("startedAt"),
                        "stoppedAt": e.get("stoppedAt"),
                        "mode": e.get("mode")
                    }
                    for e in executions
                ]
            }
        except urllib.error.HTTPError as e:
            return {"success": False, "error": f"API error: {e.code}"}

    async def get_execution(self, execution_id: str, include_data: bool = False) -> dict:
        """Get a specific execution with optional data."""
        if not execution_id:
            return {"error": "execution_id required"}

        try:
            endpoint = f"/executions/{execution_id}"
            if include_data:
                endpoint += "?includeData=true"

            result = await self._api_request(endpoint)
            return {
                "success": True,
                "execution": {
                    "id": result.get("id"),
                    "workflowId": result.get("workflowId"),
                    "status": result.get("status"),
                    "finished": result.get("finished"),
                    "mode": result.get("mode"),
                    "startedAt": result.get("startedAt"),
                    "stoppedAt": result.get("stoppedAt"),
                    "data": result.get("data") if include_data else None,
                    "workflowData": result.get("workflowData")
                }
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Execution not found"}
            return {"success": False, "error": f"API error: {e.code}"}

    async def delete_execution(self, execution_id: str) -> dict:
        """Delete an execution by ID."""
        if not execution_id:
            return {"error": "execution_id required"}

        try:
            await self._api_request(f"/executions/{execution_id}", method="DELETE")
            return {
                "success": True,
                "message": f"Execution {execution_id} deleted"
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Execution not found"}
            return {"success": False, "error": f"Delete failed: {e.code}"}

    async def retry_execution(self, execution_id: str, load_workflow: bool = True) -> dict:
        """Retry a failed execution."""
        if not execution_id:
            return {"error": "execution_id required"}

        try:
            result = await self._api_request(
                f"/executions/{execution_id}/retry",
                method="POST",
                data={"loadWorkflow": load_workflow}
            )
            return {
                "success": True,
                "message": f"Execution {execution_id} retried",
                "new_execution": result
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Execution not found"}
            return {"success": False, "error": f"Retry failed: {e.code}"}

    # =========================================================================
    # Credentials Management
    # =========================================================================

    async def create_credential(self, name: str, cred_type: str,
                               data: dict = None) -> dict:
        """Create a new credential."""
        if not name:
            return {"error": "name required"}
        if not cred_type:
            return {"error": "type required (e.g., 'slackApi', 'gmailOAuth2')"}

        try:
            result = await self._api_request(
                "/credentials",
                method="POST",
                data={
                    "name": name,
                    "type": cred_type,
                    "data": data or {}
                }
            )
            return {
                "success": True,
                "credential_id": result.get("id"),
                "name": result.get("name"),
                "type": result.get("type"),
                "hint": "Credential created. Note: OAuth credentials may need manual browser auth."
            }
        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode()
            except Exception:
                pass
            return {"success": False, "error": f"Create failed: {e.code}", "details": error_body}

    async def delete_credential(self, credential_id: str) -> dict:
        """Delete a credential by ID."""
        if not credential_id:
            return {"error": "credential_id required"}

        try:
            await self._api_request(f"/credentials/{credential_id}", method="DELETE")
            return {
                "success": True,
                "message": f"Credential {credential_id} deleted"
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Credential not found"}
            return {"success": False, "error": f"Delete failed: {e.code}"}

    async def get_credential_schema(self, credential_type: str) -> dict:
        """Get the schema for a credential type."""
        if not credential_type:
            return {"error": "credential_type required (e.g., 'gmailOAuth2', 'slackApi')"}

        try:
            result = await self._api_request(f"/credentials/schema/{credential_type}")
            return {
                "success": True,
                "credential_type": credential_type,
                "schema": result,
                "required_fields": result.get("required", [])
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": f"Unknown credential type: {credential_type}"}
            return {"success": False, "error": f"API error: {e.code}"}

    # =========================================================================
    # Tags Management
    # =========================================================================

    async def list_tags(self) -> dict:
        """List all tags."""
        try:
            result = await self._api_request("/tags")
            tags = result.get("data", []) if isinstance(result, dict) else result

            return {
                "success": True,
                "count": len(tags),
                "tags": [
                    {
                        "id": t.get("id"),
                        "name": t.get("name"),
                        "createdAt": t.get("createdAt"),
                        "updatedAt": t.get("updatedAt")
                    }
                    for t in tags
                ]
            }
        except urllib.error.HTTPError as e:
            return {"success": False, "error": f"API error: {e.code}"}

    async def create_tag(self, name: str) -> dict:
        """Create a new tag."""
        if not name:
            return {"error": "name required"}

        try:
            result = await self._api_request(
                "/tags",
                method="POST",
                data={"name": name}
            )
            return {
                "success": True,
                "tag_id": result.get("id"),
                "name": result.get("name")
            }
        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode()
            except Exception:
                pass
            return {"success": False, "error": f"Create failed: {e.code}", "details": error_body}

    async def delete_tag(self, tag_id: str) -> dict:
        """Delete a tag by ID."""
        if not tag_id:
            return {"error": "tag_id required"}

        try:
            await self._api_request(f"/tags/{tag_id}", method="DELETE")
            return {
                "success": True,
                "message": f"Tag {tag_id} deleted"
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": False, "error": "Tag not found"}
            return {"success": False, "error": f"Delete failed: {e.code}"}

    # =========================================================================
    # Templates
    # =========================================================================

    async def deploy_template(self, template_id: int, name: str = None) -> dict:
        """Deploy a template from n8n.io."""
        if not template_id:
            return {"error": "template_id required"}

        template_url = f"https://api.n8n.io/api/templates/workflows/{template_id}"

        def _fetch_template():
            req = urllib.request.Request(
                template_url,
                headers={"User-Agent": "Mozilla/5.0 (Voice Mirror)"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())

        loop = asyncio.get_event_loop()

        try:
            template = await loop.run_in_executor(None, _fetch_template)
        except Exception as e:
            return {"error": f"Failed to fetch template: {e}"}

        outer_workflow = template.get("workflow", {})
        workflow_data = outer_workflow.get("workflow", {})
        if not workflow_data:
            return {"error": "Template has no workflow data"}

        workflow_name = name or outer_workflow.get("name", f"Template {template_id}")

        create_result = await self.create_workflow(
            name=workflow_name,
            nodes=workflow_data.get("nodes", []),
            connections=workflow_data.get("connections", {})
        )

        if create_result.get("success"):
            create_result["template_name"] = outer_workflow.get("name")
            create_result["template_description"] = outer_workflow.get("description", "")[:200]

        return create_result
