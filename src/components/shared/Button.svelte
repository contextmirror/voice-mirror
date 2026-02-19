<script>
  /**
   * Button.svelte -- Styled button.
   *
   * Props:
   *   variant {'primary'|'secondary'|'danger'} - Visual style
   *   disabled {boolean} - Whether the button is disabled
   *   onClick {function} - Click handler
   *   type {string} - Button type attribute
   *   small {boolean} - Compact size variant
   */
  let {
    variant = 'secondary',
    disabled = false,
    onClick = () => {},
    type = 'button',
    small = false,
    children,
  } = $props();
</script>

<button
  class="btn btn-{variant}"
  class:small
  {type}
  {disabled}
  onclick={onClick}
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
    transition:
      background var(--duration-fast) var(--ease-in-out),
      transform var(--duration-fast) var(--ease-out),
      filter var(--duration-fast) var(--ease-in-out);
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    filter: none !important;
  }

  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Primary */
  .btn-primary {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
    color: var(--accent-contrast, #fff);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(0);
    filter: brightness(0.95);
  }

  /* Secondary */
  .btn-secondary {
    background: var(--bg-hover);
    color: var(--text);
    border: 1px solid var(--border-strong);
  }

  .btn-secondary:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text-strong);
  }

  .btn-secondary:active:not(:disabled) {
    background: var(--bg-elevated);
  }

  /* Danger */
  .btn-danger {
    background: var(--danger-subtle);
    color: var(--danger);
    border: 1px solid var(--danger);
  }

  .btn-danger:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-danger:active:not(:disabled) {
    filter: brightness(0.95);
  }

  /* Small variant */
  .btn.small {
    padding: 6px 14px;
    font-size: 12px;
    border-radius: var(--radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;
    }
  }
</style>
