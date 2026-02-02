/**
 * Voice Mirror Memory System - Search Module
 * Exports all search functions for memory retrieval
 */

const vector = require('./vector');
const keyword = require('./keyword');
const hybrid = require('./hybrid');

module.exports = {
    // Vector search (cosine similarity)
    searchVector: vector.searchVector,

    // Keyword search (BM25/FTS5)
    searchKeyword: keyword.searchKeyword,

    // Hybrid search (70% vector + 30% keyword)
    hybridSearch: hybrid.hybridSearch,
    searchWithFallback: hybrid.searchWithFallback
};
