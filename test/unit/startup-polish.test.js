const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Startup polish - provider flash fix', () => {
    const stateSource = fs.readFileSync(
        path.join(__dirname, '../../electron/renderer/state.js'), 'utf-8'
    );
    const htmlSource = fs.readFileSync(
        path.join(__dirname, '../../electron/overlay.html'), 'utf-8'
    );

    it('state.js should default currentProvider to null', () => {
        assert.ok(
            stateSource.includes('currentProvider: null'),
            'state.js should have currentProvider: null'
        );
    });

    it('state.js should default currentProviderName to empty string', () => {
        assert.ok(
            stateSource.includes("currentProviderName: ''"),
            'state.js should have empty currentProviderName'
        );
    });

    it('overlay.html nav-terminal-label should be empty by default', () => {
        const match = htmlSource.match(/id="nav-terminal-label">([^<]*)<\/span>/);
        assert.ok(match, 'Should find nav-terminal-label element');
        assert.equal(match[1], '', 'nav-terminal-label should be empty');
    });
});

describe('Startup polish - TTS adapter_type fix', () => {
    const baseSource = fs.readFileSync(
        path.join(__dirname, '../../python/tts/base.py'), 'utf-8'
    );
    const kokoroSource = fs.readFileSync(
        path.join(__dirname, '../../python/tts/kokoro.py'), 'utf-8'
    );
    const qwenSource = fs.readFileSync(
        path.join(__dirname, '../../python/tts/qwen.py'), 'utf-8'
    );
    const voiceAgentSource = fs.readFileSync(
        path.join(__dirname, '../../python/voice_agent.py'), 'utf-8'
    );

    it('base.py should define adapter_type class attribute', () => {
        assert.ok(
            baseSource.includes('adapter_type'),
            'base.py should have adapter_type'
        );
    });

    it('kokoro.py should set adapter_type = "kokoro"', () => {
        assert.ok(
            kokoroSource.includes('adapter_type = "kokoro"'),
            'kokoro.py should set adapter_type'
        );
    });

    it('qwen.py should set adapter_type = "qwen"', () => {
        assert.ok(
            qwenSource.includes('adapter_type = "qwen"'),
            'qwen.py should set adapter_type'
        );
    });

    it('voice_agent.py should compare adapter_type not name', () => {
        assert.ok(
            voiceAgentSource.includes('self.tts.adapter_type'),
            'voice_agent.py should use adapter_type for comparison'
        );
        assert.ok(
            !voiceAgentSource.includes('new_adapter != self.tts.name'),
            'voice_agent.py should NOT compare against self.tts.name'
        );
    });
});

describe('Startup polish - perf bar immediate sample', () => {
    const perfSource = fs.readFileSync(
        path.join(__dirname, '../../electron/services/perf-monitor.js'), 'utf-8'
    );

    it('should call sample() immediately after setInterval', () => {
        const intervalIdx = perfSource.indexOf('setInterval(() => sample()');
        const sampleIdx = perfSource.indexOf('sample()', intervalIdx + 1);
        assert.ok(
            intervalIdx > -1 && sampleIdx > -1,
            'Should have both setInterval and immediate sample() call'
        );
        // The immediate sample() should come right after setInterval line
        const between = perfSource.substring(intervalIdx, sampleIdx);
        assert.ok(
            between.split('\n').length <= 3,
            'Immediate sample() should be within 2 lines of setInterval'
        );
    });
});

describe('Startup polish - welcome message includes provider', () => {
    const mainSource = fs.readFileSync(
        path.join(__dirname, '../../electron/renderer/main.js'), 'utf-8'
    );

    it('updateWelcomeMessage should reference provider name', () => {
        assert.ok(
            mainSource.includes('Connected to'),
            'Welcome message should include "Connected to" provider prefix'
        );
    });
});
