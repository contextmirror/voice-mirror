// IPC input validators for main.js handlers
// Pure JavaScript, no external dependencies

const VALID_PROVIDERS = [
  'claude', 'opencode', 'ollama', 'lmstudio', 'jan'
];

const VALID_ACTIVATION_MODES = ['wakeWord', 'pushToTalk'];
const VALID_VOICE_MODES = ['auto', 'local', 'claude'];

const BLOCKED_SCHEMES = ['file:', 'chrome:', 'javascript:', 'data:', 'vbscript:'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp) && typeof v !== 'function';
}

function isValidHttpUrl(str) {
  if (typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function fail(error) {
  return { valid: false, error };
}

function ok(value) {
  return { valid: true, value };
}

// Deep-clone plain data, stripping functions
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'function') return undefined;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'function') {
      out[k] = sanitizeObject(v);
    }
  }
  return out;
}

const validators = {

  'set-window-position': (x, y) => {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return fail('x and y must be finite numbers');
    }
    return ok({ x: clamp(Math.round(x), -10000, 50000), y: clamp(Math.round(y), -10000, 50000) });
  },

  'stop-drag-capture': (newX, newY) => {
    if (!isFiniteNumber(newX) || !isFiniteNumber(newY)) {
      return fail('newX and newY must be finite numbers');
    }
    return ok({ newX: clamp(Math.round(newX), -10000, 50000), newY: clamp(Math.round(newY), -10000, 50000) });
  },

  'set-config': (updates) => {
    if (!isPlainObject(updates)) {
      return fail('updates must be a plain object');
    }

    const errors = [];
    const s = sanitizeObject(updates);

    if (s.ai) {
      if (s.ai.provider !== undefined) {
        if (typeof s.ai.provider !== 'string' || !VALID_PROVIDERS.includes(s.ai.provider)) {
          errors.push(`ai.provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
        }
      }
      if (s.ai.model !== undefined && s.ai.model !== null) {
        if (typeof s.ai.model !== 'string' || s.ai.model.length > 200) {
          errors.push('ai.model must be a string (max 200 chars) or null');
        }
      }
      if (s.ai.endpoints && isPlainObject(s.ai.endpoints)) {
        for (const [k, v] of Object.entries(s.ai.endpoints)) {
          if (v !== null && v !== undefined && !isValidHttpUrl(v)) {
            errors.push(`ai.endpoints.${k} must be a valid http/https URL`);
          }
        }
      }
      if (s.ai.apiKeys && isPlainObject(s.ai.apiKeys)) {
        for (const [k, v] of Object.entries(s.ai.apiKeys)) {
          if (v !== null && v !== undefined) {
            if (typeof v !== 'string' || v.length > 500) {
              errors.push(`ai.apiKeys.${k} must be a string (max 500 chars) or null`);
            }
          }
        }
      }
      if (s.ai.contextLength !== undefined) {
        // 1MB max context length (1048576 = 1024 * 1024)
        if (!Number.isInteger(s.ai.contextLength) || s.ai.contextLength < 1024 || s.ai.contextLength > 1048576) {
          errors.push('ai.contextLength must be an integer 1024-1048576');
        }
      }
    }

    if (s.behavior) {
      if (s.behavior.hotkey !== undefined) {
        if (typeof s.behavior.hotkey !== 'string' || s.behavior.hotkey.length > 100) {
          errors.push('behavior.hotkey must be a string (max 100 chars)');
        }
      }
      if (s.behavior.activationMode !== undefined) {
        if (!VALID_ACTIVATION_MODES.includes(s.behavior.activationMode)) {
          errors.push(`behavior.activationMode must be one of: ${VALID_ACTIVATION_MODES.join(', ')}`);
        }
      }
      if (s.behavior.pttKey !== undefined) {
        if (typeof s.behavior.pttKey !== 'string' || s.behavior.pttKey.length > 50) {
          errors.push('behavior.pttKey must be a string (max 50 chars)');
        }
      }
      if (s.behavior.dictationKey !== undefined) {
        if (typeof s.behavior.dictationKey !== 'string' || s.behavior.dictationKey.length > 50) {
          errors.push('behavior.dictationKey must be a string (max 50 chars)');
        }
      }
    }

    if (s.appearance) {
      if (s.appearance.orbSize !== undefined) {
        if (!Number.isInteger(s.appearance.orbSize) || s.appearance.orbSize < 32 || s.appearance.orbSize > 256) {
          errors.push('appearance.orbSize must be an integer 32-256');
        }
      }
      if (s.appearance.panelWidth !== undefined) {
        if (!Number.isInteger(s.appearance.panelWidth) || s.appearance.panelWidth < 200 || s.appearance.panelWidth > 4000) {
          errors.push('appearance.panelWidth must be an integer 200-4000');
        }
      }
      if (s.appearance.panelHeight !== undefined) {
        if (!Number.isInteger(s.appearance.panelHeight) || s.appearance.panelHeight < 200 || s.appearance.panelHeight > 4000) {
          errors.push('appearance.panelHeight must be an integer 200-4000');
        }
      }
      if (s.appearance.theme !== undefined) {
        const VALID_THEMES = ['colorblind', 'midnight', 'emerald', 'rose', 'slate', 'black', 'gray', 'light', 'custom'];
        if (typeof s.appearance.theme !== 'string' || (!VALID_THEMES.includes(s.appearance.theme) && !s.appearance.theme.startsWith('custom-'))) {
          errors.push(`appearance.theme must be one of: ${VALID_THEMES.join(', ')} (or a custom-* key)`);
        }
      }
      if (s.appearance.colors !== undefined && s.appearance.colors !== null) {
        if (!isPlainObject(s.appearance.colors)) {
          errors.push('appearance.colors must be an object or null');
        } else {
          const COLOR_KEYS = ['bg', 'bgElevated', 'text', 'textStrong', 'muted', 'accent', 'ok', 'warn', 'danger', 'orbCore'];
          const hexRe = /^#[0-9a-fA-F]{6}$/;
          for (const [k, v] of Object.entries(s.appearance.colors)) {
            if (!COLOR_KEYS.includes(k)) {
              errors.push(`appearance.colors.${k} is not a valid color key`);
            } else if (typeof v !== 'string' || !hexRe.test(v)) {
              errors.push(`appearance.colors.${k} must be a hex color (#RRGGBB)`);
            }
          }
        }
      }
      if (s.appearance.fonts !== undefined && s.appearance.fonts !== null) {
        if (!isPlainObject(s.appearance.fonts)) {
          errors.push('appearance.fonts must be an object or null');
        } else {
          if (s.appearance.fonts.fontFamily !== undefined && typeof s.appearance.fonts.fontFamily !== 'string') {
            errors.push('appearance.fonts.fontFamily must be a string');
          }
          if (s.appearance.fonts.fontMono !== undefined && typeof s.appearance.fonts.fontMono !== 'string') {
            errors.push('appearance.fonts.fontMono must be a string');
          }
        }
      }
      if (s.appearance.messageCard !== undefined && s.appearance.messageCard !== null) {
        if (!isPlainObject(s.appearance.messageCard)) {
          errors.push('appearance.messageCard must be an object or null');
        } else {
          const mc = s.appearance.messageCard;
          if (mc.fontSize !== undefined) {
            if (!Number.isFinite(mc.fontSize) || mc.fontSize < 10 || mc.fontSize > 24) {
              errors.push('appearance.messageCard.fontSize must be a number 10-24');
            }
          }
          if (mc.lineHeight !== undefined) {
            if (!Number.isFinite(mc.lineHeight) || mc.lineHeight < 1.0 || mc.lineHeight > 2.5) {
              errors.push('appearance.messageCard.lineHeight must be a number 1.0-2.5');
            }
          }
          if (mc.padding !== undefined) {
            if (typeof mc.padding !== 'string' || mc.padding.length > 50) {
              errors.push('appearance.messageCard.padding must be a string (max 50 chars)');
            }
          }
          if (mc.avatarSize !== undefined) {
            if (!Number.isInteger(mc.avatarSize) || mc.avatarSize < 20 || mc.avatarSize > 64) {
              errors.push('appearance.messageCard.avatarSize must be an integer 20-64');
            }
          }
          if (mc.showAvatars !== undefined && typeof mc.showAvatars !== 'boolean') {
            errors.push('appearance.messageCard.showAvatars must be a boolean');
          }
          if (mc.bubbleStyle !== undefined) {
            if (!['rounded', 'square', 'pill'].includes(mc.bubbleStyle)) {
              errors.push('appearance.messageCard.bubbleStyle must be one of: rounded, square, pill');
            }
          }
          for (const cssKey of ['userColor', 'aiColor', 'userBg', 'userBorder', 'userRadius', 'aiBg', 'aiBorder', 'aiRadius']) {
            if (mc[cssKey] !== undefined && mc[cssKey] !== null) {
              if (typeof mc[cssKey] !== 'string' || mc[cssKey].length > 200) {
                errors.push(`appearance.messageCard.${cssKey} must be a string (max 200 chars) or null`);
              }
            }
          }
        }
      }
    }

    if (s.window) {
      if (s.window.orbX !== undefined && s.window.orbX !== null) {
        if (!isFiniteNumber(s.window.orbX)) {
          errors.push('window.orbX must be a number or null');
        }
      }
      if (s.window.orbY !== undefined && s.window.orbY !== null) {
        if (!isFiniteNumber(s.window.orbY)) {
          errors.push('window.orbY must be a number or null');
        }
      }
    }

    if (errors.length > 0) {
      return fail(errors.join('; '));
    }
    return ok(s);
  },

  'open-external': (url) => {
    if (typeof url !== 'string' || url.length > 2048) {
      return fail('url must be a string (max 2048 chars)');
    }
    const lower = url.toLowerCase().trim();
    for (const scheme of BLOCKED_SCHEMES) {
      if (lower.startsWith(scheme)) {
        return fail(`Blocked URL scheme: ${scheme}`);
      }
    }
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
      return fail('url must start with http:// or https://');
    }
    return ok(url.trim());
  },

  'send-query': (query) => {
    if (!isPlainObject(query)) {
      return fail('query must be an object');
    }
    if (typeof query.text !== 'string' || query.text.length > 50000) {
      return fail('query.text must be a string (max 50000 chars)');
    }
    if (query.image !== undefined && query.image !== null) {
      if (typeof query.image !== 'string') {
        return fail('query.image must be a string or null');
      }
      if (query.image.length > 20_000_000) {
        return fail('Image data too large (max 20MB)');
      }
    }
    return ok({ text: query.text, image: query.image || null });
  },

  'set-voice-mode': (mode) => {
    if (typeof mode !== 'string' || !VALID_VOICE_MODES.includes(mode)) {
      return fail(`mode must be one of: ${VALID_VOICE_MODES.join(', ')}`);
    }
    return ok(mode);
  },

  'claude-pty-input': (data) => {
    if (typeof data !== 'string' || data.length > 10000) {
      return fail('data must be a string (max 10000 chars)');
    }
    return ok(data);
  },

  'claude-pty-resize': (cols, rows) => {
    if (!Number.isInteger(cols) || cols < 1 || cols > 500) {
      return fail('cols must be an integer 1-500');
    }
    if (!Number.isInteger(rows) || rows < 1 || rows > 200) {
      return fail('rows must be an integer 1-200');
    }
    return ok({ cols, rows });
  },

  'ai-set-provider': (providerId, model) => {
    if (typeof providerId !== 'string' || !VALID_PROVIDERS.includes(providerId)) {
      return fail(`providerId must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }
    if (model !== undefined && model !== null) {
      if (typeof model !== 'string' || model.length > 200) {
        return fail('model must be a string (max 200 chars) or null');
      }
    }
    return ok({ providerId, model: model || null });
  },

  'send-image': (imageData) => {
    if (!isPlainObject(imageData)) {
      return fail('imageData must be an object');
    }
    if (typeof imageData.base64 !== 'string') {
      return fail('imageData.base64 must be a string');
    }
    if (imageData.base64.length > 20_000_000) {
      return fail('Image data too large (max 20MB)');
    }
    if (imageData.filename !== undefined && imageData.filename !== null) {
      if (typeof imageData.filename !== 'string' || imageData.filename.length > 255) {
        return fail('imageData.filename must be a string (max 255 chars)');
      }
    }
    if (imageData.prompt !== undefined && imageData.prompt !== null) {
      if (typeof imageData.prompt !== 'string' || imageData.prompt.length > 5000) {
        return fail('imageData.prompt must be a string (max 5000 chars)');
      }
    }
    return ok({
      base64: imageData.base64,
      filename: imageData.filename || null,
      prompt: imageData.prompt || null
    });
  }
};

module.exports = { validators, VALID_PROVIDERS };
