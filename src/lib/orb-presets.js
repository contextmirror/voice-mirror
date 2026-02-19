/**
 * orb-presets.js -- Built-in orb visual style presets and helpers.
 *
 * Each preset defines how the orb looks and animates across all states.
 * Users can pick a preset, tweak it with overrides, or import custom presets.
 */

// ---- Preset schema ----
//
// stateColors[state] — { rf, gf, bf, rAdd, gAdd, bAdd } color shift multipliers
//   rf/gf/bf multiply the base color channel (0-2 range)
//   rAdd/gAdd/bAdd add after multiply (0-1 range)
//   null = no shift (identity)
//
// animation[state] — { duration, scaleAmt, waveform }
//   duration: ms per animation cycle
//   scaleAmt: pulse amplitude (0 = none, 0.15 = large)
//   waveform: 'sine' | 'compound' | 'tremor' | 'none'
//
// render — visual rendering params
//   gradientCenterAlpha, gradientEdgeAlpha: 0-1
//   borderWidth: px (0-6)
//   borderAlpha: 0-1
//   glowRadius: px (0-50)
//   glowAlpha: 0-1
//   glowColor: 'accent' | 'center' | hex string
//   edgeDarken: 0-1 (multiplier for edge color)
//   innerShadow: boolean
//
// icons — { style, alpha, scale }
//   style: 'default' | 'minimal' | 'geometric' | 'none'
//   alpha: 0-1
//   scale: 0-1 (relative to inner radius)

/** @type {Record<string, OrbPreset>} */
export const ORB_PRESETS = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'The original Voice Mirror orb',
    stateColors: {
      idle:      null,
      listening: { rf: 1.3, gf: 0.7, bf: 1.0, rAdd: 0.1, gAdd: 0, bAdd: 0 },
      speaking:  { rf: 0.8, gf: 1.1, bf: 1.2, rAdd: 0, gAdd: 0.05, bAdd: 0.1 },
      thinking:  { rf: 0.6, gf: 1.2, bf: 1.1, rAdd: 0, gAdd: 0.1, bAdd: 0 },
      dictating: { rf: 1.0, gf: 1.1, bf: 1.3, rAdd: 0, gAdd: 0, bAdd: 0.1 },
      error:     { rf: 1.4, gf: 0.5, bf: 0.5, rAdd: 0.15, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 1500, scaleAmt: 0.05, waveform: 'sine' },
      listening: { duration: 500,  scaleAmt: 0.12, waveform: 'sine' },
      speaking:  { duration: 1000, scaleAmt: 0.08, waveform: 'compound' },
      thinking:  { duration: 2000, scaleAmt: 0,    waveform: 'none' },
      dictating: { duration: 800,  scaleAmt: 0.05, waveform: 'sine' },
      error:     { duration: 600,  scaleAmt: 0.04, waveform: 'tremor' },
    },
    render: {
      gradientCenterAlpha: 0.95,
      gradientEdgeAlpha: 0.95,
      borderWidth: 2,
      borderAlpha: 0.5,
      glowRadius: 0,
      glowAlpha: 0,
      glowColor: 'accent',
      edgeDarken: 0.6,
      innerShadow: false,
    },
    icons: { style: 'default', alpha: 0.85, scale: 0.55 },
  },

  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean and subtle — no icons, just color shifts',
    stateColors: {
      idle:      null,
      listening: { rf: 1.15, gf: 0.85, bf: 1.0, rAdd: 0.05, gAdd: 0, bAdd: 0 },
      speaking:  { rf: 0.9, gf: 1.05, bf: 1.1, rAdd: 0, gAdd: 0.03, bAdd: 0.05 },
      thinking:  { rf: 0.8, gf: 1.1, bf: 1.05, rAdd: 0, gAdd: 0.05, bAdd: 0 },
      dictating: { rf: 1.0, gf: 1.05, bf: 1.15, rAdd: 0, gAdd: 0, bAdd: 0.05 },
      error:     { rf: 1.2, gf: 0.7, bf: 0.7, rAdd: 0.08, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 2500, scaleAmt: 0.02, waveform: 'sine' },
      listening: { duration: 800,  scaleAmt: 0.06, waveform: 'sine' },
      speaking:  { duration: 1500, scaleAmt: 0.04, waveform: 'sine' },
      thinking:  { duration: 3000, scaleAmt: 0.02, waveform: 'sine' },
      dictating: { duration: 1200, scaleAmt: 0.03, waveform: 'sine' },
      error:     { duration: 1000, scaleAmt: 0.02, waveform: 'sine' },
    },
    render: {
      gradientCenterAlpha: 0.9,
      gradientEdgeAlpha: 0.85,
      borderWidth: 1,
      borderAlpha: 0.3,
      glowRadius: 0,
      glowAlpha: 0,
      glowColor: 'accent',
      edgeDarken: 0.7,
      innerShadow: false,
    },
    icons: { style: 'none', alpha: 0, scale: 0 },
  },

  neon: {
    id: 'neon',
    name: 'Neon Pulse',
    description: 'Vivid glow with cyberpunk energy',
    stateColors: {
      idle:      { rf: 1.0, gf: 1.0, bf: 1.0, rAdd: 0, gAdd: 0, bAdd: 0.05 },
      listening: { rf: 1.5, gf: 0.5, bf: 1.0, rAdd: 0.15, gAdd: 0, bAdd: 0 },
      speaking:  { rf: 0.6, gf: 1.3, bf: 1.4, rAdd: 0, gAdd: 0.1, bAdd: 0.15 },
      thinking:  { rf: 0.5, gf: 1.4, bf: 1.2, rAdd: 0, gAdd: 0.15, bAdd: 0 },
      dictating: { rf: 1.0, gf: 1.2, bf: 1.5, rAdd: 0, gAdd: 0, bAdd: 0.15 },
      error:     { rf: 1.6, gf: 0.3, bf: 0.3, rAdd: 0.2, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 1200, scaleAmt: 0.06, waveform: 'sine' },
      listening: { duration: 350,  scaleAmt: 0.15, waveform: 'sine' },
      speaking:  { duration: 700,  scaleAmt: 0.10, waveform: 'compound' },
      thinking:  { duration: 1500, scaleAmt: 0,    waveform: 'none' },
      dictating: { duration: 600,  scaleAmt: 0.07, waveform: 'sine' },
      error:     { duration: 400,  scaleAmt: 0.06, waveform: 'tremor' },
    },
    render: {
      gradientCenterAlpha: 1.0,
      gradientEdgeAlpha: 0.9,
      borderWidth: 2,
      borderAlpha: 0.8,
      glowRadius: 20,
      glowAlpha: 0.35,
      glowColor: 'accent',
      edgeDarken: 0.5,
      innerShadow: false,
    },
    icons: { style: 'geometric', alpha: 0.9, scale: 0.5 },
  },

  ghost: {
    id: 'ghost',
    name: 'Ghost',
    description: 'Translucent and ethereal with soft pulsing',
    stateColors: {
      idle:      null,
      listening: { rf: 1.1, gf: 0.9, bf: 1.0, rAdd: 0.05, gAdd: 0, bAdd: 0 },
      speaking:  { rf: 0.9, gf: 1.0, bf: 1.1, rAdd: 0, gAdd: 0, bAdd: 0.05 },
      thinking:  { rf: 0.85, gf: 1.1, bf: 1.0, rAdd: 0, gAdd: 0.05, bAdd: 0 },
      dictating: { rf: 1.0, gf: 1.0, bf: 1.1, rAdd: 0, gAdd: 0, bAdd: 0.03 },
      error:     { rf: 1.2, gf: 0.6, bf: 0.6, rAdd: 0.1, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 3000, scaleAmt: 0.03, waveform: 'sine' },
      listening: { duration: 1000, scaleAmt: 0.08, waveform: 'sine' },
      speaking:  { duration: 1800, scaleAmt: 0.05, waveform: 'sine' },
      thinking:  { duration: 4000, scaleAmt: 0,    waveform: 'none' },
      dictating: { duration: 1500, scaleAmt: 0.04, waveform: 'sine' },
      error:     { duration: 1200, scaleAmt: 0.03, waveform: 'sine' },
    },
    render: {
      gradientCenterAlpha: 0.55,
      gradientEdgeAlpha: 0.35,
      borderWidth: 1,
      borderAlpha: 0.2,
      glowRadius: 15,
      glowAlpha: 0.15,
      glowColor: 'center',
      edgeDarken: 0.75,
      innerShadow: false,
    },
    icons: { style: 'minimal', alpha: 0.5, scale: 0.5 },
  },

  ember: {
    id: 'ember',
    name: 'Ember',
    description: 'Warm and fiery with aggressive pulsing',
    stateColors: {
      idle:      { rf: 1.1, gf: 0.9, bf: 0.8, rAdd: 0.05, gAdd: 0, bAdd: 0 },
      listening: { rf: 1.5, gf: 0.6, bf: 0.4, rAdd: 0.2, gAdd: 0.05, bAdd: 0 },
      speaking:  { rf: 1.2, gf: 0.8, bf: 0.5, rAdd: 0.1, gAdd: 0.05, bAdd: 0 },
      thinking:  { rf: 1.0, gf: 0.9, bf: 0.7, rAdd: 0.05, gAdd: 0.05, bAdd: 0 },
      dictating: { rf: 1.3, gf: 0.7, bf: 0.5, rAdd: 0.1, gAdd: 0, bAdd: 0 },
      error:     { rf: 1.6, gf: 0.3, bf: 0.2, rAdd: 0.2, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 1200, scaleAmt: 0.06, waveform: 'sine' },
      listening: { duration: 400,  scaleAmt: 0.14, waveform: 'sine' },
      speaking:  { duration: 800,  scaleAmt: 0.10, waveform: 'compound' },
      thinking:  { duration: 1800, scaleAmt: 0,    waveform: 'none' },
      dictating: { duration: 650,  scaleAmt: 0.06, waveform: 'sine' },
      error:     { duration: 350,  scaleAmt: 0.08, waveform: 'tremor' },
    },
    render: {
      gradientCenterAlpha: 1.0,
      gradientEdgeAlpha: 0.9,
      borderWidth: 2,
      borderAlpha: 0.6,
      glowRadius: 12,
      glowAlpha: 0.25,
      glowColor: '#ff6b35',
      edgeDarken: 0.45,
      innerShadow: true,
    },
    icons: { style: 'default', alpha: 0.9, scale: 0.55 },
  },

  frost: {
    id: 'frost',
    name: 'Frost',
    description: 'Cool and crystalline with sharp subtlety',
    stateColors: {
      idle:      { rf: 0.85, gf: 0.95, bf: 1.1, rAdd: 0, gAdd: 0, bAdd: 0.03 },
      listening: { rf: 0.9, gf: 0.8, bf: 1.2, rAdd: 0.05, gAdd: 0, bAdd: 0.1 },
      speaking:  { rf: 0.7, gf: 1.0, bf: 1.3, rAdd: 0, gAdd: 0.05, bAdd: 0.1 },
      thinking:  { rf: 0.7, gf: 1.1, bf: 1.2, rAdd: 0, gAdd: 0.08, bAdd: 0.05 },
      dictating: { rf: 0.8, gf: 1.0, bf: 1.2, rAdd: 0, gAdd: 0, bAdd: 0.08 },
      error:     { rf: 1.3, gf: 0.6, bf: 0.7, rAdd: 0.1, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 2200, scaleAmt: 0.03, waveform: 'sine' },
      listening: { duration: 700,  scaleAmt: 0.08, waveform: 'sine' },
      speaking:  { duration: 1200, scaleAmt: 0.06, waveform: 'compound' },
      thinking:  { duration: 2800, scaleAmt: 0,    waveform: 'none' },
      dictating: { duration: 1000, scaleAmt: 0.04, waveform: 'sine' },
      error:     { duration: 800,  scaleAmt: 0.03, waveform: 'tremor' },
    },
    render: {
      gradientCenterAlpha: 0.88,
      gradientEdgeAlpha: 0.82,
      borderWidth: 1.5,
      borderAlpha: 0.4,
      glowRadius: 10,
      glowAlpha: 0.18,
      glowColor: '#88ccff',
      edgeDarken: 0.65,
      innerShadow: false,
    },
    icons: { style: 'geometric', alpha: 0.7, scale: 0.5 },
  },

  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Nature-inspired with shifting green-blue hues',
    stateColors: {
      idle:      { rf: 0.7, gf: 1.1, bf: 1.0, rAdd: 0, gAdd: 0.05, bAdd: 0.03 },
      listening: { rf: 0.8, gf: 1.2, bf: 0.9, rAdd: 0, gAdd: 0.1, bAdd: 0 },
      speaking:  { rf: 0.6, gf: 1.0, bf: 1.3, rAdd: 0, gAdd: 0.05, bAdd: 0.1 },
      thinking:  { rf: 0.5, gf: 1.3, bf: 1.1, rAdd: 0, gAdd: 0.12, bAdd: 0.05 },
      dictating: { rf: 0.7, gf: 1.1, bf: 1.2, rAdd: 0, gAdd: 0.05, bAdd: 0.08 },
      error:     { rf: 1.3, gf: 0.5, bf: 0.5, rAdd: 0.15, gAdd: 0, bAdd: 0 },
    },
    animation: {
      idle:      { duration: 2000, scaleAmt: 0.04, waveform: 'sine' },
      listening: { duration: 600,  scaleAmt: 0.10, waveform: 'sine' },
      speaking:  { duration: 1100, scaleAmt: 0.07, waveform: 'compound' },
      thinking:  { duration: 2500, scaleAmt: 0,    waveform: 'none' },
      dictating: { duration: 900,  scaleAmt: 0.05, waveform: 'sine' },
      error:     { duration: 700,  scaleAmt: 0.04, waveform: 'tremor' },
    },
    render: {
      gradientCenterAlpha: 0.92,
      gradientEdgeAlpha: 0.88,
      borderWidth: 1.5,
      borderAlpha: 0.45,
      glowRadius: 14,
      glowAlpha: 0.22,
      glowColor: 'center',
      edgeDarken: 0.6,
      innerShadow: false,
    },
    icons: { style: 'minimal', alpha: 0.7, scale: 0.5 },
  },
};

// ---- Default preset (fallback) ----
export const DEFAULT_ORB_PRESET = 'classic';

// ---- Helpers ----

/**
 * Deep-merge a base preset with user overrides.
 * Only overrides explicitly provided keys; everything else comes from base.
 */
export function deepMergePreset(base, overrides) {
  if (!overrides || typeof overrides !== 'object') return base;
  const result = {};
  for (const key of Object.keys(base)) {
    const baseVal = base[key];
    const overVal = overrides[key];
    if (overVal === undefined || overVal === null) {
      result[key] = baseVal;
    } else if (typeof baseVal === 'object' && !Array.isArray(baseVal) && baseVal !== null
               && typeof overVal === 'object' && !Array.isArray(overVal) && overVal !== null) {
      result[key] = deepMergePreset(baseVal, overVal);
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

/**
 * Resolve the active orb preset from config.
 * Merges built-in or custom preset with any user overrides.
 *
 * @param {object} orbConfig - appearance.orb from config (may be null)
 * @param {Array} customPresets - user-imported custom presets array
 * @returns {object} Fully resolved preset object
 */
export function resolveOrbPreset(orbConfig, customPresets = []) {
  const presetId = orbConfig?.preset || DEFAULT_ORB_PRESET;

  // Check built-in presets first, then custom
  let base = ORB_PRESETS[presetId];
  if (!base) {
    base = customPresets?.find(p => p.id === presetId);
  }
  if (!base) {
    base = ORB_PRESETS[DEFAULT_ORB_PRESET];
  }

  if (orbConfig?.overrides) {
    return deepMergePreset(base, orbConfig.overrides);
  }
  return base;
}

/**
 * Validate an imported orb preset object.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateOrbPreset(preset) {
  const errors = [];
  if (!preset || typeof preset !== 'object') {
    return { valid: false, errors: ['Preset must be a JSON object'] };
  }

  // Required top-level keys
  const required = ['stateColors', 'animation', 'render', 'icons'];
  for (const key of required) {
    if (!preset[key]) errors.push(`Missing required key: ${key}`);
  }
  if (errors.length > 0) return { valid: false, errors };

  // Validate states exist in stateColors and animation
  const states = ['idle', 'listening', 'speaking', 'thinking', 'dictating', 'error'];
  for (const s of states) {
    if (!(s in preset.stateColors)) errors.push(`stateColors missing state: ${s}`);
    if (!preset.animation[s]) errors.push(`animation missing state: ${s}`);
  }

  // Validate render values are in range
  const r = preset.render;
  if (r) {
    if (typeof r.gradientCenterAlpha === 'number') r.gradientCenterAlpha = clamp(r.gradientCenterAlpha, 0, 1);
    if (typeof r.gradientEdgeAlpha === 'number') r.gradientEdgeAlpha = clamp(r.gradientEdgeAlpha, 0, 1);
    if (typeof r.borderWidth === 'number') r.borderWidth = clamp(r.borderWidth, 0, 6);
    if (typeof r.borderAlpha === 'number') r.borderAlpha = clamp(r.borderAlpha, 0, 1);
    if (typeof r.glowRadius === 'number') r.glowRadius = clamp(r.glowRadius, 0, 50);
    if (typeof r.glowAlpha === 'number') r.glowAlpha = clamp(r.glowAlpha, 0, 1);
    if (typeof r.edgeDarken === 'number') r.edgeDarken = clamp(r.edgeDarken, 0, 1);
  }

  // Validate icons
  const validStyles = ['default', 'minimal', 'geometric', 'none'];
  if (preset.icons?.style && !validStyles.includes(preset.icons.style)) {
    errors.push(`Invalid icon style: ${preset.icons.style}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Convert user-facing slider values to preset override fields.
 */
export function slidersToOverrides({ glowIntensity, borderWidth, opacity, animSpeed, iconStyle }) {
  const overrides = { render: {}, animation: {}, icons: {} };

  // Glow: 0-100% → glowRadius 0-30, glowAlpha 0-0.5
  if (glowIntensity !== undefined) {
    const t = glowIntensity / 100;
    overrides.render.glowRadius = Math.round(t * 30);
    overrides.render.glowAlpha = +(t * 0.5).toFixed(2);
  }

  if (borderWidth !== undefined) {
    overrides.render.borderWidth = borderWidth;
  }

  // Opacity: 30-100% → gradientCenterAlpha
  if (opacity !== undefined) {
    overrides.render.gradientCenterAlpha = +(opacity / 100).toFixed(2);
    overrides.render.gradientEdgeAlpha = +((opacity / 100) * 0.9).toFixed(2);
  }

  // Animation speed: 0.5-2x multiplier applied to all state durations
  if (animSpeed !== undefined && animSpeed !== 1) {
    const states = ['idle', 'listening', 'speaking', 'thinking', 'dictating', 'error'];
    for (const s of states) {
      if (!overrides.animation[s]) overrides.animation[s] = {};
      // Will be applied as a multiplier during resolution
    }
    overrides._animSpeedMultiplier = animSpeed;
  }

  if (iconStyle !== undefined) {
    overrides.icons.style = iconStyle;
  }

  return overrides;
}

/**
 * Convert preset override fields back to user-facing slider values.
 */
export function overridesToSliders(preset, overrides) {
  const r = overrides?.render || {};
  const glowIntensity = r.glowRadius !== undefined
    ? Math.round((r.glowRadius / 30) * 100)
    : Math.round((preset.render.glowRadius / 30) * 100);
  const borderWidth = r.borderWidth ?? preset.render.borderWidth;
  const opacity = r.gradientCenterAlpha !== undefined
    ? Math.round(r.gradientCenterAlpha * 100)
    : Math.round(preset.render.gradientCenterAlpha * 100);
  const animSpeed = overrides?._animSpeedMultiplier ?? 1;
  const iconStyle = overrides?.icons?.style ?? preset.icons.style;

  return { glowIntensity, borderWidth, opacity, animSpeed, iconStyle };
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
