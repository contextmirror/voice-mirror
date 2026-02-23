<script>
  /**
   * VoiceSettings.svelte -- Voice & Audio configuration panel.
   *
   * Activation mode, TTS engine/voice, STT model, audio devices,
   * wake word, and announcement toggles.
   *
   * Delegates keybind recording to KeybindRecorder and TTS config to TTSConfig.
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { listAudioDevices, setVoiceMode, registerShortcut, unregisterShortcut, configurePttKey, configureDictationKey, ensureSttModel, restartVoice, getVoiceStatus } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';
  import { STT_REGISTRY } from '../../lib/voice-adapters.js';
  import KeybindRecorder from './KeybindRecorder.svelte';
  import TTSConfig from './TTSConfig.svelte';
  import Select from '../shared/Select.svelte';
  import Toggle from '../shared/Toggle.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Slider from '../shared/Slider.svelte';
  import Button from '../shared/Button.svelte';

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

  // ---- Derived values ----

  const currentSTTAdapter = $derived(STT_REGISTRY[sttAdapter] || STT_REGISTRY['whisper-local']);

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

  // ---- Save handler ----

  async function saveVoiceSettings() {
    saving = true;
    try {
      // Capture previous STT config BEFORE updateConfig mutates the store
      const prevModelSize = configStore.value?.voice?.sttModelSize || 'base';
      const prevAdapter = configStore.value?.voice?.sttAdapter || 'whisper-local';

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

      // Auto-download STT model if changed and using local Whisper
      const sttChanged = sttModelSize !== prevModelSize || sttAdapter !== prevAdapter;

      if (sttChanged && sttAdapter === 'whisper-local') {
        const downloadToastId = toastStore.addToast({
          message: `Downloading Whisper model (${sttModelSize})...`,
          severity: 'info',
          duration: 0,
          key: 'stt-model-download',
          progress: 0,
        });

        const unlisten = await listen('stt-download-progress', (event) => {
          const { percent, downloadedMb, totalMb } = event.payload;
          if (downloadToastId) {
            toastStore.updateToast(downloadToastId, {
              message: `Downloading model... ${percent}% (${Math.round(downloadedMb)} / ${Math.round(totalMb)} MB)`,
              progress: percent,
            });
          }
        });

        try {
          await ensureSttModel(sttModelSize);
          unlisten();
          toastStore.dismissToast(downloadToastId);
          toastStore.addToast({ message: 'Model ready', severity: 'success' });
        } catch (dlErr) {
          unlisten();
          toastStore.dismissToast(downloadToastId);
          toastStore.addToast({ message: `Model download failed: ${dlErr}`, severity: 'error' });
        }

        // Restart voice pipeline if it was running (applies to both AI voice + dictation)
        const status = await getVoiceStatus().catch(() => null);
        if (status?.data?.running) {
          await restartVoice().catch((err) => {
            console.warn('[VoiceSettings] Voice restart failed:', err);
          });
          toastStore.addToast({ message: 'Voice engine restarted with new model', severity: 'info' });
        }
      }
    } catch (err) {
      console.error('[VoiceSettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save voice settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="voice-settings">
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

  <!-- Keybinds (delegated to KeybindRecorder) -->
  <section class="settings-section">
    <h3>Keybinds</h3>
    <div class="settings-group">
      <KeybindRecorder
        bind:hotkeyToggle
        bind:pttKey
        bind:dictationKey
        bind:statsHotkey
      />
    </div>
  </section>

  <!-- Text-to-Speech (delegated to TTSConfig) -->
  <TTSConfig
    bind:ttsAdapter
    bind:ttsVoice
    bind:ttsModelSize
    bind:ttsSpeed
    bind:ttsVolume
    bind:ttsApiKey
    bind:ttsEndpoint
    bind:ttsModelPath
  />

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
