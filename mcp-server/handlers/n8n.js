/**
 * n8n workflow management handlers
 *
 * Ported from Voice Mirror Python (shared/n8n_client.py + voice_mcp/handlers/n8n.py)
 * Provides 22 tools for managing n8n workflows, executions, credentials, tags, and templates.
 *
 * Key patterns:
 * - Node type formats differ: 'nodes-base.*' (search) vs 'n8n-nodes-base.*' (workflows)
 * - Connections use node NAMES not IDs
 * - n8n API runs at http://localhost:5678
 * - API key from ~/.config/n8n/api_key or N8N_API_KEY env var
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================
// Configuration
// ============================================

// n8n runs locally — HTTP to localhost is intentional and acceptable
const N8N_API_URL = 'http://localhost:5678';
const N8N_API_KEY_FILE = path.join(os.homedir(), '.config', 'n8n', 'api_key');

let _cachedApiKey = null;

function getApiKey() {
    if (_cachedApiKey) return _cachedApiKey;
    try {
        if (fs.existsSync(N8N_API_KEY_FILE)) {
            _cachedApiKey = fs.readFileSync(N8N_API_KEY_FILE, 'utf-8').trim();
            return _cachedApiKey;
        }
    } catch {
        _cachedApiKey = null;
    }
    _cachedApiKey = process.env.N8N_API_KEY || null;
    return _cachedApiKey;
}

// ============================================
// HTTP Client
// ============================================

function apiRequest(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const apiKey = getApiKey();
        if (!apiKey) {
            return reject(new Error('n8n API key not configured. Set in ~/.config/n8n/api_key or N8N_API_KEY env var.'));
        }

        const url = new URL(`/api/v1${endpoint}`, N8N_API_URL);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: {
                'X-N8N-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        };

        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve(body);
                    }
                } else {
                    const err = new Error(`API error: ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    err.body = body;
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

/** Make a raw HTTP request (for webhooks / external URLs) */
function rawRequest(url, method = 'POST', data = null, headers = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';

        // Enforce HTTPS for non-localhost URLs to prevent cleartext transmission
        if (!isLocalhost && parsed.protocol !== 'https:') {
            return reject(new Error(`HTTPS required for non-localhost URL: ${parsed.hostname}`));
        }

        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout
        };

        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(body)); } catch { resolve(body); }
                } else {
                    const err = new Error(`HTTP ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

// ============================================
// MCP response helpers
// ============================================

function ok(result) {
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function err(message) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }], isError: true };
}

// ============================================
// Node Knowledge Base
// ============================================

const COMMON_NODES = {
    gmail: {
        nodeType: 'nodes-base.gmail',
        workflowNodeType: 'n8n-nodes-base.gmail',
        description: 'Read/send Gmail messages, manage labels',
        operations: ['message.get', 'message.getMany', 'message.send', 'label.create']
    },
    webhook: {
        nodeType: 'nodes-base.webhook',
        workflowNodeType: 'n8n-nodes-base.webhook',
        description: 'Trigger workflow via HTTP request',
        operations: ['receive HTTP requests']
    },
    http: {
        nodeType: 'nodes-base.httpRequest',
        workflowNodeType: 'n8n-nodes-base.httpRequest',
        description: 'Make HTTP requests to any API',
        operations: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    },
    slack: {
        nodeType: 'nodes-base.slack',
        workflowNodeType: 'n8n-nodes-base.slack',
        description: 'Send messages, manage channels',
        operations: ['message.send', 'channel.create']
    },
    discord: {
        nodeType: 'nodes-base.discord',
        workflowNodeType: 'n8n-nodes-base.discord',
        description: 'Send messages to Discord channels/users',
        operations: ['message.send', 'webhook']
    },
    github: {
        nodeType: 'nodes-base.github',
        workflowNodeType: 'n8n-nodes-base.github',
        description: 'Manage repos, issues, PRs',
        operations: ['issue.create', 'pr.get', 'repo.get']
    },
    code: {
        nodeType: 'nodes-base.code',
        workflowNodeType: 'n8n-nodes-base.code',
        description: 'Run custom JavaScript or Python code',
        operations: ['javascript', 'python']
    },
    set: {
        nodeType: 'nodes-base.set',
        workflowNodeType: 'n8n-nodes-base.set',
        description: 'Set or modify data values',
        operations: ['set values', 'transform data']
    },
    if: {
        nodeType: 'nodes-base.if',
        workflowNodeType: 'n8n-nodes-base.if',
        description: 'Conditional branching',
        operations: ['true branch', 'false branch']
    },
    switch: {
        nodeType: 'nodes-base.switch',
        workflowNodeType: 'n8n-nodes-base.switch',
        description: 'Multi-way branching based on rules',
        operations: ['route to different outputs']
    },
    schedule: {
        nodeType: 'nodes-base.scheduleTrigger',
        workflowNodeType: 'n8n-nodes-base.scheduleTrigger',
        description: 'Trigger on schedule (cron)',
        operations: ['interval', 'cron']
    },
    google: {
        nodeType: 'nodes-base.googleSheets',
        workflowNodeType: 'n8n-nodes-base.googleSheets',
        description: 'Read/write Google Sheets',
        operations: ['read', 'append', 'update']
    },
    calendar: {
        nodeType: 'nodes-base.googleCalendar',
        workflowNodeType: 'n8n-nodes-base.googleCalendar',
        description: 'Manage Google Calendar events',
        operations: ['event.create', 'event.get', 'event.update']
    },
    respond: {
        nodeType: 'nodes-base.respondToWebhook',
        workflowNodeType: 'n8n-nodes-base.respondToWebhook',
        description: 'Send response back to webhook caller',
        operations: ['respond with data']
    }
};

const NODE_CONFIGS = {
    'nodes-base.gmail': {
        typeVersion: 2.1,
        requiredCredentials: 'gmailOAuth2Api',
        resources: ['message', 'label', 'draft', 'thread'],
        commonOperations: {
            'message.getMany': {
                parameters: { resource: 'message', operation: 'getMany', returnAll: false, limit: 10 }
            },
            'message.send': {
                parameters: { resource: 'message', operation: 'send', sendTo: '{{ $json.email }}', subject: 'Subject', emailType: 'text', message: 'Body' }
            }
        },
        hint: 'Requires OAuth2 credentials. Set up in n8n UI first.'
    },
    'nodes-base.webhook': {
        typeVersion: 2.1,
        requiredCredentials: null,
        parameters: { httpMethod: 'POST', path: 'my-webhook', responseMode: 'lastNode' },
        hint: 'Path becomes: /webhook/{path} or /webhook-test/{path}'
    },
    'nodes-base.httpRequest': {
        typeVersion: 4.2,
        requiredCredentials: 'optional',
        parameters: { method: 'GET', url: 'https://api.example.com', authentication: 'none' },
        hint: 'For APIs with auth, set authentication and provide credentials'
    },
    'nodes-base.set': {
        typeVersion: 3.4,
        requiredCredentials: null,
        parameters: { mode: 'manual', assignments: { assignments: [{ name: 'fieldName', value: 'value', type: 'string' }] } },
        hint: 'Use expressions like {{ $json.field }} to reference input data'
    },
    'nodes-base.code': {
        typeVersion: 2,
        requiredCredentials: null,
        parameters: { language: 'javaScript', jsCode: '// Access input: $input.all()\n// Return items: return items;' },
        hint: 'Use $input.all() for all items, $input.first() for first item'
    },
    'nodes-base.switch': {
        typeVersion: 3.2,
        requiredCredentials: null,
        parameters: { mode: 'rules', options: {}, rules: { rules: [] } },
        hint: 'Each rule creates an output. Index 0 = first rule, etc. Last index = fallback.'
    },
    'nodes-base.respondToWebhook': {
        typeVersion: 1.1,
        requiredCredentials: null,
        parameters: { respondWith: 'json', responseBody: '={{ $json }}' },
        hint: 'Use with webhook responseMode=\'responseNode\''
    }
};

// ============================================
// Node Discovery Handlers
// ============================================

async function handleN8nSearchNodes(args) {
    const query = (args?.query || '').toLowerCase();
    const limit = args?.limit || 10;
    const results = [];

    for (const [key, node] of Object.entries(COMMON_NODES)) {
        if (query.includes(key) || key.includes(query) || node.description.toLowerCase().includes(query)) {
            results.push(node);
        }
    }

    if (results.length > 0) {
        return ok({
            success: true,
            results: results.slice(0, limit),
            hint: 'Use workflowNodeType when creating workflows, nodeType for validation'
        });
    }

    return ok({
        success: true,
        results: [],
        hint: `No common nodes match '${query}'. Try: gmail, webhook, http, slack, discord, github, code, set, if, switch, schedule`
    });
}

async function handleN8nGetNode(args) {
    const nodeType = args?.node_type;
    const config = NODE_CONFIGS[nodeType];

    if (config) {
        return ok({
            success: true,
            nodeType,
            workflowNodeType: nodeType.replace('nodes-base.', 'n8n-nodes-base.'),
            ...config
        });
    }

    return ok({
        success: false,
        error: `Node '${nodeType}' not in knowledge base`,
        hint: 'Try searching first with n8n_search_nodes'
    });
}

// ============================================
// Workflow Management Handlers
// ============================================

async function handleN8nListWorkflows(args) {
    try {
        const result = await apiRequest('/workflows');
        let workflows = result.data || [];

        if (args?.active_only) {
            workflows = workflows.filter(w => w.active);
        }

        return ok({
            success: true,
            count: workflows.length,
            workflows: workflows.map(w => ({
                id: w.id,
                name: w.name,
                active: w.active,
                createdAt: w.createdAt,
                updatedAt: w.updatedAt
            }))
        });
    } catch (e) {
        if (e.message?.includes('ECONNREFUSED')) return err('Cannot connect to n8n. Is it running?');
        return err(e.message);
    }
}

async function handleN8nGetWorkflow(args) {
    const workflowId = args?.workflow_id;
    if (!workflowId) return err('workflow_id required');

    try {
        const result = await apiRequest(`/workflows/${workflowId}`);
        return ok({
            success: true,
            workflow: {
                id: result.id,
                name: result.name,
                active: result.active,
                nodes: result.nodes || [],
                connections: result.connections || {},
                settings: result.settings || {}
            }
        });
    } catch (e) {
        if (e.statusCode === 404) return err('Workflow not found');
        return err(e.message);
    }
}

async function handleN8nCreateWorkflow(args) {
    const name = args?.name;
    const nodes = args?.nodes;
    const connections = args?.connections || {};

    if (!name) return err('name required');
    if (!nodes) return err('nodes required');

    try {
        const result = await apiRequest('/workflows', 'POST', {
            name,
            nodes,
            connections,
            settings: { executionOrder: 'v1' }
        });

        return ok({
            success: true,
            workflow_id: result.id,
            name: result.name,
            hint: 'Workflow created but inactive. Use n8n_update_workflow with activateWorkflow operation to enable.'
        });
    } catch (e) {
        return err(`Create failed: ${e.message}${e.body ? ' - ' + e.body : ''}`);
    }
}

async function handleN8nUpdateWorkflow(args) {
    const workflowId = args?.workflow_id;
    if (!workflowId) return err('workflow_id required');

    const workflowData = args?.workflow_data;
    const operations = args?.operations;

    // Mode 1: Full workflow update
    if (workflowData) {
        try {
            const existing = await apiRequest(`/workflows/${workflowId}`);
            const result = await apiRequest(`/workflows/${workflowId}`, 'PUT', {
                name: workflowData.name || existing.name,
                nodes: workflowData.nodes || existing.nodes || [],
                connections: workflowData.connections || existing.connections || {},
                settings: workflowData.settings || existing.settings || {}
            });
            return ok({
                success: true,
                message: 'Workflow updated',
                workflow_id: result.id,
                name: result.name,
                nodeCount: (result.nodes || []).length
            });
        } catch (e) {
            return err(`Update failed: ${e.message}${e.body ? ' - ' + e.body : ''}`);
        }
    }

    // Mode 2: Operations
    if (!operations || operations.length === 0) return err('Either operations or workflow_data required');

    let workflow;
    try {
        workflow = await apiRequest(`/workflows/${workflowId}`);
    } catch (e) {
        return err(`Cannot fetch workflow: ${e.message}`);
    }

    let nodes = workflow.nodes || [];
    let connections = workflow.connections || {};
    let modified = false;

    for (const op of operations) {
        const opType = op.type;

        if (opType === 'activateWorkflow') {
            try {
                await apiRequest(`/workflows/${workflowId}/activate`, 'POST');
                return ok({ success: true, message: 'Workflow activated', active: true });
            } catch (e) {
                return err(`Activation failed: ${e.message}`);
            }
        }

        if (opType === 'deactivateWorkflow') {
            try {
                await apiRequest(`/workflows/${workflowId}/deactivate`, 'POST');
                return ok({ success: true, message: 'Workflow deactivated', active: false });
            } catch (e) {
                return err(`Deactivation failed: ${e.message}`);
            }
        }

        if (opType === 'updateNode') {
            const idx = nodes.findIndex(n => n.name === op.nodeName);
            if (idx === -1) return err(`Node '${op.nodeName}' not found`);
            nodes[idx].parameters = { ...nodes[idx].parameters, ...op.parameters };
            modified = true;
        }

        if (opType === 'updateNodeCode') {
            if (!op.jsCode) return err('jsCode required for updateNodeCode');
            const idx = nodes.findIndex(n => n.name === op.nodeName);
            if (idx === -1) return err(`Node '${op.nodeName}' not found`);
            if (!nodes[idx].type?.toLowerCase().includes('code')) return err(`Node '${op.nodeName}' is not a code node`);
            nodes[idx].parameters.jsCode = op.jsCode;
            modified = true;
        }

        if (opType === 'addNode') {
            if (!op.node) return err('node required for addNode');
            nodes.push(op.node);
            modified = true;
        }

        if (opType === 'removeNode') {
            const origLen = nodes.length;
            nodes = nodes.filter(n => n.name !== op.nodeName);
            if (nodes.length === origLen) return err(`Node '${op.nodeName}' not found`);
            delete connections[op.nodeName];
            for (const source of Object.keys(connections)) {
                if (connections[source]?.main) {
                    connections[source].main = connections[source].main.map(
                        conns => conns.filter(c => c.node !== op.nodeName)
                    );
                }
            }
            modified = true;
        }

        if (opType === 'addConnection') {
            const fromNode = op.fromNode;
            const toNode = op.toNode;
            const fromIndex = op.fromIndex || 0;
            const toIndex = op.toIndex || 0;

            if (!connections[fromNode]) connections[fromNode] = { main: [[]] };
            while (connections[fromNode].main.length <= fromIndex) connections[fromNode].main.push([]);
            connections[fromNode].main[fromIndex].push({ node: toNode, type: 'main', index: toIndex });
            modified = true;
        }

        if (opType === 'removeConnection') {
            if (connections[op.fromNode]?.main) {
                connections[op.fromNode].main = connections[op.fromNode].main.map(
                    output => output.filter(c => c.node !== op.toNode)
                );
                modified = true;
            }
        }
    }

    if (modified) {
        try {
            const result = await apiRequest(`/workflows/${workflowId}`, 'PUT', {
                name: workflow.name,
                nodes,
                connections,
                settings: workflow.settings || {}
            });
            return ok({
                success: true,
                message: 'Workflow updated',
                workflow_id: result.id,
                nodeCount: (result.nodes || []).length
            });
        } catch (e) {
            return err(`Update failed: ${e.message}${e.body ? ' - ' + e.body : ''}`);
        }
    }

    return ok({ success: true, message: 'No changes made' });
}

async function handleN8nDeleteWorkflow(args) {
    const workflowId = args?.workflow_id;
    if (!workflowId) return err('workflow_id required');

    try {
        const result = await apiRequest(`/workflows/${workflowId}`, 'DELETE');
        return ok({
            success: true,
            message: `Workflow ${workflowId} deleted`,
            deleted_workflow: { id: result.id, name: result.name }
        });
    } catch (e) {
        if (e.statusCode === 404) return err('Workflow not found');
        return err(`Delete failed: ${e.message}`);
    }
}

async function handleN8nValidateWorkflow(args) {
    let workflow;

    if (args?.workflow_id) {
        try {
            const result = await apiRequest(`/workflows/${args.workflow_id}`);
            workflow = { nodes: result.nodes || [], connections: result.connections || {} };
        } catch (e) {
            return err(e.message);
        }
    } else if (args?.workflow_json) {
        workflow = args.workflow_json;
    } else {
        return err('Either workflow_id or workflow_json required');
    }

    const errors = [];
    const warnings = [];
    const nodes = workflow.nodes || [];
    const connections = workflow.connections || {};

    if (nodes.length === 0) errors.push('Workflow has no nodes');

    const triggerNodes = nodes.filter(n => (n.type || '').toLowerCase().includes('trigger'));
    if (triggerNodes.length === 0) warnings.push('No trigger node found. Workflow won\'t start automatically.');

    const nodeNames = new Set(nodes.map(n => n.name));
    for (const [source, targets] of Object.entries(connections)) {
        if (!nodeNames.has(source)) errors.push(`Connection from unknown node: ${source}`);
        for (const output of (targets.main || [])) {
            for (const conn of output) {
                if (!nodeNames.has(conn.node)) errors.push(`Connection to unknown node: ${conn.node}`);
            }
        }
    }

    return ok({
        success: errors.length === 0,
        errors,
        warnings,
        nodeCount: nodes.length,
        connectionCount: Object.keys(connections).length
    });
}

async function handleN8nTriggerWorkflow(args) {
    const workflowId = args?.workflow_id;
    let webhookPath = args?.webhook_path;
    const data = args?.data || {};

    if (!workflowId && !webhookPath) return err('Either workflow_id or webhook_path required');

    if (!webhookPath) {
        try {
            const result = await apiRequest(`/workflows/${workflowId}`);
            const nodes = result.nodes || [];
            const webhookNodes = nodes.filter(n => (n.type || '').toLowerCase().includes('webhook'));
            if (webhookNodes.length === 0) return err('No webhook node found in workflow');
            webhookPath = webhookNodes[0]?.parameters?.path;
            if (!webhookPath) return err('Webhook node has no path configured');
        } catch (e) {
            return err(e.message);
        }
    }

    const url = `${N8N_API_URL}/webhook/${webhookPath}`;

    try {
        const result = await rawRequest(url, 'POST', data);
        return ok({ success: true, response: result });
    } catch (e) {
        if (e.statusCode === 404) return err('Webhook not found. Is the workflow active?');
        return err(e.message);
    }
}

async function handleN8nDeployTemplate(args) {
    const templateId = args?.template_id;
    if (!templateId) return err('template_id required');

    const templateUrl = `https://api.n8n.io/api/templates/workflows/${templateId}`;

    let template;
    try {
        template = await rawRequest(templateUrl, 'GET', null, { 'User-Agent': 'Mozilla/5.0 (Voice Mirror)' }, 30000);
    } catch (e) {
        return err(`Failed to fetch template: ${e.message}`);
    }

    const outerWorkflow = template.workflow || {};
    const workflowData = outerWorkflow.workflow || {};
    if (!workflowData.nodes) return err('Template has no workflow data');

    const workflowName = args?.name || outerWorkflow.name || `Template ${templateId}`;

    const createResult = await handleN8nCreateWorkflow({
        name: workflowName,
        nodes: workflowData.nodes || [],
        connections: workflowData.connections || {}
    });

    // Add template info to the response
    try {
        const parsed = JSON.parse(createResult.content[0].text);
        if (parsed.success) {
            parsed.template_name = outerWorkflow.name;
            parsed.template_description = (outerWorkflow.description || '').slice(0, 200);
            return ok(parsed);
        }
    } catch {}

    return createResult;
}

// ============================================
// Execution Management Handlers
// ============================================

async function handleN8nGetExecutions(args) {
    const params = [`limit=${args?.limit || 10}`];
    if (args?.workflow_id) params.push(`workflowId=${args.workflow_id}`);
    if (args?.status) params.push(`status=${args.status}`);

    try {
        const result = await apiRequest(`/executions?${params.join('&')}`);
        const executions = result.data || [];

        return ok({
            success: true,
            count: executions.length,
            executions: executions.map(e => ({
                id: e.id,
                workflowId: e.workflowId,
                status: e.status,
                startedAt: e.startedAt,
                stoppedAt: e.stoppedAt,
                mode: e.mode
            }))
        });
    } catch (e) {
        return err(e.message);
    }
}

async function handleN8nGetExecution(args) {
    const executionId = args?.execution_id;
    if (!executionId) return err('execution_id required');

    try {
        const endpoint = args?.include_data ? `/executions/${executionId}?includeData=true` : `/executions/${executionId}`;
        const result = await apiRequest(endpoint);

        return ok({
            success: true,
            execution: {
                id: result.id,
                workflowId: result.workflowId,
                status: result.status,
                finished: result.finished,
                mode: result.mode,
                startedAt: result.startedAt,
                stoppedAt: result.stoppedAt,
                data: args?.include_data ? result.data : undefined,
                workflowData: result.workflowData
            }
        });
    } catch (e) {
        if (e.statusCode === 404) return err('Execution not found');
        return err(e.message);
    }
}

async function handleN8nDeleteExecution(args) {
    const executionId = args?.execution_id;
    if (!executionId) return err('execution_id required');

    try {
        await apiRequest(`/executions/${executionId}`, 'DELETE');
        return ok({ success: true, message: `Execution ${executionId} deleted` });
    } catch (e) {
        if (e.statusCode === 404) return err('Execution not found');
        return err(`Delete failed: ${e.message}`);
    }
}

async function handleN8nRetryExecution(args) {
    const executionId = args?.execution_id;
    if (!executionId) return err('execution_id required');

    try {
        const result = await apiRequest(`/executions/${executionId}/retry`, 'POST', {
            loadWorkflow: args?.load_workflow !== false
        });
        return ok({ success: true, message: `Execution ${executionId} retried`, new_execution: result });
    } catch (e) {
        if (e.statusCode === 404) return err('Execution not found');
        return err(`Retry failed: ${e.message}`);
    }
}

// ============================================
// Credentials Management Handlers
// ============================================

async function handleN8nListCredentials() {
    return ok({
        success: false,
        error: 'n8n public API does not support listing credentials',
        hint: 'Use the n8n UI at http://localhost:5678 to view credentials.',
        available_operations: [
            'n8n_create_credential - Create a new credential',
            'n8n_delete_credential - Delete by ID',
            'n8n_get_credential_schema - Get schema for a credential type'
        ]
    });
}

async function handleN8nCreateCredential(args) {
    const name = args?.name;
    const credType = args?.type;
    if (!name) return err('name required');
    if (!credType) return err('type required (e.g., \'slackApi\', \'gmailOAuth2\')');

    try {
        const result = await apiRequest('/credentials', 'POST', {
            name,
            type: credType,
            data: args?.data || {}
        });
        return ok({
            success: true,
            credential_id: result.id,
            name: result.name,
            type: result.type,
            hint: 'Credential created. Note: OAuth credentials may need manual browser auth.'
        });
    } catch (e) {
        return err(`Create failed: ${e.message}${e.body ? ' - ' + e.body : ''}`);
    }
}

async function handleN8nDeleteCredential(args) {
    const credentialId = args?.credential_id;
    if (!credentialId) return err('credential_id required');

    try {
        await apiRequest(`/credentials/${credentialId}`, 'DELETE');
        return ok({ success: true, message: `Credential ${credentialId} deleted` });
    } catch (e) {
        if (e.statusCode === 404) return err('Credential not found');
        return err(`Delete failed: ${e.message}`);
    }
}

async function handleN8nGetCredentialSchema(args) {
    const credentialType = args?.credential_type;
    if (!credentialType) return err('credential_type required (e.g., \'gmailOAuth2\', \'slackApi\')');

    try {
        const result = await apiRequest(`/credentials/schema/${credentialType}`);
        return ok({
            success: true,
            credential_type: credentialType,
            schema: result,
            required_fields: result.required || []
        });
    } catch (e) {
        if (e.statusCode === 404) return err(`Unknown credential type: ${credentialType}`);
        return err(e.message);
    }
}

// ============================================
// Tags Management Handlers
// ============================================

async function handleN8nListTags() {
    try {
        const result = await apiRequest('/tags');
        const tags = Array.isArray(result) ? result : (result.data || []);

        return ok({
            success: true,
            count: tags.length,
            tags: tags.map(t => ({
                id: t.id,
                name: t.name,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt
            }))
        });
    } catch (e) {
        return err(e.message);
    }
}

async function handleN8nCreateTag(args) {
    const name = args?.name;
    if (!name) return err('name required');

    try {
        const result = await apiRequest('/tags', 'POST', { name });
        return ok({ success: true, tag_id: result.id, name: result.name });
    } catch (e) {
        return err(`Create failed: ${e.message}${e.body ? ' - ' + e.body : ''}`);
    }
}

async function handleN8nDeleteTag(args) {
    const tagId = args?.tag_id;
    if (!tagId) return err('tag_id required');

    try {
        await apiRequest(`/tags/${tagId}`, 'DELETE');
        return ok({ success: true, message: `Tag ${tagId} deleted` });
    } catch (e) {
        if (e.statusCode === 404) return err('Tag not found');
        return err(`Delete failed: ${e.message}`);
    }
}

// ============================================
// Variables Handler
// ============================================

async function handleN8nListVariables() {
    return ok({
        success: false,
        error: 'Variables require n8n Enterprise license',
        hint: 'The Variables feature is only available on paid n8n plans.'
    });
}

// ============================================
// Exports
// ============================================

module.exports = {
    // Node discovery
    handleN8nSearchNodes,
    handleN8nGetNode,
    // Workflow management
    handleN8nListWorkflows,
    handleN8nGetWorkflow,
    handleN8nCreateWorkflow,
    handleN8nUpdateWorkflow,
    handleN8nDeleteWorkflow,
    handleN8nValidateWorkflow,
    handleN8nTriggerWorkflow,
    handleN8nDeployTemplate,
    // Execution management
    handleN8nGetExecutions,
    handleN8nGetExecution,
    handleN8nDeleteExecution,
    handleN8nRetryExecution,
    // Credentials
    handleN8nListCredentials,
    handleN8nCreateCredential,
    handleN8nDeleteCredential,
    handleN8nGetCredentialSchema,
    // Tags
    handleN8nListTags,
    handleN8nCreateTag,
    handleN8nDeleteTag,
    // Variables
    handleN8nListVariables
};
