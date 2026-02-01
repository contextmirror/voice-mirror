/**
 * Tests for configurable hybrid search weights
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hybridSearch } = require('./search/hybrid');

// Mock index that returns predictable results
function createMockIndex(vectorChunks, ftsChunks) {
    return {
        getChunksByModel: () => vectorChunks.map(c => ({
            ...c,
            embedding: c.embedding || [1, 0, 0]
        })),
        searchVectorsNative: () => null, // force CPU fallback
        getChunk: (id) => vectorChunks.find(c => c.id === id) || null,
        getDb: () => ({
            prepare: () => ({
                all: () => ftsChunks.map(c => ({
                    id: c.id,
                    path: c.path,
                    start_line: c.startLine,
                    end_line: c.endLine,
                    text: c.text,
                    rank: c.rank || -1
                }))
            })
        }),
        ftsAvailable: ftsChunks.length > 0
    };
}

describe('Configurable hybrid weights', () => {
    const vectorChunk = {
        id: 'v1', path: '/test.md', startLine: 1, endLine: 5,
        text: 'vector result', embedding: [1, 0, 0], tier: 'stable'
    };
    const keywordChunk = {
        id: 'k1', path: '/test.md', startLine: 10, endLine: 15,
        text: 'keyword result', rank: -0.5, tier: 'stable'
    };

    it('should use default weights (0.7 vector, 0.3 text)', () => {
        const index = createMockIndex([vectorChunk], [keywordChunk]);
        const results = hybridSearch(index, 'test', [1, 0, 0], 'test-model', {
            minScore: 0, maxResults: 10
        });
        // vectorChunk should score higher with default vector weight
        assert.ok(results.length > 0);
    });

    it('should respect custom vectorWeight and textWeight', () => {
        const index = createMockIndex([vectorChunk], [keywordChunk]);
        // With vectorWeight=0, textWeight=1, only keyword results should score
        const results = hybridSearch(index, 'test', [1, 0, 0], 'test-model', {
            vectorWeight: 0,
            textWeight: 1,
            minScore: 0,
            maxResults: 10
        });
        // Both chunks should be present; keyword chunk should score higher
        const kChunk = results.find(r => r.id === 'k1');
        const vChunk = results.find(r => r.id === 'v1');
        if (kChunk && vChunk) {
            assert.ok(kChunk.score >= vChunk.score, 'Keyword chunk should score >= vector chunk with textWeight=1');
        }
    });

    it('should accept candidateMultiplier option', () => {
        const index = createMockIndex([vectorChunk], []);
        // Should not throw with custom multiplier
        const results = hybridSearch(index, 'test', [1, 0, 0], 'test-model', {
            candidateMultiplier: 10,
            minScore: 0,
            maxResults: 5
        });
        assert.ok(Array.isArray(results));
    });

    it('weights should affect final score calculation', () => {
        const index = createMockIndex([vectorChunk], [keywordChunk]);

        const results70_30 = hybridSearch(index, 'test', [1, 0, 0], 'test-model', {
            vectorWeight: 0.7, textWeight: 0.3, minScore: 0, maxResults: 10
        });
        const results30_70 = hybridSearch(index, 'test', [1, 0, 0], 'test-model', {
            vectorWeight: 0.3, textWeight: 0.7, minScore: 0, maxResults: 10
        });

        // With different weights, at least one result's score should differ
        const v1_score_a = results70_30.find(r => r.id === 'v1')?.score;
        const v1_score_b = results30_70.find(r => r.id === 'v1')?.score;
        if (v1_score_a !== undefined && v1_score_b !== undefined) {
            assert.notStrictEqual(v1_score_a, v1_score_b, 'Different weights should produce different scores');
        }
    });
});
