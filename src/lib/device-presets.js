/**
 * Device preset registry for Device Preview feature.
 * Each preset defines viewport dimensions, DPR, and user agent for a real device.
 */

export const DEVICE_CATEGORIES = [
    'iPhone',
    'iPad',
    'Android Phone',
    'Android Tablet',
    'Desktop'
];

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const DEVICE_PRESETS = [
    // iPhone (8 devices)
    { id: 'iphone-se-3', name: 'iPhone SE 3rd Gen', category: 'iPhone', width: 375, height: 667, dpr: 2, userAgent: IPHONE_UA },
    { id: 'iphone-14', name: 'iPhone 14', category: 'iPhone', width: 390, height: 844, dpr: 3, userAgent: IPHONE_UA },
    { id: 'iphone-15', name: 'iPhone 15', category: 'iPhone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA },
    { id: 'iphone-15-pro', name: 'iPhone 15 Pro', category: 'iPhone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA },
    { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', category: 'iPhone', width: 430, height: 932, dpr: 3, userAgent: IPHONE_UA },
    { id: 'iphone-16', name: 'iPhone 16', category: 'iPhone', width: 393, height: 852, dpr: 3, userAgent: IPHONE_UA },
    { id: 'iphone-16-pro', name: 'iPhone 16 Pro', category: 'iPhone', width: 402, height: 874, dpr: 3, userAgent: IPHONE_UA },
    { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', category: 'iPhone', width: 440, height: 956, dpr: 3, userAgent: IPHONE_UA },

    // iPad (4 devices)
    { id: 'ipad-mini-6', name: 'iPad Mini 6th Gen', category: 'iPad', width: 744, height: 1133, dpr: 2, userAgent: IPAD_UA },
    { id: 'ipad-air-m2', name: 'iPad Air M2', category: 'iPad', width: 820, height: 1180, dpr: 2, userAgent: IPAD_UA },
    { id: 'ipad-pro-11', name: 'iPad Pro 11"', category: 'iPad', width: 834, height: 1194, dpr: 2, userAgent: IPAD_UA },
    { id: 'ipad-pro-13', name: 'iPad Pro 13"', category: 'iPad', width: 1032, height: 1376, dpr: 2, userAgent: IPAD_UA },

    // Android Phone (11 devices)
    { id: 'pixel-8', name: 'Pixel 8', category: 'Android Phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
    { id: 'pixel-8-pro', name: 'Pixel 8 Pro', category: 'Android Phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
    { id: 'galaxy-s24', name: 'Galaxy S24', category: 'Android Phone', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE_UA },
    { id: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', category: 'Android Phone', width: 412, height: 915, dpr: 3.5, userAgent: ANDROID_PHONE_UA },
    { id: 'galaxy-z-fold-folded', name: 'Galaxy Z Fold (Folded)', category: 'Android Phone', width: 280, height: 653, dpr: 2.55, userAgent: ANDROID_PHONE_UA },
    { id: 'galaxy-z-fold-open', name: 'Galaxy Z Fold (Open)', category: 'Android Phone', width: 600, height: 653, dpr: 2.55, userAgent: ANDROID_PHONE_UA },
    { id: 'moto-g56', name: 'Moto G56', category: 'Android Phone', width: 360, height: 800, dpr: 3, userAgent: ANDROID_PHONE_UA },
    { id: 'moto-g54', name: 'Moto G54', category: 'Android Phone', width: 360, height: 800, dpr: 3, userAgent: ANDROID_PHONE_UA },
    { id: 'moto-g-power-2024', name: 'Moto G Power (2024)', category: 'Android Phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
    { id: 'moto-g-stylus-2024', name: 'Moto G Stylus (2024)', category: 'Android Phone', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE_UA },
    { id: 'moto-g-play-2024', name: 'Moto G Play (2024)', category: 'Android Phone', width: 360, height: 800, dpr: 2, userAgent: ANDROID_PHONE_UA },

    // Android Tablet (2 devices)
    { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', category: 'Android Tablet', width: 800, height: 1280, dpr: 2, userAgent: ANDROID_TABLET_UA },
    { id: 'pixel-tablet', name: 'Pixel Tablet', category: 'Android Tablet', width: 1200, height: 2000, dpr: 2, userAgent: ANDROID_TABLET_UA },

    // Desktop (3 devices)
    { id: 'desktop-laptop', name: 'Laptop (1366x768)', category: 'Desktop', width: 1366, height: 768, dpr: 1, userAgent: '' },
    { id: 'desktop-fhd', name: 'Full HD (1920x1080)', category: 'Desktop', width: 1920, height: 1080, dpr: 1, userAgent: '' },
    { id: 'desktop-2k', name: '2K (2560x1440)', category: 'Desktop', width: 2560, height: 1440, dpr: 1, userAgent: '' },
];

/**
 * Find a device preset by its unique ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getPresetById(id) {
    return DEVICE_PRESETS.find(p => p.id === id) ?? null;
}

/**
 * Get all presets belonging to a category.
 * @param {string} category
 * @returns {object[]}
 */
export function getPresetsByCategory(category) {
    return DEVICE_PRESETS.filter(p => p.category === category);
}
