/**
 * Voice Mirror CLI — Python venv and pip automation
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { detectPython, detectPythonVenv } from './checks.mjs';

/**
 * Create Python venv if it doesn't exist.
 * Returns { ok, binary, error }
 */
export function createVenv(projectDir, spinner) {
    const pythonDir = join(projectDir, 'python');
    const venvDir = join(pythonDir, '.venv');

    if (existsSync(venvDir)) {
        const venv = detectPythonVenv(projectDir);
        if (venv.binExists) {
            return { ok: true, binary: venv.binary };
        }
    }

    const python = detectPython();
    if (!python) {
        return { ok: false, error: 'Python 3 not found. Install Python 3.9+ and try again.' };
    }

    spinner.update(`Creating Python venv with ${python.binary}...`);
    try {
        execFileSync(python.binary, ['-m', 'venv', venvDir], {
            stdio: 'pipe',
            timeout: 60000,
        });
        const venv = detectPythonVenv(projectDir);
        return { ok: true, binary: venv.binary };
    } catch (err) {
        return { ok: false, error: `Failed to create venv: ${err.message}` };
    }
}

/**
 * Install pip requirements.
 * Returns { ok, error }
 */
export function installRequirements(venvPython, projectDir, spinner) {
    const reqFile = join(projectDir, 'python', 'requirements.txt');

    if (!existsSync(reqFile)) {
        return { ok: false, error: 'requirements.txt not found' };
    }

    spinner.update('Installing Python dependencies...');
    try {
        // Upgrade pip first
        execFileSync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
            stdio: 'pipe',
            timeout: 60000,
            cwd: join(projectDir, 'python'),
        });

        // Install requirements
        execFileSync(venvPython, ['-m', 'pip', 'install', '-r', reqFile], {
            stdio: 'pipe',
            timeout: 300000, // 5 min for large packages
            cwd: join(projectDir, 'python'),
        });

        return { ok: true };
    } catch (err) {
        return { ok: false, error: `pip install failed: ${err.message}` };
    }
}

/**
 * Install optional voice cloning dependencies.
 */
export function installVoiceCloneDeps(venvPython, spinner) {
    spinner.update('Installing voice cloning dependencies...');
    try {
        execFileSync(venvPython, ['-m', 'pip', 'install', 'yt-dlp'], {
            stdio: 'pipe',
            timeout: 120000,
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Install MCP server dependencies.
 */
export function installMCPDeps(projectDir, spinner) {
    const mcpDir = join(projectDir, 'mcp-server');

    if (!existsSync(join(mcpDir, 'package.json'))) {
        return { ok: false, error: 'mcp-server/package.json not found' };
    }

    spinner.update('Installing MCP server dependencies...');
    try {
        execSync('npm install', {
            stdio: 'pipe',
            timeout: 120000,
            cwd: mcpDir,
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: `npm install failed: ${err.message}` };
    }
}

/**
 * Install Chromium for Playwright browser automation.
 */
export function installChromium(projectDir, spinner) {
    spinner.update('Installing Chromium for browser automation (~200MB)...');
    try {
        execSync('npx playwright install chromium', {
            stdio: 'pipe',
            timeout: 300000,
            cwd: projectDir,
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Download TTS models (kokoro) via Python.
 * The kokoro-onnx package auto-downloads on first import.
 */
export async function downloadTTSModels(venvPython, projectDir, spinner) {
    const pythonDir = join(projectDir, 'python');
    const voicesPath = join(pythonDir, 'voices-v1.0.bin');
    const voicesUrl = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin';

    // Step 1: Download voices file directly if missing (kokoro-onnx doesn't always auto-download it)
    if (!existsSync(voicesPath)) {
        spinner.update('Downloading TTS voices file (27 MB)...');
        try {
            const { downloadFile } = await import('./ollama-setup.mjs');
            await downloadFile(voicesUrl, voicesPath);
        } catch (err) {
            spinner.update(`Voices download failed: ${err.message}, trying via Python...`);
        }
    }

    // Step 2: Trigger kokoro ONNX model download by importing it
    spinner.update('Downloading TTS model (kokoro)...');
    try {
        execFileSync(venvPython, ['-c', `
import os
os.chdir(${JSON.stringify(pythonDir)})
try:
    from kokoro_onnx import Kokoro
    k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
    print("ok")
except Exception as e:
    print(f"skip: {e}")
`], {
            stdio: 'pipe',
            timeout: 300000, // 5 min for large download
            cwd: pythonDir,
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Check if ffmpeg is installed (needed for voice cloning).
 */
export function detectFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
