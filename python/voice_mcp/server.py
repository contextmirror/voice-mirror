#!/usr/bin/env python3
"""
Voice Mirror MCP Server

Provides Claude with tools for:
- n8n workflow management (with embedded skills knowledge)
- Voice control and status
- Smart home integration
- Web search

This is the primary interface for Claude to interact with Voice Mirror
and n8n automation capabilities.
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Import handlers
from voice_mcp.handlers.n8n import N8nToolHandler
from voice_mcp.handlers.voice import VoiceToolHandler

# Create server instance
server = Server("voice-mirror")

# Initialize handlers
n8n_handler = N8nToolHandler()
voice_handler = VoiceToolHandler()


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List all available tools."""
    tools = []

    # n8n workflow tools
    tools.extend([
        Tool(
            name="n8n_search_nodes",
            description="Search for n8n nodes by keyword. Use to find the right node for a task (e.g., 'gmail', 'webhook', 'slack'). Returns node types and descriptions.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search keyword (e.g., 'gmail', 'webhook', 'http')"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default: 10)",
                        "default": 10
                    }
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="n8n_get_node",
            description="Get detailed information about an n8n node including operations, parameters, and configuration examples. Use after search_nodes to understand how to configure a node.",
            inputSchema={
                "type": "object",
                "properties": {
                    "node_type": {
                        "type": "string",
                        "description": "Node type (e.g., 'nodes-base.gmail', 'nodes-base.webhook')"
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["minimal", "standard", "full"],
                        "description": "Detail level (default: standard)",
                        "default": "standard"
                    }
                },
                "required": ["node_type"]
            }
        ),
        Tool(
            name="n8n_list_workflows",
            description="List all workflows in the n8n instance. Shows name, active status, and ID.",
            inputSchema={
                "type": "object",
                "properties": {
                    "active_only": {
                        "type": "boolean",
                        "description": "Only show active workflows",
                        "default": False
                    }
                }
            }
        ),
        Tool(
            name="n8n_get_workflow",
            description="Get details of a specific workflow by ID. Returns nodes, connections, and settings.",
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID"
                    }
                },
                "required": ["workflow_id"]
            }
        ),
        Tool(
            name="n8n_create_workflow",
            description="""Create a new n8n workflow.

IMPORTANT - Node type format:
- Use 'n8n-nodes-base.xxx' for workflow nodes (NOT 'nodes-base.xxx')
- Use '@n8n/n8n-nodes-langchain.xxx' for AI nodes

IMPORTANT - Connection format:
- Connections use node NAMES (not IDs)
- Format: {"NodeName": {"main": [[{"node": "TargetName", "type": "main", "index": 0}]]}}

Common patterns:
- Webhook trigger: n8n-nodes-base.webhook
- HTTP request: n8n-nodes-base.httpRequest
- Gmail: n8n-nodes-base.gmail
- Set data: n8n-nodes-base.set
- Code: n8n-nodes-base.code""",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Workflow name"
                    },
                    "nodes": {
                        "type": "array",
                        "description": "Array of node configurations",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string"},
                                "type": {"type": "string"},
                                "typeVersion": {"type": "number"},
                                "position": {
                                    "type": "array",
                                    "items": {"type": "number"}
                                },
                                "parameters": {"type": "object"}
                            },
                            "required": ["id", "name", "type", "typeVersion", "position", "parameters"]
                        }
                    },
                    "connections": {
                        "type": "object",
                        "description": "Node connections (source node name -> targets)"
                    }
                },
                "required": ["name", "nodes", "connections"]
            }
        ),
        Tool(
            name="n8n_update_workflow",
            description="""Update an existing workflow with operations or full replacement.

Two modes:
1. Operations mode: Apply specific changes via operations array
2. Full update mode: Replace entire workflow via workflow_data object

Operation types:
- addNode: Add a new node (requires node object)
- removeNode: Remove a node by name (requires nodeName)
- updateNode: Update node parameters (requires nodeName, parameters)
- updateNodeCode: Update jsCode in a code node (requires nodeName, jsCode)
- addConnection: Connect two nodes (requires fromNode, toNode)
- removeConnection: Disconnect nodes (requires fromNode, toNode)
- activateWorkflow: Make workflow active
- deactivateWorkflow: Make workflow inactive""",
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID to update"
                    },
                    "operations": {
                        "type": "array",
                        "description": "List of operations to apply",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ["addNode", "removeNode", "updateNode", "updateNodeCode",
                                            "addConnection", "removeConnection",
                                            "activateWorkflow", "deactivateWorkflow"]
                                },
                                "nodeName": {"type": "string", "description": "Name of node to modify"},
                                "node": {"type": "object", "description": "Node object for addNode"},
                                "parameters": {"type": "object", "description": "Parameters for updateNode"},
                                "jsCode": {"type": "string", "description": "JavaScript code for updateNodeCode"},
                                "fromNode": {"type": "string", "description": "Source node for connections"},
                                "toNode": {"type": "string", "description": "Target node for connections"},
                                "fromIndex": {"type": "integer", "description": "Output index (default 0)"},
                                "toIndex": {"type": "integer", "description": "Input index (default 0)"}
                            },
                            "required": ["type"]
                        }
                    },
                    "workflow_data": {
                        "type": "object",
                        "description": "Full workflow data for complete replacement (nodes, connections, settings)",
                        "properties": {
                            "name": {"type": "string"},
                            "nodes": {"type": "array"},
                            "connections": {"type": "object"},
                            "settings": {"type": "object"}
                        }
                    }
                },
                "required": ["workflow_id"]
            }
        ),
        Tool(
            name="n8n_validate_workflow",
            description="Validate a workflow configuration before creating/updating. Checks for errors and warnings.",
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Existing workflow ID to validate"
                    },
                    "workflow_json": {
                        "type": "object",
                        "description": "Or provide workflow JSON directly"
                    }
                }
            }
        ),
        Tool(
            name="n8n_trigger_workflow",
            description="Trigger a workflow execution via webhook. Use for testing or manual execution.",
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID"
                    },
                    "webhook_path": {
                        "type": "string",
                        "description": "Webhook path (if known)"
                    },
                    "data": {
                        "type": "object",
                        "description": "Data to send to webhook",
                        "default": {}
                    }
                },
                "required": ["workflow_id"]
            }
        ),
        Tool(
            name="n8n_get_executions",
            description="Get recent executions for a workflow. Useful for checking if workflows ran successfully.",
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID (optional, shows all if omitted)"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["success", "error", "waiting"],
                        "description": "Filter by status"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results",
                        "default": 10
                    }
                }
            }
        ),
        Tool(
            name="n8n_deploy_template",
            description="Deploy a template from n8n.io to the local instance. Great for quick starts with pre-built workflows.",
            inputSchema={
                "type": "object",
                "properties": {
                    "template_id": {
                        "type": "integer",
                        "description": "Template ID from n8n.io"
                    },
                    "name": {
                        "type": "string",
                        "description": "Custom name (optional)"
                    }
                },
                "required": ["template_id"]
            }
        ),
        Tool(
            name="n8n_delete_workflow",
            description="Delete a workflow by ID. This action is permanent.",
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID to delete"
                    }
                },
                "required": ["workflow_id"]
            }
        ),
        Tool(
            name="n8n_get_execution",
            description="Get details of a specific execution. Use include_data=true to get full execution data for debugging.",
            inputSchema={
                "type": "object",
                "properties": {
                    "execution_id": {
                        "type": "string",
                        "description": "Execution ID"
                    },
                    "include_data": {
                        "type": "boolean",
                        "description": "Include full execution data (default: false)",
                        "default": False
                    }
                },
                "required": ["execution_id"]
            }
        ),
        Tool(
            name="n8n_delete_execution",
            description="Delete an execution by ID. Useful for cleaning up execution history.",
            inputSchema={
                "type": "object",
                "properties": {
                    "execution_id": {
                        "type": "string",
                        "description": "Execution ID to delete"
                    }
                },
                "required": ["execution_id"]
            }
        ),
        Tool(
            name="n8n_retry_execution",
            description="Retry a failed execution. By default uses the latest workflow version.",
            inputSchema={
                "type": "object",
                "properties": {
                    "execution_id": {
                        "type": "string",
                        "description": "Execution ID to retry"
                    },
                    "load_workflow": {
                        "type": "boolean",
                        "description": "Use latest workflow version (default: true)",
                        "default": True
                    }
                },
                "required": ["execution_id"]
            }
        ),
        Tool(
            name="n8n_list_credentials",
            description="List all credentials in the n8n instance. NOTE: This is not supported by n8n public API - use n8n UI instead.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="n8n_get_credential_schema",
            description="Get the schema for a credential type. Shows required fields and data structure. Use before creating credentials.",
            inputSchema={
                "type": "object",
                "properties": {
                    "credential_type": {
                        "type": "string",
                        "description": "Credential type (e.g., 'gmailOAuth2', 'slackApi', 'httpBasicAuth', 'githubApi')"
                    }
                },
                "required": ["credential_type"]
            }
        ),
        Tool(
            name="n8n_create_credential",
            description="Create a new credential. Note: OAuth credentials may need manual browser authentication.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Credential name"
                    },
                    "type": {
                        "type": "string",
                        "description": "Credential type (e.g., 'slackApi', 'gmailOAuth2', 'httpBasicAuth')"
                    },
                    "data": {
                        "type": "object",
                        "description": "Credential data (e.g., {accessToken: 'xxx'} for API keys)",
                        "default": {}
                    }
                },
                "required": ["name", "type"]
            }
        ),
        Tool(
            name="n8n_delete_credential",
            description="Delete a credential by ID. Will affect workflows using this credential.",
            inputSchema={
                "type": "object",
                "properties": {
                    "credential_id": {
                        "type": "string",
                        "description": "Credential ID to delete"
                    }
                },
                "required": ["credential_id"]
            }
        ),
        Tool(
            name="n8n_list_tags",
            description="List all tags used for organizing workflows.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="n8n_create_tag",
            description="Create a new tag for workflow organization.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Tag name"
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="n8n_delete_tag",
            description="Delete a tag by ID.",
            inputSchema={
                "type": "object",
                "properties": {
                    "tag_id": {
                        "type": "string",
                        "description": "Tag ID to delete"
                    }
                },
                "required": ["tag_id"]
            }
        ),
        Tool(
            name="n8n_list_variables",
            description="List all global variables configured in n8n. NOTE: Requires n8n Enterprise license.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
    ])

    # Voice tools
    tools.extend([
        Tool(
            name="voice_status",
            description="Get Voice Mirror status - whether it's running, current mode, etc.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="voice_speak",
            description="Speak a message through Voice Mirror TTS. Use for voice responses.",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Text to speak"
                    }
                },
                "required": ["message"]
            }
        ),
    ])

    return tools


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Handle tool calls."""

    # Route to appropriate handler
    if name.startswith("n8n_"):
        result = await n8n_handler.handle(name, arguments)
    elif name.startswith("voice_"):
        result = await voice_handler.handle(name, arguments)
    else:
        result = {"error": f"Unknown tool: {name}"}

    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
