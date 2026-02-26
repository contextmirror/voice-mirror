/**
 * dev-server-manager.svelte.js -- Svelte 5 reactive store for dev server lifecycle management.
 *
 * Manages starting/stopping dev servers, port polling, crash detection with
 * crash-loop protection, idle timeouts on project switch, and LRU eviction
 * to cap concurrent running servers.
 */

import { terminalSpawn, terminalInput, terminalKill, probePort, lensNavigate, killPortProcess } from '../api.js';
import { terminalTabsStore } from './terminal-tabs.svelte.js';
import { lensStore } from './lens.svelte.js';
import { toastStore } from './toast.svelte.js';

// -- Constants --
const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 30000;
const IDLE_TIMEOUT = 300000; // 5 minutes
const MAX_CONCURRENT = 3;
const CRASH_LOOP_COUNT = 3;
const CRASH_LOOP_WINDOW = 300000; // 5 minutes

/**
 * @typedef {Object} ServerState
 * @property {string} status
 * @property {string|null} shellId
 * @property {number|null} port
 * @property {string|null} framework
 * @property {string|null} url
 * @property {number} crashCount
 * @property {number|null} lastCrashTime
 * @property {number} lastActiveTime
 * @property {boolean} crashLoopDetected
 */

function createDevServerManager() {
  /** @type {Map<string, ServerState>} projectPath -> server state */
  let servers = $state(new Map());

  /** @type {Map<string, number>} projectPath -> setTimeout id for idle */
  const idleTimers = new Map();

  /** @type {Map<string, { interval: number, reject: (err: Error) => void }>} projectPath -> port poll state */
  const pollTimers = new Map();

  /**
   * Get or create server state for a project path.
   * @param {string} projectPath
   * @returns {ServerState}
   */
  function getOrCreateState(projectPath) {
    if (!servers.has(projectPath)) {
      servers.set(projectPath, {
        status: 'stopped',
        shellId: null,
        port: null,
        framework: null,
        url: null,
        crashCount: 0,
        lastCrashTime: null,
        lastActiveTime: Date.now(),
        crashLoopDetected: false,
      });
      // Trigger reactivity by reassigning
      servers = new Map(servers);
    }
    return servers.get(projectPath);
  }

  /**
   * Update server state and trigger reactivity.
   * @param {string} projectPath
   * @param {Partial<ServerState>} updates
   */
  function updateState(projectPath, updates) {
    const state = servers.get(projectPath);
    if (!state) return;
    Object.assign(state, updates);
    servers = new Map(servers);
  }

  /**
   * Find the least-recently-used idle server for eviction.
   * @returns {string|null} projectPath of the LRU idle server
   */
  function findLRUIdle() {
    let oldest = null;
    let oldestTime = Infinity;
    for (const [pp, state] of servers) {
      if (state.status === 'idle' && state.lastActiveTime < oldestTime) {
        oldest = pp;
        oldestTime = state.lastActiveTime;
      }
    }
    return oldest;
  }

  /**
   * Count currently running or starting servers.
   * @returns {number}
   */
  function countRunning() {
    let count = 0;
    for (const [, state] of servers) {
      if (state.status === 'running' || state.status === 'idle') {
        count++;
      }
    }
    return count;
  }

  /**
   * Poll a port until it's listening or timeout is reached.
   * @param {number} port
   * @param {string} projectPath
   * @returns {Promise<boolean>}
   */
  function pollPort(port, projectPath) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(async () => {
        try {
          const result = await probePort(port);
          if (result?.success && result?.data?.listening) {
            clearInterval(interval);
            pollTimers.delete(projectPath);
            resolve(true);
            return;
          }
        } catch {
          // Port not ready yet, keep polling
        }

        if (Date.now() - startTime >= POLL_TIMEOUT) {
          clearInterval(interval);
          pollTimers.delete(projectPath);
          resolve(false);
        }
      }, POLL_INTERVAL);

      pollTimers.set(projectPath, { interval, reject });
    });
  }

  /**
   * Stop polling for a project's port.
   * @param {string} projectPath
   */
  function cancelPoll(projectPath) {
    const poll = pollTimers.get(projectPath);
    if (poll) {
      clearInterval(poll.interval);
      poll.reject(new Error('cancelled'));
      pollTimers.delete(projectPath);
    }
  }

  /**
   * Clear an idle timer for a project.
   * @param {string} projectPath
   */
  function cancelIdleTimer(projectPath) {
    const timer = idleTimers.get(projectPath);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(projectPath);
    }
  }

  /**
   * Evict the LRU idle server if at capacity.
   */
  async function evictIfNeeded() {
    while (countRunning() >= MAX_CONCURRENT) {
      const lru = findLRUIdle();
      if (!lru) break; // No idle servers to evict
      await stopServer(lru);
    }
  }

  /**
   * Start a dev server for a project.
   * @param {{ url: string, port: number, framework?: string, start_command?: string }} server
   * @param {string} projectPath
   * @param {string} [packageManager]
   */
  async function startServer(server, projectPath, packageManager) {
    const state = getOrCreateState(projectPath);

    // Already running or starting
    if (state.status === 'running' || state.status === 'starting') return;

    // Crash loop protection
    if (state.crashLoopDetected) {
      toastStore.addToast({
        message: `Crash loop detected for ${server.framework || 'server'} — not restarting`,
        severity: 'error',
      });
      return;
    }

    // Set status to 'starting' synchronously to prevent race conditions
    updateState(projectPath, {
      status: 'starting',
      port: server.port,
      framework: server.framework || null,
      url: server.url,
      lastActiveTime: Date.now(),
    });

    // Evict LRU if at capacity (after marking as starting so guard check works)
    await evictIfNeeded();

    // Spawn PTY
    try {
      const result = await terminalSpawn({ cwd: projectPath });
      if (!result?.success || !result?.data?.id) {
        updateState(projectPath, { status: 'stopped' });
        toastStore.addToast({
          message: 'Failed to spawn terminal for dev server',
          severity: 'error',
        });
        return;
      }

      const shellId = result.data.id;
      updateState(projectPath, { shellId });

      // Add terminal tab
      const tabTitle = server.framework
        ? `${server.framework} :${server.port}`
        : `Localhost :${server.port}`;

      terminalTabsStore.addDevServerTab({
        shellId,
        title: tabTitle,
        projectPath,
        framework: server.framework,
        port: server.port,
      });

      // Build start command with correct package manager prefix
      let startCommand = server.start_command || 'npm run dev';
      if (packageManager && packageManager !== 'npm' && startCommand.startsWith('npm run ')) {
        const script = startCommand.replace('npm run ', '');
        startCommand = `${packageManager} run ${script}`;
      }

      // Send start command
      await terminalInput(shellId, startCommand + '\n');

      // Poll port (may be cancelled via cancelPoll)
      let ready = false;
      try {
        ready = await pollPort(server.port, projectPath);
      } catch (err) {
        if (err?.message === 'cancelled') return;
        throw err;
      }

      if (ready) {
        updateState(projectPath, { status: 'running', lastActiveTime: Date.now() });
        await lensNavigate(server.url);
        toastStore.addToast({
          message: `${server.framework || 'Server'} ready on :${server.port}`,
          severity: 'success',
        });
      } else {
        // Timeout -- don't kill, let user check terminal
        updateState(projectPath, { status: 'running', lastActiveTime: Date.now() });
        toastStore.addToast({
          message: "Server didn't start — check terminal",
          severity: 'error',
        });
      }
    } catch (err) {
      console.error('[dev-server-manager] Start failed:', err);
      updateState(projectPath, { status: 'stopped' });
      toastStore.addToast({
        message: `Dev server start failed: ${err.message || err}`,
        severity: 'error',
      });
    }
  }

  /**
   * Stop a dev server for a project.
   * @param {string} projectPath
   */
  async function stopServer(projectPath) {
    const state = servers.get(projectPath);
    if (!state || !state.shellId) return;

    cancelPoll(projectPath);
    cancelIdleTimer(projectPath);

    // Capture shellId, then clear it BEFORE killing so handleShellExit
    // won't match this shell and wrongly report it as a crash.
    const shellId = state.shellId;
    updateState(projectPath, {
      status: 'stopped',
      shellId: null,
    });

    try {
      await terminalKill(shellId);
    } catch (err) {
      console.warn('[dev-server-manager] Kill failed:', err);
    }

    terminalTabsStore.markExited(shellId);
  }

  /**
   * Stop an externally-running server by killing its port process.
   * Used for servers we didn't start (no shellId), detected as already running.
   * @param {number} port
   */
  async function stopExternalServer(port) {
    let killed = false;
    try {
      /** @type {any} */
      const result = await killPortProcess(port);
      if (result?.success && result?.data?.killed) {
        killed = true;
        toastStore.addToast({
          message: `Stopped process on :${port}`,
          severity: 'success',
        });
      } else {
        toastStore.addToast({
          message: result?.error || `Failed to stop process on :${port}`,
          severity: 'error',
        });
      }
    } catch (err) {
      console.error('[dev-server-manager] Kill port failed:', err);
      toastStore.addToast({
        message: `Failed to stop process on :${port}: ${err.message || err}`,
        severity: 'error',
      });
    }
    // Only update the server list if we actually killed the process
    if (killed) {
      const current = lensStore.devServers;
      const updated = current.map(s =>
        s.port === port ? { ...s, running: false } : s
      );
      lensStore.setDevServers(updated);
    }
  }

  /**
   * Restart a dev server -- stops then starts again.
   * Requires the original server config to be stored or passed again.
   * @param {string} projectPath
   */
  async function restartServer(projectPath) {
    const state = servers.get(projectPath);
    if (!state) return;

    // Preserve server info for restart
    const serverConfig = {
      url: state.url,
      port: state.port,
      framework: state.framework,
    };

    await stopServer(projectPath);

    // Reset crash state so manual restart works even after crash loop
    updateState(projectPath, { crashCount: 0, crashLoopDetected: false, lastCrashTime: null });

    // Small delay to let the process fully exit
    await new Promise(resolve => setTimeout(resolve, 500));

    await startServer(serverConfig, projectPath);
  }

  /**
   * Get current server status for a project.
   * @param {string} projectPath
   * @returns {ServerState|null}
   */
  function getServerStatus(projectPath) {
    return servers.get(projectPath) || null;
  }

  /**
   * Handle crash detection when a dev-server shell exits.
   * @param {string} shellId
   * @param {number} [exitCode]
   */
  function handleShellExit(shellId, exitCode) {
    // Find which project this shell belongs to
    let crashedProject = null;
    for (const [pp, state] of servers) {
      if (state.shellId === shellId) {
        crashedProject = pp;
        break;
      }
    }
    if (!crashedProject) return;

    const state = servers.get(crashedProject);
    if (!state) return;

    const wasRunning = state.status === 'running' || state.status === 'starting';

    // Update crash tracking
    const now = Date.now();
    let crashCount = state.crashCount;
    const lastCrashTime = state.lastCrashTime;

    // Reset crash count if outside the window
    if (lastCrashTime && (now - lastCrashTime) > CRASH_LOOP_WINDOW) {
      crashCount = 0;
    }

    if (wasRunning || (exitCode !== undefined && exitCode !== 0)) {
      crashCount++;
    }

    const crashLoopDetected = crashCount >= CRASH_LOOP_COUNT;

    updateState(crashedProject, {
      status: 'crashed',
      shellId: null,
      crashCount,
      lastCrashTime: now,
      crashLoopDetected,
    });

    cancelPoll(crashedProject);
    cancelIdleTimer(crashedProject);

    if (crashLoopDetected) {
      toastStore.addToast({
        message: `${state.framework || 'Server'} crash loop detected (${CRASH_LOOP_COUNT} crashes in ${CRASH_LOOP_WINDOW / 60000}min) — auto-restart disabled`,
        severity: 'error',
        duration: 0,
      });
    } else if (wasRunning) {
      toastStore.addToast({
        message: `${state.framework || 'Dev server'} crashed unexpectedly`,
        severity: 'warning',
      });
    }
  }

  /**
   * Handle project switch -- start idle timer for old project, cancel timer for new project.
   * @param {string|null} oldPath
   * @param {string|null} newPath
   */
  function handleProjectSwitch(oldPath, newPath) {
    // Cancel idle timer for the project we're switching TO
    if (newPath) {
      cancelIdleTimer(newPath);
      const newState = servers.get(newPath);
      if (newState && newState.status === 'idle') {
        updateState(newPath, { status: 'running', lastActiveTime: Date.now() });
      }
    }

    // Start idle timer for the project we're leaving
    if (oldPath) {
      const oldState = servers.get(oldPath);
      if (oldState && (oldState.status === 'running' || oldState.status === 'starting')) {
        updateState(oldPath, { status: 'idle' });
        const timer = setTimeout(() => {
          idleTimers.delete(oldPath);
          stopServer(oldPath);
        }, IDLE_TIMEOUT);
        idleTimers.set(oldPath, timer);
      }
    }
  }

  return {
    get servers() { return servers; },

    get runningCount() {
      return countRunning();
    },

    get crashedServers() {
      const crashed = [];
      for (const [pp, state] of servers) {
        if (state.status === 'crashed') {
          crashed.push({ projectPath: pp, ...state });
        }
      }
      return crashed;
    },

    startServer,
    stopServer,
    stopExternalServer,
    restartServer,
    getServerStatus,
    handleShellExit,
    handleProjectSwitch,

    // Exposed for testing
    POLL_INTERVAL,
    POLL_TIMEOUT,
    IDLE_TIMEOUT,
    MAX_CONCURRENT,
    CRASH_LOOP_COUNT,
    CRASH_LOOP_WINDOW,
  };
}

export const devServerManager = createDevServerManager();

export {
  POLL_INTERVAL,
  POLL_TIMEOUT,
  IDLE_TIMEOUT,
  MAX_CONCURRENT,
  CRASH_LOOP_COUNT,
  CRASH_LOOP_WINDOW,
};
