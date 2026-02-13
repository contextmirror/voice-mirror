/**
 * Config test suite — 9 tests for settings changes.
 */

const { createTestContext, readConfig, patchConfig, getConfigValue, backupConfig, restoreConfig } = require('../lib/harness');

async function run(options = {}) {
    const t = createTestContext('config');

    // 1. Read default config
    const config = readConfig();
    t.assert(config !== null, 'Read config succeeds');

    // 2. Verify all top-level keys exist
    const expectedKeys = ['wakeWord', 'voice', 'appearance', 'behavior', 'window', 'overlay', 'advanced', 'sidebar', 'ai'];
    for (const key of expectedKeys) {
        t.assert(config && key in config, `Config has key: ${key}`);
    }

    // 3. Change TTS voice
    patchConfig('voice.ttsVoice', 'bf_emma');
    t.assertConfigValue('voice.ttsVoice', 'bf_emma', 'Change TTS voice to bf_emma');

    // 4. Change TTS adapter
    patchConfig('voice.ttsAdapter', 'qwen');
    t.assertConfigValue('voice.ttsAdapter', 'qwen', 'Change TTS adapter to qwen');

    // 5. Change activation mode
    patchConfig('behavior.activationMode', 'pushToTalk');
    t.assertConfigValue('behavior.activationMode', 'pushToTalk', 'Change activation mode to pushToTalk');

    // 6. Change AI provider
    patchConfig('ai.provider', 'ollama');
    t.assertConfigValue('ai.provider', 'ollama', 'Change AI provider to ollama');

    // 7. Set invalid provider (should write without crash)
    try {
        patchConfig('ai.provider', 'nonexistent');
        t.assertConfigValue('ai.provider', 'nonexistent', 'Set invalid provider writes without crash');
    } catch (err) {
        t.assert(false, `Set invalid provider — threw: ${err.message}`);
    }

    // 8. Switch tool profile
    patchConfig('ai.toolProfile', 'minimal');
    t.assertConfigValue('ai.toolProfile', 'minimal', 'Switch tool profile to minimal');

    // 9. Config restore verification
    // (runner handles actual backup/restore; here we just verify we can write back)
    patchConfig('ai.provider', 'claude');
    patchConfig('voice.ttsVoice', 'af_bella');
    patchConfig('voice.ttsAdapter', 'kokoro');
    patchConfig('behavior.activationMode', 'wakeWord');
    patchConfig('ai.toolProfile', 'voice-assistant');
    t.assertConfigValue('ai.provider', 'claude', 'Config restore — provider back to claude');

    return t.getResults();
}

module.exports = { run };
