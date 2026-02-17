const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('API key auto-detection', () => {
    const detectorSource = fs.readFileSync(
        path.join(__dirname, '../../electron/services/provider-detector.js'), 'utf-8'
    );

    it('provider-detector.js should export detectApiKeys', () => {
        assert.ok(
            detectorSource.includes('detectApiKeys'),
            'Should contain detectApiKeys function'
        );
        assert.ok(
            detectorSource.includes("module.exports") &&
            detectorSource.includes('detectApiKeys'),
            'Should export detectApiKeys'
        );
    });

    it('detectApiKeys should check environment variables', () => {
        assert.ok(
            detectorSource.includes('process.env[provider.apiKeyEnv]'),
            'Should read from process.env using apiKeyEnv'
        );
    });

    it('detectApiKeys should check Claude CLI credentials', () => {
        assert.ok(
            detectorSource.includes('.claude') &&
            detectorSource.includes('.credentials.json'),
            'Should check ~/.claude/.credentials.json'
        );
    });

    it('detectApiKeys should skip keys shorter than 8 chars', () => {
        assert.ok(
            detectorSource.includes('envVal.length > 8'),
            'Should validate minimum key length'
        );
    });

    it('detectApiKeys should prefix metadata with underscore', () => {
        assert.ok(
            detectorSource.includes('_claudeCliAuth'),
            'Should use underscore prefix for metadata flags'
        );
    });
});

describe('API key detection - environment variable integration', () => {
    // Actually test the function with mocked env vars
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        // Restore env
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key];
        }
        Object.assign(process.env, originalEnv);
    });

    it('should detect OPENAI_API_KEY from environment', () => {
        process.env.OPENAI_API_KEY = 'sk-test-key-123456789';
        const { detectApiKeys } = require('../../electron/services/provider-detector');
        const detected = detectApiKeys();
        assert.equal(detected.openai, 'sk-test-key-123456789');
    });

    it('should detect multiple keys simultaneously', () => {
        process.env.OPENAI_API_KEY = 'sk-test-openai-123';
        process.env.GROQ_API_KEY = 'gsk-test-groq-456';
        const { detectApiKeys } = require('../../electron/services/provider-detector');
        const detected = detectApiKeys();
        assert.ok(detected.openai);
        assert.ok(detected.groq);
    });

    it('should ignore short/empty env values', () => {
        process.env.OPENAI_API_KEY = 'short';
        const { detectApiKeys } = require('../../electron/services/provider-detector');
        const detected = detectApiKeys();
        assert.equal(detected.openai, undefined);
    });

    it('should not crash on missing credentials file', () => {
        const { detectApiKeys } = require('../../electron/services/provider-detector');
        // Should not throw
        const detected = detectApiKeys();
        assert.ok(typeof detected === 'object');
    });
});

describe('API key detection - main.js integration', () => {
    const mainSource = fs.readFileSync(
        path.join(__dirname, '../../electron/main.js'), 'utf-8'
    );

    it('main.js should call detectApiKeys on startup', () => {
        assert.ok(
            mainSource.includes('detectApiKeys'),
            'main.js should reference detectApiKeys'
        );
    });

    it('main.js should only fill null keys (not overwrite)', () => {
        assert.ok(
            mainSource.includes('!currentKeys[provider]'),
            'Should check key is null before overwriting'
        );
    });

    it('main.js should skip metadata flags (underscore prefix)', () => {
        assert.ok(
            mainSource.includes("!k.startsWith('_')"),
            'Should filter out underscore-prefixed metadata'
        );
    });
});

describe('API key detection - IPC and preload', () => {
    const ipcSource = fs.readFileSync(
        path.join(__dirname, '../../electron/ipc/voice.js'), 'utf-8'
    );
    const preloadSource = fs.readFileSync(
        path.join(__dirname, '../../electron/preload.js'), 'utf-8'
    );

    it('should have get-detected-keys IPC handler', () => {
        assert.ok(
            ipcSource.includes('get-detected-keys'),
            'ipc/voice.js should handle get-detected-keys'
        );
    });

    it('IPC handler should not send actual key values to renderer', () => {
        // The handler should return Object.keys (names only)
        assert.ok(
            ipcSource.includes('Object.keys(detected)'),
            'Should return only key names, not values'
        );
    });

    it('preload should expose getDetectedKeys', () => {
        assert.ok(
            preloadSource.includes('getDetectedKeys'),
            'preload.js should expose getDetectedKeys'
        );
    });
});
