/**
 * Stress test suite — 8 edge case tests.
 */

const fs = require('fs');
const {
    createTestContext, readInbox, writeInbox, sendMessage, clearInbox,
    readConfig, writeConfig, patchConfig,
    INBOX_PATH, CONFIG_PATH, DATA_DIR,
} = require('../lib/harness');

async function run(options = {}) {
    const t = createTestContext('stress');

    const savedInbox = readInbox();

    // 1. Rapid-fire 20 messages
    clearInbox();
    for (let i = 0; i < 20; i++) {
        sendMessage('nathan', `Rapid msg ${i}`);
    }
    const rapidInbox = readInbox();
    t.assertEqual(rapidInbox.length, 20, 'Rapid-fire 20 messages — all present');
    // Verify JSON not corrupted
    try {
        JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
        t.assert(true, 'Rapid-fire — JSON not corrupted');
    } catch {
        t.assert(false, 'Rapid-fire — JSON corrupted');
    }

    // 2. Empty message
    clearInbox();
    sendMessage('nathan', '');
    const emptyMsgInbox = readInbox();
    t.assert(emptyMsgInbox.length === 1, 'Empty message — stored without crash');

    // 3. Huge message (100KB)
    clearInbox();
    const hugeMsg = 'A'.repeat(100 * 1024);
    sendMessage('nathan', hugeMsg);
    const hugeInbox = readInbox();
    t.assert(hugeInbox.length === 1 && hugeInbox[0].message.length >= 100000, 'Huge message (100KB) — stored');

    // 4. Concurrent reads (5 parallel)
    clearInbox();
    sendMessage('nathan', 'Concurrent test');
    const reads = await Promise.all([
        Promise.resolve(readInbox()),
        Promise.resolve(readInbox()),
        Promise.resolve(readInbox()),
        Promise.resolve(readInbox()),
        Promise.resolve(readInbox()),
    ]);
    const allSame = reads.every(r => r.length === reads[0].length);
    t.assert(allSame, 'Concurrent reads — all return same data');

    // 5. Invalid JSON in inbox
    fs.writeFileSync(INBOX_PATH, '{broken json!!!', 'utf-8');
    const badInbox = readInbox();
    t.assert(Array.isArray(badInbox) && badInbox.length === 0, 'Invalid JSON — returns empty array gracefully');

    // 6. Config extra keys
    const config = readConfig();
    config._testExtraKey = { foo: 'bar' };
    writeConfig(config);
    const reloaded = readConfig();
    t.assert(reloaded._testExtraKey?.foo === 'bar', 'Config extra keys — preserved without crash');
    // Clean up
    delete reloaded._testExtraKey;
    writeConfig(reloaded);

    // 7. Missing inbox file
    const inboxExists = fs.existsSync(INBOX_PATH);
    if (inboxExists) fs.unlinkSync(INBOX_PATH);
    const missingInbox = readInbox();
    t.assert(Array.isArray(missingInbox) && missingInbox.length === 0, 'Missing inbox file — returns empty array');
    // Restore
    writeInbox([]);

    // 8. Write then immediate read consistency
    clearInbox();
    sendMessage('nathan', 'Consistency check');
    const immediate = readInbox();
    t.assert(immediate.length === 1 && immediate[0].message === 'Consistency check', 'Write-then-read consistency');

    // Restore original inbox
    writeInbox(savedInbox);

    return t.getResults();
}

module.exports = { run };
