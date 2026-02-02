/**
 * Integration test harness — core utilities.
 *
 * Config backup/restore, inbox I/O, log parsing, assertions.
 * All file-based — no Electron dependency.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Paths (match mcp-server/paths.js)
const CONFIG_DIR = path.join(os.homedir(), '.config', 'voice-mirror-electron');
const DATA_DIR = path.join(CONFIG_DIR, 'data');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const CONFIG_BACKUP_PATH = path.join(CONFIG_DIR, 'config.json.test-bak');
const INBOX_PATH = path.join(DATA_DIR, 'inbox.json');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');
const LOCK_PATH = path.join(DATA_DIR, 'listener_lock.json');
const VMR_LOG_PATH = path.join(DATA_DIR, 'vmr.log');
const SPAWNER_LOG_PATH = path.join(CONFIG_DIR, 'claude-spawner-debug.log');

// ─── Config Operations ──────────────────────────────────────────

function backupConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, CONFIG_BACKUP_PATH);
        return true;
    }
    return false;
}

function restoreConfig() {
    if (fs.existsSync(CONFIG_BACKUP_PATH)) {
        fs.copyFileSync(CONFIG_BACKUP_PATH, CONFIG_PATH);
        fs.unlinkSync(CONFIG_BACKUP_PATH);
        return true;
    }
    return false;
}

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
        return null;
    }
}

function writeConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function patchConfig(dotPath, value) {
    const config = readConfig();
    if (!config) throw new Error('Cannot read config');
    const keys = dotPath.split('.');
    const last = keys.pop();
    let target = config;
    for (const k of keys) {
        if (!(k in target)) target[k] = {};
        target = target[k];
    }
    target[last] = value;
    writeConfig(config);
    return config;
}

function getConfigValue(dotPath, config) {
    config = config || readConfig();
    return dotPath.split('.').reduce((obj, k) => obj?.[k], config);
}

// ─── Inbox Operations ───────────────────────────────────────────

function readInbox() {
    try {
        const data = JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeInbox(messages) {
    fs.mkdirSync(path.dirname(INBOX_PATH), { recursive: true });
    fs.writeFileSync(INBOX_PATH, JSON.stringify(messages, null, 2), 'utf-8');
}

function sendMessage(from, message, opts = {}) {
    const inbox = readInbox();
    const msg = {
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from,
        message,
        timestamp: new Date().toISOString(),
        read_by: [],
        thread_id: opts.thread_id || null,
    };
    inbox.push(msg);
    // Cap at 100
    const trimmed = inbox.length > 100 ? inbox.slice(-100) : inbox;
    writeInbox(trimmed);
    return msg;
}

function clearInbox() {
    writeInbox([]);
}

function readUnread(reader = 'voice-claude') {
    const inbox = readInbox();
    return inbox.filter(m => !m.read_by?.includes(reader));
}

function waitForResponse(fromSender, timeoutMs = 30000) {
    const start = Date.now();
    const baseline = readInbox().length;
    return new Promise((resolve, reject) => {
        const poll = () => {
            const inbox = readInbox();
            const newMsgs = inbox.slice(baseline).filter(m => m.from === fromSender);
            if (newMsgs.length > 0) return resolve(newMsgs[0]);
            if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for response from ${fromSender}`));
            setTimeout(poll, 500);
        };
        poll();
    });
}

// ─── Log Operations ─────────────────────────────────────────────

function getLogLines(logPath, sinceTimestamp) {
    try {
        const content = fs.readFileSync(logPath || VMR_LOG_PATH, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        if (!sinceTimestamp) return lines;
        return lines.filter(line => {
            const match = line.match(/^\[([\d-T:.Z]+)\]/);
            if (!match) return true; // include lines without timestamps
            return new Date(match[1]) >= new Date(sinceTimestamp);
        });
    } catch {
        return [];
    }
}

function searchLog(pattern, logPath, sinceTimestamp) {
    const lines = getLogLines(logPath, sinceTimestamp);
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    return lines.filter(line => re.test(line));
}

function countErrors(logPath, sinceTimestamp) {
    const lines = getLogLines(logPath, sinceTimestamp);
    return lines.filter(line => /\b(ERROR|WARN|error|warning)\b/i.test(line)).length;
}

// ─── Assertions ─────────────────────────────────────────────────

function createTestContext(suiteName) {
    const results = [];
    const startTime = Date.now();

    function assert(condition, label) {
        results.push({ label, passed: !!condition, suite: suiteName });
        return !!condition;
    }

    function assertEqual(actual, expected, label) {
        const passed = actual === expected;
        results.push({
            label,
            passed,
            suite: suiteName,
            detail: passed ? undefined : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        });
        return passed;
    }

    function assertContains(text, substring, label) {
        const passed = typeof text === 'string' && text.includes(substring);
        results.push({
            label,
            passed,
            suite: suiteName,
            detail: passed ? undefined : `"${(text || '').slice(0, 100)}" does not contain "${substring}"`,
        });
        return passed;
    }

    function assertNoErrors(logLines, label) {
        const errors = logLines.filter(l => /uncaught|unhandled/i.test(l));
        const passed = errors.length === 0;
        results.push({
            label,
            passed,
            suite: suiteName,
            detail: passed ? undefined : `Found ${errors.length} error(s): ${errors[0]?.slice(0, 100)}`,
        });
        return passed;
    }

    function assertConfigValue(dotPath, expected, label) {
        const actual = getConfigValue(dotPath);
        return assertEqual(actual, expected, label);
    }

    function skip(label, reason) {
        results.push({ label, passed: null, suite: suiteName, skipped: true, detail: reason });
    }

    function getResults() {
        return {
            suite: suiteName,
            duration: Date.now() - startTime,
            results,
            passed: results.filter(r => r.passed === true).length,
            failed: results.filter(r => r.passed === false).length,
            skipped: results.filter(r => r.skipped).length,
        };
    }

    return {
        assert, assertEqual, assertContains, assertNoErrors, assertConfigValue, skip,
        getResults,
    };
}

// ─── Exports ────────────────────────────────────────────────────

module.exports = {
    // Paths
    CONFIG_DIR, DATA_DIR, CONFIG_PATH, INBOX_PATH,
    LOCK_PATH, VMR_LOG_PATH, SPAWNER_LOG_PATH,

    // Config
    backupConfig, restoreConfig, readConfig, writeConfig, patchConfig, getConfigValue,

    // Inbox
    readInbox, writeInbox, sendMessage, clearInbox, readUnread, waitForResponse,

    // Logs
    getLogLines, searchLog, countErrors,

    // Test context
    createTestContext,
};
