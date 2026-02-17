/**
 * IPC handlers for voice backend management.
 * Handles: get-voice-status, start-voice, stop-voice, voice-restart,
 *          send-query, set-voice-mode, send-image, list-audio-devices,
 *          get-detected-keys, stop-speaking
 */

const { ipcMain } = require('electron');

/**
 * Register voice backend IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerVoiceHandlers(ctx, validators) {
    ipcMain.handle('get-voice-status', () => {
        const voiceBackend = ctx.getVoiceBackend();
        return {
            success: true,
            data: {
                running: voiceBackend?.isRunning() || false,
                pid: voiceBackend?.getProcess()?.pid
            }
        };
    });

    ipcMain.handle('start-voice', () => {
        if (!ctx.getVoiceBackend()?.isRunning()) {
            ctx.startVoiceBackendService();
            return { success: true };
        }
        return { success: false, error: 'already running' };
    });

    ipcMain.handle('stop-voice', () => {
        const voiceBackend = ctx.getVoiceBackend();
        if (voiceBackend?.isRunning()) {
            voiceBackend.stop();
            return { success: true };
        }
        return { success: false, error: 'not running' };
    });

    // Manual restart (resets retry counter for user-initiated recovery)
    ipcMain.handle('voice-restart', () => {
        const voiceBackend = ctx.getVoiceBackend();
        if (voiceBackend) {
            voiceBackend.restart();
            return { success: true };
        }
        return { success: false, error: 'backend not initialized' };
    });

    // Voice backend communication
    ipcMain.handle('send-query', (event, query) => {
        const v = validators['send-query'](query);
        if (!v.valid) return { success: false, error: v.error };
        ctx.sendToVoiceBackend({ command: 'query', text: v.value.text, image: v.value.image });
        return { success: true };
    });

    ipcMain.handle('set-voice-mode', (event, mode) => {
        const v = validators['set-voice-mode'](mode);
        if (!v.valid) return { success: false, error: v.error };
        ctx.sendToVoiceBackend({ command: 'set_mode', mode: v.value });
        return { success: true };
    });

    // Image handling - send to voice backend
    ipcMain.handle('send-image', async (event, imageData) => {
        const v = validators['send-image'](imageData);
        if (!v.valid) return { success: false, error: v.error };
        const result = await ctx.sendImageToVoiceBackend(v.value);
        return { success: true, data: result };
    });

    // Audio device enumeration (asks voice backend)
    ipcMain.handle('list-audio-devices', async () => {
        const devices = ctx.listAudioDevices ? await ctx.listAudioDevices() : null;
        return { success: true, data: devices };
    });

    // Interrupt in-progress TTS playback (no effect during startup greeting)
    ipcMain.handle('stop-speaking', () => {
        const voiceBackend = ctx.getVoiceBackend();
        if (voiceBackend) voiceBackend.stopSpeaking();
        return { success: true };
    });

    // Detect API keys from environment (returns provider names only, not keys)
    ipcMain.handle('get-detected-keys', () => {
        const { detectApiKeys } = require('../services/provider-detector');
        const detected = detectApiKeys();
        // Return only provider names that have keys — never send actual keys to renderer
        const keys = Object.keys(detected).filter(k => !k.startsWith('_'));
        return { success: true, data: keys };
    });
}

module.exports = { registerVoiceHandlers };
