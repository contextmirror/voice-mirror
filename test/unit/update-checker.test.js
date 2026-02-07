/**
 * Tests for update-checker service
 */

const { describe, it, beforeEach, mock } = require('node:test');
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

    describe('applyUpdate with dirty working tree', () => {
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
            git(remoteDir, 'init', '--bare');

            // Clone it
            git(tmp, 'clone', remoteDir, 'local');
            git(localDir, 'config', 'user.email', 'test@test.com');
            git(localDir, 'config', 'user.name', 'Test');

            // Initial commit
            fs.writeFileSync(path.join(localDir, 'file.txt'), 'initial');
            git(localDir, 'add', '.');
            git(localDir, 'commit', '-m', 'initial');
            git(localDir, 'push', 'origin', 'main');

            return tmp;
        }

        function cleanup(tmp) {
            fs.rmSync(tmp, { recursive: true, force: true });
        }

        it('stashes dirty changes, pulls, then pops stash', async () => {
            const tmp = setup();
            try {
                // Push a new commit to remote via a second clone
                const clone2 = path.join(tmp, 'clone2');
                git(tmp, 'clone', remoteDir, 'clone2');
                git(clone2, 'config', 'user.email', 'test@test.com');
                git(clone2, 'config', 'user.name', 'Test');
                fs.writeFileSync(path.join(clone2, 'new-file.txt'), 'from remote');
                git(clone2, 'add', '.');
                git(clone2, 'commit', '-m', 'remote update');
                git(clone2, 'push', 'origin', 'main');

                // Make local dirty (non-conflicting change)
                fs.writeFileSync(path.join(localDir, 'local-only.txt'), 'local work');

                const sent = [];
                const checker = createUpdateChecker({
                    appDir: localDir,
                    safeSend: (ch, data) => sent.push({ ch, data }),
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);

                // Local dirty file should still exist after update
                assert.ok(fs.existsSync(path.join(localDir, 'local-only.txt')));
                // Remote file should be pulled
                assert.ok(fs.existsSync(path.join(localDir, 'new-file.txt')));
                // Should have sent ready status
                const readyMsg = sent.find(s => s.data.status === 'ready');
                assert.ok(readyMsg);
            } finally {
                cleanup(tmp);
            }
        });

        it('stashes tracked dirty changes and restores after pull', async () => {
            const tmp = setup();
            try {
                // Push a non-conflicting commit to remote
                const clone2 = path.join(tmp, 'clone2');
                git(tmp, 'clone', remoteDir, 'clone2');
                git(clone2, 'config', 'user.email', 'test@test.com');
                git(clone2, 'config', 'user.name', 'Test');
                fs.writeFileSync(path.join(clone2, 'remote-only.txt'), 'remote');
                git(clone2, 'add', '.');
                git(clone2, 'commit', '-m', 'add remote-only');
                git(clone2, 'push', 'origin', 'main');

                // Modify tracked file locally
                fs.writeFileSync(path.join(localDir, 'file.txt'), 'modified locally');

                const checker = createUpdateChecker({
                    appDir: localDir,
                    log: () => {}
                });

                const result = await checker.applyUpdate();
                assert.equal(result.success, true);

                // Local modification should be restored
                const content = fs.readFileSync(path.join(localDir, 'file.txt'), 'utf8');
                assert.equal(content, 'modified locally');
            } finally {
                cleanup(tmp);
            }
        });

        it('works with clean working tree (no stash needed)', async () => {
            const tmp = setup();
            try {
                const clone2 = path.join(tmp, 'clone2');
                git(tmp, 'clone', remoteDir, 'clone2');
                git(clone2, 'config', 'user.email', 'test@test.com');
                git(clone2, 'config', 'user.name', 'Test');
                fs.writeFileSync(path.join(clone2, 'new.txt'), 'new');
                git(clone2, 'add', '.');
                git(clone2, 'commit', '-m', 'clean update');
                git(clone2, 'push', 'origin', 'main');

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
    });
});
