/**
 * Voice Mirror Memory System - SQLite Index
 * Handles all database operations for the memory index
 */

const path = require('path');
const fs = require('fs');
const { getMemoryDir, sha256 } = require('./utils');
const { ensureSchema, getIndexMeta, setIndexMeta, dropAllData } = require('./schema');
const { loadSqliteVecExtension, ensureVectorTable, getVectorTableDimensions, upsertVector, deleteVector, searchVectors } = require('./sqlite-vec');

class SQLiteIndex {
    /**
     * @param {string} [dbPath] - Path to SQLite database
     */
    constructor(dbPath = null) {
        this.dbPath = dbPath || path.join(getMemoryDir(), 'index.db');
        this.db = null;
        this.ftsAvailable = false;
        this.vectorReady = false;
        this._initialized = false;
    }

    /**
     * Initialize the database
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return;

        // Ensure directory exists
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Load better-sqlite3
        const Database = require('better-sqlite3');
        this.db = new Database(this.dbPath);

        // Enable WAL mode for better performance
        this.db.pragma('journal_mode = WAL');

        // Create schema
        const { ftsAvailable } = ensureSchema(this.db);
        this.ftsAvailable = ftsAvailable;

        // Try loading sqlite-vec for native vector search
        const vecResult = loadSqliteVecExtension({ db: this.db });
        if (vecResult.ok) {
            this.vectorReady = true;
        }

        this._initialized = true;
    }

    /**
     * Initialize the vector table for a given dimension
     * @param {number} dimensions - Embedding vector dimensions
     */
    initVectorTable(dimensions) {
        if (!this.vectorReady) return;

        const currentDims = getVectorTableDimensions(this.db);
        if (currentDims !== dimensions) {
            ensureVectorTable(this.db, dimensions);
        }
    }

    /**
     * Close the database
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this._initialized = false;
    }

    /**
     * Check if a file needs reindexing
     * @param {string} filePath - Path to file
     * @param {string} hash - Current file hash
     * @returns {boolean} True if reindex needed
     */
    needsReindex(filePath, hash) {
        const row = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(filePath);
        return !row || row.hash !== hash;
    }

    /**
     * Upsert file tracking record
     * @param {string} filePath
     * @param {string} hash
     * @param {number} mtime
     * @param {number} size
     */
    upsertFile(filePath, hash, mtime, size) {
        this.db.prepare(`
            INSERT INTO files (path, hash, mtime, size)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                hash = excluded.hash,
                mtime = excluded.mtime,
                size = excluded.size
        `).run(filePath, hash, mtime, size);
    }

    /**
     * Delete file and its chunks
     * @param {string} filePath
     */
    deleteFile(filePath) {
        // Delete vectors for this file's chunks
        if (this.vectorReady) {
            try {
                const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(filePath);
                for (const { id } of chunkIds) {
                    deleteVector(this.db, id);
                }
            } catch { /* vector table may not exist */ }
        }

        // Delete from FTS first
        if (this.ftsAvailable) {
            try {
                this.db.prepare('DELETE FROM chunks_fts WHERE path = ?').run(filePath);
            } catch {
                // FTS might fail
            }
        }

        // Delete chunks
        this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);

        // Delete file record
        this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
    }

    /**
     * Get all tracked file paths
     * @returns {string[]}
     */
    getTrackedFiles() {
        const rows = this.db.prepare('SELECT path FROM files').all();
        return rows.map(r => r.path);
    }

    /**
     * Insert or update a chunk
     * @param {Object} chunk
     * @param {string} chunk.id
     * @param {string} chunk.path
     * @param {number} chunk.startLine
     * @param {number} chunk.endLine
     * @param {string} chunk.hash
     * @param {string} chunk.model
     * @param {string} chunk.text
     * @param {number[]} chunk.embedding
     * @param {string} [chunk.tier='stable']
     */
    upsertChunk(chunk) {
        const now = Date.now();
        const embeddingJson = JSON.stringify(chunk.embedding);

        this.db.prepare(`
            INSERT INTO chunks (id, path, start_line, end_line, hash, model, text, embedding, tier, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                hash = excluded.hash,
                model = excluded.model,
                text = excluded.text,
                embedding = excluded.embedding,
                tier = excluded.tier,
                updated_at = excluded.updated_at
        `).run(
            chunk.id,
            chunk.path,
            chunk.startLine,
            chunk.endLine,
            chunk.hash,
            chunk.model,
            chunk.text,
            embeddingJson,
            chunk.tier || 'stable',
            now
        );

        // Update vector index
        if (this.vectorReady && chunk.embedding && chunk.embedding.length > 0) {
            try {
                upsertVector(this.db, chunk.id, chunk.embedding);
            } catch (err) {
                // Vector table may not be initialized yet for this dimension
            }
        }

        // Update FTS
        if (this.ftsAvailable) {
            try {
                // Delete existing FTS entry
                this.db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunk.id);

                // Insert new FTS entry
                this.db.prepare(`
                    INSERT INTO chunks_fts (text, id, path, start_line, end_line)
                    VALUES (?, ?, ?, ?, ?)
                `).run(chunk.text, chunk.id, chunk.path, chunk.startLine, chunk.endLine);
            } catch (err) {
                console.warn('FTS update failed:', err.message);
            }
        }
    }

    /**
     * Delete chunks for a file (before reindexing)
     * @param {string} filePath
     */
    deleteChunksForFile(filePath) {
        // Delete vectors
        if (this.vectorReady) {
            try {
                const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(filePath);
                for (const { id } of chunkIds) {
                    deleteVector(this.db, id);
                }
            } catch { /* vector table may not exist */ }
        }

        if (this.ftsAvailable) {
            try {
                this.db.prepare('DELETE FROM chunks_fts WHERE path = ?').run(filePath);
            } catch {
                // FTS might fail
            }
        }

        this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
    }

    /**
     * Get a chunk by ID
     * @param {string} id
     * @returns {Object | null}
     */
    getChunk(id) {
        const row = this.db.prepare(`
            SELECT id, path, start_line as startLine, end_line as endLine,
                   hash, model, text, embedding, tier, updated_at as updatedAt
            FROM chunks WHERE id = ?
        `).get(id);

        if (!row) return null;

        return {
            ...row,
            embedding: JSON.parse(row.embedding)
        };
    }

    /**
     * Get all chunks for a model
     * @param {string} model - Embedding model name
     * @returns {Array<Object>}
     */
    getChunksByModel(model) {
        const rows = this.db.prepare(`
            SELECT id, path, start_line as startLine, end_line as endLine,
                   hash, model, text, embedding, tier
            FROM chunks WHERE model = ?
        `).all(model);

        return rows.map(row => ({
            ...row,
            embedding: JSON.parse(row.embedding)
        }));
    }

    /**
     * Check embedding cache
     * @param {string} provider
     * @param {string} model
     * @param {string} textHash
     * @returns {number[] | null}
     */
    getCachedEmbedding(provider, model, textHash) {
        const row = this.db.prepare(`
            SELECT embedding FROM embedding_cache
            WHERE provider = ? AND model = ? AND text_hash = ?
        `).get(provider, model, textHash);

        if (!row) return null;

        return JSON.parse(row.embedding);
    }

    /**
     * Cache an embedding
     * @param {string} provider
     * @param {string} model
     * @param {string} textHash
     * @param {number[]} embedding
     */
    cacheEmbedding(provider, model, textHash, embedding) {
        const now = Date.now();
        const embeddingJson = JSON.stringify(embedding);

        this.db.prepare(`
            INSERT INTO embedding_cache (provider, model, text_hash, embedding, dims, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, model, text_hash) DO UPDATE SET
                embedding = excluded.embedding,
                dims = excluded.dims,
                updated_at = excluded.updated_at
        `).run(provider, model, textHash, embeddingJson, embedding.length, now);
    }

    /**
     * Batch check embedding cache
     * @param {string} provider
     * @param {string} model
     * @param {string[]} textHashes
     * @returns {Map<string, number[]>}
     */
    getCachedEmbeddingsBatch(provider, model, textHashes) {
        const result = new Map();
        if (textHashes.length === 0) return result;

        // Process in batches to avoid SQLite parameter limits
        const batchSize = 100;
        for (let i = 0; i < textHashes.length; i += batchSize) {
            const batch = textHashes.slice(i, i + batchSize);
            const placeholders = batch.map(() => '?').join(', ');

            const rows = this.db.prepare(`
                SELECT text_hash, embedding FROM embedding_cache
                WHERE provider = ? AND model = ? AND text_hash IN (${placeholders})
            `).all(provider, model, ...batch);

            for (const row of rows) {
                result.set(row.text_hash, JSON.parse(row.embedding));
            }
        }

        return result;
    }

    /**
     * Prune old embedding cache entries
     * @param {number} maxEntries - Maximum entries to keep
     */
    pruneEmbeddingCache(maxEntries = 10000) {
        const count = this.db.prepare('SELECT COUNT(*) as c FROM embedding_cache').get().c;

        if (count <= maxEntries) return;

        const toDelete = count - maxEntries;
        this.db.prepare(`
            DELETE FROM embedding_cache WHERE rowid IN (
                SELECT rowid FROM embedding_cache
                ORDER BY updated_at ASC
                LIMIT ?
            )
        `).run(toDelete);
    }

    /**
     * Get index statistics
     * @returns {Object}
     */
    getStats() {
        const fileCount = this.db.prepare('SELECT COUNT(*) as c FROM files').get().c;
        const chunkCount = this.db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
        const cacheCount = this.db.prepare('SELECT COUNT(*) as c FROM embedding_cache').get().c;

        const tierCounts = {};
        const tierRows = this.db.prepare('SELECT tier, COUNT(*) as c FROM chunks GROUP BY tier').all();
        for (const row of tierRows) {
            tierCounts[row.tier] = row.c;
        }

        const modelCounts = {};
        const modelRows = this.db.prepare('SELECT model, COUNT(*) as c FROM chunks GROUP BY model').all();
        for (const row of modelRows) {
            modelCounts[row.model] = row.c;
        }

        return {
            dbPath: this.dbPath,
            files: fileCount,
            chunks: chunkCount,
            cacheEntries: cacheCount,
            ftsAvailable: this.ftsAvailable,
            vectorReady: this.vectorReady,
            byTier: tierCounts,
            byModel: modelCounts,
            indexMeta: getIndexMeta(this.db)
        };
    }

    /**
     * Check if full reindex is needed
     * @param {Object} currentMeta - Current embedding provider/model info
     * @returns {boolean}
     */
    needsFullReindex(currentMeta) {
        const stored = getIndexMeta(this.db);
        if (!stored) return true;

        return stored.provider !== currentMeta.provider ||
               stored.model !== currentMeta.model ||
               stored.chunkTokens !== currentMeta.chunkTokens ||
               stored.chunkOverlap !== currentMeta.chunkOverlap;
    }

    /**
     * Update index metadata after reindex
     * @param {Object} meta
     */
    updateIndexMeta(meta) {
        setIndexMeta(this.db, meta);
    }

    /**
     * Clear all data for full reindex
     */
    clearAll() {
        if (this.vectorReady) {
            try {
                this.db.exec('DROP TABLE IF EXISTS chunks_vec');
            } catch { /* ignore */ }
        }
        dropAllData(this.db);
    }

    /**
     * Run a transaction
     * @param {Function} fn - Function to run in transaction
     * @returns {*} Result of fn
     */
    transaction(fn) {
        return this.db.transaction(fn)();
    }

    /**
     * Native vector search using sqlite-vec
     * @param {number[]} queryVector - Query embedding
     * @param {number} limit - Max results
     * @returns {Array<{id: string, distance: number}>|null} Results or null if not available
     */
    searchVectorsNative(queryVector, limit) {
        if (!this.vectorReady) return null;
        try {
            return searchVectors(this.db, queryVector, limit);
        } catch {
            return null;
        }
    }

    /**
     * Get database instance (for advanced queries)
     * @returns {import('better-sqlite3').Database}
     */
    getDb() {
        return this.db;
    }
}

module.exports = SQLiteIndex;
