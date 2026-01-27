/**
 * Chrome browser launcher for managed profiles.
 * Spawns an isolated Chrome/Brave/Edge instance with --remote-debugging-port.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getChromeWebSocketUrl, canOpenWebSocket } = require('./cdp-helpers');
const { getProfileUserDataDir } = require('./config');

/**
 * @typedef {Object} BrowserExecutable
 * @property {string} path - Full path to the executable
 * @property {'chrome'|'brave'|'edge'|'chromium'} kind
 */

/**
 * @typedef {Object} RunningChrome
 * @property {number} pid
 * @property {BrowserExecutable} exe
 * @property {string} userDataDir
 * @property {number} cdpPort
 * @property {number} startedAt
 * @property {import('child_process').ChildProcess} proc
 */

/**
 * Find a Chrome-family browser executable on this system.
 * Checks Chrome → Brave → Edge → Chromium.
 * @param {string} [overridePath] - User-configured executable path
 * @returns {BrowserExecutable|null}
 */
function findChromeExecutable(overridePath) {
    if (overridePath && fs.existsSync(overridePath)) {
        const lower = overridePath.toLowerCase();
        const kind = lower.includes('brave') ? 'brave'
            : lower.includes('edge') ? 'edge'
            : lower.includes('chromium') ? 'chromium'
            : 'chrome';
        return { path: overridePath, kind };
    }

    const platform = process.platform;

    if (platform === 'linux') {
        const candidates = [
            { path: '/usr/bin/google-chrome-stable', kind: 'chrome' },
            { path: '/usr/bin/google-chrome', kind: 'chrome' },
            { path: '/usr/bin/brave-browser', kind: 'brave' },
            { path: '/usr/bin/brave', kind: 'brave' },
            { path: '/usr/bin/microsoft-edge-stable', kind: 'edge' },
            { path: '/usr/bin/microsoft-edge', kind: 'edge' },
            { path: '/usr/bin/chromium-browser', kind: 'chromium' },
            { path: '/usr/bin/chromium', kind: 'chromium' },
            { path: '/snap/bin/chromium', kind: 'chromium' },
        ];
        for (const c of candidates) {
            if (fs.existsSync(c.path)) return c;
        }
    }

    if (platform === 'darwin') {
        const candidates = [
            { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', kind: 'chrome' },
            { path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', kind: 'brave' },
            { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', kind: 'edge' },
            { path: '/Applications/Chromium.app/Contents/MacOS/Chromium', kind: 'chromium' },
        ];
        for (const c of candidates) {
            if (fs.existsSync(c.path)) return c;
        }
    }

    if (platform === 'win32') {
        const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
        const candidates = [
            ...programFiles.map(p => ({ path: path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'), kind: 'chrome' })),
            ...programFiles.map(p => ({ path: path.join(p, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), kind: 'brave' })),
            ...programFiles.map(p => ({ path: path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), kind: 'edge' })),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c.path)) return c;
        }
    }

    return null;
}

/**
 * Check if Chrome CDP is reachable (HTTP + WebSocket).
 * @param {string} cdpUrl
 * @param {number} [httpTimeout=500]
 * @param {number} [wsTimeout=800]
 * @returns {Promise<boolean>}
 */
async function isCdpReady(cdpUrl, httpTimeout = 500, wsTimeout = 800) {
    const wsUrl = await getChromeWebSocketUrl(cdpUrl, httpTimeout);
    if (!wsUrl) return false;
    return await canOpenWebSocket(wsUrl, wsTimeout);
}

/**
 * Check if Chrome HTTP endpoint is reachable.
 * @param {string} cdpUrl
 * @param {number} [timeoutMs=500]
 * @returns {Promise<boolean>}
 */
async function isCdpHttpReachable(cdpUrl, timeoutMs = 500) {
    const wsUrl = await getChromeWebSocketUrl(cdpUrl, timeoutMs);
    return wsUrl !== null;
}

/**
 * Launch a managed Chrome instance.
 * @param {Object} opts
 * @param {import('./config').ResolvedProfile} opts.profile
 * @param {import('./config').BrowserConfig} opts.config
 * @returns {Promise<RunningChrome>}
 */
async function launchManagedChrome(opts) {
    const { profile, config } = opts;

    if (!profile.cdpIsLoopback) {
        throw new Error(`Profile "${profile.name}" is remote; cannot launch local Chrome.`);
    }

    const exe = findChromeExecutable(config.executablePath);
    if (!exe) {
        throw new Error('No supported browser found (Chrome/Brave/Edge/Chromium). Install one or set executablePath in config.');
    }

    const userDataDir = getProfileUserDataDir(profile.name);
    fs.mkdirSync(userDataDir, { recursive: true });

    const buildArgs = () => {
        const args = [
            `--remote-debugging-port=${profile.cdpPort}`,
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-features=Translate,MediaRouter',
            '--disable-session-crashed-bubble',
            '--hide-crash-restore-bubble',
            '--password-store=basic',
        ];

        if (config.headless) {
            args.push('--headless=new', '--disable-gpu');
        }
        if (config.noSandbox) {
            args.push('--no-sandbox', '--disable-setuid-sandbox');
        }
        if (process.platform === 'linux') {
            args.push('--disable-dev-shm-usage');
        }

        args.push('about:blank');
        return args;
    };

    // Bootstrap: if profile doesn't exist yet, spawn briefly to create default files
    const localStatePath = path.join(userDataDir, 'Local State');
    const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
    const needsBootstrap = !fs.existsSync(localStatePath) || !fs.existsSync(preferencesPath);

    if (needsBootstrap) {
        const bootstrap = spawn(exe.path, buildArgs(), {
            stdio: 'pipe',
            env: { ...process.env, HOME: os.homedir() }
        });
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (fs.existsSync(localStatePath) && fs.existsSync(preferencesPath)) break;
            await new Promise(r => setTimeout(r, 100));
        }
        try { bootstrap.kill('SIGTERM'); } catch { /* ignore */ }
        const exitDeadline = Date.now() + 5000;
        while (Date.now() < exitDeadline) {
            if (bootstrap.exitCode != null) break;
            await new Promise(r => setTimeout(r, 50));
        }
    }

    // Launch for real
    const startedAt = Date.now();
    const proc = spawn(exe.path, buildArgs(), {
        stdio: 'pipe',
        env: { ...process.env, HOME: os.homedir() }
    });

    // Wait for CDP to come up (max 15s)
    const readyDeadline = Date.now() + 15000;
    while (Date.now() < readyDeadline) {
        if (await isCdpHttpReachable(profile.cdpUrl, 500)) break;
        await new Promise(r => setTimeout(r, 200));
    }

    if (!(await isCdpHttpReachable(profile.cdpUrl, 500))) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        throw new Error(`Failed to start Chrome CDP on port ${profile.cdpPort} for profile "${profile.name}".`);
    }

    const pid = proc.pid || -1;
    console.log(`[browser] Chrome started (${exe.kind}) profile "${profile.name}" on 127.0.0.1:${profile.cdpPort} (pid ${pid})`);

    return { pid, exe, userDataDir, cdpPort: profile.cdpPort, startedAt, proc };
}

/**
 * Stop a running Chrome instance.
 * @param {RunningChrome} running
 * @param {number} [timeoutMs=2500]
 */
async function stopManagedChrome(running, timeoutMs = 2500) {
    const proc = running.proc;
    if (proc.killed || proc.exitCode != null) return;
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (proc.exitCode != null) return;
        await new Promise(r => setTimeout(r, 100));
    }

    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
}

module.exports = {
    findChromeExecutable,
    isCdpReady,
    isCdpHttpReachable,
    launchManagedChrome,
    stopManagedChrome
};
