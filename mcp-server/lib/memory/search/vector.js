/**
 * Voice Mirror Memory System - Vector Search
 * Cosine similarity search over embedded chunks
 */

/**
 * @typedef {Object} VectorSearchResult
 * @property {string} id - Chunk ID
 * @property {string} path - Source file path
 * @property {number} startLine - Start line
 * @property {number} endLine - End line
 * @property {string} text - Chunk text
 * @property {number} score - Cosine similarity score (0-1)
 */

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Similarity score (0-1)
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dot / magnitude;
}

/**
 * Search chunks by vector similarity
 * @param {import('../SQLiteIndex')} index - SQLite index instance
 * @param {number[]} queryVector - Query embedding vector
 * @param {string} model - Embedding model name
 * @param {number} limit - Maximum results to return
 * @returns {VectorSearchResult[]}
 */
function searchVector(index, queryVector, model, limit = 10) {
    // Try native sqlite-vec search first
    const nativeResults = index.searchVectorsNative(queryVector, limit);
    if (nativeResults && nativeResults.length > 0) {
        // Native returns {id, distance}; convert distance to similarity score and hydrate chunks
        return nativeResults.map(r => {
            const chunk = index.getChunk(r.id);
            if (!chunk) return null;
            return {
                id: chunk.id,
                path: chunk.path,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                text: chunk.text,
                tier: chunk.tier,
                score: 1 / (1 + r.distance) // Convert L2 distance to 0-1 similarity
            };
        }).filter(Boolean);
    }

    // Fallback: CPU cosine similarity over all chunks
    const chunks = index.getChunksByModel(model);

    if (chunks.length === 0) {
        return [];
    }

    const scored = chunks.map(chunk => ({
        id: chunk.id,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        tier: chunk.tier,
        score: cosineSimilarity(queryVector, chunk.embedding)
    }));

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

module.exports = {
    searchVector
};
