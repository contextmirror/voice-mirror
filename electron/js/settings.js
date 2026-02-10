/**
 * settings.js - Settings UI + keybind recorder
 */

import { state } from './state.js';
import { formatKeybind } from './utils.js';
import { navigateTo } from './navigation.js';
import { updateProviderDisplay } from './terminal.js';

// Provider display names
const PROVIDER_NAMES = {
    claude: 'Claude Code',
    codex: 'OpenAI Codex',
    'gemini-cli': 'Gemini CLI',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    jan: 'Jan',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    grok: 'Grok (xAI)',
    groq: 'Groq',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek',
    kimi: 'Kimi (Moonshot)',
    'kimi-cli': 'Kimi CLI'
};

// Provider icon CSS classes
const PROVIDER_ICON_CLASSES = {
    claude: 'provider-icon-claude',
    codex: 'provider-icon-codex',
    'gemini-cli': 'provider-icon-gemini-cli',
    ollama: 'provider-icon-ollama',
    lmstudio: 'provider-icon-lmstudio',
    jan: 'provider-icon-jan',
    openai: 'provider-icon-openai',
    gemini: 'provider-icon-gemini',
    grok: 'provider-icon-grok',
    groq: 'provider-icon-groq',
    mistral: 'provider-icon-mistral',
    openrouter: 'provider-icon-openrouter',
    deepseek: 'provider-icon-deepseek',
    kimi: 'provider-icon-kimi',
    'kimi-cli': 'provider-icon-kimi'
};

// CLI agent providers (PTY-based, full terminal access)
const CLI_PROVIDERS = ['claude', 'codex', 'gemini-cli', 'kimi-cli'];

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
const CLOUD_PROVIDERS_WITH_APIKEY = ['openai', 'gemini', 'grok', 'groq', 'mistral', 'openrouter', 'deepseek', 'kimi'];

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

        // User name
        document.getElementById('user-name').value = state.currentConfig.user?.name || '';

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

        // Appearance
        document.getElementById('orb-size').value = state.currentConfig.appearance?.orbSize || 64;
        document.getElementById('orb-size-value').textContent = (state.currentConfig.appearance?.orbSize || 64) + 'px';
        document.getElementById('theme-select').value = state.currentConfig.appearance?.theme || 'dark';

        // Behavior
        document.getElementById('start-minimized').checked = state.currentConfig.behavior?.startMinimized || false;
        document.getElementById('start-with-system').checked = state.currentConfig.behavior?.startWithSystem || false;

        // AI Provider settings
        const aiConfig = state.currentConfig.ai || {};
        document.getElementById('ai-auto-detect').checked = aiConfig.autoDetect !== false;
        const selectedProvider = aiConfig.provider || 'claude';
        setProviderSelectorValue(selectedProvider);
        updateAIProviderUI(selectedProvider);

        // Context length
        const contextLengthSelect = document.getElementById('ai-context-length');
        if (contextLengthSelect) {
            contextLengthSelect.value = String(aiConfig.contextLength || 32768);
        }

        // System prompt / persona
        const systemPromptTextarea = document.getElementById('ai-system-prompt');
        if (systemPromptTextarea) {
            systemPromptTextarea.value = aiConfig.systemPrompt || '';
        }

        // Track current provider/model for change detection on save
        state.currentProvider = selectedProvider;
        state.currentModel = aiConfig.model || null;
        state.currentContextLength = aiConfig.contextLength || 32768;

        // Set endpoint if custom
        const endpoints = aiConfig.endpoints || {};
        const provider = aiConfig.provider || 'claude';
        if (LOCAL_PROVIDERS.includes(provider) && endpoints[provider]) {
            document.getElementById('ai-endpoint').value = endpoints[provider];
        }

        // Load detected API keys from environment
        try {
            state._detectedKeyProviders = await window.voiceMirror.python.getDetectedKeys() || [];
        } catch { state._detectedKeyProviders = []; }

        // Populate API key field for current provider
        populateApiKeyField(selectedProvider);

        // If auto-detect is enabled, scan for providers
        if (aiConfig.autoDetect !== false) {
            scanProviders();
        }

        // Audio devices
        await loadAudioDevices();

        // Overlay display (monitor selection)
        await loadOverlayOutputs();

        // Tool profiles (Claude Code only)
        loadToolProfileUI();

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
    const contextLengthRow = document.getElementById('ai-context-length-row');
    const cliWarning = document.getElementById('cli-warning');

    const isCLI = CLI_PROVIDERS.includes(provider);

    // Show/hide CLI warning
    if (cliWarning) {
        cliWarning.style.display = isCLI ? 'block' : 'none';
    }

    // Show/hide endpoint row for local providers
    endpointRow.style.display = LOCAL_PROVIDERS.includes(provider) ? 'flex' : 'none';

    // Show/hide API key row for cloud providers and CLI agents that need keys (codex, gemini-cli)
    const needsApiKey = CLOUD_PROVIDERS_WITH_APIKEY.includes(provider) || (isCLI && provider !== 'claude');
    apikeyRow.style.display = needsApiKey ? 'flex' : 'none';

    // Populate API key field with masked value + detected hint
    if (needsApiKey) {
        populateApiKeyField(provider);
    }

    // Model row: hide for CLI providers (they use their own CLI), show for others
    modelRow.style.display = isCLI ? 'none' : 'flex';

    // Context length: show for local providers (Ollama, LM Studio, Jan)
    if (contextLengthRow) {
        contextLengthRow.style.display = LOCAL_PROVIDERS.includes(provider) ? 'flex' : 'none';
    }

    // Tool profiles: only show for Claude Code
    const toolProfileSection = document.getElementById('tool-profile-section');
    if (toolProfileSection) {
        toolProfileSection.style.display = provider === 'claude' ? 'block' : 'none';
    }

    // Update terminal profile badge
    updateTerminalProfileBadge(
        provider === 'claude' ? (PROFILE_DISPLAY_NAMES[state.activeToolProfile] || 'Voice Assistant') : ''
    );

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

        // Auto-enable detection and scan when selecting a local provider
        const autoDetectCheckbox = document.getElementById('ai-auto-detect');
        if (autoDetectCheckbox && !autoDetectCheckbox.checked) {
            autoDetectCheckbox.checked = true;
            scanProviders();
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
            if (isOnline && model && !/embed/i.test(model)) {
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
            // Preserve user's saved model selection from config
            const savedModel = state.currentConfig?.ai?.model || null;
            modelSelect.innerHTML = '<option value="">Auto (default)</option>';
            for (const model of providerData.models) {
                // Skip embedding models — they aren't chat models
                if (/embed/i.test(model)) continue;
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                // Select saved config model, falling back to detected default
                if (savedModel ? model === savedModel : model === providerData.model) {
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
    // Validate required name field
    const nameInput = document.getElementById('user-name');
    if (!nameInput.value.trim()) {
        nameInput.classList.add('input-error');
        nameInput.focus();
        nameInput.addEventListener('input', () => nameInput.classList.remove('input-error'), { once: true });
        return;
    }

    const activationMode = document.querySelector('input[name="activationMode"]:checked').value;
    const aiProvider = document.getElementById('ai-provider').value;
    const aiModel = document.getElementById('ai-model').value || null;
    const aiAutoDetect = document.getElementById('ai-auto-detect').checked;
    const aiEndpoint = document.getElementById('ai-endpoint').value;

    const aiContextLength = parseInt(document.getElementById('ai-context-length')?.value) || 32768;
    const aiSystemPrompt = document.getElementById('ai-system-prompt')?.value?.trim() || null;

    // Build AI config
    const aiUpdates = {
        provider: aiProvider,
        model: aiModel,
        autoDetect: aiAutoDetect,
        contextLength: aiContextLength,
        systemPrompt: aiSystemPrompt
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

    // Tool profile updates (Claude Code only)
    const toolProfileUpdates = getToolProfileUpdates();
    Object.assign(aiUpdates, toolProfileUpdates);

    const updates = {
        behavior: {
            activationMode: activationMode,
            hotkey: document.getElementById('keybind-toggle').textContent
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
            startMinimized: document.getElementById('start-minimized').checked,
            startWithSystem: document.getElementById('start-with-system').checked
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
        },
        appearance: {
            orbSize: parseInt(document.getElementById('orb-size').value),
            theme: document.getElementById('theme-select').value
        },
        user: {
            name: document.getElementById('user-name').value.trim() || state.currentConfig.user?.name || null
        },
        ai: aiUpdates,
        overlay: {
            outputName: document.getElementById('overlay-output')?.value || null
        }
    };

    // Detect provider/model changes BEFORE config.set() — the main process
    // restarts the provider during that await, and the 'start' event arrives
    // before config.set() returns. The flag must be set first.
    const oldProvider = state.currentProvider;
    const oldModel = state.currentModel;
    const oldContextLength = state.currentContextLength;
    const providerChanged = oldProvider !== aiProvider;
    const modelChanged = oldModel !== aiModel;
    const contextLengthChanged = oldContextLength !== aiContextLength;
    if (providerChanged || modelChanged || contextLengthChanged) {
        console.log(`[Settings] Provider/model changed: ${oldProvider}/${oldModel} -> ${aiProvider}/${aiModel}`);

        // Update state so next terminal banner shows the NEW provider name
        state.currentProvider = aiProvider;
        state.currentModel = aiModel;
        state.currentContextLength = aiContextLength;

        // Flag: clear terminal when new provider connects
        state.pendingProviderClear = true;
    }

    try {
        const newConfig = await window.voiceMirror.config.set(updates);
        console.log('[Settings] Saved config:', newConfig);

        // Update call mode UI state (actual mode change is handled by set-config in main process)
        state.callModeActive = (activationMode === 'callMode');
        updateCallModeUI();

        // Update welcome message with new mode
        window.updateWelcomeMessage();

        // Update provider display in terminal/sidebar
        let displayName = PROVIDER_NAMES[aiProvider] || aiProvider;
        if (aiModel) {
            const shortModel = aiModel.split(':')[0];
            displayName = `${displayName} (${shortModel})`;
        }
        updateProviderDisplay(displayName, aiProvider, aiModel);

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
 * Load available audio devices from Python backend
 */
async function loadAudioDevices() {
    const inputSelect = document.getElementById('audio-input-device');
    const outputSelect = document.getElementById('audio-output-device');
    if (!inputSelect || !outputSelect) return;

    try {
        const devices = await window.voiceMirror.python.listAudioDevices();
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
        console.log('[Settings] Could not load audio devices:', err);
    }
}

/**
 * Populate API key field for a provider with masked value + detected hint
 */
function populateApiKeyField(provider) {
    const apiKeyInput = document.getElementById('ai-apikey');
    const apikeyRow = document.getElementById('ai-apikey-row');
    if (!apiKeyInput || !apikeyRow) return;

    // Remove existing hint if any
    const existingHint = apikeyRow.querySelector('.apikey-hint');
    if (existingHint) existingHint.remove();

    const savedKey = state.currentConfig?.ai?.apiKeys?.[provider];
    if (savedKey) {
        // Show masked key
        const masked = savedKey.slice(0, 4) + '...' + savedKey.slice(-4);
        apiKeyInput.value = '';
        apiKeyInput.placeholder = masked;
    } else {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'Enter API key...';
    }

    // Show "detected from env" hint
    const detected = state._detectedKeyProviders || [];
    if (detected.includes(provider)) {
        const hint = document.createElement('span');
        hint.className = 'apikey-hint';
        hint.textContent = 'ENV';
        hint.title = 'Auto-detected from environment variable';
        hint.style.cssText = 'font-size:9px;background:rgba(74,222,128,0.2);color:#4ade80;padding:2px 6px;border-radius:4px;margin-left:8px;font-weight:600;';
        apikeyRow.querySelector('label')?.appendChild(hint);
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
                // Skip embedding models — they aren't chat models
                if (/embed/i.test(model)) continue;
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

    // Initialize tool profile selector
    initToolProfiles();

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
        const isDictationKeybind = state.recordingKeybind.id === 'keybind-dictation';
        if (!isPttKeybind && !isDictationKeybind) return;

        // Skip left (0) and right (2) click — those are for UI interaction
        if (e.button === 0 || e.button === 2) return;

        // Map DOM button numbers to MouseButton names
        // DOM: 1=middle, 3=back, 4=forward, 5+=extra side buttons
        const buttonMap = {
            1: 'MouseButton3',
            3: 'MouseButton4',
            4: 'MouseButton5',
        };
        // Support extra mouse buttons (DOM button 5+ → MouseButton6+)
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

// ============================================
// Tool Profiles
// ============================================

const BUILTIN_PROFILES = ['voice-assistant', 'voice-assistant-lite', 'n8n-workflows', 'web-browser', 'full-toolbox', 'minimal'];

const PROFILE_DISPLAY_NAMES = {
    'voice-assistant': 'Voice Assistant',
    'voice-assistant-lite': 'Voice Assistant Lite',
    'n8n-workflows': 'n8n Workflows',
    'web-browser': 'Web Browser',
    'full-toolbox': 'Full Toolbox',
    'minimal': 'Minimal'
};

const TOOL_GROUP_COUNTS = {
    core: 4, meta: 3, screen: 1, memory: 5, 'voice-clone': 3, browser: 14, n8n: 22,
    'memory-facade': 1, 'n8n-facade': 1, 'browser-facade': 1
};

/**
 * Initialize tool profile UI: dropdown toggle, checkbox handlers
 */
function initToolProfiles() {
    const selector = document.getElementById('profile-selector');
    const btn = document.getElementById('profile-selector-btn');
    const dropdown = document.getElementById('profile-dropdown');

    if (!btn || !dropdown) return;

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selector.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!selector.contains(e.target)) {
            selector.classList.remove('open');
        }
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') selector.classList.remove('open');
    });

    // Profile option selection
    dropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.profile-option');
        if (!option) return;

        // Check if it's a delete button click
        if (e.target.classList.contains('delete-custom-profile')) {
            const profileName = e.target.dataset.profile;
            deleteProfile(profileName);
            e.stopPropagation();
            return;
        }

        const profileName = option.dataset.profile;
        if (profileName) {
            selectToolProfile(profileName);
            selector.classList.remove('open');
        }
    });

    // Checkbox change → switch to custom or update profile
    document.querySelectorAll('#tool-group-list input[data-group]').forEach(cb => {
        cb.addEventListener('change', () => {
            updateToolCountDisplay();
            // If checkboxes no longer match any preset, show as "Custom"
            checkIfCustomProfile();
        });
    });
}

/**
 * Select a tool profile by name, update checkboxes and dropdown
 */
function selectToolProfile(profileName) {
    const config = state.currentConfig || {};
    const profiles = config.ai?.toolProfiles || {};
    const profile = profiles[profileName];

    if (!profile) return;

    // Update dropdown display
    const displayName = PROFILE_DISPLAY_NAMES[profileName] || profileName;
    document.getElementById('profile-name').textContent = displayName;

    // Update selected state in dropdown
    document.querySelectorAll('.profile-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.profile === profileName);
    });

    // Update checkboxes
    const groups = profile.groups || [];
    document.querySelectorAll('#tool-group-list input[data-group]').forEach(cb => {
        cb.checked = groups.includes(cb.value);
    });

    // Show/hide delete button (only for custom profiles)
    const deleteBtn = document.getElementById('delete-profile-btn');
    if (deleteBtn) {
        deleteBtn.style.display = BUILTIN_PROFILES.includes(profileName) ? 'none' : 'inline-block';
    }

    // Store active profile name
    state.activeToolProfile = profileName;
    updateToolCountDisplay();
    updateTerminalProfileBadge(displayName);
}

/**
 * Get currently selected groups from checkboxes
 */
function getSelectedGroups() {
    const groups = ['core', 'meta']; // always included
    document.querySelectorAll('#tool-group-list input[data-group]').forEach(cb => {
        if (cb.checked) groups.push(cb.value);
    });
    return groups;
}

/**
 * Update the tool count display
 */
function updateToolCountDisplay() {
    const groups = getSelectedGroups();
    const total = groups.reduce((sum, g) => sum + (TOOL_GROUP_COUNTS[g] || 0), 0);
    const el = document.getElementById('tool-count');
    if (el) el.textContent = `${total} of 48 tools`;
}

/**
 * Check if current checkboxes match a preset, else mark as custom
 */
function checkIfCustomProfile() {
    const groups = getSelectedGroups();
    const config = state.currentConfig || {};
    const profiles = config.ai?.toolProfiles || {};

    for (const [name, profile] of Object.entries(profiles)) {
        const pGroups = profile.groups || [];
        if (pGroups.length === groups.length && pGroups.every(g => groups.includes(g))) {
            selectToolProfile(name);
            return;
        }
    }

    // No match — show as modified but keep the current profile name
    // so Save will update it with the new groups
    const currentName = state.activeToolProfile || 'voice-assistant';
    const displayName = PROFILE_DISPLAY_NAMES[currentName] || currentName;
    document.getElementById('profile-name').textContent = `${displayName} (modified)`;
    document.querySelectorAll('.profile-option').forEach(opt => opt.classList.remove('selected'));
    updateToolCountDisplay();
}

/**
 * Save current checkbox selection as a new custom profile
 */
export async function saveCustomProfile() {
    const name = prompt('Profile name:');
    if (!name || !name.trim()) return;

    const key = name.trim().toLowerCase().replace(/\s+/g, '-');
    const groups = getSelectedGroups();

    // Save to config
    const updates = {
        ai: {
            toolProfile: key,
            toolProfiles: {
                [key]: { groups }
            }
        }
    };

    const newConfig = await window.voiceMirror.config.set(updates);
    state.currentConfig = newConfig;

    // Add the display name
    PROFILE_DISPLAY_NAMES[key] = name.trim();

    // Add to dropdown UI
    addCustomProfileToDropdown(key, name.trim(), groups);
    selectToolProfile(key);
}

/**
 * Add a custom profile option to the dropdown
 */
function addCustomProfileToDropdown(key, displayName, groups) {
    const container = document.getElementById('custom-profiles-container');
    const label = document.getElementById('custom-profiles-label');
    if (!container) return;

    // Show the custom section label
    if (label) label.style.display = 'block';

    // Don't duplicate
    if (container.querySelector(`[data-profile="${key}"]`)) return;

    const toolCount = groups.reduce((sum, g) => sum + (TOOL_GROUP_COUNTS[g] || 0), 0);
    const option = document.createElement('div');
    option.className = 'profile-option';
    option.dataset.profile = key;
    option.innerHTML = `
        <span class="profile-option-name">${displayName}</span>
        <span class="profile-option-desc">${toolCount} tools</span>
        <button class="delete-custom-profile" data-profile="${key}">✕</button>
    `;
    container.appendChild(option);
}

/**
 * Delete a custom profile
 */
async function deleteProfile(profileName) {
    if (BUILTIN_PROFILES.includes(profileName)) return;
    if (!confirm(`Delete profile "${PROFILE_DISPLAY_NAMES[profileName] || profileName}"?`)) return;

    // Remove from config
    const config = state.currentConfig || {};
    const profiles = config.ai?.toolProfiles || {};
    delete profiles[profileName];

    await window.voiceMirror.config.set({ ai: { toolProfiles: profiles, toolProfile: 'voice-assistant' } });
    state.currentConfig = await window.voiceMirror.config.get();

    // Remove from dropdown
    const el = document.querySelector(`#custom-profiles-container [data-profile="${profileName}"]`);
    if (el) el.remove();

    // Check if any custom profiles remain
    const container = document.getElementById('custom-profiles-container');
    if (container && container.children.length === 0) {
        const label = document.getElementById('custom-profiles-label');
        if (label) label.style.display = 'none';
    }

    selectToolProfile('voice-assistant');
}

window.deleteCurrentProfile = function() {
    if (state.activeToolProfile) deleteProfile(state.activeToolProfile);
};

/**
 * Load tool profile state into UI
 */
function loadToolProfileUI() {
    const config = state.currentConfig || {};
    const profileName = config.ai?.toolProfile || 'voice-assistant';
    const profiles = config.ai?.toolProfiles || {};

    // Add any custom profiles to dropdown
    for (const [key, profile] of Object.entries(profiles)) {
        if (!BUILTIN_PROFILES.includes(key)) {
            PROFILE_DISPLAY_NAMES[key] = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            addCustomProfileToDropdown(key, PROFILE_DISPLAY_NAMES[key], profile.groups || []);
        }
    }

    selectToolProfile(profileName);
}

/**
 * Get tool profile updates for saveSettings
 */
function getToolProfileUpdates() {
    const groups = getSelectedGroups();
    const profileName = state.activeToolProfile || 'voice-assistant';

    const updates = {
        toolProfile: profileName,
        toolProfiles: {
            [profileName]: { groups }
        }
    };

    return updates;
}

/**
 * Update terminal header profile badge
 */
function updateTerminalProfileBadge(displayName) {
    const badges = document.querySelectorAll('.terminal-profile-badge');
    const provider = state.currentConfig?.ai?.provider || 'claude';
    badges.forEach(badge => {
        badge.textContent = provider === 'claude' ? displayName : '';
    });
}

/**
 * Navigate to settings and scroll to tool profiles
 */
window.openToolProfileSettings = function() {
    navigateTo('settings');
    setTimeout(() => {
        const section = document.getElementById('tool-profile-section');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
};

window.saveCustomProfile = saveCustomProfile;

// Expose functions globally for onclick handlers
window.toggleSettings = toggleSettings;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.loadSettingsUI = loadSettingsUI;
window.scanProviders = scanProviders;
window.updateAIProviderUI = updateAIProviderUI;
window.updateTTSAdapterUI = updateTTSAdapterUI;
