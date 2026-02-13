/**
 * IPC handlers for miscellaneous operations.
 * Handles: open-external, quit-app, hotkey-fallback, devlog,
 *          send-to-python, get-python-status, start-python, stop-python,
 *          python-restart, send-query, set-voice-mode, send-image,
 *          list-audio-devices, get-detected-keys, check-cli-available,
 *          install-cli, chat-list, chat-load, chat-save, chat-delete,
 *          chat-rename, apply-update, app-relaunch
 */

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ensureWithin } = require('../lib/safe-path');

/**
 * Register miscellaneous IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerMiscHandlers(ctx, validators) {
    // Dev logging from renderer -> vmr.log
    ipcMain.on('devlog', (_event, category, action, data) => {
        ctx.logger.devlog(category, action, data || {});
    });

    // Hotkey fallback from renderer — only honored when primary layers both failed
    ipcMain.on('hotkey-fallback', (event, id) => {
        const hotkeyManager = ctx.getHotkeyManager();
        if (!hotkeyManager) return;
        const binding = hotkeyManager.getBinding(id);
        if (binding && !binding.uiohookActive && !binding.globalShortcutActive) {
            ctx.logger.log('HOTKEY', `Fallback triggered for "${id}" from renderer`);
            binding.callback();
        }
    });

    // Open external URLs in default browser
    ipcMain.handle('open-external', async (event, url) => {
        const v = validators['open-external'](url);
        if (!v.valid) return { success: false, error: v.error };
        try {
            await shell.openExternal(v.value);
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Misc]', 'Failed to open external URL:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('quit-app', () => {
        app.isQuitting = true;
        app.quit();
        return { success: true };
    });

    // Audio device enumeration (asks Python backend)
    ipcMain.handle('list-audio-devices', async () => {
        const devices = ctx.listAudioDevices ? await ctx.listAudioDevices() : null;
        return { success: true, data: devices };
    });

    // Detect API keys from environment (returns provider names only, not keys)
    ipcMain.handle('get-detected-keys', () => {
        const { detectApiKeys } = require('../services/provider-detector');
        const detected = detectApiKeys();
        // Return only provider names that have keys — never send actual keys to renderer
        const keys = Object.keys(detected).filter(k => !k.startsWith('_'));
        return { success: true, data: keys };
    });

    // CLI availability check
    ipcMain.handle('check-cli-available', (_event, command) => {
        if (typeof command !== 'string' || command.length > 50) {
            return { success: false, error: 'Invalid command' };
        }
        const { isCLIAvailable } = require('../providers/cli-spawner');
        return { success: true, data: { available: isCLIAvailable(command) } };
    });

    // CLI install via npm global
    ipcMain.handle('install-cli', async (_event, packageName) => {
        const ALLOWED_PACKAGES = { opencode: 'opencode-ai' };

        if (typeof packageName !== 'string' || !ALLOWED_PACKAGES[packageName]) {
            return { success: false, error: `Package "${packageName}" is not allowed` };
        }

        const npmPackage = ALLOWED_PACKAGES[packageName];
        const { execFile } = require('child_process');
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

        return new Promise((resolve) => {
            execFile(npmCmd, ['install', '-g', npmPackage], {
                timeout: 120000,
                windowsHide: true,
                env: { ...process.env }
            }, (err, _stdout, stderr) => {
                if (err) {
                    ctx.logger.error('[CLI Install]', `Failed to install ${npmPackage}:`, err.message);
                    resolve({ success: false, error: err.message, stderr: stderr?.slice(0, 500) });
                } else {
                    ctx.logger.info('[CLI Install]', `Successfully installed ${npmPackage}`);
                    resolve({ success: true });
                }
            });
        });
    });

    // Image handling - send to Python backend
    ipcMain.handle('send-image', async (event, imageData) => {
        const v = validators['send-image'](imageData);
        if (!v.valid) return { success: false, error: v.error };
        const result = await ctx.sendImageToPython(v.value);
        return { success: true, data: result };
    });

    // Python backend communication
    ipcMain.handle('send-query', (event, query) => {
        const v = validators['send-query'](query);
        if (!v.valid) return { success: false, error: v.error };
        ctx.sendToPython({ command: 'query', text: v.value.text, image: v.value.image });
        return { success: true };
    });

    ipcMain.handle('set-voice-mode', (event, mode) => {
        const v = validators['set-voice-mode'](mode);
        if (!v.valid) return { success: false, error: v.error };
        ctx.sendToPython({ command: 'set_mode', mode: v.value });
        return { success: true };
    });

    ipcMain.handle('get-python-status', () => {
        const pythonBackend = ctx.getPythonBackend();
        return {
            success: true,
            data: {
                running: pythonBackend?.isRunning() || false,
                pid: pythonBackend?.getProcess()?.pid
            }
        };
    });

    ipcMain.handle('start-python', () => {
        if (!ctx.getPythonBackend()?.isRunning()) {
            ctx.startPythonVoiceMirror();
            return { success: true };
        }
        return { success: false, error: 'already running' };
    });

    ipcMain.handle('stop-python', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
            return { success: true };
        }
        return { success: false, error: 'not running' };
    });

    // Manual restart (resets retry counter for user-initiated recovery)
    ipcMain.handle('python-restart', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend) {
            pythonBackend.restart();
            return { success: true };
        }
        return { success: false, error: 'backend not initialized' };
    });

    // ========== Chat History Persistence ==========
    const chatsDir = path.join(app.getPath('userData'), 'chats');

    ipcMain.handle('chat-list', async () => {
        try {
            if (!fs.existsSync(chatsDir)) return { success: true, data: [] };
            const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));
            const chats = [];
            for (const file of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(chatsDir, file), 'utf-8'));
                    chats.push({
                        id: data.id,
                        name: data.name || 'Untitled',
                        created: data.created,
                        updated: data.updated,
                        messageCount: (data.messages || []).length,
                    });
                } catch { /* skip corrupt files */ }
            }
            chats.sort((a, b) => new Date(b.updated) - new Date(a.updated));
            return { success: true, data: chats };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to list chats:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-load', async (_event, id) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            if (!fs.existsSync(filePath)) return { success: false, error: 'Chat not found' };
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return { success: true, data };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to load chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-save', async (_event, chat) => {
        try {
            if (!chat || !chat.id) return { success: false, error: 'Invalid chat data' };
            if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
            const filePath = ensureWithin(chatsDir, `${chat.id}.json`);
            chat.updated = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to save chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-delete', async (_event, id) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to delete chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-rename', async (_event, id, name) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            if (!fs.existsSync(filePath)) return { success: false, error: 'Chat not found' };
            const chat = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            chat.name = name;
            chat.updated = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to rename chat:', err);
            return { success: false, error: err.message };
        }
    });

    // Update checker
    ipcMain.handle('apply-update', async () => {
        const checker = ctx.getUpdateChecker?.();
        if (checker) {
            return await checker.applyUpdate();
        }
        return { success: false, error: 'Update checker not initialized' };
    });

    // App relaunch (used after updates)
    ipcMain.handle('app-relaunch', () => {
        app.relaunch();
        app.exit(0);
        return { success: true };
    });
}

module.exports = { registerMiscHandlers };
