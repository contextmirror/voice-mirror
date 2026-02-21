<script>
  /**
   * TerminalTabs.svelte -- Tabbed terminal container with unified tab bar.
   *
   * Single bar: tabs on the left (AI + shell tabs + "+" button),
   * toolbar actions on the right (voice button, clear, copy, paste).
   *
   * Below the bar, renders one terminal per tab but only the active one is visible.
   * Inactive terminals remain mounted (hidden via CSS) to preserve scrollback.
   */
  import Terminal from './Terminal.svelte';
  import ShellTerminal from './ShellTerminal.svelte';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { sendVoiceLoop } from '../../lib/api.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { configStore } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  // ---- Terminal action registration ----
  // Each terminal (AI + shells) registers its clear/copy/paste actions here.
  // TerminalTabs calls the active terminal's actions when toolbar buttons are clicked.
  let termActions = {};

  function handleClear() {
    termActions[terminalTabsStore.activeTabId]?.clear();
  }

  function handleCopy() {
    termActions[terminalTabsStore.activeTabId]?.copy();
  }

  function handlePaste() {
    termActions[terminalTabsStore.activeTabId]?.paste();
  }

  // ---- Voice button (AI tab only, CLI provider only) ----

  let voiceLoading = $state(false);

  let voiceActive = $derived(
    voiceStore.state === 'listening' || voiceStore.state === 'recording'
  );

  let showVoiceButton = $derived(
    terminalTabsStore.activeTabId === 'ai' &&
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

  // ---- Shell tab management ----

  async function handleAddShell() {
    const cwd = projectStore.activeProject?.path || null;
    await terminalTabsStore.addShellTab({ cwd });
  }
</script>

<div class="terminal-tabs-container">
  <!-- Unified tab bar: tabs (left) + toolbar actions (right) -->
  <div class="terminal-tab-bar">
    {#each terminalTabsStore.tabs as tab (tab.id)}
      <button
        class="terminal-tab"
        class:active={terminalTabsStore.activeTabId === tab.id}
        class:exited={!tab.running}
        onclick={() => terminalTabsStore.setActive(tab.id)}
        title={tab.title}
      >
        {#if tab.type === 'ai'}
          <svg class="tab-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="9" cy="16" r="1" fill="currentColor"/><circle cx="15" cy="16" r="1" fill="currentColor"/>
          </svg>
        {:else}
          <svg class="tab-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        {/if}
        <span class="tab-label">{tab.title}</span>
        {#if tab.type === 'shell'}
          <button
            class="tab-close"
            onclick={(e) => { e.stopPropagation(); terminalTabsStore.closeTab(tab.id); }}
            title="Close terminal"
          >
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
            </svg>
          </button>
        {/if}
      </button>
    {/each}

    <button class="tab-add" onclick={handleAddShell} title="New shell terminal" aria-label="New terminal">
      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/>
      </svg>
    </button>

    <!-- Spacer pushes toolbar actions to the right -->
    <div class="tab-bar-spacer"></div>

    <!-- Voice button (only on AI tab with running CLI provider) -->
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
  </div>

  <!-- Terminal panels -->
  <div class="terminal-panels">
    <!-- AI terminal (always mounted) -->
    <div class="terminal-panel" class:hidden={terminalTabsStore.activeTabId !== 'ai'}>
      <Terminal onRegisterActions={(actions) => { termActions['ai'] = actions; }} />
    </div>

    <!-- Shell terminals (mounted when tab exists, hidden when inactive) -->
    {#each terminalTabsStore.tabs.filter(t => t.type === 'shell') as tab (tab.id)}
      <div class="terminal-panel" class:hidden={terminalTabsStore.activeTabId !== tab.id}>
        <ShellTerminal
          shellId={tab.shellId}
          visible={terminalTabsStore.activeTabId === tab.id}
          onRegisterActions={(actions) => { termActions[tab.id] = actions; }}
        />
      </div>
    {/each}
  </div>
</div>

<style>
  .terminal-tabs-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Unified tab bar ── */

  .terminal-tab-bar {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 6px;
    height: 34px;
    min-height: 34px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
    user-select: none;
  }

  .terminal-tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab-bar-spacer {
    flex: 1;
    min-width: 8px;
  }

  /* ── Tabs ── */

  .terminal-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 28px;
    background: none;
    border: none;
    border-radius: 4px 4px 0 0;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    position: relative;
    transition: color 0.15s, background 0.15s;
  }

  .terminal-tab:hover {
    color: var(--text);
    background: rgba(255,255,255,0.04);
  }

  .terminal-tab.active {
    color: var(--text);
    background: var(--bg);
  }

  .terminal-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--accent);
  }

  .terminal-tab.exited {
    opacity: 0.5;
  }

  .tab-icon {
    flex-shrink: 0;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 1px;
    border-radius: 3px;
    margin-left: 2px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
  }

  .terminal-tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    color: var(--text);
    background: rgba(255,255,255,0.1);
  }

  .tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    margin-left: 2px;
    transition: color 0.15s, background 0.15s;
  }

  .tab-add:hover {
    color: var(--text);
    background: rgba(255,255,255,0.06);
  }

  /* ── Toolbar actions (right side) ── */

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .toolbar-btn:hover {
    color: var(--text);
    background: rgba(255,255,255,0.06);
  }

  .toolbar-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* ── Voice button ── */

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

  /* ── Terminal panels ── */

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

  .terminal-panel.hidden {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-dot {
      animation: none;
    }
  }
</style>
