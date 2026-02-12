/**
 * Shared paths and constants for MCP server handlers.
 * Uses cross-platform paths (APPDATA on Windows, ~/.config on Linux, ~/Library on macOS).
 */

const { getDataDir } = require('./lib/memory/utils');

const HOME_DATA_DIR = getDataDir();
const CLAUDE_MESSAGES_PATH = require('path').join(HOME_DATA_DIR, 'inbox.json');
const CLAUDE_STATUS_PATH = require('path').join(HOME_DATA_DIR, 'status.json');
const LISTENER_LOCK_PATH = require('path').join(HOME_DATA_DIR, 'listener_lock.json');

const STALE_TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes
const AUTO_CLEANUP_HOURS = 24;
const LISTENER_LOCK_TIMEOUT_MS = 310 * 1000;  // Lock expires after 310s (slightly longer than 300s default listen timeout)

module.exports = {
    HOME_DATA_DIR,
    CLAUDE_MESSAGES_PATH,
    CLAUDE_STATUS_PATH,
    LISTENER_LOCK_PATH,
    STALE_TIMEOUT_MS,
    AUTO_CLEANUP_HOURS,
    LISTENER_LOCK_TIMEOUT_MS
};
