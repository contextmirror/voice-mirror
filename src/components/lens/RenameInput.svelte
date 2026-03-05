<script>
  import { applySmartPosition } from '$lib/smart-position.js';

  let {
    visible = false,
    x = 0,
    above = 0,
    below = 0,
    currentName = '',
    onConfirm = () => {},
    onCancel = () => {},
  } = $props();

  let inputValue = $state('');
  let renameEl = $state(null);

  $effect(() => {
    if (visible) {
      inputValue = currentName;
    }
  });

  // Smart positioning: prefer below (VS Code default), flip above if no room
  $effect(() => {
    if (visible && renameEl) {
      applySmartPosition(renameEl, { above, below }, { prefer: 'below', x });
    }
  });

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim() && inputValue !== currentName) {
        onConfirm(inputValue.trim());
      } else {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  function handleBlur() {
    onCancel();
  }

  function autofocus(node) {
    node.focus();
    node.select();
  }
</script>

{#if visible}
  <div class="rename-input" bind:this={renameEl}>
    <input
      type="text"
      bind:value={inputValue}
      onkeydown={handleKeydown}
      onblur={handleBlur}
      use:autofocus
    />
  </div>
{/if}

<style>
  .rename-input {
    position: fixed;
    z-index: 10003;
    -webkit-app-region: no-drag;
  }

  .rename-input input {
    padding: 4px 8px;
    font-size: 13px;
    font-family: var(--font-mono);
    background: var(--bg-elevated);
    color: var(--text);
    border: 2px solid var(--accent);
    border-radius: 4px;
    outline: none;
    min-width: 160px;
  }
</style>
