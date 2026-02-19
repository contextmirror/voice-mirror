/**
 * avatar-presets.js -- Built-in avatar SVG presets and helpers.
 *
 * Each preset has an id, name, and svg (inner SVG content -- paths/circles,
 * no outer <svg> tag). The component wraps it in an <svg viewBox="0 0 24 24">.
 *
 * Custom avatars use type: 'image' with a dataUrl instead of svg.
 */

// ============ AI Avatar Presets ============

export const AI_AVATARS = [
  {
    id: 'cube',
    name: 'Cube',
    type: 'svg',
    svg: `<path d="M12 2L2 7l10 5 10-5-10-5z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M2 17l10 5 10-5" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M2 12l10 5 10-5" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  },
  {
    id: 'bot',
    name: 'Robot',
    type: 'svg',
    svg: `<rect x="5" y="7" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
      <path d="M12 2v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="12" cy="2" r="1" fill="currentColor"/>
      <path d="M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  {
    id: 'brain',
    name: 'Brain',
    type: 'svg',
    svg: `<path d="M12 2C9 2 7 4 7 6.5c0 .5.1 1 .2 1.4C5.3 8.5 4 10 4 12c0 1.7 1 3.2 2.5 3.8-.1.4-.2.8-.2 1.2 0 2.5 2 4.5 4.5 4.5.5 0 .9-.1 1.2-.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M12 2c3 0 5 2 5 4.5 0 .5-.1 1-.2 1.4 1.9.6 3.2 2.1 3.2 3.6 0 1.7-1 3.2-2.5 3.8.1.4.2.8.2 1.2 0 2.5-2 4.5-4.5 4.5-.5 0-.9-.1-1.2-.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M12 2v19.5" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity="0.5"/>`,
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    type: 'svg',
    svg: `<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  {
    id: 'circuit',
    name: 'Circuit',
    type: 'svg',
    svg: `<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M12 2v7M12 15v7M2 12h7M15 12h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="12" cy="5" r="1" fill="currentColor"/>
      <circle cx="12" cy="19" r="1" fill="currentColor"/>
      <circle cx="5" cy="12" r="1" fill="currentColor"/>
      <circle cx="19" cy="12" r="1" fill="currentColor"/>`,
  },
  {
    id: 'wave',
    name: 'Wave',
    type: 'svg',
    svg: `<path d="M4 12h2v-4h2v8h2V8h2v8h2V6h2v12h2v-8h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

// ============ User Avatar Presets ============

export const USER_AVATARS = [
  {
    id: 'person',
    name: 'Person',
    type: 'svg',
    svg: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/>`,
  },
  {
    id: 'circle-user',
    name: 'Circle',
    type: 'svg',
    svg: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="12" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M6.7 18.3c.9-2 3-3.3 5.3-3.3s4.4 1.3 5.3 3.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  {
    id: 'smile',
    name: 'Smile',
    type: 'svg',
    svg: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="9" cy="9" r="1.2" fill="currentColor"/>
      <circle cx="15" cy="9" r="1.2" fill="currentColor"/>`,
  },
  {
    id: 'star',
    name: 'Star',
    type: 'svg',
    svg: `<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  {
    id: 'heart',
    name: 'Heart',
    type: 'svg',
    svg: `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  },
  {
    id: 'ghost',
    name: 'Ghost',
    type: 'svg',
    svg: `<path d="M12 2C7.58 2 4 5.58 4 10v9l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2v-9c0-4.42-3.58-8-8-8z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="9" cy="10" r="1.2" fill="currentColor"/>
      <circle cx="15" cy="10" r="1.2" fill="currentColor"/>`,
  },
];

// ============ Helpers ============

/**
 * Find an avatar by ID from built-in + custom lists.
 * @param {string} presetId - Avatar preset ID
 * @param {Array} customAvatars - User-uploaded custom avatars
 * @param {'ai'|'user'} role - Which role to default to
 * @returns {object} Avatar preset object
 */
export function resolveAvatar(presetId, customAvatars = [], role = 'ai') {
  const builtIn = role === 'ai' ? AI_AVATARS : USER_AVATARS;
  const defaultId = role === 'ai' ? 'cube' : 'person';

  if (!presetId) return builtIn.find(a => a.id === defaultId);

  // Check built-in first
  const found = builtIn.find(a => a.id === presetId);
  if (found) return found;

  // Check custom
  const custom = customAvatars?.find(a => a.id === presetId);
  if (custom) return custom;

  // Fallback to default
  return builtIn.find(a => a.id === defaultId);
}

/**
 * Validate a file for custom avatar upload.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAvatarFile(file) {
  const maxSize = 50 * 1024; // 50KB
  const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

  if (!file) return { valid: false, error: 'No file selected' };
  if (file.size > maxSize) return { valid: false, error: 'File too large (max 50KB)' };
  if (!validTypes.includes(file.type)) return { valid: false, error: 'Invalid file type (PNG, JPG, SVG, WebP only)' };

  return { valid: true };
}
