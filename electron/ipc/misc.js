/**
 * IPC handlers for miscellaneous operations.
 * Handles: toggle-log-viewer, open-external, quit-app, hotkey-fallback, devlog,
 *          check-cli-available, install-cli, check-dependency-versions,
 *          update-dependency, run-uninstall,
 *          chat-list, chat-load, chat-save, chat-delete, chat-rename,
 *          get-app-version, get-changelog, mark-version-seen,
 *          apply-update, install-update, app-relaunch
 */

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { ensureWithin } = require('../lib/safe-path');

/**
 * Register miscellaneous IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerMiscHandlers(ctx, validators) {
    // Dev logging from renderer -> vmr.log
    ipcMain.on('devlog', (_event, category, action, data) => {
        ctx.logger.devlog(category, action, data || {});
    });

    // Hotkey fallback from renderer — only honored when globalShortcut failed
    ipcMain.on('hotkey-fallback', (event, id) => {
        const hotkeyManager = ctx.getHotkeyManager();
        if (!hotkeyManager) return;
        const binding = hotkeyManager.getBinding(id);
        if (binding && !binding.globalShortcutActive) {
            ctx.logger.log('HOTKEY', `Fallback triggered for "${id}" from renderer`);
            binding.callback();
        }
    });

    // Toggle the log viewer window
    ipcMain.handle('toggle-log-viewer', () => {
        const logViewer = ctx.getLogViewer?.();
        if (!logViewer) return { success: false, error: 'Log viewer not initialized' };
        logViewer.toggle();
        return { success: true };
    });

    // Open external URLs in default browser
    ipcMain.handle('open-external', async (event, url) => {
        const v = validators['open-external'](url);
        if (!v.valid) return { success: false, error: v.error };
        try {
            await shell.openExternal(v.value);
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Misc]', 'Failed to open external URL:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('quit-app', () => {
        app.isQuitting = true;
        app.quit();
        return { success: true };
    });

    // CLI availability check
    ipcMain.handle('check-cli-available', (_event, command) => {
        if (typeof command !== 'string' || command.length > 50) {
            return { success: false, error: 'Invalid command' };
        }
        const { isCLIAvailable } = require('../providers/cli-spawner');
        return { success: true, data: { available: isCLIAvailable(command) } };
    });

    // CLI install via npm global
    ipcMain.handle('install-cli', async (_event, packageName) => {
        const ALLOWED_PACKAGES = { opencode: 'opencode-ai' };

        if (typeof packageName !== 'string' || !ALLOWED_PACKAGES[packageName]) {
            return { success: false, error: `Package "${packageName}" is not allowed` };
        }

        const npmPackage = ALLOWED_PACKAGES[packageName];
        const { execFile } = require('child_process');
        const npmCmd = 'npm';

        return new Promise((resolve) => {
            execFile(npmCmd, ['install', '-g', npmPackage], {
                timeout: 120000,
                windowsHide: true,
                shell: true,
                env: { ...process.env }
            }, (err, _stdout, stderr) => {
                if (err) {
                    ctx.logger.error('[CLI Install]', `Failed to install ${npmPackage}:`, err.message);
                    resolve({ success: false, error: err.message, stderr: stderr?.slice(0, 500) });
                } else {
                    ctx.logger.info('[CLI Install]', `Successfully installed ${npmPackage}`);
                    resolve({ success: true });
                }
            });
        });
    });

    // Dependency version checking (for Dependencies settings tab)
    ipcMain.handle('check-dependency-versions', async () => {
        const { execFile } = require('child_process');
        const npmCmd = 'npm';
        const appDir = path.join(__dirname, '..', '..');

        // Helper: fetch latest version from npm registry
        async function fetchLatest(pkg) {
            try {
                const https = require('https');
                return new Promise((resolve) => {
                    const req = https.get(`https://registry.npmjs.org/${encodeURIComponent(pkg).replaceAll('%40', '@')}/latest`, { timeout: 10000 }, (res) => {
                        let data = '';
                        res.on('data', chunk => { data += chunk; });
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(data).version || null);
                            } catch { resolve(null); }
                        });
                    });
                    req.on('error', () => resolve(null));
                    req.on('timeout', () => { req.destroy(); resolve(null); });
                });
            } catch { return null; }
        }

        // Helper: get global npm package version
        async function getGlobalNpmVersion(npmPkg) {
            return new Promise((resolve) => {
                execFile(npmCmd, ['list', '-g', npmPkg, '--depth=0', '--json'], {
                    timeout: 15000, windowsHide: true, shell: true
                }, (err, stdout) => {
                    if (err) return resolve(null);
                    try {
                        const data = JSON.parse(stdout);
                        resolve(data.dependencies?.[npmPkg]?.version || null);
                    } catch { resolve(null); }
                });
            });
        }

        // Helper: get CLI version via --version flag (fallback when npm list fails)
        async function getCLIVersion(command) {
            return new Promise((resolve) => {
                execFile(command, ['--version'], {
                    timeout: 10000, windowsHide: true, shell: true
                }, (err, stdout) => {
                    if (err) return resolve(null);
                    // Parse version from output like "1.2.4" or "claude v2.1.42" or "Python 3.11.0"
                    const match = stdout.trim().match(/v?(\d+\.\d+\.\d+)/);
                    resolve(match ? match[1] : null);
                });
            });
        }

        // Helper: check global CLI package
        async function checkGlobalCLI(command, npmPkg, registryPkg) {
            try {
                const { isCLIAvailable } = require('../providers/cli-spawner');
                const isInstalled = isCLIAvailable(command);
                if (!isInstalled) {
                    const latest = await fetchLatest(registryPkg);
                    return { installed: null, latest, updateAvailable: false, notInstalled: true };
                }
                // Try npm global list first, fall back to --version flag
                let installed = await getGlobalNpmVersion(npmPkg);
                if (!installed) {
                    installed = await getCLIVersion(command);
                }
                const latest = await fetchLatest(registryPkg);
                return {
                    installed,
                    latest,
                    updateAvailable: latest && installed && installed !== latest
                };
            } catch (err) {
                ctx.logger.error('[Deps]', `${command} check failed: ${err.message}`);
                return { installed: null, latest: null, updateAvailable: false, error: 'Check failed' };
            }
        }

        // --- Run both sections in parallel ---
        const [npm, system] = await Promise.all([
            // Section 1: npm packages
            (async () => {
                const results = {};

                // ghostty-web: local npm package
                try {
                    const pkgPath = path.join(appDir, 'node_modules', 'ghostty-web', 'package.json');
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    const installed = pkg.version;
                    const latest = await fetchLatest('ghostty-web');
                    results.ghosttyWeb = { installed, latest, updateAvailable: latest && installed !== latest };
                } catch {
                    results.ghosttyWeb = { installed: null, latest: null, updateAvailable: false, error: 'Not found' };
                }

                // OpenCode: global npm package
                results.opencode = await checkGlobalCLI('opencode', 'opencode-ai', 'opencode-ai');

                // Claude Code: global npm package
                results.claudeCode = await checkGlobalCLI('claude', '@anthropic-ai/claude-code', '@anthropic-ai/claude-code');

                return results;
            })(),

            // Section 2: System tools
            (async () => {
                const results = {};
                const { isCLIAvailable } = require('../providers/cli-spawner');

                // Node.js
                results.node = { version: process.version.replace(/^v/, '') };

                // Ollama — extract version from `ollama --version`
                try {
                    const ollamaVersion = await new Promise((resolve) => {
                        execFile('ollama', ['--version'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
                            if (err) return resolve(null);
                            const match = stdout.match(/(\d+\.\d+\.\d+)/);
                            resolve(match ? match[1] : null);
                        });
                    });
                    results.ollama = ollamaVersion
                        ? { installed: true, version: ollamaVersion }
                        : { installed: isCLIAvailable('ollama') };
                } catch {
                    results.ollama = { installed: false };
                }

                // ffmpeg — extract version from `ffmpeg -version`
                try {
                    const ffmpegVersion = await new Promise((resolve) => {
                        execFile('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
                            if (err) return resolve(null);
                            const match = stdout.match(/ffmpeg version (\d+\.\d+\.\d+)/);
                            resolve(match ? match[1] : null);
                        });
                    });
                    results.ffmpeg = ffmpegVersion
                        ? { installed: true, version: ffmpegVersion }
                        : { installed: false };
                } catch {
                    results.ffmpeg = { installed: false };
                }

                return results;
            })()
        ]);

        return { success: true, data: { npm, system } };
    });

    // Dependency update handler
    ipcMain.handle('update-dependency', async (_event, depId) => {
        const { execFile } = require('child_process');
        const npmCmd = 'npm';
        const appDir = path.join(__dirname, '..', '..');

        const ALLOWED = {
            'ghostty-web': { pkg: 'ghostty-web@latest', global: false },
            'opencode': { pkg: 'opencode-ai@latest', global: true },
            'claude-code': { pkg: '@anthropic-ai/claude-code@latest', global: true }
        };

        if (!ALLOWED[depId]) {
            return { success: false, error: `Unknown dependency: ${depId}` };
        }

        const { pkg, global: isGlobal } = ALLOWED[depId];
        const args = isGlobal
            ? ['install', '-g', pkg, '--no-audit', '--no-fund']
            : ['install', pkg, '--no-audit', '--no-fund'];
        const opts = { timeout: 180000, windowsHide: true, shell: true, cwd: isGlobal ? undefined : appDir };

        return new Promise((resolve) => {
            execFile(npmCmd, args, opts, (err, _stdout, stderr) => {
                if (err) {
                    ctx.logger.error('[Dep Update]', `Failed to update ${depId}:`, err.message);
                    resolve({ success: false, error: err.message, stderr: stderr?.slice(0, 500) });
                } else {
                    ctx.logger.info('[Dep Update]', `Successfully updated ${depId}`);
                    resolve({ success: true });
                }
            });
        });
    });

    // ========== Chat History Persistence ==========
    const chatsDir = path.join(app.getPath('userData'), 'chats');

    ipcMain.handle('chat-list', async () => {
        try {
            try { await fsPromises.access(chatsDir); } catch { return { success: true, data: [] }; }
            const files = (await fsPromises.readdir(chatsDir)).filter(f => f.endsWith('.json'));
            const chats = [];
            for (const file of files) {
                try {
                    const data = JSON.parse(await fsPromises.readFile(path.join(chatsDir, file), 'utf-8'));
                    chats.push({
                        id: data.id,
                        name: data.name || 'Untitled',
                        created: data.created,
                        updated: data.updated,
                        messageCount: (data.messages || []).length,
                    });
                } catch { /* skip corrupt files */ }
            }
            chats.sort((a, b) => new Date(b.updated) - new Date(a.updated));
            return { success: true, data: chats };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to list chats:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-load', async (_event, id) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            try { await fsPromises.access(filePath); } catch { return { success: false, error: 'Chat not found' }; }
            const data = JSON.parse(await fsPromises.readFile(filePath, 'utf-8'));
            return { success: true, data };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to load chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-save', async (_event, chat) => {
        try {
            if (!chat || !chat.id) return { success: false, error: 'Invalid chat data' };
            await fsPromises.mkdir(chatsDir, { recursive: true });
            const filePath = ensureWithin(chatsDir, `${chat.id}.json`);
            chat.updated = new Date().toISOString();
            await fsPromises.writeFile(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to save chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-delete', async (_event, id) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            await fsPromises.unlink(filePath).catch(() => {});
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to delete chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-rename', async (_event, id, name) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            let raw;
            try { raw = await fsPromises.readFile(filePath, 'utf-8'); } catch { return { success: false, error: 'Chat not found' }; }
            const chat = JSON.parse(raw);
            chat.name = name;
            chat.updated = new Date().toISOString();
            await fsPromises.writeFile(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to rename chat:', err);
            return { success: false, error: err.message };
        }
    });

    // Uninstall — remove shortcuts, npm link, optionally config
    ipcMain.handle('run-uninstall', async (_event, keepConfig) => {
        const os = require('os');
        const platform = os.platform();
        const homedir = os.homedir();

        const removed = [];
        const errors = [];

        // 1. Remove desktop shortcut(s)
        try {
            if (platform === 'win32') {
                // Windows: find Desktop via registry fallback
                const desktopCandidates = [
                    path.join(homedir, 'Desktop'),
                    path.join(homedir, 'OneDrive', 'Desktop'),
                    path.join(homedir, 'OneDrive - Personal', 'Desktop'),
                ];
                for (const dir of desktopCandidates) {
                    const lnk = path.join(dir, 'Voice Mirror.lnk');
                    if (fs.existsSync(lnk)) {
                        fs.unlinkSync(lnk);
                        removed.push(`Shortcut: ${lnk}`);
                    }
                }
            } else if (platform === 'darwin') {
                const shortcut = path.join(homedir, 'Desktop', 'Voice Mirror.command');
                if (fs.existsSync(shortcut)) {
                    fs.unlinkSync(shortcut);
                    removed.push(`Shortcut: ${shortcut}`);
                }
            } else {
                // Linux
                const desktopFile = path.join(homedir, 'Desktop', 'voice-mirror.desktop');
                if (fs.existsSync(desktopFile)) {
                    fs.unlinkSync(desktopFile);
                    removed.push(`Shortcut: ${desktopFile}`);
                }
                const appsEntry = path.join(homedir, '.local', 'share', 'applications', 'voice-mirror.desktop');
                if (fs.existsSync(appsEntry)) {
                    fs.unlinkSync(appsEntry);
                    removed.push(`App entry: ${appsEntry}`);
                }
            }
        } catch (err) {
            errors.push(`Shortcut removal: ${err.message}`);
        }

        // 2. Remove npm global link
        try {
            const { execFileSync } = require('child_process');
            execFileSync('npm', ['unlink', '-g', 'voice-mirror'], {
                timeout: 15000,
                windowsHide: true,
                shell: true,
                stdio: 'ignore',
            });
            removed.push('npm global link');
        } catch {
            // May not be linked — not an error
        }

        // 3. Remove config directory (unless keeping)
        if (!keepConfig) {
            try {
                const configDir = path.dirname(app.getPath('userData'));
                const vmConfigDir = path.join(configDir, 'voice-mirror-electron');
                // Fallback: app.getPath('userData') might already be the right dir
                const actualDir = fs.existsSync(vmConfigDir) ? vmConfigDir : app.getPath('userData');
                if (fs.existsSync(actualDir)) {
                    fs.rmSync(actualDir, { recursive: true, force: true });
                    removed.push(`Config: ${actualDir}`);
                }
            } catch (err) {
                errors.push(`Config removal: ${err.message}`);
            }
        }

        // 4. Remove FFmpeg (Windows only — installed by our installer)
        if (platform === 'win32') {
            try {
                const localAppData = process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
                const ffmpegDir = path.join(localAppData, 'Programs', 'ffmpeg');
                if (fs.existsSync(ffmpegDir)) {
                    fs.rmSync(ffmpegDir, { recursive: true, force: true });
                    removed.push(`FFmpeg: ${ffmpegDir}`);
                }
            } catch (err) {
                errors.push(`FFmpeg removal: ${err.message}`);
            }
        }

        const installDir = path.join(__dirname, '..', '..');
        ctx.logger.info('[Uninstall]', `Removed: ${removed.join(', ') || 'nothing'}`);
        if (errors.length) ctx.logger.error('[Uninstall]', `Errors: ${errors.join('; ')}`);

        return {
            success: true,
            removed,
            errors,
            installDir,
        };
    });

    // Get app version (for renderer "What's New" checks)
    ipcMain.handle('get-app-version', () => app.getVersion());

    // Get changelog section for a specific version
    ipcMain.handle('get-changelog', async (_event, version) => {
        if (typeof version !== 'string' || version.length > 20) {
            return { success: false, error: 'Invalid version' };
        }

        // Find CHANGELOG.md — packaged app uses resources/, dev uses project root
        const candidates = [
            path.join(process.resourcesPath || '', 'CHANGELOG.md'),
            path.join(__dirname, '..', '..', 'CHANGELOG.md'),
        ];

        let content = null;
        for (const p of candidates) {
            try {
                content = await fsPromises.readFile(p, 'utf-8');
                break;
            } catch { /* try next */ }
        }

        if (!content) {
            return { success: false, error: 'CHANGELOG.md not found' };
        }

        // Extract section between ## vX.X.X and next ## v heading
        const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(## v${escaped}[^\\n]*\\n)([\\s\\S]*?)(?=\\n## v|$)`);
        const match = content.match(regex);
        if (!match) {
            return { success: false, error: `No changelog entry for v${version}` };
        }

        return { success: true, data: match[1] + match[2].trimEnd() };
    });

    // Mark a version as seen (for "What's New" notification)
    ipcMain.handle('mark-version-seen', async (_event, version) => {
        if (typeof version !== 'string' || version.length > 20) {
            return { success: false, error: 'Invalid version' };
        }
        const { updateConfigAsync } = require('../config');
        await updateConfigAsync({ system: { lastSeenVersion: version } });
        return { success: true };
    });

    // Update checker — triggers download of available update
    ipcMain.handle('apply-update', async () => {
        const checker = ctx.getUpdateChecker?.();
        if (checker) {
            return await checker.applyUpdate();
        }
        return { success: false, error: 'Update checker not initialized' };
    });

    // Install downloaded update — quit and install via electron-updater
    ipcMain.handle('install-update', () => {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
    });

    // App relaunch (used after updates)
    ipcMain.handle('app-relaunch', () => {
        app.relaunch();
        app.exit(0);
        return { success: true };
    });
}

module.exports = { registerMiscHandlers };
