/**
 * Device preset registry for Device Preview feature.
 * Organized by manufacturer with phone/tablet sub-types.
 * Each preset defines viewport dimensions, DPR, and user agent for a real device.
 */

// ── Manufacturer registry with icons ──

export const MANUFACTURERS = [
  {
    id: 'apple',
    name: 'Apple',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.3 7.4c0-1.7 1.4-2.5 1.5-2.6-.8-1.2-2.1-1.4-2.5-1.4-1.1-.1-2.1.6-2.6.6s-1.4-.6-2.3-.6C3 3.4 1.7 4.5 1.7 7.5c0 1.2.4 2.4 1 3.2.5.7 1.1 1.5 1.8 1.5.7 0 1-.5 1.9-.5s1.1.5 1.9.5c.8 0 1.3-.7 1.8-1.4.4-.5.6-1 .7-1.1-.1 0-1.5-.5-1.5-2.3zM8.9 2.5c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.6 0 1.3-.4 1.7-.8z" fill="currentColor"/></svg>',
  },
  {
    id: 'samsung',
    name: 'Samsung',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5.5C3.5 4.7 4.2 4 5 4h4c.8 0 1.5.7 1.5 1.5v3c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5v-3z" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="6" y="2.5" width="2" height="1.5" rx=".5" fill="currentColor"/><rect x="6" y="10" width="2" height="1.5" rx=".5" fill="currentColor"/></svg>',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M7 4.5v5M9 6H7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  },
  {
    id: 'motorola',
    name: 'Motorola',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10V4.5C2 3.7 2.7 3 3.5 3h7c.8 0 1.5.7 1.5 1.5V10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5 10V6l2 2.5L9 6v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    id: 'oneplus',
    name: 'OnePlus',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi',
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="4" width="9" height="6.5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="5" y="6" width="4" height="3" rx=".5" fill="currentColor" opacity=".6"/></svg>',
  },
];

// ── User agent strings ──

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Device presets ──

export const DEVICE_PRESETS = [
  // ── Apple: iPhone ──
  { id: 'iphone-se-3', name: 'iPhone SE 3rd Gen', manufacturer: 'apple', type: 'phone', width: 375, height: 667, dpr: 2, userAgent: IPHONE_UA },
  { id: 'iphone-13', name: 'iPhone 13', manufacturer: 'apple', type: 'phone', width: 390, height: 844, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-14', name: 'iPhone 14', manufacturer: 'apple', type: 'phone', width: 390, height: 844, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-15', name: 'iPhone 15', manufacturer: 'apple', type: 'phone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA, popular: true },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', manufacturer: 'apple', type: 'phone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', manufacturer: 'apple', type: 'phone', width: 430, height: 932, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-16', name: 'iPhone 16', manufacturer: 'apple', type: 'phone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA, popular: true },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', manufacturer: 'apple', type: 'phone', width: 402, height: 874, dpr: 3, userAgent: IPHONE_UA },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', manufacturer: 'apple', type: 'phone', width: 440, height: 956, dpr: 3, userAgent: IPHONE_UA },

  // ── Apple: iPad ──
  { id: 'ipad-mini-6', name: 'iPad Mini 6th Gen', manufacturer: 'apple', type: 'tablet', width: 744, height: 1133, dpr: 2, userAgent: IPAD_UA },
  { id: 'ipad-air-m2', name: 'iPad Air M2', manufacturer: 'apple', type: 'tablet', width: 820, height: 1180, dpr: 2, userAgent: IPAD_UA, popular: true },
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', manufacturer: 'apple', type: 'tablet', width: 834, height: 1194, dpr: 2, userAgent: IPAD_UA },
  { id: 'ipad-pro-13', name: 'iPad Pro 13"', manufacturer: 'apple', type: 'tablet', width: 1032, height: 1376, dpr: 2, userAgent: IPAD_UA },

  // ── Samsung: Phone ──
  { id: 'galaxy-s24', name: 'Galaxy S24', manufacturer: 'samsung', type: 'phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', manufacturer: 'samsung', type: 'phone', width: 384, height: 824, dpr: 3.75, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-s25', name: 'Galaxy S25', manufacturer: 'samsung', type: 'phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA, popular: true },
  { id: 'galaxy-s25-ultra', name: 'Galaxy S25 Ultra', manufacturer: 'samsung', type: 'phone', width: 412, height: 915, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-a54', name: 'Galaxy A54', manufacturer: 'samsung', type: 'phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-a15', name: 'Galaxy A15', manufacturer: 'samsung', type: 'phone', width: 360, height: 800, dpr: 2, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-z-fold-folded', name: 'Galaxy Z Fold (Folded)', manufacturer: 'samsung', type: 'phone', width: 280, height: 653, dpr: 2.55, userAgent: ANDROID_PHONE_UA },
  { id: 'galaxy-z-fold-open', name: 'Galaxy Z Fold (Open)', manufacturer: 'samsung', type: 'phone', width: 600, height: 653, dpr: 2.55, userAgent: ANDROID_PHONE_UA },

  // ── Samsung: Tablet ──
  { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', manufacturer: 'samsung', type: 'tablet', width: 800, height: 1280, dpr: 2, userAgent: ANDROID_TABLET_UA },

  // ── Google: Phone ──
  { id: 'pixel-8', name: 'Pixel 8', manufacturer: 'google', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'pixel-8-pro', name: 'Pixel 8 Pro', manufacturer: 'google', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'pixel-9', name: 'Pixel 9', manufacturer: 'google', type: 'phone', width: 412, height: 923, dpr: 2.625, userAgent: ANDROID_PHONE_UA, popular: true },
  { id: 'pixel-9-pro', name: 'Pixel 9 Pro', manufacturer: 'google', type: 'phone', width: 410, height: 914, dpr: 3.125, userAgent: ANDROID_PHONE_UA },

  // ── Google: Tablet ──
  { id: 'pixel-tablet', name: 'Pixel Tablet', manufacturer: 'google', type: 'tablet', width: 1200, height: 2000, dpr: 2, userAgent: ANDROID_TABLET_UA },

  // ── Motorola: Phone ──
  { id: 'moto-g56', name: 'Moto G56', manufacturer: 'motorola', type: 'phone', width: 360, height: 800, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g54', name: 'Moto G54', manufacturer: 'motorola', type: 'phone', width: 360, height: 800, dpr: 3, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g-power-2024', name: 'Moto G Power (2024)', manufacturer: 'motorola', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g-stylus-2024', name: 'Moto G Stylus (2024)', manufacturer: 'motorola', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
  { id: 'moto-g-play-2024', name: 'Moto G Play (2024)', manufacturer: 'motorola', type: 'phone', width: 360, height: 800, dpr: 2, userAgent: ANDROID_PHONE_UA },

  // ── OnePlus: Phone ──
  { id: 'oneplus-12', name: 'OnePlus 12', manufacturer: 'oneplus', type: 'phone', width: 412, height: 919, dpr: 3.5, userAgent: ANDROID_PHONE_UA },
  { id: 'oneplus-nord', name: 'OnePlus Nord', manufacturer: 'oneplus', type: 'phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },

  // ── Xiaomi: Phone ──
  { id: 'redmi-note-13', name: 'Redmi Note 13', manufacturer: 'xiaomi', type: 'phone', width: 393, height: 873, dpr: 2.75, userAgent: ANDROID_PHONE_UA },
];

// ── Backward-compatible category derivation ──

function deriveCategory(preset) {
  if (preset.manufacturer === 'apple') return preset.type === 'tablet' ? 'iPad' : 'iPhone';
  return preset.type === 'tablet' ? 'Android Tablet' : 'Android Phone';
}

// Add category field to each preset for backward compatibility
for (const preset of DEVICE_PRESETS) {
  preset.category = deriveCategory(preset);
}

/** @deprecated Use MANUFACTURERS and manufacturer field instead */
export const DEVICE_CATEGORIES = ['iPhone', 'iPad', 'Android Phone', 'Android Tablet'];

/**
 * Find a device preset by its unique ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getPresetById(id) {
  return DEVICE_PRESETS.find(p => p.id === id) ?? null;
}

/**
 * Get all presets belonging to a legacy category.
 * @deprecated Use getPresetsByManufacturer instead
 * @param {string} category
 * @returns {object[]}
 */
export function getPresetsByCategory(category) {
  return DEVICE_PRESETS.filter(p => p.category === category);
}

/**
 * Get all presets for a given manufacturer ID.
 * @param {string} manufacturerId - e.g. 'apple', 'samsung'
 * @returns {object[]}
 */
export function getPresetsByManufacturer(manufacturerId) {
  return DEVICE_PRESETS.filter(p => p.manufacturer === manufacturerId);
}

/**
 * Get all presets marked as popular.
 * @returns {object[]}
 */
export function getPopularPresets() {
  return DEVICE_PRESETS.filter(p => p.popular);
}
