/**
 * theme.js -- Theme system: presets, color derivation, CSS variable application.
 *
 * Ported from the Electron theme-engine.js. All 8 preset themes plus
 * color utility functions and CSS variable management.
 */

// ============ Color Utilities ============

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r, g, b) {
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
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  hsl.l = Math.min(1, hsl.l + amount);
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  hsl.l = Math.max(0, hsl.l - amount);
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function blend(hex1, hex2, t) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  return rgbToHex(
    Math.round(c1.r * (1 - t) + c2.r * t),
    Math.round(c1.g * (1 - t) + c2.g * t),
    Math.round(c1.b * (1 - t) + c2.b * t),
  );
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============ Preset Themes ============

export const PRESETS = {
  colorblind: {
    name: 'Colorblind',
    colors: {
      bg: '#0c0d10', bgElevated: '#14161c',
      text: '#e4e4e7', textStrong: '#fafafa', muted: '#71717a',
      accent: '#56b4e9',
      ok: '#0072b2', warn: '#e69f00', danger: '#d55e00',
      orbCore: '#1b2e4e',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  midnight: {
    name: 'Midnight',
    colors: {
      bg: '#0a0e1a', bgElevated: '#111827',
      text: '#d1d5db', textStrong: '#f9fafb', muted: '#6b7280',
      accent: '#3b82f6',
      ok: '#34d399', warn: '#f59e0b', danger: '#f87171',
      orbCore: '#1e3a5f',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  emerald: {
    name: 'Emerald',
    colors: {
      bg: '#0a1210', bgElevated: '#111f1a',
      text: '#d1e7dd', textStrong: '#ecfdf5', muted: '#6b9080',
      accent: '#10b981',
      ok: '#34d399', warn: '#fbbf24', danger: '#f87171',
      orbCore: '#064e3b',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  rose: {
    name: 'Rose',
    colors: {
      bg: '#140a0e', bgElevated: '#1f1115',
      text: '#f0dde3', textStrong: '#fdf2f8', muted: '#b07a8a',
      accent: '#ec4899',
      ok: '#4ade80', warn: '#fbbf24', danger: '#ef4444',
      orbCore: '#4a0e2b',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  slate: {
    name: 'Slate',
    colors: {
      bg: '#0f1114', bgElevated: '#1e2028',
      text: '#cbd5e1', textStrong: '#f1f5f9', muted: '#94a3b8',
      accent: '#6366f1',
      ok: '#4ade80', warn: '#fbbf24', danger: '#ef4444',
      orbCore: '#1e1b4b',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  black: {
    name: 'Black',
    colors: {
      bg: '#000000', bgElevated: '#0e0e0e',
      text: '#d4d4d4', textStrong: '#ffffff', muted: '#707070',
      accent: '#22c55e',
      ok: '#4ade80', warn: '#bfa86f', danger: '#bf6f6f',
      orbCore: '#0a0a0a',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  gray: {
    name: 'Claude Gray',
    colors: {
      bg: '#191919', bgElevated: '#232323',
      text: '#d4cfc7', textStrong: '#f5f0e8', muted: '#8a8580',
      accent: '#d4873e',
      ok: '#6bba6b', warn: '#e0a832', danger: '#d45b5b',
      orbCore: '#3d2e1f',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
  light: {
    name: 'Light',
    colors: {
      bg: '#f5f5f5', bgElevated: '#ffffff',
      text: '#1a1a2e', textStrong: '#0a0a0a', muted: '#6b7280',
      accent: '#4f46e5',
      ok: '#16a34a', warn: '#d97706', danger: '#dc2626',
      orbCore: '#c7d2fe',
    },
    fonts: {
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontMono: "'Cascadia Code', 'Fira Code', monospace",
    },
  },
};

// ============ Derivation ============

/**
 * Derive all CSS variables from 10 key colors + 2 fonts.
 * @param {{ bg, bgElevated, text, textStrong, muted, accent, ok, warn, danger, orbCore }} colors
 * @param {{ fontFamily, fontMono }} fonts
 * @returns {Object} Map of CSS property name -> value string
 */
export function deriveTheme(colors, fonts = {}) {
  const c = colors;
  const f = fonts;

  // Detect light vs dark background for contrast-aware derivation
  const bgLum = (() => {
    const { r, g, b } = hexToRgb(c.bg);
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  })();
  const isLight = bgLum > 0.5;

  return {
    '--bg': c.bg,
    '--bg-accent': blend(c.bg, c.bgElevated, 0.4),
    '--bg-elevated': c.bgElevated,
    '--bg-hover': isLight ? darken(c.bgElevated, 0.04) : lighten(c.bgElevated, 0.06),
    '--chrome': blend(c.bg, c.bgElevated, 0.65),
    '--card': blend(c.bg, c.bgElevated, 0.3),
    '--card-highlight': hexToRgba(c.textStrong, 0.03),
    '--text': c.text,
    '--text-strong': c.textStrong,
    '--muted': c.muted,
    '--border': hexToRgba(c.textStrong, isLight ? 0.12 : 0.06),
    '--border-strong': hexToRgba(c.textStrong, isLight ? 0.18 : 0.10),
    '--accent': c.accent,
    '--accent-hover': lighten(c.accent, 0.12),
    '--accent-subtle': hexToRgba(c.accent, 0.15),
    '--accent-glow': hexToRgba(c.accent, 0.25),
    '--accent-contrast': (() => {
      const { r, g, b } = hexToRgb(c.accent);
      return (r * 0.299 + g * 0.587 + b * 0.114) > 160 ? '#000000' : '#ffffff';
    })(),
    '--ok': c.ok,
    '--ok-subtle': hexToRgba(c.ok, 0.15),
    '--ok-glow': hexToRgba(c.ok, 0.5),
    '--warn': c.warn,
    '--warn-subtle': hexToRgba(c.warn, 0.15),
    '--danger': c.danger,
    '--danger-subtle': hexToRgba(c.danger, 0.15),
    '--danger-glow': hexToRgba(c.danger, 0.5),
    '--shadow-sm': isLight
      ? `0 1px 3px ${hexToRgba('#000000', 0.08)}`
      : `0 1px 3px ${hexToRgba(darken(c.bg, 0.05), 0.4)}`,
    '--shadow-md': isLight
      ? `0 4px 12px ${hexToRgba('#000000', 0.12)}`
      : `0 4px 12px ${hexToRgba(darken(c.bg, 0.05), 0.5)}`,
    '--shadow-lg': isLight
      ? `0 12px 28px ${hexToRgba('#000000', 0.15)}`
      : `0 12px 28px ${hexToRgba(darken(c.bg, 0.05), 0.6)}`,
    '--font-family': f.fontFamily || PRESETS.colorblind.fonts.fontFamily,
    '--font-mono': f.fontMono || PRESETS.colorblind.fonts.fontMono,
    '--msg-font-size': '14px',
    '--msg-line-height': '1.5',
    '--msg-padding': '12px 16px',
    '--msg-avatar-size': '36px',
    '--msg-user-bg': isLight
      ? `linear-gradient(135deg, ${hexToRgba(c.accent, 0.18)} 0%, ${hexToRgba(darken(c.accent, 0.08), 0.14)} 100%)`
      : `linear-gradient(135deg, ${hexToRgba(c.accent, 0.4)} 0%, ${hexToRgba(darken(c.accent, 0.15), 0.35)} 100%)`,
    '--msg-user-border': hexToRgba(c.accent, isLight ? 0.25 : 0.3),
    '--msg-user-radius': '16px 16px 4px 16px',
    '--msg-ai-bg': isLight
      ? `linear-gradient(135deg, ${darken(c.bg, 0.04)} 0%, ${darken(c.bg, 0.06)} 100%)`
      : `linear-gradient(135deg, ${blend(c.bg, c.bgElevated, 0.5)} 0%, ${blend(c.bg, c.bgElevated, 0.2)} 100%)`,
    '--msg-ai-border': hexToRgba(c.textStrong, isLight ? 0.12 : 0.10),
    '--msg-ai-radius': '4px 16px 16px 16px',
  };
}

// ============ Application ============

/**
 * Apply a theme: set all CSS variables on :root.
 * @param {{ bg, bgElevated, text, textStrong, muted, accent, ok, warn, danger, orbCore }} colors
 * @param {{ fontFamily, fontMono }} fonts
 */
export function applyTheme(colors, fonts = {}) {
  const vars = deriveTheme(colors, fonts);
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
}

// ============ Reactive Store ============

/**
 * Reactive store for the current theme name.
 * Uses Svelte 5 $state internally.
 */
function createThemeStore() {
  let value = $state('colorblind');

  return {
    get value() { return value; },
    set value(v) {
      if (PRESETS[v]) {
        value = v;
      }
    },
  };
}

export const currentThemeName = createThemeStore();

/**
 * Resolve theme by name, returning colors and fonts.
 * Falls back to colorblind if the name is unknown.
 * @param {string} name
 * @returns {{ colors: Object, fonts: Object }}
 */
export function resolveTheme(name) {
  const preset = PRESETS[name] || PRESETS.colorblind;
  return { colors: preset.colors, fonts: preset.fonts };
}
