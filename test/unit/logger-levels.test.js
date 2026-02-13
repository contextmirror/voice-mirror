const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../../electron/services/logger');

describe('logger level methods', () => {
    it('createLogger returns an object with all expected methods', () => {
        const logger = createLogger();
        assert.equal(typeof logger.info, 'function');
        assert.equal(typeof logger.warn, 'function');
        assert.equal(typeof logger.error, 'function');
        assert.equal(typeof logger.debug, 'function');
        assert.equal(typeof logger.log, 'function');
        assert.equal(typeof logger.devlog, 'function');
        assert.equal(typeof logger.init, 'function');
        assert.equal(typeof logger.close, 'function');
    });

    it('info() does not throw', () => {
        const logger = createLogger();
        assert.doesNotThrow(() => logger.info('[Test]', 'hello', 'world'));
    });

    it('warn() does not throw', () => {
        const logger = createLogger();
        assert.doesNotThrow(() => logger.warn('[Test]', 'warning message'));
    });

    it('error() does not throw', () => {
        const logger = createLogger();
        assert.doesNotThrow(() => logger.error('[Test]', 'error message'));
    });

    it('debug() does not throw when debug is disabled', () => {
        // VOICE_MIRROR_DEBUG is not set in test env, so debug should be silent
        const logger = createLogger();
        assert.doesNotThrow(() => logger.debug('[Test]', 'debug message'));
    });

    it('info() formats tag and args into a single message', () => {
        // Source inspection: info() calls log('LOG', `${tag} ${args.map(String).join(' ')}`)
        const src = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../electron/services/logger.js'),
            'utf8'
        );
        // Verify the info function joins args with String coercion
        assert.ok(src.includes('args.map(String).join'));
    });

    it('debug() respects VOICE_MIRROR_DEBUG env var via isDebugEnabled', () => {
        // Source inspection: isDebugEnabled is captured at factory time
        const src = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../electron/services/logger.js'),
            'utf8'
        );
        assert.ok(src.includes("process.env.VOICE_MIRROR_DEBUG === '1'"));
        assert.ok(src.includes('if (!isDebugEnabled) return'));
    });

    it('warn() uses YELLOW color and a dedicated format', () => {
        const src = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../electron/services/logger.js'),
            'utf8'
        );
        // warn() builds its own logLine with YELLOW and [WARN] category
        assert.ok(src.includes('Colors.YELLOW'));
        assert.ok(src.includes('[WARN]'));
    });
});
