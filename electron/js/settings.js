/**
 * settings.js - Settings UI + keybind recorder
 */

import { state } from './state.js';
import { formatKeybind } from './utils.js';
import { navigateTo } from './navigation.js';

/**
 * Toggle settings - navigates to settings page or back to chat
 */
export function toggleSettings() {
    if (state.currentPage === 'settings') {
        // Go back to chat
        navigateTo('chat');
        state.settingsVisible = false;
    } else {
        // Navigate to settings page
        navigateTo('settings');
        state.settingsVisible = true;
        loadSettingsUI();
    }
}

/**
 * Load settings UI from config
 */
export async function loadSettingsUI() {
    try {
        state.currentConfig = await window.voiceMirror.config.get();
        console.log('[Settings] Loaded config:', state.currentConfig);

        // Activation mode
        const mode = state.currentConfig.behavior?.activationMode || 'wakeWord';
        document.querySelector(`input[name="activationMode"][value="${mode}"]`).checked = true;
        updateActivationModeUI(mode);

        // Keybinds
        document.getElementById('keybind-toggle').textContent =
            formatKeybind(state.currentConfig.behavior?.hotkey || 'CommandOrControl+Shift+V');
        const pttKeyRaw = state.currentConfig.behavior?.pttKey || 'MouseButton4';
        document.getElementById('keybind-ptt').textContent = formatKeybind(pttKeyRaw);
        document.getElementById('keybind-ptt').dataset.rawKey = pttKeyRaw;

        // Wake word settings
        document.getElementById('wake-word-phrase').value = state.currentConfig.wakeWord?.phrase || 'hey_claude';
        document.getElementById('wake-word-sensitivity').value = state.currentConfig.wakeWord?.sensitivity || 0.5;
        document.getElementById('sensitivity-value').textContent = state.currentConfig.wakeWord?.sensitivity || 0.5;

        // Voice settings
        document.getElementById('tts-voice').value = state.currentConfig.voice?.ttsVoice || 'af_bella';
        document.getElementById('tts-speed').value = state.currentConfig.voice?.ttsSpeed || 1.0;
        document.getElementById('speed-value').textContent = (state.currentConfig.voice?.ttsSpeed || 1.0) + 'x';
        document.getElementById('stt-model').value = state.currentConfig.voice?.sttModel || 'parakeet';

        // Appearance
        document.getElementById('orb-size').value = state.currentConfig.appearance?.orbSize || 64;
        document.getElementById('orb-size-value').textContent = (state.currentConfig.appearance?.orbSize || 64) + 'px';
        document.getElementById('theme-select').value = state.currentConfig.appearance?.theme || 'dark';

        // Behavior
        document.getElementById('start-minimized').checked = state.currentConfig.behavior?.startMinimized || false;
        document.getElementById('click-to-talk').checked = state.currentConfig.behavior?.clickToTalk !== false;

    } catch (err) {
        console.error('[Settings] Failed to load config:', err);
    }
}

/**
 * Update UI based on activation mode
 */
export function updateActivationModeUI(mode) {
    const wakeWordSettings = document.getElementById('wake-word-settings');
    const pttKeybindRow = document.getElementById('ptt-keybind-row');

    wakeWordSettings.style.display = mode === 'wakeWord' ? 'block' : 'none';
    pttKeybindRow.style.display = mode === 'pushToTalk' ? 'flex' : 'none';
}

/**
 * Save settings to config
 */
export async function saveSettings() {
    const activationMode = document.querySelector('input[name="activationMode"]:checked').value;

    const updates = {
        behavior: {
            activationMode: activationMode,
            hotkey: document.getElementById('keybind-toggle').textContent
                .replace(/ \+ /g, '+')
                .replace('Ctrl', 'CommandOrControl'),
            pttKey: document.getElementById('keybind-ptt').dataset.rawKey ||
                document.getElementById('keybind-ptt').textContent.replace(/ \+ /g, '+'),
            startMinimized: document.getElementById('start-minimized').checked,
            clickToTalk: document.getElementById('click-to-talk').checked
        },
        wakeWord: {
            phrase: document.getElementById('wake-word-phrase').value,
            sensitivity: parseFloat(document.getElementById('wake-word-sensitivity').value),
            enabled: activationMode === 'wakeWord'
        },
        voice: {
            ttsVoice: document.getElementById('tts-voice').value,
            ttsSpeed: parseFloat(document.getElementById('tts-speed').value),
            sttModel: document.getElementById('stt-model').value
        },
        appearance: {
            orbSize: parseInt(document.getElementById('orb-size').value),
            theme: document.getElementById('theme-select').value
        }
    };

    try {
        const newConfig = await window.voiceMirror.config.set(updates);
        console.log('[Settings] Saved config:', newConfig);

        // Apply activation mode immediately
        if (activationMode === 'callMode') {
            await window.voiceMirror.python.setCallMode(true);
            state.callModeActive = true;
            updateCallModeUI();
        } else {
            await window.voiceMirror.python.setCallMode(false);
            state.callModeActive = false;
            updateCallModeUI();
        }

        // Update welcome message with new mode
        window.updateWelcomeMessage();

        // Show save confirmation
        const saveBtn = document.querySelector('.settings-btn.primary');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saved!';
        saveBtn.style.background = '#4ade80';
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.style.background = '';
        }, 1500);

    } catch (err) {
        console.error('[Settings] Failed to save:', err);
        alert('Failed to save settings: ' + err.message);
    }
}

/**
 * Reset settings to defaults
 */
export async function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;

    try {
        await window.voiceMirror.config.reset();
        loadSettingsUI();
        window.updateWelcomeMessage();
        console.log('[Settings] Reset to defaults');
    } catch (err) {
        console.error('[Settings] Failed to reset:', err);
    }
}

/**
 * Update call mode UI
 */
function updateCallModeUI() {
    const callModeBtn = document.getElementById('call-mode-btn');
    const statusText = document.getElementById('status-text');

    if (state.callModeActive) {
        callModeBtn.classList.add('call-active');
        callModeBtn.title = 'Call Mode ON (always listening)';
        statusText.textContent = 'Call active - speak anytime';
    } else {
        callModeBtn.classList.remove('call-active');
        callModeBtn.title = 'Call Mode (always listening)';
        statusText.textContent = 'Listening...';
    }
}

/**
 * Initialize settings event listeners
 */
export function initSettings() {
    // Activation mode change handler
    document.querySelectorAll('input[name="activationMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateActivationModeUI(e.target.value);
        });
    });

    // Slider value displays
    document.getElementById('wake-word-sensitivity').addEventListener('input', (e) => {
        document.getElementById('sensitivity-value').textContent = e.target.value;
    });

    document.getElementById('tts-speed').addEventListener('input', (e) => {
        document.getElementById('speed-value').textContent = e.target.value + 'x';
    });

    document.getElementById('orb-size').addEventListener('input', (e) => {
        document.getElementById('orb-size-value').textContent = e.target.value + 'px';
    });

    // Keybind recording
    document.querySelectorAll('.keybind-input').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.recordingKeybind) {
                state.recordingKeybind.classList.remove('recording');
                state.recordingKeybind.textContent = state.recordingKeybind.dataset.originalText;
            }

            state.recordingKeybind = btn;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = 'Press key...';
            btn.classList.add('recording');
        });
    });

    document.addEventListener('keydown', (e) => {
        if (!state.recordingKeybind) return;

        e.preventDefault();
        e.stopPropagation();

        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');

        // Add the actual key if it's not a modifier
        const key = e.key;
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
            parts.push(key.length === 1 ? key.toUpperCase() : key);
        }

        if (parts.length > 0) {
            const keybind = parts.join(' + ');
            const rawKey = parts.join('+');
            state.recordingKeybind.textContent = keybind;
            state.recordingKeybind.dataset.rawKey = rawKey;
            state.recordingKeybind.classList.remove('recording');
            state.recordingKeybind = null;
        }
    });

    // Mouse button detection for PTT keybind
    document.addEventListener('mousedown', (e) => {
        if (!state.recordingKeybind) return;

        const isPttKeybind = state.recordingKeybind.id === 'keybind-ptt';
        if (!isPttKeybind) return;

        let rawKey = null;
        if (e.button === 3) {
            rawKey = 'MouseButton4';
        } else if (e.button === 4) {
            rawKey = 'MouseButton5';
        } else if (e.button === 1) {
            rawKey = 'MouseButton3';
        }

        if (rawKey) {
            e.preventDefault();
            e.stopPropagation();
            state.recordingKeybind.textContent = formatKeybind(rawKey);
            state.recordingKeybind.dataset.rawKey = rawKey;
            state.recordingKeybind.classList.remove('recording');
            state.recordingKeybind = null;
        }
    });

    // Click outside to cancel keybind recording
    document.addEventListener('click', (e) => {
        if (state.recordingKeybind && !e.target.classList.contains('keybind-input')) {
            state.recordingKeybind.classList.remove('recording');
            state.recordingKeybind.textContent = state.recordingKeybind.dataset.originalText;
            state.recordingKeybind = null;
        }
    });
}

// Expose functions globally for onclick handlers
window.toggleSettings = toggleSettings;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.loadSettingsUI = loadSettingsUI;
