<script>
  /**
   * VoiceSettings.svelte -- Voice & Audio configuration panel.
   *
   * Activation mode, TTS engine/voice, STT model, audio devices,
   * wake word, and announcement toggles.
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { listAudioDevices, setVoiceMode, registerShortcut, unregisterShortcut, configurePttKey, configureDictationKey } from '../../lib/api.js';
  import Select from '../shared/Select.svelte';
  import Toggle from '../shared/Toggle.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Slider from '../shared/Slider.svelte';
  import Button from '../shared/Button.svelte';

  // ---- TTS Adapter Registry ----

  const ADAPTER_REGISTRY = {
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

  const STT_REGISTRY = {
    'whisper-local': {
      label: 'Whisper (Local, default)',
      showModelSize: true,
      modelSizes: [
        { value: 'tiny', label: 'tiny.en (~77MB, fastest)' },
        { value: 'base', label: 'base.en (~148MB, recommended)' },
        { value: 'small', label: 'small.en (~488MB, most accurate)' },
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

  // Virtual key code → display name (matches Windows VK_ codes)
  const VKEY_NAMES = {
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

  const MOUSE_BUTTON_NAMES = { 3: 'Mouse Middle', 4: 'Mouse Back', 5: 'Mouse Forward' };

  // Legacy names (for old configs that haven't been re-saved yet)
  const LEGACY_MOUSE_NAMES = {
    MouseButton3: 'Mouse Middle',
    MouseButton4: 'Mouse Back',
    MouseButton5: 'Mouse Forward',
  };

  function formatKeybind(keybind) {
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

  // ---- Local state ----

  let activationMode = $state('pushToTalk');
  let wakeWordPhrase = $state('hey_claude');
  let wakeWordSensitivity = $state(0.5);
  let hotkeyToggle = $state('CommandOrControl+Shift+V');
  let pttKey = $state('MouseButton4');
  let dictationKey = $state('MouseButton5');
  let statsHotkey = $state('CommandOrControl+Shift+M');
  let ttsAdapter = $state('kokoro');
  let ttsVoice = $state('af_bella');
  let ttsModelSize = $state('0.6B');
  let ttsSpeed = $state(1.0);
  let ttsVolume = $state(1.0);
  let ttsApiKey = $state('');
  let ttsEndpoint = $state('');
  let ttsModelPath = $state('');
  let sttAdapter = $state('whisper-local');
  let sttModelSize = $state('base');
  let sttModelName = $state('');
  let sttApiKey = $state('');
  let sttEndpoint = $state('');
  let inputDevice = $state('');
  let outputDevice = $state('');
  let announceStartup = $state(true);
  let announceProvider = $state(true);

  let audioInputDevices = $state([]);
  let audioOutputDevices = $state([]);
  let saving = $state(false);
  let devicesLoaded = $state(false);

  // ---- Keybind recording state ----

  let recordingKeybind = $state(null); // which keybind is being recorded: 'toggle' | 'ptt' | 'dictation' | 'stats'

  // ---- Load audio devices on mount ----

  $effect(() => {
    if (devicesLoaded) return;
    devicesLoaded = true;
    listAudioDevices().then(result => {
      const data = result?.data || result;
      if (data) {
        audioInputDevices = data.input || data.inputs || [];
        audioOutputDevices = data.output || data.outputs || [];
      }
    }).catch(err => {
      console.error('[VoiceSettings] Failed to list audio devices:', err);
    });
  });

  // ---- Keybind recording handlers ----

  function startRecording(name) {
    recordingKeybind = name;
  }

  function cancelRecording() {
    recordingKeybind = null;
  }

  function setKeybindValue(name, rawKey) {
    if (name === 'toggle') hotkeyToggle = rawKey;
    else if (name === 'ptt') pttKey = rawKey;
    else if (name === 'dictation') dictationKey = rawKey;
    else if (name === 'stats') statsHotkey = rawKey;
  }

  function handleKeybindKeydown(e) {
    if (recordingKeybind === null) return;

    e.preventDefault();
    e.stopPropagation();

    // Escape cancels recording
    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }

    // PTT and dictation use the native input hook — store as "kb:VKEY"
    // (single key, no modifier combos — the hook suppresses the key at OS level)
    if (recordingKeybind === 'ptt' || recordingKeybind === 'dictation') {
      // Ignore modifier-only presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      setKeybindValue(recordingKeybind, `kb:${e.keyCode}`);
      recordingKeybind = null;
      return;
    }

    // Other keybinds (toggle overlay, stats) use Tauri global shortcuts — combo format
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key);
    }

    if (parts.length > 0 && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      const rawKey = parts.join('+');
      setKeybindValue(recordingKeybind, rawKey);
      recordingKeybind = null;
    }
  }

  function handleKeybindMousedown(e) {
    if (recordingKeybind === null) return;

    // Skip left (0) and right (2) -- those are for UI interaction
    if (e.button === 0 || e.button === 2) return;

    e.preventDefault();
    e.stopPropagation();

    // Browser button IDs → our mouse button IDs
    // Browser: 1=middle, 3=back, 4=forward
    // Ours: 3=middle, 4=back (XBUTTON1), 5=forward (XBUTTON2)
    const buttonMap = { 1: 3, 3: 4, 4: 5 };
    const buttonId = buttonMap[e.button] || (e.button + 1);

    // PTT and dictation use the native input hook — store as "mouse:ID"
    if (recordingKeybind === 'ptt' || recordingKeybind === 'dictation') {
      setKeybindValue(recordingKeybind, `mouse:${buttonId}`);
      recordingKeybind = null;
      return;
    }

    // Other keybinds: legacy format for display
    const legacyNames = { 1: 'MouseButton3', 3: 'MouseButton4', 4: 'MouseButton5' };
    const rawKey = legacyNames[e.button] || `MouseButton${e.button + 1}`;
    setKeybindValue(recordingKeybind, rawKey);
    recordingKeybind = null;
  }

  function handleClickOutside(e) {
    if (recordingKeybind !== null && !e.target.closest('.keybind-input')) {
      cancelRecording();
    }
  }

  // ---- Derived values ----

  const currentTTSAdapter = $derived(ADAPTER_REGISTRY[ttsAdapter] || ADAPTER_REGISTRY.kokoro);
  const currentSTTAdapter = $derived(STT_REGISTRY[sttAdapter] || STT_REGISTRY['whisper-local']);

  const ttsAdapterOptions = $derived(
    Object.entries(ADAPTER_REGISTRY).map(([key, reg]) => ({
      value: key,
      label: reg.label,
      group: reg.category === 'local' ? 'Local' : reg.category === 'cloud-free' ? 'Cloud (free)' : 'Cloud (paid)',
    }))
  );

  const ttsVoiceOptions = $derived(
    currentTTSAdapter.voices.map(v => ({ value: v.value, label: v.label }))
  );

  const ttsModelSizeOptions = $derived(
    currentTTSAdapter.showModelSize && currentTTSAdapter.modelSizes
      ? currentTTSAdapter.modelSizes.map(s => ({ value: s.value, label: s.label }))
      : []
  );

  const sttAdapterOptions = $derived(
    Object.entries(STT_REGISTRY).map(([key, reg]) => ({
      value: key,
      label: reg.label,
    }))
  );

  const sttModelSizeOptions = $derived(
    currentSTTAdapter.showModelSize && currentSTTAdapter.modelSizes
      ? currentSTTAdapter.modelSizes.map(s => ({ value: s.value, label: s.label }))
      : []
  );

  const wakeWordOptions = [
    { value: 'hey_claude', label: 'Hey Claude' },
    { value: 'hey_jarvis', label: 'Hey Jarvis' },
    { value: 'alexa', label: 'Alexa' },
  ];

  const inputDeviceOptions = $derived([
    { value: '', label: 'System Default' },
    ...audioInputDevices.map(d => ({ value: d.name || d, label: d.name || d })),
  ]);

  const outputDeviceOptions = $derived([
    { value: '', label: 'System Default' },
    ...audioOutputDevices.map(d => ({ value: d.name || d, label: d.name || d })),
  ]);

  // ---- Sync from config store ----

  $effect(() => {
    const cfg = configStore.value;
    if (!cfg) return;

    // Map deprecated values: continuous/hybrid → wakeWord
    const savedMode = cfg.behavior?.activationMode || 'pushToTalk';
    activationMode = (savedMode === 'continuous' || savedMode === 'hybrid') ? 'wakeWord' : savedMode;
    hotkeyToggle = cfg.behavior?.hotkey || 'CommandOrControl+Shift+V';
    pttKey = cfg.behavior?.pttKey || 'MouseButton4';
    dictationKey = cfg.behavior?.dictationKey || 'MouseButton5';
    statsHotkey = cfg.behavior?.statsHotkey || 'CommandOrControl+Shift+M';
    wakeWordPhrase = cfg.wakeWord?.phrase || 'hey_claude';
    wakeWordSensitivity = cfg.wakeWord?.sensitivity ?? 0.5;
    ttsAdapter = cfg.voice?.ttsAdapter || 'kokoro';
    ttsVoice = cfg.voice?.ttsVoice || 'af_bella';
    ttsModelSize = cfg.voice?.ttsModelSize || '0.6B';
    ttsSpeed = cfg.voice?.ttsSpeed ?? 1.0;
    ttsVolume = cfg.voice?.ttsVolume ?? 1.0;
    ttsApiKey = '';  // API keys are redacted, don't prefill
    ttsEndpoint = cfg.voice?.ttsEndpoint || '';
    ttsModelPath = cfg.voice?.ttsModelPath || '';
    sttAdapter = cfg.voice?.sttAdapter || 'whisper-local';
    sttModelSize = cfg.voice?.sttModelSize || 'base';
    sttModelName = cfg.voice?.sttModelName || '';
    sttApiKey = '';
    sttEndpoint = cfg.voice?.sttEndpoint || '';
    inputDevice = cfg.voice?.inputDevice || '';
    outputDevice = cfg.voice?.outputDevice || '';
    announceStartup = cfg.voice?.announceStartup !== false;
    announceProvider = cfg.voice?.announceProviderSwitch !== false;
  });

  // ---- When TTS adapter changes, reset voice to first available ----

  function handleTTSAdapterChange(newAdapter) {
    ttsAdapter = newAdapter;
    const reg = ADAPTER_REGISTRY[newAdapter] || ADAPTER_REGISTRY.kokoro;
    const voiceExists = reg.voices.some(v => v.value === ttsVoice);
    if (!voiceExists) {
      ttsVoice = reg.voices[0]?.value || '';
    }
  }

  // ---- Save handler ----

  async function saveVoiceSettings() {
    saving = true;
    try {
      const patch = {
        behavior: {
          activationMode,
          hotkey: hotkeyToggle.replace('Ctrl', 'CommandOrControl'),
          pttKey,
          dictationKey,
          statsHotkey: statsHotkey.replace('Ctrl', 'CommandOrControl'),
        },
        wakeWord: {
          phrase: wakeWordPhrase,
          sensitivity: wakeWordSensitivity,
          enabled: activationMode === 'wakeWord',
        },
        voice: {
          ttsAdapter,
          ttsVoice,
          ttsModelSize,
          ttsSpeed,
          ttsVolume,
          ttsApiKey: ttsApiKey || null,
          ttsEndpoint: ttsEndpoint || null,
          ttsModelPath: ttsModelPath || null,
          sttModel: sttAdapter,
          sttAdapter,
          sttModelSize,
          sttModelName: sttModelName || null,
          sttApiKey: sttApiKey || null,
          sttEndpoint: sttEndpoint || null,
          inputDevice: inputDevice || null,
          outputDevice: outputDevice || null,
          announceStartup,
          announceProviderSwitch: announceProvider,
        },
      };
      await updateConfig(patch);

      // Apply mode change to the running voice pipeline
      await setVoiceMode(activationMode).catch(() => {});

      // Configure native input hook bindings (PTT + dictation keys)
      if (pttKey) {
        await configurePttKey(pttKey).catch((err) => {
          console.warn('[VoiceSettings] Failed to configure PTT key:', err);
        });
      }
      if (dictationKey) {
        await configureDictationKey(dictationKey).catch((err) => {
          console.warn('[VoiceSettings] Failed to configure dictation key:', err);
        });
      }

      // Re-register keyboard-based shortcuts so changes take effect immediately
      const keybinds = [
        { id: 'toggle-overlay', keys: hotkeyToggle.replace('Ctrl', 'CommandOrControl') },
        { id: 'stats-dashboard', keys: statsHotkey.replace('Ctrl', 'CommandOrControl') },
      ];
      for (const kb of keybinds) {
        if (kb.keys && kb.keys.includes('+')) {
          try {
            await unregisterShortcut(kb.id).catch(() => {});
            await registerShortcut(kb.id, kb.keys);
          } catch { /* best-effort */ }
        }
      }

      toastStore.addToast({ message: 'Voice settings saved', severity: 'success' });
    } catch (err) {
      console.error('[VoiceSettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save voice settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div
  class="voice-settings"
  role="application"
  onkeydown={handleKeybindKeydown}
  onmousedown={handleKeybindMousedown}
  onclick={handleClickOutside}
>
  <!-- Activation Mode (radio buttons) -->
  <section class="settings-section">
    <h3>Activation Mode</h3>
    <div class="settings-group">
      <label class="radio-option">
        <input
          type="radio"
          name="activationMode"
          value="pushToTalk"
          checked={activationMode === 'pushToTalk'}
          onchange={() => (activationMode = 'pushToTalk')}
        />
        <span class="radio-label">Push to Talk</span>
        <span class="radio-desc">Hold a key to record, release to stop</span>
      </label>
      <label class="radio-option">
        <input
          type="radio"
          name="activationMode"
          value="toggle"
          checked={activationMode === 'toggle'}
          onchange={() => (activationMode = 'toggle')}
        />
        <span class="radio-label">Toggle to Talk</span>
        <span class="radio-desc">Press to start recording, press again to stop</span>
      </label>
      <label class="radio-option">
        <input
          type="radio"
          name="activationMode"
          value="wakeWord"
          checked={activationMode === 'wakeWord'}
          onchange={() => (activationMode = 'wakeWord')}
        />
        <span class="radio-label">Wake Word</span>
        <span class="radio-desc">Always listening, auto-detects when you speak</span>
      </label>
    </div>
  </section>

  <!-- Keybinds -->
  <section class="settings-section">
    <h3>Keybinds</h3>
    <div class="settings-group">
      <div class="keybind-row">
        <span class="keybind-label">Toggle Overlay</span>
        <button
          class="keybind-input"
          class:recording={recordingKeybind === 'toggle'}
          onclick={(e) => { e.stopPropagation(); startRecording('toggle'); }}
        >
          {recordingKeybind === 'toggle' ? 'Press key...' : formatKeybind(hotkeyToggle)}
        </button>
      </div>
      <div class="keybind-row">
        <span class="keybind-label">Push-to-Talk</span>
        <button
          class="keybind-input"
          class:recording={recordingKeybind === 'ptt'}
          onclick={(e) => { e.stopPropagation(); startRecording('ptt'); }}
        >
          {recordingKeybind === 'ptt' ? 'Press key...' : formatKeybind(pttKey)}
        </button>
      </div>
      <div class="keybind-row">
        <span class="keybind-label">Dictation</span>
        <button
          class="keybind-input"
          class:recording={recordingKeybind === 'dictation'}
          onclick={(e) => { e.stopPropagation(); startRecording('dictation'); }}
        >
          {recordingKeybind === 'dictation' ? 'Press key...' : formatKeybind(dictationKey)}
        </button>
      </div>
      <div class="keybind-row">
        <span class="keybind-label">Stats Dashboard</span>
        <button
          class="keybind-input"
          class:recording={recordingKeybind === 'stats'}
          onclick={(e) => { e.stopPropagation(); startRecording('stats'); }}
        >
          {recordingKeybind === 'stats' ? 'Press key...' : formatKeybind(statsHotkey)}
        </button>
      </div>
    </div>
  </section>

  <!-- Text-to-Speech -->
  <section class="settings-section">
    <h3>Text-to-Speech</h3>
    <div class="settings-group">
      <Select
        label="TTS Engine"
        value={ttsAdapter}
        options={ttsAdapterOptions}
        onChange={handleTTSAdapterChange}
      />
      <Select
        label="Voice"
        value={ttsVoice}
        options={ttsVoiceOptions}
        onChange={(v) => (ttsVoice = v)}
      />

      {#if currentTTSAdapter.showModelSize && ttsModelSizeOptions.length > 0}
        <Select
          label="Model Size"
          value={ttsModelSize}
          options={ttsModelSizeOptions}
          onChange={(v) => (ttsModelSize = v)}
        />
      {/if}

      <Slider
        label="Speed"
        value={ttsSpeed}
        min={0.5}
        max={2.0}
        step={0.1}
        onChange={(v) => (ttsSpeed = v)}
        formatValue={(v) => v.toFixed(1) + 'x'}
      />
      <Slider
        label="Volume"
        value={ttsVolume}
        min={0.1}
        max={2.0}
        step={0.1}
        onChange={(v) => (ttsVolume = v)}
        formatValue={(v) => Math.round(v * 100) + '%'}
      />

      {#if currentTTSAdapter.showApiKey}
        <TextInput
          label="API Key"
          value={ttsApiKey}
          type="password"
          placeholder="API key..."
          onChange={(v) => (ttsApiKey = v)}
        />
      {/if}

      {#if currentTTSAdapter.showEndpoint}
        <TextInput
          label="Endpoint"
          value={ttsEndpoint}
          placeholder="https://your-server.com/v1"
          onChange={(v) => (ttsEndpoint = v)}
        />
      {/if}

      {#if currentTTSAdapter.showModelPath}
        <TextInput
          label="Model Path"
          value={ttsModelPath}
          placeholder="Optional: path to custom .onnx voice file"
          onChange={(v) => (ttsModelPath = v)}
        />
      {/if}
    </div>
  </section>

  <!-- Speech Recognition -->
  <section class="settings-section">
    <h3>Speech Recognition</h3>
    <div class="settings-group">
      <Select
        label="STT Model"
        value={sttAdapter}
        options={sttAdapterOptions}
        onChange={(v) => (sttAdapter = v)}
      />

      {#if currentSTTAdapter.showModelSize && sttModelSizeOptions.length > 0}
        <Select
          label="Model Size"
          value={sttModelSize}
          options={sttModelSizeOptions}
          onChange={(v) => (sttModelSize = v)}
        />
      {/if}

      {#if currentSTTAdapter.showModelName}
        <TextInput
          label="Model Name"
          value={sttModelName}
          placeholder="e.g. large-v3"
          onChange={(v) => (sttModelName = v)}
        />
      {/if}

      {#if currentSTTAdapter.showApiKey}
        <TextInput
          label="API Key"
          value={sttApiKey}
          type="password"
          placeholder="sk-..."
          onChange={(v) => (sttApiKey = v)}
        />
      {/if}

      {#if currentSTTAdapter.showEndpoint}
        <TextInput
          label="Endpoint"
          value={sttEndpoint}
          placeholder="https://your-server.com/v1"
          onChange={(v) => (sttEndpoint = v)}
        />
      {/if}
    </div>
  </section>

  <!-- Audio Devices -->
  <section class="settings-section">
    <h3>Audio Devices</h3>
    <div class="settings-group">
      <Select
        label="Input Device"
        value={inputDevice}
        options={inputDeviceOptions}
        onChange={(v) => (inputDevice = v)}
      />
      <Select
        label="Output Device"
        value={outputDevice}
        options={outputDeviceOptions}
        onChange={(v) => (outputDevice = v)}
      />
    </div>
  </section>

  <!-- Announcements -->
  <section class="settings-section">
    <h3>Announcements</h3>
    <div class="settings-group">
      <Toggle
        label="Startup Greeting"
        description="Speak 'Voice Mirror online' on startup"
        checked={announceStartup}
        onChange={(v) => (announceStartup = v)}
      />
      <Toggle
        label="Provider Announcements"
        description="Announce when switching AI providers"
        checked={announceProvider}
        onChange={(v) => (announceProvider = v)}
      />
    </div>
  </section>

  <!-- Save Button -->
  <div class="settings-actions">
    <Button variant="primary" onClick={saveVoiceSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save Voice Settings'}
    </Button>
  </div>
</div>

<style>
  .voice-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 12px 0;
  }

  .settings-group {
    background: var(--card-highlight);
    border-radius: var(--radius-md);
    padding: 4px;
  }

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
</style>
