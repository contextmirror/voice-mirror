/**
 * Performance monitor service for Voice Mirror Electron.
 * Samples CPU and memory every 3 seconds, sends to renderer, logs to CSV.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger();

let logWarned = false;

/**
 * Create a performance monitor service instance.
 * @param {Object} options
 * @param {string} options.dataDir - Path to data directory
 * @param {Function} options.safeSend - IPC sender function (channel, data)
 * @returns {Object} Performance monitor service
 */
function createPerfMonitor(options = {}) {
    const { dataDir, safeSend } = options;

    let interval = null;
    let prevCpuUsage = null;
    let prevTime = null;
    let logPath = null;
    const MAX_LOG_LINES = 10000;
    const FLUSH_INTERVAL = 10;   // Flush every 10 samples (30s at 3s interval)
    const ROTATE_INTERVAL = 100; // Check rotation every 100 samples (~5min)
    let csvBuffer = [];
    let sampleCount = 0;

    function start() {
        if (interval) return;

        const { getDataDir } = require('./platform-paths');
        const dir = dataDir || getDataDir();
        logPath = path.join(dir, 'perf-log.csv');

        // Write CSV header if file doesn't exist
        if (!fs.existsSync(logPath)) {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(logPath, 'timestamp,cpu_pct,heap_mb,rss_mb\n');
        }

        prevCpuUsage = process.cpuUsage();
        prevTime = Date.now();
        sampleCount = 0;
        csvBuffer = [];

        interval = setInterval(() => sample(), 3000);
        sample(); // Immediate first sample so UI doesn't show "--"
        logger.info('[PerfMonitor]', 'Started');
    }

    function sample() {
        const now = Date.now();
        const elapsed = (now - prevTime) * 1000; // microseconds
        const cpu = process.cpuUsage(prevCpuUsage);
        const cpuPct = ((cpu.user + cpu.system) / elapsed) * 100;
        prevCpuUsage = process.cpuUsage();
        prevTime = now;

        const mem = process.memoryUsage();
        const heapMb = (mem.heapUsed / 1048576).toFixed(1);
        const rssMb = (mem.rss / 1048576).toFixed(1);
        const cpuRounded = cpuPct.toFixed(1);

        const stats = {
            cpu: parseFloat(cpuRounded),
            heap: parseFloat(heapMb),
            rss: parseFloat(rssMb)
        };

        // Send to renderer
        if (safeSend) {
            safeSend('perf-stats', stats);
        }

        // Buffer CSV line instead of writing every sample
        const timestamp = new Date(now).toISOString();
        csvBuffer.push(`${timestamp},${cpuRounded},${heapMb},${rssMb}\n`);

        sampleCount++;

        // Flush buffer to disk periodically (~30s)
        if (sampleCount % FLUSH_INTERVAL === 0 && csvBuffer.length > 0) {
            const batch = csvBuffer.join('');
            csvBuffer = [];
            fsPromises.appendFile(logPath, batch).catch(e => { if (!logWarned) { logger.warn('[PerfMonitor]', 'Log write failed:', e?.message); logWarned = true; } });
        }

        // Deterministic rotation check (~5min)
        if (sampleCount % ROTATE_INTERVAL === 0) {
            rotateLog();
        }
    }

    async function rotateLog() {
        try {
            const content = await fsPromises.readFile(logPath, 'utf-8');
            const lines = content.split('\n');
            if (lines.length > MAX_LOG_LINES) {
                // Keep header + last half
                const half = Math.floor(MAX_LOG_LINES / 2);
                const header = lines[0];
                const kept = [header, ...lines.slice(-half)];
                await fsPromises.writeFile(logPath, kept.join('\n'));
            }
        } catch {}
    }

    function stop() {
        if (interval) {
            clearInterval(interval);
            interval = null;
            // Flush remaining buffered samples
            if (csvBuffer.length > 0 && logPath) {
                const batch = csvBuffer.join('');
                csvBuffer = [];
                fsPromises.appendFile(logPath, batch).catch(e => { if (!logWarned) { logger.warn('[PerfMonitor]', 'Log write failed:', e?.message); logWarned = true; } });
            }
            logger.info('[PerfMonitor]', 'Stopped');
        }
    }

    function isRunning() {
        return interval !== null;
    }

    return { start, stop, isRunning };
}

module.exports = { createPerfMonitor };
