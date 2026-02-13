const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('inbox message format', () => {
    const tmpDir = os.tmpdir();

    it('create inbox with messages array, write, read back, messages intact', () => {
        const inboxPath = path.join(tmpDir, `inbox-${Date.now()}.json`);
        const inbox = {
            messages: [
                { id: 'msg_1', from: 'user', message: 'hello', timestamp: Date.now(), thread_id: 't1' }
            ]
        };

        fs.writeFileSync(inboxPath, JSON.stringify(inbox), 'utf8');
        const read = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));

        assert.ok(Array.isArray(read.messages));
        assert.strictEqual(read.messages.length, 1);
        assert.deepStrictEqual(read.messages[0], inbox.messages[0]);

        fs.unlinkSync(inboxPath);
    });

    it('message has required fields (id, from, message, timestamp, thread_id)', () => {
        const msg = { id: 'msg_2', from: 'claude', message: 'hi there', timestamp: Date.now(), thread_id: 't2' };
        const requiredFields = ['id', 'from', 'message', 'timestamp', 'thread_id'];

        for (const field of requiredFields) {
            assert.ok(field in msg, `Message should have field: ${field}`);
            assert.ok(msg[field] !== undefined, `Field ${field} should not be undefined`);
        }
    });

    it('messages append correctly (existing + new)', () => {
        const inboxPath = path.join(tmpDir, `inbox-append-${Date.now()}.json`);
        const existing = {
            messages: [
                { id: 'msg_a', from: 'user', message: 'first', timestamp: 1000, thread_id: 't1' }
            ]
        };

        fs.writeFileSync(inboxPath, JSON.stringify(existing), 'utf8');

        // Read, append, write back
        const data = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
        data.messages.push({ id: 'msg_b', from: 'claude', message: 'second', timestamp: 2000, thread_id: 't1' });
        fs.writeFileSync(inboxPath, JSON.stringify(data), 'utf8');

        const final = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
        assert.strictEqual(final.messages.length, 2);
        assert.strictEqual(final.messages[0].id, 'msg_a');
        assert.strictEqual(final.messages[1].id, 'msg_b');

        fs.unlinkSync(inboxPath);
    });
});
