/**
 * Voice Mirror Memory System - Utilities
 * Shared helper functions for the memory subsystem
 */

const crypto = require('crypto');
const path = require('path');
const os = require('os');

/**
 * Get the memory directory path based on platform
 * @returns {string} Path to memory directory
 */
function getMemoryDir() {
    const platform = process.platform;

    if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'voice-mirror-electron', 'memory');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'voice-mirror-electron', 'memory');
    } else {
        // Linux and others
        return path.join(os.homedir(), '.config', 'voice-mirror-electron', 'memory');
    }
}

/**
 * Get the data directory path (for inbox, etc.)
 * @returns {string} Path to data directory
 */
function getDataDir() {
    const platform = process.platform;

    if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'voice-mirror-electron', 'data');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'voice-mirror-electron', 'data');
    } else {
        return path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
    }
}

/**
 * Get the config base directory (parent of 'voice-mirror-electron')
 * @returns {string} Path to config base
 */
function getConfigBase() {
    const platform = process.platform;

    if (platform === 'win32') {
        return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    }
}

/**
 * Get the config file path for Voice Mirror
 * @returns {string} Path to config.json
 */
function getConfigPath() {
    return path.join(getConfigBase(), 'voice-mirror-electron', 'config.json');
}

/**
 * Get the cache directory for models
 * @returns {string} Path to model cache directory
 */
function getModelCacheDir() {
    const platform = process.platform;

    if (platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'voice-mirror', 'models');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Caches', 'voice-mirror', 'models');
    } else {
        return path.join(os.homedir(), '.cache', 'voice-mirror', 'models');
    }
}

/**
 * Calculate SHA-256 hash of text
 * @param {string} text - Text to hash
 * @returns {string} Hex-encoded hash
 */
function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Generate a unique ID with prefix
 * @param {string} prefix - ID prefix (e.g., 'chunk', 'mem')
 * @returns {string} Unique ID
 */
function generateId(prefix = 'id') {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${random}`;
}

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Date string
 */
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get current time in HH:MM format
 * @returns {string} Time string
 */
function getCurrentTime() {
    return new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

/**
 * Estimate token count from text (rough approximation)
 * ~4 characters per token for English text
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Race a promise against a timeout
 * @param {Promise} promise - Promise to race
 * @param {number} ms - Timeout in milliseconds
 * @param {string} [label] - Description for error message
 * @returns {Promise} Result of the promise
 */
function withTimeout(promise, ms, label = 'operation') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Retry pattern for retryable errors
 */
const RETRYABLE_PATTERN = /rate[_ ]limit|too many requests|429|resource has been exhausted|5\d\d|cloudflare|ECONNRESET|ETIMEDOUT|socket hang up/i;

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3]
 * @param {number} [options.baseDelay=500]
 * @param {number} [options.maxDelay=8000]
 * @param {RegExp} [options.retryablePattern]
 * @returns {Promise} Result of the function
 */
async function withRetry(fn, options = {}) {
    const {
        maxAttempts = 3,
        baseDelay = 500,
        maxDelay = 8000,
        retryablePattern = RETRYABLE_PATTERN
    } = options;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt >= maxAttempts || !retryablePattern.test(err.message)) {
                throw err;
            }
            // Exponential backoff with 20% jitter
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
            const jitter = delay * 0.2 * (Math.random() - 0.5);
            await new Promise(r => setTimeout(r, delay + jitter));
        }
    }
    throw lastError;
}

/**
 * Run async tasks with a concurrency limit
 * @param {Array<Function>} tasks - Array of async functions to execute
 * @param {number} concurrency - Max concurrent tasks
 * @returns {Promise<Array>} Results in order
 */
async function runWithConcurrency(tasks, concurrency = 4) {
    const results = new Array(tasks.length);
    let nextIndex = 0;
    let hasError = false;
    let firstError = null;

    async function worker() {
        while (!hasError) {
            const index = nextIndex++;
            if (index >= tasks.length) break;
            try {
                results[index] = await tasks[index]();
            } catch (err) {
                if (!hasError) {
                    hasError = true;
                    firstError = err;
                }
                break;
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    if (hasError) throw firstError;
    return results;
}

module.exports = {
    getMemoryDir,
    getDataDir,
    getConfigBase,
    getConfigPath,
    getModelCacheDir,
    sha256,
    generateId,
    getTodayDate,
    getCurrentTime,
    estimateTokens,
    withTimeout,
    withRetry,
    RETRYABLE_PATTERN,
    runWithConcurrency
};
