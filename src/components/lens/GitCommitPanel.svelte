<script>
  import { gitCommit, gitPush, generateCommitMessage } from '../../lib/api.js';

  let { branch = '', stagedCount = 0, onCommit = () => {}, root = null } = $props();

  let message = $state('');
  let committing = $state(false);
  let pushing = $state(false);
  let generating = $state(false);
  let error = $state('');
  let success = $state('');

  function clearError() { error = ''; }
  function clearSuccess() { success = ''; }

  async function handleGenerateMessage() {
    if (stagedCount === 0 || generating) return;
    clearError();
    generating = true;
    try {
      const resp = await generateCommitMessage(root);
      if (resp && resp.data && resp.data.message) {
        message = resp.data.message;
      } else if (resp && resp.error) {
        error = resp.error;
      }
    } catch (err) {
      error = typeof err === 'string' ? err : (err.message || 'Failed to generate commit message');
    } finally {
      generating = false;
    }
  }

  async function handleCommit() {
    if (!message.trim() || stagedCount === 0 || committing) return;
    clearError();
    clearSuccess();
    committing = true;
    try {
      const resp = await gitCommit(message.trim(), root);
      if (resp && resp.ok) {
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
      if (resp && resp.ok) {
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
</script>

<div class="commit-panel">
  {#if branch}
    <div class="branch-label" title={branch}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
      <span class="branch-name">{branch}</span>
    </div>
  {/if}

  <div class="commit-input-row">
    <textarea
      class="commit-textarea"
      placeholder="Commit message..."
      rows="2"
      bind:value={message}
      onkeydown={handleKeydown}
      disabled={committing || pushing}
    ></textarea>
    <button
      class="ai-button"
      title="Generate commit message with AI"
      onclick={handleGenerateMessage}
      disabled={stagedCount === 0 || generating}
    >
      {#if generating}
        <span class="spinner"></span>
      {:else}
        <span class="ai-sparkle">&#10024;</span>
      {/if}
    </button>
  </div>

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
  }
  .branch-label svg {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .branch-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-input-row {
    display: flex;
    gap: 4px;
    align-items: flex-start;
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

  .ai-button {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border, color-mix(in srgb, var(--muted) 30%, transparent));
    background: var(--bg-elevated);
    color: var(--muted);
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    -webkit-app-region: no-drag;
    transition: color 0.15s, border-color 0.15s;
  }
  .ai-button:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .ai-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ai-sparkle {
    line-height: 1;
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

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
