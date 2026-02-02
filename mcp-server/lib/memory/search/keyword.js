/**
 * Voice Mirror Memory System - Keyword Search (BM25)
 * Full-text search using SQLite FTS5
 */

/**
 * @typedef {Object} KeywordSearchResult
 * @property {string} id - Chunk ID
 * @property {string} path - Source file path
 * @property {number} startLine - Start line
 * @property {number} endLine - End line
 * @property {string} text - Chunk text (or snippet)
 * @property {number} score - BM25 score (normalized 0-1)
 * @property {number} rank - Raw BM25 rank
 */

/**
 * Build FTS5 query from natural language
 * Converts "hello world" to '"hello" AND "world"'
 * @param {string} query - Natural language query
 * @returns {string | null} FTS5 query or null if invalid
 */
function buildFtsQuery(query) {
    if (!query || typeof query !== 'string') {
        return null;
    }

    // Extract alphanumeric tokens
    const tokens = query.match(/[A-Za-z0-9_]+/g);

    if (!tokens || tokens.length === 0) {
        return null;
    }

    // Quote each token and join with AND
    const quoted = tokens.map(t => `"${t.replace(/"/g, '')}"`);
    return quoted.join(' AND ');
}

/**
 * Convert BM25 rank to normalized score (0-1)
 * BM25 rank is negative (more negative = better match)
 * @param {number} rank - Raw BM25 rank
 * @returns {number} Normalized score (0-1)
 */
function bm25RankToScore(rank) {
    // BM25 returns negative values, more negative = better match
    // Convert to positive score where higher = better
    const normalized = Number.isFinite(rank) ? Math.max(0, -rank) : 0;
    return 1 / (1 + normalized);
}

/**
 * Search chunks using FTS5 keyword matching
 * @param {import('../SQLiteIndex')} index - SQLite index instance
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {KeywordSearchResult[]}
 */
function searchKeyword(index, query, limit = 10) {
    if (!index.ftsAvailable) {
        return [];
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
        return [];
    }

    const db = index.getDb();

    try {
        const results = db.prepare(`
            SELECT
                id,
                path,
                start_line as startLine,
                end_line as endLine,
                text,
                bm25(chunks_fts) as rank
            FROM chunks_fts
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(ftsQuery, limit);

        return results.map(row => ({
            id: row.id,
            path: row.path,
            startLine: row.startLine,
            endLine: row.endLine,
            text: row.text,
            rank: row.rank,
            score: bm25RankToScore(row.rank)
        }));
    } catch (err) {
        console.warn('FTS search failed:', err.message);
        return [];
    }
}

module.exports = {
    searchKeyword
};
