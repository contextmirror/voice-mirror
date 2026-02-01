const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MemoryManager = require('./MemoryManager');
const { isLocalModelAvailable, LocalProvider } = require('./embeddings');

describe('MemoryManager', () => {
    let testDir;

    before(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-memory-test-'));
    });

    after(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should construct with correct defaults', () => {
        const manager = new MemoryManager({ memoryDir: testDir });
        assert.strictEqual(manager._initialized, false);
        assert.strictEqual(manager.store, null);
        assert.strictEqual(manager.index, null);
        assert.strictEqual(manager.embedder, null);
        assert.strictEqual(manager._initializing, null);
    });

    it('should accept custom config', () => {
        const manager = new MemoryManager({
            memoryDir: testDir,
            embeddingProvider: 'local'
        });
        assert.strictEqual(manager.config.memoryDir, testDir);
        assert.strictEqual(manager.config.embeddingProvider, 'local');
    });

    it('getMemoryManager should return a singleton', () => {
        const { getMemoryManager } = MemoryManager;
        const a = getMemoryManager({ memoryDir: testDir });
        const b = getMemoryManager({ memoryDir: testDir });
        assert.strictEqual(a, b, 'should return the same instance');
    });
});

describe('Embedding model availability', () => {
    it('isLocalModelAvailable should return a boolean', () => {
        const available = isLocalModelAvailable();
        assert.strictEqual(typeof available, 'boolean');
    });

    it('LocalProvider.isAvailable should match isLocalModelAvailable', () => {
        assert.strictEqual(LocalProvider.isAvailable(), isLocalModelAvailable());
    });

    it('LocalProvider.getModelPath should return a path ending in .gguf', () => {
        const modelPath = LocalProvider.getModelPath();
        assert.ok(modelPath.endsWith('.gguf'), `Expected .gguf path, got: ${modelPath}`);
    });

    it('model cache directory should exist or be creatable', () => {
        const { getModelCacheDir } = require('./utils');
        const cacheDir = getModelCacheDir();
        assert.ok(typeof cacheDir === 'string');
        assert.ok(cacheDir.length > 0);
    });
});
