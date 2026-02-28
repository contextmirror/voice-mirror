<script>
  /**
   * StatusBar.svelte -- VS Code/Zed-style status bar.
   *
   * 22px tall bar at the bottom of the app, showing git branch, diagnostics,
   * dev server status, LSP health (left side) and cursor position, indentation,
   * encoding, EOL, language, notification bell (right side).
   */
  import { statusBarStore } from '../../lib/stores/status-bar.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';

  // -- Derived state --
  let hasProject = $derived(!!projectStore.activeProject?.path);
  let activeView = $derived(navigationStore.activeView);
  let showEditorInfo = $derived(statusBarStore.editorFocused && activeView === 'lens');

  // -- Notification panel --
  let notifPanelOpen = $state(false);

  function toggleNotifPanel(e) {
    e.stopPropagation();
    if (!notifPanelOpen) {
      statusBarStore.markAllRead();
    }
    notifPanelOpen = !notifPanelOpen;
  }

  function closeNotifPanel() {
    notifPanelOpen = false;
  }

  function handleDocumentClick() {
    if (notifPanelOpen) {
      closeNotifPanel();
    }
  }

  /**
   * Format a notification timestamp as relative time.
   * @param {number} ts - Epoch ms
   * @returns {string}
   */
  function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  // -- Reactive sync: diagnostics --
  $effect(() => {
    // Track the diagnostics map to trigger re-sync
    lspDiagnosticsStore.diagnostics;
    statusBarStore.updateDiagnostics();
  });

  // -- Reactive sync: dev server --
  $effect(() => {
    // Track server state to trigger re-sync
    devServerManager.servers;
    statusBarStore.updateDevServer();
  });

  // -- Polling lifecycle --
  $effect(() => {
    if (hasProject) {
      statusBarStore.startPolling();
      return () => {
        statusBarStore.stopPolling();
      };
    } else {
      statusBarStore.stopPolling();
    }
  });
</script>

<svelte:document onclick={handleDocumentClick} />

<footer class="status-bar">
  <!-- ════════ LEFT SIDE ════════ -->
  <div class="status-bar-left">
    {#if hasProject}
      <!-- L1: Git branch -->
      {#if statusBarStore.gitBranch}
        <button class="sb-item" title="Git branch">
          <svg class="sb-icon git-branch" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6.5a1.5 1.5 0 0 1-1.5 1.5H9a2.5 2.5 0 0 0-2.5 2.5v.878a2.25 2.25 0 1 1-1.5 0V4.872a2.25 2.25 0 1 1 1.5 0V6.5A4 4 0 0 1 9 5h2a0 0 0 0 0 0 0V5.372a2.25 2.25 0 0 1-1.5-2.122zM5.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/>
          </svg>
          <span>{statusBarStore.gitBranch}{#if statusBarStore.gitDirty}*{/if}</span>
        </button>
      {/if}

      <!-- L2: Diagnostics -->
      <button class="sb-item" title="Errors and Warnings">
        <span class="diag-errors" class:has-errors={statusBarStore.diagErrors > 0}>
          <svg class="sb-icon" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" stroke-width="1.5"/>
            <line x1="11" y1="5" x2="5" y2="11" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          {statusBarStore.diagErrors}
        </span>
        <span class="diag-warnings" class:has-warnings={statusBarStore.diagWarnings > 0}>
          <svg class="sb-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12zM8 5v4M8 11v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          {statusBarStore.diagWarnings}
        </span>
      </button>

      <!-- L3: Dev server -->
      {#if statusBarStore.devServerStatus && statusBarStore.devServerStatus !== 'stopped'}
        <button class="sb-item dev-server" title="Dev Server">
          {#if statusBarStore.devServerStatus === 'running' || statusBarStore.devServerStatus === 'idle'}
            <span class="dev-icon dev-running">&#9654;</span>
            <span>:{statusBarStore.devServerPort}</span>
          {:else if statusBarStore.devServerStatus === 'starting'}
            <span class="dev-icon dev-starting">&#9654;</span>
            <span>starting...</span>
          {:else if statusBarStore.devServerStatus === 'crashed'}
            <span class="dev-icon dev-crashed">&#9632;</span>
            <span>crashed</span>
          {/if}
        </button>
      {/if}

      <!-- L4: LSP health -->
      {#if statusBarStore.lspHealth !== 'none'}
        <button class="sb-item lsp-status" title="LSP Status: {statusBarStore.lspHealth}">
          <svg class="sb-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2l2 5-2 5M7 2l2 5-2 5M11 2l2 5-2 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span
            class="lsp-dot"
            class:lsp-healthy={statusBarStore.lspHealth === 'healthy'}
            class:lsp-starting={statusBarStore.lspHealth === 'starting'}
            class:lsp-error={statusBarStore.lspHealth === 'error'}
          ></span>
        </button>
      {/if}
    {/if}
  </div>

  <!-- ════════ RIGHT SIDE ════════ -->
  <div class="status-bar-right">
    {#if showEditorInfo}
      <!-- R1: Cursor position (click → Go to Line dialog) -->
      <button class="sb-item sb-clickable" title="Go to Line"
        onclick={() => window.dispatchEvent(new CustomEvent('status-bar-go-to-line'))}>
        <span>Ln {statusBarStore.cursor.line}, Col {statusBarStore.cursor.col}</span>
      </button>

      <!-- R2: Indentation -->
      <button class="sb-item" title="Indentation">
        <span>
          {#if statusBarStore.indent.type === 'tabs'}
            Tabs: {statusBarStore.indent.size}
          {:else}
            Spaces: {statusBarStore.indent.size}
          {/if}
        </span>
      </button>

      <!-- R3: Encoding -->
      <button class="sb-item" title="Encoding">
        <span>{statusBarStore.encoding}</span>
      </button>

      <!-- R4: EOL -->
      <button class="sb-item" title="End of Line">
        <span>{statusBarStore.eol}</span>
      </button>

      <!-- R5: Language -->
      {#if statusBarStore.language}
        <button class="sb-item" title="Language Mode">
          <span>{statusBarStore.language}</span>
        </button>
      {/if}
    {/if}

    <!-- R6: Notification bell (always visible) -->
    <div class="bell-anchor">
      <button
        class="sb-item bell-btn"
        title="Notifications"
        onclick={toggleNotifPanel}
        aria-label="Notifications"
        aria-expanded={notifPanelOpen}
      >
        <svg class="sb-icon bell-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5c0 3.5-1.5 4.5-1.5 4.5h10s-1.5-1-1.5-4.5A3.5 3.5 0 0 0 8 1.5z"/>
          <path d="M6.5 12a1.5 1.5 0 0 0 3 0"/>
        </svg>
        {#if statusBarStore.unreadCount > 0}
          <span class="badge">{statusBarStore.unreadCount}</span>
        {/if}
      </button>

      <!-- Notification panel dropdown -->
      {#if notifPanelOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="notif-panel" onclick={(e) => e.stopPropagation()}>
          <div class="notif-header">
            <span class="notif-title">Notifications</span>
            {#if statusBarStore.notifications.length > 0}
              <button class="notif-clear" onclick={() => statusBarStore.clearAllNotifications()}>
                Clear All
              </button>
            {/if}
          </div>
          <div class="notif-list">
            {#if statusBarStore.notifications.length === 0}
              <div class="notif-empty">No notifications</div>
            {:else}
              {#each statusBarStore.notifications as notif (notif.id)}
                <div class="notif-item" class:unread={!notif.read}>
                  <div class="notif-content">
                    <span class="notif-message">{notif.message}</span>
                    <span class="notif-time">{formatTime(notif.timestamp)}</span>
                  </div>
                  <button
                    class="notif-dismiss"
                    onclick={() => statusBarStore.dismissNotification(notif.id)}
                    aria-label="Dismiss notification"
                    title="Dismiss"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <line x1="4" y1="4" x2="12" y2="12"/>
                      <line x1="12" y1="4" x2="4" y2="12"/>
                    </svg>
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</footer>

<style>
  /* ========== Status Bar Container ========== */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    min-height: 22px;
    flex-shrink: 0;
    padding: 0 4px;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    font-size: 12px;
    font-family: var(--font-family);
    color: var(--muted);
    user-select: none;
    -webkit-app-region: no-drag;
    z-index: 100;
    position: relative;
  }

  /* ========== Left / Right Sections ========== */
  .status-bar-left,
  .status-bar-right {
    display: flex;
    align-items: center;
    gap: 0;
    height: 100%;
  }

  /* ========== Status Bar Items ========== */
  .sb-item {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 100%;
    padding: 0 5px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    transition: color var(--duration-fast, 100ms), background var(--duration-fast, 100ms);
    line-height: 1;
  }

  .sb-item:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .sb-clickable {
    cursor: pointer;
  }

  /* ========== Icons ========== */
  .sb-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  /* ========== L1: Git Branch ========== */
  .git-branch {
    width: 12px;
    height: 12px;
  }

  /* ========== L2: Diagnostics ========== */
  .diag-errors,
  .diag-warnings {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .diag-errors.has-errors {
    color: var(--danger);
  }

  .diag-warnings.has-warnings {
    color: var(--warn);
  }

  /* ========== L3: Dev Server ========== */
  .dev-icon {
    font-size: 10px;
    line-height: 1;
  }

  .dev-running {
    color: var(--ok);
  }

  .dev-starting {
    color: var(--warn);
  }

  .dev-crashed {
    color: var(--danger);
  }

  /* ========== L4: LSP Health ========== */
  .lsp-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
  }

  .lsp-dot.lsp-healthy {
    background: var(--ok);
  }

  .lsp-dot.lsp-starting {
    background: var(--warn);
  }

  .lsp-dot.lsp-error {
    background: var(--danger);
  }

  /* ========== R6: Bell ========== */
  .bell-anchor {
    position: relative;
    height: 100%;
  }

  .bell-btn {
    position: relative;
  }

  .bell-icon {
    width: 13px;
    height: 13px;
  }

  .badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    line-height: 14px;
    text-align: center;
    pointer-events: none;
  }

  /* ========== Notification Panel ========== */
  .notif-panel {
    position: absolute;
    bottom: 100%;
    right: 0;
    width: 320px;
    max-height: 360px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 6px);
    box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.3));
    z-index: 10002;
    display: flex;
    flex-direction: column;
    animation: notif-in 0.12s ease-out;
  }

  @keyframes notif-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .notif-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .notif-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .notif-clear {
    border: none;
    background: none;
    color: var(--accent);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }

  .notif-clear:hover {
    background: var(--bg-hover);
  }

  .notif-list {
    overflow-y: auto;
    flex: 1;
    max-height: 300px;
  }

  .notif-empty {
    padding: 20px 12px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }

  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    transition: background var(--duration-fast, 100ms);
  }

  .notif-item:last-child {
    border-bottom: none;
  }

  .notif-item:hover {
    background: var(--bg-hover);
  }

  .notif-item.unread {
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.05);
  }

  .notif-content {
    flex: 1;
    min-width: 0;
  }

  .notif-message {
    display: block;
    font-size: 12px;
    color: var(--text);
    word-break: break-word;
  }

  .notif-time {
    display: block;
    font-size: 10px;
    color: var(--muted);
    margin-top: 2px;
  }

  .notif-dismiss {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: opacity var(--duration-fast, 100ms);
  }

  .notif-item:hover .notif-dismiss {
    opacity: 1;
  }

  .notif-dismiss:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .notif-dismiss svg {
    width: 10px;
    height: 10px;
  }

  @media (prefers-reduced-motion: reduce) {
    .notif-panel {
      animation: none;
    }
  }
</style>
