<script>
  /**
   * WelcomeWizard -- First-run onboarding.
   *
   * Adaptive by design (see docs/research): it detects the AI coding CLIs on the
   * machine and their auth state, then EITHER collapses to a one-screen
   * "You're all set" for users who already have everything ready, OR expands
   * into a guided multi-step checklist for new users (install / sign in /
   * download model / verify voice / GPU).
   *
   * Principles baked in:
   * - Never gate the core loop: "Skip for now" + Escape are always available.
   * - Passive detection only (backend reads credential files; never runs a CLI).
   * - Re-check instead of "click when done" — each step auto-marks done when its
   *   detection says it's satisfied; the user fixes something, we re-detect.
   *
   * Phase 3 scope: reshape the single provider screen into a checklist of steps
   *   1. AI Provider     (provider contract — install / sign-in / connect)
   *   2. Speech-to-Text  (stt contract — listSttModels + ensureSttModel download)
   *   3. Text-to-Speech  (tts contract — detectEspeak verify + warn, skippable)
   *   4. GPU             (gpu contract — advisory, optional CUDA toggle)
   * then hand off to the GettingStarted tutorial on finish.
   */
  import { onMount } from 'svelte';
  import {
    detectProviders,
    installProvider,
    probeProviderAuth,
    validateApiKey,
    listSttModels,
    ensureSttModel,
    ensureKokoroModel,
    detectEspeak,
    detectGpu,
  } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';
  import { unwrapResult } from '../../lib/utils.js';
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { onboardingStore } from '../../lib/stores/onboarding.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { STT_REGISTRY } from '../../lib/voice-adapters.js';
  import Button from '../shared/Button.svelte';

  let { onDone = () => {} } = $props();

  // ── Step model ────────────────────────────────────────────────────────────
  // A fixed list of checklist steps; each step's status is *computed* from its
  // detection result (never click-to-complete).
  const STEPS = [
    { id: 'provider', title: 'AI Provider' },
    { id: 'stt', title: 'Speech-to-Text' },
    { id: 'tts', title: 'Text-to-Speech' },
    { id: 'gpu', title: 'GPU Acceleration' },
  ];
  let currentStep = $state(0);
  const activeStep = $derived(STEPS[currentStep]);
  const isLastStep = $derived(currentStep === STEPS.length - 1);

  // ── Provider step state (KEPT from the original single-screen wizard) ───────
  /** @type {Array<{providerType:string,displayName:string,command:string,installed:boolean,version:?string,path:?string,authState:string,ready:boolean}>} */
  let providers = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  /** providerType currently being installed, or null. */
  let installing = $state(null);

  // ── STT step state ──────────────────────────────────────────────────────────
  let sttModels = $state([]);
  let sttDownloading = $state(false);
  let sttProgress = $state(0);
  let sttChosenSize = $state('base');

  // ── TTS step state ──────────────────────────────────────────────────────────
  let espeak = $state(null);
  let ttsSkipped = $state(false);
  let kokoroDownloading = $state(false);
  let kokoroProgress = $state(0);

  // ── Install progress (live npm/pip output) ──────────────────────────────────
  let installProgress = $state(0);
  let installStatus = $state('');

  // ── Provider API-key validation ──────────────────────────────────────────────
  // Map a CLI provider to the API-key family used to validate a pasted key.
  // CLI/OAuth providers (no API key) are absent → no key field shown.
  const KEY_PROVIDER = { claude: 'anthropic', codex: 'openai' };
  /** providerType -> pasted key string */
  let apiKeys = $state({});
  /** providerType -> { valid, message } | 'checking' */
  let keyValidation = $state({});

  // ── GPU step state ──────────────────────────────────────────────────────────
  let gpu = $state(null);
  let gpuAccel = $state(false);

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

  const STT_SIZES = STT_REGISTRY['whisper-local']?.modelSizes ?? [];

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
  const anyInstalled = $derived(providers.some((p) => p.installed));

  // Recommend a Whisper size from available VRAM (CUDA only). Bigger = more
  // accurate but heavier; default to "base" on CPU / unknown.
  const suggestedSttSize = $derived.by(() => {
    const vram = Number(gpu?.vramMb) || 0;
    const cuda = gpu?.available && gpu?.cudaCompiled && gpu?.vendor === 'nvidia';
    if (cuda && vram >= 8000) return 'large-v3-turbo';
    if (cuda && vram >= 4000) return 'small';
    return 'base';
  });

  // ── Per-step status (computed from detection — auto-completes) ──────────────
  const statusFor = $derived.by(() => ({
    // Done when ≥1 provider is ready, or at least installed (auth is fixable).
    provider: anyReady || anyInstalled ? 'done' : 'attention',
    // Done when ≥1 Whisper model is present on disk.
    stt: sttModels.length > 0 ? 'done' : 'attention',
    // Done when espeak-ng is found; skippable (Edge TTS works without it).
    tts: espeak?.found ? 'done' : ttsSkipped ? 'skipped' : 'attention',
    // Advisory — never blocks; always counts as complete.
    gpu: 'done',
  }));

  const steps = $derived(
    STEPS.map((s) => ({ ...s, status: statusFor[s.id] }))
  );
  const completeCount = $derived(
    steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  );
  const allComplete = $derived(completeCount === STEPS.length);

  // ── Detection ───────────────────────────────────────────────────────────────
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
    // Snapshot the array we probed against; if a newer load (e.g. Re-check)
    // replaces `providers` while these async probes are in flight, don't clobber
    // the fresher data with our now-stale results.
    const snapshot = providers;
    const installed = snapshot.filter((p) => p.installed);
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
    if (providers !== snapshot) return;
    const byType = new Map(updates.filter(([, s]) => s));
    providers = providers.map((p) => {
      const authState = byType.get(p.providerType);
      if (!authState || authState === 'unknown') return p;
      return { ...p, authState, ready: p.installed && authState === 'loggedIn' };
    });
  }

  async function detectStt() {
    try {
      const data = unwrapResult(await listSttModels());
      sttModels = Array.isArray(data?.models) ? data.models : [];
    } catch (err) {
      console.warn('[onboarding] listSttModels failed:', err);
      sttModels = [];
    }
  }

  async function detectTts() {
    try {
      const res = await detectEspeak();
      espeak = unwrapResult(res) ?? res ?? {};
    } catch (err) {
      // Outside Tauri / command unavailable (dev/browser) → treat as unknown.
      console.warn('[onboarding] detectEspeak failed:', err);
      espeak = null;
    }
  }

  async function detectGpuStep() {
    try {
      gpu = unwrapResult(await detectGpu()) ?? null;
    } catch (err) {
      console.warn('[onboarding] detectGpu failed:', err);
      gpu = null;
    }
  }

  /** Re-run every step's detection (the "Re-check" action). */
  async function recheckAll() {
    if (busy) return;
    await Promise.all([loadProviders(), detectStt(), detectTts(), detectGpuStep()]);
    // Default the STT choice to the VRAM-suggested size (only if user hasn't
    // already deviated from a prior suggestion).
    sttChosenSize = suggestedSttSize;
    // Mirror the persisted GPU-acceleration preference.
    gpuAccel = configStore.value?.voice?.sttUseGpu === true;
  }

  onMount(() => {
    recheckAll();
  });

  // ── Step navigation ─────────────────────────────────────────────────────────
  function goBack() {
    if (currentStep > 0) currentStep -= 1;
  }
  function goNext() {
    if (currentStep < STEPS.length - 1) currentStep += 1;
  }
  function skipStep() {
    if (activeStep.id === 'tts') ttsSkipped = true;
    goNext();
  }

  // ── Provider actions (KEPT) ─────────────────────────────────────────────────
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
      // If the user pasted an API key for a key-based provider, validate it
      // before saving so a bad key is caught here, not at first use.
      if (KEY_PROVIDER[p.providerType] && (apiKeys[p.providerType] || '').trim()) {
        const data = await validateProviderKey(p);
        if (data && !data.valid) {
          busy = false;
          return; // keep the user on the step; feedback already shown
        }
      }
      await updateConfig({ ai: { provider: p.providerType } });
      toastStore.addToast({ message: `Selected ${p.displayName}.`, severity: 'success' });
      // Don't finish the whole wizard — advance to the next setup step.
      goNext();
    } catch (err) {
      console.warn('[onboarding] connect failed:', err);
      toastStore.addToast({ message: `Couldn't connect: ${err}`, severity: 'error' });
    } finally {
      busy = false;
    }
  }

  async function install(p) {
    if (busy || installing) return;
    installing = p.providerType;
    installProgress = 0;
    installStatus = '';
    // Show live npm/pip output while the (slow) install runs.
    const unlistenInstall = await listen('provider-install-progress', (event) => {
      const { provider, status, percent } = event.payload || {};
      if (provider && provider !== p.providerType) return;
      if (typeof percent === 'number') installProgress = percent;
      if (status) installStatus = status;
    });
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
      unlistenInstall();
      installing = null;
      installProgress = 0;
      installStatus = '';
    }
  }

  // ── STT download (pattern lifted from VoiceSettings.svelte) ──────────────────
  async function downloadSttModel(size) {
    if (sttDownloading) return;
    sttDownloading = true;
    sttProgress = 0;
    const downloadToastId = toastStore.addToast({
      message: `Downloading Whisper model (${size})...`,
      severity: 'info',
      duration: 0,
      key: 'stt-model-download',
      progress: 0,
    });

    const unlisten = await listen('stt-download-progress', (event) => {
      const { percent, downloadedMb, totalMb } = event.payload;
      sttProgress = percent;
      if (downloadToastId) {
        toastStore.updateToast(downloadToastId, {
          message: `Downloading model... ${percent}% (${Math.round(downloadedMb)} / ${Math.round(totalMb)} MB)`,
          progress: percent,
        });
      }
    });

    try {
      await ensureSttModel(size);
      unlisten();
      toastStore.dismissToast(downloadToastId);
      toastStore.addToast({ message: 'Model ready', severity: 'success' });
      await detectStt();
    } catch (dlErr) {
      unlisten();
      toastStore.dismissToast(downloadToastId);
      toastStore.addToast({ message: `Model download failed: ${dlErr}`, severity: 'error' });
    } finally {
      sttDownloading = false;
    }
  }

  // ── Kokoro voice download (mirrors the STT download flow) ────────────────────
  async function downloadKokoroModel() {
    if (kokoroDownloading) return;
    kokoroDownloading = true;
    kokoroProgress = 0;
    const toastId = toastStore.addToast({
      message: 'Downloading Kokoro voice (~350 MB)...',
      severity: 'info',
      duration: 0,
      key: 'kokoro-model-download',
      progress: 0,
    });

    const unlisten = await listen('kokoro-download-progress', (event) => {
      const { model, percent, downloadedMb, totalMb } = event.payload;
      kokoroProgress = percent;
      if (toastId) {
        toastStore.updateToast(toastId, {
          message: `Downloading ${model}... ${percent}% (${Math.round(downloadedMb)} / ${Math.round(totalMb)} MB)`,
          progress: percent,
        });
      }
    });

    try {
      await ensureKokoroModel();
      unlisten();
      toastStore.dismissToast(toastId);
      toastStore.addToast({ message: 'Kokoro voice ready', severity: 'success' });
      // Re-run TTS detection (espeak-ng is the remaining requirement).
      await detectTts();
    } catch (dlErr) {
      unlisten();
      toastStore.dismissToast(toastId);
      toastStore.addToast({ message: `Kokoro download failed: ${dlErr}`, severity: 'error' });
    } finally {
      kokoroDownloading = false;
    }
  }

  // ── Provider API-key validation ──────────────────────────────────────────────
  /** Validate a pasted API key for a provider; returns {valid,message} or null. */
  async function validateProviderKey(p) {
    const family = KEY_PROVIDER[p.providerType];
    if (!family) return null;
    const key = (apiKeys[p.providerType] || '').trim();
    if (!key) return null;
    keyValidation = { ...keyValidation, [p.providerType]: 'checking' };
    try {
      const data = unwrapResult(await validateApiKey(family, key)) ?? {};
      keyValidation = { ...keyValidation, [p.providerType]: data };
      toastStore.addToast({
        message: data?.valid ? 'API key valid.' : `API key invalid: ${data?.message || 'unknown'}`,
        severity: data?.valid ? 'success' : 'error',
      });
      return data;
    } catch (err) {
      const data = { valid: false, message: String(err) };
      keyValidation = { ...keyValidation, [p.providerType]: data };
      return data;
    }
  }

  // ── GPU toggle (persisted) ───────────────────────────────────────────────────
  async function setGpuAccel(v) {
    gpuAccel = v;
    try {
      await updateConfig({ voice: { sttUseGpu: v } });
      toastStore.addToast({
        message: v ? 'GPU acceleration enabled' : 'GPU acceleration disabled',
        severity: 'info',
      });
    } catch (err) {
      console.warn('[onboarding] GPU toggle failed:', err);
      toastStore.addToast({ message: `Couldn't save GPU setting: ${err}`, severity: 'error' });
    }
  }

  // ── Exit paths ───────────────────────────────────────────────────────────────
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
    // Hand off to the GettingStarted tutorial (it waits on onboardingCompleted).
    window.dispatchEvent(new CustomEvent('show-tutorial'));
    onDone();
  }

  function handleKeydown(e) {
    // Escape skips (never trap the user), unless mid-operation.
    if (e.key === 'Escape' && !busy && !installing && !sttDownloading) {
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

  function stepIcon(status) {
    if (status === 'done') return '✓';
    if (status === 'skipped') return '–';
    return '○';
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
        <p class="subtitle">Build by voice. Let's get your tools ready.</p>
      </header>

      {#if allComplete}
        <div class="ready-banner">
          <span class="ready-check">✓</span>
          <div>
            <p class="ready-title">You're all set</p>
            <p class="ready-sub">Every setup step is complete. Press Finish to start building.</p>
          </div>
        </div>
      {/if}

      <!-- Checklist: X of Y complete -->
      <div class="checklist">
        <div class="checklist-header">
          <span class="progress-label">{completeCount} of {STEPS.length} complete</span>
        </div>
        <ol class="step-list">
          {#each steps as s, i (s.id)}
            <li>
              <button
                type="button"
                class="step-item {s.status}"
                class:active={i === currentStep}
                onclick={() => (currentStep = i)}
              >
                <span class="step-icon {s.status}">{stepIcon(s.status)}</span>
                <span class="step-title">{s.title}</span>
              </button>
            </li>
          {/each}
        </ol>
      </div>

      <!-- Active step panel -->
      <div class="step-panel">
        {#if activeStep.id === 'provider'}
          {#if anyReady}
            <div class="provider-list">
              {#each readyProviders as p (p.providerType)}
                {@const s = statusInfo(p)}
                <div class="provider-row">
                  <div class="provider-meta">
                    <span class="provider-name">{p.displayName}</span>
                    <span class="status-pill {s.cls}">{s.label}</span>
                  </div>
                  <Button small onClick={() => connect(p)} disabled={busy}>Use {p.displayName}</Button>
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
            <p class="guide-intro">Couldn't detect your AI tools. Try Re-check, or skip and set one up later in Settings.</p>
          {:else}
            <p class="guide-intro">Connect an AI coding CLI to get started:</p>
            <div class="provider-list">
              {#each sorted as p (p.providerType)}
                {@render providerRow(p)}
              {/each}
            </div>
          {/if}

        {:else if activeStep.id === 'stt'}
          <p class="guide-intro">Voice input needs a Whisper model to transcribe what you say.</p>
          {#if sttModels.length > 0}
            <div class="ok-line">
              <span class="status-pill ready">Ready</span>
              <span>{sttModels.length} model{sttModels.length === 1 ? '' : 's'} installed: {sttModels.map((m) => m.modelSize).join(', ')}</span>
            </div>
          {:else}
            <p class="guide-intro">No model found yet. Download one to enable dictation
              {#if suggestedSttSize !== 'base'}<span class="hint-note"> (suggested for your GPU)</span>{/if}:
            </p>
            <div class="stt-download">
              <select class="size-select" bind:value={sttChosenSize} disabled={sttDownloading}>
                {#each STT_SIZES as opt (opt.value)}
                  <option value={opt.value}>{opt.label}{opt.value === suggestedSttSize ? ' — suggested' : ''}</option>
                {/each}
              </select>
              <Button small onClick={() => downloadSttModel(sttChosenSize)} disabled={sttDownloading}>
                {sttDownloading ? `Downloading… ${sttProgress}%` : 'Download'}
              </Button>
            </div>
            {#if sttDownloading}
              <div class="progress-bar"><div class="progress-fill" style="width:{sttProgress}%"></div></div>
            {/if}
          {/if}

        {:else if activeStep.id === 'tts'}
          <p class="guide-intro">Spoken replies use the local Kokoro voice, which needs <code>espeak-ng</code> to turn text into speech.</p>
          {#if espeak?.found}
            <div class="ok-line">
              <span class="status-pill ready">Ready</span>
              <span>espeak-ng ready{espeak.source ? ` (${espeak.source})` : ''}.</span>
            </div>
          {:else}
            <div class="warn-box">
              <strong>espeak-ng not found.</strong>
              <p>The local Kokoro voice will be silent. Reinstalling Voice Mirror bundles espeak-ng,
                or you can switch to Edge TTS (no espeak needed) in Settings → Voice. You can skip this step.</p>
            </div>
          {/if}

          <!-- Kokoro voice model download (the ~350 MB voice files aren't bundled). -->
          <div class="kokoro-download">
            <p class="guide-intro">The local Kokoro voice also needs its model files (~350 MB). Download them once for offline, natural-sounding speech.</p>
            <Button small onClick={downloadKokoroModel} disabled={kokoroDownloading}>
              {kokoroDownloading ? `Downloading… ${kokoroProgress}%` : 'Download Kokoro voice (~350 MB)'}
            </Button>
            {#if kokoroDownloading}
              <div class="progress-bar"><div class="progress-fill" style="width:{kokoroProgress}%"></div></div>
            {/if}
          </div>

        {:else if activeStep.id === 'gpu'}
          <p class="guide-intro">GPU acceleration speeds up transcription. This is optional — CPU works fine.</p>
          {#if gpu?.available}
            <div class="gpu-info">
              <span class="gpu-name">{gpu.name || gpu.vendor}</span>
              {#if gpu.vramMb}<span class="gpu-vram">{gpu.vramMb} MB VRAM</span>{/if}
              {#if gpu.available && gpu.cudaCompiled && gpu.vendor === 'nvidia'}
                <span class="status-pill ready">CUDA accelerated</span>
              {:else}
                <span class="status-pill neutral">CPU inference</span>
              {/if}
            </div>
            {#if gpu.cudaCompiled && gpu.vendor === 'nvidia'}
              <label class="gpu-toggle">
                <input type="checkbox" checked={gpuAccel} onchange={(e) => setGpuAccel(e.currentTarget.checked)} />
                <span>Use GPU acceleration for faster transcription</span>
              </label>
            {:else}
              <p class="hint-note">CUDA acceleration requires an NVIDIA GPU — CPU transcription still works.</p>
            {/if}
          {:else}
            <div class="ok-line">
              <span class="status-pill neutral">CPU inference</span>
              <span>No discrete GPU detected — Voice Mirror will use the CPU.</span>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Step navigation -->
      <div class="step-nav">
        <button class="link-btn" onclick={goBack} disabled={busy || currentStep === 0}>← Back</button>
        <div class="step-nav-right">
          {#if activeStep.id === 'tts' && !espeak?.found}
            <button class="link-btn" onclick={skipStep} disabled={busy}>Skip this step</button>
          {/if}
          {#if isLastStep}
            <Button onClick={() => finish('Setup complete.')} disabled={busy}>Finish</Button>
          {:else}
            <Button onClick={goNext} disabled={busy}>Next</Button>
          {/if}
        </div>
      </div>

      <footer class="welcome-footer">
        <button class="link-btn" onclick={recheckAll} disabled={busy}>↻ Re-check</button>
        <button class="link-btn" onclick={skip} disabled={busy}>Skip for now</button>
      </footer>
    {/if}
  </div>
</div>

{#snippet providerRow(p)}
  {@const s = statusInfo(p)}
  {@const kv = keyValidation[p.providerType]}
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
  {#if installing === p.providerType}
    <!-- Live install progress (provider-install-progress events). -->
    <div class="install-progress">
      <div class="progress-bar"><div class="progress-fill" style="width:{installProgress}%"></div></div>
      {#if installStatus}<span class="install-status">{installStatus}</span>{/if}
    </div>
  {/if}
  {#if KEY_PROVIDER[p.providerType]}
    <!-- Optional: paste an API key and validate it before connecting. -->
    <div class="api-key-row">
      <input
        class="api-key-input"
        type="password"
        placeholder="Paste an API key (optional) — validated before saving"
        bind:value={apiKeys[p.providerType]}
        disabled={busy}
      />
      <button class="hint-btn" onclick={() => validateProviderKey(p)} disabled={busy || kv === 'checking' || !(apiKeys[p.providerType] || '').trim()}>
        {kv === 'checking' ? 'Checking…' : 'Validate'}
      </button>
      {#if kv && kv !== 'checking'}
        <span class="status-pill {kv.valid ? 'ready' : 'warn'}">{kv.valid ? 'Key valid' : 'Key invalid'}</span>
      {/if}
    </div>
  {/if}
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
    margin: 0 0 18px 0;
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

  /* ── Checklist ── */
  .checklist {
    margin-bottom: 18px;
  }

  .checklist-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 8px;
  }

  .progress-label {
    font-size: 12px;
    color: var(--muted);
  }

  .step-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text);
    font-size: 13px;
  }

  .step-item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  }

  .step-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    font-size: 12px;
    flex: none;
    border: 1px solid var(--border);
    color: var(--muted);
  }

  .step-icon.done {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
    color: var(--ok);
  }

  .step-icon.skipped {
    color: var(--muted);
  }

  .step-icon.attention {
    border-color: color-mix(in srgb, var(--warn) 50%, transparent);
    color: var(--warn);
  }

  .step-title {
    font-weight: 500;
  }

  /* ── Step panel ── */
  .step-panel {
    min-height: 96px;
    padding: 4px 2px 6px;
  }

  .ok-line {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text);
  }

  .stt-download {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }

  .size-select {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    color: var(--text);
    padding: 6px 8px;
    font-size: 13px;
  }

  .kokoro-download {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .install-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 2px 2px;
  }

  .install-progress .progress-bar {
    flex: 1;
    margin-top: 0;
  }

  .install-status {
    font-size: 11px;
    color: var(--muted);
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .api-key-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 2px 8px;
  }

  .api-key-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    color: var(--text);
    padding: 6px 8px;
    font-size: 12px;
  }

  .progress-bar {
    margin-top: 10px;
    height: 6px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }

  .warn-box {
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    border-radius: var(--radius-md, 8px);
    padding: 12px 14px;
    font-size: 13px;
    color: var(--text);
  }

  .warn-box p {
    margin: 6px 0 0 0;
    color: var(--muted);
    line-height: 1.5;
  }

  .gpu-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .gpu-name {
    font-weight: 500;
    color: var(--text);
  }

  .gpu-vram {
    color: var(--muted);
    font-size: 12px;
  }

  .gpu-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }

  .hint-note {
    color: var(--muted);
    font-size: 12px;
  }

  .guide-intro {
    font-size: 13px;
    color: var(--text);
    margin: 0 0 12px 0;
    line-height: 1.5;
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

  .step-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
  }

  .step-nav-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .welcome-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 16px;
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
