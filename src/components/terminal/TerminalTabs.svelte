<script>
  /**
   * TerminalTabs.svelte -- Bottom panel with 4 pinned tabs.
   *
   * Features:
   * - 4 permanent tabs: Voice Agent, Output, Terminal, Problems
   * - Right-click context menus for Voice Agent and Output
   * - Toolbar actions on the right side of the tab bar
   * - Content area routing based on bottomPanelMode
   * - Problems tab with severity filters, text filter, badge count, Ctrl+Shift+M shortcut
   */
  import { onMount } from 'svelte';
  import AiTerminal from './AiTerminal.svelte';
  import TerminalPanel from './TerminalPanel.svelte';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { sendVoiceLoop } from '../../lib/api.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { aiStatusStore, switchProvider, stopProvider } from '../../lib/stores/ai-status.svelte.js';
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { PROVIDER_GROUPS, PROVIDER_ICONS, PROVIDER_NAMES } from '../../lib/providers.js';
  import { setActionHandler } from '../../lib/stores/shortcuts.svelte.js';
  import TerminalActionBar from './TerminalActionBar.svelte';
  import OutputPanel from '../lens/OutputPanel.svelte';
  import { outputStore } from '../../lib/stores/output.svelte.js';
  import ProblemsPanel from '../lens/ProblemsPanel.svelte';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';

  // ---- Bottom panel mode: ai | output | terminal | problems ----
  let bottomPanelMode = $state('ai');

  // ---- Problems panel filter state ----
  let problemsShowErrors = $state(true);
  let problemsShowWarnings = $state(true);
  let problemsShowInfos = $state(true);
  let problemsFilterText = $state('');

  // Derived totals for badge and toolbar
  let problemsTotals = $derived(lspDiagnosticsStore.getTotals());
  let problemsBadgeCount = $derived(problemsTotals.errors + problemsTotals.warnings);

  // ---- Output channel dropdown (custom, theme-aware) ----
  let channelDropdownOpen = $state(false);

  function toggleChannelDropdown() {
    channelDropdownOpen = !channelDropdownOpen;
  }

  function selectChannel(ch) {
    outputStore.switchChannel(ch);
    channelDropdownOpen = false;
  }

  // Close dropdown on outside click
  $effect(() => {
    if (!channelDropdownOpen) return;
    function handleClick() { channelDropdownOpen = false; }
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick);
    };
  });


  // ---- Terminal action registration ----
  let termActions = {};

  function handleClear() {
    termActions['ai']?.clear();
  }

  function handleCopy() {
    termActions['ai']?.copy();
  }

  function handlePaste() {
    termActions['ai']?.paste();
  }

  // ---- Voice button (AI tab only, CLI provider only) ----

  let voiceLoading = $state(false);

  let voiceActive = $derived(
    voiceStore.state === 'listening' || voiceStore.state === 'recording'
  );

  let showVoiceButton = $derived(
    bottomPanelMode === 'ai' &&
    aiStatusStore.running && aiStatusStore.isCliProvider
  );

  async function handleStartVoice() {
    if (voiceLoading) return;
    voiceLoading = true;
    const name = configStore.value?.user?.name || 'user';
    try {
      await sendVoiceLoop(name);
      toastStore.addToast({
        message: 'Voice loop started — listening for input',
        severity: 'success',
        duration: 3000,
      });
    } catch (err) {
      console.error('[TerminalTabs] Failed to start voice loop:', err);
      toastStore.addToast({
        message: 'Failed to start voice loop',
        severity: 'error',
      });
    } finally {
      voiceLoading = false;
    }
  }

  // ---- Right-click context menu (Voice Agent tab) ----

  let contextMenu = $state({ visible: false, x: 0, y: 0, tabId: null });

  function showContextMenu(e, tabId) {
    e.preventDefault();
    const estimatedHeight = tabId === 'ai' ? 380 : 140;
    const maxY = window.innerHeight - estimatedHeight;
    const y = Math.min(e.clientY, Math.max(0, maxY));
    contextMenu = { visible: true, x: e.clientX, y, tabId };
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false };
  }

  function contextClear() {
    termActions[contextMenu.tabId]?.clear();
    closeContextMenu();
  }

  async function contextSwitchProvider(providerId) {
    if (providerId === aiStatusStore.providerType) {
      closeContextMenu();
      return;
    }
    closeContextMenu();
    try {
      await updateConfig({ ai: { provider: providerId } });
      const cfg = configStore.value;
      const endpoints = cfg?.ai?.endpoints || {};
      const apiKeys = cfg?.ai?.apiKeys || {};
      await switchProvider(providerId, {
        model: cfg?.ai?.model || undefined,
        baseUrl: endpoints[providerId] || undefined,
        apiKey: apiKeys[providerId] || undefined,
        contextLength: cfg?.ai?.contextLength || undefined,
      });
      toastStore.addToast({
        message: `Switched to ${PROVIDER_NAMES[providerId] || providerId}`,
        severity: 'success',
        duration: 3000,
      });
    } catch (err) {
      console.error('[TerminalTabs] Provider switch failed:', err);
      toastStore.addToast({
        message: `Failed to switch provider: ${err?.message || err}`,
        severity: 'error',
      });
    }
  }

  async function contextStopProvider() {
    closeContextMenu();
    try {
      await stopProvider();
      toastStore.addToast({
        message: 'Provider stopped',
        severity: 'success',
        duration: 3000,
      });
    } catch (err) {
      console.error('[TerminalTabs] Stop provider failed:', err);
      toastStore.addToast({
        message: 'Failed to stop provider',
        severity: 'error',
      });
    }
  }

  // Close context menu on outside click
  $effect(() => {
    if (!contextMenu.visible && !outputContextMenu.visible) return;
    function handleClick() { closeContextMenu(); closeOutputContextMenu(); }
    // Delay so the right-click itself doesn't close it
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick);
      window.addEventListener('contextmenu', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('contextmenu', handleClick);
    };
  });

  // ---- Output tab context menu ----

  let outputContextMenu = $state({ visible: false, x: 0, y: 0 });

  function showOutputContextMenu(e) {
    e.preventDefault();
    const estimatedHeight = 140;
    const maxY = window.innerHeight - estimatedHeight;
    const y = Math.min(e.clientY, Math.max(0, maxY));
    outputContextMenu = { visible: true, x: e.clientX, y };
  }

  function closeOutputContextMenu() {
    outputContextMenu = { ...outputContextMenu, visible: false };
  }

  function outputContextClear() {
    outputStore.clearChannel();
    closeOutputContextMenu();
  }

  function outputContextCopyAll() {
    const lines = outputStore.filteredEntries.map(e => {
      const d = new Date(e.timestamp);
      const time = d.toTimeString().slice(0, 8);
      return `${time} [${e.level}] ${e.message}`;
    });
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    closeOutputContextMenu();
  }

  function outputContextToggleWrap() {
    outputStore.toggleWordWrap();
    closeOutputContextMenu();
  }

  function outputContextToggleScrollLock() {
    outputStore.setAutoScroll(!outputStore.autoScroll);
    closeOutputContextMenu();
  }

  // ---- Keyboard: Ctrl+Tab / Ctrl+Shift+Tab to cycle panels ----

  const panelOrder = ['ai', 'output', 'terminal', 'problems'];

  onMount(() => {
    function handleKeydown(e) {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const idx = panelOrder.indexOf(bottomPanelMode);
        if (e.shiftKey) {
          bottomPanelMode = panelOrder[(idx - 1 + panelOrder.length) % panelOrder.length];
        } else {
          bottomPanelMode = panelOrder[(idx + 1) % panelOrder.length];
        }
      }

      // Ctrl+Shift+M → Toggle problems panel
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        bottomPanelMode = bottomPanelMode === 'problems' ? 'ai' : 'problems';
      }
    }
    window.addEventListener('keydown', handleKeydown, true);

    function handleShowProblems() {
      bottomPanelMode = 'problems';
    }
    window.addEventListener('status-bar-show-problems', handleShowProblems);

    // Register toggle-terminal shortcut handler (Ctrl+`)
    setActionHandler('toggle-terminal', () => {
      if (bottomPanelMode === 'terminal') {
        bottomPanelMode = 'ai';
      } else {
        bottomPanelMode = 'terminal';
      }
    });

    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      window.removeEventListener('status-bar-show-problems', handleShowProblems);
      setActionHandler('toggle-terminal', null);
    };
  });
</script>

<div class="terminal-tabs-container">
  <!-- Unified tab bar: 3 pinned tabs (left) + toolbar actions (right) -->
  <div class="terminal-tab-bar">
    <!-- Voice Agent tab (pinned) -->
    <div
      class="terminal-tab"
      class:active={bottomPanelMode === 'ai'}
      role="tab"
      tabindex="0"
      aria-selected={bottomPanelMode === 'ai'}
      onclick={() => bottomPanelMode = 'ai'}
      oncontextmenu={(e) => showContextMenu(e, 'ai')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') bottomPanelMode = 'ai'; }}
      title="Voice Agent"
    >
      <svg class="tab-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="9" cy="16" r="1" fill="currentColor"/><circle cx="15" cy="16" r="1" fill="currentColor"/>
      </svg>
      <span class="tab-label">Voice Agent</span>
    </div>

    <!-- Output tab (pinned) -->
    <div class="tab-divider"></div>
    <div
      class="terminal-tab"
      class:active={bottomPanelMode === 'output'}
      role="tab"
      tabindex="0"
      aria-selected={bottomPanelMode === 'output'}
      onclick={() => bottomPanelMode = 'output'}
      oncontextmenu={showOutputContextMenu}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') bottomPanelMode = 'output'; }}
    >
      <svg class="tab-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="tab-label">Output</span>
      {#if outputStore.hasProjectErrors}
        <span class="error-badge"></span>
      {/if}
    </div>

    <!-- Terminal tab (pinned) -->
    <div class="tab-divider"></div>
    <div
      class="terminal-tab"
      class:active={bottomPanelMode === 'terminal'}
      role="tab"
      tabindex="0"
      aria-selected={bottomPanelMode === 'terminal'}
      onclick={() => bottomPanelMode = 'terminal'}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') bottomPanelMode = 'terminal'; }}
    >
      <span class="tab-label">Terminal</span>
    </div>

    <!-- Problems tab (pinned) -->
    <div class="tab-divider"></div>
    <div
      class="terminal-tab"
      class:active={bottomPanelMode === 'problems'}
      role="tab"
      tabindex="0"
      aria-selected={bottomPanelMode === 'problems'}
      onclick={() => bottomPanelMode = 'problems'}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') bottomPanelMode = 'problems'; }}
      title="Problems (Ctrl+Shift+M)"
    >
      <svg class="tab-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12z"/>
        <line x1="8" y1="6" x2="8" y2="9"/><circle cx="8" cy="11" r="0.5" fill="currentColor"/>
      </svg>
      <span class="tab-label">Problems</span>
      {#if problemsBadgeCount > 0}
        <span class="problems-badge" class:warnings-only={problemsTotals.errors === 0}>{problemsBadgeCount}</span>
      {/if}
    </div>

    <!-- Spacer pushes toolbar actions to the right -->
    <div class="tab-bar-spacer"></div>

    {#if bottomPanelMode === 'terminal'}
      <!-- Terminal action bar (split, +, ...) on the outer strip -->
      <TerminalActionBar />
    {:else if bottomPanelMode === 'output'}
      <!-- Output controls (right side of tab bar, VS Code style) -->
      <div class="output-controls">
        <!-- Filter text input -->
        <div class="output-filter-wrapper">
          <input
            class="output-filter-input"
            type="text"
            placeholder="Filter (e.g. text, !exclude)"
            value={outputStore.filterText}
            oninput={(e) => outputStore.setFilterText(e.target.value)}
          />
          <!-- Funnel icon (decorative, inside input) -->
          <svg class="output-filter-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </div>

        <!-- Custom channel dropdown -->
        <div class="channel-dropdown-wrapper">
          <button
            class="channel-dropdown-trigger"
            onclick={(e) => { e.stopPropagation(); toggleChannelDropdown(); }}
            title="Select output channel"
          >
            <span>{outputStore.channelLabels[outputStore.activeChannel] || outputStore.activeChannel}</span>
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="3 4.5 6 7.5 9 4.5"/>
            </svg>
          </button>
          {#if channelDropdownOpen}
            <div class="channel-dropdown-menu">
              {#if outputStore.projectChannels.length > 0}
                {#each outputStore.projectChannels as pc}
                  <button
                    class="channel-dropdown-item"
                    class:active={outputStore.activeChannel === pc.label}
                    onclick={(e) => { e.stopPropagation(); selectChannel(pc.label); }}
                  >
                    {pc.label}
                    {#if outputStore.activeChannel === pc.label}
                      <svg class="channel-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    {/if}
                  </button>
                {/each}
                <div class="channel-divider"></div>
              {/if}
              {#each outputStore.channels as ch}
                <button
                  class="channel-dropdown-item"
                  class:active={outputStore.activeChannel === ch}
                  onclick={(e) => { e.stopPropagation(); selectChannel(ch); }}
                >
                  {outputStore.channelLabels[ch]}
                  {#if outputStore.activeChannel === ch}
                    <svg class="channel-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Toolbar icon group (VS Code style) -->
        <div class="toolbar-actions">
          <!-- Word wrap toggle -->
          <button
            class="toolbar-btn"
            class:toggled={outputStore.wordWrap}
            onclick={() => outputStore.toggleWordWrap()}
            title={outputStore.wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="13 15 11 18 13 21"/><path d="M3 18h7"/>
            </svg>
          </button>

          <!-- Lock scroll toggle -->
          <button
            class="toolbar-btn"
            class:toggled={!outputStore.autoScroll}
            onclick={() => outputStore.setAutoScroll(!outputStore.autoScroll)}
            title={outputStore.autoScroll ? 'Turn on scroll lock' : 'Turn off scroll lock (auto-scroll)'}
          >
            {#if outputStore.autoScroll}
              <!-- Unlocked (auto-scrolling) -->
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
              </svg>
            {:else}
              <!-- Locked (scroll locked) -->
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            {/if}
          </button>

          <!-- Clear output -->
          <button class="toolbar-btn" onclick={() => outputStore.clearChannel()} title="Clear output">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
              <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
            </svg>
          </button>
        </div>
      </div>
    {:else if bottomPanelMode === 'ai'}
      <!-- AI terminal controls -->
      <!-- Voice button (only with running CLI provider) -->
      {#if showVoiceButton}
        <button
          class="voice-btn"
          class:active={voiceActive}
          onclick={handleStartVoice}
          disabled={voiceLoading}
          title={voiceActive ? 'Voice loop is active' : 'Start voice loop'}
        >
          {#if voiceActive}
            <span class="voice-dot"></span>
            <span class="voice-label">Voice</span>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <span class="voice-label">{voiceLoading ? '...' : 'Voice'}</span>
          {/if}
        </button>
      {/if}

      <!-- Toolbar actions -->
      <div class="toolbar-actions">
        <button class="toolbar-btn" onclick={handleClear} title="Clear terminal">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
            <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
          </svg>
        </button>
        <button class="toolbar-btn" onclick={handleCopy} title="Copy selection (Ctrl+C)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="toolbar-btn" onclick={handlePaste} title="Paste (Ctrl+V)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1"/>
          </svg>
        </button>
      </div>
    {:else if bottomPanelMode === 'problems'}
      <div class="output-controls">
        <!-- Text filter -->
        <div class="output-filter-wrapper">
          <input
            class="output-filter-input problems-filter"
            type="text"
            placeholder="Filter (e.g. text, !exclude)"
            value={problemsFilterText}
            oninput={(e) => problemsFilterText = e.target.value}
          />
          <svg class="output-filter-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </div>
        <!-- Severity toggles -->
        <div class="toolbar-actions">
          <button
            class="toolbar-btn severity-toggle"
            class:toggled={problemsShowErrors}
            onclick={() => problemsShowErrors = !problemsShowErrors}
            title="Toggle errors"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="6"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>
            </svg>
            <span class="severity-count">{problemsTotals.errors}</span>
          </button>
          <button
            class="toolbar-btn severity-toggle"
            class:toggled={problemsShowWarnings}
            onclick={() => problemsShowWarnings = !problemsShowWarnings}
            title="Toggle warnings"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12zM8 5v4M8 11v1" stroke-linecap="round"/>
            </svg>
            <span class="severity-count">{problemsTotals.warnings}</span>
          </button>
          <button
            class="toolbar-btn severity-toggle"
            class:toggled={problemsShowInfos}
            onclick={() => problemsShowInfos = !problemsShowInfos}
            title="Toggle info"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="9" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/>
            </svg>
            <span class="severity-count">{problemsTotals.infos}</span>
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Voice Agent context menu -->
  {#if contextMenu.visible}
    <div
      class="context-menu"
      class:wide={contextMenu.tabId === 'ai'}
      style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    >
      <button class="context-menu-item" onclick={contextClear}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
          <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
        </svg>
        Clear
      </button>

      {#if contextMenu.tabId === 'ai'}
        <div class="context-menu-divider"></div>
        {#each PROVIDER_GROUPS as group}
          <div class="context-menu-group-label">{group.label}</div>
          {#each group.providers as opt}
            <button
              class="context-menu-item provider-item"
              class:current={aiStatusStore.providerType === opt.value}
              onclick={() => contextSwitchProvider(opt.value)}
            >
              {#if PROVIDER_ICONS[opt.value]?.type === 'cover'}
                <span class="ctx-provider-icon" style="background: url({PROVIDER_ICONS[opt.value].src}) center/cover no-repeat; border-radius: 3px;"></span>
              {:else if PROVIDER_ICONS[opt.value]}
                <span class="ctx-provider-icon" style="background: {PROVIDER_ICONS[opt.value].bg};">
                  <img src={PROVIDER_ICONS[opt.value].src} alt="" class="ctx-provider-icon-inner" />
                </span>
              {/if}
              <span class="ctx-provider-label">{opt.label}</span>
              {#if aiStatusStore.providerType === opt.value}
                {#if aiStatusStore.starting}
                  <span class="ctx-provider-status">Starting...</span>
                {:else}
                  <svg class="ctx-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                {/if}
              {/if}
            </button>
          {/each}
        {/each}

        {#if aiStatusStore.running || aiStatusStore.starting}
          <div class="context-menu-divider"></div>
          <button class="context-menu-item danger" onclick={contextStopProvider}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
            </svg>
            Stop Provider
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Output tab context menu -->
  {#if outputContextMenu.visible}
    <div
      class="context-menu"
      style="left: {outputContextMenu.x}px; top: {outputContextMenu.y}px;"
    >
      <button class="context-menu-item" onclick={outputContextClear}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
          <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
        </svg>
        Clear Output
      </button>
      <button class="context-menu-item" onclick={outputContextCopyAll}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy All
      </button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" onclick={outputContextToggleWrap}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><path d="M3 18h7"/>
        </svg>
        Word Wrap
        {#if outputStore.wordWrap}
          <svg class="ctx-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {/if}
      </button>
      <button class="context-menu-item" onclick={outputContextToggleScrollLock}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Scroll Lock
        {#if !outputStore.autoScroll}
          <svg class="ctx-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {/if}
      </button>
    </div>
  {/if}

  <!-- Content panels -->
  <!-- AI terminal (always mounted, hidden when not active) -->
  <div class="terminal-panels" class:hidden={bottomPanelMode !== 'ai'}>
    <div class="terminal-panel">
      <AiTerminal onRegisterActions={(actions) => { termActions['ai'] = actions; }} />
    </div>
  </div>

  <!-- Output panel -->
  {#if bottomPanelMode === 'output'}
    <div class="output-panel-container">
      <OutputPanel />
    </div>
  {/if}

  <!-- Terminal panel -->
  {#if bottomPanelMode === 'terminal'}
    <div class="terminal-panel-container">
      <TerminalPanel />
    </div>
  {/if}

  <!-- Problems panel -->
  {#if bottomPanelMode === 'problems'}
    <div class="problems-panel-container">
      <ProblemsPanel
        showErrors={problemsShowErrors}
        showWarnings={problemsShowWarnings}
        showInfos={problemsShowInfos}
        filterText={problemsFilterText}
      />
    </div>
  {/if}
</div>

<style>
  .terminal-tabs-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  /* -- Unified tab bar -- */

  .terminal-tab-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    height: 36px;
    min-height: 36px;
    background: var(--bg);
    border-bottom: none;
    user-select: none;
  }

  .terminal-tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab-bar-spacer {
    flex: 1;
    min-width: 8px;
  }

  /* -- Tabs -- */

  .terminal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 26px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .terminal-tab:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .terminal-tab.active {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--text) 12%, transparent);
    font-weight: 500;
  }

  .tab-icon {
    flex-shrink: 0;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: inherit;
  }

  .tab-divider {
    width: 1px;
    height: 16px;
    background: color-mix(in srgb, var(--border) 30%, transparent);
    margin: 0 4px;
    flex-shrink: 0;
  }

  /* -- Toolbar actions (right side) -- */

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .toolbar-btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .toolbar-btn.toggled {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .toolbar-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* -- Voice button -- */

  .voice-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    margin-right: 4px;
    transition: all 0.15s;
  }

  .voice-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .voice-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voice-btn.active {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
    color: var(--ok);
    cursor: default;
  }

  .voice-label {
    pointer-events: none;
    white-space: nowrap;
  }

  .voice-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
    animation: voice-pulse 2s ease-in-out infinite;
  }

  @keyframes voice-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* -- Context menu -- */

  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 4px;
    min-width: 140px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background 0.1s;
  }

  .context-menu-item:hover {
    background: rgba(255,255,255,0.06);
  }

  .context-menu-item.danger {
    color: var(--danger, #ef4444);
  }

  .context-menu-item.danger:hover {
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border, rgba(255,255,255,0.06));
    margin: 4px 0;
  }

  .context-menu.wide {
    min-width: 200px;
  }

  .context-menu-group-label {
    padding: 6px 10px 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--muted);
    pointer-events: none;
  }

  .context-menu-item.provider-item {
    gap: 6px;
    padding: 5px 10px;
  }

  .context-menu-item.current {
    color: var(--accent);
  }

  .ctx-provider-icon {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .ctx-provider-icon-inner {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .ctx-provider-label {
    flex: 1;
  }

  .ctx-check {
    flex-shrink: 0;
    color: var(--accent);
  }

  .ctx-provider-status {
    font-size: 10px;
    color: var(--muted);
    font-style: italic;
    flex-shrink: 0;
  }

  /* -- Output controls (in tab bar, right side) -- */

  .output-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* -- Output filter input -- */

  .output-filter-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .output-filter-input {
    width: 180px;
    padding: 2px 8px 2px 24px;
    background: color-mix(in srgb, var(--text) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-family);
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  .output-filter-input::placeholder {
    color: var(--muted);
    opacity: 0.7;
  }

  .output-filter-input:focus {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .output-filter-icon {
    position: absolute;
    left: 6px;
    pointer-events: none;
    color: var(--muted);
    opacity: 0.6;
  }

  /* -- Custom channel dropdown -- */

  .channel-dropdown-wrapper {
    position: relative;
  }

  .channel-dropdown-trigger {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: color-mix(in srgb, var(--text) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, background 0.15s;
  }

  .channel-dropdown-trigger:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
    border-color: color-mix(in srgb, var(--border) 60%, transparent);
  }

  .channel-dropdown-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    z-index: 10000;
  }

  .channel-dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background 0.1s;
  }

  .channel-dropdown-item:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .channel-dropdown-item.active {
    color: var(--accent);
  }

  .channel-check {
    color: var(--accent);
    flex-shrink: 0;
  }

  .channel-divider {
    height: 1px;
    background: var(--muted);
    margin: 4px 8px;
    opacity: 0.3;
  }

  .error-badge {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger, #f44);
    margin-left: 4px;
    vertical-align: middle;
  }

  /* -- Output panel container -- */

  .output-panel-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    border-top: 1px solid color-mix(in srgb, var(--text) 12%, var(--bg));
  }

  /* -- Terminal panel container -- */

  .terminal-panel-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    border-top: 1px solid color-mix(in srgb, var(--text) 12%, var(--bg));
  }

  /* -- Terminal panels -- */

  .terminal-panels {
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .terminal-panel {
    position: absolute;
    inset: 0;
  }

  .terminal-panels.hidden {
    display: none;
  }

  .terminal-panel.hidden {
    display: none;
  }

  /* -- Problems badge -- */
  .problems-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    margin-left: 2px;
  }

  .problems-badge.warnings-only {
    background: var(--warn);
  }

  .severity-toggle {
    gap: 2px;
  }

  .severity-count {
    font-size: 11px;
  }

  .problems-panel-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-dot {
      animation: none;
    }
  }
</style>
