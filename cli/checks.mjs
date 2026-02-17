/**
 * Voice Mirror CLI — System detection utilities
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { platform, arch } from 'os';

/**
 * Check if a command exists on PATH.
 */
export function commandExists(cmd) {
    try {
        const which = platform() === 'win32' ? 'where' : 'which';
        execFileSync(which, [cmd], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get Node.js version.
 */
export function getNodeVersion() {
    return process.version.replace(/^v/, '');
}

/**
 * Detect if the voice-core binary exists.
 * Checks packaged location and dev build locations.
 * Returns true if found, false otherwise.
 */
export function detectVoiceCore(projectDir) {
    const ext = platform() === 'win32' ? '.exe' : '';
    const binaryName = `voice-core${ext}`;

    // Packaged app: resources/bin/voice-core(.exe)
    const resourcesBin = join(projectDir, 'resources', 'bin', binaryName);
    if (existsSync(resourcesBin)) return true;

    // Dev: voice-core/target/release/voice-core(.exe)
    const releaseBin = join(projectDir, 'voice-core', 'target', 'release', binaryName);
    if (existsSync(releaseBin)) return true;

    // Dev: voice-core/target/debug/voice-core(.exe)
    const debugBin = join(projectDir, 'voice-core', 'target', 'debug', binaryName);
    if (existsSync(debugBin)) return true;

    return false;
}

/**
 * Detect OS platform info.
 */
export function detectPlatform() {
    const os = platform();
    const info = {
        os,
        arch: arch(),
        display: 'unknown',
        isLinux: os === 'linux',
        isMac: os === 'darwin',
        isWindows: os === 'win32',
    };

    if (os === 'linux') {
        // Detect display server
        if (process.env.WAYLAND_DISPLAY) {
            info.display = 'wayland';
        } else if (process.env.DISPLAY) {
            info.display = 'x11';
        }
    } else if (os === 'darwin') {
        info.display = 'quartz';
    } else if (os === 'win32') {
        info.display = 'win32';
    }

    return info;
}

/**
 * Check if Ollama is installed and running.
 * Returns { installed, running, models }
 */
export async function detectOllama() {
    const result = { installed: false, running: false, models: [] };

    if (!commandExists('ollama')) return result;
    result.installed = true;

    try {
        const resp = await fetch('http://localhost:11434/api/tags');
        if (resp.ok) {
            result.running = true;
            const data = await resp.json();
            result.models = (data.models || []).map(m => m.name);
        }
    } catch { /* not running */ }

    return result;
}

/**
 * Check if Claude CLI is installed.
 */
export function detectClaudeCli() {
    return commandExists('claude');
}

/**
 * Check if MCP server deps are installed.
 */
export function detectMCPServerDeps(projectDir) {
    const nodeModules = join(projectDir, 'mcp-server', 'node_modules');
    return existsSync(nodeModules);
}

/**
 * Check if Chromium is installed for Playwright.
 */
export function detectChromium() {
    try {
        execSync('npx playwright install --dry-run chromium', {
            stdio: 'ignore',
            timeout: 10000,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Read existing config file.
 */
export function readExistingConfig(configPath) {
    try {
        if (existsSync(configPath)) {
            return JSON.parse(readFileSync(configPath, 'utf8'));
        }
    } catch { /* corrupt config */ }
    return null;
}

/**
 * Get the config file path.
 */
export function getConfigPath() {
    const home = process.env.HOME || process.env.USERPROFILE;
    let base;
    if (process.platform === 'win32') {
        base = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
        base = join(home, 'Library', 'Application Support');
    } else {
        base = join(home, '.config');
    }
    return join(base, 'voice-mirror-electron', 'config.json');
}
