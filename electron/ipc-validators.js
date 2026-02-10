// IPC input validators for main.js handlers
// Pure JavaScript, no external dependencies

const VALID_PROVIDERS = [
  'claude', 'codex', 'gemini-cli', 'ollama', 'lmstudio', 'jan',
  'openai', 'gemini', 'groq', 'grok', 'mistral', 'openrouter', 'deepseek'
];

const VALID_ACTIVATION_MODES = ['wakeWord', 'callMode', 'pushToTalk'];
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
    if (query.image !== undefined && query.image !== null && typeof query.image !== 'string') {
      return fail('query.image must be a string or null');
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

  'set-call-mode': (active) => {
    if (typeof active !== 'boolean') {
      return fail('active must be a boolean');
    }
    return ok(active);
  },

  'send-image': (imageData) => {
    if (!isPlainObject(imageData)) {
      return fail('imageData must be an object');
    }
    if (typeof imageData.base64 !== 'string') {
      return fail('imageData.base64 must be a string');
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

module.exports = { validators, VALID_PROVIDERS, VALID_ACTIVATION_MODES, VALID_VOICE_MODES };
