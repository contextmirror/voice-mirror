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
