<script>
  /**
   * WelcomeWizard -- First-run onboarding.
   *
   * Adaptive by design (see docs/research): it detects the AI coding CLIs on the
   * machine and their auth state, then EITHER collapses to a one-screen
   * "You're all set" for users who already have a provider ready, OR expands
   * into a guided checklist for new users (install / sign in / connect).
   *
   * Principles baked in:
   * - Never gate the core loop: "Skip for now" is always available.
   * - Passive detection only (backend reads credential files; never runs a CLI).
   * - Re-check instead of "click when done" — the user fixes something, we
   *   re-detect.
   *
   * Phase 1 scope: detect + adaptive UI + connect a ready provider + skip.
   * One-click install (Phase 2) and live auth/sign-in (Phase 3) replace the
   * copy-the-command guidance shown here.
   */
  import { detectProviders, installProvider, probeProviderAuth } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { updateConfig } from '../../lib/stores/config.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { onboardingStore } from '../../lib/stores/onboarding.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Button from '../shared/Button.svelte';

  let { onDone = () => {} } = $props();

  /** @type {Array<{providerType:string,displayName:string,command:string,installed:boolean,version:?string,path:?string,authState:string,ready:boolean}>} */
  let providers = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  /** providerType currently being installed, or null. */
  let installing = $state(null);

  // Verified, exact sign-in commands per provider (for guidance copy).
  const LOGIN_CMDS = {
    claude: 'claude auth login',
    opencode: 'opencode auth login',
    codex: 'codex login',
    'gemini-cli': 'gemini',
    'kimi-cli': 'kimi',
  };

  // Stable, sensible display order.
  const ORDER = ['claude', 'opencode', 'codex', 'gemini-cli', 'kimi-cli'];

  const sorted = $derived(
    [...providers].sort((a, b) => {
      // ready first, then installed, then by preferred order
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return ORDER.indexOf(a.providerType) - ORDER.indexOf(b.providerType);
    })
  );

  const readyProviders = $derived(providers.filter((p) => p.ready));
  const anyReady = $derived(readyProviders.length > 0);

  async function loadProviders() {
    loading = true;
    try {
      const result = await detectProviders();
      const data = unwrapResult(result);
      providers = Array.isArray(data?.providers) ? data.providers : [];
    } catch (err) {
      console.warn('[onboarding] detectProviders failed:', err);
      providers = [];
    } finally {
      loading = false;
    }
    // Refine auth with accurate live probes (catches expired/refreshed tokens
    // the fast file heuristic can miss). Runs after the initial render.
    refineAuth();
  }

  async function refineAuth() {
    const installed = providers.filter((p) => p.installed);
    const updates = await Promise.all(
      installed.map(async (p) => {
        try {
          const r = await probeProviderAuth(p.providerType);
          const data = unwrapResult(r);
          return [p.providerType, data?.authState];
        } catch {
          return [p.providerType, null];
        }
      })
    );
    const byType = new Map(updates.filter(([, s]) => s));
    providers = providers.map((p) => {
      const authState = byType.get(p.providerType);
      if (!authState || authState === 'unknown') return p;
      return { ...p, authState, ready: p.installed && authState === 'loggedIn' };
    });
  }

  $effect(() => {
    loadProviders();
  });

  /** Status pill descriptor for a provider row. */
  function statusInfo(p) {
    if (!p.installed) return { cls: 'missing', label: 'Not found' };
    if (p.ready) return { cls: 'ready', label: `Ready${p.version ? ` · v${p.version.replace(/^v/, '')}` : ''}` };
    if (p.authState === 'expired') return { cls: 'warn', label: 'Session expired' };
    if (p.authState === 'loggedOut') return { cls: 'warn', label: 'Not signed in' };
    return { cls: 'neutral', label: `Installed${p.version ? ` · v${p.version.replace(/^v/, '')}` : ''}` };
  }

  /** Whether this provider can be connected (ready, or installed w/ unknown auth). */
  function canConnect(p) {
    return p.installed && (p.ready || p.authState === 'unknown');
  }

  async function connect(p) {
    if (busy) return;
    busy = true;
    try {
      await updateConfig({ ai: { provider: p.providerType } });
      await finish(`Connected ${p.displayName}.`);
    } catch (err) {
      console.warn('[onboarding] connect failed:', err);
      toastStore.addToast({ message: `Couldn't connect: ${err}`, severity: 'error' });
      busy = false;
    }
  }

  async function install(p) {
    if (busy || installing) return;
    installing = p.providerType;
    try {
      const result = await installProvider(p.providerType);
      if (result?.success === false) {
        throw new Error(result.error || 'Install failed');
      }
      const data = unwrapResult(result);
      await loadProviders();
      if (data?.detected) {
        toastStore.addToast({ message: `${p.displayName} installed.`, severity: 'success' });
      } else {
        // Package installed but not yet on the running app's PATH.
        toastStore.addToast({
          message: `${p.displayName} installed — restart Voice Mirror to use it.`,
          severity: 'info',
          duration: 0,
        });
      }
    } catch (err) {
      console.warn('[onboarding] install failed:', err);
      toastStore.addToast({ message: `Install failed: ${err}`, severity: 'error', duration: 0 });
    } finally {
      installing = null;
    }
  }

  async function skip() {
    if (busy) return;
    busy = true;
    await finish();
  }

  async function finish(message) {
    await updateConfig({ system: { onboardingCompleted: true } });
    onboardingStore.close();
    if (message) {
      // Orient the user to the core loop on the way out.
      toastStore.addToast({
        message: `${message} Press your push-to-talk key to talk, or just type below.`,
        severity: 'success',
      });
    }
    navigationStore.setView('chat');
    onDone();
  }

  function handleKeydown(e) {
    // Escape skips (never trap the user), unless mid-operation.
    if (e.key === 'Escape' && !busy && !installing) {
      skip();
    }
  }

  async function copyHint(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toastStore.addToast({ message: `${label} copied — run it, then Re-check.`, severity: 'info' });
    } catch (err) {
      console.warn('[onboarding] copy failed:', err);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="welcome-overlay">
  <div class="welcome-card" role="dialog" aria-modal="true" aria-label="Welcome to Voice Mirror" tabindex="-1">
    {#if loading}
      <div class="welcome-loading">
        <div class="spinner"></div>
        <p>Detecting your AI tools…</p>
      </div>
    {:else}
      <header class="welcome-header">
        <h1>Welcome to Voice Mirror</h1>
        <p class="subtitle">Build by voice. Voice Mirror drives the AI coding CLI you already use.</p>
      </header>

      {#if anyReady}
        <!-- Adaptive: ready user -> collapse to "you're all set" -->
        <div class="ready-banner">
          <span class="ready-check">✓</span>
          <div>
            <p class="ready-title">You're all set</p>
            <p class="ready-sub">
              {readyProviders.length === 1
                ? `${readyProviders[0].displayName} is installed and signed in.`
                : `${readyProviders.length} providers are ready.`}
            </p>
          </div>
        </div>

        <div class="provider-list">
          {#each readyProviders as p (p.providerType)}
            {@const s = statusInfo(p)}
            <div class="provider-row">
              <div class="provider-meta">
                <span class="provider-name">{p.displayName}</span>
                <span class="status-pill {s.cls}">{s.label}</span>
              </div>
              <Button small onClick={() => connect(p)} disabled={busy}>Start with {p.displayName}</Button>
            </div>
          {/each}
        </div>

        <details class="more-providers">
          <summary>Set up a different provider</summary>
          <div class="provider-list">
            {#each sorted.filter((p) => !p.ready) as p (p.providerType)}
              {@render providerRow(p)}
            {/each}
          </div>
        </details>
      {:else if providers.length === 0}
        <!-- Detection failed entirely -->
        <p class="guide-intro">Couldn't detect your AI tools. Try Re-check, or skip and set one up later in Settings.</p>
      {:else}
        <!-- Guided: new user -> checklist -->
        <p class="guide-intro">Connect an AI coding CLI to get started:</p>
        <div class="provider-list">
          {#each sorted as p (p.providerType)}
            {@render providerRow(p)}
          {/each}
        </div>
      {/if}

      <footer class="welcome-footer">
        <button class="link-btn" onclick={loadProviders} disabled={busy}>↻ Re-check</button>
        <button class="link-btn" onclick={skip} disabled={busy}>Skip for now</button>
      </footer>
    {/if}
  </div>
</div>

{#snippet providerRow(p)}
  {@const s = statusInfo(p)}
  <div class="provider-row">
    <div class="provider-meta">
      <span class="provider-name">{p.displayName}</span>
      <span class="status-pill {s.cls}">{s.label}</span>
    </div>
    <div class="provider-action">
      {#if canConnect(p)}
        <Button small onClick={() => connect(p)} disabled={busy}>Connect</Button>
      {:else if p.installed}
        <!-- Installed but not signed in — copy the exact verified login command -->
        <button class="hint-btn" onclick={() => copyHint(LOGIN_CMDS[p.providerType] || `${p.command} auth login`, 'Sign-in command')} disabled={busy}>
          Sign in
        </button>
      {:else}
        <!-- Not installed — one-click install via its package manager -->
        <Button small onClick={() => install(p)} disabled={busy || installing !== null}>
          {installing === p.providerType ? 'Installing…' : 'Install'}
        </Button>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  .welcome-overlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    padding: 24px;
    box-sizing: border-box;
  }

  .welcome-card {
    width: 100%;
    max-width: 560px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.4));
    padding: 28px;
    box-sizing: border-box;
  }

  .welcome-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 40px;
    color: var(--muted);
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
  }

  .welcome-header h1 {
    margin: 0 0 6px 0;
    font-size: 22px;
    color: var(--text-strong);
  }

  .subtitle {
    margin: 0 0 20px 0;
    font-size: 13px;
    color: var(--muted);
    line-height: 1.5;
  }

  .ready-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: var(--ok-subtle, color-mix(in srgb, var(--ok) 12%, transparent));
    border: 1px solid color-mix(in srgb, var(--ok) 40%, transparent);
    border-radius: var(--radius-md, 8px);
    margin-bottom: 16px;
  }

  .ready-check {
    font-size: 22px;
    color: var(--ok);
    line-height: 1;
  }

  .ready-title {
    margin: 0;
    font-weight: 600;
    color: var(--text-strong);
  }

  .ready-sub {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .guide-intro {
    font-size: 13px;
    color: var(--text);
    margin: 0 0 12px 0;
  }

  .provider-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .provider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    background: var(--bg);
  }

  .provider-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .provider-name {
    font-weight: 500;
    color: var(--text);
  }

  .status-pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .status-pill.ready {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }

  .status-pill.warn {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }

  .status-pill.missing {
    background: color-mix(in srgb, var(--muted) 16%, transparent);
    color: var(--muted);
  }

  .status-pill.neutral {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  .hint-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    color: var(--muted);
    font-size: 12px;
    padding: 5px 10px;
    cursor: pointer;
    white-space: nowrap;
  }

  .hint-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .more-providers {
    margin-top: 16px;
  }

  .more-providers summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 8px;
  }

  .welcome-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 13px;
    cursor: pointer;
    padding: 4px 6px;
  }

  .link-btn:hover:not(:disabled) {
    color: var(--text);
  }

  .link-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
