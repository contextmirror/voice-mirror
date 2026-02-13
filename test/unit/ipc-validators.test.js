const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validators, VALID_PROVIDERS } = require('../../electron/ipc-validators');

describe('set-window-position', () => {
    const v = validators['set-window-position'];

    it('valid numbers → ok with clamped rounded values', () => {
        const r = v(100.7, 200.3);
        assert.ok(r.valid);
        assert.deepStrictEqual(r.value, { x: 101, y: 200 });
    });

    it('extreme values are clamped', () => {
        const r = v(-99999, 99999);
        assert.ok(r.valid);
        assert.strictEqual(r.value.x, -10000);
        assert.strictEqual(r.value.y, 50000);
    });

    it('NaN fails', () => {
        assert.strictEqual(v(NaN, 0).valid, false);
        assert.strictEqual(v(0, NaN).valid, false);
    });

    it('Infinity fails', () => {
        assert.strictEqual(v(Infinity, 0).valid, false);
        assert.strictEqual(v(0, -Infinity).valid, false);
    });

    it('non-numbers fail', () => {
        assert.strictEqual(v('10', 20).valid, false);
        assert.strictEqual(v(10, null).valid, false);
    });
});

describe('set-config', () => {
    const v = validators['set-config'];

    it('valid minimal update → ok', () => {
        const r = v({ behavior: { hotkey: 'Ctrl+Shift+V' } });
        assert.ok(r.valid);
        assert.strictEqual(r.value.behavior.hotkey, 'Ctrl+Shift+V');
    });

    it('non-object fails', () => {
        assert.strictEqual(v('string').valid, false);
        assert.strictEqual(v(null).valid, false);
        assert.strictEqual(v([1, 2]).valid, false);
    });

    it('invalid provider name fails', () => {
        const r = v({ ai: { provider: 'chatgpt' } });
        assert.strictEqual(r.valid, false);
        assert.ok(r.error.includes('ai.provider'));
    });

    it('valid provider name → ok', () => {
        const r = v({ ai: { provider: 'ollama' } });
        assert.ok(r.valid);
    });

    it('invalid endpoint URL fails', () => {
        const r = v({ ai: { endpoints: { ollama: 'not-a-url' } } });
        assert.strictEqual(r.valid, false);
        assert.ok(r.error.includes('ai.endpoints.ollama'));
    });

    it('valid endpoint URL → ok', () => {
        const r = v({ ai: { endpoints: { ollama: 'http://localhost:11434' } } });
        assert.ok(r.valid);
    });

    it('invalid activation mode fails', () => {
        const r = v({ behavior: { activationMode: 'always' } });
        assert.strictEqual(r.valid, false);
        assert.ok(r.error.includes('activationMode'));
    });

    it('orbSize out of range fails', () => {
        assert.strictEqual(v({ appearance: { orbSize: 10 } }).valid, false);
        assert.strictEqual(v({ appearance: { orbSize: 300 } }).valid, false);
    });

    it('functions stripped from object', () => {
        const r = v({ behavior: { hotkey: 'X' }, evil: function() {} });
        assert.ok(r.valid);
        assert.strictEqual(r.value.evil, undefined);
    });

    it('multiple errors collected', () => {
        const r = v({ ai: { provider: 'bad' }, appearance: { orbSize: 9999 } });
        assert.strictEqual(r.valid, false);
        assert.ok(r.error.includes('ai.provider'));
        assert.ok(r.error.includes('orbSize'));
    });
});

describe('open-external', () => {
    const v = validators['open-external'];

    it('valid https URL → ok', () => {
        const r = v('https://example.com');
        assert.ok(r.valid);
        assert.strictEqual(r.value, 'https://example.com');
    });

    it('file:// URL fails', () => {
        assert.strictEqual(v('file:///etc/passwd').valid, false);
    });

    it('javascript: URL fails', () => {
        assert.strictEqual(v('javascript:alert(1)').valid, false);
    });

    it('too long URL fails', () => {
        assert.strictEqual(v('https://x.com/' + 'a'.repeat(2048)).valid, false);
    });

    it('non-string fails', () => {
        assert.strictEqual(v(123).valid, false);
        assert.strictEqual(v(null).valid, false);
    });
});

describe('send-query', () => {
    const v = validators['send-query'];

    it('valid query → ok', () => {
        const r = v({ text: 'hello' });
        assert.ok(r.valid);
        assert.strictEqual(r.value.text, 'hello');
        assert.strictEqual(r.value.image, null);
    });

    it('missing text fails', () => {
        assert.strictEqual(v({}).valid, false);
    });

    it('text too long fails', () => {
        assert.strictEqual(v({ text: 'x'.repeat(50001) }).valid, false);
    });
});

describe('claude-pty-input', () => {
    const v = validators['claude-pty-input'];

    it('valid string → ok', () => {
        const r = v('ls -la');
        assert.ok(r.valid);
        assert.strictEqual(r.value, 'ls -la');
    });

    it('too long string fails', () => {
        assert.strictEqual(v('x'.repeat(10001)).valid, false);
    });

    it('non-string fails', () => {
        assert.strictEqual(v(123).valid, false);
        assert.strictEqual(v(null).valid, false);
    });
});

describe('claude-pty-resize', () => {
    const v = validators['claude-pty-resize'];

    it('valid cols/rows → ok', () => {
        const r = v(80, 24);
        assert.ok(r.valid);
        assert.deepStrictEqual(r.value, { cols: 80, rows: 24 });
    });

    it('out of range fails', () => {
        assert.strictEqual(v(0, 24).valid, false);
        assert.strictEqual(v(80, 0).valid, false);
        assert.strictEqual(v(501, 24).valid, false);
        assert.strictEqual(v(80, 201).valid, false);
    });

    it('non-integers fail', () => {
        assert.strictEqual(v(80.5, 24).valid, false);
        assert.strictEqual(v(80, 24.5).valid, false);
        assert.strictEqual(v('80', 24).valid, false);
    });
});

describe('ai-set-provider', () => {
    const v = validators['ai-set-provider'];

    it('valid provider → ok', () => {
        const r = v('ollama');
        assert.ok(r.valid);
        assert.strictEqual(r.value.providerId, 'ollama');
    });

    it('invalid provider fails', () => {
        assert.strictEqual(v('chatgpt').valid, false);
    });

    it('valid model string → ok', () => {
        const r = v('ollama', 'llama3');
        assert.ok(r.valid);
        assert.strictEqual(r.value.model, 'llama3');
    });

    it('null model → ok', () => {
        const r = v('ollama', null);
        assert.ok(r.valid);
        assert.strictEqual(r.value.model, null);
    });
});

describe('send-image', () => {
    const v = validators['send-image'];

    it('valid imageData → ok', () => {
        const r = v({ base64: 'abc123' });
        assert.ok(r.valid);
        assert.strictEqual(r.value.base64, 'abc123');
        assert.strictEqual(r.value.filename, null);
    });

    it('missing base64 fails', () => {
        assert.strictEqual(v({}).valid, false);
        assert.strictEqual(v({ base64: 123 }).valid, false);
    });

    it('filename too long fails', () => {
        assert.strictEqual(v({ base64: 'x', filename: 'a'.repeat(256) }).valid, false);
    });
});
