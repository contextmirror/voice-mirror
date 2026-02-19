<script>
  /**
   * ErrorState.svelte -- Error display with icon, message, and optional retry.
   *
   * Props:
   *   message {string} - Error message to display
   *   onRetry {function|null} - Optional callback for retry button
   *   compact {boolean} - Compact layout (default: false)
   */
  import { fly } from 'svelte/transition';

  let {
    message = 'Something went wrong.',
    onRetry = null,
    compact = false,
  } = $props();
</script>

<div
  class="error-state"
  class:compact
  transition:fly={{ y: 8, duration: 200 }}
  role="alert"
>
  <div class="error-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  </div>

  <p class="error-message">{message}</p>

  {#if onRetry}
    <button class="retry-btn" onclick={onRetry}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
      Retry
    </button>
  {/if}
</div>

<style>
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px 24px;
    text-align: center;
  }

  .error-state.compact {
    padding: 16px 12px;
    gap: 8px;
  }

  .error-icon {
    color: var(--danger);
    opacity: 0.8;
  }

  .error-icon svg {
    width: 36px;
    height: 36px;
  }

  .compact .error-icon svg {
    width: 24px;
    height: 24px;
  }

  .error-message {
    color: var(--danger);
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
    max-width: 300px;
  }

  .compact .error-message {
    font-size: 12px;
    max-width: none;
  }

  .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--danger);
    background: var(--danger-subtle);
    color: var(--danger);
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .retry-btn:hover {
    filter: brightness(1.1);
    background: var(--danger);
    color: var(--text-strong);
  }

  .retry-btn:focus-visible {
    outline: 2px solid var(--danger);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .retry-btn {
      transition: none;
    }
  }
</style>
