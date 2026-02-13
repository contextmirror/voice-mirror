/**
 * Barrel file for electron/lib utilities.
 */

const { createJsonFileWatcher } = require('./json-file-watcher');
const { startOllamaServer, ensureLocalLLMRunning } = require('./ollama-launcher');
const { ensureWithin } = require('./safe-path');
const { captureDisplayWindows } = require('./windows-screen-capture');

module.exports = {
    createJsonFileWatcher,
    startOllamaServer,
    ensureLocalLLMRunning,
    ensureWithin,
    captureDisplayWindows
};
