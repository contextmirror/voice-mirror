/**
 * settings.js - Settings UI + keybind recorder
 */

import { state } from './state.js';
import { formatKeybind } from './utils.js';
import { navigateTo } from './navigation.js';
import { updateProviderDisplay, clearTerminal } from './terminal.js';

// Provider display names
const PROVIDER_NAMES = {
    claude: 'Claude Code',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    jan: 'Jan',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    grok: 'Grok (xAI)',
    groq: 'Groq',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek'
};

// Provider icon CSS classes
const PROVIDER_ICON_CLASSES = {
    claude: 'provider-icon-claude',
    ollama: 'provider-icon-ollama',
    lmstudio: 'provider-icon-lmstudio',
    jan: 'provider-icon-jan',
    openai: 'provider-icon-openai',
    gemini: 'provider-icon-gemini',
    grok: 'provider-icon-grok',
    groq: 'provider-icon-groq',
    mistral: 'provider-icon-mistral',
    openrouter: 'provider-icon-openrouter',
    deepseek: 'provider-icon-deepseek'
};

// Local providers that can be auto-detected
const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'jan'];

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

// Cloud providers that need API keys
const CLOUD_PROVIDERS_WITH_APIKEY = ['openai', 'gemini', 'grok', 'groq', 'mistral', 'openrouter', 'deepseek'];

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
        const ttsAdapter = state.currentConfig.voice?.ttsAdapter || 'kokoro';
        document.getElementById('tts-adapter').value = ttsAdapter;
        document.getElementById('tts-model-size').value = state.currentConfig.voice?.ttsModelSize || '0.6B';
        updateTTSAdapterUI(ttsAdapter);
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

        // AI Provider settings
        const aiConfig = state.currentConfig.ai || {};
        document.getElementById('ai-auto-detect').checked = aiConfig.autoDetect !== false;
        const selectedProvider = aiConfig.provider || 'claude';
        setProviderSelectorValue(selectedProvider);
        updateAIProviderUI(selectedProvider);

        // Set endpoint if custom
        const endpoints = aiConfig.endpoints || {};
        const provider = aiConfig.provider || 'claude';
        if (LOCAL_PROVIDERS.includes(provider) && endpoints[provider]) {
            document.getElementById('ai-endpoint').value = endpoints[provider];
        }

        // If auto-detect is enabled, scan for providers
        if (aiConfig.autoDetect !== false) {
            scanProviders();
        }

        // Overlay display (monitor selection)
        await loadOverlayOutputs();

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
 * Update AI provider UI based on selected provider
 */
export function updateAIProviderUI(provider) {
    const modelRow = document.getElementById('ai-model-row');
    const endpointRow = document.getElementById('ai-endpoint-row');
    const apikeyRow = document.getElementById('ai-apikey-row');

    // Show/hide endpoint row for local providers
    endpointRow.style.display = LOCAL_PROVIDERS.includes(provider) ? 'flex' : 'none';

    // Show/hide API key row for cloud providers
    apikeyRow.style.display = CLOUD_PROVIDERS_WITH_APIKEY.includes(provider) ? 'flex' : 'none';

    // Model row: show for local providers (populated from detection), hide for Claude (uses CLI)
    modelRow.style.display = provider === 'claude' ? 'none' : 'flex';

    // Set default endpoint for local providers
    if (LOCAL_PROVIDERS.includes(provider)) {
        const defaultEndpoints = {
            ollama: 'http://127.0.0.1:11434',
            lmstudio: 'http://127.0.0.1:1234',
            jan: 'http://127.0.0.1:1337'
        };
        const endpointInput = document.getElementById('ai-endpoint');
        if (!endpointInput.value || endpointInput.dataset.provider !== provider) {
            endpointInput.value = defaultEndpoints[provider] || '';
            endpointInput.dataset.provider = provider;
        }
    }
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
 * Scan for local LLM providers
 */
export async function scanProviders() {
    const statusDiv = document.getElementById('ai-detected-status');
    const modelSelect = document.getElementById('ai-model');
    const scanBtn = document.getElementById('ai-scan-btn');

    // Show scanning state
    statusDiv.className = 'detection-status scanning';
    statusDiv.innerHTML = '<span class="detection-label">Scanning for local LLM servers...</span>';
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    try {
        // Call main process to scan providers
        const results = await window.voiceMirror.ai.scanProviders();
        state.detectedProviders = results || [];

        // Build status display
        let html = '<span class="detection-label">Local LLM Servers</span>';
        html += '<div class="provider-list">';

        const providerOrder = ['ollama', 'lmstudio', 'jan'];
        for (const type of providerOrder) {
            const provider = results.find(p => p.type === type);
            const name = PROVIDER_NAMES[type] || type;
            const isOnline = provider?.online;
            const model = provider?.model;

            html += `<div class="provider-item">`;
            html += `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>`;
            html += `<span>${name}</span>`;
            if (isOnline && model) {
                html += `<span class="model-name">${model}</span>`;
            } else if (!isOnline) {
                html += `<span class="model-name">offline</span>`;
            }
            html += `</div>`;
        }
        html += '</div>';

        statusDiv.className = 'detection-status';
        statusDiv.innerHTML = html;

        // Populate model dropdown for current provider
        const currentProvider = document.getElementById('ai-provider').value;
        const providerData = results.find(p => p.type === currentProvider);

        if (providerData?.models?.length > 0) {
            modelSelect.innerHTML = '<option value="">Auto (default)</option>';
            for (const model of providerData.models) {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                if (model === providerData.model) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            }
        }

        console.log('[Settings] Provider scan complete:', results);

    } catch (err) {
        console.error('[Settings] Provider scan failed:', err);
        statusDiv.className = 'detection-status';
        statusDiv.innerHTML = '<span class="detection-label">Failed to scan providers</span>';
    } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Now';
    }
}

/**
 * Save settings to config
 */
export async function saveSettings() {
    const activationMode = document.querySelector('input[name="activationMode"]:checked').value;
    const aiProvider = document.getElementById('ai-provider').value;
    const aiModel = document.getElementById('ai-model').value || null;
    const aiAutoDetect = document.getElementById('ai-auto-detect').checked;
    const aiEndpoint = document.getElementById('ai-endpoint').value;

    // Build AI config
    const aiUpdates = {
        provider: aiProvider,
        model: aiModel,
        autoDetect: aiAutoDetect
    };

    // Update endpoint if it's a local provider with custom endpoint
    if (LOCAL_PROVIDERS.includes(aiProvider) && aiEndpoint) {
        aiUpdates.endpoints = {
            [aiProvider]: aiEndpoint
        };
    }

    // Handle API key for cloud providers
    if (CLOUD_PROVIDERS_WITH_APIKEY.includes(aiProvider)) {
        const apiKey = document.getElementById('ai-apikey').value;
        if (apiKey) {
            aiUpdates.apiKeys = {
                [aiProvider]: apiKey
            };
        }
    }

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
            ttsAdapter: document.getElementById('tts-adapter').value,
            ttsVoice: document.getElementById('tts-voice').value,
            ttsModelSize: document.getElementById('tts-model-size').value,
            ttsSpeed: parseFloat(document.getElementById('tts-speed').value),
            sttModel: document.getElementById('stt-model').value
        },
        appearance: {
            orbSize: parseInt(document.getElementById('orb-size').value),
            theme: document.getElementById('theme-select').value
        },
        ai: aiUpdates,
        overlay: {
            outputName: document.getElementById('overlay-output')?.value || null
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

        // Update provider display in terminal/sidebar
        let displayName = PROVIDER_NAMES[aiProvider] || aiProvider;
        if (aiModel) {
            const shortModel = aiModel.split(':')[0];
            displayName = `${displayName} (${shortModel})`;
        }
        updateProviderDisplay(displayName, aiProvider, aiModel);

        // If AI provider or model changed, clear terminal and restart if running
        const oldProvider = state.currentProvider;
        const oldModel = state.currentModel;
        const providerChanged = oldProvider !== aiProvider;
        const modelChanged = oldModel !== aiModel;

        if (providerChanged || modelChanged) {
            // Clear terminal when provider or model changes
            clearTerminal();
            console.log(`[Settings] Provider/model changed: ${oldProvider}/${oldModel} -> ${aiProvider}/${aiModel}`);

            const status = await window.voiceMirror.claude.getStatus();
            if (status.running) {
                console.log('[Settings] Stopping old provider and starting new one...');
                await window.voiceMirror.claude.stop();
                // Small delay to ensure clean stop
                await new Promise(resolve => setTimeout(resolve, 500));
                await window.voiceMirror.claude.start();
            }
        }

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
 * Load available overlay outputs (monitors) from wayland orb
 */
async function loadOverlayOutputs() {
    const section = document.getElementById('overlay-display-section');
    const select = document.getElementById('overlay-output');
    if (!section || !select) return;

    try {
        const outputs = await window.voiceMirror.overlay.listOutputs();
        if (!outputs || outputs.length <= 1) {
            // Hide section if only one or no monitors
            section.style.display = 'none';
            return;
        }

        // Show section and populate dropdown
        section.style.display = 'block';
        select.innerHTML = '<option value="">Default</option>';
        for (const output of outputs) {
            const option = document.createElement('option');
            option.value = output.name;
            option.textContent = output.description || output.name;
            if (output.active) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        // Set from config if not already active
        const savedOutput = state.currentConfig?.overlay?.outputName;
        if (savedOutput && !outputs.some(o => o.active && o.name === savedOutput)) {
            select.value = savedOutput;
        }
    } catch (err) {
        console.log('[Settings] Could not load overlay outputs:', err);
        section.style.display = 'none';
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
 * Set the provider selector value and update display
 */
function setProviderSelectorValue(providerId) {
    const hiddenInput = document.getElementById('ai-provider');
    const iconEl = document.getElementById('selected-provider-icon');
    const nameEl = document.getElementById('selected-provider-name');

    if (hiddenInput) hiddenInput.value = providerId;

    // Update icon
    if (iconEl) {
        iconEl.className = 'provider-icon ' + (PROVIDER_ICON_CLASSES[providerId] || '');
    }

    // Update name
    if (nameEl) {
        nameEl.textContent = PROVIDER_NAMES[providerId] || providerId;
    }

    // Update selected state in dropdown
    document.querySelectorAll('.provider-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === providerId);
    });
}

/**
 * Initialize custom provider selector dropdown
 */
function initProviderSelector() {
    const selector = document.getElementById('ai-provider-selector');
    const btn = document.getElementById('ai-provider-btn');
    const dropdown = document.getElementById('ai-provider-dropdown');

    if (!selector || !btn || !dropdown) return;

    // Toggle dropdown on button click
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selector.classList.toggle('open');
    });

    // Handle option selection
    dropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.provider-option');
        if (!option) return;

        const value = option.dataset.value;
        setProviderSelectorValue(value);
        selector.classList.remove('open');

        // Trigger change behavior
        updateAIProviderUI(value);

        // Populate models from detected providers
        const providerData = state.detectedProviders?.find(p => p.type === value);
        const modelSelect = document.getElementById('ai-model');
        if (providerData?.models?.length > 0) {
            modelSelect.innerHTML = '<option value="">Auto (default)</option>';
            for (const model of providerData.models) {
                const opt = document.createElement('option');
                opt.value = model;
                opt.textContent = model;
                modelSelect.appendChild(opt);
            }
        } else {
            modelSelect.innerHTML = '<option value="">Auto (default)</option>';
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!selector.contains(e.target)) {
            selector.classList.remove('open');
        }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            selector.classList.remove('open');
        }
    });
}

/**
 * Initialize settings event listeners
 */
export function initSettings() {
    // Initialize custom provider selector
    initProviderSelector();

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
window.scanProviders = scanProviders;
window.updateAIProviderUI = updateAIProviderUI;
window.updateTTSAdapterUI = updateTTSAdapterUI;
