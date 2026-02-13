/**
 * Voice Mirror Memory System - Text Chunker
 * Splits markdown text into chunks for embedding
 *
 * Default: 400 tokens per chunk with 80 token overlap
 */

const { sha256, estimateTokens } = require('./utils');

/**
 * @typedef {Object} Chunk
 * @property {string} text - Chunk text content
 * @property {number} startLine - Starting line number (1-indexed)
 * @property {number} endLine - Ending line number (1-indexed)
 * @property {string} hash - SHA-256 hash of text
 * @property {number} tokens - Estimated token count
 */

/**
 * @typedef {Object} ChunkerOptions
 * @property {number} [tokens=400] - Target tokens per chunk
 * @property {number} [overlap=80] - Overlap tokens between chunks
 * @property {boolean} [preserveBoundaries=true] - Try to break at section headers
 */

/**
 * Chunk markdown text into smaller pieces
 * @param {string} content - Markdown content to chunk
 * @param {ChunkerOptions} options
 * @returns {Chunk[]}
 */
function chunkMarkdown(content, options = {}) {
    const { tokens = 400, overlap = 80, preserveBoundaries = true } = options;

    if (!content || content.trim().length === 0) {
        return [];
    }

    const lines = content.split('\n');
    const chunks = [];

    // Track current chunk state
    let currentLines = [];
    let currentTokens = 0;
    let chunkStartLine = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTokens = estimateTokens(line + '\n');
        const lineNum = i + 1; // 1-indexed

        // Check if we should start a new chunk
        const wouldExceed = currentTokens + lineTokens > tokens && currentLines.length > 0;
        const isNewSection = preserveBoundaries && line.startsWith('## ') && currentLines.length > 0;

        if (wouldExceed || isNewSection) {
            // Save current chunk
            const chunkText = currentLines.join('\n');
            if (chunkText.trim().length > 0) {
                chunks.push({
                    text: chunkText,
                    startLine: chunkStartLine,
                    endLine: lineNum - 1,
                    hash: sha256(chunkText),
                    tokens: currentTokens
                });
            }

            // Calculate overlap - keep last N tokens worth of lines
            const overlapResult = getOverlapLines(currentLines, overlap);
            currentLines = overlapResult.lines;
            currentTokens = overlapResult.tokens;
            chunkStartLine = lineNum - currentLines.length;
        }

        // Add line to current chunk
        currentLines.push(line);
        currentTokens += lineTokens;
    }

    // Don't forget the last chunk
    if (currentLines.length > 0) {
        const chunkText = currentLines.join('\n');
        if (chunkText.trim().length > 0) {
            chunks.push({
                text: chunkText,
                startLine: chunkStartLine,
                endLine: lines.length,
                hash: sha256(chunkText),
                tokens: currentTokens
            });
        }
    }

    return chunks;
}

/**
 * Get overlap lines from the end of current chunk
 * @param {string[]} lines - Current chunk lines
 * @param {number} targetOverlapTokens - Target overlap in tokens
 * @returns {{lines: string[], tokens: number}}
 */
function getOverlapLines(lines, targetOverlapTokens) {
    if (lines.length === 0 || targetOverlapTokens <= 0) {
        return { lines: [], tokens: 0 };
    }

    const result = [];
    let totalTokens = 0;

    // Work backwards from end
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const lineTokens = estimateTokens(line + '\n');

        if (totalTokens + lineTokens > targetOverlapTokens && result.length > 0) {
            break;
        }

        result.unshift(line);
        totalTokens += lineTokens;
    }

    return { lines: result, tokens: totalTokens };
}

/**
 * Chunk a conversation log file
 * Each conversation exchange becomes a chunk
 * @param {string} content - Daily log content
 * @returns {Chunk[]}
 */
function chunkConversationLog(content) {
    if (!content || content.trim().length === 0) {
        return [];
    }

    const chunks = [];
    const lines = content.split('\n');

    let currentExchange = [];
    let exchangeStartLine = 1;
    let inExchange = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Detect exchange headers (## HH:MM)
        if (line.match(/^## \d{2}:\d{2}/)) {
            // Save previous exchange
            if (currentExchange.length > 0 && inExchange) {
                const text = currentExchange.join('\n');
                if (text.trim().length > 0) {
                    chunks.push({
                        text,
                        startLine: exchangeStartLine,
                        endLine: lineNum - 1,
                        hash: sha256(text),
                        tokens: estimateTokens(text)
                    });
                }
            }

            // Start new exchange
            currentExchange = [line];
            exchangeStartLine = lineNum;
            inExchange = true;
        } else if (inExchange) {
            currentExchange.push(line);
        }
    }

    // Don't forget last exchange
    if (currentExchange.length > 0 && inExchange) {
        const text = currentExchange.join('\n');
        if (text.trim().length > 0) {
            chunks.push({
                text,
                startLine: exchangeStartLine,
                endLine: lines.length,
                hash: sha256(text),
                tokens: estimateTokens(text)
            });
        }
    }

    return chunks;
}

/**
 * Smart chunking based on file type
 * @param {string} content - File content
 * @param {string} filePath - File path (to determine type)
 * @param {ChunkerOptions} options
 * @returns {Chunk[]}
 */
function smartChunk(content, filePath, options = {}) {
    // Daily logs get conversation-aware chunking
    if (filePath.includes('/daily/') || filePath.match(/\d{4}-\d{2}-\d{2}\.md$/)) {
        const conversationChunks = chunkConversationLog(content);

        // If exchanges are too large, fall back to standard chunking
        const maxTokens = options.tokens || 400;
        const needsRechunking = conversationChunks.some(c => c.tokens > maxTokens * 1.5);

        if (needsRechunking) {
            return chunkMarkdown(content, options);
        }

        return conversationChunks;
    }

    // Everything else gets standard markdown chunking
    return chunkMarkdown(content, options);
}

module.exports = {
    chunkMarkdown,
    chunkConversationLog,
    smartChunk,
    getOverlapLines
};
