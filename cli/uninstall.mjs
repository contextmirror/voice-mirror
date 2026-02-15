/**
 * Voice Mirror CLI — Uninstaller
 * Removes Voice Mirror installation: shortcuts, npm link, config, and data.
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, rmSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform, homedir } from 'os';
import { emitBanner } from './banner.mjs';
import { detectPlatform, getConfigPath } from './checks.mjs';
import { findDesktopFolder } from './setup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');

/**
 * Find desktop shortcut paths for the current platform.
 * @returns {string[]} Paths that exist
 */
function findShortcuts() {
    const desktop = findDesktopFolder();
    const os = platform();
    const paths = [];

    if (desktop) {
        if (os === 'win32') {
            paths.push(join(desktop, 'Voice Mirror.lnk'));
        } else if (os === 'darwin') {
            paths.push(join(desktop, 'Voice Mirror.command'));
        } else {
            paths.push(join(desktop, 'voice-mirror.desktop'));
        }
    }

    // Linux: also check ~/.local/share/applications/
    if (os === 'linux') {
        const appsEntry = join(homedir(), '.local', 'share', 'applications', 'voice-mirror.desktop');
        paths.push(appsEntry);
    }

    return paths.filter(p => existsSync(p));
}

/**
 * Get the config directory path (parent of config.json).
 */
function getConfigDir() {
    const configPath = getConfigPath();
    return dirname(configPath);
}

/**
 * Get the Windows FFmpeg path installed by our installer.
 */
function getWindowsFFmpegDir() {
    if (platform() !== 'win32') return null;
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    const ffmpegDir = join(localAppData, 'Programs', 'ffmpeg');
    return existsSync(ffmpegDir) ? ffmpegDir : null;
}

/**
 * Remove the npm global symlink for voice-mirror.
 */
function removeNpmLink() {
    try {
        execSync('npm unlink -g voice-mirror', {
            stdio: 'ignore',
            timeout: 15000,
        });
        return true;
    } catch {
        // May fail if not linked — that's fine
        return false;
    }
}

/**
 * Main uninstall routine.
 */
export async function runUninstall(opts = {}) {
    const { keepConfig, nonInteractive } = opts;

    emitBanner();
    p.intro(chalk.red.bold('Voice Mirror Uninstaller'));

    const info = detectPlatform();
    const shortcuts = findShortcuts();
    const configDir = getConfigDir();
    const configExists = existsSync(configDir);
    const ffmpegDir = getWindowsFFmpegDir();

    // --- Show what will be removed ---
    p.log.info(chalk.bold('The following items were found:'));

    const items = [];

    if (shortcuts.length > 0) {
        for (const s of shortcuts) {
            items.push({ label: `Desktop shortcut: ${s}`, path: s });
            p.log.step(`  Shortcut: ${chalk.dim(s)}`);
        }
    }

    // npm global link
    items.push({ label: 'npm global link (voice-mirror CLI)', type: 'npm' });
    p.log.step(`  npm global link: ${chalk.dim('voice-mirror')}`);

    if (configExists) {
        items.push({ label: `Config & data: ${configDir}`, path: configDir, isConfig: true });
        p.log.step(`  Config & data: ${chalk.dim(configDir)}`);
    }

    if (ffmpegDir) {
        items.push({ label: `FFmpeg (installed by Voice Mirror): ${ffmpegDir}`, path: ffmpegDir });
        p.log.step(`  FFmpeg: ${chalk.dim(ffmpegDir)}`);
    }

    p.log.step(`  Install directory: ${chalk.dim(PROJECT_DIR)}`);
    console.log();

    // --- Config preservation ---
    let removeConfig = !keepConfig;

    if (!nonInteractive && configExists && !keepConfig) {
        const preserveConfig = await p.confirm({
            message: 'Keep configuration files for future reinstall?',
            initialValue: true,
        });
        if (p.isCancel(preserveConfig)) {
            p.cancel('Uninstall cancelled.');
            process.exit(0);
        }
        removeConfig = !preserveConfig;
    }

    // --- Final confirmation ---
    if (!nonInteractive) {
        const confirmed = await p.confirm({
            message: chalk.red('This will remove Voice Mirror from your system. Continue?'),
            initialValue: false,
        });
        if (p.isCancel(confirmed) || !confirmed) {
            p.cancel('Uninstall cancelled.');
            process.exit(0);
        }
    }

    // --- Execute removal ---
    const spinner = p.spinner();

    // 1. Remove desktop shortcuts
    if (shortcuts.length > 0) {
        spinner.start('Removing desktop shortcuts...');
        for (const s of shortcuts) {
            try {
                unlinkSync(s);
            } catch { /* already gone */ }
        }
        spinner.stop('Desktop shortcuts removed');
    }

    // 2. Remove npm global link
    spinner.start('Removing npm global link...');
    const unlinked = removeNpmLink();
    spinner.stop(unlinked ? 'npm global link removed' : 'npm global link not found (skipped)');

    // 3. Remove config
    if (removeConfig && configExists) {
        spinner.start('Removing config & data...');
        try {
            rmSync(configDir, { recursive: true, force: true });
            spinner.stop('Config & data removed');
        } catch (err) {
            spinner.stop(`Could not remove config: ${err.message}`);
        }
    } else if (configExists) {
        p.log.info(`Config preserved at: ${chalk.cyan(configDir)}`);
    }

    // 4. Remove FFmpeg (Windows only)
    if (ffmpegDir) {
        spinner.start('Removing FFmpeg...');
        try {
            rmSync(ffmpegDir, { recursive: true, force: true });
            spinner.stop('FFmpeg removed');
        } catch (err) {
            spinner.stop(`Could not remove FFmpeg: ${err.message}`);
        }
    }

    // 5. Install directory — can't delete ourselves
    console.log();
    p.log.warning(
        `To complete the uninstall, delete the install directory:\n` +
        `  ${chalk.bold(PROJECT_DIR)}\n\n` +
        (info.isWindows
            ? `  ${chalk.dim('PowerShell:')} Remove-Item -Recurse -Force "${PROJECT_DIR}"`
            : `  ${chalk.dim('Terminal:')}    rm -rf "${PROJECT_DIR}"`)
    );

    console.log();
    p.outro(chalk.green('Voice Mirror has been uninstalled. Thanks for trying it out!'));
}
