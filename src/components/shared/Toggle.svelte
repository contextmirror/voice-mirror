<script>
  /**
   * Toggle.svelte -- On/off toggle switch.
   *
   * Props:
   *   checked {boolean} - Current toggle state
   *   onChange {function} - Callback when toggled, receives new boolean value
   *   label {string} - Label text
   *   description {string} - Optional description text below the label
   *   disabled {boolean} - Whether the toggle is disabled
   */
  let {
    checked = false,
    onChange = () => {},
    label = '',
    description = '',
    disabled = false,
  } = $props();

  function handleChange(e) {
    if (!disabled) {
      onChange(e.target.checked);
    }
  }
</script>

<label class="toggle-row" class:disabled>
  <div class="toggle-label-group">
    {#if label}
      <span class="toggle-label">{label}</span>
    {/if}
    {#if description}
      <span class="toggle-description">{description}</span>
    {/if}
  </div>
  <div class="toggle-switch">
    <input
      type="checkbox"
      {checked}
      {disabled}
      onchange={handleChange}
    />
    <span class="toggle-track"></span>
  </div>
</label>

<style>
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-in-out);
    gap: 16px;
  }

  .toggle-row:hover {
    background: var(--card-highlight);
  }

  .toggle-row.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .toggle-label {
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
  }

  .toggle-description {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.3;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  .toggle-track {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: var(--border-strong);
    border-radius: 24px;
    transition: background var(--duration-normal) var(--ease-in-out);
  }

  .toggle-track::before {
    content: '';
    position: absolute;
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background: var(--text-strong);
    border-radius: 50%;
    transition: transform var(--duration-normal) var(--ease-in-out);
  }

  .toggle-switch input:checked + .toggle-track {
    background: var(--accent);
  }

  .toggle-switch input:checked + .toggle-track::before {
    transform: translateX(20px);
  }

  .toggle-switch input:focus-visible + .toggle-track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .toggle-track,
    .toggle-track::before,
    .toggle-row {
      transition: none;
    }
  }
</style>
