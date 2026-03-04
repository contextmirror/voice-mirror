/**
 * context-menu-presets.js -- Built-in context menu visual presets and helpers.
 *
 * Each preset defines shape/spacing for context menus.
 * Colors always come from the active theme (CSS vars).
 */

export const DEFAULT_CONTEXT_MENU_PRESET = 'default';

/**
 * @typedef {Object} ContextMenuPreset
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} menuRadius - border-radius of the menu container (px)
 * @property {number} itemRadius - border-radius of individual items (px)
 * @property {string} itemPadding - padding on each item (CSS shorthand)
 * @property {number} fontSize - item font size (px)
 * @property {string} shadow - box-shadow value (CSS)
 * @property {string} dividerMargin - margin on dividers (CSS shorthand)
 * @property {string} menuPadding - padding on the menu container (CSS shorthand)
 */

/** @type {Record<string, ContextMenuPreset>} */
export const CONTEXT_MENU_PRESETS = {
  default: {
    id: 'default',
    name: 'Default',
    description: 'Standard context menu style',
    menuRadius: 6,
    itemRadius: 0,
    itemPadding: '6px 12px',
    fontSize: 12,
    shadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    dividerMargin: '4px 8px',
    menuPadding: '4px 0',
  },
  rounded: {
    id: 'rounded',
    name: 'Rounded',
    description: 'Pill-shaped items with soft edges',
    menuRadius: 12,
    itemRadius: 8,
    itemPadding: '8px 14px',
    fontSize: 12,
    shadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
    dividerMargin: '4px 12px',
    menuPadding: '4px',
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter spacing and smaller text',
    menuRadius: 4,
    itemRadius: 0,
    itemPadding: '4px 8px',
    fontSize: 11,
    shadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    dividerMargin: '2px 6px',
    menuPadding: '2px 0',
  },
  flat: {
    id: 'flat',
    name: 'Flat',
    description: 'No shadow, minimal border',
    menuRadius: 2,
    itemRadius: 0,
    itemPadding: '6px 12px',
    fontSize: 12,
    shadow: 'none',
    dividerMargin: '4px 8px',
    menuPadding: '4px 0',
  },
};

/**
 * Apply a context menu preset (with optional overrides) to :root CSS vars.
 * @param {ContextMenuPreset} preset
 * @param {Partial<ContextMenuPreset>|null} [overrides]
 */
export function applyContextMenuPreset(preset, overrides) {
  const p = overrides ? { ...preset, ...overrides } : preset;
  const root = document.documentElement;
  root.style.setProperty('--ctx-menu-radius', p.menuRadius + 'px');
  root.style.setProperty('--ctx-menu-shadow', p.shadow);
  root.style.setProperty('--ctx-menu-padding', p.menuPadding);
  root.style.setProperty('--ctx-item-radius', p.itemRadius + 'px');
  root.style.setProperty('--ctx-item-padding', p.itemPadding);
  root.style.setProperty('--ctx-item-font-size', p.fontSize + 'px');
  root.style.setProperty('--ctx-divider-margin', p.dividerMargin);
}
