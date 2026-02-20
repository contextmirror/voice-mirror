<script>
  import { configStore, loadConfig } from './lib/stores/config.svelte.js';
  import { currentThemeName, applyTheme, PRESETS } from './lib/stores/theme.svelte.js';
  import { navigationStore } from './lib/stores/navigation.svelte.js';
  import { overlayStore } from './lib/stores/overlay.svelte.js';
  import { aiStatusStore, initAiStatusListeners, startProvider } from './lib/stores/ai-status.svelte.js';
  import { voiceStore, initVoiceListeners, startVoiceEngine } from './lib/stores/voice.svelte.js';
  import { shortcutsStore, setActionHandler, setReleaseHandler, setupInAppShortcuts } from './lib/stores/shortcuts.svelte.js';
  import { initStartupGreeting } from './lib/voice-greeting.js';
  import { listen } from '@tauri-apps/api/event';
  import { writeUserMessage, aiPtyInput, pttPress, pttRelease, configurePttKey, configureDictationKey } from './lib/api.js';

  import TitleBar from './components/shared/TitleBar.svelte';
  import Sidebar from './components/sidebar/Sidebar.svelte';
  import ChatPanel from './components/chat/ChatPanel.svelte';
  import Terminal from './components/terminal/Terminal.svelte';
  import SettingsPanel from './components/settings/SettingsPanel.svelte';
  import OverlayPanel from './components/overlay/OverlayPanel.svelte';
  import StatsBar from './components/shared/StatsBar.svelte';

  // Load config on mount and init event listeners
  $effect(() => {
    loadConfig();
    initAiStatusListeners();
    initVoiceListeners();
    initStartupGreeting();
    overlayStore.initEventListeners();
    return () => overlayStore.destroyEventListeners();
  });

  // Initialize sidebar state from config once loaded
  $effect(() => {
    if (configStore.loaded) {
      const collapsed = configStore.value?.sidebar?.collapsed;
      if (collapsed !== undefined) {
        navigationStore.initSidebarState(collapsed);
      }
    }
  });

  // Auto-start AI provider once config is loaded
  let providerStarted = $state(false);
  $effect(() => {
    if (configStore.loaded && !providerStarted) {
      providerStarted = true;
      startProvider();
    }
  });

  // Auto-start voice engine once config is loaded
  let voiceStarted = $state(false);
  $effect(() => {
    if (configStore.loaded && !voiceStarted) {
      voiceStarted = true;
      startVoiceEngine();
    }
  });

  // ---- Stats dashboard visibility ----
  let statsVisible = $state(false);

  // ---- Voice activation handlers (shared by keyboard shortcuts + mouse buttons) ----

  function handleVoicePress() {
    const mode = configStore.value?.behavior?.activationMode;
    if (mode === 'pushToTalk' || mode === 'wakeWord') {
      // PTT + Wake Word: start recording (backend handles barge-in if TTS is speaking)
      pttPress();
    } else if (mode === 'toggle') {
      // Toggle: if recording → stop, if not → start
      if (voiceStore.isRecording) {
        pttRelease();
      } else {
        pttPress();
      }
    }
  }

  function handleVoiceRelease() {
    const mode = configStore.value?.behavior?.activationMode;
    if (mode === 'pushToTalk') {
      pttRelease();
    }
    // Toggle mode: release does nothing (only next press stops)
  }

  // ---- Dictation handler (toggle-only: press to start, press again to stop) ----

  function handleDictationPress() {
    // Dictation only works in toggle mode
    const mode = configStore.value?.behavior?.activationMode;
    if (mode !== 'toggle') return;

    if (voiceStore.isRecording && voiceStore.isDictating) {
      // Currently dictating → stop recording, triggers STT → inject text
      pttRelease();
    } else if (!voiceStore.isRecording) {
      // Not recording → start dictation recording
      voiceStore.startDictation();
      overlayStore.setDictatingMode(true);
      pttPress();
    }
  }

  // Initialize global + in-app shortcuts once config is loaded
  let shortcutsInitialized = $state(false);
  $effect(() => {
    if (configStore.loaded && !shortcutsInitialized) {
      shortcutsInitialized = true;
      shortcutsStore.init(configStore.value?.shortcuts);

      // Wire shortcut handlers
      setActionHandler('toggle-voice', handleVoicePress);
      setReleaseHandler('toggle-voice', handleVoiceRelease);
      setActionHandler('stats-dashboard', () => { statsVisible = !statsVisible; });

      // Listen for PTT events from the unified input hook.
      // The Rust hook handles matching the configured key and emits
      // ptt-key-pressed/released — no frontend key comparison needed.
      listen('ptt-key-pressed', () => handleVoicePress());
      listen('ptt-key-released', () => handleVoiceRelease());

      // Dictation: toggle-only (press to start, press again to stop)
      listen('dictation-key-pressed', () => handleDictationPress());
    }
  });

  // In-app DOM shortcuts (Ctrl+,, Ctrl+N, Ctrl+T, Escape)
  $effect(() => {
    if (!shortcutsInitialized) return;
    const cleanup = setupInAppShortcuts();
    return cleanup;
  });

  // Clean up global shortcuts on window close
  $effect(() => {
    const handleBeforeUnload = () => {
      shortcutsStore.destroy();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  // Configure PTT/dictation key bindings in the native input hook.
  // Reactive: if the user changes keys in settings, the Rust hook
  // picks them up immediately without requiring an app restart.
  $effect(() => {
    if (!configStore.loaded) return;
    const pttKey = configStore.value?.behavior?.pttKey || '';
    const dictKey = configStore.value?.behavior?.dictationKey || '';
    if (pttKey) {
      configurePttKey(pttKey).catch((err) => {
        console.warn('[app] Failed to configure PTT key:', err);
      });
    }
    if (dictKey) {
      configureDictationKey(dictKey).catch((err) => {
        console.warn('[app] Failed to configure dictation key:', err);
      });
    }
  });

  // DOM-level keydown/keyup fallback for PTT when the app window is focused.
  // Some mouse drivers (Razer Synapse, etc.) deliver keyboard events via
  // PostMessage to the focused window, which bypasses WH_KEYBOARD_LL.
  // When the OS hook works (app not focused), it suppresses the key so
  // these DOM handlers never fire — no double-triggering.
  let pttDomActive = $state(false);
  $effect(() => {
    if (!configStore.loaded) return;
    const pttKey = configStore.value?.behavior?.pttKey || '';
    const kbMatch = pttKey.match(/^kb:(\d+)$/);
    if (!kbMatch) return; // Only needed for keyboard-type bindings

    const vkey = parseInt(kbMatch[1], 10);

    function onKeydown(e) {
      if (e.keyCode === vkey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!pttDomActive) {
          pttDomActive = true;
          handleVoicePress();
        }
      }
    }
    function onKeyup(e) {
      if (e.keyCode === vkey) {
        e.preventDefault();
        e.stopPropagation();
        if (pttDomActive) {
          pttDomActive = false;
          handleVoiceRelease();
        }
      }
    }

    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('keyup', onKeyup, true);

    return () => {
      window.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('keyup', onKeyup, true);
    };
  });

  // Sync theme from config: apply preset + custom colors/fonts on load and config change
  $effect(() => {
    if (!configStore.loaded) return;
    const cfg = configStore.value;
    const themeName = cfg?.appearance?.theme || 'colorblind';
    const preset = PRESETS[themeName] || PRESETS.colorblind;

    // Merge custom color overrides if saved
    const savedColors = cfg?.appearance?.colors;
    const colors = (savedColors && typeof savedColors === 'object')
      ? { ...preset.colors, ...savedColors }
      : preset.colors;

    // Merge custom font overrides if saved
    const savedFonts = cfg?.appearance?.fonts;
    const fonts = (savedFonts && typeof savedFonts === 'object')
      ? { ...preset.fonts, ...savedFonts }
      : preset.fonts;

    currentThemeName.value = themeName;
    applyTheme(colors, fonts);
  });

  /**
   * Handle user chat messages.
   *
   * For API providers (Ollama, LM Studio, etc.): send directly to the
   * HTTP streaming pipeline via aiPtyInput, which calls provider.send_input().
   *
   * For CLI providers (Claude Code, OpenCode): write to the MCP inbox
   * so the agent picks it up via voice_listen.
   */
  function handleChatSend(text) {
    if (aiStatusStore.isApiProvider) {
      aiPtyInput(text).catch((err) => {
        console.warn('[chat] Failed to send message to API provider:', err);
      });
    } else {
      writeUserMessage(text).catch((err) => {
        console.warn('[chat] Failed to write user message to inbox:', err);
      });
    }
  }

  // Derive active view from navigation store
  let activeView = $derived(navigationStore.activeView);
  let isOverlay = $derived(overlayStore.isOverlayMode);
</script>

{#if isOverlay}
  <OverlayPanel />
{:else}
  <div class="app-shell">
    <TitleBar />

    <div class="app-body">
      <Sidebar />

      <main class="main-content">
        {#if activeView === 'chat'}
          <div class="view-panel">
            <ChatPanel onSend={handleChatSend} />
          </div>
        {:else if activeView === 'terminal'}
          <div class="view-panel">
            <Terminal />
          </div>
        {:else if activeView === 'browser'}
          <div class="view-panel">
            <div class="view-placeholder">
              <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <h2>Browser</h2>
              <p>Embedded browser will go here.</p>
            </div>
          </div>
        {:else if activeView === 'settings'}
          <div class="view-panel">
            <SettingsPanel />
          </div>
        {/if}
      </main>
    </div>
  </div>
{/if}

<StatsBar bind:visible={statsVisible} />

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
  }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .main-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .view-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .view-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--muted);
    user-select: none;
  }

  .view-placeholder h2 {
    color: var(--text-strong);
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .view-placeholder p {
    margin: 0;
    font-size: 14px;
  }

  .view-placeholder .placeholder-icon {
    width: 48px;
    height: 48px;
    color: var(--muted);
    opacity: 0.5;
    margin-bottom: 8px;
  }
</style>
