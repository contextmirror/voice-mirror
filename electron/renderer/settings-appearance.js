/**
 * settings-appearance.js - Appearance tab logic
 *
 * Theme presets, color pickers, fonts, orb preview, message card customization,
 * theme import/export, custom font management.
 */

import { state } from './state.js';
import { createLog } from './log.js';
const log = createLog('[Settings:Appearance]');
import { PRESETS, deriveOrbColors, applyTheme, buildExportData, validateImportData, applyMessageCardOverrides, hexToRgb } from './theme-engine.js';
import { renderOrb, DURATIONS } from './orb-canvas.js';

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

// ========== Custom Font Management ==========
const _injectedFontStyles = new Map();

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

/** Select a preset theme -- updates pickers, fonts, and applies live */
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

/** Start the 128x128 orb preview animation loop */
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
export function stopOrbPreview() {
    if (orbPreviewFrame) { cancelAnimationFrame(orbPreviewFrame); orbPreviewFrame = null; }
    if (orbPreviewCycleTimer) { clearInterval(orbPreviewCycleTimer); orbPreviewCycleTimer = null; }
}

/** Import a theme from JSON file */
async function importTheme() {
    try {
        const result = await window.voiceMirror.theme.import();
        if (!result || !result.success) return; // User cancelled or failed

        const validation = validateImportData(result.data);
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
        log.error('Theme import failed:', err);
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
        log.error('Theme export failed:', err);
    }
}

/** Revert to theme snapshot if user navigates away without saving */
export function revertThemeIfUnsaved() {
    if (state._themeSnapshot) {
        applyTheme(state._themeSnapshot.colors, state._themeSnapshot.fonts);
        // Revert message card overrides
        if (state._themeSnapshot.messageCard && Object.keys(state._themeSnapshot.messageCard).length > 0) {
            applyMessageCardOverrides(state._themeSnapshot.messageCard);
        }
        state._themeSnapshot = null;
    }
}

// ========== Custom Font Helpers ==========

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
    const fontsResult = await window.voiceMirror.fonts.list();
    const fonts = fontsResult.data || [];
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
        log.error('Failed to add font:', addResult.error);
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
        log.error('Failed to remove font:', result.error);
        return;
    }

    removeInjectedFont(fontId);
    await loadCustomFonts();
    applyLiveTheme();
}

// ========== Message Card Controls ==========

/** Initialize message card controls -- sliders, pickers, toggle, style select */
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

// ========== Load + Init ==========

/**
 * Load appearance settings into the UI from config.
 * Called by loadSettingsUI() in the coordinator.
 */
export async function loadAppearanceUI() {
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

    // Fonts -- load custom fonts first so their <option>s exist before setting values
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

/**
 * Build the appearance save data from current UI state.
 * Called by saveSettings() in the coordinator.
 */
export function buildAppearanceSaveData() {
    const themeName = state._activeThemePreset || 'dark';
    const preset = PRESETS[themeName] || PRESETS.dark;
    const currentColors = gatherColors();
    const currentFonts = gatherFonts();

    const colorsCustomized = state._themeCustomized ||
        Object.keys(preset.colors).some(k => currentColors[k] !== preset.colors[k]);

    const fontsCustomized = currentFonts.fontFamily !== preset.fonts.fontFamily ||
        currentFonts.fontMono !== preset.fonts.fontMono;

    // Message card -- only save if customized from defaults
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

/**
 * Initialize appearance tab -- preset cards, color pickers, orb preview, import/export.
 * Called by initSettings() in the coordinator.
 */
export function initAppearanceTab() {
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

    // Color picker live preview -- every change updates the ENTIRE APP
    document.querySelectorAll('.color-picker-control input[type="color"]').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const key = e.target.dataset.key;
            const hexSpan = document.getElementById(`color-${key}-hex`);
            if (hexSpan) hexSpan.textContent = e.target.value;
            applyLiveTheme();
            markCustomized();
        });
    });

    // Font selects -- live preview
    document.getElementById('font-family-select')?.addEventListener('change', applyLiveTheme);
    document.getElementById('font-mono-select')?.addEventListener('change', applyLiveTheme);

    // Import/Export buttons
    document.getElementById('theme-import-btn')?.addEventListener('click', importTheme);
    document.getElementById('theme-export-btn')?.addEventListener('click', exportTheme);

    // Custom font upload buttons
    document.getElementById('font-upload-ui-btn')?.addEventListener('click', () => handleUploadFont('ui'));
    document.getElementById('font-upload-mono-btn')?.addEventListener('click', () => handleUploadFont('mono'));

    // Orb size slider
    document.getElementById('orb-size').addEventListener('input', (e) => {
        document.getElementById('orb-size-value').textContent = e.target.value + 'px';
    });

    // Start orb preview animation
    startOrbPreview();

    // Initialize message card controls
    initMessageCardControls();
}
