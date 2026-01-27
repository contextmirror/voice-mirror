# Ideas

## Dynamic MCP Tool Loading/Unloading

**Problem:** MCP tool definitions are injected into the system prompt and consume context on every turn. With 40+ tools (browser control, n8n, memory, voice, etc.), this is a significant overhead — especially for large tool sets like n8n which has ~20 definitions alone.

**Proposal:** Implement dynamic tool group loading and unloading in the MCP server.

### Core Tools (Always Loaded)
These are essential for basic operation and should always be registered:
- `claude_send` — Send spoken responses
- `claude_listen` — Wait for voice input
- `claude_inbox` — Read inbox messages
- `claude_status` — Presence tracking

### Dynamically Loadable Tool Groups
Everything else gets organized into groups that load on demand:
- **browser** — `browser_start`, `browser_stop`, `browser_open`, `browser_navigate`, `browser_screenshot`, `browser_snapshot`, `browser_act`, `browser_tabs`, `browser_close_tab`, `browser_focus`, `browser_console`, `browser_search`, `browser_fetch`
- **memory** — `memory_search`, `memory_remember`, `memory_get`, `memory_forget`, `memory_stats`
- **screen** — `capture_screen`
- **voice-clone** — `clone_voice`, `clear_voice_clone`, `list_voice_clones`
- **n8n** — All n8n workflow creation/management tools (when connected)

### How It Works
1. MCP server starts with only core tools registered.
2. A meta-tool `load_tools` is always available. Claude calls `load_tools({ group: "browser" })` when it needs browser capabilities.
3. Server registers the requested tool group and sends a `tools/list_changed` notification per the MCP spec.
4. Claude Code client re-fetches the tool list and sees the new tools.
5. After use, Claude calls `unload_tools({ group: "browser" })` to remove them.
6. Server unregisters the group and sends another `tools/list_changed` notification.
7. Future turns have a smaller system prompt since the definitions are gone.

### Benefits
- Base context stays lean (only ~4 core tool definitions)
- Tool groups load only when needed
- Unloading after use reduces context on subsequent turns
- Scales to many tool groups without bloating every conversation

### Notes
- Unloading won't remove tool calls/results already in conversation history, but it does shrink the system prompt for future turns.
- The MCP protocol already supports `tools/list_changed` notifications, so the client-side mechanism exists.
- Could add a `list_tool_groups` meta-tool so Claude can discover what's available without loading everything.
