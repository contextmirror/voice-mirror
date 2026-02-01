/**
 * Tests for session transcript indexing
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
    getProjectSlug,
    listTranscriptFiles,
    extractTranscriptText
} = require('./session-sync');

describe('Session transcript indexing', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-sync-test-'));
    });

    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true }); } catch {}
    });

    it('getProjectSlug should convert paths to slugs', () => {
        assert.strictEqual(
            getProjectSlug('/home/user/project'),
            '-home-user-project'
        );
    });

    it('listTranscriptFiles should find .jsonl files', async () => {
        fs.writeFileSync(path.join(dir, 'abc.jsonl'), '{}');
        fs.writeFileSync(path.join(dir, 'def.jsonl'), '{}');
        fs.writeFileSync(path.join(dir, 'readme.md'), '# hello');

        const files = await listTranscriptFiles(dir);
        assert.strictEqual(files.length, 2);
        assert.ok(files.every(f => f.path.endsWith('.jsonl')));
        assert.ok(files.every(f => typeof f.size === 'number'));
    });

    it('listTranscriptFiles should return empty for non-existent dir', async () => {
        const files = await listTranscriptFiles('/nonexistent/path');
        assert.deepStrictEqual(files, []);
    });

    it('extractTranscriptText should parse user and assistant messages', async () => {
        const lines = [
            JSON.stringify({ type: 'file-history-snapshot', messageId: 'x', snapshot: {} }),
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello world' } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] } }),
            JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Here is my answer.' }] } }),
            JSON.stringify({ type: 'system', message: { role: 'system', content: 'ignored' } })
        ];
        const filePath = path.join(dir, 'test.jsonl');
        fs.writeFileSync(filePath, lines.join('\n'));

        const { text, bytesRead } = await extractTranscriptText(filePath);
        assert.ok(text.includes('User: Hello world'));
        assert.ok(text.includes('Assistant: Hi there!'));
        assert.ok(text.includes('Assistant: Here is my answer.'));
        assert.ok(!text.includes('ignored'));
        assert.ok(!text.includes('hmm')); // thinking blocks should be skipped
        assert.ok(bytesRead > 0);
    });

    it('extractTranscriptText should support fromByte delta tracking', async () => {
        const lines = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'First message' } }),
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Second message' } })
        ];
        const filePath = path.join(dir, 'delta.jsonl');
        fs.writeFileSync(filePath, lines.join('\n'));

        // Get full text first
        const { text: full } = await extractTranscriptText(filePath, 0);
        assert.ok(full.includes('First message'));
        assert.ok(full.includes('Second message'));

        // Read from byte offset past first line
        const firstLineBytes = Buffer.byteLength(lines[0], 'utf-8') + 1;
        const { text: delta } = await extractTranscriptText(filePath, firstLineBytes);
        assert.ok(!delta.includes('First message'), 'Should skip already-read content');
        assert.ok(delta.includes('Second message'));
    });

    it('extractTranscriptText should handle malformed lines gracefully', async () => {
        const lines = [
            '{"type": "user", "message": {"content": "valid"}}',
            'not valid json',
            '{"type": "assistant", "message": {"content": [{"type": "text", "text": "also valid"}]}}'
        ];
        const filePath = path.join(dir, 'bad.jsonl');
        fs.writeFileSync(filePath, lines.join('\n'));

        const { text } = await extractTranscriptText(filePath);
        assert.ok(text.includes('User: valid'));
        assert.ok(text.includes('Assistant: also valid'));
    });

    it('extractTranscriptText should handle empty file', async () => {
        const filePath = path.join(dir, 'empty.jsonl');
        fs.writeFileSync(filePath, '');

        const { text } = await extractTranscriptText(filePath);
        assert.strictEqual(text, '');
    });
});
