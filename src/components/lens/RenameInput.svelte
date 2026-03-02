<script>
  import { clampToViewport } from '$lib/clamp-to-viewport.js';

  let {
    visible = false,
    x = 0,
    y = 0,
    currentName = '',
    onConfirm = () => {},
    onCancel = () => {},
  } = $props();

  let inputValue = $state('');

  $effect(() => {
    if (visible) {
      inputValue = currentName;
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

  let renameEl = $state(null);

  // Post-render: reposition if it overflows viewport
  $effect(() => {
    if (visible && renameEl) clampToViewport(renameEl);
  });
</script>

{#if visible}
  <div class="rename-input" style="left: {x}px; top: {y}px;" bind:this={renameEl}>
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
