/**
 * Voice Mirror CLI — Dependency installation helpers
 *
 * Historical note: This file previously contained Python venv and pip
 * automation. Those functions were removed when voice-core moved to Rust.
 * The remaining helpers (MCP deps, Chromium, ffmpeg) are still used by
 * setup.mjs and doctor.mjs.
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

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
 * Check if ffmpeg is installed (needed for TTS audio playback and voice cloning).
 */
export function detectFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
