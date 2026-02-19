<script>
  /**
   * TextInput.svelte -- Text input field.
   *
   * Props:
   *   value {string} - Current value
   *   placeholder {string} - Placeholder text
   *   onChange {function} - Callback when value changes, receives new string value
   *   label {string} - Label text
   *   type {'text'|'password'|'url'|'email'} - Input type
   *   disabled {boolean} - Whether the input is disabled
   *   readonly {boolean} - Whether the input is readonly
   */
  let {
    value = '',
    placeholder = '',
    onChange = () => {},
    label = '',
    type = 'text',
    disabled = false,
    readonly = false,
  } = $props();

  const inputId = $derived(`text-${label.toLowerCase().replace(/\s+/g, '-')}`);

  function handleInput(e) {
    onChange(e.target.value);
  }
</script>

<div class="text-input-row">
  {#if label}
    <label class="text-input-label" for={inputId}>{label}</label>
  {/if}
  <input
    class="text-input"
    id={inputId}
    {type}
    {value}
    {placeholder}
    {disabled}
    {readonly}
    oninput={handleInput}
  />
</div>

<style>
  .text-input-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .text-input-label {
    color: var(--text);
    font-size: 14px;
    white-space: nowrap;
  }

  .text-input {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    padding: 8px 12px;
    font-size: 13px;
    font-family: var(--font-family);
    min-width: 200px;
    transition: border-color var(--duration-fast) var(--ease-in-out);
  }

  .text-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .text-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .text-input::placeholder {
    color: var(--muted);
  }

  .text-input[readonly] {
    cursor: default;
    background: var(--bg);
  }

  @media (prefers-reduced-motion: reduce) {
    .text-input {
      transition: none;
    }
  }
</style>
