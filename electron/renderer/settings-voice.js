/**
 * settings-voice.js - Voice & Audio tab logic
 *
 * TTS adapter/voice selection, STT model, audio device dropdowns,
 * activation mode, wake word, keybind recording.
 *
 * Uses data-driven ADAPTER_REGISTRY / STT_REGISTRY to dynamically
 * show/hide conditional UI fields per adapter.
 */

import { state } from './state.js';
import { formatKeybind } from './utils.js';
import { createLog } from './log.js';
const log = createLog('[Settings:Voice]');

// ── TTS Adapter Registry (data-driven) ──────────────────────────────────────

const ADAPTER_REGISTRY = {
    kokoro: {
        label: 'Kokoro (Local, fast, ~100MB)',
        category: 'local',
        voices: [
            { value: 'af_bella', label: 'Bella (Female)' },
            { value: 'af_nicole', label: 'Nicole (Female)' },
            { value: 'af_sarah', label: 'Sarah (Female)' },
            { value: 'af_sky', label: 'Sky (Female)' },
            { value: 'am_adam', label: 'Adam (Male)' },
            { value: 'am_michael', label: 'Michael (Male)' },
            { value: 'bf_emma', label: 'Emma (British Female)' },
            { value: 'bf_isabella', label: 'Isabella (British Female)' },
            { value: 'bm_george', label: 'George (British Male)' },
            { value: 'bm_lewis', label: 'Lewis (British Male)' }
        ],
        showModelSize: false,
        showApiKey: false,
        showEndpoint: false,
        showModelPath: false
    },
    qwen: {
        label: 'Qwen3-TTS (Local, voice cloning, ~3-7GB)',
        category: 'local',
        voices: [
            { value: 'Ryan', label: 'Ryan (Male)' },
            { value: 'Vivian', label: 'Vivian (Female)' },
            { value: 'Serena', label: 'Serena (Female)' },
            { value: 'Dylan', label: 'Dylan (Male)' },
            { value: 'Eric', label: 'Eric (Male)' },
            { value: 'Aiden', label: 'Aiden (Male)' },
            { value: 'Uncle_Fu', label: 'Uncle Fu (Male)' },
            { value: 'Ono_Anna', label: 'Ono Anna (Female, Japanese)' },
            { value: 'Sohee', label: 'Sohee (Female, Korean)' }
        ],
        showModelSize: true,
        modelSizes: [
            { value: '0.6B', label: '0.6B (~1.5GB disk, ~2GB VRAM)' },
            { value: '1.7B', label: '1.7B (~3.5GB disk, ~4GB VRAM)' }
        ],
        showApiKey: false,
        showEndpoint: false,
        showModelPath: false
    },
    piper: {
        label: 'Piper (Local, lightweight, ~50MB)',
        category: 'local',
        voices: [
            { value: 'en_US-amy-medium', label: 'Amy (US Female)' },
            { value: 'en_US-lessac-medium', label: 'Lessac (US Male)' },
            { value: 'en_US-libritts_r-medium', label: 'LibriTTS (US)' },
            { value: 'en_GB-cori-medium', label: 'Cori (British Female)' },
            { value: 'en_GB-alan-medium', label: 'Alan (British Male)' }
        ],
        showModelSize: false,
        showApiKey: false,
        showEndpoint: false,
        showModelPath: true,
        modelPathHint: 'Optional: Browse to a custom Piper .onnx voice file'
    },
    edge: {
        label: 'Edge TTS (Free cloud, Microsoft)',
        category: 'cloud-free',
        voices: [
            { value: 'en-US-AriaNeural', label: 'Aria (US Female)' },
            { value: 'en-US-GuyNeural', label: 'Guy (US Male)' },
            { value: 'en-US-JennyNeural', label: 'Jenny (US Female)' },
            { value: 'en-GB-SoniaNeural', label: 'Sonia (British Female)' },
            { value: 'en-GB-RyanNeural', label: 'Ryan (British Male)' },
            { value: 'en-AU-NatashaNeural', label: 'Natasha (Australian Female)' }
        ],
        showModelSize: false,
        showApiKey: false,
        showEndpoint: false,
        showModelPath: false
    },
    'openai-tts': {
        label: 'OpenAI TTS (Cloud, API key required)',
        category: 'cloud-paid',
        voices: [
            { value: 'alloy', label: 'Alloy' },
            { value: 'echo', label: 'Echo' },
            { value: 'fable', label: 'Fable' },
            { value: 'onyx', label: 'Onyx' },
            { value: 'nova', label: 'Nova' },
            { value: 'shimmer', label: 'Shimmer' }
        ],
        showModelSize: false,
        showApiKey: true,
        apiKeyPlaceholder: 'sk-...',
        showEndpoint: false,
        showModelPath: false
    },
    elevenlabs: {
        label: 'ElevenLabs (Cloud, premium)',
        category: 'cloud-paid',
        voices: [
            { value: 'Rachel', label: 'Rachel' },
            { value: 'Domi', label: 'Domi' },
            { value: 'Bella', label: 'Bella' },
            { value: 'Antoni', label: 'Antoni' },
            { value: 'Josh', label: 'Josh' },
            { value: 'Adam', label: 'Adam' }
        ],
        showModelSize: false,
        showApiKey: true,
        apiKeyPlaceholder: 'xi-...',
        showEndpoint: false,
        showModelPath: false
    },
    'custom-api': {
        label: 'Custom API (OpenAI-compatible)',
        category: 'cloud-custom',
        voices: [
            { value: 'default', label: 'Default' }
        ],
        showModelSize: false,
        showApiKey: true,
        apiKeyPlaceholder: 'API key (if required)',
        showEndpoint: true,
        endpointPlaceholder: 'https://your-server.com/v1',
        showModelPath: false
    }
};

// ── STT Adapter Registry ─────────────────────────────────────────────────────

const STT_REGISTRY = {
    'whisper-local': {
        label: 'Whisper (Local, default)',
        category: 'local',
        showModelSize: true,
        modelSizes: [
            { value: 'tiny', label: 'tiny.en (~77MB, fastest)' },
            { value: 'base', label: 'base.en (~148MB, recommended)' },
            { value: 'small', label: 'small.en (~488MB, most accurate)' }
        ],
        showModelName: false,
        showApiKey: false,
        showEndpoint: false
    },
    'openai-whisper-api': {
        label: 'OpenAI Whisper API',
        category: 'cloud-paid',
        showModelSize: false,
        showModelName: false,
        showApiKey: true,
        showEndpoint: false
    },
    'custom-api-stt': {
        label: 'Custom API (OpenAI-compatible)',
        category: 'cloud-custom',
        showModelSize: false,
        showModelName: false,
        showApiKey: true,
        showEndpoint: true
    }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function showRow(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
}

function hideRow(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
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
 * Update TTS adapter UI based on selected adapter.
 * Shows/hides conditional fields based on the registry entry.
 */
export function updateTTSAdapterUI(adapter) {
    const reg = ADAPTER_REGISTRY[adapter] || ADAPTER_REGISTRY.kokoro;
    const voiceSelect = document.getElementById('tts-voice');
    const currentVoice = voiceSelect.value;

    // Show/hide conditional rows
    reg.showModelSize ? showRow('tts-model-size-row') : hideRow('tts-model-size-row');
    reg.showApiKey ? showRow('tts-api-key-row') : hideRow('tts-api-key-row');
    reg.showEndpoint ? showRow('tts-endpoint-row') : hideRow('tts-endpoint-row');
    reg.showModelPath ? showRow('tts-model-path-row') : hideRow('tts-model-path-row');

    // Qwen hint
    const qwenHint = document.getElementById('tts-qwen-hint');
    if (qwenHint) qwenHint.style.display = adapter === 'qwen' ? 'block' : 'none';

    // Model path hint
    const modelPathHint = document.getElementById('tts-model-path-hint');
    if (modelPathHint) modelPathHint.textContent = reg.modelPathHint || '';

    // API key placeholder
    const apiKeyInput = document.getElementById('tts-api-key');
    if (apiKeyInput && reg.apiKeyPlaceholder) {
        apiKeyInput.placeholder = reg.apiKeyPlaceholder;
    }

    // Endpoint placeholder
    const endpointInput = document.getElementById('tts-endpoint');
    if (endpointInput && reg.endpointPlaceholder) {
        endpointInput.placeholder = reg.endpointPlaceholder;
    }

    // Populate model size dropdown if registry provides sizes
    if (reg.showModelSize && reg.modelSizes) {
        const sizeSelect = document.getElementById('tts-model-size');
        if (sizeSelect) {
            const currentSize = sizeSelect.value;
            sizeSelect.innerHTML = '';
            for (const size of reg.modelSizes) {
                const option = document.createElement('option');
                option.value = size.value;
                option.textContent = size.label;
                sizeSelect.appendChild(option);
            }
            if (reg.modelSizes.some(s => s.value === currentSize)) {
                sizeSelect.value = currentSize;
            }
        }
    }

    // Update voice options based on adapter
    const voices = reg.voices;
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
 * Update STT adapter UI based on selected adapter.
 * Shows/hides conditional fields based on the registry entry.
 */
export function updateSTTAdapterUI(adapter) {
    const reg = STT_REGISTRY[adapter] || STT_REGISTRY['whisper-local'];

    reg.showModelSize ? showRow('stt-model-size-row') : hideRow('stt-model-size-row');
    reg.showModelName ? showRow('stt-model-name-row') : hideRow('stt-model-name-row');
    reg.showApiKey ? showRow('stt-api-key-row') : hideRow('stt-api-key-row');
    reg.showEndpoint ? showRow('stt-endpoint-row') : hideRow('stt-endpoint-row');

    // Populate model size dropdown if registry provides sizes
    if (reg.showModelSize && reg.modelSizes) {
        const sizeSelect = document.getElementById('stt-model-size');
        if (sizeSelect) {
            const currentSize = sizeSelect.value;
            sizeSelect.innerHTML = '';
            for (const size of reg.modelSizes) {
                const option = document.createElement('option');
                option.value = size.value;
                option.textContent = size.label;
                sizeSelect.appendChild(option);
            }
            if (reg.modelSizes.some(s => s.value === currentSize)) {
                sizeSelect.value = currentSize;
            }
        }
    }
}

/**
 * Load available audio devices from voice backend
 */
async function loadAudioDevices() {
    const inputSelect = document.getElementById('audio-input-device');
    const outputSelect = document.getElementById('audio-output-device');
    if (!inputSelect || !outputSelect) return;

    try {
        const devicesResult = await window.voiceMirror.voice.listAudioDevices();
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

    // TTS settings
    const ttsAdapter = state.currentConfig.voice?.ttsAdapter || 'kokoro';
    document.getElementById('tts-adapter').value = ttsAdapter;
    document.getElementById('tts-model-size').value = state.currentConfig.voice?.ttsModelSize || '0.6B';
    updateTTSAdapterUI(ttsAdapter);
    document.getElementById('tts-voice').value = state.currentConfig.voice?.ttsVoice || 'af_bella';
    document.getElementById('tts-speed').value = state.currentConfig.voice?.ttsSpeed || 1.0;
    document.getElementById('speed-value').textContent = (state.currentConfig.voice?.ttsSpeed || 1.0) + 'x';
    document.getElementById('tts-volume').value = state.currentConfig.voice?.ttsVolume || 1.0;
    document.getElementById('volume-value').textContent = Math.round((state.currentConfig.voice?.ttsVolume || 1.0) * 100) + '%';

    // TTS extra fields
    const apiKeyEl = document.getElementById('tts-api-key');
    if (apiKeyEl) {
        // API key is redacted by the main process; show as placeholder, keep input empty
        const ttsKey = state.currentConfig.voice?.ttsApiKey;
        apiKeyEl.value = '';
        apiKeyEl.placeholder = ttsKey || apiKeyEl.placeholder || 'API key...';
    }
    const endpointEl = document.getElementById('tts-endpoint');
    if (endpointEl) endpointEl.value = state.currentConfig.voice?.ttsEndpoint || '';
    const modelPathEl = document.getElementById('tts-model-path');
    if (modelPathEl) modelPathEl.value = state.currentConfig.voice?.ttsModelPath || '';

    // STT settings
    const sttAdapter = state.currentConfig.voice?.sttAdapter || state.currentConfig.voice?.sttModel || 'whisper-local';
    document.getElementById('stt-model').value = sttAdapter;
    updateSTTAdapterUI(sttAdapter);

    // STT model size
    const sttModelSizeEl = document.getElementById('stt-model-size');
    if (sttModelSizeEl) sttModelSizeEl.value = state.currentConfig.voice?.sttModelSize || 'base';

    // STT extra fields
    const sttModelNameEl = document.getElementById('stt-model-name');
    if (sttModelNameEl) sttModelNameEl.value = state.currentConfig.voice?.sttModelName || '';
    const sttApiKeyEl = document.getElementById('stt-api-key');
    if (sttApiKeyEl) {
        // API key is redacted by the main process; show as placeholder, keep input empty
        const sttKey = state.currentConfig.voice?.sttApiKey;
        sttApiKeyEl.value = '';
        sttApiKeyEl.placeholder = sttKey || sttApiKeyEl.placeholder || 'API key...';
    }
    const sttEndpointEl = document.getElementById('stt-endpoint');
    if (sttEndpointEl) sttEndpointEl.value = state.currentConfig.voice?.sttEndpoint || '';

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
            ttsApiKey: document.getElementById('tts-api-key')?.value || null,
            ttsEndpoint: document.getElementById('tts-endpoint')?.value || null,
            ttsModelPath: document.getElementById('tts-model-path')?.value || null,
            sttModel: document.getElementById('stt-model').value,
            sttAdapter: document.getElementById('stt-model').value,
            sttModelSize: document.getElementById('stt-model-size')?.value || null,
            sttApiKey: document.getElementById('stt-api-key')?.value || null,
            sttEndpoint: document.getElementById('stt-endpoint')?.value || null,
            sttModelName: document.getElementById('stt-model-name')?.value || null,
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

    // STT adapter change handler
    document.getElementById('stt-model').addEventListener('change', (e) => {
        updateSTTAdapterUI(e.target.value);
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

    // Model path Browse / Clear buttons
    const browseBtn = document.getElementById('tts-model-path-browse');
    const clearBtn = document.getElementById('tts-model-path-clear');
    const modelPathInput = document.getElementById('tts-model-path');

    if (browseBtn && modelPathInput) {
        browseBtn.addEventListener('click', async () => {
            try {
                const result = await window.voiceMirror.config.browseModelFile('piper');
                if (result.success && result.data) {
                    modelPathInput.value = result.data;
                }
            } catch (err) {
                log.info('Browse model file failed:', err);
            }
        });
    }

    if (clearBtn && modelPathInput) {
        clearBtn.addEventListener('click', () => {
            modelPathInput.value = '';
        });
    }

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
