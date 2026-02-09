const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createPerfMonitor } = require('../../electron/services/perf-monitor');

describe('perf-monitor', () => {
    let tempDir;
    let monitor;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
    });

    afterEach(async () => {
        if (monitor) await monitor.stop();
        // Allow file handles to close before cleanup (prevents ENOTEMPTY on macOS)
        await new Promise(r => setTimeout(r, 100));
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });

    it('should create monitor with expected methods', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        assert.strictEqual(typeof monitor.start, 'function');
        assert.strictEqual(typeof monitor.stop, 'function');
        assert.strictEqual(typeof monitor.logEvent, 'function');
        assert.strictEqual(typeof monitor.isRunning, 'function');
    });

    it('should not be running before start', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        assert.strictEqual(monitor.isRunning(), false);
    });

    it('should be running after start', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        monitor.start();
        assert.strictEqual(monitor.isRunning(), true);
    });

    it('should stop running after stop', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        monitor.start();
        monitor.stop();
        assert.strictEqual(monitor.isRunning(), false);
    });

    it('should create CSV log file on start', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        monitor.start();
        const logPath = path.join(tempDir, 'perf-log.csv');
        assert.ok(fs.existsSync(logPath), 'perf-log.csv should exist');
        const header = fs.readFileSync(logPath, 'utf-8').trim();
        assert.strictEqual(header, 'timestamp,cpu_pct,heap_mb,rss_mb,event');
    });

    it('should send stats via safeSend callback', async () => {
        const stats = [];
        monitor = createPerfMonitor({
            dataDir: tempDir,
            safeSend: (channel, data) => {
                if (channel === 'perf-stats') stats.push(data);
            }
        });
        monitor.start();
        // Wait for at least one sample (3s interval, give 4s)
        await new Promise(r => setTimeout(r, 3500));
        assert.ok(stats.length >= 1, `Expected at least 1 sample, got ${stats.length}`);
        const s = stats[0];
        assert.strictEqual(typeof s.cpu, 'number');
        assert.strictEqual(typeof s.heap, 'number');
        assert.strictEqual(typeof s.rss, 'number');
    });

    it('logEvent should tag the next sample', async () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        monitor.start();
        monitor.logEvent('test_event');
        await new Promise(r => setTimeout(r, 3500));
        const logPath = path.join(tempDir, 'perf-log.csv');
        const content = fs.readFileSync(logPath, 'utf-8');
        assert.ok(content.includes('test_event'), 'CSV should contain tagged event');
    });

    it('double start should be safe', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        monitor.start();
        monitor.start(); // Should not throw
        assert.strictEqual(monitor.isRunning(), true);
    });

    it('double stop should be safe', () => {
        monitor = createPerfMonitor({ dataDir: tempDir });
        monitor.start();
        monitor.stop();
        monitor.stop(); // Should not throw
        assert.strictEqual(monitor.isRunning(), false);
    });
});
