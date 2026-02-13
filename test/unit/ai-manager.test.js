const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createAIManager } = require('../../electron/services/ai-manager');

// Mock claude-spawner — override require cache
const originalRequire = module.constructor.prototype.require;
let mockClaudeRunning = false;
let mockClaudeAvailable = true;
let spawnCount = 0;
let stopCount = 0;

// We can't easily mock require, so test the exported functions' behavior
// through the createAIManager factory with controlled config

describe('ai-manager', () => {
    let events;
    let manager;

    function makeManager(providerType = 'ollama') {
        events = { outputs: [], voiceEvents: [], providerSwitches: 0 };
        manager = createAIManager({
            getConfig: () => ({
                ai: {
                    provider: providerType,
                    model: 'llama3.1:8b',
                    endpoints: { ollama: 'http://127.0.0.1:11434' },
                    contextLength: 32768
                }
            }),
            onOutput: (data) => events.outputs.push(data),
            onVoiceEvent: (event) => events.voiceEvents.push(event),
            onProviderSwitch: () => events.providerSwitches++
        });
        return manager;
    }

    it('should create manager with all expected methods', () => {
        const mgr = makeManager();
        assert.strictEqual(typeof mgr.start, 'function');
        assert.strictEqual(typeof mgr.stop, 'function');
        assert.strictEqual(typeof mgr.isRunning, 'function');
        assert.strictEqual(typeof mgr.sendTextInput, 'function');
        assert.strictEqual(typeof mgr.sendRawInputData, 'function');
        assert.strictEqual(typeof mgr.resize, 'function');
        assert.strictEqual(typeof mgr.getProvider, 'function');
        assert.strictEqual(typeof mgr.getDisplayName, 'function');
        assert.strictEqual(typeof mgr.supportsTools, 'function');
    });

    it('should report not running when freshly created', () => {
        const mgr = makeManager();
        assert.strictEqual(mgr.isRunning(), false);
    });

    it('should return "None" display name when nothing is running', () => {
        const mgr = makeManager();
        assert.strictEqual(mgr.getDisplayName(), 'None');
    });

    it('stop() should return false when nothing is running', () => {
        const mgr = makeManager();
        const result = mgr.stop();
        assert.strictEqual(result, false);
    });

    it('stop() should not fire providerSwitch when nothing was running', () => {
        const mgr = makeManager();
        mgr.stop();
        assert.strictEqual(events.providerSwitches, 0);
    });

    it('stop() should not fire voice events when nothing was running', () => {
        const mgr = makeManager();
        mgr.stop();
        const disconnects = events.voiceEvents.filter(e => e.type === 'claude_disconnected');
        assert.strictEqual(disconnects.length, 0);
    });

    it('supportsTools returns false when nothing is running', () => {
        const mgr = makeManager();
        assert.strictEqual(mgr.supportsTools(), false);
    });

    it('sendTextInput returns false when nothing is running', () => {
        const mgr = makeManager();
        assert.strictEqual(mgr.sendTextInput('hello'), false);
    });

    it('getProvider returns null when nothing is running', () => {
        const mgr = makeManager();
        assert.strictEqual(mgr.getProvider(), null);
    });

    it('consecutive stops should be safe (idempotent)', () => {
        const mgr = makeManager();
        mgr.stop();
        mgr.stop();
        mgr.stop();
        assert.strictEqual(events.providerSwitches, 0);
    });
});
