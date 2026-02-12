/**
 * theme-engine.js — Theme system: presets, color derivation, CSS variable application.
 *
 * Users pick 10 key colors + 2 fonts. Everything else (20+ CSS variables, orb colors)
 * is derived automatically. `applyTheme()` sets CSS vars on :root and updates the orb.
 */

// ========== Color Utilities ==========

export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function rgbToHex(r, g, b) {
    const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h, s, l };
}

function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
        r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, h) * 255),
        b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
}

export function lighten(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const hsl = rgbToHsl(r, g, b);
    hsl.l = Math.min(1, hsl.l + amount);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function darken(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const hsl = rgbToHsl(r, g, b);
    hsl.l = Math.max(0, hsl.l - amount);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function blend(hex1, hex2, t) {
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);
    return rgbToHex(
        Math.round(c1.r * (1 - t) + c2.r * t),
        Math.round(c1.g * (1 - t) + c2.g * t),
        Math.round(c1.b * (1 - t) + c2.b * t)
    );
}

export function hexToRgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ========== Preset Themes ==========

export const PRESETS = {
    dark: {
        name: 'Dark',
        colors: {
            bg: '#0c0d10', bgElevated: '#14161c',
            text: '#e4e4e7', textStrong: '#fafafa', muted: '#71717a',
            accent: '#667eea',
            ok: '#4ade80', warn: '#fbbf24', danger: '#ef4444',
            orbCore: '#2d1b4e'
        },
        fonts: {
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontMono: "'Cascadia Code', 'Fira Code', monospace"
        }
    },
    midnight: {
        name: 'Midnight',
        colors: {
            bg: '#0a0e1a', bgElevated: '#111827',
            text: '#d1d5db', textStrong: '#f9fafb', muted: '#6b7280',
            accent: '#3b82f6',
            ok: '#34d399', warn: '#f59e0b', danger: '#f87171',
            orbCore: '#1e3a5f'
        },
        fonts: {
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontMono: "'Cascadia Code', 'Fira Code', monospace"
        }
    },
    emerald: {
        name: 'Emerald',
        colors: {
            bg: '#0a1210', bgElevated: '#111f1a',
            text: '#d1e7dd', textStrong: '#ecfdf5', muted: '#6b9080',
            accent: '#10b981',
            ok: '#34d399', warn: '#fbbf24', danger: '#f87171',
            orbCore: '#064e3b'
        },
        fonts: {
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontMono: "'Cascadia Code', 'Fira Code', monospace"
        }
    },
    rose: {
        name: 'Rose',
        colors: {
            bg: '#140a0e', bgElevated: '#1f1115',
            text: '#f0dde3', textStrong: '#fdf2f8', muted: '#b07a8a',
            accent: '#ec4899',
            ok: '#4ade80', warn: '#fbbf24', danger: '#ef4444',
            orbCore: '#4a0e2b'
        },
        fonts: {
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontMono: "'Cascadia Code', 'Fira Code', monospace"
        }
    },
    slate: {
        name: 'Slate',
        colors: {
            bg: '#0f1114', bgElevated: '#1e2028',
            text: '#cbd5e1', textStrong: '#f1f5f9', muted: '#94a3b8',
            accent: '#6366f1',
            ok: '#4ade80', warn: '#fbbf24', danger: '#ef4444',
            orbCore: '#1e1b4b'
        },
        fonts: {
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontMono: "'Cascadia Code', 'Fira Code', monospace"
        }
    },
    gray: {
        name: 'Claude Gray',
        colors: {
            bg: '#191919', bgElevated: '#232323',
            text: '#d4cfc7', textStrong: '#f5f0e8', muted: '#8a8580',
            accent: '#d4873e',
            ok: '#6bba6b', warn: '#e0a832', danger: '#d45b5b',
            orbCore: '#3d2e1f'
        },
        fonts: {
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontMono: "'Cascadia Code', 'Fira Code', monospace"
        }
    }
};

export const PRESET_NAMES = Object.keys(PRESETS);

// ========== Derivation ==========

/**
 * Derive all CSS variables from 10 key colors + 2 fonts.
 * @param {{ bg, bgElevated, text, textStrong, muted, accent, ok, warn, danger, orbCore }} colors
 * @param {{ fontFamily, fontMono }} fonts
 * @returns {Object} Map of CSS property name → value string
 */
export function deriveTheme(colors, fonts = {}) {
    const c = colors;
    const f = fonts;
    return {
        '--bg': c.bg,
        '--bg-accent': blend(c.bg, c.bgElevated, 0.4),
        '--bg-elevated': c.bgElevated,
        '--bg-hover': lighten(c.bgElevated, 0.06),
        '--card': blend(c.bg, c.bgElevated, 0.3),
        '--card-highlight': hexToRgba(c.textStrong, 0.03),
        '--text': c.text,
        '--text-strong': c.textStrong,
        '--muted': c.muted,
        '--border': hexToRgba(c.textStrong, 0.06),
        '--border-strong': hexToRgba(c.textStrong, 0.10),
        '--accent': c.accent,
        '--accent-hover': lighten(c.accent, 0.12),
        '--accent-subtle': hexToRgba(c.accent, 0.15),
        '--accent-glow': hexToRgba(c.accent, 0.25),
        '--ok': c.ok,
        '--warn': c.warn,
        '--danger': c.danger,
        '--shadow-sm': `0 1px 3px ${hexToRgba(darken(c.bg, 0.05), 0.4)}`,
        '--shadow-md': `0 4px 12px ${hexToRgba(darken(c.bg, 0.05), 0.5)}`,
        '--shadow-lg': `0 12px 28px ${hexToRgba(darken(c.bg, 0.05), 0.6)}`,
        '--font-family': f.fontFamily || PRESETS.dark.fonts.fontFamily,
        '--font-mono': f.fontMono || PRESETS.dark.fonts.fontMono,
        '--msg-font-size': '14px',
        '--msg-line-height': '1.5',
        '--msg-padding': '12px 16px',
        '--msg-avatar-size': '36px',
        '--msg-user-bg': `linear-gradient(135deg, ${hexToRgba(c.accent, 0.4)} 0%, ${hexToRgba(darken(c.accent, 0.15), 0.35)} 100%)`,
        '--msg-user-border': hexToRgba(c.accent, 0.3),
        '--msg-user-radius': '16px 16px 4px 16px',
        '--msg-ai-bg': `linear-gradient(135deg, ${blend(c.bg, c.bgElevated, 0.3)} 0%, ${c.bg} 100%)`,
        '--msg-ai-border': hexToRgba(c.textStrong, 0.06),
        '--msg-ai-radius': '4px 16px 16px 16px',
    };
}

/**
 * Derive orb-specific colors from key colors.
 * Returns RGB arrays for the orb renderer.
 */
export function deriveOrbColors(colors) {
    const accent = hexToRgb(colors.accent);
    const center = hexToRgb(colors.orbCore);
    const edgeHex = darken(colors.orbCore, 0.15);
    const edge = hexToRgb(edgeHex);
    const icon = hexToRgb(colors.text);
    const eyeHex = darken(colors.orbCore, 0.1);
    const eye = hexToRgb(eyeHex);
    return {
        borderRgb: [accent.r, accent.g, accent.b],
        centerRgb: [center.r, center.g, center.b],
        edgeRgb: [edge.r, edge.g, edge.b],
        iconRgb: [icon.r, icon.g, icon.b],
        eyeRgb: [eye.r, eye.g, eye.b],
    };
}

// ========== Theme Resolution ==========

/**
 * Resolve config appearance object to key colors + fonts.
 * @param {Object} appearance - config.appearance { theme, colors, fonts }
 * @returns {{ colors: Object, fonts: Object }}
 */
export function resolveTheme(appearance = {}) {
    const themeName = appearance.theme || 'dark';
    const preset = PRESETS[themeName] || PRESETS.dark;

    const colors = appearance.colors || preset.colors;
    const fonts = appearance.fonts || preset.fonts;

    return { colors, fonts };
}

// ========== Terminal Theme Derivation ==========

/**
 * Derive an xterm.js theme object from the 10 key colors.
 * Maps theme colors to terminal background, foreground, cursor, and ANSI palette.
 * @param {{ bg, bgElevated, text, textStrong, muted, accent, ok, warn, danger, orbCore }} colors
 * @returns {Object} xterm.js theme object
 */
export function deriveTerminalTheme(colors) {
    const c = colors;
    return {
        background: c.bg,
        foreground: c.text,
        cursor: c.accent,
        cursorAccent: c.bg,
        selectionBackground: hexToRgba(c.accent, 0.3),
        black: lighten(c.bg, 0.05),
        red: c.danger,
        green: c.ok,
        yellow: c.warn,
        blue: c.accent,
        magenta: lighten(blend(c.accent, c.danger, 0.5), 0.1),
        cyan: lighten(blend(c.accent, c.ok, 0.5), 0.1),
        white: c.text,
        brightBlack: c.muted,
        brightRed: lighten(c.danger, 0.15),
        brightGreen: lighten(c.ok, 0.15),
        brightYellow: lighten(c.warn, 0.15),
        brightBlue: lighten(c.accent, 0.15),
        brightMagenta: lighten(blend(c.accent, c.danger, 0.5), 0.25),
        brightCyan: lighten(blend(c.accent, c.ok, 0.5), 0.25),
        brightWhite: c.textStrong
    };
}

// ========== Application ==========

// Callback for orb color updates (set by orb-canvas.js)
let _orbColorCallback = null;

export function onOrbColorsChanged(callback) {
    _orbColorCallback = callback;
}

// Callback for terminal theme updates (set by terminal.js)
let _terminalThemeCallback = null;

export function onTerminalThemeChanged(callback) {
    _terminalThemeCallback = callback;
}

/**
 * Apply a theme: set all CSS variables on :root, update orb colors, and update terminal.
 */
export function applyTheme(colors, fonts = {}) {
    const vars = deriveTheme(colors, fonts);
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(vars)) {
        root.style.setProperty(prop, value);
    }

    const orbColors = deriveOrbColors(colors);
    if (_orbColorCallback) _orbColorCallback(orbColors);

    const termTheme = deriveTerminalTheme(colors);
    const termFont = fonts.fontMono || PRESETS.dark.fonts.fontMono;
    if (_terminalThemeCallback) _terminalThemeCallback(termTheme, termFont);
}

/**
 * Apply message card overrides from config onto :root CSS variables.
 * Also toggles the .chat-hide-avatars class on #chat-container.
 * @param {Object} messageCard - config object with optional keys:
 *   fontSize, lineHeight, padding, avatarSize, userBg, userBorder,
 *   userRadius, aiBg, aiBorder, aiRadius, showAvatars
 */
export function applyMessageCardOverrides(messageCard) {
    if (!messageCard || typeof messageCard !== 'object') return;
    const root = document.documentElement;
    const map = {
        fontSize:   '--msg-font-size',
        lineHeight: '--msg-line-height',
        padding:    '--msg-padding',
        avatarSize: '--msg-avatar-size',
        userBg:     '--msg-user-bg',
        userBorder: '--msg-user-border',
        userRadius: '--msg-user-radius',
        aiBg:       '--msg-ai-bg',
        aiBorder:   '--msg-ai-border',
        aiRadius:   '--msg-ai-radius',
    };
    for (const [key, prop] of Object.entries(map)) {
        if (messageCard[key] !== undefined && messageCard[key] !== null) {
            root.style.setProperty(prop, messageCard[key]);
        }
    }
    // Toggle avatar visibility class
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
        chatContainer.classList.toggle('chat-hide-avatars', messageCard.showAvatars === false);
    }
}

/**
 * Clear all inline theme overrides, reverting to tokens.css defaults.
 */
export function clearThemeOverrides() {
    const props = [
        '--bg', '--bg-accent', '--bg-elevated', '--bg-hover',
        '--card', '--card-highlight',
        '--text', '--text-strong', '--muted',
        '--border', '--border-strong',
        '--accent', '--accent-hover', '--accent-subtle', '--accent-glow',
        '--ok', '--warn', '--danger',
        '--shadow-sm', '--shadow-md', '--shadow-lg',
        '--font-family', '--font-mono',
        '--msg-font-size', '--msg-line-height', '--msg-padding', '--msg-avatar-size',
        '--msg-user-bg', '--msg-user-border', '--msg-user-radius',
        '--msg-ai-bg', '--msg-ai-border', '--msg-ai-radius',
    ];
    const root = document.documentElement;
    for (const prop of props) {
        root.style.removeProperty(prop);
    }
}

// ========== Import / Export Helpers ==========

const COLOR_KEYS = ['bg', 'bgElevated', 'text', 'textStrong', 'muted', 'accent', 'ok', 'warn', 'danger', 'orbCore'];
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Build an exportable theme object from current colors + fonts.
 */
export function buildExportData(name, colors, fonts) {
    return {
        name: name || 'Custom Theme',
        version: 1,
        colors: { ...colors },
        fonts: { ...fonts }
    };
}

/**
 * Validate an imported theme object. Returns { valid, colors, fonts, error }.
 */
export function validateImportData(data) {
    if (!data || typeof data !== 'object') return { valid: false, error: 'Invalid file format' };
    if (data.version !== 1) return { valid: false, error: 'Unsupported theme version' };
    if (!data.colors || typeof data.colors !== 'object') return { valid: false, error: 'Missing colors' };

    for (const key of COLOR_KEYS) {
        if (!data.colors[key] || !HEX_PATTERN.test(data.colors[key])) {
            return { valid: false, error: `Invalid or missing color: ${key}` };
        }
    }

    const fonts = data.fonts || PRESETS.dark.fonts;
    return { valid: true, colors: data.colors, fonts };
}
