<script>
  /**
   * OnboardingModal.svelte -- First-run setup wizard.
   *
   * Multi-step onboarding modal shown on first launch.
   * Steps: Welcome, AI Provider, Voice Config, Theme Selection.
   *
   * Props:
   *   onComplete {function} - Called when onboarding finishes
   */
  import { fly, fade } from 'svelte/transition';
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { PRESETS, applyTheme, resolveTheme } from '../../lib/stores/theme.svelte.js';

  let { onComplete = () => {} } = $props();

  let currentStep = $state(0);

  // Step 2: AI provider selection
  let selectedProvider = $state('claude');

  // Step 3: Voice config
  let voiceEnabled = $state(true);
  let selectedTTS = $state('kokoro');

  // Step 4: Theme selection
  let selectedTheme = $state('colorblind');

  const STEPS = [
    { id: 'welcome', title: 'Welcome' },
    { id: 'provider', title: 'AI Provider' },
    { id: 'voice', title: 'Voice' },
    { id: 'theme', title: 'Theme' },
  ];

  const totalSteps = STEPS.length;
  const isFirst = $derived(currentStep === 0);
  const isLast = $derived(currentStep === totalSteps - 1);
  const progress = $derived(((currentStep + 1) / totalSteps) * 100);

  const providerOptions = [
    { value: 'claude', label: 'Claude Code', desc: 'Anthropic CLI agent with full tool access' },
    { value: 'opencode', label: 'OpenCode', desc: 'Open-source CLI agent alternative' },
    { value: 'ollama', label: 'Ollama', desc: 'Run local LLMs (Llama, Mistral, etc.)' },
    { value: 'lmstudio', label: 'LM Studio', desc: 'Desktop app for local LLMs' },
  ];

  const themeOptions = $derived(
    Object.entries(PRESETS).map(([key, preset]) => ({
      key,
      name: preset.name,
      colors: preset.colors,
    }))
  );

  function handleNext() {
    if (isLast) {
      finishOnboarding();
    } else {
      currentStep++;
    }
  }

  function handleBack() {
    if (currentStep > 0) {
      currentStep--;
    }
  }

  function handleSkip() {
    finishOnboarding();
  }

  function handleThemePreview(themeKey) {
    selectedTheme = themeKey;
    const { colors, fonts } = resolveTheme(themeKey);
    applyTheme(colors, fonts);
  }

  async function finishOnboarding() {
    try {
      await updateConfig({
        ai: { provider: selectedProvider },
        voice: { ttsAdapter: selectedTTS },
        appearance: { theme: selectedTheme },
        system: { firstLaunchDone: true },
      });
    } catch (err) {
      console.error('[Onboarding] Failed to save config:', err);
    }
    onComplete();
  }
</script>

<div class="onboarding-overlay" transition:fade={{ duration: 200 }}>
  <div class="onboarding-modal" transition:fly={{ y: 24, duration: 300 }}>
    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-fill" style:width="{progress}%"></div>
    </div>

    <!-- Step content -->
    <div class="step-content">
      {#if currentStep === 0}
        <!-- Step 1: Welcome -->
        <div class="step-body welcome-step">
          <div class="welcome-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h2>Welcome to Voice Mirror</h2>
          <p>A voice-controlled AI agent overlay for your desktop. Let's get you set up in a few quick steps.</p>
          <div class="feature-list">
            <div class="feature-item">
              <span class="feature-bullet"></span>
              <span>Voice-activated AI assistant</span>
            </div>
            <div class="feature-item">
              <span class="feature-bullet"></span>
              <span>Multiple AI provider support</span>
            </div>
            <div class="feature-item">
              <span class="feature-bullet"></span>
              <span>Built-in tools for browser, memory, and more</span>
            </div>
          </div>
        </div>

      {:else if currentStep === 1}
        <!-- Step 2: AI Provider -->
        <div class="step-body">
          <h2>Choose your AI Provider</h2>
          <p>Select the AI backend you want to use. You can change this anytime in Settings.</p>
          <div class="provider-grid">
            {#each providerOptions as opt}
              <button
                class="provider-card"
                class:selected={selectedProvider === opt.value}
                onclick={() => (selectedProvider = opt.value)}
              >
                <span class="provider-card-name">{opt.label}</span>
                <span class="provider-card-desc">{opt.desc}</span>
              </button>
            {/each}
          </div>
        </div>

      {:else if currentStep === 2}
        <!-- Step 3: Voice -->
        <div class="step-body">
          <h2>Voice Configuration</h2>
          <p>Voice Mirror supports speech-to-text and text-to-speech. This step is optional.</p>
          <div class="voice-toggle-row">
            <label class="voice-toggle">
              <input type="checkbox" bind:checked={voiceEnabled} />
              <span class="toggle-label">Enable voice features</span>
            </label>
          </div>
          {#if voiceEnabled}
            <div class="tts-options">
              <span class="tts-label">Text-to-Speech Engine</span>
              <div class="tts-grid">
                <button
                  class="tts-option"
                  class:selected={selectedTTS === 'kokoro'}
                  onclick={() => (selectedTTS = 'kokoro')}
                >
                  <span class="tts-name">Kokoro</span>
                  <span class="tts-desc">Local, fast (~100MB)</span>
                </button>
                <button
                  class="tts-option"
                  class:selected={selectedTTS === 'piper'}
                  onclick={() => (selectedTTS = 'piper')}
                >
                  <span class="tts-name">Piper</span>
                  <span class="tts-desc">Local, lightweight (~50MB)</span>
                </button>
                <button
                  class="tts-option"
                  class:selected={selectedTTS === 'edge'}
                  onclick={() => (selectedTTS = 'edge')}
                >
                  <span class="tts-name">Edge TTS</span>
                  <span class="tts-desc">Free cloud (Microsoft)</span>
                </button>
              </div>
            </div>
          {/if}
        </div>

      {:else if currentStep === 3}
        <!-- Step 4: Theme -->
        <div class="step-body">
          <h2>Pick a Theme</h2>
          <p>Choose a color scheme that suits your style. You can customize further in Settings.</p>
          <div class="theme-grid">
            {#each themeOptions as theme}
              <button
                class="theme-card"
                class:selected={selectedTheme === theme.key}
                onclick={() => handleThemePreview(theme.key)}
              >
                <div class="theme-swatches">
                  <span class="swatch" style:background={theme.colors.bg}></span>
                  <span class="swatch" style:background={theme.colors.accent}></span>
                  <span class="swatch" style:background={theme.colors.ok}></span>
                  <span class="swatch" style:background={theme.colors.danger}></span>
                </div>
                <span class="theme-name">{theme.name}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Navigation footer -->
    <div class="step-footer">
      <button class="skip-btn" onclick={handleSkip}>
        Skip Setup
      </button>

      <div class="step-indicators">
        {#each STEPS as step, i}
          <span
            class="step-dot"
            class:active={i === currentStep}
            class:completed={i < currentStep}
          ></span>
        {/each}
      </div>

      <div class="nav-buttons">
        {#if !isFirst}
          <button class="back-btn" onclick={handleBack}>Back</button>
        {/if}
        <button class="next-btn" onclick={handleNext}>
          {isLast ? 'Get Started' : 'Next'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  /* ========== Overlay ========== */
  .onboarding-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  }

  /* ========== Modal ========== */
  .onboarding-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    max-width: 520px;
    width: 92%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  /* ========== Progress bar ========== */
  .progress-bar {
    height: 3px;
    background: var(--bg-hover);
    flex-shrink: 0;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--duration-normal) var(--ease-out);
    border-radius: 0 var(--radius-full) var(--radius-full) 0;
  }

  /* ========== Step Content ========== */
  .step-content {
    flex: 1;
    overflow-y: auto;
    padding: 32px 28px 16px;
  }

  .step-body h2 {
    color: var(--text-strong);
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 8px;
  }

  .step-body p {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
    margin: 0 0 20px;
  }

  /* ========== Welcome Step ========== */
  .welcome-step {
    text-align: center;
  }

  .welcome-icon {
    color: var(--accent);
    margin-bottom: 16px;
  }

  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
    text-align: left;
    padding: 0 16px;
  }

  .feature-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text);
  }

  .feature-bullet {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  /* ========== Provider Grid ========== */
  .provider-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .provider-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-family);
    transition: all var(--duration-fast) var(--ease-out);
  }

  .provider-card:hover {
    border-color: var(--accent);
    background: var(--bg-hover);
  }

  .provider-card.selected {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .provider-card-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .provider-card-desc {
    font-size: 12px;
    color: var(--muted);
  }

  /* ========== Voice Step ========== */
  .voice-toggle-row {
    margin-bottom: 16px;
  }

  .voice-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .voice-toggle input[type="checkbox"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }

  .toggle-label {
    font-size: 14px;
    color: var(--text);
  }

  .tts-label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .tts-grid {
    display: flex;
    gap: 8px;
  }

  .tts-option {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: center;
    font-family: var(--font-family);
    transition: all var(--duration-fast) var(--ease-out);
  }

  .tts-option:hover {
    border-color: var(--accent);
  }

  .tts-option.selected {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .tts-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .tts-desc {
    font-size: 10px;
    color: var(--muted);
  }

  /* ========== Theme Grid ========== */
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .theme-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: center;
    font-family: var(--font-family);
    transition: all var(--duration-fast) var(--ease-out);
  }

  .theme-card:hover {
    border-color: var(--accent);
  }

  .theme-card.selected {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .theme-swatches {
    display: flex;
    gap: 4px;
    justify-content: center;
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
  }

  .theme-name {
    font-size: 11px;
    color: var(--text);
    font-weight: 500;
  }

  /* ========== Footer ========== */
  .step-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 28px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .skip-btn {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    font-family: var(--font-family);
    padding: 4px 0;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .skip-btn:hover {
    color: var(--text);
  }

  .step-indicators {
    display: flex;
    gap: 6px;
  }

  .step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bg-hover);
    transition: background var(--duration-fast) var(--ease-out);
  }

  .step-dot.active {
    background: var(--accent);
  }

  .step-dot.completed {
    background: var(--ok);
  }

  .nav-buttons {
    display: flex;
    gap: 8px;
  }

  .back-btn {
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .back-btn:hover {
    border-color: var(--text);
    background: var(--bg-hover);
  }

  .next-btn {
    padding: 8px 20px;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--accent);
    color: var(--accent-contrast, white);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .next-btn:hover {
    background: var(--accent-hover);
  }

  @media (prefers-reduced-motion: reduce) {
    .provider-card,
    .tts-option,
    .theme-card,
    .skip-btn,
    .back-btn,
    .next-btn,
    .step-dot,
    .progress-fill {
      transition: none;
    }
  }
</style>
