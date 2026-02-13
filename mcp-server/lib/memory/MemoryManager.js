/**
 * Voice Mirror Memory System - Memory Manager
 * Main orchestrator that ties together all memory components
 *
 * Features:
 * - Lazy initialization (only loads on first search)
 * - Embedding provider with auto-fallback
 * - Hash-based incremental indexing
 * - Hybrid search (70% vector + 30% BM25)
 */

const path = require('path');
const MarkdownStore = require('./MarkdownStore');
const SQLiteIndex = require('./SQLiteIndex');
const Chunker = require('./Chunker');
const { createEmbeddingProvider, isLocalModelAvailable, LocalProvider } = require('./embeddings');
const { hybridSearch, searchWithFallback } = require('./search/hybrid');
const { searchKeyword } = require('./search/keyword');
const { getMemoryDir, generateId, runWithConcurrency, sha256 } = require('./utils');


/**
 * @typedef {Object} MemoryManagerConfig
 * @property {string} [memoryDir] - Override memory directory
 * @property {string} [embeddingProvider='auto'] - 'auto' | 'local' | 'openai' | 'gemini'
 * @property {string} [openaiApiKey] - OpenAI API key
 * @property {string} [geminiApiKey] - Gemini API key
 * @property {Object} [chunking] - Chunking options
 * @property {number} [chunking.tokens=400] - Target tokens per chunk
 * @property {number} [chunking.overlap=80] - Overlap tokens
 * @property {Object} [search] - Search options
 * @property {number} [search.maxResults=5] - Max search results
 * @property {number} [search.minScore=0.3] - Min relevance score
 * @property {number} [search.vectorWeight=0.7] - Vector search weight
 * @property {number} [search.textWeight=0.3] - Text search weight
 */

class MemoryManager {
    /**
     * @param {MemoryManagerConfig} config
     */
    constructor(config = {}) {
        this.config = {
            memoryDir: config.memoryDir || getMemoryDir(),
            embeddingProvider: config.embeddingProvider || 'auto',
            embeddingFallback: config.embeddingFallback || 'openai',
            openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
            geminiApiKey: config.geminiApiKey || process.env.GOOGLE_API_KEY,
            extraPaths: config.extraPaths || [],
            chunking: {
                tokens: config.chunking?.tokens || 400,
                overlap: config.chunking?.overlap || 80
            },
            search: {
                maxResults: config.search?.maxResults || 5,
                minScore: config.search?.minScore || 0.3,
                vectorWeight: config.search?.vectorWeight || 0.7,
                textWeight: config.search?.textWeight || 0.3
            }
        };

        this.store = null;
        this.index = null;
        this.embedder = null;
        this._initialized = false;
        this._initializing = null;
    }

    /**
     * Lazy initialization - called on first operation
     */
    async init() {
        if (this._initialized) return;

        // Prevent double initialization
        if (this._initializing) {
            return this._initializing;
        }

        this._initializing = (async () => {
            // Initialize markdown store
            this.store = new MarkdownStore(this.config.memoryDir, {
                extraPaths: this.config.extraPaths
            });
            await this.store.init();

            // Initialize SQLite index
            const dbPath = path.join(this.config.memoryDir, 'index.db');
            this.index = new SQLiteIndex(dbPath);
            await this.index.init();

            // Auto-download local embedding model if not present
            if (!isLocalModelAvailable()) {
                console.error('[Memory] Local embedding model not found. Downloading embeddinggemma-300M (~300MB)...');
                try {
                    await LocalProvider.downloadModel((progress) => {
                        if (progress % 10 === 0) {
                            console.error(`[Memory] Download progress: ${progress}%`);
                        }
                    });
                    console.error('[Memory] Embedding model downloaded successfully');
                } catch (dlErr) {
                    console.error(`[Memory] Failed to download embedding model: ${dlErr.message}`);
                }
            }

            // Initialize embedding provider (local.js has 30s timeout to prevent hangs)
            try {
                const result = await createEmbeddingProvider({
                    provider: this.config.embeddingProvider,
                    fallback: this.config.embeddingFallback,
                    openaiApiKey: this.config.openaiApiKey,
                    geminiApiKey: this.config.geminiApiKey
                });
                this.embedder = result.provider || result;
                const id = this.embedder.id || 'unknown';
                const model = this.embedder.model || 'unknown';
                console.error(`[Memory] Using embedding provider: ${id}/${model}`);
            } catch (err) {
                console.error(`[Memory] Warning: No embedding provider available: ${err.message}`);
                console.error('[Memory] Falling back to keyword-only search');
                this.embedder = null;
            }

            // Cleanup expired memories before indexing
            try {
                const removed = await this.store.cleanupExpiredMemories(this.config.ttl);
                if (removed > 0) {
                    console.error(`[Memory] Cleaned up ${removed} expired memories`);
                }
            } catch (err) {
                console.error(`[Memory] TTL cleanup error: ${err.message}`);
            }

            // Initialize vector table if sqlite-vec available
            if (this.embedder && this.index.vectorReady) {
                this.index.initVectorTable(this.embedder.dimensions);
            }

            // Check if full reindex needed (provider/model/chunking changed)
            if (this.embedder) {
                const currentMeta = {
                    provider: this.embedder.id,
                    model: this.embedder.model,
                    chunkTokens: this.config.chunking.tokens,
                    chunkOverlap: this.config.chunking.overlap
                };
                if (this.index.needsFullReindex(currentMeta)) {
                    console.error('[Memory] Config changed, triggering full reindex');
                    this.index.clearAll();
                    if (this.index.vectorReady) {
                        this.index.initVectorTable(this.embedder.dimensions);
                    }
                }
                this.index.updateIndexMeta(currentMeta);
            }

            // Index all files on first load
            await this.syncAllFiles();

            this._initialized = true;
        })();

        return this._initializing;
    }

    /**
     * Sync all markdown files to the index
     */
    async syncAllFiles() {
        // Skip if called during init (avoid deadlock - init() calls syncAllFiles())
        // External callers should call init() first
        if (!this.store || !this.index) return;

        const files = await this.store.listMemoryFiles();
        let indexed = 0;
        let skipped = 0;

        // Collect all chunks that need indexing
        const pendingChunks = [];

        for (const file of files) {
            const fileMeta = await this.store.readFileWithMeta(file.path);

            if (!this.index.needsReindex(file.path, fileMeta.hash)) {
                skipped++;
                continue;
            }

            const chunks = Chunker.smartChunk(fileMeta.content, file.path, this.config.chunking);
            const tier = file.type === 'memory' ? 'stable' : 'volatile';

            for (const chunk of chunks) {
                pendingChunks.push({ filePath: file.path, chunk, tier });
            }

            // Update file metadata (tracking only, chunks indexed below)
            this.index.upsertFile(file.path, fileMeta.hash, fileMeta.mtime, fileMeta.size);
            indexed++;
        }

        // Batch embed and index chunks
        if (pendingChunks.length > 0 && this.embedder) {
            // Check cache first, collect uncached texts
            const uncachedIndices = [];
            const embeddings = new Array(pendingChunks.length).fill(null);

            for (let i = 0; i < pendingChunks.length; i++) {
                const { chunk } = pendingChunks[i];
                const cached = this.index.getCachedEmbedding(
                    this.embedder.id, this.embedder.model, chunk.hash
                );
                if (cached) {
                    embeddings[i] = cached;
                } else {
                    uncachedIndices.push(i);
                }
            }

            // Batch embed uncached chunks (groups of 32)
            if (uncachedIndices.length > 0 && this.embedder.embedBatch) {
                const batchSize = 32;
                const batchTasks = [];
                for (let b = 0; b < uncachedIndices.length; b += batchSize) {
                    const batchIndices = uncachedIndices.slice(b, b + batchSize);
                    batchTasks.push(async () => {
                        const texts = batchIndices.map(i => pendingChunks[i].chunk.text);
                        try {
                            const batchResults = await this.embedder.embedBatch(texts);
                            for (let j = 0; j < batchIndices.length; j++) {
                                const idx = batchIndices[j];
                                embeddings[idx] = batchResults[j];
                                // Cache it
                                this.index.cacheEmbedding(
                                    this.embedder.id, this.embedder.model,
                                    pendingChunks[idx].chunk.hash, batchResults[j]
                                );
                            }
                        } catch (err) {
                            console.error(`[Memory] Batch embedding error: ${err.message}`);
                        }
                    });
                }
                try {
                    await runWithConcurrency(batchTasks, 4);
                } catch (err) {
                    console.error(`[Memory] Concurrent batch embedding error: ${err.message}`);
                }
            }

            // Store all chunks (with or without embeddings)
            const model = this.embedder ? `${this.embedder.id}/${this.embedder.model}` : 'none';
            for (let i = 0; i < pendingChunks.length; i++) {
                const { filePath, chunk, tier } = pendingChunks[i];
                this.index.upsertChunk({
                    id: generateId('chunk'),
                    path: filePath,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    hash: chunk.hash,
                    model,
                    text: chunk.text,
                    embedding: embeddings[i],
                    tier
                });
            }
        } else if (pendingChunks.length > 0) {
            // No embedder — store chunks without embeddings
            for (const { filePath, chunk, tier } of pendingChunks) {
                this.index.upsertChunk({
                    id: generateId('chunk'),
                    path: filePath,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    hash: chunk.hash,
                    model: 'none',
                    text: chunk.text,
                    embedding: null,
                    tier
                });
            }
        }

        console.error(`[Memory] Indexed ${indexed} files (${pendingChunks.length} chunks), skipped ${skipped} unchanged`);
    }

    /**
     * Index a single chunk
     * @param {string} filePath
     * @param {Object} chunk
     * @param {string} tier
     */
    async indexChunk(filePath, chunk, tier = 'stable') {
        const chunkId = generateId('chunk');
        let embedding = null;
        let model = 'none';

        // Get embedding if provider available
        if (this.embedder) {
            // Check cache first
            const cached = this.index.getCachedEmbedding(
                this.embedder.id,
                this.embedder.model,
                chunk.hash
            );

            if (cached) {
                embedding = cached;
            } else {
                try {
                    embedding = await this.embedder.embedQuery(chunk.text);
                    // Cache the embedding
                    this.index.cacheEmbedding(
                        this.embedder.id,
                        this.embedder.model,
                        chunk.hash,
                        embedding,
                        this.embedder.dimensions
                    );
                } catch (err) {
                    console.error(`[Memory] Embedding failed for chunk: ${err.message}`);
                }
            }
            model = `${this.embedder.id}/${this.embedder.model}`;
        }

        // Store chunk in index
        this.index.upsertChunk({
            id: chunkId,
            path: filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            hash: chunk.hash,
            model: model,
            text: chunk.text,
            embedding: embedding,
            tier: tier
        });
    }

    /**
     * Search memories
     * @param {string} query - Search query
     * @param {Object} options
     * @returns {Promise<Array>} Search results
     */
    async search(query, options = {}) {
        await this.init();

        const searchOpts = {
            maxResults: options.maxResults || this.config.search.maxResults,
            minScore: options.minScore ?? this.config.search.minScore,
            vectorWeight: options.vectorWeight ?? this.config.search.vectorWeight,
            textWeight: options.textWeight ?? this.config.search.textWeight,
            candidateMultiplier: options.candidateMultiplier ?? 5
        };

        let queryEmbedding = null;
        let model = 'none';

        // Get query embedding if available
        if (this.embedder) {
            try {
                queryEmbedding = await this.embedder.embedQuery(query);
                model = `${this.embedder.id}/${this.embedder.model}`;
            } catch (err) {
                console.error(`[Memory] Query embedding failed: ${err.message}`);
            }
        }

        // Perform hybrid or fallback search
        const results = searchWithFallback(
            this.index,
            query,
            queryEmbedding,
            model,
            searchOpts
        );

        return results;
    }

    /**
     * Get full content of a chunk or file
     * @param {string} pathOrId - File path or chunk ID
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async get(pathOrId, options = {}) {
        await this.init();

        const { fromLine, lines } = options;

        // Check if it's a chunk ID
        if (pathOrId.startsWith('chunk_')) {
            const db = this.index.getDb();
            const chunk = db.prepare('SELECT * FROM chunks WHERE id = ?').get(pathOrId);

            if (chunk) {
                return {
                    type: 'chunk',
                    id: chunk.id,
                    path: chunk.path,
                    startLine: chunk.start_line,
                    endLine: chunk.end_line,
                    text: chunk.text,
                    tier: chunk.tier
                };
            }
        }

        // It's a file path
        if (fromLine) {
            const content = await this.store.readLines(pathOrId, fromLine, lines);
            return {
                type: 'file_excerpt',
                path: pathOrId,
                fromLine,
                lines: lines || 'all',
                content
            };
        }

        const data = await this.store.readFileWithMeta(pathOrId);
        return {
            type: 'file',
            path: pathOrId,
            content: data.content,
            hash: data.hash,
            size: data.size
        };
    }

    /**
     * Remember something (add to MEMORY.md)
     * @param {string} content - What to remember
     * @param {string} tier - 'core' | 'stable' | 'notes'
     * @returns {Promise<Object>}
     */
    async remember(content, tier = 'stable') {
        await this.init();

        // Append to MEMORY.md
        await this.store.appendMemory(content, tier);

        // Re-index MEMORY.md
        const memoryFile = this.store.memoryFile;
        const fileMeta = await this.store.readFileWithMeta(memoryFile);
        const chunks = Chunker.chunkMarkdown(fileMeta.content, this.config.chunking);

        // Clear old chunks for this file and re-index
        const db = this.index.getDb();
        db.prepare('DELETE FROM chunks WHERE path = ?').run(memoryFile);

        for (const chunk of chunks) {
            await this.indexChunk(memoryFile, chunk, tier);
        }

        this.index.upsertFile(memoryFile, fileMeta.hash, fileMeta.mtime, fileMeta.size);

        return {
            success: true,
            tier,
            content: content.slice(0, 100) + (content.length > 100 ? '...' : '')
        };
    }

    /**
     * Forget a memory (delete from MEMORY.md)
     * @param {string} contentOrId - Memory content or chunk ID
     * @returns {Promise<Object>}
     */
    async forget(contentOrId) {
        await this.init();

        // If it's a chunk ID, get the content first
        let content = contentOrId;
        if (contentOrId.startsWith('chunk_')) {
            const chunk = await this.get(contentOrId);
            if (chunk) {
                // Extract the memory line from the chunk text
                const lines = chunk.text.split('\n');
                const memoryLine = lines.find(l => l.startsWith('- '));
                if (memoryLine) {
                    content = memoryLine.slice(2).replace(/\s*<!--.*-->/, '').trim();
                }
            }
        }

        // Delete from MEMORY.md
        const deleted = await this.store.deleteMemory(content);

        if (deleted) {
            // Re-index MEMORY.md
            const memoryFile = this.store.memoryFile;
            const fileMeta = await this.store.readFileWithMeta(memoryFile);

            const db = this.index.getDb();
            db.prepare('DELETE FROM chunks WHERE path = ?').run(memoryFile);

            const chunks = Chunker.chunkMarkdown(fileMeta.content, this.config.chunking);
            for (const chunk of chunks) {
                await this.indexChunk(memoryFile, chunk, 'stable');
            }

            this.index.upsertFile(memoryFile, fileMeta.hash, fileMeta.mtime, fileMeta.size);
        }

        return {
            success: deleted,
            content: content.slice(0, 100) + (content.length > 100 ? '...' : '')
        };
    }

    /**
     * Get memory system statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        await this.init();

        const storeStats = await this.store.getStats();
        const indexStats = this.index.getStats();

        return {
            storage: storeStats,
            index: indexStats,
            embedding: this.embedder ? {
                provider: this.embedder.id,
                model: this.embedder.model,
                dimensions: this.embedder.dimensions
            } : null,
            config: {
                memoryDir: this.config.memoryDir,
                chunking: this.config.chunking,
                search: this.config.search
            }
        };
    }

    /**
     * Flush important context to MEMORY.md before compaction
     * Called by Claude Code before context window compaction
     * @param {Object} context - Session context to preserve
     * @param {string[]} [context.topics] - Key topics discussed
     * @param {string[]} [context.decisions] - Decisions made
     * @param {string[]} [context.actionItems] - Action items / TODOs
     * @param {string} [context.summary] - Overall session summary
     * @returns {Promise<{flushed: number}>}
     */
    async flushBeforeCompaction(context = {}) {
        await this.init();

        let flushed = 0;

        // Write decisions as core memories (they're important long-term)
        if (context.decisions?.length > 0) {
            for (const decision of context.decisions) {
                await this.store.appendMemory(`Decision: ${decision}`, 'core');
                flushed++;
            }
        }

        // Write summary and topics as stable memories
        if (context.summary) {
            await this.store.appendMemory(`Session summary: ${context.summary}`, 'stable');
            flushed++;
        }

        if (context.topics?.length > 0) {
            await this.store.appendMemory(`Topics discussed: ${context.topics.join(', ')}`, 'stable');
            flushed++;
        }

        // Write action items as notes (short-lived reminders)
        if (context.actionItems?.length > 0) {
            for (const item of context.actionItems) {
                await this.store.appendMemory(`TODO: ${item}`, 'notes');
                flushed++;
            }
        }

        // Re-index MEMORY.md after flush
        if (flushed > 0) {
            const memoryFile = this.store.memoryFile;
            const fileMeta = await this.store.readFileWithMeta(memoryFile);
            const chunks = Chunker.chunkMarkdown(fileMeta.content, this.config.chunking);

            this.index.deleteChunksForFile(memoryFile);
            for (const chunk of chunks) {
                await this.indexChunk(memoryFile, chunk, 'stable');
            }
            this.index.upsertFile(memoryFile, fileMeta.hash, fileMeta.mtime, fileMeta.size);
        }

        return { flushed };
    }

    /**
     * Close the memory manager (cleanup)
     */
    close() {
        if (this.index) {
            this.index.close();
        }
        this._initialized = false;
        this._initializing = null;
    }
}

// Singleton instance for MCP tools
let _instance = null;

/**
 * Get or create the singleton MemoryManager instance
 * @param {MemoryManagerConfig} config
 * @returns {MemoryManager}
 */
function getMemoryManager(config = {}) {
    if (!_instance) {
        _instance = new MemoryManager(config);
    }
    return _instance;
}

module.exports = MemoryManager;
module.exports.getMemoryManager = getMemoryManager;
