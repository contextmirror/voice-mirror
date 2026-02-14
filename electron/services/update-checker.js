/**
 * Git-based update checker service
 * Checks if the local git repo is behind origin/main and notifies the user.
 * On user action, pulls updates and runs npm install if needed.
 * Update notifications appear in the sidebar banner (not chat toasts).
 */

const { execFile } = require('child_process');
const path = require('path');

function createUpdateChecker(options = {}) {
    const { safeSend, log, appDir } = options;
    const gitDir = appDir || path.join(__dirname, '..', '..');
    const isWin = process.platform === 'win32';
    let checkInterval = null;
    let startupTimeout = null;

    function exec(cmd, args, timeoutMs = 30000) {
        // On Windows, npm/npx must use .cmd extension with execFile
        const resolvedCmd = (isWin && (cmd === 'npm' || cmd === 'npx')) ? cmd + '.cmd' : cmd;
        return new Promise((resolve, reject) => {
            execFile(resolvedCmd, args, { cwd: gitDir, timeout: timeoutMs }, (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout.trim());
            });
        });
    }

    async function check() {
        try {
            await exec('git', ['fetch', 'origin', 'main', '--quiet']);

            const local = await exec('git', ['rev-parse', 'HEAD']);
            const remote = await exec('git', ['rev-parse', 'origin/main']);

            if (local === remote) return null;

            const behindCount = await exec('git', ['rev-list', '--count', 'HEAD..origin/main']);
            const behind = parseInt(behindCount, 10);
            if (behind === 0) return null;

            const latestMsg = await exec('git', ['log', 'origin/main', '-1', '--format=%s']);

            const result = {
                behind,
                currentHash: local.slice(0, 7),
                remoteHash: remote.slice(0, 7),
                latestCommit: latestMsg
            };

            if (safeSend) {
                safeSend('update-available', result);
            }
            if (log) {
                log('APP', `Update available: ${result.behind} commits behind (${result.remoteHash})`);
            }
            return result;
        } catch (err) {
            if (log) log('APP', `Update check skipped: ${err.message}`);
            return null;
        }
    }

    async function applyUpdate() {
        let stashed = false;
        try {
            if (safeSend) safeSend('update-status', { status: 'pulling' });

            // Stash local changes (including untracked files) if working tree is dirty
            const status = await exec('git', ['status', '--porcelain']);
            if (status) {
                await exec('git', ['stash', 'push', '--include-untracked', '-m', 'voice-mirror-auto-stash']);
                stashed = true;
            }

            const beforeHash = await exec('git', ['rev-parse', 'HEAD']);
            await exec('git', ['pull', 'origin', 'main']);
            const afterHash = await exec('git', ['rev-parse', 'HEAD']);

            const changed = await exec('git', ['diff', '--name-only', `${beforeHash}..${afterHash}`]);
            const needsInstall = changed.includes('package.json') || changed.includes('package-lock.json');

            if (needsInstall) {
                if (safeSend) safeSend('update-status', { status: 'installing' });
                await exec('npm', ['install', '--no-audit', '--no-fund'], 180000);
            }

            // Restore stashed changes
            if (stashed) {
                try {
                    await exec('git', ['stash', 'pop']);
                } catch (popErr) {
                    // Stash pop failed (merge conflict). Clean up the conflicted state
                    // so the repo isn't left broken. The stash is preserved since pop failed.
                    if (log) log('APP', `Stash pop conflict — discarding local changes, keeping upstream: ${popErr.message}`);
                    try {
                        await exec('git', ['checkout', '--', '.']);  // discard conflicted files
                        await exec('git', ['clean', '-fd']);         // remove untracked leftovers
                        await exec('git', ['stash', 'drop']);        // drop the stale stash
                    } catch (cleanupErr) {
                        if (log) log('APP', `Stash cleanup failed: ${cleanupErr.message}`);
                    }
                }
            }

            const needsPip = changed.includes('requirements.txt');

            if (safeSend) {
                safeSend('update-status', {
                    status: 'ready',
                    needsRestart: true,
                    needsPip
                });
            }
            return { success: true, needsPip };
        } catch (err) {
            // Pull itself failed — try to restore stashed changes and clean up
            if (stashed) {
                try {
                    await exec('git', ['stash', 'pop']);
                } catch (_) {
                    // Pop also failed — force clean state
                    try {
                        await exec('git', ['checkout', '--', '.']);
                        await exec('git', ['clean', '-fd']);
                        await exec('git', ['stash', 'drop']);
                    } catch (__) { /* last resort: stash stays for manual recovery */ }
                }
            }
            if (safeSend) safeSend('update-status', { status: 'error', message: err.message });
            return { success: false, error: err.message };
        }
    }

    function start(intervalMs = 3600000) {
        startupTimeout = setTimeout(() => check(), 10000);
        checkInterval = setInterval(() => check(), intervalMs);
    }

    function stop() {
        if (startupTimeout) {
            clearTimeout(startupTimeout);
            startupTimeout = null;
        }
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
    }

    return { check, applyUpdate, start, stop };
}

module.exports = { createUpdateChecker };
