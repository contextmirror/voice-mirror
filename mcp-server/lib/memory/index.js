/**
 * Voice Mirror Memory System
 *
 * A standalone, Clawdbot-inspired memory system for Voice Mirror Electron.
 * Features:
 * - Markdown source of truth (MEMORY.md + daily logs)
 * - SQLite-based indexing with FTS5
 * - Hybrid search (70% vector + 30% BM25)
 * - Multiple embedding providers (local, OpenAI, Gemini)
 * - Auto-logging of all conversations
 */

const MarkdownStore = require('./MarkdownStore');
const ConversationLogger = require('./ConversationLogger');
const SQLiteIndex = require('./SQLiteIndex');
const schema = require('./schema');
const utils = require('./utils');
const embeddings = require('./embeddings');
const Chunker = require('./Chunker');
const search = require('./search');
const MemoryManager = require('./MemoryManager');
const MemorySync = require('./sync');
const SessionManager = require('./SessionManager');

module.exports = {
    // Phase 1: Storage
    MarkdownStore,
    ConversationLogger,

    // Phase 2: SQLite
    SQLiteIndex,
    schema,

    // Phase 3: Embeddings
    embeddings,
    createEmbeddingProvider: embeddings.createEmbeddingProvider,

    // Phase 4: Chunking
    Chunker,
    chunkMarkdown: Chunker.chunkMarkdown,
    smartChunk: Chunker.smartChunk,

    // Phase 5-7: Search
    search,
    hybridSearch: search.hybridSearch,
    searchWithFallback: search.searchWithFallback,

    // Phase 8: Memory Manager (orchestrator)
    MemoryManager,
    getMemoryManager: MemoryManager.getMemoryManager,

    // Phase 9: File Watcher & Sync
    MemorySync,
    startMemorySync: MemorySync.startMemorySync,

    // Phase 10: Session Management
    SessionManager,
    createSessionManager: SessionManager.createSessionManager,

    // Utils
    utils,
    getMemoryDir: utils.getMemoryDir,
    getDataDir: utils.getDataDir,

    // Singleton helpers
    getLogger: ConversationLogger.getLogger
};
