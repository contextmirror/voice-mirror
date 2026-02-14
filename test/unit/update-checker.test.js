/**
 * Tests for update-checker service (self-healing version)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createUpdateChecker } = require('../../electron/services/update-checker');

describe('update-checker', () => {
    it('exports createUpdateChecker', () => {
        assert.equal(typeof createUpdateChecker, 'function');
    });

    it('returns an object with check, applyUpdate, start, stop', () => {
        const checker = createUpdateChecker({});
        assert.equal(typeof checker.check, 'function');
        assert.equal(typeof checker.applyUpdate, 'function');
        assert.equal(typeof checker.start, 'function');
        assert.equal(typeof checker.stop, 'function');
    });

    it('check() returns null on error (no git repo)', async () => {
        const checker = createUpdateChecker({ appDir: '/nonexistent/path' });
        const result = await checker.check();
        assert.equal(result, null);
    });

    it('check() logs when skipping', async () => {
        const logs = [];
        const checker = createUpdateChecker({
            appDir: '/nonexistent/path',
            log: (level, msg) => logs.push({ level, msg })
        });
        await checker.check();
        assert.ok(logs.length > 0);
        assert.ok(logs[0].msg.includes('Update check skipped'));
    });

    it('start() and stop() manage intervals', () => {
        const checker = createUpdateChecker({ appDir: '/nonexistent/path' });
        checker.start(60000);
        // Should not throw
        checker.stop();
        // Double stop should not throw
        checker.stop();
    });

    it('applyUpdate() returns error on failure', async () => {
        const checker = createUpdateChecker({ appDir: '/nonexistent/path' });
        const result = await checker.applyUpdate();
        assert.equal(result.success, false);
        assert.ok(result.error);
    });

    it('applyUpdate() sends error status via safeSend', async () => {
        const sent = [];
        const checker = createUpdateChecker({
            appDir: '/nonexistent/path',
            safeSend: (channel, data) => sent.push({ channel, data })
        });
        await checker.applyUpdate();
        // Should have sent pulling status then error status
        assert.ok(sent.length >= 2);
        assert.equal(sent[0].channel, 'update-status');
        assert.equal(sent[0].data.status, 'pulling');
        assert.equal(sent[sent.length - 1].data.status, 'error');
    });

    describe('applyUpdate with real git repos', () => {
        let remoteDir, localDir;

        function git(dir, ...args) {
            return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
        }

        function setup() {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-update-test-'));
            remoteDir = path.join(tmp, 'remote.git');
            localDir = path.join(tmp, 'local');

            // Init bare remote
            fs.mkdirSync(remoteDir);
            git(remoteDir, 'init', '--bare', '--initial-branch=main');

            // Clone it
            git(tmp, 'clone', remoteDir, 'local');
            git(localDir, 'config', 'user.email', 'test@test.com');
            git(localDir, 'config', 'user.name', 'Test');

            // Initial commit with package.json so npm install doesn't fail
            fs.writeFileSync(path.join(localDir, 'file.txt'), 'initial');
            fs.writeFileSync(path.join(localDir, 'package.json'), '{"name":"test","version":"1.0.0"}');
            // Simulate critical files the post-flight check looks for
            fs.mkdirSync(path.join(localDir, 'electron'), { recursive: true });
            fs.writeFileSync(path.join(localDir, 'electron', 'main.js'), '// main');
            git(localDir, 'add', '.');
            git(localDir, 'commit', '-m', 'initial');
            git(localDir, 'push', 'origin', 'main');

            return tmp;
        }

        function pushRemoteUpdate(tmp, filename, content) {
            const clone2 = path.join(tmp, 'clone2');
            if (!fs.existsSync(clone2)) {
                git(tmp, 'clone', remoteDir, 'clone2');
                git(clone2, 'config', 'user.email', 'test@test.com');
                git(clone2, 'config', 'user.name', 'Test');
            }
            fs.writeFileSync(path.join(clone2, filename), content);
            git(clone2, 'add', '.');
            git(clone2, 'commit', '-m', `add ${filename}`);
            git(clone2, 'push', 'origin', 'main');
        }

        function cleanup(tmp) {
            fs.rmSync(tmp, { recursive: true, force: true });
        }

        it('hard-resets to origin/main discarding local dirty files', async () => {
            const tmp = setup();
            try {
                pushRemoteUpdate(tmp, 'new-file.txt', 'from remote');

                // Make local dirty (untracked file)
                fs.writeFileSync(path.join(localDir, 'local-only.txt'), 'local work');

                const sent = [];
                const checker = createUpdateChecker({
                    appDir: localDir,
                    safeSend: (ch, data) => sent.push({ ch, data }),
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);

                // Remote file should be present after reset
                assert.ok(fs.existsSync(path.join(localDir, 'new-file.txt')));
                // Local untracked file should be cleaned (git clean -fd)
                assert.ok(!fs.existsSync(path.join(localDir, 'local-only.txt')));
                // Should have sent installing + ready statuses
                assert.ok(sent.find(s => s.data.status === 'installing'));
                assert.ok(sent.find(s => s.data.status === 'ready'));
            } finally {
                cleanup(tmp);
            }
        });

        it('overwrites local tracked modifications with upstream version', async () => {
            const tmp = setup();
            try {
                pushRemoteUpdate(tmp, 'remote-only.txt', 'remote');

                // Modify tracked file locally
                fs.writeFileSync(path.join(localDir, 'file.txt'), 'modified locally');

                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);

                // Local modification should be overwritten by hard reset
                const content = fs.readFileSync(path.join(localDir, 'file.txt'), 'utf8');
                assert.equal(content, 'initial');
                // Remote file should exist
                assert.ok(fs.existsSync(path.join(localDir, 'remote-only.txt')));
            } finally {
                cleanup(tmp);
            }
        });

        it('works with clean working tree', async () => {
            const tmp = setup();
            try {
                pushRemoteUpdate(tmp, 'new.txt', 'new');

                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);
                assert.ok(fs.existsSync(path.join(localDir, 'new.txt')));
            } finally {
                cleanup(tmp);
            }
        });

        it('heals stuck merge state before updating', async () => {
            const tmp = setup();
            try {
                pushRemoteUpdate(tmp, 'update.txt', 'v2');

                // Simulate a stuck merge by creating MERGE_HEAD
                fs.writeFileSync(
                    path.join(localDir, '.git', 'MERGE_HEAD'),
                    git(localDir, 'rev-parse', 'HEAD')
                );

                const logs = [];
                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: (level, msg) => logs.push(msg)
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);
                // Should have logged healing
                assert.ok(logs.some(m => m.includes('healed')));
            } finally {
                cleanup(tmp);
            }
        });

        it('removes stale index.lock before updating', async () => {
            const tmp = setup();
            try {
                pushRemoteUpdate(tmp, 'update2.txt', 'v2');

                // Simulate stale lock file
                fs.writeFileSync(path.join(localDir, '.git', 'index.lock'), '');

                const logs = [];
                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: (level, msg) => logs.push(msg)
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);
                // Lock file should be gone
                assert.ok(!fs.existsSync(path.join(localDir, '.git', 'index.lock')));
                assert.ok(logs.some(m => m.includes('index.lock')));
            } finally {
                cleanup(tmp);
            }
        });

        it('returns alreadyUpToDate when no update available', async () => {
            const tmp = setup();
            try {
                // No remote changes — local is already at origin/main
                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);
                assert.equal(result.alreadyUpToDate, true);
            } finally {
                cleanup(tmp);
            }
        });

        it('post-flight verifies HEAD matches target', async () => {
            const tmp = setup();
            try {
                pushRemoteUpdate(tmp, 'verified.txt', 'ok');

                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);

                // Verify HEAD now matches origin/main
                const head = git(localDir, 'rev-parse', 'HEAD');
                const origin = git(localDir, 'rev-parse', 'origin/main');
                assert.equal(head, origin);
            } finally {
                cleanup(tmp);
            }
        });
    });
});
