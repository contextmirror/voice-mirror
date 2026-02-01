/**
 * Voice Mirror Memory System - Session Transcript Indexing
 * Parses Claude Code .jsonl transcript files and indexes them
 *
 * Transcripts are at: ~/.claude/projects/<project-slug>/*.jsonl
 */

const fs = require('fs').promises;
const fsSSync = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get the Claude projects directory
 * @returns {string}
 */
function getClaudeProjectsDir() {
    return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Get the project slug for a given working directory
 * @param {string} cwd - Working directory path
 * @returns {string} Project slug (e.g., '-home-user-project')
 */
function getProjectSlug(cwd) {
    return cwd.replace(/\//g, '-');
}

/**
 * List all .jsonl transcript files for a project
 * @param {string} projectDir - Path to project directory
 * @returns {Promise<Array<{path: string, size: number, mtime: number}>>}
 */
async function listTranscriptFiles(projectDir) {
    try {
        const entries = await fs.readdir(projectDir);
        const files = [];
        for (const entry of entries) {
            if (!entry.endsWith('.jsonl')) continue;
            const filePath = path.join(projectDir, entry);
            const stat = await fs.stat(filePath);
            files.push({
                path: filePath,
                size: stat.size,
                mtime: stat.mtimeMs
            });
        }
        return files;
    } catch {
        return [];
    }
}

/**
 * Extract user and assistant messages from a JSONL transcript
 * @param {string} filePath - Path to .jsonl file
 * @param {number} [fromByte=0] - Start reading from this byte offset (for delta tracking)
 * @returns {Promise<{text: string, bytesRead: number}>}
 */
async function extractTranscriptText(filePath, fromByte = 0) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const parts = [];
    let bytesProcessed = 0;

    for (const line of lines) {
        bytesProcessed += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
        if (bytesProcessed <= fromByte) continue;
        if (!line.trim()) continue;

        try {
            const record = JSON.parse(line);
            const type = record.type;

            if (type === 'user') {
                const msg = record.message;
                if (msg && typeof msg.content === 'string' && msg.content.trim()) {
                    parts.push(`User: ${msg.content.trim()}`);
                }
            } else if (type === 'assistant') {
                const msg = record.message;
                if (msg && Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === 'text' && block.text?.trim()) {
                            parts.push(`Assistant: ${block.text.trim()}`);
                        }
                    }
                }
            }
        } catch {
            // Skip malformed lines
        }
    }

    return {
        text: parts.join('\n\n'),
        bytesRead: Buffer.byteLength(content, 'utf-8')
    };
}

/**
 * Find the project directory for the current Voice Mirror session
 * @param {string} [cwd] - Override working directory
 * @returns {string|null} Path to project transcript directory, or null
 */
function findProjectTranscriptDir(cwd) {
    const projectsDir = getClaudeProjectsDir();
    if (!fsSSync.existsSync(projectsDir)) return null;

    const slug = getProjectSlug(cwd);
    const projectDir = path.join(projectsDir, slug);
    if (fsSSync.existsSync(projectDir)) return projectDir;

    return null;
}

module.exports = {
    getClaudeProjectsDir,
    getProjectSlug,
    listTranscriptFiles,
    extractTranscriptText,
    findProjectTranscriptDir
};
