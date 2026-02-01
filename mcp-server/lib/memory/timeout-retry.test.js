/**
 * Tests for withTimeout, withRetry, and runWithConcurrency utilities
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { withTimeout, withRetry, RETRYABLE_PATTERN, runWithConcurrency } = require('./utils');

describe('withTimeout', () => {
    it('should resolve if promise completes before timeout', async () => {
        const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
        assert.strictEqual(result, 'ok');
    });

    it('should reject if promise exceeds timeout', async () => {
        const slow = new Promise(r => setTimeout(() => r('late'), 5000));
        await assert.rejects(
            () => withTimeout(slow, 50, 'slow op'),
            /slow op timed out after 50ms/
        );
    });

    it('should propagate original error if promise rejects before timeout', async () => {
        await assert.rejects(
            () => withTimeout(Promise.reject(new Error('original')), 5000, 'test'),
            /original/
        );
    });

    it('should clean up timer after resolution', async () => {
        // This would leak timers if not cleaned up; just verify it resolves
        const result = await withTimeout(Promise.resolve(42), 1000);
        assert.strictEqual(result, 42);
    });
});

describe('withRetry', () => {
    it('should return result on first success', async () => {
        const result = await withRetry(() => Promise.resolve('ok'));
        assert.strictEqual(result, 'ok');
    });

    it('should retry on retryable errors and succeed', async () => {
        let attempts = 0;
        const result = await withRetry(() => {
            attempts++;
            if (attempts < 3) throw new Error('429 rate limit exceeded');
            return Promise.resolve('success');
        }, { baseDelay: 10, maxDelay: 20 });
        assert.strictEqual(result, 'success');
        assert.strictEqual(attempts, 3);
    });

    it('should not retry on non-retryable errors', async () => {
        let attempts = 0;
        await assert.rejects(
            () => withRetry(() => {
                attempts++;
                throw new Error('invalid API key');
            }, { baseDelay: 10 }),
            /invalid API key/
        );
        assert.strictEqual(attempts, 1);
    });

    it('should throw after max attempts exhausted', async () => {
        let attempts = 0;
        await assert.rejects(
            () => withRetry(() => {
                attempts++;
                throw new Error('rate limit hit');
            }, { maxAttempts: 3, baseDelay: 10, maxDelay: 20 }),
            /rate limit hit/
        );
        assert.strictEqual(attempts, 3);
    });

    it('should respect maxDelay cap', async () => {
        const start = Date.now();
        let attempts = 0;
        await assert.rejects(
            () => withRetry(() => {
                attempts++;
                throw new Error('500 server error');
            }, { maxAttempts: 3, baseDelay: 10, maxDelay: 30 }),
            /500 server error/
        );
        const elapsed = Date.now() - start;
        // With baseDelay=10, maxDelay=30: delays should be ~10ms, ~20ms = ~30ms total
        assert.ok(elapsed < 200, `Took ${elapsed}ms, expected < 200ms`);
    });
});

describe('RETRYABLE_PATTERN', () => {
    it('should match rate limit errors', () => {
        assert.ok(RETRYABLE_PATTERN.test('rate limit exceeded'));
        assert.ok(RETRYABLE_PATTERN.test('Rate_Limit'));
        assert.ok(RETRYABLE_PATTERN.test('too many requests'));
        assert.ok(RETRYABLE_PATTERN.test('HTTP 429'));
    });

    it('should match server errors', () => {
        assert.ok(RETRYABLE_PATTERN.test('HTTP 500'));
        assert.ok(RETRYABLE_PATTERN.test('HTTP 503'));
        assert.ok(RETRYABLE_PATTERN.test('cloudflare error'));
    });

    it('should match network errors', () => {
        assert.ok(RETRYABLE_PATTERN.test('ECONNRESET'));
        assert.ok(RETRYABLE_PATTERN.test('ETIMEDOUT'));
        assert.ok(RETRYABLE_PATTERN.test('socket hang up'));
    });

    it('should not match auth errors', () => {
        assert.ok(!RETRYABLE_PATTERN.test('invalid API key'));
        assert.ok(!RETRYABLE_PATTERN.test('unauthorized'));
    });
});

describe('runWithConcurrency', () => {
    it('should execute all tasks and return results in order', async () => {
        const tasks = [1, 2, 3].map(n => () => Promise.resolve(n * 10));
        const results = await runWithConcurrency(tasks, 2);
        assert.deepStrictEqual(results, [10, 20, 30]);
    });

    it('should respect concurrency limit', async () => {
        let running = 0;
        let maxRunning = 0;
        const tasks = Array.from({ length: 6 }, () => async () => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            await new Promise(r => setTimeout(r, 20));
            running--;
            return 'done';
        });
        await runWithConcurrency(tasks, 2);
        assert.ok(maxRunning <= 2, `Max concurrent was ${maxRunning}, expected <= 2`);
    });

    it('should stop on first error', async () => {
        let completed = 0;
        const tasks = Array.from({ length: 10 }, (_, i) => async () => {
            await new Promise(r => setTimeout(r, 10));
            if (i === 2) throw new Error('task 2 failed');
            completed++;
            return i;
        });
        await assert.rejects(
            () => runWithConcurrency(tasks, 2),
            /task 2 failed/
        );
        assert.ok(completed < 10, `Completed ${completed}, expected < 10`);
    });

    it('should handle empty task list', async () => {
        const results = await runWithConcurrency([], 4);
        assert.deepStrictEqual(results, []);
    });
});
