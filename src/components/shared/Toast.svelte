<script>
  /**
   * Toast.svelte -- Single toast notification.
   *
   * Shows an icon, message, optional action button, and dismiss button.
   * Uses severity-based color tokens.
   *
   * Props:
   *   toast {{ id, message, severity, action }} - Toast data
   *   onDismiss {function} - Callback to dismiss this toast
   */
  import { fly } from 'svelte/transition';

  let { toast, onDismiss = () => {} } = $props();

  const severityClass = $derived(toast.severity || 'info');
</script>

<div
  class="toast {severityClass}"
  role="alert"
  aria-live="polite"
  transition:fly={{ x: 100, duration: 250 }}
>
  <!-- Severity icon -->
  <span class="toast-icon">
    {#if toast.severity === 'success'}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    {:else if toast.severity === 'warning'}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    {:else if toast.severity === 'error'}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    {/if}
  </span>

  <!-- Message -->
  <span class="toast-message">{toast.message}</span>

  <!-- Action button (optional) -->
  {#if toast.action}
    <button
      class="toast-action"
      onclick={() => {
        toast.action.callback();
        onDismiss(toast.id);
      }}
    >
      {toast.action.label}
    </button>
  {/if}

  <!-- Dismiss button -->
  <button
    class="toast-close"
    onclick={() => onDismiss(toast.id)}
    aria-label="Dismiss notification"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-size: 13px;
    pointer-events: auto;
    max-width: 380px;
    min-width: 200px;
  }

  /* Severity borders */
  .toast.info    { border-left: 3px solid var(--accent); }
  .toast.success { border-left: 3px solid var(--ok); }
  .toast.warning { border-left: 3px solid var(--warn); }
  .toast.error   { border-left: 3px solid var(--danger); }

  /* Icon colors */
  .toast-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .toast-icon svg {
    width: 16px;
    height: 16px;
  }

  .toast.info .toast-icon    { color: var(--accent); }
  .toast.success .toast-icon { color: var(--ok); }
  .toast.warning .toast-icon { color: var(--warn); }
  .toast.error .toast-icon   { color: var(--danger); }

  /* Message */
  .toast-message {
    flex: 1;
    line-height: 1.4;
  }

  /* Action button */
  .toast-action {
    background: var(--accent);
    color: var(--accent-contrast, white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .toast-action:hover {
    background: var(--accent-hover);
  }

  /* Close button */
  .toast-close {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: color var(--duration-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .toast-close:hover {
    color: var(--text-strong);
  }

  @media (prefers-reduced-motion: reduce) {
    .toast-action,
    .toast-close {
      transition: none;
    }
  }
</style>
