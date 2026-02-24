/**
 * voice-adapters.js -- TTS/STT adapter registries and keybind helpers.
 *
 * Single source of truth for voice engine metadata used by
 * VoiceSettings and its sub-components (TTSConfig, KeybindRecorder).
 */

// ---- TTS Adapter Registry ----

export const ADAPTER_REGISTRY = {
  kokoro: {
    label: 'Kokoro (Local, fast, ~100MB)',
    category: 'local',
    voices: [
      { value: 'af_bella', label: 'Bella (Female)' },
      { value: 'af_nicole', label: 'Nicole (Female)' },
      { value: 'af_sarah', label: 'Sarah (Female)' },
      { value: 'af_sky', label: 'Sky (Female)' },
      { value: 'am_adam', label: 'Adam (Male)' },
      { value: 'am_michael', label: 'Michael (Male)' },
      { value: 'bf_emma', label: 'Emma (British Female)' },
      { value: 'bf_isabella', label: 'Isabella (British Female)' },
      { value: 'bm_george', label: 'George (British Male)' },
      { value: 'bm_lewis', label: 'Lewis (British Male)' },
    ],
    showModelSize: false,
    showApiKey: false,
    showEndpoint: false,
    showModelPath: false,
  },
  qwen: {
    label: 'Qwen3-TTS (Local, voice cloning, ~3-7GB)',
    category: 'local',
    voices: [
      { value: 'Ryan', label: 'Ryan (Male)' },
      { value: 'Vivian', label: 'Vivian (Female)' },
      { value: 'Serena', label: 'Serena (Female)' },
      { value: 'Dylan', label: 'Dylan (Male)' },
      { value: 'Eric', label: 'Eric (Male)' },
      { value: 'Aiden', label: 'Aiden (Male)' },
      { value: 'Uncle_Fu', label: 'Uncle Fu (Male)' },
      { value: 'Ono_Anna', label: 'Ono Anna (Female, Japanese)' },
      { value: 'Sohee', label: 'Sohee (Female, Korean)' },
    ],
    showModelSize: true,
    modelSizes: [
      { value: '0.6B', label: '0.6B (~1.5GB disk, ~2GB VRAM)' },
      { value: '1.7B', label: '1.7B (~3.5GB disk, ~4GB VRAM)' },
    ],
    showApiKey: false,
    showEndpoint: false,
    showModelPath: false,
  },
  piper: {
    label: 'Piper (Local, lightweight, ~50MB)',
    category: 'local',
    voices: [
      { value: 'en_US-amy-medium', label: 'Amy (US Female)' },
      { value: 'en_US-lessac-medium', label: 'Lessac (US Male)' },
      { value: 'en_US-libritts_r-medium', label: 'LibriTTS (US)' },
      { value: 'en_GB-cori-medium', label: 'Cori (British Female)' },
      { value: 'en_GB-alan-medium', label: 'Alan (British Male)' },
    ],
    showModelSize: false,
    showApiKey: false,
    showEndpoint: false,
    showModelPath: true,
  },
  edge: {
    label: 'Edge TTS (Free cloud, Microsoft)',
    category: 'cloud-free',
    voices: [
      { value: 'en-US-AriaNeural', label: 'Aria (US Female)' },
      { value: 'en-US-GuyNeural', label: 'Guy (US Male)' },
      { value: 'en-US-JennyNeural', label: 'Jenny (US Female)' },
      { value: 'en-GB-SoniaNeural', label: 'Sonia (British Female)' },
      { value: 'en-GB-RyanNeural', label: 'Ryan (British Male)' },
      { value: 'en-AU-NatashaNeural', label: 'Natasha (Australian Female)' },
    ],
    showModelSize: false,
    showApiKey: false,
    showEndpoint: false,
    showModelPath: false,
  },
  'openai-tts': {
    label: 'OpenAI TTS (Cloud, API key required)',
    category: 'cloud-paid',
    voices: [
      { value: 'alloy', label: 'Alloy' },
      { value: 'echo', label: 'Echo' },
      { value: 'fable', label: 'Fable' },
      { value: 'onyx', label: 'Onyx' },
      { value: 'nova', label: 'Nova' },
      { value: 'shimmer', label: 'Shimmer' },
    ],
    showModelSize: false,
    showApiKey: true,
    showEndpoint: false,
    showModelPath: false,
  },
  elevenlabs: {
    label: 'ElevenLabs (Cloud, premium)',
    category: 'cloud-paid',
    voices: [
      { value: 'Rachel', label: 'Rachel' },
      { value: 'Domi', label: 'Domi' },
      { value: 'Bella', label: 'Bella' },
      { value: 'Antoni', label: 'Antoni' },
      { value: 'Josh', label: 'Josh' },
      { value: 'Adam', label: 'Adam' },
    ],
    showModelSize: false,
    showApiKey: true,
    showEndpoint: false,
    showModelPath: false,
  },
  'custom-api': {
    label: 'Custom API (OpenAI-compatible)',
    category: 'cloud-custom',
    voices: [
      { value: 'default', label: 'Default' },
    ],
    showModelSize: false,
    showApiKey: true,
    showEndpoint: true,
    showModelPath: false,
  },
};

// ---- STT Adapter Registry ----

export const STT_REGISTRY = {
  'whisper-local': {
    label: 'Whisper (Local, default)',
    showModelSize: true,
    showGpu: true,
    modelSizes: [
      { value: 'tiny', label: 'Fast (~77MB)' },
      { value: 'base', label: 'Balanced (~148MB, recommended)' },
      { value: 'small', label: 'Accurate (~488MB)' },
      { value: 'large-v3-turbo', label: 'Turbo (~574MB, best value)' },
      { value: 'large-v3', label: 'Large v3 (~3.1GB, max accuracy)' },
    ],
    showModelName: false,
    showApiKey: false,
    showEndpoint: false,
  },
  'openai-whisper-api': {
    label: 'OpenAI Whisper API',
    showModelSize: false,
    showModelName: false,
    showApiKey: true,
    showEndpoint: false,
  },
  'custom-api-stt': {
    label: 'Custom API (OpenAI-compatible)',
    showModelSize: false,
    showModelName: true,
    showApiKey: true,
    showEndpoint: true,
  },
};

// ---- Keybind display helpers ----

// Virtual key code -> display name (matches Windows VK_ codes)
export const VKEY_NAMES = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 19: 'Pause', 20: 'CapsLock',
  27: 'Escape', 32: 'Space', 33: 'PageUp', 34: 'PageDown', 35: 'End',
  36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
  44: 'PrintScreen', 45: 'Insert', 46: 'Delete',
  48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
  65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I',
  74: 'J', 75: 'K', 76: 'L', 77: 'M', 78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R',
  83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z',
  96: 'Numpad 0', 97: 'Numpad 1', 98: 'Numpad 2', 99: 'Numpad 3',
  100: 'Numpad 4', 101: 'Numpad 5', 102: 'Numpad 6', 103: 'Numpad 7',
  104: 'Numpad 8', 105: 'Numpad 9',
  106: 'Numpad *', 107: 'Numpad +', 109: 'Numpad -', 110: 'Numpad .', 111: 'Numpad /',
  112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
  118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
  186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`',
  219: '[', 220: '\\', 221: ']', 222: "'",
};

export const MOUSE_BUTTON_NAMES = { 3: 'Mouse Middle', 4: 'Mouse Back', 5: 'Mouse Forward' };

// Legacy names (for old configs that haven't been re-saved yet)
export const LEGACY_MOUSE_NAMES = {
  MouseButton3: 'Mouse Middle',
  MouseButton4: 'Mouse Back',
  MouseButton5: 'Mouse Forward',
};

/** Format a keybind value to a human-readable display name. */
export function formatKeybind(keybind) {
  // New format: "kb:VKEY" (native input hook)
  const kbMatch = keybind.match(/^kb:(\d+)$/);
  if (kbMatch) {
    const vkey = parseInt(kbMatch[1], 10);
    return VKEY_NAMES[vkey] || `Key ${vkey}`;
  }
  // New format: "mouse:ID" (native input hook)
  const mouseMatch = keybind.match(/^mouse:(\d+)$/);
  if (mouseMatch) {
    const id = parseInt(mouseMatch[1], 10);
    return MOUSE_BUTTON_NAMES[id] || `Mouse Button ${id}`;
  }
  // Legacy format: "MouseButtonN"
  if (LEGACY_MOUSE_NAMES[keybind]) return LEGACY_MOUSE_NAMES[keybind];
  const m = keybind.match(/^MouseButton(\d+)$/);
  if (m) return `Mouse Button ${m[1]}`;
  // Keyboard combo format (Ctrl+Shift+V) for global shortcuts
  return keybind
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace(/\+/g, ' + ');
}

/** Get the voice options for a TTS adapter. */
export function getVoicesForAdapter(adapterId) {
  const adapter = ADAPTER_REGISTRY[adapterId];
  return adapter ? adapter.voices : [];
}

/** Get the model size options for an STT adapter. */
export function getModelsForAdapter(adapterId) {
  const adapter = STT_REGISTRY[adapterId];
  return adapter?.modelSizes || [];
}
