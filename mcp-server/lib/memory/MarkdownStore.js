/**
 * Voice Mirror Memory System - Markdown Store
 * Handles reading/writing MEMORY.md and daily conversation logs
 *
 * Markdown is the source of truth - SQLite is a derived index
 */

const fs = require('fs').promises;
const path = require('path');
const { getMemoryDir, getTodayDate, getCurrentTime, sha256 } = require('./utils');

// Default MEMORY.md template
const MEMORY_TEMPLATE = `# Voice Mirror Memory

## Core (Permanent)
<!-- Add permanent memories here - these are never automatically deleted -->

## Stable (7 days)
<!-- Add important memories here - auto-cleanup after 7 days of no access -->

## Notes
<!-- Add any notes or temporary memories here -->
`;

class MarkdownStore {
    constructor(memoryDir = null, options = {}) {
        this.memoryDir = memoryDir || getMemoryDir();
        this.dailyDir = path.join(this.memoryDir, 'daily');
        this.memoryFile = path.join(this.memoryDir, 'MEMORY.md');
        this.extraPaths = options.extraPaths || [];
        this._initialized = false;
    }

    /**
     * Initialize the memory directory structure
     */
    async init() {
        if (this._initialized) return;

        // Create directories
        await fs.mkdir(this.memoryDir, { recursive: true });
        await fs.mkdir(this.dailyDir, { recursive: true });

        // Create MEMORY.md if it doesn't exist
        try {
            await fs.access(this.memoryFile);
        } catch {
            await fs.writeFile(this.memoryFile, MEMORY_TEMPLATE, 'utf-8');
        }

        this._initialized = true;
    }

    /**
     * Read MEMORY.md content
     * @returns {Promise<{content: string, hash: string}>}
     */
    async readMemory() {
        await this.init();
        const content = await fs.readFile(this.memoryFile, 'utf-8');
        return {
            content,
            hash: sha256(content),
            path: this.memoryFile
        };
    }

    /**
     * Write content to MEMORY.md
     * @param {string} content - New content
     */
    async writeMemory(content) {
        await this.init();
        await fs.writeFile(this.memoryFile, content, 'utf-8');
    }

    /**
     * Append a memory to the appropriate section in MEMORY.md
     * @param {string} memory - Memory text to add
     * @param {string} tier - 'core' | 'stable' | 'notes'
     */
    async appendMemory(memory, tier = 'stable') {
        await this.init();
        const { content } = await this.readMemory();

        const sectionHeaders = {
            core: '## Core (Permanent)',
            stable: '## Stable (7 days)',
            notes: '## Notes'
        };

        const header = sectionHeaders[tier] || sectionHeaders.stable;
        const timestamp = new Date().toISOString();
        const memoryLine = `- ${memory} <!-- ${timestamp} -->`;

        // Find the section and append after it
        const lines = content.split('\n');
        const headerIndex = lines.findIndex(line => line.startsWith(header));

        if (headerIndex === -1) {
            // Section not found, append at end
            lines.push('', header, memoryLine);
        } else {
            // Find the next section or end of file
            let insertIndex = headerIndex + 1;

            // Skip comment lines immediately after header
            while (insertIndex < lines.length && lines[insertIndex].startsWith('<!--')) {
                insertIndex++;
            }

            // Skip empty lines
            while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
                insertIndex++;
            }

            // Find where to insert (before next section or end)
            let endIndex = insertIndex;
            while (endIndex < lines.length && !lines[endIndex].startsWith('## ')) {
                endIndex++;
            }

            // Insert before next section (or at end of section's content)
            lines.splice(endIndex, 0, memoryLine);
        }

        await this.writeMemory(lines.join('\n'));
    }

    /**
     * Get the path to today's daily log
     * @returns {string} Path to today's log file
     */
    getDailyLogPath(date = null) {
        const dateStr = date || getTodayDate();
        return path.join(this.dailyDir, `${dateStr}.md`);
    }

    /**
     * Read a daily log file
     * @param {string} date - Date in YYYY-MM-DD format (default: today)
     * @returns {Promise<{content: string, hash: string, path: string} | null>}
     */
    async readDailyLog(date = null) {
        await this.init();
        const logPath = this.getDailyLogPath(date);

        try {
            const content = await fs.readFile(logPath, 'utf-8');
            return {
                content,
                hash: sha256(content),
                path: logPath
            };
        } catch {
            return null;
        }
    }

    /**
     * Create or get today's daily log
     * @returns {Promise<string>} Content of today's log
     */
    async ensureDailyLog() {
        await this.init();
        const logPath = this.getDailyLogPath();
        const date = getTodayDate();

        try {
            await fs.access(logPath);
            return await fs.readFile(logPath, 'utf-8');
        } catch {
            // Create new daily log
            const header = `# ${date}\n\n`;
            await fs.writeFile(logPath, header, 'utf-8');
            return header;
        }
    }

    /**
     * Append a conversation exchange to today's daily log
     * @param {Object} exchange - Conversation exchange
     * @param {string} exchange.userMessage - User's message
     * @param {string} exchange.assistantResponse - Assistant's response
     * @param {string} [exchange.imagePath] - Optional screenshot path
     * @param {Object} [exchange.metadata] - Optional metadata
     */
    async appendConversation(exchange) {
        await this.init();
        await this.ensureDailyLog();

        const logPath = this.getDailyLogPath();
        const time = getCurrentTime();

        let entry = `\n## ${time}\n`;

        if (exchange.imagePath) {
            entry += `**User:** [Screenshot: ${path.basename(exchange.imagePath)}]\n`;
        }

        entry += `**User:** ${exchange.userMessage}\n`;
        entry += `**Claude:** ${exchange.assistantResponse}\n`;

        if (exchange.metadata) {
            const metaStr = JSON.stringify(exchange.metadata);
            entry += `<!-- metadata: ${metaStr} -->\n`;
        }

        await fs.appendFile(logPath, entry, 'utf-8');
    }

    /**
     * List all memory files (MEMORY.md + daily logs)
     * @returns {Promise<Array<{path: string, type: string}>>}
     */
    async listMemoryFiles() {
        await this.init();
        const files = [];

        // Add MEMORY.md
        try {
            await fs.access(this.memoryFile);
            files.push({ path: this.memoryFile, type: 'memory' });
        } catch {
            // MEMORY.md doesn't exist yet
        }

        // Add daily logs
        try {
            const dailyFiles = await fs.readdir(this.dailyDir);
            for (const file of dailyFiles) {
                if (file.endsWith('.md')) {
                    files.push({
                        path: path.join(this.dailyDir, file),
                        type: 'daily'
                    });
                }
            }
        } catch {
            // Daily dir doesn't exist yet
        }

        // Add extra paths (skip symlinks for safety)
        for (const extraPath of this.extraPaths) {
            try {
                const stat = await fs.lstat(extraPath);
                if (stat.isSymbolicLink()) continue;
                if (stat.isFile() && extraPath.endsWith('.md')) {
                    files.push({ path: extraPath, type: 'extra' });
                } else if (stat.isDirectory()) {
                    const dirFiles = await fs.readdir(extraPath);
                    for (const file of dirFiles) {
                        if (!file.endsWith('.md')) continue;
                        const filePath = path.join(extraPath, file);
                        const fileStat = await fs.lstat(filePath);
                        if (fileStat.isSymbolicLink()) continue;
                        if (fileStat.isFile()) {
                            files.push({ path: filePath, type: 'extra' });
                        }
                    }
                }
            } catch {
                // Extra path doesn't exist or not accessible
            }
        }

        return files;
    }

    /**
     * Read a file with metadata
     * @param {string} filePath - Path to file
     * @returns {Promise<{content: string, hash: string, mtime: number, size: number}>}
     */
    async readFileWithMeta(filePath) {
        const [content, stat] = await Promise.all([
            fs.readFile(filePath, 'utf-8'),
            fs.stat(filePath)
        ]);

        return {
            content,
            hash: sha256(content),
            mtime: stat.mtimeMs,
            size: stat.size
        };
    }

    /**
     * Read specific lines from a file
     * @param {string} filePath - Path to file
     * @param {number} fromLine - Starting line (1-indexed)
     * @param {number} numLines - Number of lines to read
     * @returns {Promise<string>}
     */
    async readLines(filePath, fromLine = 1, numLines = null) {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        const start = Math.max(0, fromLine - 1);
        const end = numLines ? start + numLines : lines.length;

        return lines.slice(start, end).join('\n');
    }

    /**
     * Parse MEMORY.md to extract memories by tier
     * @returns {Promise<{core: string[], stable: string[], notes: string[]}>}
     */
    async parseMemoryTiers() {
        const { content } = await this.readMemory();
        const lines = content.split('\n');

        const tiers = {
            core: [],
            stable: [],
            notes: []
        };

        let currentTier = null;

        for (const line of lines) {
            if (line.startsWith('## Core')) {
                currentTier = 'core';
            } else if (line.startsWith('## Stable')) {
                currentTier = 'stable';
            } else if (line.startsWith('## Notes')) {
                currentTier = 'notes';
            } else if (line.startsWith('## ')) {
                currentTier = null; // Unknown section
            } else if (currentTier && line.startsWith('- ')) {
                // Extract memory text, removing timestamp comment
                const memory = line.slice(2).replace(/\s*<!--[\s\S]*?-->/g, '').trim();
                if (memory) {
                    tiers[currentTier].push(memory);
                }
            }
        }

        return tiers;
    }

    /**
     * Parse MEMORY.md to extract memories with their timestamps
     * @returns {Promise<{core: Array, stable: Array, notes: Array}>}
     */
    async parseMemoryTiersWithDates() {
        const { content } = await this.readMemory();
        const lines = content.split('\n');

        const tiers = { core: [], stable: [], notes: [] };
        let currentTier = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('## Core')) {
                currentTier = 'core';
            } else if (line.startsWith('## Stable')) {
                currentTier = 'stable';
            } else if (line.startsWith('## Notes')) {
                currentTier = 'notes';
            } else if (line.startsWith('## ')) {
                currentTier = null;
            } else if (currentTier && line.startsWith('- ')) {
                const timestampMatch = line.match(/<!--\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s*-->/);
                const savedAt = timestampMatch ? new Date(timestampMatch[1]) : null;
                const text = line.slice(2).replace(/\s*<!--[\s\S]*?-->/g, '').trim();
                if (text) {
                    tiers[currentTier].push({ text, savedAt, lineIndex: i });
                }
            }
        }

        return tiers;
    }

    /**
     * Remove expired memories from MEMORY.md
     * @param {Object} [ttl] - TTL config in milliseconds
     * @param {number} [ttl.stable=604800000] - Stable tier TTL (default 7 days)
     * @param {number} [ttl.notes=86400000] - Notes tier TTL (default 24 hours)
     * @returns {Promise<number>} Number of memories removed
     */
    async cleanupExpiredMemories(ttl = {}) {
        const stableTtl = ttl.stable ?? 7 * 24 * 60 * 60 * 1000;  // 7 days
        const notesTtl = ttl.notes ?? 24 * 60 * 60 * 1000;         // 24 hours
        const now = Date.now();

        const tiers = await this.parseMemoryTiersWithDates();
        const expiredLines = new Set();

        for (const entry of tiers.stable) {
            if (entry.savedAt && (now - entry.savedAt.getTime()) > stableTtl) {
                expiredLines.add(entry.lineIndex);
            }
        }

        for (const entry of tiers.notes) {
            if (entry.savedAt && (now - entry.savedAt.getTime()) > notesTtl) {
                expiredLines.add(entry.lineIndex);
            }
        }

        if (expiredLines.size === 0) return 0;

        const { content } = await this.readMemory();
        const lines = content.split('\n');
        const newLines = lines.filter((_, i) => !expiredLines.has(i));
        await this.writeMemory(newLines.join('\n'));

        return expiredLines.size;
    }

    /**
     * Delete a memory from MEMORY.md by content match
     * @param {string} memoryContent - Content to match and delete
     * @returns {Promise<boolean>} True if deleted
     */
    async deleteMemory(memoryContent) {
        const { content } = await this.readMemory();
        const lines = content.split('\n');

        const normalizedTarget = memoryContent.toLowerCase().trim();
        let deleted = false;

        const newLines = lines.filter(line => {
            if (!line.startsWith('- ')) return true;

            const memory = line.slice(2).replace(/\s*<!--[\s\S]*?-->/g, '').trim();
            if (memory.toLowerCase() === normalizedTarget) {
                deleted = true;
                return false;
            }
            return true;
        });

        if (deleted) {
            await this.writeMemory(newLines.join('\n'));
        }

        return deleted;
    }

    /**
     * Get statistics about stored memories
     * @returns {Promise<Object>}
     */
    async getStats() {
        await this.init();

        const files = await this.listMemoryFiles();
        const tiers = await this.parseMemoryTiers();

        // Count daily log entries
        let totalConversations = 0;
        for (const file of files) {
            if (file.type === 'daily') {
                const content = await fs.readFile(file.path, 'utf-8');
                // Count ## HH:MM headers
                totalConversations += (content.match(/^## \d{2}:\d{2}/gm) || []).length;
            }
        }

        return {
            memoryFile: this.memoryFile,
            dailyDir: this.dailyDir,
            totalFiles: files.length,
            dailyLogs: files.filter(f => f.type === 'daily').length,
            memories: {
                core: tiers.core.length,
                stable: tiers.stable.length,
                notes: tiers.notes.length,
                total: tiers.core.length + tiers.stable.length + tiers.notes.length
            },
            conversations: totalConversations
        };
    }
}

module.exports = MarkdownStore;
