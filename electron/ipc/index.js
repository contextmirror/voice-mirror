/**
 * IPC handler registrations for Voice Mirror Electron.
 * Delegates to sub-modules organized by domain.
 */

const { validators } = require('./validators');
const { registerWindowHandlers } = require('./window');
const { registerConfigHandlers } = require('./config');
const { registerScreenHandlers } = require('./screen');
const { registerAIHandlers } = require('./ai');
const { registerMiscHandlers } = require('./misc');

/**
 * Register all IPC handlers.
 * @param {Object} ctx - Application context (same shape as the old ipc-handlers.js)
 */
function registerIpcHandlers(ctx) {
    registerConfigHandlers(ctx, validators);
    registerWindowHandlers(ctx, validators);
    registerScreenHandlers(ctx, validators);
    registerAIHandlers(ctx, validators);
    registerMiscHandlers(ctx, validators);
}

module.exports = { registerIpcHandlers };
