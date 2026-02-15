/**
 * IPC handlers for miscellaneous operations.
 * Handles: toggle-log-viewer, open-external, quit-app, hotkey-fallback, devlog,
 *          send-to-python, get-python-status, start-python, stop-python,
 *          python-restart, send-query, set-voice-mode, send-image,
 *          list-audio-devices, get-detected-keys, check-cli-available,
 *          install-cli, chat-list, chat-load, chat-save, chat-delete,
 *          chat-rename, apply-update, app-relaunch
 */

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
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

    // Hotkey fallback from renderer — only honored when primary layers both failed
    ipcMain.on('hotkey-fallback', (event, id) => {
        const hotkeyManager = ctx.getHotkeyManager();
        if (!hotkeyManager) return;
        const binding = hotkeyManager.getBinding(id);
        if (binding && !binding.uiohookActive && !binding.globalShortcutActive) {
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

    // Audio device enumeration (asks Python backend)
    ipcMain.handle('list-audio-devices', async () => {
        const devices = ctx.listAudioDevices ? await ctx.listAudioDevices() : null;
        return { success: true, data: devices };
    });

    // Detect API keys from environment (returns provider names only, not keys)
    ipcMain.handle('get-detected-keys', () => {
        const { detectApiKeys } = require('../services/provider-detector');
        const detected = detectApiKeys();
        // Return only provider names that have keys — never send actual keys to renderer
        const keys = Object.keys(detected).filter(k => !k.startsWith('_'));
        return { success: true, data: keys };
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
                    const req = https.get(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace('%40', '@')}/latest`, { timeout: 10000 }, (res) => {
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

        // --- Run all 3 sections in parallel ---
        const [npm, system, pip] = await Promise.all([
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

                // Python (from venv, fallback to system)
                const pythonDir = path.join(__dirname, '..', '..', 'python');
                const isWin = process.platform === 'win32';
                const venvPython = isWin
                    ? path.join(pythonDir, '.venv', 'Scripts', 'python.exe')
                    : path.join(pythonDir, '.venv', 'bin', 'python');
                const pythonBin = fs.existsSync(venvPython) ? venvPython : (isWin ? 'python' : 'python3');
                try {
                    const version = await new Promise((resolve) => {
                        execFile(pythonBin, ['--version'], { timeout: 10000, windowsHide: true }, (err, stdout) => {
                            if (err) return resolve(null);
                            const match = stdout.match(/Python (\d+\.\d+\.\d+)/);
                            resolve(match ? match[1] : null);
                        });
                    });
                    results.python = version ? { version } : { version: null, error: 'Not found' };
                } catch {
                    results.python = { version: null, error: 'Not found' };
                }

                // Ollama
                results.ollama = { installed: isCLIAvailable('ollama') };

                // ffmpeg
                try {
                    const found = await new Promise((resolve) => {
                        execFile('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true }, (err) => {
                            resolve(!err);
                        });
                    });
                    results.ffmpeg = { installed: found };
                } catch {
                    results.ffmpeg = { installed: false };
                }

                return results;
            })(),

            // Section 3: Python pip outdated
            (async () => {
                const pythonDir = path.join(__dirname, '..', '..', 'python');
                const isWin = process.platform === 'win32';
                const venvPython = isWin
                    ? path.join(pythonDir, '.venv', 'Scripts', 'python.exe')
                    : path.join(pythonDir, '.venv', 'bin', 'python');

                if (!fs.existsSync(venvPython)) {
                    return { outdated: [], error: 'Python venv not found' };
                }

                try {
                    const outdated = await new Promise((resolve, reject) => {
                        execFile(venvPython, ['-m', 'pip', 'list', '--outdated', '--format=json'], {
                            timeout: 30000, windowsHide: true, cwd: pythonDir
                        }, (err, stdout) => {
                            if (err) return reject(err);
                            try {
                                const data = JSON.parse(stdout);
                                resolve(data.map(p => ({ name: p.name, installed: p.version, latest: p.latest_version })));
                            } catch (e) { reject(e); }
                        });
                    });
                    return { outdated };
                } catch (err) {
                    ctx.logger.error('[Deps]', `pip outdated check failed: ${err.message}`);
                    return { outdated: [], error: 'Check failed' };
                }
            })()
        ]);

        return { success: true, data: { npm, system, pip } };
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

    // Pip package upgrade handler — stops Python first to release DLL locks
    ipcMain.handle('update-pip-packages', async () => {
        const { execFile } = require('child_process');
        const pythonDir = path.join(__dirname, '..', '..', 'python');
        const isWin = process.platform === 'win32';
        const venvPython = isWin
            ? path.join(pythonDir, '.venv', 'Scripts', 'python.exe')
            : path.join(pythonDir, '.venv', 'bin', 'python');
        const reqFile = path.join(pythonDir, 'requirements.txt');

        if (!fs.existsSync(venvPython)) {
            return { success: false, error: 'Python venv not found' };
        }
        if (!fs.existsSync(reqFile)) {
            return { success: false, error: 'requirements.txt not found' };
        }

        // Stop Python backend to release DLL locks (onnxruntime, psutil, etc.)
        const pythonBackend = ctx.getPythonBackend();
        const wasRunning = pythonBackend?.isRunning();
        if (wasRunning) {
            ctx.logger.info('[Dep Update]', 'Stopping Python backend for pip upgrade...');
            pythonBackend.stop();
            // Wait for process to fully exit before pip install
            await new Promise(r => setTimeout(r, 2000));
        }

        const result = await new Promise((resolve) => {
            execFile(venvPython, ['-m', 'pip', 'install', '-r', reqFile, '--upgrade'], {
                timeout: 300000, windowsHide: true, cwd: pythonDir, shell: true
            }, (err, stdout, stderr) => {
                if (err) {
                    const hint = stderr?.match(/ERROR: .*/)?.[0] || err.message;
                    ctx.logger.error('[Dep Update]', 'pip upgrade failed:', err.message);
                    if (stderr) ctx.logger.error('[Dep Update]', 'stderr:', stderr.slice(0, 500));
                    resolve({ success: false, error: hint.slice(0, 200) });
                } else {
                    ctx.logger.info('[Dep Update]', 'pip packages upgraded successfully');
                    resolve({ success: true });
                }
            });
        });

        // Restart Python backend if it was running before
        if (wasRunning) {
            ctx.logger.info('[Dep Update]', 'Restarting Python backend...');
            ctx.startPythonVoiceMirror();
        }

        return result;
    });

    // Image handling - send to Python backend
    ipcMain.handle('send-image', async (event, imageData) => {
        const v = validators['send-image'](imageData);
        if (!v.valid) return { success: false, error: v.error };
        const result = await ctx.sendImageToPython(v.value);
        return { success: true, data: result };
    });

    // Python backend communication
    ipcMain.handle('send-query', (event, query) => {
        const v = validators['send-query'](query);
        if (!v.valid) return { success: false, error: v.error };
        ctx.sendToPython({ command: 'query', text: v.value.text, image: v.value.image });
        return { success: true };
    });

    ipcMain.handle('set-voice-mode', (event, mode) => {
        const v = validators['set-voice-mode'](mode);
        if (!v.valid) return { success: false, error: v.error };
        ctx.sendToPython({ command: 'set_mode', mode: v.value });
        return { success: true };
    });

    ipcMain.handle('get-python-status', () => {
        const pythonBackend = ctx.getPythonBackend();
        return {
            success: true,
            data: {
                running: pythonBackend?.isRunning() || false,
                pid: pythonBackend?.getProcess()?.pid
            }
        };
    });

    ipcMain.handle('start-python', () => {
        if (!ctx.getPythonBackend()?.isRunning()) {
            ctx.startPythonVoiceMirror();
            return { success: true };
        }
        return { success: false, error: 'already running' };
    });

    ipcMain.handle('stop-python', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
            return { success: true };
        }
        return { success: false, error: 'not running' };
    });

    // Manual restart (resets retry counter for user-initiated recovery)
    ipcMain.handle('python-restart', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend) {
            pythonBackend.restart();
            return { success: true };
        }
        return { success: false, error: 'backend not initialized' };
    });

    // ========== Chat History Persistence ==========
    const chatsDir = path.join(app.getPath('userData'), 'chats');

    ipcMain.handle('chat-list', async () => {
        try {
            if (!fs.existsSync(chatsDir)) return { success: true, data: [] };
            const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));
            const chats = [];
            for (const file of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(chatsDir, file), 'utf-8'));
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
            if (!fs.existsSync(filePath)) return { success: false, error: 'Chat not found' };
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return { success: true, data };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to load chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-save', async (_event, chat) => {
        try {
            if (!chat || !chat.id) return { success: false, error: 'Invalid chat data' };
            if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
            const filePath = ensureWithin(chatsDir, `${chat.id}.json`);
            chat.updated = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to save chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-delete', async (_event, id) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return { success: true };
        } catch (err) {
            ctx.logger.error('[Chat]', 'Failed to delete chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-rename', async (_event, id, name) => {
        try {
            const filePath = ensureWithin(chatsDir, `${id}.json`);
            if (!fs.existsSync(filePath)) return { success: false, error: 'Chat not found' };
            const chat = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            chat.name = name;
            chat.updated = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
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

    // Update checker
    ipcMain.handle('apply-update', async () => {
        const checker = ctx.getUpdateChecker?.();
        if (checker) {
            return await checker.applyUpdate();
        }
        return { success: false, error: 'Update checker not initialized' };
    });

    // App relaunch (used after updates)
    ipcMain.handle('app-relaunch', () => {
        app.relaunch();
        app.exit(0);
        return { success: true };
    });
}

module.exports = { registerMiscHandlers };
