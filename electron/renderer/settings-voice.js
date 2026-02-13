/**
 * settings-voice.js - Voice & Audio tab logic
 *
 * TTS adapter/voice selection, STT model, audio device dropdowns,
 * activation mode, wake word, keybind recording.
 */

import { state } from './state.js';
import { formatKeybind } from './utils.js';
import { createLog } from './log.js';
const log = createLog('[Settings:Voice]');

// TTS voice options by adapter
const TTS_VOICES = {
    kokoro: [
        { value: 'af_bella', label: 'Bella (Female)' },
        { value: 'af_nicole', label: 'Nicole (Female)' },
        { value: 'af_sarah', label: 'Sarah (Female)' },
        { value: 'am_adam', label: 'Adam (Male)' },
        { value: 'am_michael', label: 'Michael (Male)' },
        { value: 'bf_emma', label: 'Emma (British)' },
        { value: 'bm_george', label: 'George (British)' }
    ],
    qwen: [
        { value: 'Ryan', label: 'Ryan (Male)' },
        { value: 'Vivian', label: 'Vivian (Female)' },
        { value: 'Serena', label: 'Serena (Female)' },
        { value: 'Dylan', label: 'Dylan (Male)' },
        { value: 'Eric', label: 'Eric (Male)' },
        { value: 'Aiden', label: 'Aiden (Male)' },
        { value: 'Uncle_Fu', label: 'Uncle Fu (Male)' },
        { value: 'Ono_Anna', label: 'Ono Anna (Female, Japanese)' },
        { value: 'Sohee', label: 'Sohee (Female, Korean)' }
    ]
};

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
 * Update TTS adapter UI based on selected adapter
 */
export function updateTTSAdapterUI(adapter) {
    const modelSizeRow = document.getElementById('tts-model-size-row');
    const qwenHint = document.getElementById('tts-qwen-hint');
    const voiceSelect = document.getElementById('tts-voice');
    const currentVoice = voiceSelect.value;

    // Show/hide model size row and storage hint (only for Qwen)
    const isQwen = adapter === 'qwen';
    modelSizeRow.style.display = isQwen ? 'flex' : 'none';
    if (qwenHint) qwenHint.style.display = isQwen ? 'block' : 'none';

    // Update voice options based on adapter
    const voices = TTS_VOICES[adapter] || TTS_VOICES.kokoro;
    voiceSelect.innerHTML = '';
    for (const voice of voices) {
        const option = document.createElement('option');
        option.value = voice.value;
        option.textContent = voice.label;
        voiceSelect.appendChild(option);
    }

    // Try to preserve current voice if it exists in new adapter, otherwise use first
    const voiceExists = voices.some(v => v.value === currentVoice);
    voiceSelect.value = voiceExists ? currentVoice : voices[0].value;
}

/**
 * Load available audio devices from Python backend
 */
async function loadAudioDevices() {
    const inputSelect = document.getElementById('audio-input-device');
    const outputSelect = document.getElementById('audio-output-device');
    if (!inputSelect || !outputSelect) return;

    try {
        const devicesResult = await window.voiceMirror.python.listAudioDevices();
        const devices = devicesResult.data;
        if (!devices) return;

        // Populate input devices
        if (devices.input?.length > 0) {
            inputSelect.innerHTML = '<option value="">System Default</option>';
            for (const dev of devices.input) {
                const option = document.createElement('option');
                option.value = dev.name;
                option.textContent = dev.name;
                inputSelect.appendChild(option);
            }
            const savedInput = state.currentConfig?.voice?.inputDevice;
            if (savedInput) inputSelect.value = savedInput;
        }

        // Populate output devices
        if (devices.output?.length > 0) {
            outputSelect.innerHTML = '<option value="">System Default</option>';
            for (const dev of devices.output) {
                const option = document.createElement('option');
                option.value = dev.name;
                option.textContent = dev.name;
                outputSelect.appendChild(option);
            }
            const savedOutput = state.currentConfig?.voice?.outputDevice;
            if (savedOutput) outputSelect.value = savedOutput;
        }
    } catch (err) {
        log.info('Could not load audio devices:', err);
    }
}

/**
 * Load voice-related settings into the UI from config.
 * Called by loadSettingsUI() in the coordinator.
 */
export async function loadVoiceSettingsUI() {
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
    const statsKeyRaw = state.currentConfig.behavior?.statsHotkey || 'CommandOrControl+Shift+M';
    document.getElementById('keybind-stats').textContent = formatKeybind(statsKeyRaw);
    document.getElementById('keybind-stats').dataset.rawKey = statsKeyRaw;
    const dictationKeyRaw = state.currentConfig.behavior?.dictationKey || 'MouseButton5';
    document.getElementById('keybind-dictation').textContent = formatKeybind(dictationKeyRaw);
    document.getElementById('keybind-dictation').dataset.rawKey = dictationKeyRaw;

    // Wake word settings
    document.getElementById('wake-word-phrase').value = state.currentConfig.wakeWord?.phrase || 'hey_claude';
    document.getElementById('wake-word-sensitivity').value = state.currentConfig.wakeWord?.sensitivity || 0.5;
    document.getElementById('sensitivity-value').textContent = state.currentConfig.wakeWord?.sensitivity || 0.5;

    // Voice settings
    const ttsAdapter = state.currentConfig.voice?.ttsAdapter || 'kokoro';
    document.getElementById('tts-adapter').value = ttsAdapter;
    document.getElementById('tts-model-size').value = state.currentConfig.voice?.ttsModelSize || '0.6B';
    updateTTSAdapterUI(ttsAdapter);
    document.getElementById('tts-voice').value = state.currentConfig.voice?.ttsVoice || 'af_bella';
    document.getElementById('tts-speed').value = state.currentConfig.voice?.ttsSpeed || 1.0;
    document.getElementById('speed-value').textContent = (state.currentConfig.voice?.ttsSpeed || 1.0) + 'x';
    document.getElementById('tts-volume').value = state.currentConfig.voice?.ttsVolume || 1.0;
    document.getElementById('volume-value').textContent = Math.round((state.currentConfig.voice?.ttsVolume || 1.0) * 100) + '%';
    document.getElementById('stt-model').value = state.currentConfig.voice?.sttModel || 'parakeet';

    // Audio devices
    await loadAudioDevices();
}

/**
 * Collect voice/behavior save data from current UI state.
 * Called by saveSettings() in the coordinator.
 */
export function collectVoiceSaveData() {
    const activationMode = document.querySelector('input[name="activationMode"]:checked').value;

    return {
        behavior: {
            activationMode: activationMode,
            hotkey: (document.getElementById('keybind-toggle').dataset.rawKey ||
                document.getElementById('keybind-toggle').textContent)
                .replace(/ \+ /g, '+')
                .replace('Ctrl', 'CommandOrControl'),
            pttKey: document.getElementById('keybind-ptt').dataset.rawKey ||
                document.getElementById('keybind-ptt').textContent.replace(/ \+ /g, '+'),
            statsHotkey: (document.getElementById('keybind-stats').dataset.rawKey ||
                document.getElementById('keybind-stats').textContent)
                .replace(/ \+ /g, '+')
                .replace('Ctrl', 'CommandOrControl'),
            dictationKey: (document.getElementById('keybind-dictation').dataset.rawKey ||
                document.getElementById('keybind-dictation').textContent)
                .replace(/ \+ /g, '+')
                .replace('Ctrl', 'CommandOrControl'),
        },
        wakeWord: {
            phrase: document.getElementById('wake-word-phrase').value,
            sensitivity: parseFloat(document.getElementById('wake-word-sensitivity').value),
            enabled: activationMode === 'wakeWord'
        },
        voice: {
            ttsAdapter: document.getElementById('tts-adapter').value,
            ttsVoice: document.getElementById('tts-voice').value,
            ttsModelSize: document.getElementById('tts-model-size').value,
            ttsSpeed: parseFloat(document.getElementById('tts-speed').value),
            ttsVolume: parseFloat(document.getElementById('tts-volume').value),
            sttModel: document.getElementById('stt-model').value,
            inputDevice: document.getElementById('audio-input-device').value || null,
            outputDevice: document.getElementById('audio-output-device').value || null
        }
    };
}

/**
 * Initialize voice tab event handlers.
 * Called by initSettings() in the coordinator.
 */
export function initVoiceTab() {
    // Activation mode change handler
    document.querySelectorAll('input[name="activationMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateActivationModeUI(e.target.value);
        });
    });

    // TTS adapter change handler
    document.getElementById('tts-adapter').addEventListener('change', (e) => {
        updateTTSAdapterUI(e.target.value);
    });

    // Slider value displays
    document.getElementById('wake-word-sensitivity').addEventListener('input', (e) => {
        document.getElementById('sensitivity-value').textContent = e.target.value;
    });

    document.getElementById('tts-speed').addEventListener('input', (e) => {
        document.getElementById('speed-value').textContent = e.target.value + 'x';
    });

    document.getElementById('tts-volume').addEventListener('input', (e) => {
        document.getElementById('volume-value').textContent = Math.round(e.target.value * 100) + '%';
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

    // Mouse button detection for keybind recording (supports Razer Naga and similar multi-button mice)
    document.addEventListener('mousedown', (e) => {
        if (!state.recordingKeybind) return;

        // Skip left (0) and right (2) click -- those are for UI interaction
        if (e.button === 0 || e.button === 2) return;

        // Map DOM button numbers to MouseButton names
        // DOM: 1=middle, 3=back, 4=forward, 5+=extra side buttons
        const buttonMap = {
            1: 'MouseButton3',
            3: 'MouseButton4',
            4: 'MouseButton5',
        };
        // Support extra mouse buttons (DOM button 5+ -> MouseButton6+)
        const rawKey = buttonMap[e.button] || `MouseButton${e.button + 1}`;

        e.preventDefault();
        e.stopPropagation();
        state.recordingKeybind.textContent = formatKeybind(rawKey);
        state.recordingKeybind.dataset.rawKey = rawKey;
        state.recordingKeybind.classList.remove('recording');
        state.recordingKeybind = null;
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
