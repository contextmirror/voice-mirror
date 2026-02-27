<script>
  import { gitCommit, gitPush, gitFetch, gitPull, gitForcePush, gitListBranches, gitCheckoutBranch } from '../../lib/api.js';

  let { branch = '', stagedCount = 0, onCommit = () => {}, root = null } = $props();

  let message = $state('');
  let committing = $state(false);
  let pushing = $state(false);
  let error = $state('');
  let success = $state('');

  // Branch picker state
  let branchDropdown = $state(false);
  let branches = $state([]);
  let branchFilter = $state('');
  let loadingBranches = $state(false);
  let switching = $state(false);
  let branchBtnEl = $state(null);
  let dropdownPos = $state({ x: 0, y: 0 });

  // Fetch dropdown state
  let fetchDropdown = $state(false);
  let fetchBtnEl = $state(null);
  let fetchDropdownPos = $state({ x: 0, y: 0 });
  let remoteOp = $state(''); // 'fetch' | 'pull' | 'pull-rebase' | 'push' | 'force-push'

  function clearError() { error = ''; }
  function clearSuccess() { success = ''; }

  async function handleCommit() {
    if (!message.trim() || stagedCount === 0 || committing) return;
    clearError();
    clearSuccess();
    committing = true;
    try {
      const resp = await gitCommit(message.trim(), root);
      if (resp && resp.success) {
        const hash = resp.data?.hash || '';
        success = hash ? `Committed ${hash.slice(0, 7)}` : 'Committed';
        message = '';
        onCommit?.();
        setTimeout(clearSuccess, 3000);
      } else if (resp && resp.error) {
        error = resp.error;
      }
    } catch (err) {
      error = typeof err === 'string' ? err : (err.message || 'Commit failed');
    } finally {
      committing = false;
    }
  }

  async function handleCommitAndPush() {
    if (!message.trim() || stagedCount === 0 || committing || pushing) return;
    clearError();
    clearSuccess();
    pushing = true;
    committing = true;
    try {
      const resp = await gitCommit(message.trim(), root);
      if (resp && resp.success) {
        const hash = resp.data?.hash || '';
        message = '';
        onCommit?.();
        try {
          await gitPush(root);
          success = hash ? `Committed ${hash.slice(0, 7)} & pushed` : 'Committed & pushed';
        } catch (pushErr) {
          success = hash ? `Committed ${hash.slice(0, 7)}` : 'Committed';
          error = typeof pushErr === 'string' ? pushErr : (pushErr.message || 'Push failed');
        }
        setTimeout(clearSuccess, 3000);
      } else if (resp && resp.error) {
        error = resp.error;
      }
    } catch (err) {
      error = typeof err === 'string' ? err : (err.message || 'Commit failed');
    } finally {
      committing = false;
      pushing = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCommit();
    }
  }

  async function toggleBranchDropdown() {
    if (branchDropdown) {
      closeBranchDropdown();
      return;
    }
    if (branchBtnEl) {
      const rect = branchBtnEl.getBoundingClientRect();
      dropdownPos = { x: rect.left, y: rect.bottom + 4 };
    }
    branchDropdown = true;
    branchFilter = '';
    loadingBranches = true;
    try {
      const resp = await gitListBranches(root);
      if (resp?.success && resp.data?.branches) {
        branches = resp.data.branches;
      }
    } catch (err) {
      console.warn('[GitCommitPanel] Failed to list branches:', err);
    } finally {
      loadingBranches = false;
    }
  }

  function closeBranchDropdown() {
    branchDropdown = false;
    branchFilter = '';
  }

  async function handleSwitchBranch(branchName) {
    if (switching) return;
    // Warn user — switching branches while dev server runs causes hot-reload crash
    const confirmed = window.confirm(
      `Switch to "${branchName}"?\n\nThis will change files on disk. If a dev server is running, it may crash and need to be restarted.`
    );
    if (!confirmed) return;
    closeBranchDropdown();
    switching = true;
    clearError();
    try {
      const resp = await gitCheckoutBranch(branchName, root);
      if (resp?.success) {
        onCommit?.(); // Triggers a git status refresh
      } else if (resp?.error) {
        error = resp.error;
      }
    } catch (err) {
      error = typeof err === 'string' ? err : (err.message || 'Branch switch failed');
    } finally {
      switching = false;
    }
  }

  let filteredBranches = $derived(
    branchFilter.trim()
      ? branches.filter(b => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
      : branches
  );

  // ── Fetch / Push dropdown ──
  function toggleFetchDropdown() {
    if (fetchDropdown) {
      closeFetchDropdown();
      return;
    }
    if (fetchBtnEl) {
      const rect = fetchBtnEl.getBoundingClientRect();
      fetchDropdownPos = { x: rect.left, y: rect.bottom + 4 };
    }
    fetchDropdown = true;
  }

  function closeFetchDropdown() {
    fetchDropdown = false;
  }

  async function handleRemoteOp(op) {
    closeFetchDropdown();
    if (remoteOp) return;
    clearError();
    clearSuccess();
    remoteOp = op;
    try {
      let resp;
      switch (op) {
        case 'fetch':
          resp = await gitFetch(root);
          if (resp?.success) { success = 'Fetched'; onCommit?.(); }
          else if (resp?.error) error = resp.error;
          break;
        case 'pull':
          resp = await gitPull(false, root);
          if (resp?.success) { success = resp.data?.message || 'Pulled'; onCommit?.(); }
          else if (resp?.error) error = resp.error;
          break;
        case 'pull-rebase':
          resp = await gitPull(true, root);
          if (resp?.success) { success = resp.data?.message || 'Pulled (rebase)'; onCommit?.(); }
          else if (resp?.error) error = resp.error;
          break;
        case 'push':
          resp = await gitPush(root);
          if (resp?.success) { success = 'Pushed'; }
          else if (resp?.error) error = resp.error;
          break;
        case 'force-push':
          if (!window.confirm('Force push? This will overwrite remote history and cannot be undone.')) break;
          resp = await gitForcePush(root);
          if (resp?.success) { success = 'Force pushed'; }
          else if (resp?.error) error = resp.error;
          break;
      }
      if (success) setTimeout(clearSuccess, 3000);
    } catch (err) {
      error = typeof err === 'string' ? err : (err.message || `${op} failed`);
    } finally {
      remoteOp = '';
    }
  }
</script>

<div class="commit-panel">
  {#if branch}
    <div class="branch-row">
      <button
        class="branch-label"
        title="Switch branch"
        bind:this={branchBtnEl}
        onclick={toggleBranchDropdown}
        disabled={switching}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
        <span class="branch-name">{branch}</span>
        {#if switching}
          <span class="spinner small"></span>
        {:else}
          <svg class="chevron" class:open={branchDropdown} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        {/if}
      </button>
      <button
        class="fetch-btn"
        title="Fetch / Pull / Push"
        bind:this={fetchBtnEl}
        onclick={toggleFetchDropdown}
        disabled={!!remoteOp}
      >
        {#if remoteOp}
          <span class="spinner small"></span>
          <span class="fetch-label">{remoteOp === 'pull-rebase' ? 'Pull' : remoteOp.charAt(0).toUpperCase() + remoteOp.slice(1)}...</span>
        {:else}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
          <span class="fetch-label">Fetch</span>
          <svg class="chevron" class:open={fetchDropdown} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        {/if}
      </button>
    </div>
  {/if}

  <textarea
    class="commit-textarea"
    placeholder="Commit message..."
    rows="2"
    bind:value={message}
    onkeydown={handleKeydown}
    disabled={committing || pushing}
  ></textarea>

  {#if stagedCount === 0}
    <div class="stage-hint">Stage files to commit</div>
  {/if}

  <div class="commit-actions">
    <button
      class="commit-btn primary"
      onclick={handleCommit}
      disabled={!message.trim() || stagedCount === 0 || committing || pushing}
    >
      {#if committing && !pushing}
        <span class="spinner"></span>
      {/if}
      Commit
    </button>
    <button
      class="commit-btn secondary"
      onclick={handleCommitAndPush}
      disabled={!message.trim() || stagedCount === 0 || committing || pushing}
    >
      {#if pushing}
        <span class="spinner"></span>
      {/if}
      Commit & Push
    </button>
  </div>

  {#if success}
    <div class="commit-success">{success}</div>
  {/if}
  {#if error}
    <div class="commit-error">{error}</div>
  {/if}
</div>

{#if branchDropdown}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="branch-backdrop" onclick={closeBranchDropdown}></div>
  <div class="branch-dropdown" style="left: {dropdownPos.x}px; top: {dropdownPos.y}px;">
    <div class="branch-search-row">
      <input
        class="branch-search"
        type="text"
        placeholder="Filter branches..."
        bind:value={branchFilter}
        autofocus
        onkeydown={(e) => {
          if (e.key === 'Escape') closeBranchDropdown();
          if (e.key === 'Enter' && filteredBranches.length === 1) {
            handleSwitchBranch(filteredBranches[0].name);
          }
        }}
      />
    </div>
    <div class="branch-list">
      {#if loadingBranches}
        <div class="branch-loading">Loading branches...</div>
      {:else if filteredBranches.length === 0}
        <div class="branch-loading">No branches found</div>
      {:else}
        {#each filteredBranches as b (b.name)}
          <button
            class="branch-item"
            class:current={b.isCurrent}
            class:remote={b.isRemote}
            onclick={() => b.isCurrent ? closeBranchDropdown() : handleSwitchBranch(b.name)}
            disabled={b.isCurrent}
          >
            {#if b.isRemote}
              <svg class="branch-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            {:else}
              <svg class="branch-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            {/if}
            <span class="branch-item-name">{b.name}</span>
            {#if b.isCurrent}
              <svg class="branch-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

{#if fetchDropdown}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="branch-backdrop" onclick={closeFetchDropdown}></div>
  <div class="fetch-dropdown" style="left: {fetchDropdownPos.x}px; top: {fetchDropdownPos.y}px;">
    <button class="fetch-menu-item" onclick={() => handleRemoteOp('fetch')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
      <span>Fetch</span>
    </button>
    <button class="fetch-menu-item" onclick={() => handleRemoteOp('pull')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
      <span>Pull</span>
    </button>
    <button class="fetch-menu-item" onclick={() => handleRemoteOp('pull-rebase')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
      <span>Pull (Rebase)</span>
    </button>
    <div class="fetch-menu-separator"></div>
    <button class="fetch-menu-item" onclick={() => handleRemoteOp('push')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
      <span>Push</span>
    </button>
    <button class="fetch-menu-item danger" onclick={() => handleRemoteOp('force-push')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
      <span>Force Push</span>
    </button>
  </div>
{/if}

<style>
  .commit-panel {
    padding: 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    -webkit-app-region: no-drag;
  }

  .branch-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px 2px 2px;
    border-radius: 4px;
    font-family: var(--font-family);
    transition: background 0.12s, color 0.12s;
  }
  .branch-label:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }
  .branch-label:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .branch-label svg:first-child {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .branch-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chevron {
    flex-shrink: 0;
    opacity: 0.5;
    transition: transform 0.15s ease;
  }
  .chevron.open {
    transform: rotate(180deg);
  }

  .branch-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .fetch-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
    background: none;
    border: 1px solid var(--border, color-mix(in srgb, var(--muted) 30%, transparent));
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-family);
    transition: background 0.12s, color 0.12s;
    white-space: nowrap;
    -webkit-app-region: no-drag;
  }
  .fetch-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }
  .fetch-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .fetch-label {
    font-size: 11px;
  }

  .commit-textarea {
    flex: 1;
    min-height: 40px;
    max-height: 120px;
    resize: vertical;
    padding: 6px 8px;
    font-size: 12px;
    font-family: var(--font-mono);
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--border, color-mix(in srgb, var(--muted) 30%, transparent));
    border-radius: 4px;
    outline: none;
    -webkit-app-region: no-drag;
  }
  .commit-textarea:focus {
    border-color: var(--accent);
  }
  .commit-textarea::placeholder {
    color: var(--muted);
  }

  .stage-hint {
    font-size: 11px;
    color: var(--muted);
    text-align: center;
    padding: 2px 0;
  }

  .commit-actions {
    display: flex;
    gap: 4px;
  }

  .commit-btn {
    flex: 1;
    padding: 5px 10px;
    font-size: 12px;
    font-family: var(--font-mono);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    -webkit-app-region: no-drag;
    transition: opacity 0.15s;
  }
  .commit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .commit-btn.primary {
    background: var(--accent);
    color: var(--bg);
  }
  .commit-btn.primary:hover:not(:disabled) {
    opacity: 0.85;
  }
  .commit-btn.secondary {
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--border, color-mix(in srgb, var(--muted) 30%, transparent));
  }
  .commit-btn.secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bg-elevated) 80%, var(--accent));
  }

  .commit-success {
    font-size: 11px;
    color: var(--ok);
    padding: 2px 0;
  }

  .commit-error {
    font-size: 11px;
    color: var(--danger);
    padding: 2px 0;
    word-break: break-word;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  .spinner.small {
    width: 10px;
    height: 10px;
    border-width: 1.5px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Branch dropdown ── */
  .branch-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10001;
  }

  .branch-dropdown {
    position: fixed;
    z-index: 10002;
    width: 260px;
    max-height: 320px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
    display: flex;
    flex-direction: column;
  }

  .branch-search-row {
    padding: 6px;
    border-bottom: 1px solid var(--border);
  }

  .branch-search {
    width: 100%;
    padding: 5px 8px;
    font-size: 12px;
    font-family: var(--font-mono);
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    outline: none;
    box-sizing: border-box;
  }
  .branch-search:focus {
    border-color: var(--accent);
  }
  .branch-search::placeholder {
    color: var(--muted);
  }

  .branch-list {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }

  .branch-loading {
    padding: 12px;
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    -webkit-app-region: no-drag;
  }
  .branch-item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
  .branch-item:hover:not(:disabled) .branch-icon {
    opacity: 1;
  }
  .branch-item:disabled {
    cursor: default;
  }
  .branch-item.current {
    color: var(--accent);
  }
  .branch-item.remote .branch-item-name {
    opacity: 0.7;
  }

  .branch-icon {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .branch-item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-check {
    flex-shrink: 0;
    color: var(--accent);
  }

  /* ── Fetch dropdown ── */
  .fetch-dropdown {
    position: fixed;
    z-index: 10002;
    width: 180px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
    padding: 4px 0;
  }

  .fetch-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    -webkit-app-region: no-drag;
  }
  .fetch-menu-item:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .fetch-menu-item.danger {
    color: var(--danger);
  }
  .fetch-menu-item.danger:hover {
    background: var(--danger);
    color: var(--bg);
  }

  .fetch-menu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 8px;
  }
</style>
