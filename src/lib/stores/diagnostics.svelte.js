/**
 * diagnostics.svelte.js -- Central health monitoring store.
 *
 * Subsystems register health contracts declaring what "healthy" means.
 * Periodic checks run every 30s, logging unhealthy states to the Frontend
 * output channel for Claude Code to read.
 *
 * A meta-health-check verifies all expected subsystems are reporting.
 */

import { logFrontendError } from '../api.js';

/** Default check interval: 30 seconds */
const CHECK_INTERVAL = 30000;

/**
 * Expected subsystems — if a subsystem disappears (refactored without
 * updating its health contract), the meta-check catches it.
 * Update this list when adding/removing major subsystems.
 */
const EXPECTED_SUBSYSTEMS = [
  'lsp',
  'terminal',
  'file-watcher',
  'dev-server',
  'editor',
];

/**
 * @typedef {Object} HealthContract
 * @property {string} name - Subsystem name (e.g. 'lsp', 'terminal')
 * @property {() => Promise<HealthResult>|HealthResult} check - Health check function
 * @property {string} description - What this subsystem does
 */

/**
 * @typedef {Object} HealthResult
 * @property {boolean} healthy - Whether the subsystem is healthy
 * @property {string} message - Human-readable status message
 * @property {Object} [details] - Optional structured details for debugging
 */

/** @type {Map<string, HealthContract>} */
let contracts = new Map();

/** @type {Record<string, { healthy: boolean, message: string, lastChecked: number, details?: Object }>} */
let results = $state({});

let intervalId = null;

/** Safe logger — must never throw */
function safeLog(level, message) {
  try {
    logFrontendError({ level, message, context: '' });
  } catch {
    // Swallow
  }
}

/**
 * Register a health contract for a subsystem.
 * Call this from the subsystem's store/component when it initializes.
 */
function registerHealthContract(contract) {
  contracts.set(contract.name, contract);
}

/**
 * Unregister a health contract (e.g. when subsystem is destroyed).
 */
function unregisterHealthContract(name) {
  contracts.delete(name);
  const updated = { ...results };
  delete updated[name];
  results = updated;
}

/**
 * Run all registered health checks and update results.
 */
async function runAllChecks() {
  const updated = { ...results };
  const now = Date.now();

  for (const [name, contract] of contracts) {
    try {
      const result = await contract.check();
      const wasUnhealthy = updated[name] && !updated[name].healthy;
      const isNowUnhealthy = !result.healthy;

      updated[name] = {
        healthy: result.healthy,
        message: result.message,
        lastChecked: now,
        details: result.details || null,
      };

      // Log state transitions and ongoing unhealthy states
      if (isNowUnhealthy) {
        const prefix = wasUnhealthy ? '[STILL UNHEALTHY]' : '[UNHEALTHY]';
        safeLog('WARN', `Health: ${prefix} ${name} — ${result.message}`);
      } else if (wasUnhealthy) {
        safeLog('INFO', `Health: [RECOVERED] ${name} — ${result.message}`);
      }
    } catch (err) {
      updated[name] = {
        healthy: false,
        message: `Health check threw: ${err?.message || err}`,
        lastChecked: now,
      };
      safeLog('WARN', `Health: [CHECK FAILED] ${name} — ${err?.message || err}`);
    }
  }

  // Meta-check: verify all expected subsystems are reporting
  for (const expected of EXPECTED_SUBSYSTEMS) {
    if (!contracts.has(expected) && !updated[`meta:${expected}`]) {
      updated[`meta:${expected}`] = {
        healthy: false,
        message: `Expected subsystem "${expected}" has no health contract registered`,
        lastChecked: now,
      };
      safeLog('WARN', `Health: [META] No health contract for expected subsystem "${expected}"`);
    } else if (contracts.has(expected) && updated[`meta:${expected}`]) {
      // Contract was re-registered — clear meta warning
      delete updated[`meta:${expected}`];
    }
  }

  results = updated;
}

/** Start periodic health monitoring. */
function startMonitoring() {
  if (intervalId) return;
  // Run first check after a short delay (let subsystems initialize)
  setTimeout(() => {
    runAllChecks();
    intervalId = setInterval(runAllChecks, CHECK_INTERVAL);
  }, 5000);
}

/** Stop periodic health monitoring. */
function stopMonitoring() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/** Get all unhealthy subsystems */
function getUnhealthy() {
  return Object.entries(results)
    .filter(([, r]) => !r.healthy)
    .map(([name, r]) => ({ name, ...r }));
}

export const diagnosticsStore = {
  get results() { return results; },
  get unhealthy() { return getUnhealthy(); },
  get contractCount() { return contracts.size; },
  get expectedSubsystems() { return EXPECTED_SUBSYSTEMS; },
  registerHealthContract,
  unregisterHealthContract,
  runAllChecks,
  startMonitoring,
  stopMonitoring,
};
