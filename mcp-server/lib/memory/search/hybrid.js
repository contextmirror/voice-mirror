/**
 * Voice Mirror Memory System - Hybrid Search
 * Combines vector (70%) and keyword (30%) search for better results
 */

const { searchVector } = require('./vector');
const { searchKeyword } = require('./keyword');

/**
 * @typedef {Object} HybridSearchResult
 * @property {string} id - Chunk ID
 * @property {string} path - Source file path
 * @property {number} startLine - Start line
 * @property {number} endLine - End line
 * @property {string} text - Chunk text
 * @property {number} score - Combined score (0-1)
 * @property {number} vectorScore - Vector similarity score
 * @property {number} textScore - BM25 keyword score
 */

/**
 * @typedef {Object} HybridSearchOptions
 * @property {number} [maxResults=5] - Maximum results to return
 * @property {number} [minScore=0.3] - Minimum score threshold
 * @property {number} [vectorWeight=0.7] - Weight for vector search (0-1)
 * @property {number} [textWeight=0.3] - Weight for keyword search (0-1)
 * @property {number} [candidateMultiplier=4] - Multiplier for candidate pool
 */

/**
 * Perform hybrid search combining vector and keyword results
 * @param {import('../SQLiteIndex')} index - SQLite index instance
 * @param {string} query - Search query text
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {string} model - Embedding model name
 * @param {HybridSearchOptions} options
 * @returns {HybridSearchResult[]}
 */
function hybridSearch(index, query, queryEmbedding, model, options = {}) {
    const {
        maxResults = 5,
        minScore = 0.3,
        vectorWeight = 0.7,
        textWeight = 0.3,
        candidateMultiplier = 4
    } = options;

    // Get expanded candidate pool
    const candidateLimit = maxResults * candidateMultiplier;

    // Run both searches
    const vectorResults = searchVector(index, queryEmbedding, model, candidateLimit);
    const keywordResults = searchKeyword(index, query, candidateLimit);

    // Merge results by chunk ID
    const byId = new Map();

    // Add vector results
    for (const r of vectorResults) {
        byId.set(r.id, {
            id: r.id,
            path: r.path,
            startLine: r.startLine,
            endLine: r.endLine,
            text: r.text,
            vectorScore: r.score,
            textScore: 0
        });
    }

    // Merge keyword results
    for (const r of keywordResults) {
        if (byId.has(r.id)) {
            // Chunk found in both searches - add text score
            byId.get(r.id).textScore = r.score;
        } else {
            // Chunk only in keyword search
            byId.set(r.id, {
                id: r.id,
                path: r.path,
                startLine: r.startLine,
                endLine: r.endLine,
                text: r.text,
                vectorScore: 0,
                textScore: r.score
            });
        }
    }

    // Calculate combined scores with weighting
    const merged = [...byId.values()].map(entry => ({
        ...entry,
        score: vectorWeight * entry.vectorScore + textWeight * entry.textScore
    }));

    // Filter by minimum score, sort by combined score, limit results
    return merged
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

/**
 * Search with automatic fallback
 * If vector search returns no results, fall back to keyword-only
 * @param {import('../SQLiteIndex')} index
 * @param {string} query
 * @param {number[] | null} queryEmbedding - May be null if embedding failed
 * @param {string} model
 * @param {HybridSearchOptions} options
 * @returns {HybridSearchResult[]}
 */
function searchWithFallback(index, query, queryEmbedding, model, options = {}) {
    const { maxResults = 5, minScore = 0.3 } = options;

    // If we have an embedding, try hybrid search
    if (queryEmbedding && queryEmbedding.length > 0) {
        const results = hybridSearch(index, query, queryEmbedding, model, options);

        // If hybrid search found results, return them
        if (results.length > 0) {
            return results;
        }
    }

    // Fallback to keyword-only search
    const keywordResults = searchKeyword(index, query, maxResults);

    return keywordResults
        .filter(r => r.score >= minScore)
        .map(r => ({
            ...r,
            vectorScore: 0,
            textScore: r.score
        }));
}

module.exports = {
    hybridSearch,
    searchWithFallback
};
