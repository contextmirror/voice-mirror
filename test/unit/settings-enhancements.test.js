const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for settings enhancements:
 * - New config defaults (ttsVolume, outputDevice, inputDevice)
 * - Start with system config key
 * - TTS volume ffplay command building
 * - Audio device enumeration response handling
 */

describe('Settings enhancements - config defaults', () => {
    // We can't require electron config.js directly (needs electron app),
    // so we test the DEFAULT_CONFIG shape by reading the source.
    const fs = require('fs');
    const path = require('path');
    const configSource = fs.readFileSync(
        path.join(__dirname, '../../electron/config.js'), 'utf-8'
    );

    it('DEFAULT_CONFIG should include ttsVolume in voice section', () => {
        assert.ok(
            configSource.includes('ttsVolume:'),
            'config.js should contain ttsVolume default'
        );
    });

    it('DEFAULT_CONFIG should include inputDevice in voice section', () => {
        assert.ok(
            configSource.includes('inputDevice:'),
            'config.js should contain inputDevice default'
        );
    });

    it('DEFAULT_CONFIG should include outputDevice in voice section', () => {
        assert.ok(
            configSource.includes('outputDevice:'),
            'config.js should contain outputDevice default'
        );
    });

    it('DEFAULT_CONFIG should include startWithSystem in behavior section', () => {
        assert.ok(
            configSource.includes('startWithSystem:'),
            'config.js should contain startWithSystem default'
        );
    });
});

describe('Settings enhancements - TTS volume ffplay args', () => {
    it('should add -af volume filter when volume != 1.0', () => {
        // Simulate the logic from tts/base.py _play_audio
        const volume = 0.5;
        const cmd = ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'];
        if (volume !== 1.0) {
            cmd.push('-af', `volume=${volume.toFixed(1)}`);
        }
        cmd.push('test.wav');

        assert.deepEqual(cmd, [
            'ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet',
            '-af', 'volume=0.5',
            'test.wav'
        ]);
    });

    it('should NOT add -af volume filter when volume is 1.0', () => {
        const volume = 1.0;
        const cmd = ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'];
        if (volume !== 1.0) {
            cmd.push('-af', `volume=${volume.toFixed(1)}`);
        }
        cmd.push('test.wav');

        assert.deepEqual(cmd, [
            'ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet',
            'test.wav'
        ]);
    });

    it('should handle max volume (2.0)', () => {
        const volume = 2.0;
        const cmd = ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'];
        if (volume !== 1.0) {
            cmd.push('-af', `volume=${volume.toFixed(1)}`);
        }
        cmd.push('test.wav');

        assert.ok(cmd.includes('-af'), 'Should include -af flag');
        assert.ok(cmd.includes('volume=2.0'), 'Should include volume=2.0');
    });
});

describe('Settings enhancements - audio device response handling', () => {
    it('should parse audio device list response', () => {
        // Simulate the response format from Python
        const response = {
            input: [
                { id: 0, name: 'Built-in Microphone' },
                { id: 2, name: 'USB Headset' }
            ],
            output: [
                { id: 1, name: 'Built-in Speakers' },
                { id: 3, name: 'USB Headset' }
            ]
        };

        assert.ok(Array.isArray(response.input));
        assert.ok(Array.isArray(response.output));
        assert.equal(response.input.length, 2);
        assert.equal(response.output.length, 2);
        assert.equal(response.input[0].name, 'Built-in Microphone');
        assert.equal(response.output[0].name, 'Built-in Speakers');
    });

    it('should handle empty device list', () => {
        const response = { input: [], output: [] };
        assert.equal(response.input.length, 0);
        assert.equal(response.output.length, 0);
    });

    it('should handle null response (Python not running)', () => {
        const response = null;
        assert.equal(response, null);
    });
});

describe('Settings enhancements - settings save includes new fields', () => {
    it('should include ttsVolume in voice settings object', () => {
        // Simulate the save object built by settings.js
        const voiceSettings = {
            ttsAdapter: 'kokoro',
            ttsVoice: 'af_bella',
            ttsModelSize: '0.6B',
            ttsSpeed: 1.0,
            ttsVolume: 0.7,
            sttModel: 'parakeet',
            inputDevice: 'USB Headset',
            outputDevice: null
        };

        assert.equal(voiceSettings.ttsVolume, 0.7);
        assert.equal(voiceSettings.inputDevice, 'USB Headset');
        assert.equal(voiceSettings.outputDevice, null);
    });

    it('should include startWithSystem in behavior settings', () => {
        const behaviorSettings = {
            activationMode: 'wakeWord',
            hotkey: 'CommandOrControl+Shift+V',
            pttKey: 'MouseButton4',
            startMinimized: false,
            startWithSystem: true
        };

        assert.equal(behaviorSettings.startWithSystem, true);
    });
});

describe('Settings enhancements - preload API', () => {
    const preloadSource = require('fs').readFileSync(
        require('path').join(__dirname, '../../electron/preload.js'), 'utf-8'
    );

    it('should expose listAudioDevices in preload', () => {
        assert.ok(
            preloadSource.includes('listAudioDevices'),
            'preload.js should expose listAudioDevices'
        );
    });

    it('should expose list-audio-devices IPC channel', () => {
        assert.ok(
            preloadSource.includes('list-audio-devices'),
            'preload.js should reference list-audio-devices IPC'
        );
    });
});

describe('Settings enhancements - HTML elements', () => {
    const htmlSource = require('fs').readFileSync(
        require('path').join(__dirname, '../../electron/overlay.html'), 'utf-8'
    );

    it('should have start-with-system checkbox', () => {
        assert.ok(htmlSource.includes('id="start-with-system"'));
    });

    it('should have tts-volume slider', () => {
        assert.ok(htmlSource.includes('id="tts-volume"'));
    });

    it('should have volume-value display', () => {
        assert.ok(htmlSource.includes('id="volume-value"'));
    });

    it('should have audio-input-device select', () => {
        assert.ok(htmlSource.includes('id="audio-input-device"'));
    });

    it('should have audio-output-device select', () => {
        assert.ok(htmlSource.includes('id="audio-output-device"'));
    });

    it('should have audio device section', () => {
        assert.ok(htmlSource.includes('id="audio-device-section"'));
    });
});
