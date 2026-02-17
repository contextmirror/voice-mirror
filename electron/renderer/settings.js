/**
 * settings.js - Settings coordinator
 *
 * Slim entry point that handles tab routing, save/reset, and delegates
 * to focused sub-modules for each settings tab:
 *   - settings-ai.js        (AI & Tools tab)
 *   - settings-voice.js     (Voice & Audio tab)
 *   - settings-appearance.js (Appearance tab)
 *
 * General tab fields (user name, behavior toggles, overlay) live here
 * since they are too small for a dedicated module.
 */

import { state } from './state.js';
import { navigateTo } from './navigation.js';
import { createLog } from './log.js';
const log = createLog('[Settings]');

// Re-export constants consumed by other modules (terminal.js imports PROVIDER_ICON_CLASSES)
export { PROVIDER_ICON_CLASSES, PROVIDER_NAMES, CLI_PROVIDERS, LOCAL_PROVIDERS } from './settings-ai.js';

// Sub-module imports
import {
    initAITab,
    loadAISettingsUI,
    collectAISaveData,
    buildProviderDisplayName,
} from './settings-ai.js';

import {
    initVoiceTab,
    loadVoiceSettingsUI,
    collectVoiceSaveData,
    ensureAdapterDeps,
} from './settings-voice.js';

import {
    initAppearanceTab,
    loadAppearanceUI,
    buildAppearanceSaveData,
    revertThemeIfUnsaved,
    stopOrbPreview,
} from './settings-appearance.js';

import {
    initDependenciesTab,
    loadDependenciesUI,
} from './settings-dependencies.js';

// ========== Modular Tab System ==========
const SETTINGS_TABS = [
    { id: 'ai',      label: 'AI & Tools' },
    { id: 'voice',   label: 'Voice & Audio' },
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'dependencies', label: 'Dependencies', flag: 'advanced.showDependencies' },
];

const SETTINGS_TAB_STORAGE_KEY = 'vm-settings-tab';

// Template cache -- loaded once, reused across tab switches
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
 * Initialize settings tabs -- generates tab buttons, attaches handlers, restores last tab.
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

// ========== General Tab Helpers ==========

/**
 * Load available overlay outputs (monitors) from wayland orb
 */
async function loadOverlayOutputs() {
    const section = document.getElementById('overlay-display-section');
    const select = document.getElementById('overlay-output');
    if (!section || !select) return;

    try {
        const outputsResult = await window.voiceMirror.overlay.listOutputs();
        const outputs = outputsResult.data || [];
        if (outputs.length <= 1) {
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
        log.info('Could not load overlay outputs:', err);
        section.style.display = 'none';
    }
}

// ========== Toggle / Load / Save / Reset ==========

/**
 * Toggle settings - navigates to settings page or back to chat
 */
export function toggleSettings() {
    if (state.currentPage === 'settings') {
        // Go back to chat -- revert unsaved theme changes
        revertThemeIfUnsaved();
        stopOrbPreview();
        navigateTo('chat');
    } else {
        // Navigate to settings page
        navigateTo('settings');
        loadSettingsUI();
    }
}

/**
 * Load settings UI from config
 */
export async function loadSettingsUI() {
    try {
        state.currentConfig = await window.voiceMirror.config.get();
        log.info('Loaded config:', state.currentConfig);

        // Show/hide feature-flagged tabs
        for (const tab of SETTINGS_TABS) {
            if (!tab.flag) continue;
            const keys = tab.flag.split('.');
            let val = state.currentConfig;
            for (const k of keys) val = val?.[k];
            const btn = document.querySelector(`.settings-tab[data-tab="${tab.id}"]`);
            if (btn) btn.style.display = val ? '' : 'none';
        }

        // General tab: User name
        document.getElementById('user-name').value = state.currentConfig.user?.name || '';

        // General tab: Behavior
        document.getElementById('start-minimized').checked = state.currentConfig.behavior?.startMinimized || false;
        document.getElementById('start-with-system').checked = state.currentConfig.behavior?.startWithSystem || false;

        // Voice & Audio tab
        await loadVoiceSettingsUI();

        // Appearance tab
        await loadAppearanceUI();

        // AI & Tools tab
        await loadAISettingsUI();

        // General tab: Overlay display (monitor selection)
        await loadOverlayOutputs();

        // Dependencies tab (only when feature flag is on)
        if (state.currentConfig?.advanced?.showDependencies) {
            await loadDependenciesUI();
        }

    } catch (err) {
        log.error('Failed to load config:', err);
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

    // Check adapter dependencies (no-op after Rust migration)
    const depsOk = await ensureAdapterDeps();
    if (!depsOk) return;

    // Collect data from sub-modules
    const voiceData = collectVoiceSaveData();
    const { aiUpdates, aiProvider, aiModel, aiContextLength } = collectAISaveData();

    const updates = {
        behavior: {
            ...voiceData.behavior,
            startMinimized: document.getElementById('start-minimized').checked,
            startWithSystem: document.getElementById('start-with-system').checked
        },
        wakeWord: voiceData.wakeWord,
        voice: voiceData.voice,
        appearance: buildAppearanceSaveData(),
        user: {
            name: document.getElementById('user-name').value.trim() || state.currentConfig.user?.name || null
        },
        ai: aiUpdates,
        overlay: {
            outputName: document.getElementById('overlay-output')?.value || null
        }
    };

    // Detect provider/model changes BEFORE config.set() -- the main process
    // restarts the provider during that await, and the 'start' event arrives
    // before config.set() returns. The flag must be set first.
    const oldProvider = state.currentProvider;
    const oldModel = state.currentModel;
    const oldContextLength = state.currentContextLength;
    const providerChanged = oldProvider !== aiProvider;
    const modelChanged = oldModel !== aiModel;
    const contextLengthChanged = oldContextLength !== aiContextLength;
    if (providerChanged || modelChanged || contextLengthChanged) {
        log.info(`Provider/model changed: ${oldProvider}/${oldModel} -> ${aiProvider}/${aiModel}`);

        // Update state so next terminal banner shows the NEW provider name
        state.currentProvider = aiProvider;
        state.currentModel = aiModel;
        state.currentContextLength = aiContextLength;

        // Flag: clear terminal when new provider connects + bump generation
        state.pendingProviderClear = true;
        state.providerGeneration++;
    }

    try {
        const newConfig = await window.voiceMirror.config.set(updates);
        log.info('Saved config:', newConfig);

        // Update welcome message with new mode
        window.updateWelcomeMessage();

        // Update provider display in terminal/sidebar
        const displayName = buildProviderDisplayName(aiProvider, aiModel);
        const { updateProviderDisplay } = await import('./terminal.js');
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
        log.error('Failed to save:', err);
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
        log.info('Reset to defaults');
    } catch (err) {
        log.error('Failed to reset:', err);
    }
}

// ========== Init ==========

/**
 * Initialize settings event listeners.
 * Loads tab templates first, then wires up all event handlers.
 */
export async function initSettings() {
    // Load tab templates into the DOM before anything else
    await loadAllTabTemplates();

    // Initialize tab system (needs templates loaded for icon card handlers)
    initSettingsTabs();

    // Initialize sub-module tabs
    initAITab();
    initVoiceTab();
    initAppearanceTab();
    initDependenciesTab();
}

// ========== Uninstall ==========

/**
 * Show uninstall confirmation and trigger uninstall process.
 */
async function showUninstallConfirm() {
    const confirmed = confirm(
        'This will remove Voice Mirror from your system:\n\n' +
        '- Desktop shortcuts\n' +
        '- CLI global link\n' +
        '- Configuration data (you will be asked)\n\n' +
        'The app will close. Continue?'
    );
    if (!confirmed) return;

    const keepConfig = !confirm(
        'Do you want to REMOVE your configuration and data?\n\n' +
        'Click OK to remove everything.\n' +
        'Click Cancel to keep config for future reinstall.'
    );

    try {
        const result = await window.voiceMirror.runUninstall(keepConfig);
        if (result.success) {
            alert('Voice Mirror has been uninstalled.\n\nTo complete removal, delete the install directory:\n' + (result.installDir || ''));
            window.voiceMirror.quitApp();
        } else {
            alert('Uninstall failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Uninstall failed: ' + err.message);
    }
}

// Expose functions globally for onclick handlers in HTML templates
window.toggleSettings = toggleSettings;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.loadSettingsUI = loadSettingsUI;
window.showUninstallConfirm = showUninstallConfirm;
