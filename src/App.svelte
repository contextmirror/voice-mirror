<script>
  import { configStore, loadConfig } from './lib/stores/config.svelte.js';
  import { currentThemeName, applyTheme, PRESETS } from './lib/stores/theme.svelte.js';
  import { navigationStore } from './lib/stores/navigation.svelte.js';
  import { projectStore } from './lib/stores/project.svelte.js';
  import { overlayStore } from './lib/stores/overlay.svelte.js';
  import { aiStatusStore, initAiStatusListeners, startProvider } from './lib/stores/ai-status.svelte.js';
  import { voiceStore, initVoiceListeners, startVoiceEngine } from './lib/stores/voice.svelte.js';
  import { shortcutsStore, setActionHandler, setReleaseHandler, setupInAppShortcuts } from './lib/stores/shortcuts.svelte.js';
  import { initStartupGreeting } from './lib/voice-greeting.js';
  import { listen } from '@tauri-apps/api/event';
  import { writeUserMessage, aiPtyInput, pttPress, pttRelease, configurePttKey, configureDictationKey, injectText, showWindow, minimizeWindow } from './lib/api.js';
  import { chatStore } from './lib/stores/chat.svelte.js';
  import { PROVIDER_ICONS } from './lib/providers.js';

  import TitleBar from './components/shared/TitleBar.svelte';
  import Sidebar from './components/sidebar/Sidebar.svelte';
  import ChatPanel from './components/chat/ChatPanel.svelte';
  import Terminal from './components/terminal/Terminal.svelte';
  import SettingsPanel from './components/settings/SettingsPanel.svelte';
  import LensWorkspace from './components/lens/LensWorkspace.svelte';
  import CommandPalette from './components/lens/CommandPalette.svelte';
  import { layoutStore } from './lib/stores/layout.svelte.js';
  import OverlayPanel from './components/overlay/OverlayPanel.svelte';
  import ResizeEdges from './components/shared/ResizeEdges.svelte';
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

  // Initialize sidebar state and restore overlay mode from config once loaded
  let overlayRestored = $state(false);
  $effect(() => {
    if (configStore.loaded) {
      const collapsed = configStore.value?.sidebar?.collapsed;
      if (collapsed !== undefined) {
        navigationStore.initSidebarState(collapsed);
      }
      const mode = configStore.value?.sidebar?.mode;
      if (mode) {
        navigationStore.initMode(/** @type {'mirror'|'lens'} */ (mode));
      }
      const projects = configStore.value?.projects;
      if (projects) {
        projectStore.init(projects);
      }

      // Restore overlay (orb) mode if user was in compact mode last session.
      // After restore, show the window (it starts hidden to prevent flash).
      if (!overlayRestored) {
        overlayRestored = true;
        overlayStore.restoreFromConfig(configStore.value);
        document.body.classList.add('app-ready');
        // Window starts hidden (visible:false in tauri.conf.json).
        // Now that Svelte has mounted and the correct mode is set, show it.
        showWindow().then(() => {
          if (configStore.value?.behavior?.startMinimized) {
            minimizeWindow().catch(() => {});
          }
        }).catch(() => {});
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

  // ---- Command palette visibility ----
  let commandPaletteVisible = $state(false);

  // ---- Voice activation handlers (shared by keyboard shortcuts + mouse buttons) ----

  function handleVoicePress() {
    // In dictation-only mode, all voice input goes to text injection
    if (aiStatusStore.isDictationProvider) {
      const mode = configStore.value?.behavior?.activationMode;
      if (voiceStore.isRecording) {
        // Already recording → stop (for toggle mode or repeated press)
        pttRelease();
      } else {
        // Start dictation recording
        voiceStore.startDictation();
        overlayStore.setDictatingMode(true);
        pttPress();
      }
      return;
    }

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
    // In dictation-only mode, release stops recording for PTT mode
    if (aiStatusStore.isDictationProvider) {
      const mode = configStore.value?.behavior?.activationMode;
      if (mode === 'pushToTalk' && voiceStore.isRecording) {
        pttRelease();
      }
      return;
    }

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
      setActionHandler('open-file-search', () => { commandPaletteVisible = true; });

      // Listen for PTT events from the unified input hook.
      // The Rust hook handles matching the configured key and emits
      // ptt-key-pressed/released — no frontend key comparison needed.
      listen('ptt-key-pressed', () => handleVoicePress());
      listen('ptt-key-released', () => handleVoiceRelease());

      // Dictation: toggle-only (press to start, press again to stop)
      listen('dictation-key-pressed', () => handleDictationPress());
    }
  });

  // In-app DOM shortcuts (Ctrl+,, Ctrl+N, Ctrl+T, F1, Escape)
  $effect(() => {
    if (!shortcutsInitialized) return;
    const cleanup = setupInAppShortcuts();
    return cleanup;
  });

  // Forward shortcuts from the lens webview via custom URI scheme protocol.
  // Child WebView2 instances are separate processes (NOT iframes), so
  // window.top.postMessage() doesn't work.  The injected JS fires an Image
  // request to the `lens-shortcut://` protocol, Rust intercepts it and emits
  // this Tauri event.
  $effect(() => {
    let unlistenFn;
    listen('lens-shortcut', (event) => {
      const key = event.payload?.key;
      if (key === 'F1') { commandPaletteVisible = true; }
      else if (key === ',') { navigationStore.setView('settings'); }
    }).then(fn => { unlistenFn = fn; });
    return () => { unlistenFn?.(); };
  });

  // Clean up on window close (bounds are saved by Rust's CloseRequested handler)
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
  function handleChatSend(text, attachments = []) {
    // In dictation-only mode, there's no AI to route to.
    // The message is already added to the chat store by ChatInput.
    // (Voice transcriptions are injected via injectText in voice.svelte.js)
    if (aiStatusStore.isDictationProvider) {
      return;
    }

    const imagePath = attachments.length > 0 ? attachments[0].path : null;

    if (aiStatusStore.isApiProvider) {
      aiPtyInput(text, imagePath).catch((err) => {
        console.warn('[chat] Failed to send message to API provider:', err);
      });
    } else {
      writeUserMessage(text, null, null, imagePath).catch((err) => {
        console.warn('[chat] Failed to write user message to inbox:', err);
      });
    }
  }

  // Derive active view from navigation store
  let activeView = $derived(navigationStore.activeView);
  let isOverlay = $derived(overlayStore.isOverlayMode);

  // Provider status for titlebar
  let aiProviderType = $derived(aiStatusStore.providerType || 'claude');
  let providerIcon = $derived(PROVIDER_ICONS[aiProviderType] || null);
</script>

{#if isOverlay}
  <OverlayPanel />
{:else}
  <ResizeEdges />
  <div class="app-shell">
    <TitleBar>
      {#snippet centerContent()}
        <div class="titlebar-provider-status">
          <div class="titlebar-provider-icon-wrapper">
            {#if providerIcon?.type === 'cover'}
              <span class="titlebar-provider-icon" style="background: url({providerIcon.src}) center/cover no-repeat; border-radius: 3px;"></span>
            {:else if providerIcon}
              <span class="titlebar-provider-icon" style="background: {providerIcon.bg};">
                <img class="titlebar-provider-icon-img" src={providerIcon.src} alt="" />
              </span>
            {:else}
              <span class="titlebar-provider-icon placeholder"></span>
            {/if}
            <span class="titlebar-status-dot" class:running={aiStatusStore.running} class:starting={aiStatusStore.starting}></span>
          </div>
          <span class="titlebar-provider-name">{aiStatusStore.displayName || 'AI Provider'}</span>
          <span class="titlebar-provider-state" class:running={aiStatusStore.running} class:starting={aiStatusStore.starting}>
            {aiStatusStore.running ? 'Running' : aiStatusStore.starting ? 'Starting...' : 'Stopped'}
          </span>
        </div>
        <div class="titlebar-search-trigger">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="titlebar-search-box" onclick={() => { commandPaletteVisible = true; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>Search Voice Mirror</span>
            <kbd>F1</kbd>
          </div>
        </div>
      {/snippet}
      {#snippet rightContent()}
        {#if activeView === 'lens'}
          <div class="titlebar-panel-toggles">
            <button
              class="titlebar-toggle"
              class:active={layoutStore.showChat}
              onclick={() => layoutStore.toggleChat()}
              aria-label="Toggle chat"
              title="Toggle chat"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
            </button>
            <button
              class="titlebar-toggle"
              class:active={layoutStore.showTerminal}
              onclick={() => layoutStore.toggleTerminal()}
              aria-label="Toggle terminal"
              title="Toggle terminal"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="15" x2="21" y2="15"/>
              </svg>
            </button>
            <button
              class="titlebar-toggle"
              class:active={layoutStore.showFileTree}
              onclick={() => layoutStore.toggleFileTree()}
              aria-label="Toggle file tree"
              title="Toggle file tree"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
          </div>
        {/if}
      {/snippet}
    </TitleBar>

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
        {:else if activeView === 'lens'}
          <div class="view-panel">
            <LensWorkspace onSend={handleChatSend} />
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
<CommandPalette bind:visible={commandPaletteVisible} onClose={() => { commandPaletteVisible = false; }} />

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
    gap: 2px;
  }

  .main-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-radius: var(--radius-lg) 0 0 var(--radius-lg);
    background: var(--bg);
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

  /* ========== Titlebar Provider Status ========== */
  .titlebar-provider-status {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .titlebar-provider-icon-wrapper {
    position: relative;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
  }

  .titlebar-provider-icon {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .titlebar-provider-icon.placeholder {
    background: var(--bg-hover);
    border: 1px solid var(--border);
  }

  .titlebar-provider-icon-img {
    width: 65%;
    height: 65%;
    object-fit: contain;
  }

  .titlebar-status-dot {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    border: 2px solid var(--chrome, var(--bg-elevated));
    transition: background var(--duration-fast) var(--ease-out),
                box-shadow var(--duration-fast) var(--ease-out);
  }

  .titlebar-status-dot.running {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  }

  .titlebar-status-dot.starting {
    background: #f59e0b;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
    animation: titlebar-status-pulse 1s ease-in-out infinite;
  }

  @keyframes titlebar-status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .titlebar-provider-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
  }

  .titlebar-provider-state {
    font-size: 12px;
    color: var(--muted);
  }

  .titlebar-provider-state.running {
    color: #22c55e;
  }

  .titlebar-provider-state.starting {
    color: #f59e0b;
  }

  @media (prefers-reduced-motion: reduce) {
    .titlebar-status-dot {
      animation: none;
      transition: none;
    }
  }

  /* Command palette search trigger (always visible in titlebar) */
  .titlebar-search-trigger {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .titlebar-search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--muted);
    font-size: 12px;
    min-width: 220px;
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-out);
  }
  .titlebar-search-box:hover { border-color: var(--accent); }
  .titlebar-search-box kbd {
    margin-left: auto;
    font-size: 10px;
    opacity: 0.5;
    font-family: var(--font-mono);
  }

  .titlebar-panel-toggles {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: 4px;
    -webkit-app-region: no-drag;
    z-index: 10001;
  }

  .titlebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .titlebar-toggle svg {
    width: 15px;
    height: 15px;
  }

  .titlebar-toggle:hover {
    background: var(--card-highlight, var(--bg));
    color: var(--text);
  }

  .titlebar-toggle.active {
    color: var(--accent);
  }

  .titlebar-toggle.active:hover {
    color: var(--text);
  }

</style>
