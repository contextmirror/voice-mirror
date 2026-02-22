const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/dev-server-manager.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

// -- Exports --

describe('dev-server-manager.svelte.js -- exports', () => {
  it('exports devServerManager', () => {
    assert.ok(src.includes('export const devServerManager'), 'Should export devServerManager');
  });

  it('exports POLL_INTERVAL constant', () => {
    assert.ok(src.includes('POLL_INTERVAL'), 'Should export POLL_INTERVAL');
  });

  it('exports POLL_TIMEOUT constant', () => {
    assert.ok(src.includes('POLL_TIMEOUT'), 'Should export POLL_TIMEOUT');
  });

  it('exports IDLE_TIMEOUT constant', () => {
    assert.ok(src.includes('IDLE_TIMEOUT'), 'Should export IDLE_TIMEOUT');
  });

  it('exports MAX_CONCURRENT constant', () => {
    assert.ok(src.includes('MAX_CONCURRENT'), 'Should export MAX_CONCURRENT');
  });

  it('exports CRASH_LOOP_COUNT constant', () => {
    assert.ok(src.includes('CRASH_LOOP_COUNT'), 'Should export CRASH_LOOP_COUNT');
  });

  it('exports CRASH_LOOP_WINDOW constant', () => {
    assert.ok(src.includes('CRASH_LOOP_WINDOW'), 'Should export CRASH_LOOP_WINDOW');
  });
});

// -- Constants values --

describe('dev-server-manager.svelte.js -- constant values', () => {
  it('POLL_INTERVAL is 500ms', () => {
    assert.ok(src.includes('POLL_INTERVAL = 500'), 'POLL_INTERVAL should be 500');
  });

  it('POLL_TIMEOUT is 30000ms', () => {
    assert.ok(src.includes('POLL_TIMEOUT = 30000'), 'POLL_TIMEOUT should be 30000');
  });

  it('IDLE_TIMEOUT is 300000ms (5 minutes)', () => {
    assert.ok(src.includes('IDLE_TIMEOUT = 300000'), 'IDLE_TIMEOUT should be 300000');
  });

  it('MAX_CONCURRENT is 3', () => {
    assert.ok(src.includes('MAX_CONCURRENT = 3'), 'MAX_CONCURRENT should be 3');
  });

  it('CRASH_LOOP_COUNT is 3', () => {
    assert.ok(src.includes('CRASH_LOOP_COUNT = 3'), 'CRASH_LOOP_COUNT should be 3');
  });

  it('CRASH_LOOP_WINDOW is 300000ms (5 minutes)', () => {
    assert.ok(src.includes('CRASH_LOOP_WINDOW = 300000'), 'CRASH_LOOP_WINDOW should be 300000');
  });
});

// -- Imports --

describe('dev-server-manager.svelte.js -- imports', () => {
  it('imports shellSpawn from api', () => {
    assert.ok(src.includes('shellSpawn'), 'Should import shellSpawn');
  });

  it('imports shellInput from api', () => {
    assert.ok(src.includes('shellInput'), 'Should import shellInput');
  });

  it('imports shellKill from api', () => {
    assert.ok(src.includes('shellKill'), 'Should import shellKill');
  });

  it('imports probePort from api', () => {
    assert.ok(src.includes('probePort'), 'Should import probePort');
  });

  it('imports lensNavigate from api', () => {
    assert.ok(src.includes('lensNavigate'), 'Should import lensNavigate');
  });

  it('imports killPortProcess from api', () => {
    assert.ok(src.includes('killPortProcess'), 'Should import killPortProcess');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'), 'Should import lensStore');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes('toastStore'), 'Should import toastStore');
  });
});

// -- Reactive state --

describe('dev-server-manager.svelte.js -- reactive state', () => {
  it('uses $state for servers Map', () => {
    assert.ok(src.includes('$state(new Map())'), 'Should use $state(new Map()) for servers');
  });

  it('has servers getter', () => {
    assert.ok(src.includes('get servers()'), 'Should have servers getter');
  });

  it('has runningCount getter', () => {
    assert.ok(src.includes('get runningCount()'), 'Should have runningCount getter');
  });

  it('has crashedServers getter', () => {
    assert.ok(src.includes('get crashedServers()'), 'Should have crashedServers getter');
  });
});

// -- Server state fields --

describe('dev-server-manager.svelte.js -- server state fields', () => {
  it('tracks status field', () => {
    assert.ok(src.includes("status: 'stopped'"), 'Should have status field with stopped default');
  });

  it('tracks shellId field', () => {
    assert.ok(src.includes('shellId: null'), 'Should have shellId field');
  });

  it('tracks port field', () => {
    assert.ok(src.includes('port: null'), 'Should have port field');
  });

  it('tracks framework field', () => {
    assert.ok(src.includes('framework: null'), 'Should have framework field');
  });

  it('tracks url field', () => {
    assert.ok(src.includes('url: null'), 'Should have url field');
  });

  it('tracks crashCount field', () => {
    assert.ok(src.includes('crashCount: 0'), 'Should have crashCount field');
  });

  it('tracks lastCrashTime field', () => {
    assert.ok(src.includes('lastCrashTime: null'), 'Should have lastCrashTime field');
  });

  it('tracks lastActiveTime field', () => {
    assert.ok(src.includes('lastActiveTime: Date.now()'), 'Should have lastActiveTime field');
  });

  it('tracks crashLoopDetected field', () => {
    assert.ok(src.includes('crashLoopDetected: false'), 'Should have crashLoopDetected field');
  });
});

// -- Methods --

describe('dev-server-manager.svelte.js -- methods', () => {
  it('has startServer method', () => {
    assert.ok(src.includes('startServer'), 'Should have startServer');
    assert.ok(src.includes('async function startServer('), 'startServer should be async');
  });

  it('has stopServer method', () => {
    assert.ok(src.includes('stopServer'), 'Should have stopServer');
    assert.ok(src.includes('async function stopServer('), 'stopServer should be async');
  });

  it('has restartServer method', () => {
    assert.ok(src.includes('restartServer'), 'Should have restartServer');
    assert.ok(src.includes('async function restartServer('), 'restartServer should be async');
  });

  it('has getServerStatus method', () => {
    assert.ok(src.includes('getServerStatus'), 'Should have getServerStatus');
  });

  it('has handleShellExit method', () => {
    assert.ok(src.includes('handleShellExit'), 'Should have handleShellExit');
  });

  it('has handleProjectSwitch method', () => {
    assert.ok(src.includes('handleProjectSwitch'), 'Should have handleProjectSwitch');
  });

  it('has stopExternalServer method', () => {
    assert.ok(src.includes('stopExternalServer'), 'Should have stopExternalServer');
    assert.ok(src.includes('async function stopExternalServer('), 'stopExternalServer should be async');
  });

  it('stopExternalServer calls killPortProcess', () => {
    const block = src.split('async function stopExternalServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('killPortProcess(port)'), 'Should call killPortProcess with port');
  });

  it('stopExternalServer updates devServers list after killing', () => {
    const block = src.split('async function stopExternalServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('lensStore.setDevServers'), 'Should update lensStore devServers');
  });

  it('exposes stopExternalServer on the returned object', () => {
    assert.ok(src.includes('stopExternalServer,'), 'Should export stopExternalServer in return object');
  });
});

// -- Start server behavior --

describe('dev-server-manager.svelte.js -- startServer behavior', () => {
  it('calls shellSpawn with project cwd', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('shellSpawn({ cwd: projectPath }'), 'Should spawn shell with projectPath cwd');
  });

  it('calls shellInput with start command', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('shellInput(shellId,'), 'Should send start command via shellInput');
  });

  it('adds dev server tab via terminalTabsStore', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('terminalTabsStore.addDevServerTab'), 'Should add dev server tab');
  });

  it('polls port with probePort', () => {
    assert.ok(src.includes('probePort('), 'Should call probePort for polling');
  });

  it('navigates lens on ready', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('lensNavigate(server.url)'), 'Should navigate lens to server URL on ready');
  });

  it('shows success toast on ready', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes("severity: 'success'"), 'Should show success toast on ready');
  });

  it('shows error toast on timeout', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes("Server didn't start"), 'Should show timeout error toast');
  });

  it('handles package manager prefix replacement', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('packageManager') && block.includes("startsWith('npm run ')"), 'Should replace npm with detected package manager');
  });
});

// -- Stop server behavior --

describe('dev-server-manager.svelte.js -- stopServer behavior', () => {
  it('calls shellKill', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('shellKill(state.shellId)'), 'Should call shellKill');
  });

  it('marks tab as exited', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('terminalTabsStore.markExited'), 'Should mark tab as exited');
  });

  it('cancels poll timer', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('cancelPoll('), 'Should cancel port polling');
  });

  it('cancels idle timer', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('cancelIdleTimer('), 'Should cancel idle timer');
  });
});

// -- Crash detection --

describe('dev-server-manager.svelte.js -- crash detection', () => {
  it('handleShellExit finds project by shellId', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('state.shellId === shellId'), 'Should find project by shellId');
  });

  it('increments crashCount on crash', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('crashCount++'), 'Should increment crash count');
  });

  it('sets status to crashed', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes("status: 'crashed'"), 'Should set status to crashed');
  });

  it('detects crash loops after CRASH_LOOP_COUNT', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('crashCount >= CRASH_LOOP_COUNT'), 'Should detect crash loop');
  });

  it('resets crash count outside window', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('CRASH_LOOP_WINDOW'), 'Should check crash window');
  });

  it('shows crash loop toast with duration 0 (persistent)', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('duration: 0'), 'Should show persistent toast for crash loop');
  });
});

// -- Idle timeout + LRU --

describe('dev-server-manager.svelte.js -- idle timeout and LRU eviction', () => {
  it('handleProjectSwitch starts idle timer for old project', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes('IDLE_TIMEOUT'), 'Should use IDLE_TIMEOUT for idle timer');
  });

  it('handleProjectSwitch cancels idle timer for new project', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes('cancelIdleTimer(newPath)'), 'Should cancel idle timer for new project');
  });

  it('sets status to idle on project switch away', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes("status: 'idle'"), 'Should set status to idle');
  });

  it('restores idle server to running on switch back', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes("status: 'running'"), 'Should restore idle server to running');
  });

  it('has findLRUIdle function for LRU eviction', () => {
    assert.ok(src.includes('findLRUIdle'), 'Should have findLRUIdle function');
  });

  it('findLRUIdle picks server with oldest lastActiveTime', () => {
    const block = src.split('function findLRUIdle')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('lastActiveTime'), 'Should compare lastActiveTime');
  });

  it('evicts LRU when at MAX_CONCURRENT', () => {
    assert.ok(src.includes('countRunning() >= MAX_CONCURRENT'), 'Should check MAX_CONCURRENT before evicting');
  });

  it('has countRunning function', () => {
    assert.ok(src.includes('function countRunning'), 'Should have countRunning function');
  });

  it('countRunning includes running and idle statuses (not starting)', () => {
    const block = src.split('function countRunning')[1]?.split('\n  function')[0] || '';
    assert.ok(
      block.includes("'running'") && block.includes("'idle'"),
      'Should count running and idle servers'
    );
    assert.ok(
      !block.includes("'starting'"),
      'Should NOT count starting servers (they have not consumed resources yet)'
    );
  });
});

// -- Port polling --

describe('dev-server-manager.svelte.js -- port polling', () => {
  it('has pollPort function', () => {
    assert.ok(src.includes('function pollPort('), 'Should have pollPort function');
  });

  it('uses setInterval for polling', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('setInterval('), 'Should use setInterval for polling');
  });

  it('polls at POLL_INTERVAL rate', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('POLL_INTERVAL'), 'Should use POLL_INTERVAL');
  });

  it('times out at POLL_TIMEOUT', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('POLL_TIMEOUT'), 'Should use POLL_TIMEOUT');
  });

  it('resolves true when port is listening', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('resolve(true)'), 'Should resolve true when listening');
  });

  it('resolves false on timeout', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('resolve(false)'), 'Should resolve false on timeout');
  });
});

// -- Crash loop protection in startServer --

describe('dev-server-manager.svelte.js -- crash loop protection', () => {
  it('startServer checks crashLoopDetected before starting', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crashLoopDetected'), 'Should check crashLoopDetected');
  });

  it('returns early with toast when crash loop detected', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crash loop') || block.includes('Crash loop'), 'Should show crash loop message');
  });
});

// -- Tab title formatting --

describe('dev-server-manager.svelte.js -- tab title formatting', () => {
  it('uses framework name in tab title when available', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('server.framework'), 'Should use framework in tab title');
  });

  it('falls back to Localhost for unknown framework', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('Localhost'), 'Should fall back to Localhost');
  });
});

// -- W1: restartServer resets crash state --

describe('dev-server-manager.svelte.js -- restartServer crash state reset', () => {
  it('resets crashCount to 0 before restarting', () => {
    const block = src.split('async function restartServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crashCount: 0'), 'Should reset crashCount to 0');
  });

  it('resets crashLoopDetected to false before restarting', () => {
    const block = src.split('async function restartServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crashLoopDetected: false'), 'Should reset crashLoopDetected');
  });

  it('resets lastCrashTime to null before restarting', () => {
    const block = src.split('async function restartServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('lastCrashTime: null'), 'Should reset lastCrashTime');
  });
});

// -- W2: pollPort cancellation --

describe('dev-server-manager.svelte.js -- pollPort cancellation', () => {
  it('pollPort promise has reject callback', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('resolve, reject'), 'pollPort should use resolve and reject');
  });

  it('cancelPoll triggers reject with cancelled error', () => {
    const block = src.split('function cancelPoll')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes("reject(new Error('cancelled'))"), 'cancelPoll should reject with cancelled error');
  });

  it('pollTimers stores interval and reject function', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('{ interval, reject }'), 'Should store both interval and reject in pollTimers');
  });

  it('cancelPoll clears interval from poll object', () => {
    const block = src.split('function cancelPoll')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('poll.interval') || block.includes('clearInterval(poll.interval)'), 'Should clear interval from poll object');
  });

  it('startServer catches cancelled pollPort rejection', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes("err?.message === 'cancelled'"), 'Should catch cancelled poll rejection');
  });
});

// -- C3: startServer race condition fix --

describe('dev-server-manager.svelte.js -- startServer race condition fix', () => {
  it('sets status to starting before evictIfNeeded', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    const startingIdx = block.indexOf("status: 'starting'");
    const evictIdx = block.indexOf('await evictIfNeeded()');
    assert.ok(startingIdx > -1, 'Should set status to starting');
    assert.ok(evictIdx > -1, 'Should call evictIfNeeded');
    assert.ok(startingIdx < evictIdx, 'Should set starting BEFORE evictIfNeeded');
  });
});
