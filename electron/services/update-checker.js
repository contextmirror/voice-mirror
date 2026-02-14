/**
 * Git-based update checker service (self-healing)
 * Checks if the local git repo is behind origin/main and notifies the user.
 * On user action, resets to origin/main with pre-flight healing and post-flight verification.
 * Update notifications appear in the sidebar banner (not chat toasts).
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

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
            execFile(resolvedCmd, args, { cwd: gitDir, timeout: timeoutMs }, (err, stdout, stderr) => {
                if (err) {
                    err.stderr = stderr;
                    reject(err);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    function sendStatus(status, extra = {}) {
        if (safeSend) safeSend('update-status', { status, ...extra });
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

    /**
     * Pre-flight: detect and fix broken git state before updating.
     * Handles: merge conflicts, rebase in progress, detached HEAD,
     * wrong branch, lock files, dirty working tree.
     */
    async function preflight() {
        const healed = [];

        // 1. Remove stale lock files that prevent git operations
        const lockFile = path.join(gitDir, '.git', 'index.lock');
        if (fs.existsSync(lockFile)) {
            try {
                fs.unlinkSync(lockFile);
                healed.push('removed stale index.lock');
            } catch (e) {
                throw new Error(`Cannot remove index.lock: ${e.message}`);
            }
        }

        // 2. Abort any in-progress merge
        const mergeHead = path.join(gitDir, '.git', 'MERGE_HEAD');
        if (fs.existsSync(mergeHead)) {
            await exec('git', ['merge', '--abort']);
            healed.push('aborted stuck merge');
        }

        // 3. Abort any in-progress rebase
        const rebaseDir = path.join(gitDir, '.git', 'rebase-merge');
        const rebaseApplyDir = path.join(gitDir, '.git', 'rebase-apply');
        if (fs.existsSync(rebaseDir) || fs.existsSync(rebaseApplyDir)) {
            await exec('git', ['rebase', '--abort']);
            healed.push('aborted stuck rebase');
        }

        // 4. Abort any in-progress cherry-pick
        const cherryPickHead = path.join(gitDir, '.git', 'CHERRY_PICK_HEAD');
        if (fs.existsSync(cherryPickHead)) {
            await exec('git', ['cherry-pick', '--abort']);
            healed.push('aborted stuck cherry-pick');
        }

        // 5. Ensure we're on the main branch (not detached HEAD or other branch)
        const currentBranch = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
        if (currentBranch !== 'main') {
            // Discard any local changes first so checkout doesn't fail
            await exec('git', ['checkout', '--', '.']);
            await exec('git', ['clean', '-fd']);
            await exec('git', ['checkout', 'main']);
            healed.push(`switched from ${currentBranch} to main`);
        }

        // 6. Drop all auto-stashes from previous failed updates
        try {
            const stashList = await exec('git', ['stash', 'list']);
            if (stashList.includes('voice-mirror-auto-stash')) {
                // Drop matching stashes (iterate from top to avoid index shifting)
                const lines = stashList.split('\n');
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].includes('voice-mirror-auto-stash')) {
                        const stashRef = lines[i].split(':')[0]; // e.g. "stash@{0}"
                        await exec('git', ['stash', 'drop', stashRef]);
                        healed.push(`dropped stale stash ${stashRef}`);
                    }
                }
            }
        } catch (_) { /* no stashes — fine */ }

        if (healed.length > 0 && log) {
            log('APP', `Update pre-flight healed: ${healed.join(', ')}`);
        }
        return healed;
    }

    async function applyUpdate() {
        try {
            sendStatus('pulling');

            // Phase 1: Pre-flight — heal any broken git state
            if (log) log('APP', 'Update: running pre-flight checks...');
            await preflight();

            // Phase 2: Fetch latest from origin
            await exec('git', ['fetch', 'origin', 'main', '--quiet']);
            const targetHash = await exec('git', ['rev-parse', 'origin/main']);
            const beforeHash = await exec('git', ['rev-parse', 'HEAD']);

            if (beforeHash === targetHash) {
                sendStatus('ready', { needsRestart: false });
                return { success: true, alreadyUpToDate: true };
            }

            // Phase 3: Hard reset to origin/main (no merge conflicts possible)
            // This is safe because end-users don't have local commits to preserve.
            // Any local modifications are development artifacts or corruption.
            await exec('git', ['reset', '--hard', 'origin/main']);

            // Remove untracked files that might conflict with new version
            await exec('git', ['clean', '-fd']);

            // Phase 4: Always run npm install
            // Even if package.json didn't change — catches previously failed installs,
            // corrupted node_modules, or missing native rebuilds after Node upgrades.
            // Non-fatal: git reset already succeeded, app may work without fresh install.
            let installFailed = false;
            try {
                sendStatus('installing');
                if (log) log('APP', 'Update: running npm install...');
                await exec('npm', ['install', '--no-audit', '--no-fund'], 300000);
            } catch (installErr) {
                installFailed = true;
                if (log) log('APP', `npm install failed (non-fatal): ${installErr.message}`);
            }

            // Phase 5: Post-flight verification
            const afterHash = await exec('git', ['rev-parse', 'HEAD']);
            if (afterHash !== targetHash) {
                throw new Error(`Post-flight: HEAD is ${afterHash.slice(0, 7)} but expected ${targetHash.slice(0, 7)}`);
            }

            // Check that key files exist (basic sanity)
            const criticalFiles = ['electron/main.js', 'package.json'];
            for (const f of criticalFiles) {
                const fullPath = path.join(gitDir, f);
                if (!fs.existsSync(fullPath)) {
                    throw new Error(`Post-flight: critical file missing: ${f}`);
                }
            }

            // Check what changed for restart hints
            const changed = await exec('git', ['diff', '--name-only', `${beforeHash}..${afterHash}`]);
            const needsPip = changed.includes('requirements.txt');

            if (log) {
                log('APP', `Update complete: ${beforeHash.slice(0, 7)} → ${afterHash.slice(0, 7)}`);
            }

            sendStatus('ready', { needsRestart: true, needsPip, installFailed });
            return { success: true, needsPip, installFailed };
        } catch (err) {
            if (log) log('APP', `Update failed: ${err.message}`);

            // Last resort: try to leave the repo in a usable state
            try {
                await exec('git', ['reset', '--hard', 'HEAD']);
                await exec('git', ['clean', '-fd']);
            } catch (_) { /* truly broken — user needs manual intervention */ }

            sendStatus('error', { message: err.message });
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
