const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('PTT trigger file flow', () => {
    const tmpDir = os.tmpdir();

    it('write trigger JSON, read it back, content matches', () => {
        const triggerPath = path.join(tmpDir, `ptt-trigger-${Date.now()}.json`);
        const payload = { action: 'push_to_talk', timestamp: Date.now() };

        fs.writeFileSync(triggerPath, JSON.stringify(payload), 'utf8');
        const read = JSON.parse(fs.readFileSync(triggerPath, 'utf8'));

        assert.deepStrictEqual(read, payload);
        fs.unlinkSync(triggerPath);
    });

    it('after reading, file can be unlinked (simulating consumption)', () => {
        const triggerPath = path.join(tmpDir, `ptt-consume-${Date.now()}.json`);
        const payload = { action: 'ptt', consumed: false };

        fs.writeFileSync(triggerPath, JSON.stringify(payload), 'utf8');
        JSON.parse(fs.readFileSync(triggerPath, 'utf8'));
        fs.unlinkSync(triggerPath);

        assert.strictEqual(fs.existsSync(triggerPath), false, 'Trigger file should be deleted after consumption');
    });

    it('rapid write/read/write/read does not lose data', () => {
        const triggerPath = path.join(tmpDir, `ptt-rapid-${Date.now()}.json`);

        const payload1 = { seq: 1, ts: Date.now() };
        fs.writeFileSync(triggerPath, JSON.stringify(payload1), 'utf8');
        const read1 = JSON.parse(fs.readFileSync(triggerPath, 'utf8'));
        assert.deepStrictEqual(read1, payload1);

        const payload2 = { seq: 2, ts: Date.now() };
        fs.writeFileSync(triggerPath, JSON.stringify(payload2), 'utf8');
        const read2 = JSON.parse(fs.readFileSync(triggerPath, 'utf8'));
        assert.deepStrictEqual(read2, payload2);

        fs.unlinkSync(triggerPath);
    });
});
