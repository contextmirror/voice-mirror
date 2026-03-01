# Runtime Diagnostics System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 3-layer self-diagnostic system that captures runtime errors, monitors subsystem health, and audits user interactions — writing everything to JSONL log files that Claude Code can read directly to find bugs without requiring the user to describe them.

**Architecture:** Three layers, each building on the previous. Layer 1 captures unhandled errors and `console.error`/`console.warn` calls via global handlers in `main.js`, forwarding them to a new `Frontend` output channel in the Rust backend. Layer 2 adds health monitors — each subsystem declares a health contract (what "healthy" means), a central `diagnostics.svelte.js` store runs periodic checks (every 30s) and logs unhealthy states. Layer 3 adds interaction auditing — key user actions (file opens, tab switches, LSP requests) are logged with timestamps so Claude Code can trace sequences when debugging. A meta-health-check ensures all expected subsystems report health. The CLAUDE.md wiring checklist gets a new bullet requiring health contracts for new features.

**Tech Stack:** Svelte 5 runes, Tauri invoke(), Rust `tracing`, existing OutputStore/LogFileWriter infrastructure, `node:test` source-inspection tests.

---

## Layer 1: Error Capture

### Task 1: Add `Frontend` Channel to Rust Output System

**Files:**
- Modify: `src-tauri/src/services/output.rs` (Channel enum, ALL array, as_str, from_str, idx)
- Modify: `src-tauri/src/commands/output.rs` (add `log_frontend_error` command)
- Modify: `src-tauri/src/lib.rs` (register new command in invoke_handler)
- Modify: `src/lib/api.js` (add `logFrontendError` wrapper)
- Modify: `src/lib/stores/output.svelte.js` (add `frontend` to CHANNELS/entries/labels)
- Test: `test/stores/output.test.cjs` (new or append)

**Step 1: Write failing tests for the new channel and API wrapper**

Create `test/diagnostics/frontend-channel.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const outputRs = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/output.rs'), 'utf-8'
);
const commandsRs = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/output.rs'), 'utf-8'
);
const libRs = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8'
);
const apiJs = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);
const outputStore = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/output.svelte.js'), 'utf-8'
);

describe('Frontend output channel -- Rust backend', () => {
  it('has Frontend variant in Channel enum', () => {
    assert.ok(outputRs.includes('Frontend'), 'Channel enum should have Frontend variant');
  });

  it('includes Frontend in Channel::ALL array', () => {
    // ALL array should have 6 channels now
    assert.ok(outputRs.includes('Channel::Frontend'), 'ALL should include Channel::Frontend');
  });

  it('maps Frontend to "frontend" string', () => {
    assert.ok(outputRs.includes('"frontend"'), 'as_str should return "frontend"');
  });

  it('parses "frontend" back to Frontend variant', () => {
    assert.ok(
      outputRs.includes('"frontend" => Some(Channel::Frontend)'),
      'from_str should parse "frontend"'
    );
  });

  it('has idx mapping for Frontend', () => {
    assert.ok(outputRs.includes('Channel::Frontend =>'), 'idx should map Frontend');
  });
});

describe('Frontend output channel -- log_frontend_error command', () => {
  it('has log_frontend_error command in commands/output.rs', () => {
    assert.ok(commandsRs.includes('log_frontend_error'), 'Should have log_frontend_error command');
    assert.ok(commandsRs.includes('#[tauri::command]'), 'Should be a tauri command');
  });

  it('accepts level, message, and context fields', () => {
    assert.ok(commandsRs.includes('level'), 'Should accept level');
    assert.ok(commandsRs.includes('message'), 'Should accept message');
    assert.ok(commandsRs.includes('context'), 'Should accept context (stack, component info)');
  });

  it('injects into Frontend channel', () => {
    assert.ok(
      commandsRs.includes('Channel::Frontend'),
      'Should inject into Frontend channel'
    );
  });

  it('is registered in lib.rs invoke_handler', () => {
    assert.ok(
      libRs.includes('output_cmds::log_frontend_error'),
      'Should be registered in invoke_handler'
    );
  });
});

describe('Frontend output channel -- api.js wrapper', () => {
  it('exports logFrontendError function', () => {
    assert.ok(apiJs.includes('logFrontendError'), 'Should export logFrontendError');
    assert.ok(apiJs.includes("'log_frontend_error'"), 'Should invoke log_frontend_error');
  });
});

describe('Frontend output channel -- output store', () => {
  it('includes frontend in CHANNELS array', () => {
    assert.ok(outputStore.includes("'frontend'"), 'CHANNELS should include frontend');
  });

  it('has frontend in entries state', () => {
    assert.ok(outputStore.includes('frontend:'), 'entries should have frontend key');
  });

  it('has Frontend label in CHANNEL_LABELS', () => {
    assert.ok(
      outputStore.includes("frontend:") && outputStore.includes("Frontend"),
      'CHANNEL_LABELS should have frontend entry'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/frontend-channel.test.cjs`
Expected: All FAIL (no Frontend channel exists yet)

**Step 3: Implement the Rust changes**

In `src-tauri/src/services/output.rs`:

Add `Frontend` to the `Channel` enum:
```rust
pub enum Channel {
    App,
    Cli,
    Voice,
    Mcp,
    Browser,
    Frontend,
}
```

Update `ALL`:
```rust
pub const ALL: [Channel; 6] = [
    Channel::App,
    Channel::Cli,
    Channel::Voice,
    Channel::Mcp,
    Channel::Browser,
    Channel::Frontend,
];
```

Update `as_str`:
```rust
Channel::Frontend => "frontend",
```

Update `from_str`:
```rust
"frontend" => Some(Channel::Frontend),
```

Update `idx`:
```rust
Channel::Frontend => 5,
```

In `src-tauri/src/commands/output.rs`, add the new command:

```rust
#[derive(Debug, Deserialize)]
pub struct FrontendErrorParams {
    pub level: String,
    pub message: String,
    pub context: Option<String>,
}

#[tauri::command]
pub fn log_frontend_error(
    params: FrontendErrorParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    let full_message = if let Some(ctx) = &params.context {
        format!("{}\n{}", params.message, ctx)
    } else {
        params.message.clone()
    };

    output_store.inject(
        Channel::Frontend,
        &params.level,
        &full_message,
    );
    Ok(())
}
```

In `src-tauri/src/lib.rs`, add to invoke_handler after `output_cmds::get_output_logs`:
```rust
output_cmds::log_frontend_error,
```

**Step 4: Implement the frontend changes**

In `src/lib/api.js`, add to the Output / Diagnostics section:
```js
export async function logFrontendError(params) {
  return invoke('log_frontend_error', { params });
}
```

In `src/lib/stores/output.svelte.js`:

Update `CHANNELS`:
```js
const CHANNELS = ['app', 'cli', 'voice', 'mcp', 'browser', 'frontend'];
```

Update `CHANNEL_LABELS`:
```js
frontend: 'Frontend Errors',
```

Update `entries` initial state:
```js
let entries = $state({
  app: [],
  cli: [],
  voice: [],
  mcp: [],
  browser: [],
  frontend: [],
});
```

**Step 5: Run tests to verify they pass**

Run: `node --test test/diagnostics/frontend-channel.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All existing + new tests PASS

**Step 6: Commit**

```bash
git add src-tauri/src/services/output.rs src-tauri/src/commands/output.rs src-tauri/src/lib.rs src/lib/api.js src/lib/stores/output.svelte.js test/diagnostics/frontend-channel.test.cjs
git commit -m "feat: add Frontend output channel for runtime error capture"
```

---

### Task 2: Global Error Handlers in main.js

**Files:**
- Modify: `src/main.js` (add `window.onerror`, `window.onunhandledrejection`, `console.error`/`console.warn` intercepts)
- Test: `test/diagnostics/error-handlers.test.cjs`

**Step 1: Write failing tests**

Create `test/diagnostics/error-handlers.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/main.js'), 'utf-8'
);

describe('Global error handlers -- window.onerror', () => {
  it('installs window.onerror handler', () => {
    assert.ok(src.includes('window.onerror'), 'Should set window.onerror');
  });

  it('calls logFrontendError on uncaught error', () => {
    assert.ok(src.includes('logFrontendError'), 'Should call logFrontendError');
  });

  it('captures error message, source, line, column, and stack', () => {
    assert.ok(src.includes('message'), 'Should capture message');
    assert.ok(src.includes('source') || src.includes('filename'), 'Should capture source file');
    assert.ok(src.includes('lineno') || src.includes('line'), 'Should capture line number');
    assert.ok(src.includes('stack'), 'Should capture stack trace');
  });
});

describe('Global error handlers -- unhandledrejection', () => {
  it('listens for unhandledrejection events', () => {
    assert.ok(src.includes('unhandledrejection'), 'Should listen for unhandledrejection');
  });

  it('extracts reason from rejection event', () => {
    assert.ok(src.includes('event.reason') || src.includes('reason'), 'Should extract rejection reason');
  });
});

describe('Global error handlers -- console intercepts', () => {
  it('intercepts console.error', () => {
    assert.ok(
      src.includes('console.error') && src.includes('_originalConsoleError'),
      'Should intercept console.error while preserving original'
    );
  });

  it('intercepts console.warn', () => {
    assert.ok(
      src.includes('console.warn') && src.includes('_originalConsoleWarn'),
      'Should intercept console.warn while preserving original'
    );
  });

  it('preserves original console methods', () => {
    assert.ok(src.includes('_originalConsoleError'), 'Should save original console.error');
    assert.ok(src.includes('_originalConsoleWarn'), 'Should save original console.warn');
  });
});

describe('Global error handlers -- safety', () => {
  it('wraps logFrontendError in try/catch to prevent infinite loops', () => {
    // The error handler itself must not throw, or it creates an infinite loop
    assert.ok(src.includes('try') && src.includes('catch'), 'Should have try/catch safety');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/error-handlers.test.cjs`
Expected: All FAIL

**Step 3: Implement global error handlers in main.js**

Add this block at the TOP of `src/main.js` (before `mount(App)`), right after imports:

```js
import { logFrontendError } from './lib/api.js';

// ══════════════════════════════════════════════════════════════════════════════
// Layer 1: Global Runtime Error Capture
// ══════════════════════════════════════════════════════════════════════════════
// Captures all unhandled errors, unhandled promise rejections, and
// console.error/console.warn calls. Forwards them to the Rust backend's
// Frontend output channel, which writes to JSONL files that Claude Code
// can read to diagnose bugs without requiring the user to describe them.

/** Safe logger — must never throw (would cause infinite loops) */
function _safeLogFrontendError(level, message, context) {
  try {
    logFrontendError({ level, message, context });
  } catch {
    // Swallow — logging infrastructure must never crash the app
  }
}

// ── Uncaught errors ──
window.onerror = (message, source, lineno, colno, error) => {
  const context = [
    `Source: ${source || 'unknown'}:${lineno || '?'}:${colno || '?'}`,
    error?.stack ? `Stack:\n${error.stack}` : '',
  ].filter(Boolean).join('\n');

  _safeLogFrontendError('ERROR', `Uncaught: ${message}`, context);
  return false; // Don't suppress — let browser console show it too
};

// ── Unhandled promise rejections ──
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error
    ? reason.message
    : String(reason ?? 'Unknown rejection');
  const stack = reason instanceof Error ? reason.stack : '';
  const context = stack ? `Stack:\n${stack}` : '';

  _safeLogFrontendError('ERROR', `Unhandled rejection: ${message}`, context);
});

// ── Console intercepts ──
// Capture console.error/warn so they appear in the Frontend output channel.
// This catches the many console.warn('[Terminal] ...) calls throughout the app.
const _originalConsoleError = console.error.bind(console);
const _originalConsoleWarn = console.warn.bind(console);

console.error = (...args) => {
  _originalConsoleError(...args);
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  _safeLogFrontendError('ERROR', message, '');
};

console.warn = (...args) => {
  _originalConsoleWarn(...args);
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  _safeLogFrontendError('WARN', message, '');
};
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/diagnostics/error-handlers.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/main.js test/diagnostics/error-handlers.test.cjs
git commit -m "feat: add global error handlers for runtime error capture (Layer 1)"
```

---

## Layer 2: Health Monitoring

### Task 3: Health Contract System + Central Diagnostics Store

**Files:**
- Create: `src/lib/stores/diagnostics.svelte.js` (central health monitor store)
- Test: `test/stores/diagnostics.test.cjs`

**Step 1: Write failing tests**

Create `test/stores/diagnostics.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/diagnostics.svelte.js'), 'utf-8'
);

describe('diagnostics.svelte.js -- health contract registry', () => {
  it('exports diagnosticsStore', () => {
    assert.ok(src.includes('export const diagnosticsStore'), 'Should export diagnosticsStore');
  });

  it('has registerHealthContract function', () => {
    assert.ok(src.includes('registerHealthContract'), 'Should have registerHealthContract');
  });

  it('has unregisterHealthContract function', () => {
    assert.ok(src.includes('unregisterHealthContract'), 'Should have unregisterHealthContract');
  });

  it('stores contracts in a Map keyed by subsystem name', () => {
    assert.ok(src.includes('Map') || src.includes('contracts'), 'Should use a Map or object for contracts');
  });

  it('each contract has name, check function, and interval', () => {
    assert.ok(src.includes('name'), 'Contract should have name');
    assert.ok(src.includes('check'), 'Contract should have check function');
  });
});

describe('diagnostics.svelte.js -- health check runner', () => {
  it('has runAllChecks function', () => {
    assert.ok(src.includes('runAllChecks'), 'Should have runAllChecks');
  });

  it('has startMonitoring function with interval', () => {
    assert.ok(src.includes('startMonitoring'), 'Should have startMonitoring');
  });

  it('has stopMonitoring function', () => {
    assert.ok(src.includes('stopMonitoring'), 'Should have stopMonitoring');
  });

  it('uses setInterval for periodic checks', () => {
    assert.ok(src.includes('setInterval') || src.includes('interval'), 'Should use periodic interval');
  });

  it('defaults to 30s check interval', () => {
    assert.ok(src.includes('30000') || src.includes('30_000'), 'Should default to 30s');
  });
});

describe('diagnostics.svelte.js -- health status tracking', () => {
  it('tracks health results per subsystem', () => {
    assert.ok(src.includes('results') || src.includes('statuses'), 'Should track results');
  });

  it('each result has healthy boolean', () => {
    assert.ok(src.includes('healthy'), 'Results should have healthy flag');
  });

  it('each result has message string', () => {
    assert.ok(src.includes('message'), 'Results should have message');
  });

  it('each result has lastChecked timestamp', () => {
    assert.ok(src.includes('lastChecked') || src.includes('timestamp'), 'Results should have timestamp');
  });

  it('exposes unhealthy subsystems getter', () => {
    assert.ok(src.includes('unhealthy') || src.includes('getUnhealthy'), 'Should expose unhealthy getter');
  });
});

describe('diagnostics.svelte.js -- logging unhealthy states', () => {
  it('imports logFrontendError for reporting', () => {
    assert.ok(src.includes('logFrontendError'), 'Should import logFrontendError');
  });

  it('logs WARN when a health check fails', () => {
    assert.ok(src.includes('WARN') || src.includes('warn'), 'Should log warnings for unhealthy states');
  });
});

describe('diagnostics.svelte.js -- meta health check', () => {
  it('has meta check for missing subsystem reports', () => {
    assert.ok(
      src.includes('EXPECTED_SUBSYSTEMS') || src.includes('expectedSubsystems'),
      'Should track expected subsystems for meta-check'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/stores/diagnostics.test.cjs`
Expected: All FAIL

**Step 3: Implement the diagnostics store**

Create `src/lib/stores/diagnostics.svelte.js`:

```js
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

/** @type {Record<string, { healthy: boolean, message: string, lastChecked: number, details?: any }>} */
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
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/stores/diagnostics.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/lib/stores/diagnostics.svelte.js test/stores/diagnostics.test.cjs
git commit -m "feat: add central diagnostics store with health contract system (Layer 2)"
```

---

### Task 4: Wire Health Contracts into Existing Subsystems

**Files:**
- Modify: `src/App.svelte` (start monitoring, register initial contracts)
- Create: `src/lib/health-contracts.js` (health contract definitions for all subsystems)
- Test: `test/diagnostics/health-contracts.test.cjs`

**Context:** Health contracts are defined in a single file (`health-contracts.js`) that imports from the relevant stores and defines what "healthy" means for each subsystem. This keeps contract logic centralized and easy to maintain. The file uses plain `.js` (not `.svelte.js`) because it only exports functions — no runes needed. Each contract's `check()` function reads from store getters and returns `{ healthy, message, details }`.

**Step 1: Write failing tests**

Create `test/diagnostics/health-contracts.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/health-contracts.js'), 'utf-8'
);
const appSrc = fs.readFileSync(
  path.join(__dirname, '../../src/App.svelte'), 'utf-8'
);

describe('health-contracts.js -- contract definitions', () => {
  it('exports registerAllContracts function', () => {
    assert.ok(src.includes('registerAllContracts'), 'Should export registerAllContracts');
  });

  it('defines LSP health contract', () => {
    assert.ok(src.includes("'lsp'") && src.includes('check'), 'Should have LSP contract');
  });

  it('defines terminal health contract', () => {
    assert.ok(src.includes("'terminal'") && src.includes('check'), 'Should have terminal contract');
  });

  it('defines file-watcher health contract', () => {
    assert.ok(src.includes("'file-watcher'") && src.includes('check'), 'Should have file-watcher contract');
  });

  it('defines dev-server health contract', () => {
    assert.ok(src.includes("'dev-server'") && src.includes('check'), 'Should have dev-server contract');
  });

  it('defines editor health contract', () => {
    assert.ok(src.includes("'editor'") && src.includes('check'), 'Should have editor contract');
  });

  it('imports diagnosticsStore for registration', () => {
    assert.ok(src.includes('diagnosticsStore'), 'Should import diagnosticsStore');
  });
});

describe('App.svelte -- diagnostics wiring', () => {
  it('imports diagnosticsStore', () => {
    assert.ok(appSrc.includes('diagnosticsStore'), 'Should import diagnosticsStore');
  });

  it('imports registerAllContracts', () => {
    assert.ok(appSrc.includes('registerAllContracts'), 'Should import registerAllContracts');
  });

  it('calls startMonitoring', () => {
    assert.ok(appSrc.includes('startMonitoring'), 'Should call startMonitoring');
  });

  it('calls registerAllContracts', () => {
    assert.ok(appSrc.includes('registerAllContracts'), 'Should call registerAllContracts');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/health-contracts.test.cjs`
Expected: All FAIL

**Step 3: Implement health contracts**

Create `src/lib/health-contracts.js`:

```js
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

/**
 * Register all health contracts with the diagnostics store.
 * Called once from App.svelte on mount.
 *
 * @param {Object} deps - Reactive store references passed from App.svelte
 * @param {Function} deps.getProjectRoot - Returns current project root or null
 * @param {Function} deps.getOpenTabs - Returns array of open editor tabs
 * @param {Function} deps.getTerminalGroups - Returns terminal groups array
 * @param {Function} deps.getLspStatus - Returns LSP connection info
 * @param {Function} deps.getDevServers - Returns dev server info
 */
export function registerAllContracts(deps) {
  // ── LSP ──
  diagnosticsStore.registerHealthContract({
    name: 'lsp',
    description: 'Language Server Protocol integration for code intelligence',
    check() {
      const projectRoot = deps.getProjectRoot();
      if (!projectRoot) {
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
      // Check for zombie shells — instances that should be alive but have exited
      let zombies = 0;
      let total = 0;
      for (const group of groups) {
        if (!group.instances) continue;
        for (const inst of group.instances) {
          total++;
          if (inst.exited && !inst.exitedAcknowledged) {
            zombies++;
          }
        }
      }
      if (zombies > 0) {
        return {
          healthy: false,
          message: `${zombies}/${total} terminal instances exited unexpectedly`,
          details: { zombies, total },
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
      const projectRoot = deps.getProjectRoot();
      if (!projectRoot) {
        return { healthy: true, message: 'No project open — file watcher not needed' };
      }
      // File watcher is managed by Rust backend — we check if project is loaded
      return { healthy: true, message: `Watching: ${projectRoot}` };
    },
  });

  // ── Dev Server ──
  diagnosticsStore.registerHealthContract({
    name: 'dev-server',
    description: 'Development server detection and management',
    check() {
      const info = deps.getDevServers();
      if (!info || !info.hasDevServer) {
        return { healthy: true, message: 'No dev server detected' };
      }
      if (info.crashed) {
        return {
          healthy: false,
          message: `Dev server crashed: ${info.crashMessage || 'unknown reason'}`,
          details: info,
        };
      }
      return { healthy: true, message: `Dev server running on port ${info.port || '?'}` };
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
      const conflicted = tabs.filter(t => t.conflict).length;
      if (conflicted > 0) {
        return {
          healthy: false,
          message: `${conflicted} file(s) have disk conflicts (changed externally)`,
          details: { total: tabs.length, dirty, conflicted },
        };
      }
      return {
        healthy: true,
        message: `${tabs.length} file(s) open, ${dirty} unsaved`,
      };
    },
  });
}
```

In `src/App.svelte`, add imports and wiring. Find the `onMount` or init section and add:

```js
import { diagnosticsStore } from './lib/stores/diagnostics.svelte.js';
import { registerAllContracts } from './lib/health-contracts.js';
```

In the `onMount` or initialization block, add:

```js
// Layer 2: Health monitoring
registerAllContracts({
  getProjectRoot: () => projectStore.root,
  getOpenTabs: () => tabsStore.tabs,
  getTerminalGroups: () => terminalTabsStore.groups,
  getLspStatus: () => {
    // Return whatever LSP status info is available
    try {
      return { active: false }; // Will be enhanced as LSP system evolves
    } catch { return null; }
  },
  getDevServers: () => {
    try {
      return {
        hasDevServer: devServerManager.hasDevServer,
        crashed: devServerManager.crashed,
        crashMessage: devServerManager.crashMessage,
        port: devServerManager.port,
      };
    } catch { return null; }
  },
});
diagnosticsStore.startMonitoring();
```

**Important:** Read `App.svelte` carefully before editing. Find the existing imports and the `onMount` block to know exactly where to add the new code. Make sure the store imports used above (`projectStore`, `tabsStore`, `terminalTabsStore`, `devServerManager`) are already imported — if not, add the imports.

**Step 4: Run tests to verify they pass**

Run: `node --test test/diagnostics/health-contracts.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/lib/health-contracts.js src/App.svelte test/diagnostics/health-contracts.test.cjs
git commit -m "feat: wire health contracts into subsystems (Layer 2)"
```

---

## Layer 3: Interaction Auditing

### Task 5: Interaction Audit Logger

**Files:**
- Create: `src/lib/audit-log.js` (interaction audit logger)
- Modify: `src/main.js` (add navigation/tab audit hooks)
- Test: `test/diagnostics/audit-log.test.cjs`

**Context:** The audit log captures user interactions (file opens, tab switches, button clicks on key features, LSP requests, terminal actions) with timestamps. It uses the same `logFrontendError` API but at DEBUG level with an `[AUDIT]` prefix. This creates a timeline Claude Code can read to understand what happened before a bug appeared.

**Step 1: Write failing tests**

Create `test/diagnostics/audit-log.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/audit-log.js'), 'utf-8'
);

describe('audit-log.js -- core API', () => {
  it('exports audit function', () => {
    assert.ok(src.includes('export function audit'), 'Should export audit function');
  });

  it('audit accepts category and action parameters', () => {
    assert.ok(src.includes('category'), 'Should accept category');
    assert.ok(src.includes('action'), 'Should accept action');
  });

  it('uses logFrontendError with DEBUG level', () => {
    assert.ok(src.includes('logFrontendError'), 'Should use logFrontendError');
    assert.ok(src.includes("'DEBUG'") || src.includes('"DEBUG"'), 'Should use DEBUG level');
  });

  it('prefixes messages with [AUDIT]', () => {
    assert.ok(src.includes('[AUDIT]'), 'Should prefix with [AUDIT]');
  });

  it('includes optional details in context', () => {
    assert.ok(src.includes('details'), 'Should support optional details');
  });
});

describe('audit-log.js -- predefined categories', () => {
  it('has EDITOR category helpers', () => {
    assert.ok(src.includes('auditEditor') || src.includes("'editor'"), 'Should have editor audit');
  });

  it('has TERMINAL category helpers', () => {
    assert.ok(src.includes('auditTerminal') || src.includes("'terminal'"), 'Should have terminal audit');
  });

  it('has LSP category helpers', () => {
    assert.ok(src.includes('auditLsp') || src.includes("'lsp'"), 'Should have LSP audit');
  });

  it('has NAVIGATION category helpers', () => {
    assert.ok(src.includes('auditNav') || src.includes("'nav'"), 'Should have navigation audit');
  });
});

describe('audit-log.js -- safety', () => {
  it('wraps logging in try/catch', () => {
    assert.ok(src.includes('try') && src.includes('catch'), 'Should have try/catch safety');
  });

  it('is a plain .js file (no runes needed)', () => {
    assert.ok(!src.includes('$state') && !src.includes('$effect'), 'Should not use Svelte runes');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/audit-log.test.cjs`
Expected: All FAIL

**Step 3: Implement the audit logger**

Create `src/lib/audit-log.js`:

```js
/**
 * audit-log.js -- Interaction audit logger.
 *
 * Captures key user interactions (file opens, tab switches, LSP requests,
 * terminal actions) with timestamps. Logs at DEBUG level with [AUDIT] prefix
 * to the Frontend output channel. Claude Code can read the JSONL timeline
 * to understand what happened before a bug appeared.
 *
 * Usage:
 *   import { audit, auditEditor, auditTerminal, auditLsp, auditNav } from './audit-log.js';
 *   auditEditor('file-opened', { path: 'src/main.js' });
 *   auditTerminal('shell-created', { shellId: 'abc', profile: 'bash' });
 *   auditLsp('completion-requested', { file: 'foo.ts', line: 42 });
 *   auditNav('tab-switched', { from: 'lens', to: 'chat' });
 */

import { logFrontendError } from './api.js';

/**
 * Log an audit event. Safe to call anywhere — never throws.
 *
 * @param {string} category - Subsystem category (e.g. 'editor', 'terminal', 'lsp', 'nav')
 * @param {string} action - What happened (e.g. 'file-opened', 'shell-exited')
 * @param {Object} [details] - Optional structured details
 */
export function audit(category, action, details) {
  try {
    const message = `[AUDIT] [${category}] ${action}`;
    const context = details ? JSON.stringify(details) : '';
    logFrontendError({ level: 'DEBUG', message, context });
  } catch {
    // Audit logging must never crash the app
  }
}

/** Audit an editor interaction */
export function auditEditor(action, details) {
  audit('editor', action, details);
}

/** Audit a terminal interaction */
export function auditTerminal(action, details) {
  audit('terminal', action, details);
}

/** Audit an LSP interaction */
export function auditLsp(action, details) {
  audit('lsp', action, details);
}

/** Audit a navigation interaction */
export function auditNav(action, details) {
  audit('nav', action, details);
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/diagnostics/audit-log.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/lib/audit-log.js test/diagnostics/audit-log.test.cjs
git commit -m "feat: add interaction audit logger (Layer 3)"
```

---

### Task 6: Wire Audit Hooks into Key Interaction Points

**Files:**
- Modify: `src/lib/stores/tabs.svelte.js` (audit file open/close/switch)
- Modify: `src/lib/stores/terminal-tabs.svelte.js` (audit shell create/exit/switch)
- Modify: `src/lib/stores/lens.svelte.js` (audit navigation tab switches)
- Test: `test/diagnostics/audit-wiring.test.cjs`

**Context:** This task adds `audit()` calls to the most important interaction points. We do NOT audit every single function — just the key moments that help reconstruct what the user was doing when a bug occurred. Think of it like breadcrumbs.

**Step 1: Write failing tests**

Create `test/diagnostics/audit-wiring.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const tabsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/tabs.svelte.js'), 'utf-8'
);
const terminalTabsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js'), 'utf-8'
);
const lensSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/lens.svelte.js'), 'utf-8'
);

describe('tabs.svelte.js -- audit wiring', () => {
  it('imports audit-log', () => {
    assert.ok(tabsSrc.includes('audit-log'), 'Should import from audit-log');
  });

  it('audits file open', () => {
    assert.ok(tabsSrc.includes('auditEditor'), 'Should call auditEditor');
  });
});

describe('terminal-tabs.svelte.js -- audit wiring', () => {
  it('imports audit-log', () => {
    assert.ok(terminalTabsSrc.includes('audit-log'), 'Should import from audit-log');
  });

  it('audits terminal actions', () => {
    assert.ok(terminalTabsSrc.includes('auditTerminal'), 'Should call auditTerminal');
  });
});

describe('lens.svelte.js -- audit wiring', () => {
  it('imports audit-log', () => {
    assert.ok(lensSrc.includes('audit-log'), 'Should import from audit-log');
  });

  it('audits navigation', () => {
    assert.ok(lensSrc.includes('auditNav'), 'Should call auditNav');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/audit-wiring.test.cjs`
Expected: All FAIL

**Step 3: Add audit calls to stores**

Read each store file carefully before editing. Add minimal audit calls at key interaction points:

In `src/lib/stores/tabs.svelte.js`:
- Import: `import { auditEditor } from '../audit-log.js';`
- In the `openFile` or `addTab` function: `auditEditor('file-opened', { path: filePath });`
- In the `closeTab` function: `auditEditor('file-closed', { path: tab.path });`
- In the `switchTab` or `setActive` function: `auditEditor('tab-switched', { path: tab.path });`

In `src/lib/stores/terminal-tabs.svelte.js`:
- Import: `import { auditTerminal } from '../audit-log.js';`
- In the `createInstance` or `addShell` function: `auditTerminal('shell-created', { shellId });`
- In the `markExited` or similar: `auditTerminal('shell-exited', { shellId });`
- In the `switchGroup` function: `auditTerminal('group-switched', { groupId });`

In `src/lib/stores/lens.svelte.js`:
- Import: `import { auditNav } from '../audit-log.js';`
- In the navigation/tab switch function: `auditNav('view-switched', { view: newView });`

**Important:** Read each file first to find the exact function names and insertion points. The function names above are approximate — use whatever the actual store uses.

**Step 4: Run tests to verify they pass**

Run: `node --test test/diagnostics/audit-wiring.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/lib/stores/tabs.svelte.js src/lib/stores/terminal-tabs.svelte.js src/lib/stores/lens.svelte.js test/diagnostics/audit-wiring.test.cjs
git commit -m "feat: wire audit hooks into editor, terminal, and navigation stores (Layer 3)"
```

---

## Maintenance & Documentation

### Task 7: Update CLAUDE.md Wiring Checklist + Memory

**Files:**
- Modify: `CLAUDE.md` (add health contract bullet to wiring checklist)
- Modify: `docs/source-of-truth/IDE-GAPS.md` (update if diagnostics feature is tracked)

**Step 1: Write failing tests**

Create `test/diagnostics/maintenance.test.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const claudeMd = fs.readFileSync(
  path.join(__dirname, '../../CLAUDE.md'), 'utf-8'
);
const diagnosticsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/diagnostics.svelte.js'), 'utf-8'
);

describe('CLAUDE.md -- wiring checklist includes health contracts', () => {
  it('mentions health contract in wiring checklist', () => {
    assert.ok(
      claudeMd.includes('Health') && claudeMd.includes('contract'),
      'Wiring checklist should mention health contracts'
    );
  });

  it('mentions diagnostics store', () => {
    assert.ok(
      claudeMd.includes('diagnostics'),
      'Should mention diagnostics store'
    );
  });
});

describe('diagnostics.svelte.js -- EXPECTED_SUBSYSTEMS is documented', () => {
  it('has comment explaining how to add new subsystems', () => {
    assert.ok(
      diagnosticsSrc.includes('Update this list') || diagnosticsSrc.includes('adding'),
      'Should document how to add new expected subsystems'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/maintenance.test.cjs`
Expected: CLAUDE.md test FAILs (no health contract bullet yet)

**Step 3: Update CLAUDE.md**

Find the "Voice Mirror Wiring Checklist" section in `CLAUDE.md` and add after the existing bullets:

```markdown
- Health contract registered in `src/lib/health-contracts.js` + name added to `EXPECTED_SUBSYSTEMS` in `diagnostics.svelte.js`?
```

Also add a brief section describing the diagnostics system in the Architecture or Key Conventions section:

```markdown
### Runtime Diagnostics

Three-layer self-diagnostic system for catching bugs Claude Code can read:

- **Layer 1 (Error Capture):** `window.onerror`, `window.onunhandledrejection`, and `console.error/warn` intercepts in `main.js` forward to `Frontend` output channel → `%APPDATA%/voice-mirror/logs/current/frontend.jsonl`
- **Layer 2 (Health Monitors):** Subsystems register health contracts in `src/lib/health-contracts.js`. Central `diagnostics.svelte.js` store runs checks every 30s and logs unhealthy states. Meta-check catches missing contracts.
- **Layer 3 (Interaction Audit):** Key user actions are logged at DEBUG level with `[AUDIT]` prefix via `src/lib/audit-log.js`. Provides timeline for debugging.

**When adding new subsystems:** Register a health contract in `health-contracts.js` and add the subsystem name to `EXPECTED_SUBSYSTEMS` in `diagnostics.svelte.js`.
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/diagnostics/maintenance.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add CLAUDE.md test/diagnostics/maintenance.test.cjs
git commit -m "docs: add health contract requirement to wiring checklist"
```

---

### Task 8: Session-Start Diagnostic Protocol in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (add session-start diagnostic check instruction)
- Test: `test/diagnostics/maintenance.test.cjs` (add test for session-start protocol)

**Context:** This task adds instructions to CLAUDE.md telling every Claude Code session to automatically read `frontend.jsonl` at the start of each conversation and report any errors or unhealthy states since the last session. This creates a closed loop: errors happen → JSONL captures them → next Claude session reads them → bugs get found and fixed without the user needing to describe anything.

**Step 1: Write failing test**

Append to `test/diagnostics/maintenance.test.cjs`:

```js
describe('CLAUDE.md -- session-start diagnostic protocol', () => {
  it('instructs Claude to read frontend.jsonl on session start', () => {
    assert.ok(
      claudeMd.includes('frontend.jsonl'),
      'Should instruct reading frontend.jsonl'
    );
  });

  it('mentions checking for errors at session start', () => {
    assert.ok(
      claudeMd.includes('Session-Start Diagnostic') || claudeMd.includes('session-start diagnostic'),
      'Should have session-start diagnostic protocol'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/diagnostics/maintenance.test.cjs`
Expected: New tests FAIL

**Step 3: Add session-start diagnostic protocol to CLAUDE.md**

Add to the "Working Style" or a new "Diagnostics" section in CLAUDE.md:

```markdown
### Session-Start Diagnostic Check

At the start of each session, **proactively read the runtime diagnostics log** to catch bugs the user may not have noticed:

1. Read `%APPDATA%/voice-mirror/logs/current/frontend.jsonl` (use `Read` tool)
2. Look for:
   - `ERROR` entries → crashes or unhandled exceptions since last session
   - `[UNHEALTHY]` entries → subsystems that reported health failures
   - `[AUDIT]` entries at `DEBUG` level → user interaction timeline (useful context)
3. If errors are found, **proactively report them** to the user: "I noticed X errors in the runtime log since last session. Want me to investigate?"
4. If the file doesn't exist or is empty, the app hasn't been run yet — skip silently.

This creates a closed loop: runtime errors are captured automatically → next Claude session reads them → bugs get found and fixed without the user needing to describe them.
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/diagnostics/maintenance.test.cjs`
Expected: All PASS

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add CLAUDE.md test/diagnostics/maintenance.test.cjs
git commit -m "docs: add session-start diagnostic check protocol"
```

**Note:** Tasks 7 and 8 both modify CLAUDE.md and the same test file. The implementer should combine these into a single editing pass if executed sequentially, or handle merge carefully if separate.

---

## Summary

| Task | Layer | What it does |
|------|-------|-------------|
| 1 | L1 | Add `Frontend` output channel to Rust backend + api.js wrapper + output store |
| 2 | L1 | Global error handlers (`window.onerror`, `unhandledrejection`, console intercepts) |
| 3 | L2 | Central diagnostics store with health contract registry + periodic runner |
| 4 | L2 | Health contracts for LSP, terminal, file-watcher, dev-server, editor |
| 5 | L3 | Interaction audit logger (`audit-log.js`) with category helpers |
| 6 | L3 | Wire audit hooks into tabs, terminal-tabs, and lens stores |
| 7 | Maint | Update CLAUDE.md wiring checklist + documentation |
| 8 | Maint | Session-start diagnostic protocol — Claude reads logs automatically |

**How Claude Code reads the data:**
1. Read `%APPDATA%/voice-mirror/logs/current/frontend.jsonl` with the `Read` tool
2. Or use MCP `get_logs` tool with `channel: "frontend"`
3. Filter by level (`ERROR` for crashes, `WARN` for health issues, `DEBUG` for audit trail)
4. Search for `[AUDIT]` to see interaction timeline, `[UNHEALTHY]` for health issues, `Uncaught` for crashes

**How it stays maintained:**
- CLAUDE.md wiring checklist requires health contracts for new subsystems
- `EXPECTED_SUBSYSTEMS` list in `diagnostics.svelte.js` triggers meta-warnings if a contract is missing
- Source-inspection tests verify contracts exist
- Contracts are co-located in `health-contracts.js` — single place to update
- Session-start protocol ensures every new Claude session checks for accumulated errors
