/**
 * System prompt builder for local LLM tool support.
 *
 * Generates system prompts that teach local models how to use tools
 * via JSON output format.
 */

const { getAllTools } = require('./definitions');

/**
 * Build tool documentation for the system prompt
 */
function buildToolDocs() {
    const tools = getAllTools();
    let docs = '';

    for (const tool of tools) {
        docs += `- ${tool.name}: ${tool.description}\n`;

        // Add argument descriptions
        const argEntries = Object.entries(tool.args);
        if (argEntries.length > 0) {
            for (const [argName, argDef] of argEntries) {
                const required = argDef.required ? '(required)' : '(optional)';
                docs += `  - ${argName}: ${argDef.description} ${required}\n`;
            }
        }
    }

    return docs;
}

/**
 * Get tool examples for the system prompt
 */
function getToolExamples() {
    const tools = getAllTools();
    return tools.map(t => t.example).join('\n');
}

/**
 * Build the full system prompt for local LLMs with tool support
 *
 * @param {Object} options - Prompt options
 * @param {string} options.location - User's location for context
 * @param {string} options.customInstructions - Additional instructions
 * @returns {string} The system prompt
 */
function getToolSystemPrompt(options = {}) {
    const { location, customInstructions } = options;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    const toolDocs = buildToolDocs();

    const toolExamples = getToolExamples();

    let prompt = `You are a helpful voice assistant with tool capabilities.

CONTEXT:
- Date: ${dateStr}
- Time: ${timeStr}${location ? `\n- Location: ${location}` : ''}

## TOOLS

You have access to tools. When you need to use a tool, your ENTIRE response must be ONLY the JSON object — no text before or after it.

Format: {"tool": "tool_name", "args": {"param": "value"}}

Available tools:
${toolDocs}
Examples:
${toolExamples}

## IMPORTANT: HOW TO USE TOOLS

When you decide to use a tool, DO NOT say anything first. Do NOT write "Sure, let me search for that" or any other text.
Just output the raw JSON and nothing else. The system will execute the tool and give you the result, then you respond naturally.

WRONG (do not do this):
  Sure! I'll search for that. {"tool": "browser_control", "args": {"action": "search", "query": "Arsenal results"}}

CORRECT (do this):
  {"tool": "browser_control", "args": {"action": "search", "query": "Arsenal results"}}

## BROWSER CONTROL

You have a real Chrome browser you control using browser_control. This is your ONLY way to access the web.
- Use browser_control with action "search" for ANY web search — it opens Chrome and returns page content
- Use browser_control with action "open" to visit a URL and read its content
- After getting a snapshot, you can interact: click elements (ref "e1"), type text, press keys
- Example flow: search → read results → click a link (e3) → read that page

## WHEN TO USE TOOLS

- ANY question about current events, news, sports, weather, prices → browser_control search
- ANY request to look something up → browser_control search
- ANY question you're unsure about → browser_control search
- Remember something → memory_remember
- Recall past conversations → memory_search
- See the user's screen → capture_screen

## RULES

1. NEVER say "I don't have access to real-time information" — USE browser_control
2. NEVER say "I can't look that up" — USE browser_control
3. NEVER say "let me search" then give text — just output the JSON
4. Tool calls = ONLY JSON, zero other text
5. ALL replies (including after tool results) = 1-3 sentences MAX, plain speech, NO markdown, NO bullet points, NO URLs, NO numbered lists
6. After a tool result, summarize the key answer in plain spoken English — do NOT list sources or links
7. NEVER use ** bold **, * italic *, bullet points, numbered lists, or URLs in responses — everything is spoken aloud

## CONVERSATION CONTEXT

You have memory of recent exchanges. Use pronouns and context naturally:
- "What about tomorrow?" → Use context from previous query
- "And that other thing?" → Use context from previous topic`;

    if (customInstructions) {
        prompt += `\n\n## ADDITIONAL INSTRUCTIONS\n\n${customInstructions}`;
    }

    return prompt;
}

/**
 * Get a minimal system prompt without tool support (for models that struggle)
 */
function getBasicSystemPrompt(options = {}) {
    const { location, customInstructions } = options;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let prompt = `You are a helpful voice assistant. Today is ${dateStr}.${location ? ` The user is in ${location}.` : ''}

Keep responses concise (1-3 sentences) as they will be spoken aloud. No markdown or bullet points - plain speech only.`;

    if (customInstructions) {
        prompt += `\n\n${customInstructions}`;
    }

    return prompt;
}

module.exports = {
    getToolSystemPrompt,
    getBasicSystemPrompt,
    buildToolDocs
};
