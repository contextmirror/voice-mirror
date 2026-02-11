/**
 * settings.js - Settings UI + keybind recorder
 */

import { state } from './state.js';
import { formatKeybind } from './utils.js';
import { navigateTo } from './navigation.js';
import { updateProviderDisplay } from './terminal.js';
import { PRESETS, deriveOrbColors, applyTheme, resolveTheme, buildExportData, validateImportData, applyMessageCardOverrides, hexToRgb } from './theme-engine.js';
import { renderOrb, DURATIONS } from './orb-canvas.js';

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

// Provider icon CSS classes (exported for sidebar provider display)
export const PROVIDER_ICON_CLASSES = {
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

// ========== Modular Tab System ==========
// Add new tabs by adding an entry here + a matching data-tab div in overlay.html
// + a template file at templates/settings-{id}.html
const SETTINGS_TABS = [
    { id: 'ai',      label: 'AI & Tools' },
    { id: 'voice',   label: 'Voice & Audio' },
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
];

const SETTINGS_TAB_STORAGE_KEY = 'vm-settings-tab';

// Template cache — loaded once, reused across tab switches
const _templateCache = {};

/**
 * Load all tab templates into the DOM.
 * Fetches templates/settings-{id}.html for each tab and injects into the
 * matching data-tab div. All tabs load in parallel on first call.
 */
async function loadAllTabTemplates() {
    await Promise.all(SETTINGS_TABS.map(async (tab) => {
        const panel = document.querySelector(`.settings-tab-content[data-tab="${tab.id}"]`);
        if (!panel || panel.dataset.loaded) return;

        if (!_templateCache[tab.id]) {
            const resp = await fetch(`templates/settings-${tab.id}.html`);
            _templateCache[tab.id] = await resp.text();
        }

        panel.innerHTML = _templateCache[tab.id];
        panel.dataset.loaded = 'true';
    }));
}

/**
 * Initialize settings tabs — generates tab buttons, attaches handlers, restores last tab.
 * Must be called AFTER loadAllTabTemplates() so icon cards exist in the DOM.
 */
function initSettingsTabs() {
    const tabBar = document.querySelector('.settings-tabs');
    if (!tabBar) return;

    // Generate tab buttons from registry
    tabBar.innerHTML = '';
    SETTINGS_TABS.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'settings-tab';
        btn.dataset.tab = tab.id;
        btn.textContent = tab.label;
        btn.addEventListener('click', () => switchSettingsTab(tab.id));
        tabBar.appendChild(btn);
    });

    // Restore last active tab or default to first
    const savedTab = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    const initialTab = SETTINGS_TABS.find(t => t.id === savedTab) ? savedTab : SETTINGS_TABS[0].id;
    switchSettingsTab(initialTab);

    // Icon card click → smooth scroll to section
    document.querySelectorAll('.settings-card[data-scroll-to]').forEach(card => {
        card.addEventListener('click', () => {
            const targetId = card.dataset.scrollTo;
            const target = document.getElementById(targetId);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

/**
 * Switch active settings tab
 */
function switchSettingsTab(tabId) {
    // Update tab buttons
    document.querySelectorAll('.settings-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab content panels
    document.querySelectorAll('.settings-tab-content').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.tab === tabId);
    });

    // Persist
    localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tabId);
}

/**
 * Toggle settings - navigates to settings page or back to chat
 */
export function toggleSettings() {
    if (state.currentPage === 'settings') {
        // Go back to chat — revert unsaved theme changes
        revertThemeIfUnsaved();
        stopOrbPreview();
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

        // Appearance (theme, colors, fonts, orb)
        await loadAppearanceUI();

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
        appearance: buildAppearanceSaveData(),
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

        // Update welcome message with new mode
        window.updateWelcomeMessage();

        // Update provider display in terminal/sidebar
        let displayName = PROVIDER_NAMES[aiProvider] || aiProvider;
        if (aiModel) {
            const shortModel = aiModel.split(':')[0];
            displayName = `${displayName} (${shortModel})`;
        }
        updateProviderDisplay(displayName, aiProvider, aiModel);

        // Clear theme snapshot (prevents revert of saved changes)
        state._themeSnapshot = null;

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
 * Initialize settings event listeners.
 * Loads tab templates first, then wires up all event handlers.
 */
export async function initSettings() {
    // Load tab templates into the DOM before anything else
    await loadAllTabTemplates();

    // Initialize tab system (needs templates loaded for icon card handlers)
    initSettingsTabs();

    // Initialize custom provider selector
    initProviderSelector();

    // Initialize tool profile selector
    initToolProfiles();

    // Initialize appearance tab (presets, color pickers, orb preview, import/export)
    initAppearanceTab();

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

    // Mouse button detection for keybind recording (supports Razer Naga and similar multi-button mice)
    document.addEventListener('mousedown', (e) => {
        if (!state.recordingKeybind) return;

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

// ============================================
// Appearance Tab — Theme, Colors, Fonts, Orb Preview
// ============================================

const APPEARANCE_COLOR_KEYS = ['bg', 'bgElevated', 'text', 'textStrong', 'muted', 'accent', 'ok', 'warn', 'danger', 'orbCore'];
const BUBBLE_STYLE_PRESETS = {
    rounded: { userRadius: '16px 16px 4px 16px', aiRadius: '4px 16px 16px 16px' },
    square: { userRadius: '4px', aiRadius: '4px' },
    pill: { userRadius: '20px', aiRadius: '20px' }
};
const ORB_PREVIEW_STATES = ['idle', 'recording', 'speaking', 'thinking', 'dictating'];
let orbPreviewFrame = null;
let orbPreviewStateIdx = 0;
let orbPreviewCycleTimer = null;
let orbPreviewPhaseStart = 0;

/** Gather current color picker values into an object */
function gatherColors() {
    const colors = {};
    for (const key of APPEARANCE_COLOR_KEYS) {
        const picker = document.getElementById(`color-${key}`);
        colors[key] = picker ? picker.value : PRESETS.dark.colors[key];
    }
    return colors;
}

/** Gather current font select values */
function gatherFonts() {
    return {
        fontFamily: document.getElementById('font-family-select')?.value || PRESETS.dark.fonts.fontFamily,
        fontMono: document.getElementById('font-mono-select')?.value || PRESETS.dark.fonts.fontMono,
    };
}

/** Apply the current picker/select values as a live theme */
function applyLiveTheme() {
    applyTheme(gatherColors(), gatherFonts());
}

/** Select a preset theme — updates pickers, fonts, and applies live */
function selectPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    state._activeThemePreset = presetKey;
    state._themeCustomized = false;

    // Update preset card active states
    document.querySelectorAll('.theme-preset-card').forEach(card => {
        card.classList.toggle('active', card.dataset.preset === presetKey);
        card.classList.remove('customized');
    });

    // Update all color pickers
    for (const [key, value] of Object.entries(preset.colors)) {
        const picker = document.getElementById(`color-${key}`);
        if (picker) picker.value = value;
        const hex = document.getElementById(`color-${key}-hex`);
        if (hex) hex.textContent = value;
    }

    // Update font selects
    const fontSelect = document.getElementById('font-family-select');
    if (fontSelect) fontSelect.value = preset.fonts.fontFamily;
    const monoSelect = document.getElementById('font-mono-select');
    if (monoSelect) monoSelect.value = preset.fonts.fontMono;

    applyTheme(preset.colors, preset.fonts);
}

/** Check if colors differ from preset and show badge */
function markCustomized() {
    if (!state._activeThemePreset || !PRESETS[state._activeThemePreset]) return;
    const preset = PRESETS[state._activeThemePreset];
    const colors = gatherColors();
    const customized = Object.keys(preset.colors).some(k => colors[k] !== preset.colors[k]);
    state._themeCustomized = customized;

    const card = document.querySelector(`.theme-preset-card[data-preset="${state._activeThemePreset}"]`);
    if (card) card.classList.toggle('customized', customized);
}

/** Start the 128×128 orb preview animation loop */
function startOrbPreview() {
    stopOrbPreview(); // Clean up any existing preview

    const previewCanvas = document.getElementById('orb-preview-canvas');
    if (!previewCanvas) return;

    const previewCtx = previewCanvas.getContext('2d');
    orbPreviewPhaseStart = performance.now();
    orbPreviewStateIdx = 0;

    // Cycle through orb states every 3 seconds
    orbPreviewCycleTimer = setInterval(() => {
        orbPreviewStateIdx = (orbPreviewStateIdx + 1) % ORB_PREVIEW_STATES.length;
        orbPreviewPhaseStart = performance.now();
        const label = document.getElementById('orb-preview-state');
        if (label) {
            const name = ORB_PREVIEW_STATES[orbPreviewStateIdx];
            label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        }
    }, 3000);

    // Render loop
    function renderPreview() {
        const now = performance.now();
        const orbState = ORB_PREVIEW_STATES[orbPreviewStateIdx];
        const duration = DURATIONS[orbState] || 1500;
        const phase = ((now - orbPreviewPhaseStart) % duration) / duration;

        const w = previewCanvas.width;
        const h = previewCanvas.height;
        const imageData = previewCtx.createImageData(w, h);

        const orbColors = deriveOrbColors(gatherColors());
        renderOrb(imageData, w, h, orbState, phase, orbColors);
        previewCtx.putImageData(imageData, 0, 0);

        orbPreviewFrame = requestAnimationFrame(renderPreview);
    }

    orbPreviewFrame = requestAnimationFrame(renderPreview);
}

/** Stop orb preview animation */
function stopOrbPreview() {
    if (orbPreviewFrame) { cancelAnimationFrame(orbPreviewFrame); orbPreviewFrame = null; }
    if (orbPreviewCycleTimer) { clearInterval(orbPreviewCycleTimer); orbPreviewCycleTimer = null; }
}

/** Import a theme from JSON file */
async function importTheme() {
    try {
        const result = await window.voiceMirror.theme.import();
        if (!result) return; // User cancelled

        const validation = validateImportData(result);
        if (!validation.valid) {
            alert('Invalid theme file: ' + validation.error);
            return;
        }

        // Apply imported colors to pickers
        for (const [key, value] of Object.entries(validation.colors)) {
            const picker = document.getElementById(`color-${key}`);
            if (picker) picker.value = value;
            const hex = document.getElementById(`color-${key}-hex`);
            if (hex) hex.textContent = value;
        }

        if (validation.fonts) {
            const fontSelect = document.getElementById('font-family-select');
            if (fontSelect && validation.fonts.fontFamily) fontSelect.value = validation.fonts.fontFamily;
            const monoSelect = document.getElementById('font-mono-select');
            if (monoSelect && validation.fonts.fontMono) monoSelect.value = validation.fonts.fontMono;
        }

        // Enable customize toggle
        const toggle = document.getElementById('customize-colors-toggle');
        if (toggle) {
            toggle.checked = true;
            document.getElementById('color-picker-grid').style.display = '';
        }

        state._themeCustomized = true;
        document.querySelectorAll('.theme-preset-card').forEach(card => {
            card.classList.remove('active');
            card.classList.remove('customized');
        });

        applyLiveTheme();
    } catch (err) {
        console.error('[Theme] Import failed:', err);
    }
}

/** Export current theme to JSON file */
async function exportTheme() {
    try {
        const colors = gatherColors();
        const fonts = gatherFonts();
        const data = buildExportData('My Theme', colors, fonts);
        await window.voiceMirror.theme.export(data);
    } catch (err) {
        console.error('[Theme] Export failed:', err);
    }
}

/** Revert to theme snapshot if user navigates away without saving */
function revertThemeIfUnsaved() {
    if (state._themeSnapshot) {
        applyTheme(state._themeSnapshot.colors, state._themeSnapshot.fonts);
        // Revert message card overrides
        if (state._themeSnapshot.messageCard && Object.keys(state._themeSnapshot.messageCard).length > 0) {
            applyMessageCardOverrides(state._themeSnapshot.messageCard);
        }
        state._themeSnapshot = null;
    }
}

/** Load appearance UI state from config */
async function loadAppearanceUI() {
    const appearance = state.currentConfig.appearance || {};
    const themeName = appearance.theme || 'dark';
    const preset = PRESETS[themeName] || PRESETS.dark;

    state._activeThemePreset = PRESETS[themeName] ? themeName : 'dark';
    state._themeCustomized = !!appearance.colors;

    // Update preset cards
    document.querySelectorAll('.theme-preset-card').forEach(card => {
        card.classList.toggle('active', card.dataset.preset === state._activeThemePreset);
        card.classList.remove('customized');
        if (appearance.colors && card.dataset.preset === state._activeThemePreset) {
            card.classList.add('customized');
        }
    });

    // Populate color pickers
    const activeColors = appearance.colors || preset.colors;
    for (const key of APPEARANCE_COLOR_KEYS) {
        const picker = document.getElementById(`color-${key}`);
        if (picker) picker.value = activeColors[key] || PRESETS.dark.colors[key];
        const hex = document.getElementById(`color-${key}-hex`);
        if (hex) hex.textContent = activeColors[key] || PRESETS.dark.colors[key];
    }

    // Customize toggle
    const customizeToggle = document.getElementById('customize-colors-toggle');
    if (customizeToggle) {
        customizeToggle.checked = !!appearance.colors;
        const pickerGrid = document.getElementById('color-picker-grid');
        if (pickerGrid) pickerGrid.style.display = appearance.colors ? '' : 'none';
    }

    // Fonts — load custom fonts first so their <option>s exist before setting values
    await loadCustomFonts();
    const activeFonts = appearance.fonts || preset.fonts;
    const fontSelect = document.getElementById('font-family-select');
    if (fontSelect) fontSelect.value = activeFonts.fontFamily;
    const monoSelect = document.getElementById('font-mono-select');
    if (monoSelect) monoSelect.value = activeFonts.fontMono;

    // Orb size
    document.getElementById('orb-size').value = appearance.orbSize || 64;
    document.getElementById('orb-size-value').textContent = (appearance.orbSize || 64) + 'px';

    // Message card controls
    const mc = appearance.messageCard || {};
    const msgFontSize = document.getElementById('msg-font-size');
    if (msgFontSize) {
        msgFontSize.value = parseInt(mc.fontSize) || 14;
        document.getElementById('msg-font-size-value').textContent = (parseInt(mc.fontSize) || 14) + 'px';
    }
    const msgPadding = document.getElementById('msg-padding');
    if (msgPadding) {
        msgPadding.value = parseInt(mc.padding) || 12;
        document.getElementById('msg-padding-value').textContent = (parseInt(mc.padding) || 12) + 'px';
    }
    const msgAvatarSize = document.getElementById('msg-avatar-size');
    if (msgAvatarSize) {
        msgAvatarSize.value = parseInt(mc.avatarSize) || 36;
        document.getElementById('msg-avatar-size-value').textContent = (parseInt(mc.avatarSize) || 36) + 'px';
    }
    const msgShowAvatars = document.getElementById('msg-show-avatars');
    if (msgShowAvatars) msgShowAvatars.checked = mc.showAvatars !== false;
    const msgBubbleStyle = document.getElementById('msg-bubble-style');
    if (msgBubbleStyle) msgBubbleStyle.value = mc.bubbleStyle || 'rounded';
    const msgUserColor = document.getElementById('msg-user-color');
    if (msgUserColor) {
        msgUserColor.value = mc.userColor || '#667eea';
        document.getElementById('msg-user-color-hex').textContent = mc.userColor || '#667eea';
    }
    const msgAiColor = document.getElementById('msg-ai-color');
    if (msgAiColor) {
        msgAiColor.value = mc.aiColor || '#111318';
        document.getElementById('msg-ai-color-hex').textContent = mc.aiColor || '#111318';
    }

    // Theme snapshot for revert on cancel
    state._themeSnapshot = { colors: { ...activeColors }, fonts: { ...activeFonts }, messageCard: { ...mc } };

    // Apply theme to match UI state
    applyTheme(activeColors, activeFonts);
    if (appearance.messageCard) applyMessageCardOverrides(appearance.messageCard);
}

/** Build the appearance save data from current UI state */
function buildAppearanceSaveData() {
    const themeName = state._activeThemePreset || 'dark';
    const preset = PRESETS[themeName] || PRESETS.dark;
    const currentColors = gatherColors();
    const currentFonts = gatherFonts();

    const colorsCustomized = state._themeCustomized ||
        Object.keys(preset.colors).some(k => currentColors[k] !== preset.colors[k]);

    const fontsCustomized = currentFonts.fontFamily !== preset.fonts.fontFamily ||
        currentFonts.fontMono !== preset.fonts.fontMono;

    // Message card — only save if customized from defaults
    let messageCard = null;
    const msgFontSize = document.getElementById('msg-font-size');
    if (msgFontSize) {
        const fontSize = parseInt(msgFontSize.value);
        const padding = parseInt(document.getElementById('msg-padding').value);
        const avatarSize = parseInt(document.getElementById('msg-avatar-size').value);
        const showAvatars = document.getElementById('msg-show-avatars').checked;
        const bubbleStyle = document.getElementById('msg-bubble-style').value;
        const userColor = document.getElementById('msg-user-color').value;
        const aiColor = document.getElementById('msg-ai-color').value;

        const isCustomized = fontSize !== 14 || padding !== 12 || avatarSize !== 36 ||
            !showAvatars || bubbleStyle !== 'rounded' ||
            userColor !== '#667eea' || aiColor !== '#111318';

        if (isCustomized) {
            const style = BUBBLE_STYLE_PRESETS[bubbleStyle] || BUBBLE_STYLE_PRESETS.rounded;
            const userRgb = hexToRgb(userColor);
            const aiRgb = hexToRgb(aiColor);
            messageCard = {
                fontSize: fontSize + 'px',
                padding: padding + 'px ' + (padding + 4) + 'px',
                avatarSize: avatarSize + 'px',
                showAvatars,
                bubbleStyle,
                userColor,
                aiColor,
                userBg: `linear-gradient(135deg, rgba(${userRgb.r}, ${userRgb.g}, ${userRgb.b}, 0.4) 0%, rgba(${Math.max(0, userRgb.r - 20)}, ${Math.max(0, userRgb.g - 20)}, ${Math.max(0, userRgb.b - 20)}, 0.35) 100%)`,
                userBorder: `rgba(${userRgb.r}, ${userRgb.g}, ${userRgb.b}, 0.3)`,
                userRadius: style.userRadius,
                aiBg: `linear-gradient(135deg, rgba(${aiRgb.r}, ${aiRgb.g}, ${aiRgb.b}, 0.95) 0%, rgba(${Math.max(0, aiRgb.r - 5)}, ${Math.max(0, aiRgb.g - 5)}, ${Math.max(0, aiRgb.b - 5)}, 0.95) 100%)`,
                aiBorder: `rgba(${Math.min(255, aiRgb.r + 30)}, ${Math.min(255, aiRgb.g + 30)}, ${Math.min(255, aiRgb.b + 30)}, 0.06)`,
                aiRadius: style.aiRadius,
            };
        }
    }

    return {
        orbSize: parseInt(document.getElementById('orb-size').value),
        theme: themeName,
        colors: colorsCustomized ? currentColors : null,
        fonts: fontsCustomized ? currentFonts : null,
        messageCard,
    };
}

// ========== Custom Font Management ==========
const _injectedFontStyles = new Map();

/** Inject a custom font's @font-face into the document */
async function injectCustomFont(fontEntry) {
    if (_injectedFontStyles.has(fontEntry.id)) return;
    const result = await window.voiceMirror.fonts.getDataUrl(fontEntry.id);
    if (!result.success) return;
    const style = document.createElement('style');
    style.dataset.fontId = fontEntry.id;
    style.textContent = `@font-face { font-family: '${result.familyName}'; src: url('${result.dataUrl}'); }`;
    document.head.appendChild(style);
    _injectedFontStyles.set(fontEntry.id, style);
}

/** Remove an injected custom font */
function removeInjectedFont(fontId) {
    const style = _injectedFontStyles.get(fontId);
    if (style) {
        style.remove();
        _injectedFontStyles.delete(fontId);
    }
}

/** Load all custom fonts, inject @font-face rules, populate dropdowns and management list */
async function loadCustomFonts() {
    const fonts = await window.voiceMirror.fonts.list();
    for (const font of fonts) {
        await injectCustomFont(font);
    }
    populateCustomFontOptions(fonts);
    renderCustomFontsList(fonts);
}

/** Populate font select dropdowns with custom font options */
function populateCustomFontOptions(fonts) {
    const fontSelect = document.getElementById('font-family-select');
    const monoSelect = document.getElementById('font-mono-select');

    // Remove existing custom options
    for (const select of [fontSelect, monoSelect]) {
        if (!select) continue;
        select.querySelectorAll('option[data-custom]').forEach(opt => opt.remove());
    }

    for (const font of fonts) {
        const option = document.createElement('option');
        option.dataset.custom = font.id;
        option.textContent = font.displayName;
        if (font.type === 'ui' && fontSelect) {
            option.value = `'${font.familyName}', sans-serif`;
            fontSelect.appendChild(option);
        } else if (font.type === 'mono' && monoSelect) {
            option.value = `'${font.familyName}', monospace`;
            monoSelect.appendChild(option);
        }
    }
}

/** Render the custom fonts management list */
function renderCustomFontsList(fonts) {
    const container = document.getElementById('custom-fonts-list');
    const items = document.getElementById('custom-fonts-items');
    if (!container || !items) return;

    if (fonts.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = '';
    items.innerHTML = '';

    for (const font of fonts) {
        const row = document.createElement('div');
        row.className = 'custom-font-item';

        const name = document.createElement('span');
        name.className = 'custom-font-name';
        name.textContent = font.displayName;
        row.appendChild(name);

        const badge = document.createElement('span');
        badge.className = 'custom-font-type';
        badge.textContent = font.type;
        row.appendChild(badge);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'custom-font-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = 'Remove font';
        removeBtn.addEventListener('click', () => handleRemoveFont(font.id));
        row.appendChild(removeBtn);

        items.appendChild(row);
    }
}

/** Handle font upload (UI or Mono) */
async function handleUploadFont(type) {
    const uploadResult = await window.voiceMirror.fonts.upload();
    if (!uploadResult.success) return;

    const addResult = await window.voiceMirror.fonts.add(uploadResult.filePath, type);
    if (!addResult.success) {
        console.error('[Fonts] Failed to add font:', addResult.error);
        return;
    }

    await loadCustomFonts();

    // Auto-select the newly added font
    const font = addResult.font;
    if (type === 'ui') {
        const fontSelect = document.getElementById('font-family-select');
        if (fontSelect) fontSelect.value = `'${font.familyName}', sans-serif`;
    } else {
        const monoSelect = document.getElementById('font-mono-select');
        if (monoSelect) monoSelect.value = `'${font.familyName}', monospace`;
    }

    applyLiveTheme();
}

/** Handle font removal */
async function handleRemoveFont(fontId) {
    const result = await window.voiceMirror.fonts.remove(fontId);
    if (!result.success) {
        console.error('[Fonts] Failed to remove font:', result.error);
        return;
    }

    removeInjectedFont(fontId);
    await loadCustomFonts();
    applyLiveTheme();
}

/** Initialize appearance tab — preset cards, color pickers, orb preview, import/export */
function initAppearanceTab() {
    // Populate preset cards
    const grid = document.getElementById('theme-preset-grid');
    if (!grid) return;

    grid.innerHTML = '';
    for (const [key, preset] of Object.entries(PRESETS)) {
        const card = document.createElement('div');
        card.className = 'theme-preset-card';
        card.dataset.preset = key;

        const swatches = document.createElement('div');
        swatches.className = 'preset-swatches';
        for (const color of [preset.colors.bg, preset.colors.accent, preset.colors.text, preset.colors.orbCore]) {
            const dot = document.createElement('div');
            dot.className = 'preset-swatch';
            dot.style.background = color;
            swatches.appendChild(dot);
        }
        card.appendChild(swatches);

        const name = document.createElement('span');
        name.className = 'preset-name';
        name.textContent = preset.name;
        card.appendChild(name);

        const badge = document.createElement('span');
        badge.className = 'preset-badge';
        badge.textContent = 'Customized';
        card.appendChild(badge);

        card.addEventListener('click', () => selectPreset(key));
        grid.appendChild(card);
    }

    // Customize toggle
    const toggle = document.getElementById('customize-colors-toggle');
    const pickerGrid = document.getElementById('color-picker-grid');
    if (toggle && pickerGrid) {
        toggle.addEventListener('change', () => {
            pickerGrid.style.display = toggle.checked ? '' : 'none';
        });
    }

    // Color picker live preview — every change updates the ENTIRE APP
    document.querySelectorAll('.color-picker-control input[type="color"]').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const key = e.target.dataset.key;
            const hexSpan = document.getElementById(`color-${key}-hex`);
            if (hexSpan) hexSpan.textContent = e.target.value;
            applyLiveTheme();
            markCustomized();
        });
    });

    // Font selects — live preview
    document.getElementById('font-family-select')?.addEventListener('change', applyLiveTheme);
    document.getElementById('font-mono-select')?.addEventListener('change', applyLiveTheme);

    // Import/Export buttons
    document.getElementById('theme-import-btn')?.addEventListener('click', importTheme);
    document.getElementById('theme-export-btn')?.addEventListener('click', exportTheme);

    // Custom font upload buttons
    document.getElementById('font-upload-ui-btn')?.addEventListener('click', () => handleUploadFont('ui'));
    document.getElementById('font-upload-mono-btn')?.addEventListener('click', () => handleUploadFont('mono'));

    // Start orb preview animation
    startOrbPreview();

    // Initialize message card controls
    initMessageCardControls();
}

/** Initialize message card controls — sliders, pickers, toggle, style select */
function initMessageCardControls() {
    const fontSizeSlider = document.getElementById('msg-font-size');
    const paddingSlider = document.getElementById('msg-padding');
    const avatarSizeSlider = document.getElementById('msg-avatar-size');
    const showAvatarsToggle = document.getElementById('msg-show-avatars');
    const bubbleStyleSelect = document.getElementById('msg-bubble-style');
    const userColorPicker = document.getElementById('msg-user-color');
    const aiColorPicker = document.getElementById('msg-ai-color');

    if (!fontSizeSlider) return; // Section not in DOM

    function updateMessagePreview() {
        const fontSize = fontSizeSlider.value + 'px';
        const padding = paddingSlider.value + 'px ' + (parseInt(paddingSlider.value) + 4) + 'px';
        const avatarSize = avatarSizeSlider.value + 'px';
        const showAvatars = showAvatarsToggle.checked;

        // Bubble style radii
        const style = BUBBLE_STYLE_PRESETS[bubbleStyleSelect.value] || BUBBLE_STYLE_PRESETS.rounded;

        // User bubble color -> gradient
        const userHex = userColorPicker.value;
        const userRgb = hexToRgb(userHex);
        const userBg = `linear-gradient(135deg, rgba(${userRgb.r}, ${userRgb.g}, ${userRgb.b}, 0.4) 0%, rgba(${Math.max(0, userRgb.r - 20)}, ${Math.max(0, userRgb.g - 20)}, ${Math.max(0, userRgb.b - 20)}, 0.35) 100%)`;
        const userBorder = `rgba(${userRgb.r}, ${userRgb.g}, ${userRgb.b}, 0.3)`;

        // AI bubble color -> gradient
        const aiHex = aiColorPicker.value;
        const aiRgb = hexToRgb(aiHex);
        const aiBg = `linear-gradient(135deg, rgba(${aiRgb.r}, ${aiRgb.g}, ${aiRgb.b}, 0.95) 0%, rgba(${Math.max(0, aiRgb.r - 5)}, ${Math.max(0, aiRgb.g - 5)}, ${Math.max(0, aiRgb.b - 5)}, 0.95) 100%)`;
        const aiBorder = `rgba(${Math.min(255, aiRgb.r + 30)}, ${Math.min(255, aiRgb.g + 30)}, ${Math.min(255, aiRgb.b + 30)}, 0.06)`;

        // Apply to root for live preview (affects both preview and real chat)
        const overrides = {
            fontSize,
            lineHeight: '1.5',
            padding,
            avatarSize,
            userBg,
            userBorder,
            userRadius: style.userRadius,
            aiBg,
            aiBorder,
            aiRadius: style.aiRadius,
            showAvatars,
        };
        applyMessageCardOverrides(overrides);

        // Update value labels
        document.getElementById('msg-font-size-value').textContent = fontSize;
        document.getElementById('msg-padding-value').textContent = paddingSlider.value + 'px';
        document.getElementById('msg-avatar-size-value').textContent = avatarSize;

        // Update color hex labels
        document.getElementById('msg-user-color-hex').textContent = userHex;
        document.getElementById('msg-ai-color-hex').textContent = aiHex;

        // Toggle avatars on preview container too
        const previewContainer = document.getElementById('msg-preview-container');
        if (previewContainer) {
            previewContainer.classList.toggle('chat-hide-avatars', !showAvatars);
        }
    }

    // Wire all controls
    fontSizeSlider.addEventListener('input', updateMessagePreview);
    paddingSlider.addEventListener('input', updateMessagePreview);
    avatarSizeSlider.addEventListener('input', updateMessagePreview);
    showAvatarsToggle.addEventListener('change', updateMessagePreview);
    bubbleStyleSelect.addEventListener('change', updateMessagePreview);
    userColorPicker.addEventListener('input', updateMessagePreview);
    aiColorPicker.addEventListener('input', updateMessagePreview);
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
