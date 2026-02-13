# electron/tools/

Tool system for local LLMs (Ollama, LM Studio, Jan) that support
function calling. Gives non-Claude providers access to screen capture,
persistent memory, browser control, and n8n workflow automation.

## Architecture

```
definitions.js  -->  index.js (ToolExecutor)  -->  handlers/*
                     parses JSON tool calls        executes actions
prompts.js           from model responses
openai-schema.js
```

1. **definitions.js** declares every tool's name, args, and validation rules.
2. **ToolExecutor** (`index.js`) detects JSON tool calls in model output,
   validates args, and routes to the matching handler with timeout protection.
3. **handlers/** contain the actual implementations.

## File index

| Module | Description |
|---|---|
| `definitions.js` | Tool schemas: names, argument specs, examples, validation |
| `index.js` | `ToolExecutor` class -- parses, validates, and dispatches tool calls |
| `prompts.js` | Builds system prompts that teach local LLMs the tool JSON format |
| `openai-schema.js` | Converts definitions to OpenAI function-calling format; streaming accumulator |
| `handlers/index.js` | Barrel re-exporting all handler functions |
| `handlers/capture-screen.js` | Screenshot capture handler |
| `handlers/memory.js` | Persistent memory CRUD (search, remember, forget, clear) |
| `handlers/browser-control.js` | Routes browser actions to the `electron/browser/` module |
| `handlers/n8n.js` | Lists and triggers n8n automation workflows |
