/**
 * health-contracts.js -- Health contract definitions for all subsystems.
 *
 * Each contract declares what "healthy" means for a subsystem by implementing
 * a check() function that returns { healthy: boolean, message: string, details?: object }.
 *
 * Contracts are registered with the diagnostics store on app startup.
 * When adding new subsystems, add a contract here and add the subsystem name
 * to EXPECTED_SUBSYSTEMS in diagnostics.svelte.js.
 */

import { diagnosticsStore } from './stores/diagnostics.svelte.js';
import { updaterStore } from './stores/updater.svelte.js';
import { detectEspeak, detectGpu, detectProviders, listSttModels } from './api.js';

/**
 * Register all health contracts with the diagnostics store.
 * Called once from App.svelte on mount.
 *
 * @param {Object} deps - Reactive store references passed from App.svelte
 * @param {Function} deps.getProjectPath - Returns current project path or null
 * @param {Function} deps.getOpenTabs - Returns array of open editor tabs
 * @param {Function} deps.getTerminalGroups - Returns terminal groups array
 * @param {Function} deps.getTerminalInstances - Returns instances for a group
 * @param {Function} deps.getLspStatus - Returns LSP connection info
 * @param {Function} deps.getDevServers - Returns dev server info
 */
export function registerAllContracts(deps) {
  // ── LSP ──
  diagnosticsStore.registerHealthContract({
    name: 'lsp',
    description: 'Language Server Protocol integration for code intelligence',
    check() {
      const projectPath = deps.getProjectPath();
      if (!projectPath) {
        return { healthy: true, message: 'No project open — LSP not needed' };
      }
      const status = deps.getLspStatus();
      if (!status || !status.active) {
        return { healthy: true, message: 'LSP not active (no supported files open)' };
      }
      if (status.error) {
        return {
          healthy: false,
          message: `LSP error: ${status.error}`,
          details: status,
        };
      }
      return { healthy: true, message: `LSP running: ${status.serverCount || 0} server(s)` };
    },
  });

  // ── Terminal ──
  diagnosticsStore.registerHealthContract({
    name: 'terminal',
    description: 'Terminal shell instances (PTY connections)',
    check() {
      const groups = deps.getTerminalGroups();
      if (!groups || groups.length === 0) {
        return { healthy: true, message: 'No terminal groups active' };
      }
      let dead = 0;
      let total = 0;
      for (const group of groups) {
        const instances = deps.getTerminalInstances(group.id);
        for (const inst of instances) {
          total++;
          if (!inst.running) {
            dead++;
          }
        }
      }
      if (dead > 0) {
        return {
          healthy: false,
          message: `${dead}/${total} terminal instance(s) not running`,
          details: { dead, total },
        };
      }
      return { healthy: true, message: `${total} terminal instance(s) running` };
    },
  });

  // ── File Watcher ──
  diagnosticsStore.registerHealthContract({
    name: 'file-watcher',
    description: 'File system watcher for project changes',
    check() {
      const projectPath = deps.getProjectPath();
      if (!projectPath) {
        return { healthy: true, message: 'No project open — file watcher not needed' };
      }
      return { healthy: true, message: `Watching: ${projectPath}` };
    },
  });

  // ── Dev Server ──
  diagnosticsStore.registerHealthContract({
    name: 'dev-server',
    description: 'Development server detection and management',
    check() {
      const info = deps.getDevServers();
      if (!info) {
        return { healthy: true, message: 'No dev server detected' };
      }
      const { runningCount, crashedServers } = info;
      if (crashedServers && crashedServers.length > 0) {
        const names = crashedServers.map(s => s.projectPath).join(', ');
        return {
          healthy: false,
          message: `${crashedServers.length} dev server(s) crashed: ${names}`,
          details: { runningCount, crashedServers },
        };
      }
      if (runningCount > 0) {
        return { healthy: true, message: `${runningCount} dev server(s) running` };
      }
      return { healthy: true, message: 'No dev server detected' };
    },
  });

  // ── Updater ──
  diagnosticsStore.registerHealthContract({
    name: 'updater',
    description: 'Auto-update state machine (check / download / restart)',
    check() {
      const state = updaterStore.state;
      // 'disabled' is the normal state outside a packaged build (dev/browser).
      if (state === 'disabled') {
        return { healthy: true, message: 'Updater disabled (not a packaged build)' };
      }
      // An error is only ever set on an explicit, user-initiated check — surface it.
      if (state === 'error') {
        return {
          healthy: false,
          message: `Updater error: ${updaterStore.error || 'unknown'}`,
          details: { state, channel: updaterStore.channel },
        };
      }
      return {
        healthy: true,
        message: `Updater: ${state} (channel: ${updaterStore.channel})`,
        details: { state, version: updaterStore.version },
      };
    },
  });

  // ── Editor ──
  diagnosticsStore.registerHealthContract({
    name: 'editor',
    description: 'CodeMirror file editor state',
    check() {
      const tabs = deps.getOpenTabs();
      if (!tabs || tabs.length === 0) {
        return { healthy: true, message: 'No files open' };
      }
      const dirty = tabs.filter(t => t.dirty).length;
      return {
        healthy: true,
        message: `${tabs.length} file(s) open, ${dirty} unsaved`,
      };
    },
  });

  // ── Text-to-Speech ──
  // The local Kokoro voice needs espeak-ng to turn text into phonemes; without it
  // every phrase is silently skipped (no spoken reply). This contract turns that
  // silent failure into a caught, visible one — the gap that shipped in early builds.
  diagnosticsStore.registerHealthContract({
    name: 'tts',
    description: 'Text-to-speech — espeak-ng phonemizer for the local Kokoro voice',
    async check() {
      try {
        const res = await detectEspeak();
        const d = res?.data ?? res ?? {};
        if (d.found) {
          return { healthy: true, message: `espeak-ng found (${d.source || 'ok'})`, details: d };
        }
        return {
          healthy: false,
          message: 'espeak-ng not found — local (Kokoro) TTS will be silent. Reinstall, or switch to Edge TTS.',
          details: d,
        };
      } catch (e) {
        // Outside Tauri / command unavailable (dev/browser/test) → not applicable.
        return { healthy: true, message: `TTS check unavailable: ${e?.message || e}` };
      }
    },
  });

  // ── AI Provider ──
  // At least one CLI provider (Claude Code / OpenCode / …) must be installed for the
  // Voice Agent to run. Auth is the setup wizard's job (probing it every 30s would be
  // wasteful), so this only checks installation.
  diagnosticsStore.registerHealthContract({
    name: 'provider',
    description: 'AI provider availability (Claude Code / OpenCode / …)',
    async check() {
      try {
        const d = (await detectProviders())?.data ?? {};
        const list = Array.isArray(d.providers) ? d.providers : [];
        const installed = list.filter((p) => p.installed);
        const ready = list.filter((p) => p.ready);
        if (installed.length === 0) {
          return { healthy: false, message: 'No AI provider detected — install one (e.g. Claude Code) via setup.' };
        }
        return {
          healthy: true,
          message: `${installed.length} provider(s) installed${ready.length ? `, ${ready.length} signed in` : ''}`,
          details: { installed: installed.map((p) => p.provider_type ?? p.providerType ?? p.command) },
        };
      } catch (e) {
        return { healthy: true, message: `Provider check unavailable: ${e?.message || e}` };
      }
    },
  });

  // ── Speech-to-Text ──
  // Voice input needs a Whisper model on disk to transcribe.
  diagnosticsStore.registerHealthContract({
    name: 'stt',
    description: 'Speech-to-text — Whisper model availability',
    async check() {
      try {
        const d = (await listSttModels())?.data ?? {};
        const models = Array.isArray(d.models) ? d.models : [];
        if (models.length === 0) {
          return { healthy: false, message: 'No Whisper STT model installed — voice input won’t transcribe. Download one in setup/Settings.' };
        }
        return { healthy: true, message: `${models.length} STT model(s): ${models.map((m) => m.modelSize).join(', ')}`, details: { models } };
      } catch (e) {
        return { healthy: true, message: `STT check unavailable: ${e?.message || e}` };
      }
    },
  });

  // ── GPU / CUDA (advisory — never blocks; CPU inference works without it) ──
  diagnosticsStore.registerHealthContract({
    name: 'gpu',
    description: 'GPU / CUDA acceleration (advisory)',
    async check() {
      try {
        const d = (await detectGpu())?.data ?? {};
        if (d.available && d.cudaCompiled && d.vendor === 'nvidia') {
          return { healthy: true, message: `GPU: ${d.name} (CUDA accelerated)`, details: d };
        }
        if (d.available) {
          return { healthy: true, message: `GPU: ${d.name || d.vendor} (CPU inference — no CUDA)`, details: d };
        }
        return { healthy: true, message: 'No discrete GPU — CPU inference', details: d };
      } catch (e) {
        return { healthy: true, message: `GPU check unavailable: ${e?.message || e}` };
      }
    },
  });
}
