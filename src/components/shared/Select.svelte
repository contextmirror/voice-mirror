<script>
  /**
   * Select.svelte -- Dropdown select.
   *
   * Props:
   *   value {string} - Currently selected value
   *   options {Array<{value: string, label: string, group?: string}>} - Options list
   *   onChange {function} - Callback when selection changes, receives new value
   *   label {string} - Label text
   *   disabled {boolean} - Whether the select is disabled
   */
  let {
    value = '',
    options = [],
    onChange = () => {},
    label = '',
    disabled = false,
  } = $props();

  const inputId = $derived(`select-${label.toLowerCase().replace(/\s+/g, '-')}`);

  /** Group options by their `group` field if present */
  const grouped = $derived.by(() => {
    const hasGroups = options.some(opt => opt.group);
    if (!hasGroups) return null;
    const map = new Map();
    for (const opt of options) {
      const key = opt.group || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(opt);
    }
    return map;
  });

  function handleChange(e) {
    onChange(e.target.value);
  }
</script>

<div class="select-row">
  {#if label}
    <label class="select-label" for={inputId}>{label}</label>
  {/if}
  <select
    class="select-input"
    id={inputId}
    {value}
    {disabled}
    onchange={handleChange}
  >
    {#if grouped}
      {#each [...grouped.entries()] as [groupName, groupOptions]}
        {#if groupName}
          <optgroup label={groupName}>
            {#each groupOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </optgroup>
        {:else}
          {#each groupOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        {/if}
      {/each}
    {:else}
      {#each options as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    {/if}
  </select>
</div>

<style>
  .select-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .select-label {
    color: var(--text);
    font-size: 14px;
    white-space: nowrap;
  }

  .select-input {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    padding: 8px 12px;
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    min-width: 160px;
    transition: border-color var(--duration-fast) var(--ease-in-out);
  }

  .select-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .select-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .select-input option {
    background: var(--bg-elevated);
    color: var(--text-strong);
  }

  .select-input optgroup {
    background: var(--bg-elevated);
    color: var(--muted);
    font-style: normal;
    font-size: 12px;
    font-weight: 600;
  }

  @media (prefers-reduced-motion: reduce) {
    .select-input {
      transition: none;
    }
  }
</style>
