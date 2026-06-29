<script>
  import { open } from '@tauri-apps/plugin-shell';

  // Mirrors the "version" field in package.json (currently "0.1.0").
  const VERSION = '0.1.0';
  const TAGLINE = 'A voice-native IDE — build, see, and drive real apps by voice.';

  const LINKS = [
    { label: 'Website', url: 'https://www.contextmirror.com' },
    { label: 'GitHub', url: 'https://github.com/contextmirror/voice-mirror-electron' },
    { label: 'Discord', url: 'https://discord.com/invite/JBpsSFB7EQ' },
  ];

  let visible = $state(false);

  function close() {
    visible = false;
  }

  function openLink(url) {
    open(url).catch((err) => console.error('[about] Failed to open link:', err));
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  $effect(() => {
    const show = () => { visible = true; };
    window.addEventListener('show-about-dialog', show);
    return () => window.removeEventListener('show-about-dialog', show);
  });
</script>

<svelte:window onkeydown={visible ? handleKeydown : null} />

{#if visible}
  <div class="modal-overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-label="About Voice Mirror">
      <h3 class="app-name">Voice Mirror</h3>
      <div class="version">Version {VERSION}</div>
      <p class="tagline">{TAGLINE}</p>

      <div class="links">
        {#each LINKS as link}
          <button class="link" onclick={() => openLink(link.url)}>{link.label}</button>
        {/each}
      </div>

      <div class="modal-actions">
        <button class="btn-close" onclick={close}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: overlay-in 0.12s ease-out;
  }

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    padding: 24px;
    width: 360px;
    max-width: 90vw;
    text-align: center;
    animation: modal-in 0.14s ease-out;
  }

  .app-name {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
  }

  .version {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 12px;
  }

  .tagline {
    margin: 0 0 18px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
  }

  .links {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-bottom: 20px;
  }

  .link {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    padding: 0;
  }

  .link:hover {
    text-decoration: underline;
  }

  .modal-actions {
    display: flex;
    justify-content: center;
  }

  .btn-close {
    padding: 6px 20px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .btn-close:hover {
    background: var(--bg-hover);
  }

  @keyframes overlay-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modal-in {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-overlay, .modal { animation: none; }
  }
</style>
