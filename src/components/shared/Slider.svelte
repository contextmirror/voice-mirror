<script>
  /**
   * Slider.svelte -- Range slider input.
   *
   * Props:
   *   value {number} - Current value
   *   min {number} - Minimum value
   *   max {number} - Maximum value
   *   step {number} - Step increment
   *   onChange {function} - Callback when value changes, receives new number value
   *   label {string} - Label text
   *   formatValue {function} - Optional formatter for displayed value
   *   disabled {boolean} - Whether the slider is disabled
   */
  let {
    value = 0,
    min = 0,
    max = 100,
    step = 1,
    onChange = () => {},
    label = '',
    formatValue = (v) => String(v),
    disabled = false,
  } = $props();

  const inputId = $derived(`slider-${label.toLowerCase().replace(/\s+/g, '-')}`);
  const displayValue = $derived(formatValue(value));

  function handleInput(e) {
    const newValue = parseFloat(e.target.value);
    onChange(newValue);
  }
</script>

<div class="slider-row">
  {#if label}
    <label class="slider-label" for={inputId}>{label}</label>
  {/if}
  <div class="slider-control">
    <input
      type="range"
      class="slider-input"
      id={inputId}
      {value}
      {min}
      {max}
      {step}
      {disabled}
      oninput={handleInput}
    />
    <span class="slider-value">{displayValue}</span>
  </div>
</div>

<style>
  .slider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .slider-label {
    color: var(--text);
    font-size: 14px;
    white-space: nowrap;
  }

  .slider-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider-input {
    width: 120px;
    height: 4px;
    background: var(--border-strong);
    border-radius: 2px;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    border: none;
    padding: 0;
    outline: none;
  }

  .slider-input::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    background: var(--accent);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .slider-input::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--accent);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .slider-input:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .slider-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .slider-value {
    color: var(--muted);
    font-size: 12px;
    min-width: 44px;
    text-align: right;
    font-family: var(--font-mono);
  }

  @media (prefers-reduced-motion: reduce) {
    .slider-input::-webkit-slider-thumb {
      transition: none;
    }
  }
</style>
