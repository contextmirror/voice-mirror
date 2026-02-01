/**
 * Memory system handlers: memory_search, memory_get, memory_remember, memory_forget, memory_stats
 */

const { getMemoryManager } = require('../lib/memory/MemoryManager');

/**
 * memory_search - Hybrid semantic + keyword search
 */
async function handleMemorySearch(args) {
    try {
        const query = args?.query;
        const maxResults = args?.max_results || 5;
        const minScore = args?.min_score || 0.3;

        if (!query) {
            return {
                content: [{ type: 'text', text: 'Error: query is required' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const results = await manager.search(query, { maxResults, minScore });

        if (results.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: `No memories found for: "${query}"`
                }]
            };
        }

        const formatted = results.map((r, i) => {
            const scoreInfo = `[score: ${r.score.toFixed(2)} | vec: ${r.vectorScore.toFixed(2)} | kw: ${r.textScore.toFixed(2)}]`;
            const location = `${r.path}:${r.startLine}-${r.endLine}`;
            const preview = r.text.length > 200 ? r.text.slice(0, 200) + '...' : r.text;
            return `${i + 1}. ${scoreInfo}\n   ID: ${r.id}\n   Location: ${location}\n   ---\n   ${preview.split('\n').join('\n   ')}`;
        }).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `=== Memory Search: "${query}" ===\nFound ${results.length} result(s)\n\n${formatted}`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_get - Get full content of chunk or file
 */
async function handleMemoryGet(args) {
    try {
        const pathOrId = args?.path;
        const fromLine = args?.from_line;
        const lines = args?.lines;

        if (!pathOrId) {
            return {
                content: [{ type: 'text', text: 'Error: path is required' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const result = await manager.get(pathOrId, { fromLine, lines });

        if (result.type === 'chunk') {
            return {
                content: [{
                    type: 'text',
                    text: `=== Chunk: ${result.id} ===\n` +
                          `Path: ${result.path}\n` +
                          `Lines: ${result.startLine}-${result.endLine}\n` +
                          `Tier: ${result.tier}\n` +
                          `---\n${result.text}`
                }]
            };
        } else if (result.type === 'file_excerpt') {
            return {
                content: [{
                    type: 'text',
                    text: `=== File Excerpt: ${result.path} ===\n` +
                          `From line ${result.fromLine} (${result.lines} lines)\n` +
                          `---\n${result.content}`
                }]
            };
        } else {
            return {
                content: [{
                    type: 'text',
                    text: `=== File: ${result.path} ===\n` +
                          `Size: ${result.size} bytes\n` +
                          `Hash: ${result.hash.slice(0, 8)}...\n` +
                          `---\n${result.content}`
                }]
            };
        }
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_remember - Store a new memory
 */
async function handleMemoryRemember(args) {
    try {
        const content = args?.content;
        const tier = args?.tier || 'stable';

        if (!content) {
            return {
                content: [{ type: 'text', text: 'Error: content is required' }],
                isError: true
            };
        }

        if (!['core', 'stable', 'notes'].includes(tier)) {
            return {
                content: [{ type: 'text', text: 'Error: tier must be core, stable, or notes' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const result = await manager.remember(content, tier);

        return {
            content: [{
                type: 'text',
                text: `Memory saved to ${tier} tier:\n"${result.content}"`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_forget - Delete a memory
 */
async function handleMemoryForget(args) {
    try {
        const contentOrId = args?.content_or_id;

        if (!contentOrId) {
            return {
                content: [{ type: 'text', text: 'Error: content_or_id is required' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const result = await manager.forget(contentOrId);

        if (result.success) {
            return {
                content: [{
                    type: 'text',
                    text: `Memory deleted:\n"${result.content}"`
                }]
            };
        } else {
            return {
                content: [{
                    type: 'text',
                    text: `Memory not found: "${result.content}"`
                }]
            };
        }
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_stats - Get memory system statistics
 */
async function handleMemoryStats(args) {
    try {
        const manager = getMemoryManager();
        const stats = await manager.getStats();

        const output = [
            '=== Voice Mirror Memory Stats ===',
            '',
            '## Storage',
            `Memory file: ${stats.storage.memoryFile}`,
            `Daily logs: ${stats.storage.dailyLogs} files`,
            `Total conversations: ${stats.storage.conversations}`,
            `Memories: ${stats.storage.memories.total} (core: ${stats.storage.memories.core}, stable: ${stats.storage.memories.stable}, notes: ${stats.storage.memories.notes})`,
            '',
            '## Index',
            `Database: ${stats.index.dbPath}`,
            `Total chunks: ${stats.index.totalChunks}`,
            `Indexed files: ${stats.index.totalFiles}`,
            `Cached embeddings: ${stats.index.cachedEmbeddings}`,
            `FTS available: ${stats.index.ftsAvailable}`,
            '',
            '## Embedding',
            stats.embedding
                ? `Provider: ${stats.embedding.provider}/${stats.embedding.model} (${stats.embedding.dimensions} dims)`
                : 'Provider: none (keyword search only)',
            '',
            '## Config',
            `Chunking: ${stats.config.chunking.tokens} tokens, ${stats.config.chunking.overlap} overlap`,
            `Search: ${stats.config.search.vectorWeight * 100}% vector + ${stats.config.search.textWeight * 100}% keyword`
        ].join('\n');

        return {
            content: [{ type: 'text', text: output }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_flush - Flush context to persistent memory before compaction
 */
async function handleMemoryFlush(args) {
    try {
        const manager = getMemoryManager();
        const result = await manager.flushBeforeCompaction({
            topics: args?.topics,
            decisions: args?.decisions,
            actionItems: args?.action_items,
            summary: args?.summary
        });

        return {
            content: [{
                type: 'text',
                text: `Flushed ${result.flushed} item(s) to persistent memory before compaction.`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

module.exports = {
    handleMemorySearch,
    handleMemoryGet,
    handleMemoryRemember,
    handleMemoryForget,
    handleMemoryStats,
    handleMemoryFlush
};
