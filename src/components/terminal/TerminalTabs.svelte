<script>
  /**
   * TerminalTabs.svelte -- Tabbed terminal container with unified tab bar.
   *
   * Features:
   * - Single bar: tabs (left) + toolbar actions (right)
   * - Double-click tab to rename (inline input)
   * - Right-click context menu (rename, clear, close)
   * - Drag-to-reorder shell tabs (AI tab pinned at index 0)
   * - Ctrl+Tab / Ctrl+Shift+Tab to cycle tabs
   * - Smart shell numbering (fills gaps)
   */
  import Terminal from './Terminal.svelte';
  import ShellTerminal from './ShellTerminal.svelte';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { sendVoiceLoop } from '../../lib/api.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { aiStatusStore, switchProvider, stopProvider } from '../../lib/stores/ai-status.svelte.js';
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { PROVIDER_GROUPS, PROVIDER_ICONS, PROVIDER_NAMES } from '../../lib/providers.js';

  // ---- Terminal action registration ----
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

  // ---- Tab renaming (double-click) ----

  let editingTabId = $state(null);
  let editValue = $state('');

  function startRename(tabId) {
    const tab = terminalTabsStore.tabs.find(t => t.id === tabId);
    if (!tab) return;
    editValue = tab.title;
    editingTabId = tabId;
  }

  function saveRename() {
    if (!editingTabId) return;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== terminalTabsStore.tabs.find(t => t.id === editingTabId)?.title) {
      terminalTabsStore.renameTab(editingTabId, trimmed);
    }
    editingTabId = null;
  }

  function cancelRename() {
    editingTabId = null;
  }

  function handleRenameKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  /** Svelte action: auto-focus and select input text on mount */
  function autofocus(node) {
    node.focus();
    node.select();
  }

  // ---- Right-click context menu ----

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

  function contextRename() {
    startRename(contextMenu.tabId);
    closeContextMenu();
  }

  function contextClear() {
    termActions[contextMenu.tabId]?.clear();
    closeContextMenu();
  }

  function contextClose() {
    if (contextMenu.tabId !== 'ai') {
      terminalTabsStore.closeTab(contextMenu.tabId);
    }
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
    if (!contextMenu.visible) return;
    function handleClick() { closeContextMenu(); }
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

  // ---- Drag-to-reorder (pointer-based) ----

  let dragTabId = $state(null);
  let dragOverTabId = $state(null);
  let dragStartX = 0;
  let dragActive = false;

  function handleTabMousedown(e, tabId) {
    // Only left-click, only shell tabs
    if (e.button !== 0 || tabId === 'ai') return;
    dragStartX = e.clientX;
    dragActive = false;

    const onMousemove = (/** @type {MouseEvent} */ moveEvt) => {
      // 5px threshold before activating drag
      if (!dragActive && Math.abs(moveEvt.clientX - dragStartX) < 5) return;
      if (!dragActive) {
        dragActive = true;
        dragTabId = tabId;
      }

      // Find the tab element being hovered over
      const els = document.elementsFromPoint(moveEvt.clientX, moveEvt.clientY);
      const tabEl = els.find(el => el.closest?.('[data-tab-id]'));
      const hoverTabEl = tabEl?.closest?.('[data-tab-id]') || tabEl;
      const hoverId = hoverTabEl?.getAttribute?.('data-tab-id') || null;

      if (hoverId && hoverId !== 'ai' && hoverId !== tabId) {
        dragOverTabId = hoverId;
      } else {
        dragOverTabId = null;
      }
    };

    const onMouseup = () => {
      window.removeEventListener('mousemove', onMousemove);
      window.removeEventListener('mouseup', onMouseup);

      if (dragActive && dragOverTabId) {
        terminalTabsStore.moveTab(dragTabId, dragOverTabId);
      }
      dragTabId = null;
      dragOverTabId = null;
      dragActive = false;
    };

    window.addEventListener('mousemove', onMousemove);
    window.addEventListener('mouseup', onMouseup);
  }

  // ---- Keyboard tab cycling (Ctrl+Tab / Ctrl+Shift+Tab) ----

  $effect(() => {
    function handleKeydown(e) {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          terminalTabsStore.prevTab();
        } else {
          terminalTabsStore.nextTab();
        }
      }
    }
    window.addEventListener('keydown', handleKeydown, true);
    return () => window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

<div class="terminal-tabs-container">
  <!-- Unified tab bar: tabs (left) + toolbar actions (right) -->
  <div class="terminal-tab-bar">
    {#each terminalTabsStore.tabs as tab (tab.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="terminal-tab"
        class:active={terminalTabsStore.activeTabId === tab.id}
        class:exited={!tab.running}
        class:drag-over={dragOverTabId === tab.id && dragTabId !== tab.id}
        class:dragging={dragTabId === tab.id}
        role="tab"
        tabindex="0"
        aria-selected={terminalTabsStore.activeTabId === tab.id}
        data-tab-id={tab.id}
        onclick={() => terminalTabsStore.setActive(tab.id)}
        oncontextmenu={(e) => showContextMenu(e, tab.id)}
        onmousedown={(e) => handleTabMousedown(e, tab.id)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') terminalTabsStore.setActive(tab.id); }}
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

        {#if editingTabId === tab.id}
          <!-- Inline rename input -->
          <input
            class="tab-rename-input"
            type="text"
            bind:value={editValue}
            onkeydown={handleRenameKeydown}
            onblur={saveRename}
            onclick={(e) => e.stopPropagation()}
            use:autofocus
          />
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="tab-label"
            role="textbox"
            ondblclick={(e) => { e.preventDefault(); startRename(tab.id); }}
          >{tab.title}</span>
        {/if}

        {#if tab.type === 'shell' && editingTabId !== tab.id}
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
      </div>
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

  <!-- Context menu -->
  {#if contextMenu.visible}
    <div
      class="context-menu"
      class:wide={contextMenu.tabId === 'ai'}
      style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    >
      <button class="context-menu-item" onclick={contextRename}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
        Rename
      </button>
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
      {:else}
        <div class="context-menu-divider"></div>
        <button class="context-menu-item danger" onclick={contextClose}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Close
        </button>
      {/if}
    </div>
  {/if}

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
    position: relative;
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

  .terminal-tab.dragging {
    opacity: 0.4;
  }

  .terminal-tab.drag-over {
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }

  .tab-icon {
    flex-shrink: 0;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: inherit;
  }

  /* ── Inline rename input ── */

  .tab-rename-input {
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    padding: 1px 4px;
    width: 80px;
    outline: none;
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

  /* ── Context menu ── */

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
