<script>
  import { configStore } from '../../lib/stores/config.svelte.js';

  const SEEN_KEY = 'voice-mirror-tutorial-seen';

  // Each step: title, description, and an inline stroke-based SVG icon
  // matching the app's existing icon language (24x24, currentColor stroke).
  const steps = [
    {
      title: 'Welcome to Voice Mirror',
      body:
        'A voice-native IDE: build real apps and websites by voice, watch them render live, and let the in-app AI see and drive them. Here’s a quick tour.',
      icon: 'welcome',
    },
    {
      title: 'Workspaces',
      body:
        'The coloured squares on the far-left rail are your projects, or workspaces. Click one to switch between them, and the + adds another.',
      icon: 'workspaces',
    },
    {
      title: 'Your AI agent (Voice Agent)',
      body:
        'The chat panel on the left is where you talk or type to your AI coding agent. Important: right-click the "Voice Agent" tab to choose your provider — Claude Code, OpenCode, local LLMs (Ollama / LM Studio / Jan), or Dictation Only.',
      icon: 'agent',
    },
    {
      title: 'Talk to build',
      body:
        'Use your voice: press your push-to-talk key (configurable in Settings) or the mic, and speak. Dictation types into whatever app is focused.',
      icon: 'mic',
    },
    {
      title: 'Live preview (Browser / App)',
      body:
        'The centre panel previews your work: the Browser tab shows websites and dev servers; the App tab shows your running desktop app live, and the AI can see and drive it. (The live App preview & driving are Windows-only for now.)',
      icon: 'preview',
    },
    {
      title: 'Files & editor (Lens)',
      body:
        'The right panel is your file tree with Outline, Search, and Status tabs. Open a file to edit it with full code intelligence.',
      icon: 'files',
    },
    {
      title: 'Terminal & Output',
      body:
        'The bottom panel has the agent’s terminal, your dev-server Output, a Terminal, and Problems. Start or stop a dev server from the Status bar at the very bottom.',
      icon: 'terminal',
    },
    {
      title: 'Menus & Command Palette',
      body:
        'The top menu bar (toggle it with the broadcast button on the far left) has File, Edit, View, and more. Press Ctrl+Shift+P for the Command Palette to run anything by name.',
      icon: 'command',
    },
    {
      title: 'You’re set',
      body:
        'Reopen this anytime from Help → Get Started. Settings (the gear, bottom-left) lets you pick providers, voice keys, and appearance.',
      icon: 'done',
    },
  ];

  let visible = $state(false);
  let step = $state(0);

  const isFirst = $derived(step === 0);
  const isLast = $derived(step === steps.length - 1);
  const current = $derived(steps[step]);

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* localStorage may be unavailable; ignore */
    }
  }

  function open() {
    step = 0;
    visible = true;
  }

  // Closing in any way (Done / Skip / Escape / backdrop) counts as dismissed.
  function close() {
    visible = false;
    markSeen();
  }

  function next() {
    if (isLast) {
      close();
    } else {
      step += 1;
    }
  }

  function back() {
    if (!isFirst) step -= 1;
  }

  function goTo(i) {
    step = i;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowRight') {
      next();
    } else if (e.key === 'ArrowLeft') {
      back();
    }
  }

  // Reopen on demand from the Help menu / command palette.
  $effect(() => {
    const show = () => open();
    window.addEventListener('show-tutorial', show);
    return () => window.removeEventListener('show-tutorial', show);
  });

  // First-run auto-show: only when never seen AND onboarding is already done
  // (so we don't clash with the first-run onboarding wizard).
  $effect(() => {
    let seen = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      seen = '1'; // if storage is unavailable, behave as already-seen
    }
    const onboardingDone = configStore.value?.system?.onboardingCompleted === true;
    if (seen === null && onboardingDone) {
      open();
    }
  });
</script>

<svelte:window onkeydown={visible ? handleKeydown : null} />

{#if visible}
  <div class="modal-overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label="Get Started with Voice Mirror"
    >
      <div class="step-icon" aria-hidden="true">
        {#if current.icon === 'welcome'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 11l18-8-8 18-2-8-8-2z" />
          </svg>
        {:else if current.icon === 'workspaces'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <path d="M17.5 14.5v6M14.5 17.5h6" />
          </svg>
        {:else if current.icon === 'agent'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        {:else if current.icon === 'mic'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
          </svg>
        {:else if current.icon === 'preview'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M2 7h20M6 5h.01M9 5h.01M2 21h20" />
          </svg>
        {:else if current.icon === 'files'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M9 13h6M9 17h6" />
          </svg>
        {:else if current.icon === 'terminal'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9l3 3-3 3M13 15h4" />
          </svg>
        {:else if current.icon === 'command'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="M22 4 12 14.01l-3-3" />
          </svg>
        {/if}
      </div>

      <div class="step-counter">Step {step + 1} of {steps.length}</div>
      <h3 class="step-title">{current.title}</h3>
      <p class="step-body">{current.body}</p>

      <div class="dots" role="tablist" aria-label="Tour progress">
        {#each steps as s, i}
          <button
            class="dot"
            class:active={i === step}
            role="tab"
            aria-selected={i === step}
            aria-label={`Go to step ${i + 1}: ${s.title}`}
            onclick={() => goTo(i)}
          ></button>
        {/each}
      </div>

      <div class="modal-actions">
        <button class="btn-skip" onclick={close}>Skip</button>
        <div class="nav-buttons">
          <button class="btn-secondary" onclick={back} disabled={isFirst}>Back</button>
          <button class="btn-primary" onclick={next}>{isLast ? 'Done' : 'Next'}</button>
        </div>
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
    padding: 28px 26px 22px;
    width: 440px;
    max-width: 90vw;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    animation: modal-in 0.14s ease-out;
  }

  .step-icon {
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    margin-bottom: 16px;
  }

  .step-icon svg {
    width: 28px;
    height: 28px;
  }

  .step-counter {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 6px;
  }

  .step-title {
    margin: 0 0 10px;
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
  }

  .step-body {
    margin: 0 0 20px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
    min-height: 66px;
  }

  .dots {
    display: flex;
    gap: 7px;
    margin-bottom: 22px;
  }

  .dot {
    width: 8px;
    height: 8px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: var(--border-strong);
    cursor: pointer;
    transition: background 0.12s ease, transform 0.12s ease;
  }

  .dot:hover {
    background: var(--muted);
  }

  .dot.active {
    background: var(--accent);
    transform: scale(1.25);
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .nav-buttons {
    display: flex;
    gap: 8px;
  }

  .btn-skip {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    padding: 6px 4px;
  }

  .btn-skip:hover {
    color: var(--text);
    text-decoration: underline;
  }

  .btn-secondary,
  .btn-primary {
    padding: 6px 18px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
  }

  .btn-secondary {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn-primary {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-fg, #fff);
  }

  .btn-primary:hover {
    filter: brightness(1.08);
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
    .dot { transition: none; }
  }
</style>
