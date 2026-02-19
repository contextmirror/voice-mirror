<script>
  /**
   * WhatsNewModal.svelte -- Shows new features/changes after an update.
   *
   * Displays simple markdown-formatted content with a dismiss button.
   * Shown when the app version changes (compare config.lastSeenVersion with current).
   *
   * Props:
   *   version {string} - Current app version
   *   onDismiss {function} - Called when modal is dismissed
   */
  import { fly, fade } from 'svelte/transition';
  import { renderMarkdown } from '../../lib/markdown.js';

  let {
    version = '0.1.0',
    onDismiss = () => {},
  } = $props();

  /**
   * Release notes content. In a real implementation this could be
   * loaded from a file or API; for now it's inline.
   */
  const changelogContent = $derived(renderMarkdown(`
### Voice Mirror v${version}

**New in this version:**

- Tauri v2 native desktop app with improved performance
- Svelte 5 frontend with reactive runes
- Toast notification system for feedback
- Onboarding wizard for first-time setup
- Smooth animations and transitions throughout
- Skeleton loading states for better perceived performance
- Error states with retry actions
- Theme live preview during selection

**Improvements:**

- Sidebar collapse/expand with smooth animation
- Chat messages slide in with entrance transitions
- Tool cards animate status changes
- Reduced motion support for accessibility
`));

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }
</script>

<svelte:document onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="whats-new-overlay" transition:fade={{ duration: 150 }} onclick={onDismiss}>
  <div
    class="whats-new-modal"
    transition:fly={{ y: 20, duration: 250 }}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="whats-new-header">
      <h2>What's New</h2>
      <button
        class="close-btn"
        onclick={onDismiss}
        aria-label="Close what's new"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="whats-new-body">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html changelogContent}
    </div>

    <div class="whats-new-footer">
      <button class="dismiss-btn" onclick={onDismiss}>
        Got it
      </button>
    </div>
  </div>
</div>

<style>
  /* ========== Overlay ========== */
  .whats-new-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  }

  /* ========== Modal ========== */
  .whats-new-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    max-width: 500px;
    width: 90%;
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  /* ========== Header ========== */
  .whats-new-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .whats-new-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .close-btn {
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
  }

  .close-btn:hover {
    color: var(--text-strong);
  }

  /* ========== Body ========== */
  .whats-new-body {
    padding: 20px;
    overflow-y: auto;
    color: var(--text);
    font-size: 13px;
    line-height: 1.6;
  }

  .whats-new-body :global(h3) {
    color: var(--accent);
    font-size: 15px;
    margin: 0 0 12px;
  }

  .whats-new-body :global(p) {
    margin: 0 0 10px;
    color: var(--text);
  }

  .whats-new-body :global(strong) {
    color: var(--text-strong);
  }

  .whats-new-body :global(ul) {
    margin: 0 0 12px;
    padding-left: 20px;
  }

  .whats-new-body :global(li) {
    margin: 4px 0;
  }

  .whats-new-body :global(code) {
    background: var(--bg);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.85em;
    font-family: var(--font-mono);
  }

  /* ========== Footer ========== */
  .whats-new-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dismiss-btn {
    padding: 8px 24px;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--accent);
    color: var(--accent-contrast, white);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .dismiss-btn:hover {
    background: var(--accent-hover);
  }

  .dismiss-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .close-btn,
    .dismiss-btn {
      transition: none;
    }
  }
</style>
