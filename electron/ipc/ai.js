/**
 * IPC handlers for AI provider management.
 * Handles: start-claude, stop-claude, interrupt-ai, get-claude-status,
 *          claude-pty-input, claude-pty-resize, ai-scan-providers,
 *          ai-get-providers, ai-set-provider, ai-get-provider,
 *          start-all, stop-all
 */

const { ipcMain } = require('electron');
const { CLI_PROVIDERS } = require('../constants');

/**
 * Register AI provider IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerAIHandlers(ctx, validators) {
    ipcMain.handle('start-claude', (event, cols, rows) => {
        if (!ctx.isAIProviderRunning()) {
            const started = ctx.startAIProvider(cols, rows);
            return { success: started, data: { started } };
        }
        return { success: false, error: 'already running' };
    });

    ipcMain.handle('stop-claude', () => {
        if (ctx.isAIProviderRunning()) {
            ctx.stopAIProvider();
            return { success: true };
        }
        return { success: false, error: 'not running' };
    });

    ipcMain.handle('interrupt-ai', () => {
        const interrupted = ctx.interruptAIProvider?.() || false;
        return { success: interrupted };
    });

    ipcMain.handle('get-claude-status', () => {
        const providerType = ctx.getAppConfig()?.ai?.provider || 'claude';
        return {
            success: true,
            data: {
                running: ctx.isAIProviderRunning(),
                mode: CLI_PROVIDERS.includes(providerType) ? 'pty' : 'api',
                provider: providerType
            }
        };
    });

    // PTY input/resize handlers for terminal
    // Routes to Claude PTY or OpenAI-compatible provider based on config
    ipcMain.handle('claude-pty-input', (event, data) => {
        const v = validators['claude-pty-input'](data);
        if (!v.valid) return { success: false, error: v.error };
        data = v.value;
        const providerType = ctx.getAppConfig()?.ai?.provider || 'claude';
        const aiManager = ctx.getAIManager();

        if (CLI_PROVIDERS.includes(providerType)) {
            // CLI providers use PTY - send raw input via aiManager
            if (aiManager && aiManager.sendRawInputData(data)) {
                return { success: true };
            }
        } else {
            // OpenAI-compatible providers - accumulate input and send on Enter
            const provider = aiManager?.getProvider();
            if (provider && provider.isRunning()) {
                const tuiMode = provider.hasTUI && provider.hasTUI();

                // TUI scroll keys (arrow up/down, page up/down)
                if (tuiMode && provider.tui) {
                    if (data === '\x1b[A') { provider.tui.scrollChat(-1); return { success: true }; }
                    if (data === '\x1b[B') { provider.tui.scrollChat(1); return { success: true }; }
                    if (data === '\x1b[5~') { provider.tui.scrollChat(-10); return { success: true }; }
                    if (data === '\x1b[6~') { provider.tui.scrollChat(10); return { success: true }; }
                }

                // Check if Enter key was pressed (CR or LF)
                if (data === '\r' || data === '\n') {
                    // Send accumulated input
                    if (provider._inputBuffer && provider._inputBuffer.trim()) {
                        provider.sendInput(provider._inputBuffer.trim());
                        provider._inputBuffer = '';
                    }
                } else if (data === '\x7f' || data === '\b') {
                    // Backspace - remove last character
                    if (provider._inputBuffer) {
                        provider._inputBuffer = provider._inputBuffer.slice(0, -1);
                        if (!tuiMode) {
                            // Echo backspace to terminal (suppressed when TUI handles display)
                            ctx.safeSend('claude-terminal', {
                                type: 'stdout',
                                text: '\b \b'
                            });
                        }
                    }
                } else if (data.charCodeAt(0) >= 32 || data === '\t') {
                    // Printable characters - accumulate
                    provider._inputBuffer = (provider._inputBuffer || '') + data;
                    if (!tuiMode) {
                        // Echo to terminal (suppressed when TUI handles display)
                        ctx.safeSend('claude-terminal', {
                            type: 'stdout',
                            text: data
                        });
                    }
                }
                return { success: true };
            }
        }
        return { success: false, error: 'not running' };
    });

    ipcMain.handle('claude-pty-resize', (event, cols, rows) => {
        const v = validators['claude-pty-resize'](cols, rows);
        if (!v.valid) return { success: false, error: v.error };

        // Always track dimensions so provider switches can use correct size
        // Update shared state via ctx so config module can access it
        if (ctx._setLastTermDims) {
            ctx._setLastTermDims(v.value.cols, v.value.rows);
        }

        const providerType = ctx.getAppConfig()?.ai?.provider || 'claude';
        const aiManager = ctx.getAIManager();

        if (CLI_PROVIDERS.includes(providerType) && aiManager) {
            aiManager.resize(v.value.cols, v.value.rows);
            return { success: true };
        }

        // API providers — forward resize to TUI renderer
        if (!CLI_PROVIDERS.includes(providerType)) {
            const provider = aiManager?.getProvider();
            if (provider && provider.resize) {
                provider.resize(v.value.cols, v.value.rows);
                return { success: true };
            }
        }
        return { success: false, error: CLI_PROVIDERS.includes(providerType) ? 'not running' : 'not PTY' };
    });

    // AI Provider IPC handlers
    ipcMain.handle('ai-scan-providers', async () => {
        const { providerDetector } = require('../services/provider-detector');
        const results = await providerDetector.scanAll();
        return { success: true, data: results };
    });

    ipcMain.handle('ai-get-providers', async () => {
        const { providerDetector } = require('../services/provider-detector');
        return { success: true, data: providerDetector.getCachedStatus() };
    });

    ipcMain.handle('ai-set-provider', async (event, providerId, model) => {
        const v = validators['ai-set-provider'](providerId, model);
        if (!v.valid) return { success: false, error: v.error };
        const newConfig = await ctx.config.updateConfigAsync({
            ai: {
                provider: v.value.providerId,
                model: v.value.model
            }
        });
        ctx.setAppConfig(newConfig);
        ctx.logger.info('[AI]', `Provider set to: ${v.value.providerId}${v.value.model ? ' (' + v.value.model + ')' : ''}`);
        return { success: true, provider: v.value.providerId, model: v.value.model };
    });

    ipcMain.handle('ai-get-provider', () => {
        const appConfig = ctx.getAppConfig();
        return {
            success: true,
            data: {
                provider: appConfig?.ai?.provider || 'claude',
                model: appConfig?.ai?.model || null,
                autoDetect: appConfig?.ai?.autoDetect !== false
            }
        };
    });

    // Start both Voice + AI provider together
    ipcMain.handle('start-all', () => {
        if (!ctx.getPythonBackend()?.isRunning()) ctx.startPythonVoiceMirror();
        if (!ctx.isAIProviderRunning()) {
            // Use last known terminal dimensions so TUI renders at correct size
            const dims = ctx._getLastTermDims ? ctx._getLastTermDims() : {};
            ctx.startAIProvider(dims.cols, dims.rows);
        }
        return { success: true };
    });

    ipcMain.handle('stop-all', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
        }
        ctx.stopAIProvider();
        return { success: true };
    });
}

module.exports = { registerAIHandlers };
