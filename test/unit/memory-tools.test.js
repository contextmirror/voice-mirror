/**
 * Tests for memory_forget and memory_clear tool handlers.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('memory-tools', () => {
    let tmpDir;
    let originalGetDataDir;
    let config;
    let memoryHandlers;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-tools-test-'));
        config = require('../../electron/config');
        originalGetDataDir = config.getDataDir;
        config.getDataDir = () => tmpDir;
        memoryHandlers = require('../../electron/tools/handlers/memory');
    });

    afterEach(() => {
        config.getDataDir = originalGetDataDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeMemoryFile(tier, memories) {
        const filePath = path.join(tmpDir, `memory_${tier}.json`);
        fs.writeFileSync(filePath, JSON.stringify({
            memories,
            metadata: { tier, created: new Date().toISOString() }
        }, null, 2));
    }

    function readMemoryFile(tier) {
        const filePath = path.join(tmpDir, `memory_${tier}.json`);
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')).memories || [];
    }

    it('memoryForget deletes matching memories', async () => {
        writeMemoryFile('notes', [
            { id: 'mem-1', content: 'User tested responses twice' },
            { id: 'mem-2', content: 'User prefers dark mode' }
        ]);

        const result = await memoryHandlers.memoryForget({ content: 'tested responses' });
        assert.equal(result.success, true);
        assert.ok(result.result.includes('1 memory'));

        const remaining = readMemoryFile('notes');
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].content, 'User prefers dark mode');
    });

    it('memoryForget searches across all tiers', async () => {
        writeMemoryFile('core', [{ id: 'mem-1', content: 'likes pizza' }]);
        writeMemoryFile('stable', [{ id: 'mem-2', content: 'likes pizza a lot' }]);
        writeMemoryFile('notes', [{ id: 'mem-3', content: 'something else' }]);

        const result = await memoryHandlers.memoryForget({ content: 'pizza' });
        assert.equal(result.success, true);
        assert.ok(result.result.includes('2 memory'));

        assert.equal(readMemoryFile('core').length, 0);
        assert.equal(readMemoryFile('stable').length, 0);
        assert.equal(readMemoryFile('notes').length, 1);
    });

    it('memoryForget returns message when no match', async () => {
        writeMemoryFile('notes', [{ id: 'mem-1', content: 'hello world' }]);

        const result = await memoryHandlers.memoryForget({ content: 'nonexistent' });
        assert.equal(result.success, true);
        assert.ok(result.result.includes('No memories found'));
    });

    it('memoryForget requires content', async () => {
        const result = await memoryHandlers.memoryForget({});
        assert.equal(result.success, false);
    });

    it('memoryClear clears all tiers', async () => {
        writeMemoryFile('core', [{ id: 'mem-1', content: 'a' }]);
        writeMemoryFile('stable', [{ id: 'mem-2', content: 'b' }, { id: 'mem-3', content: 'c' }]);
        writeMemoryFile('notes', [{ id: 'mem-4', content: 'd' }]);

        const result = await memoryHandlers.memoryClear({ tier: 'all' });
        assert.equal(result.success, true);
        assert.ok(result.result.includes('4 memory'));

        assert.equal(readMemoryFile('core').length, 0);
        assert.equal(readMemoryFile('stable').length, 0);
        assert.equal(readMemoryFile('notes').length, 0);
    });

    it('memoryClear clears only specified tier', async () => {
        writeMemoryFile('core', [{ id: 'mem-1', content: 'keep this' }]);
        writeMemoryFile('notes', [{ id: 'mem-2', content: 'clear this' }]);

        const result = await memoryHandlers.memoryClear({ tier: 'notes' });
        assert.equal(result.success, true);

        assert.equal(readMemoryFile('core').length, 1);
        assert.equal(readMemoryFile('notes').length, 0);
    });

    it('memoryClear defaults to all', async () => {
        writeMemoryFile('stable', [{ id: 'mem-1', content: 'a' }]);

        const result = await memoryHandlers.memoryClear({});
        assert.equal(result.success, true);
        assert.equal(readMemoryFile('stable').length, 0);
    });

    it('memoryClear rejects invalid tier', async () => {
        const result = await memoryHandlers.memoryClear({ tier: 'invalid' });
        assert.equal(result.success, false);
    });
});
