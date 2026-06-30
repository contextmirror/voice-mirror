/**
 * onboarding.test.cjs
 *
 * Phase 1 of the onboarding feature: adaptive welcome wizard + provider
 * detection + auto-connect. Source-inspection tests across the Rust backend,
 * config wiring, and the Svelte wizard.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

describe('backend: detect_providers command', () => {
  const src = read('src-tauri/src/commands/onboarding.rs');

  it('defines the detect_providers Tauri command', () => {
    assert.ok(src.includes('#[tauri::command]'), 'Should be a Tauri command');
    assert.ok(src.includes('pub fn detect_providers'), 'Should define detect_providers');
  });

  it('reports installed/version/path plus an auth state and ready flag', () => {
    assert.ok(src.includes('struct ProviderStatus'), 'Should define ProviderStatus');
    for (const field of ['installed', 'version', 'path', 'auth_state', 'ready']) {
      assert.ok(src.includes(field), `ProviderStatus should carry ${field}`);
    }
  });

  it('models auth as a 4-state enum (logged in / out / expired / unknown)', () => {
    assert.ok(src.includes('enum AuthState'), 'Should define AuthState');
    for (const variant of ['LoggedIn', 'LoggedOut', 'Expired', 'Unknown']) {
      assert.ok(src.includes(variant), `AuthState should include ${variant}`);
    }
  });

  it('detects auth passively — never invokes the CLI', () => {
    // Auth detection must read credential files only. (install_provider, later
    // in the file, legitimately spawns the package manager — so scope the
    // "no spawning" check to just the auth-detection region.)
    assert.ok(src.includes('.credentials.json'), 'Should check Claude credential file');
    assert.ok(src.includes('.codex'), 'Should check Codex auth');
    assert.ok(src.includes('opencode'), 'Should check OpenCode auth');
    const authStart = src.indexOf('fn detect_auth');
    const authEnd = src.indexOf('pub fn detect_providers');
    assert.ok(authStart >= 0 && authEnd > authStart, 'auth-detection region should exist');
    const authRegion = src.slice(authStart, authEnd);
    assert.ok(!authRegion.includes('Command::new'), 'auth detection must not spawn the CLI');
  });

  it('parses Claude token expiry to distinguish expired from valid', () => {
    assert.ok(src.includes('expiresAt'), 'Should read expiresAt');
    assert.ok(src.includes('Expired'), 'Should be able to report Expired');
  });

  it('is registered in lib.rs', () => {
    const lib = read('src-tauri/src/lib.rs');
    assert.ok(lib.includes('onboarding_cmds::detect_providers'), 'Should register detect_providers');
  });
});

describe('backend: install_provider command (Phase 2)', () => {
  const src = read('src-tauri/src/commands/onboarding.rs');

  it('defines the install_provider command', () => {
    assert.ok(src.includes('pub async fn install_provider'), 'Should define install_provider');
  });

  it('maps each provider to a package-manager install spec', () => {
    assert.ok(src.includes('enum InstallMethod'), 'Should define InstallMethod');
    assert.ok(src.includes('Npm(') && src.includes('Pip('), 'Should support npm and pip');
    assert.ok(src.includes('@anthropic-ai/claude-code'), 'Should know the Claude Code package');
  });

  it('requires the package manager up front with an actionable error', () => {
    assert.ok(src.includes('is_cli_available(tool)'), 'Should check the package manager exists');
    assert.ok(src.includes('is required to install'), 'Should give an actionable message');
  });

  it('re-detects after install and reports whether a restart is needed', () => {
    assert.ok(src.includes('detect_tool(&command).available'), 'Should re-detect post-install');
    assert.ok(src.includes('"detected"'), 'Should return the detected flag');
  });

  it('is registered in lib.rs', () => {
    const lib = read('src-tauri/src/lib.rs');
    assert.ok(lib.includes('onboarding_cmds::install_provider'), 'Should register install_provider');
  });

  it('frontend exposes installProvider and the wizard wires an Install button', () => {
    const api = read('src/lib/api.js');
    assert.ok(api.includes('export async function installProvider'), 'api.js should expose installProvider');
    const wiz = read('src/components/onboarding/WelcomeWizard.svelte');
    assert.ok(wiz.includes('installProvider'), 'Wizard should call installProvider');
    assert.ok(wiz.includes("installing === p.providerType ? 'Installing"), 'Should show installing state');
    assert.ok(wiz.includes('restart Voice Mirror'), 'Should handle the PATH-not-refreshed restart case');
  });
});

describe('backend: live auth probe (Phase 3)', () => {
  const src = read('src-tauri/src/commands/onboarding.rs');

  it('defines probe_provider_auth using real status subcommands', () => {
    assert.ok(src.includes('pub async fn probe_provider_auth'), 'Should define probe_provider_auth');
    assert.ok(src.includes('claude auth status --json'), 'Should use the verified Claude status command');
    assert.ok(src.includes('codex login status'), 'Should use the verified Codex status command');
    assert.ok(src.includes('opencode auth list'), 'Should use the verified OpenCode status command');
  });

  it('nulls stdin so a probe can never hang on input', () => {
    assert.ok(src.includes('Stdio::null()'), 'Probe should null stdin');
  });

  it('handles the "not logged in" substring trap for codex', () => {
    assert.ok(src.includes('not logged in'), 'Should check not-logged-in before logged-in');
  });

  it('is registered in lib.rs', () => {
    const lib = read('src-tauri/src/lib.rs');
    assert.ok(lib.includes('onboarding_cmds::probe_provider_auth'), 'Should register probe_provider_auth');
  });

  it('wizard refines auth with live probes and gives verified sign-in commands', () => {
    const wiz = read('src/components/onboarding/WelcomeWizard.svelte');
    assert.ok(wiz.includes('refineAuth'), 'Should refine auth after detect');
    assert.ok(wiz.includes('probeProviderAuth'), 'Should call probeProviderAuth');
    assert.ok(wiz.includes("claude: 'claude auth login'"), 'Should use verified login commands');
  });
});

describe('config: onboardingCompleted flag', () => {
  it('exists in the Rust schema (SystemConfig)', () => {
    const schema = read('src-tauri/src/config/schema.rs');
    assert.ok(schema.includes('onboarding_completed'), 'SystemConfig should have onboarding_completed');
  });

  it('exists in the frontend DEFAULT_CONFIG', () => {
    const cfg = read('src/lib/stores/config.svelte.js');
    assert.ok(cfg.includes('onboardingCompleted'), 'DEFAULT_CONFIG.system should have onboardingCompleted');
  });
});

describe('frontend: WelcomeWizard', () => {
  const wiz = read('src/components/onboarding/WelcomeWizard.svelte');

  it('detects providers on mount', () => {
    assert.ok(wiz.includes('detectProviders'), 'Should call detectProviders');
  });

  it('is adaptive — collapses for ready users', () => {
    assert.ok(wiz.includes('anyReady'), 'Should compute anyReady');
    assert.ok(wiz.includes("You're all set") || wiz.includes('all set'), 'Should show the all-set state');
  });

  it('always offers skip and re-check (never gates the core loop)', () => {
    assert.ok(/Skip for now/i.test(wiz), 'Should offer Skip for now');
    assert.ok(/Re-check/i.test(wiz), 'Should offer Re-check');
  });

  it('connecting persists the provider and marks onboarding complete', () => {
    assert.ok(wiz.includes("updateConfig({ ai: { provider:"), 'Connect should persist the chosen provider');
    assert.ok(wiz.includes('onboardingCompleted: true'), 'Finishing should set onboardingCompleted');
  });

  it('navigates into the app after finishing', () => {
    assert.ok(wiz.includes("navigationStore.setView('chat')"), 'Should land the user in chat');
  });
});

describe('Phase 4: polish — re-run, a11y, edge cases', () => {
  it('onboarding store supports forced re-open', () => {
    const store = read('src/lib/stores/onboarding.svelte.js');
    assert.ok(store.includes('forceOpen'), 'Should track forceOpen');
    assert.ok(store.includes('open()') && store.includes('close()'), 'Should expose open/close');
  });

  it('App gate honours a forced re-open', () => {
    const app = read('src/App.svelte');
    assert.ok(app.includes('onboardingStore.forceOpen'), 'showWelcome should consider forceOpen');
  });

  it('Settings offers "Run welcome setup again"', () => {
    const bs = read('src/components/settings/BehaviorSettings.svelte');
    assert.ok(bs.includes('onboardingStore.open()'), 'Should re-open the wizard');
    assert.ok(/Run welcome setup again/i.test(bs), 'Should label the button');
  });

  it('wizard is an accessible dialog with Escape-to-skip', () => {
    const wiz = read('src/components/onboarding/WelcomeWizard.svelte');
    assert.ok(wiz.includes('role="dialog"'), 'Should be a dialog');
    assert.ok(wiz.includes('aria-modal="true"'), 'Should be modal');
    assert.ok(wiz.includes('handleKeydown') && wiz.includes("e.key === 'Escape'"), 'Escape should skip');
  });

  it('wizard handles the no-providers-detected edge case', () => {
    const wiz = read('src/components/onboarding/WelcomeWizard.svelte');
    assert.ok(wiz.includes('providers.length === 0'), 'Should handle empty detection');
  });

  it('finishing clears the forced-open flag and gives a voice tip', () => {
    const wiz = read('src/components/onboarding/WelcomeWizard.svelte');
    assert.ok(wiz.includes('onboardingStore.close()'), 'finish should clear forceOpen');
    assert.ok(/push-to-talk/i.test(wiz), 'Should orient the user to voice');
  });
});

describe('Phase 3: multi-step setup checklist', () => {
  const wiz = read('src/components/onboarding/WelcomeWizard.svelte');

  it('models a multi-step checklist (provider → stt → tts → gpu)', () => {
    assert.ok(wiz.includes('const STEPS'), 'Should define a STEPS array');
    for (const id of ['provider', 'stt', 'tts', 'gpu']) {
      assert.ok(wiz.includes(`id: '${id}'`), `Steps should include the ${id} step`);
    }
    assert.ok(wiz.includes('currentStep'), 'Should track the active step index');
  });

  it('renders an "X of Y complete" progress header', () => {
    assert.ok(wiz.includes('completeCount'), 'Should compute completeCount');
    assert.ok(/of \{STEPS\.length\} complete/.test(wiz), 'Should render X of Y complete');
  });

  it('auto-completes each step from detection (not click-to-complete)', () => {
    assert.ok(wiz.includes('statusFor'), 'Should compute per-step status');
    assert.ok(wiz.includes("'done'") && wiz.includes("'attention'"), 'Steps carry done/attention status');
    // Status is derived, not set on click.
    assert.ok(wiz.includes('$derived'), 'Step status should be derived from detection');
  });

  it('collapses to "You\'re all set" when every step is complete', () => {
    assert.ok(wiz.includes('allComplete'), 'Should compute allComplete');
    assert.ok(wiz.includes("You're all set"), 'Should show the all-set state');
  });

  it('STT step detects models and offers a download with live progress', () => {
    assert.ok(wiz.includes('listSttModels'), 'Should detect installed STT models');
    assert.ok(wiz.includes('ensureSttModel'), 'Should download a model');
    assert.ok(wiz.includes("listen('stt-download-progress'"), 'Should listen to download progress');
    assert.ok(wiz.includes('downloadedMb') && wiz.includes('totalMb'), 'Should surface download progress');
    assert.ok(wiz.includes('suggestedSttSize'), 'Should suggest a size by VRAM');
    assert.ok(wiz.includes('vramMb'), 'Suggestion should consider VRAM');
  });

  it('TTS step verifies espeak-ng and warns (skippable) when missing', () => {
    assert.ok(wiz.includes('detectEspeak'), 'Should verify espeak-ng');
    assert.ok(/espeak-ng ready/i.test(wiz), 'Should show the ready state');
    assert.ok(/Edge TTS/i.test(wiz), 'Should mention Edge TTS as the fallback');
    assert.ok(wiz.includes('ttsSkipped'), 'TTS step should be skippable');
    assert.ok(wiz.includes('Skip this step'), 'Should offer to skip the TTS step');
  });

  it('GPU step is advisory and offers a persisted CUDA toggle', () => {
    assert.ok(wiz.includes('detectGpu'), 'Should detect the GPU');
    assert.ok(wiz.includes('cudaCompiled'), 'Should read the CUDA-compiled flag');
    assert.ok(wiz.includes("updateConfig({ voice: { sttUseGpu:"), 'GPU toggle should persist via updateConfig');
    // GPU never blocks — always counts complete.
    assert.ok(/gpu:\s*'done'/.test(wiz), 'GPU step should always be complete');
  });

  it('re-check re-runs every step\'s detection', () => {
    assert.ok(wiz.includes('recheckAll'), 'Should expose a recheckAll');
    assert.ok(wiz.includes('detectStt') && wiz.includes('detectTts') && wiz.includes('detectGpuStep'), 'Should re-detect each step');
  });

  it('finish hands off to the GettingStarted tutorial', () => {
    assert.ok(wiz.includes("new CustomEvent('show-tutorial')"), 'Finishing should dispatch show-tutorial');
    assert.ok(wiz.includes('onboardingCompleted: true'), 'Finishing should still persist completion');
  });

  it('never traps — Back/Skip/Esc all available', () => {
    assert.ok(wiz.includes('goBack') && wiz.includes('goNext'), 'Should offer Back/Next navigation');
    assert.ok(/Skip for now/i.test(wiz), 'Should still offer Skip for now');
    assert.ok(wiz.includes("e.key === 'Escape'"), 'Escape should skip');
  });
});

describe('App.svelte: first-run gating', () => {
  const app = read('src/App.svelte');

  it('imports and renders the WelcomeWizard', () => {
    assert.ok(app.includes("import WelcomeWizard from './components/onboarding/WelcomeWizard.svelte'"), 'Should import it');
    assert.ok(app.includes('<WelcomeWizard'), 'Should render it');
  });

  it('gates on config-loaded + onboardingCompleted', () => {
    assert.ok(app.includes('showWelcome'), 'Should derive showWelcome');
    assert.ok(app.includes('onboardingCompleted'), 'Should check the persisted flag');
    assert.ok(app.includes('{:else if showWelcome}'), 'Should branch on showWelcome before the app shell');
  });
});
