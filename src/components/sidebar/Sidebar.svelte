<script>
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { PROVIDER_ICONS } from '../../lib/providers.js';
  import ChatList from './ChatList.svelte';
  import ProjectStrip from './ProjectStrip.svelte';
  import SessionPanel from './SessionPanel.svelte';

  let aiDisplayName = $derived(aiStatusStore.displayName || 'AI Provider');
  let aiRunning = $derived(aiStatusStore.running);
  let aiStarting = $derived(aiStatusStore.starting);
  let aiProviderType = $derived(aiStatusStore.providerType || 'claude');
  let providerIcon = $derived(PROVIDER_ICONS[aiProviderType] || null);

  const collapsed = $derived(navigationStore.sidebarCollapsed);
  const activeView = $derived(navigationStore.activeView);
  const appMode = $derived(navigationStore.appMode);

  const tabs = [
    { id: 'chat', label: 'Chat', tooltip: 'Chat' },
    { id: 'terminal', label: 'Terminal', tooltip: 'Terminal' },
  ];

  function handleTabClick(tabId) {
    navigationStore.setView(tabId);
  }

  function handleToggleSidebar() {
    navigationStore.toggleSidebar();
  }

  /** Derive voice state and indicator class from the voice store */
  let voiceState = $derived(voiceStore.state);
  let voiceIndicatorClass = $derived(
    voiceState === 'recording' ? 'recording' :
    voiceState === 'listening' ? 'listening' :
    ''
  );
</script>

<aside class="sidebar" class:collapsed={collapsed}>
  <!-- AI Status Indicator -->
  <div class="sidebar-status" data-tooltip={collapsed ? `${aiDisplayName} — ${aiRunning ? 'Running' : aiStarting ? 'Starting...' : 'Stopped'}` : undefined}>
    <div class="provider-icon-wrapper">
      {#if providerIcon?.type === 'cover'}
        <span class="sidebar-provider-icon" style="background: url({providerIcon.src}) center/cover no-repeat; border-radius: 4px;"></span>
      {:else if providerIcon}
        <span class="sidebar-provider-icon" style="background: {providerIcon.bg};">
          <img class="sidebar-provider-icon-inner" src={providerIcon.src} alt="" />
        </span>
      {:else}
        <span class="sidebar-provider-icon placeholder"></span>
      {/if}
      <span class="status-dot" class:running={aiRunning} class:starting={aiStarting}></span>
    </div>
    {#if !collapsed}
      <span class="status-provider">{aiDisplayName}</span>
      <span class="status-label" class:running={aiRunning} class:starting={aiStarting}>
        {aiRunning ? 'Running' : aiStarting ? 'Starting...' : 'Stopped'}
      </span>
    {/if}
  </div>

  {#if appMode === 'mirror'}
    <!-- Chat List (only visible when on chat view and expanded) -->
    {#if activeView === 'chat' && !collapsed}
      <div class="sidebar-chat-section">
        <ChatList />
      </div>
    {/if}

    <!-- Navigation Tabs -->
    <nav class="sidebar-nav">
      {#each tabs as tab}
        <button
          class="nav-item"
          class:active={activeView === tab.id}
          data-tooltip={tab.tooltip}
          onclick={() => handleTabClick(tab.id)}
          aria-label={tab.label}
        >
          {#if tab.id === 'chat'}
            <svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          {:else if tab.id === 'terminal'}
            <svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          {/if}
          {#if !collapsed}
            <span class="nav-label">{tab.label}</span>
          {/if}
        </button>
      {/each}
    </nav>
  {:else}
    <div class="lens-sidebar">
      <ProjectStrip />
      {#if !collapsed}
        <SessionPanel />
      {/if}
    </div>
  {/if}

  <!-- Settings (pinned above footer) -->
  <button
    class="nav-item settings-item"
    class:active={activeView === 'settings'}
    data-tooltip="Settings"
    onclick={() => handleTabClick('settings')}
    aria-label="Settings"
  >
    <svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    {#if !collapsed}
      <span class="nav-label">Settings</span>
    {/if}
  </button>

  <!-- Voice Status + Collapse Toggle -->
  <div class="sidebar-footer">
    <!-- Voice status -->
    <div class="voice-status">
      <div class="voice-dot {voiceIndicatorClass}"></div>
      {#if !collapsed}
        <span class="voice-label">
          {voiceState === 'recording' ? 'Recording' : voiceState === 'listening' ? 'Listening' : 'Idle'}
        </span>
      {/if}
    </div>

    <!-- Collapse/expand toggle -->
    <button
      class="collapse-btn"
      onclick={handleToggleSidebar}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="11 17 6 12 11 7"/>
        <polyline points="18 17 13 12 18 7"/>
      </svg>
      {#if !collapsed}
        <span>Collapse</span>
      {/if}
    </button>
  </div>
</aside>

<style>
  /* ========== Sidebar Container ========== */
  .sidebar {
    width: 200px;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-right: 1px solid var(--border);
    transition: width var(--duration-normal) var(--ease-out),
                min-width var(--duration-normal) var(--ease-out);
    overflow: hidden;
    user-select: none;
  }

  .sidebar.collapsed {
    width: 48px;
    min-width: 48px;
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }
  }

  /* ========== AI Status Indicator ========== */
  .sidebar-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
    min-height: 44px;
    position: relative;
  }

  .collapsed .sidebar-status {
    justify-content: center;
    padding: 12px 8px;
  }

  /* Tooltip for collapsed state */
  .collapsed .sidebar-status::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-left: 8px;
    padding: 6px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-out);
    z-index: 1000;
    box-shadow: var(--shadow-md);
  }

  .collapsed .sidebar-status:hover::after {
    opacity: 1;
  }

  /* Provider icon + status dot wrapper */
  .provider-icon-wrapper {
    position: relative;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }

  .sidebar-provider-icon {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .sidebar-provider-icon.placeholder {
    background: var(--bg-hover);
    border: 1px solid var(--border);
  }

  .sidebar-provider-icon-inner {
    width: 65%;
    height: 65%;
    object-fit: contain;
  }

  /* Status dot — overlaid on bottom-right of provider icon */
  .status-dot {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ef4444;
    border: 2px solid var(--bg-elevated);
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out),
                box-shadow var(--duration-fast) var(--ease-out);
  }

  .status-dot.running {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  }

  .status-dot.starting {
    background: #f59e0b;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
    animation: status-pulse 1s ease-in-out infinite;
  }

  @keyframes status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-provider {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .status-label {
    font-size: 11px;
    color: var(--muted);
    flex-shrink: 0;
  }

  .status-label.running {
    color: #22c55e;
  }

  .status-label.starting {
    color: #f59e0b;
  }

  /* ========== Lens Sidebar ========== */
  .lens-sidebar {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* ========== Chat List Section ========== */
  .sidebar-chat-section {
    border-bottom: 1px solid var(--border);
    max-height: 220px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ========== Navigation ========== */
  .sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 2px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    white-space: nowrap;
    width: 100%;
    text-align: left;
    position: relative;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .nav-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* nav-icon is now applied directly to the SVG element */

  .nav-label {
    opacity: 1;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  /* Collapsed nav items */
  .collapsed .sidebar-nav {
    padding: 4px;
  }

  .collapsed .nav-item {
    justify-content: center;
    padding: 10px 6px;
  }

  /* Tooltips for collapsed sidebar */
  .collapsed .nav-item::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-left: 8px;
    padding: 6px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-out);
    z-index: 1000;
    box-shadow: var(--shadow-md);
  }

  .collapsed .nav-item:hover::after {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-item,
    .nav-label,
    .status-dot {
      transition: none;
    }
  }

  /* ========== Settings (pinned to bottom) ========== */
  .settings-item {
    margin: 0 8px 0;
    width: calc(100% - 16px);
    flex-shrink: 0;
  }

  .collapsed .settings-item {
    margin: 0 4px 0;
    width: calc(100% - 8px);
  }

  /* ========== Footer ========== */
  .sidebar-footer {
    padding: 8px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .collapsed .sidebar-footer {
    padding: 4px;
  }

  /* ========== Voice Status ========== */
  .voice-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg);
    border-radius: var(--radius-md);
  }

  .collapsed .voice-status {
    justify-content: center;
    padding: 6px;
  }

  .voice-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out),
                box-shadow var(--duration-fast) var(--ease-out);
  }

  .voice-dot.listening {
    background: var(--ok);
    box-shadow: 0 0 8px var(--ok-glow);
    animation: voice-pulse 2s ease-in-out infinite;
  }

  .voice-dot.recording {
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger-glow);
    animation: voice-pulse 0.5s ease-in-out infinite;
  }

  @keyframes voice-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .voice-label {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-dot {
      animation: none;
      transition: none;
    }
  }

  /* ========== Collapse Button ========== */
  .collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 12px;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--font-family);
    transition: all var(--duration-fast) var(--ease-out);
    width: 100%;
  }

  .collapse-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
    border-color: var(--border-strong);
  }

  .collapse-btn svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .collapsed .collapse-btn svg {
    transform: rotate(180deg);
  }

  .collapse-btn span {
    opacity: 1;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .collapse-btn,
    .collapse-btn svg,
    .collapse-btn span {
      transition: none;
    }
  }
</style>
