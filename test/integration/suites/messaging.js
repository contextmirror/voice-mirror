/**
 * Messaging test suite — 7 inbox round-trip tests.
 */

const { createTestContext, readInbox, writeInbox, sendMessage, clearInbox, readUnread } = require('../lib/harness');

async function run(options = {}) {
    const t = createTestContext('messaging');

    // Clean slate
    const originalInbox = readInbox();
    clearInbox();

    // 1. Send appears in inbox
    sendMessage('nathan', 'Hello from test');
    const inbox1 = readInbox();
    t.assert(inbox1.length === 1, 'Send appears in inbox');

    // 2. Message structure
    const msg = inbox1[0];
    t.assert(
        msg.id && msg.from && msg.message && msg.timestamp && Array.isArray(msg.read_by),
        'Message has required fields (id, from, message, timestamp, read_by)'
    );

    // 3. Read marks as read
    msg.read_by.push('voice-claude');
    writeInbox(inbox1);
    const unread = readUnread('voice-claude');
    t.assert(unread.length === 0, 'Read marks as read — unread count is 0');

    // 4. Thread filtering
    clearInbox();
    sendMessage('nathan', 'Thread A msg', { thread_id: 'thread-a' });
    sendMessage('nathan', 'Thread B msg', { thread_id: 'thread-b' });
    const allMsgs = readInbox();
    const threadA = allMsgs.filter(m => m.thread_id === 'thread-a');
    t.assertEqual(threadA.length, 1, 'Thread filtering — 1 message in thread-a');

    // 5. 100-message cap
    clearInbox();
    for (let i = 0; i < 105; i++) {
        sendMessage('nathan', `Message ${i}`);
    }
    const cappedInbox = readInbox();
    t.assert(cappedInbox.length <= 100, `100-message cap — got ${cappedInbox.length}`);

    // 6. Empty inbox
    clearInbox();
    const empty = readInbox();
    t.assertEqual(empty.length, 0, 'Empty inbox — 0 messages');

    // 7. Round-trip (just verify send+read, no live provider needed)
    sendMessage('nathan', 'What is 2+2?');
    const rtInbox = readInbox();
    const lastMsg = rtInbox[rtInbox.length - 1];
    t.assertContains(lastMsg.message, '2+2', 'Round-trip — message content preserved');

    // Restore original inbox
    writeInbox(originalInbox);

    return t.getResults();
}

module.exports = { run };
