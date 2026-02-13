/**
 * Performance monitor service for Voice Mirror Electron.
 * Samples CPU and memory every 3 seconds, sends to renderer, logs to CSV.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

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

        interval = setInterval(() => sample(), 3000);
        sample(); // Immediate first sample so UI doesn't show "--"
        console.log('[PerfMonitor] Started');
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

        // Append to CSV (fire and forget)
        const timestamp = new Date(now).toISOString();
        const line = `${timestamp},${cpuRounded},${heapMb},${rssMb}\n`;
        fsPromises.appendFile(logPath, line).catch(() => {});

        // Rotate if needed (check every 100 samples ~5min)
        if (Math.random() < 0.033) {
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
            console.log('[PerfMonitor] Stopped');
        }
    }

    function isRunning() {
        return interval !== null;
    }

    return { start, stop, isRunning };
}

module.exports = { createPerfMonitor };
