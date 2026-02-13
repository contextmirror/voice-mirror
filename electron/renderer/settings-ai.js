/**
 * settings-ai.js - AI & Tools tab logic
 *
 * Provider selection, scanning, CLI install, model selection, context length,
 * system prompt, API key management, tool profiles.
 */

import { state } from './state.js';
import { createLog } from './log.js';
const log = createLog('[Settings:AI]');
import { showToast, updateToast } from './notifications.js';
import { navigateTo } from './navigation.js';

// Provider display names
export const PROVIDER_NAMES = {
    claude: 'Claude Code',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    jan: 'Jan',
    opencode: 'OpenCode'
};

// Provider icon CSS classes (used by terminal.js for sidebar provider display)
export const PROVIDER_ICON_CLASSES = {
    claude: 'provider-icon-claude',
    ollama: 'provider-icon-ollama',
    lmstudio: 'provider-icon-lmstudio',
    jan: 'provider-icon-jan',
    opencode: 'provider-icon-opencode'
};

// CLI agent providers (PTY-based, full terminal access)
export const CLI_PROVIDERS = ['claude', 'opencode'];

// Local providers that can be auto-detected
export const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'jan'];

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

    // Hide API key row (cloud access goes through OpenCode)
    apikeyRow.style.display = 'none';

    // Model row: hide for CLI providers (they use their own CLI), show for others
    modelRow.style.display = isCLI ? 'none' : 'flex';

    // Context length: show for local providers (Ollama, LM Studio, Jan)
    if (contextLengthRow) {
        contextLengthRow.style.display = LOCAL_PROVIDERS.includes(provider) ? 'flex' : 'none';
    }

    // Tool profiles: show for MCP CLI providers (Claude Code, OpenCode)
    const toolProfileSection = document.getElementById('tool-profile-section');
    if (toolProfileSection) {
        toolProfileSection.style.display = CLI_PROVIDERS.includes(provider) ? 'block' : 'none';
    }

    // Update terminal profile badge
    updateTerminalProfileBadge(
        CLI_PROVIDERS.includes(provider) ? (PROFILE_DISPLAY_NAMES[state.activeToolProfile] || 'Voice Assistant') : ''
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
        const scanResult = await window.voiceMirror.ai.scanProviders();
        const results = scanResult.data || [];
        state.detectedProviders = results;

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
                // Skip embedding models -- they aren't chat models
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

        log.info('Provider scan complete:', results);

    } catch (err) {
        log.error('Provider scan failed:', err);
        statusDiv.className = 'detection-status';
        statusDiv.innerHTML = '<span class="detection-label">Failed to scan providers</span>';
    } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Now';
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

        // Check if CLI provider is installed, prompt to install if not
        if (CLI_PROVIDERS.includes(value)) {
            checkAndPromptCLIInstall(value);
        }

        // Populate models from detected providers
        const providerData = state.detectedProviders?.find(p => p.type === value);
        const modelSelect = document.getElementById('ai-model');
        if (providerData?.models?.length > 0) {
            modelSelect.innerHTML = '<option value="">Auto (default)</option>';
            for (const model of providerData.models) {
                // Skip embedding models -- they aren't chat models
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
 * Check if a CLI provider is installed and prompt to install if not.
 * Currently only supports auto-install for OpenCode.
 */
async function checkAndPromptCLIInstall(providerId) {
    if (providerId !== 'opencode') return;

    try {
        const result = await window.voiceMirror.ai.checkCLIAvailable('opencode');
        if (result.data?.available) return;

        showToast(
            'OpenCode is not installed.',
            'warning',
            0,
            {
                actionText: 'Install',
                onAction: async (toastEl) => {
                    updateToast(toastEl, 'Installing OpenCode...', 'loading');

                    try {
                        const installResult = await window.voiceMirror.ai.installCLI('opencode');

                        if (installResult.success) {
                            updateToast(toastEl, 'OpenCode installed successfully!', 'success');
                        } else {
                            updateToast(
                                toastEl,
                                `Install failed. Run "npm install -g opencode-ai" manually.`,
                                'error'
                            );
                            log.error('OpenCode install failed:', installResult.error);
                        }
                    } catch (err) {
                        updateToast(
                            toastEl,
                            `Install failed. Run "npm install -g opencode-ai" manually.`,
                            'error'
                        );
                        log.error('OpenCode install error:', err);
                    }
                }
            }
        );
    } catch (err) {
        log.error('CLI availability check failed:', err);
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

// ============================================
// Tool Profile Functions
// ============================================

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

    // Checkbox change -> switch to custom or update profile
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

    // No match -- show as modified but keep the current profile name
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
    const name = window.prompt('Profile name:');
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
        <button class="delete-custom-profile" data-profile="${key}">\u2715</button>
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
export function getToolProfileUpdates() {
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
// Load + Init for AI tab
// ============================================

/**
 * Load AI-related settings into the UI from config.
 * Called by loadSettingsUI() in the coordinator.
 */
export async function loadAISettingsUI() {
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
        const keysResult = await window.voiceMirror.python.getDetectedKeys();
        state._detectedKeyProviders = keysResult.data || [];
    } catch { state._detectedKeyProviders = []; }

    // Populate API key field for current provider
    populateApiKeyField(selectedProvider);

    // If auto-detect is enabled, scan for providers
    if (aiConfig.autoDetect !== false) {
        scanProviders();
    }

    // Tool profiles (Claude Code only)
    loadToolProfileUI();
}

/**
 * Collect AI save data from current UI state.
 * Called by saveSettings() in the coordinator.
 */
export function collectAISaveData() {
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

    // Tool profile updates (MCP CLI providers)
    const toolProfileUpdates = getToolProfileUpdates();
    Object.assign(aiUpdates, toolProfileUpdates);

    return { aiUpdates, aiProvider, aiModel, aiContextLength };
}

/**
 * Build the display name for a provider+model combo.
 */
export function buildProviderDisplayName(aiProvider, aiModel) {
    let displayName = PROVIDER_NAMES[aiProvider] || aiProvider;
    // CLI providers manage their own model -- don't append stale model names
    if (aiModel && !CLI_PROVIDERS.includes(aiProvider)) {
        const shortModel = aiModel.split(':')[0];
        displayName = `${displayName} (${shortModel})`;
    }
    return displayName;
}

/**
 * Initialize AI tab event handlers.
 * Called by initSettings() in the coordinator.
 */
export function initAITab() {
    initProviderSelector();
    initToolProfiles();
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
window.scanProviders = scanProviders;

window.deleteCurrentProfile = function() {
    if (state.activeToolProfile) deleteProfile(state.activeToolProfile);
};
