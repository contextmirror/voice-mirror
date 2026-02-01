/**
 * Voice Mirror CLI — System detection utilities
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { platform, arch, release } from 'os';

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
 * Detect Python 3 binary and version.
 * Returns { binary, version } or null.
 */
export function detectPython() {
    for (const bin of ['python3', 'python']) {
        try {
            const version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
            const match = version.match(/Python (\d+\.\d+\.\d+)/);
            if (match && parseInt(match[1]) >= 3) {
                return { binary: bin, version: match[1] };
            }
        } catch { /* skip */ }
    }
    return null;
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
 * Check Python venv status.
 */
export function detectPythonVenv(projectDir) {
    const venvDir = join(projectDir, 'python', '.venv');
    const venvBin = platform() === 'win32'
        ? join(venvDir, 'Scripts', 'python.exe')
        : join(venvDir, 'bin', 'python');
    return {
        exists: existsSync(venvDir),
        binary: venvBin,
        binExists: existsSync(venvBin),
    };
}

/**
 * Check if pip requirements are installed.
 */
export function checkPipRequirements(venvPython, projectDir) {
    const reqFile = join(projectDir, 'python', 'requirements.txt');
    if (!existsSync(reqFile)) return { ok: false, reason: 'requirements.txt not found' };

    try {
        execFileSync(venvPython, ['-c', 'import openwakeword; import sounddevice'], {
            stdio: 'ignore',
            timeout: 10000,
        });
        return { ok: true };
    } catch {
        return { ok: false, reason: 'missing packages' };
    }
}

/**
 * Check if wake word model exists.
 */
export function detectWakeWordModel(projectDir) {
    const modelPath = join(projectDir, 'python', 'models', 'hey_claude_v2.onnx');
    return existsSync(modelPath);
}

/**
 * Check if TTS models exist (both ONNX model and voices file).
 */
export function detectTTSModel(projectDir) {
    const modelPath = join(projectDir, 'python', 'kokoro-v1.0.onnx');
    const voicesPath = join(projectDir, 'python', 'voices-v1.0.bin');
    return existsSync(modelPath) && existsSync(voicesPath);
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
        execFileSync('npx', ['playwright', 'install', '--dry-run', 'chromium'], {
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
