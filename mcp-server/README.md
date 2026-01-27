# Voice Mirror MCP Server

Model Context Protocol (MCP) server providing 14 tools for Claude Code integration with Voice Mirror Electron.

## Quick Start

The MCP server is configured in Claude Code's settings to run automatically:

```json
{
  "mcpServers": {
    "voice-mirror-electron": {
      "command": "node",
      "args": ["/path/to/Voice Mirror Electron/mcp-server/index.js"]
    }
  }
}
```

## Tools (14 Total)

### Voice/Chat Communication

| Tool | Purpose |
|------|---------|
| `claude_send` | Send message to inbox (triggers TTS) |
| `claude_inbox` | Read messages from inbox |
| `claude_listen` | Wait for voice messages (blocking, exclusive lock) |
| `claude_status` | Presence tracking (active/idle) |

### Memory System

| Tool | Purpose |
|------|---------|
| `memory_search` | Hybrid semantic + keyword search |
| `memory_get` | Retrieve full memory content |
| `memory_remember` | Store memory (core/stable/notes tiers) |
| `memory_forget` | Delete a memory |
| `memory_stats` | Get memory statistics |

### Screen & Browser

| Tool | Purpose |
|------|---------|
| `capture_screen` | Screenshot via cosmic-screenshot or Electron |
| `browser_search` | Google search (Serper API or Playwright) |
| `browser_fetch` | Fetch URL content with JS rendering |

### Voice Cloning

| Tool | Purpose |
|------|---------|
| `clone_voice` | Clone voice from audio (URL or local file) |
| `clear_voice_clone` | Reset to default voice |
| `list_voice_clones` | List saved voice clones |

## Structure

```
mcp-server/
├── index.js                # Main server (14 tools, ~1700 lines)
├── package.json            # Dependencies
├── scripts/
│   └── download-model.js   # Embedding model downloader
└── lib/memory/             # Memory system (~2000 lines)
    ├── index.js            # Module facade
    ├── MemoryManager.js    # Orchestrator
    ├── MarkdownStore.js    # Markdown file I/O
    ├── ConversationLogger.js # Auto-log conversations
    ├── Chunker.js          # Text chunking (400 tokens)
    ├── SQLiteIndex.js      # Database operations
    ├── SessionManager.js   # Session tracking
    ├── schema.js           # SQLite schema
    ├── utils.js            # Utilities
    ├── sync.js             # File watcher
    ├── embeddings/
    │   ├── index.js        # Provider factory
    │   ├── local.js        # Local (embeddinggemma-300M)
    │   ├── openai.js       # OpenAI API
    │   └── gemini.js       # Google Gemini
    └── search/
        ├── index.js        # Search exports
        ├── hybrid.js       # 70% vector + 30% keyword
        ├── vector.js       # Cosine similarity
        └── keyword.js      # BM25 FTS5
```

## Architecture

### Communication Model

```
Claude Code (stdio) ↔ MCP Server ↔ File IPC ↔ Electron/Python
```

### File-Based IPC

All IPC uses JSON files in `~/.config/voice-mirror-electron/data/`:

| File | Purpose |
|------|---------|
| `inbox.json` | Message queue (max 100) |
| `status.json` | Instance presence |
| `listener_lock.json` | Exclusive listener mutex |
| `screen_capture_request.json` | Screenshot requests |
| `screen_capture_response.json` | Screenshot responses |
| `voice_clone_request.json` | Voice clone requests |
| `voice_clone_response.json` | Voice clone responses |
| `browser_request.json` | Web search/fetch requests |
| `browser_response.json` | Web search/fetch responses |

### Memory System

**Source of Truth**: Markdown files
- `~/.config/voice-mirror-electron/memory/MEMORY.md` - Main memory
- `~/.config/voice-mirror-electron/memory/daily/` - Conversation logs

**Index**: SQLite with FTS5
- Chunks table with embeddings
- FTS5 virtual table for keyword search
- Embedding cache by provider/model/hash

**Search**: Hybrid (70% vector + 30% keyword)
- Vector: Cosine similarity on embeddings
- Keyword: BM25 scoring via FTS5
- Automatic fallback between embedding providers

**Memory Tiers**:
| Tier | Retention | Use Case |
|------|-----------|----------|
| core | Permanent | User identity, preferences |
| stable | 7 days | Recent context, decisions |
| notes | Session | Temporary working notes |

### Embedding Providers

Auto-selected in order:
1. **Local** (embeddinggemma-300M via node-llama-cpp) - No API cost
2. **OpenAI** (text-embedding-3-small) - If OPENAI_API_KEY set
3. **Gemini** (text-embedding-004) - If GOOGLE_API_KEY set

## Dependencies

| Package | Purpose |
|---------|---------|
| @modelcontextprotocol/sdk | MCP protocol |
| better-sqlite3 | SQLite with FTS5 |
| chokidar | File watching |
| node-llama-cpp | Local embeddings (optional) |

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI embeddings |
| `GOOGLE_API_KEY` | Gemini embeddings |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Listener lock | 70s |
| Screen capture | 10s |
| Browser search | 60s |
| Browser fetch | 90s |
| Voice clone | 60s |

## Data Retention

| Data | Retention |
|------|-----------|
| Messages | 24 hours (auto-cleanup) |
| Screenshots | Last 5 (auto-cleanup) |
| Voice clones | Permanent |
| Memory (core) | Permanent |
| Memory (stable) | 7 days |
| Memory (notes) | Session |

## Development

### Run standalone
```bash
node mcp-server/index.js
```

### Download embedding model
```bash
node mcp-server/scripts/download-model.js
```

### Monitor memory
```bash
cat ~/.config/voice-mirror-electron/memory/MEMORY.md
```
