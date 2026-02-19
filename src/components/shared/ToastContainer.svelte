<script>
  /**
   * ToastContainer.svelte -- Floating overlay that stacks toast notifications.
   *
   * Renders from bottom-right, newest on top.
   * Always mounted in App.svelte.
   */
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Toast from './Toast.svelte';

  function handleDismiss(id) {
    toastStore.dismissToast(id);
  }

  // Reverse so newest is visually on top (bottom of the stack)
  const reversedToasts = $derived([...toastStore.toasts].reverse());
</script>

{#if reversedToasts.length > 0}
  <div class="toast-container" aria-live="polite" aria-label="Notifications">
    {#each reversedToasts as toast (toast.id)}
      <Toast {toast} onDismiss={handleDismiss} />
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 10002;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    max-height: calc(100vh - 32px);
    overflow: hidden;
  }
</style>
