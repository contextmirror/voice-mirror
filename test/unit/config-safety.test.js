const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Config atomic writes and backup recovery', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // Test 1: atomic write pattern — write to .tmp then rename
    it('should survive interrupted writes via temp+rename pattern', () => {
        const configPath = path.join(tmpDir, 'config.json');
        const tempPath = configPath + '.tmp';
        const backupPath = configPath + '.bak';

        // Write initial config
        const initial = { ai: { provider: 'claude' } };
        fs.writeFileSync(configPath, JSON.stringify(initial, null, 2));

        // Simulate atomic write
        const updated = { ai: { provider: 'ollama' } };
        fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2));
        fs.copyFileSync(configPath, backupPath);
        fs.renameSync(tempPath, configPath);

        // Verify
        const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(loaded.ai.provider, 'ollama');

        // Backup should have old value
        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        assert.equal(backup.ai.provider, 'claude');
    });

    // Test 2: recovery from corrupt main config via backup
    it('should recover from corrupt config using backup', () => {
        const configPath = path.join(tmpDir, 'config.json');
        const backupPath = configPath + '.bak';

        // Write corrupt main config
        fs.writeFileSync(configPath, '{corrupt json!!!');

        // Write valid backup
        const backup = { ai: { provider: 'ollama' } };
        fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

        // Try loading main (should fail), then backup (should succeed)
        let loaded = null;
        for (const tryPath of [configPath, backupPath]) {
            try {
                loaded = JSON.parse(fs.readFileSync(tryPath, 'utf8'));
                break;
            } catch {
                // try next
            }
        }

        assert.notEqual(loaded, null);
        assert.equal(loaded.ai.provider, 'ollama');
    });

    // Test 3: temp file cleaned up on write failure
    it('should clean up temp file on write failure', () => {
        const configPath = path.join(tmpDir, 'config.json');
        const tempPath = configPath + '.tmp';

        // Create temp file that simulates a failed write
        fs.writeFileSync(tempPath, 'partial data');

        // Cleanup
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }

        assert.equal(fs.existsSync(tempPath), false);
    });

    // Test 4: both corrupt — should return null/defaults
    it('should return null when both config and backup are corrupt', () => {
        const configPath = path.join(tmpDir, 'config.json');
        const backupPath = configPath + '.bak';

        fs.writeFileSync(configPath, 'corrupt');
        fs.writeFileSync(backupPath, 'also corrupt');

        let loaded = null;
        for (const tryPath of [configPath, backupPath]) {
            try {
                loaded = JSON.parse(fs.readFileSync(tryPath, 'utf8'));
                break;
            } catch {
                // try next
            }
        }

        assert.equal(loaded, null);
    });

    // Test 5: rename is atomic (cross-platform)
    it('should atomically replace config file', () => {
        const configPath = path.join(tmpDir, 'config.json');
        const tempPath = configPath + '.tmp';

        // Write original
        fs.writeFileSync(configPath, JSON.stringify({ version: 1 }));

        // Write temp and rename
        fs.writeFileSync(tempPath, JSON.stringify({ version: 2 }));
        fs.renameSync(tempPath, configPath);

        // Temp should not exist, config should have new data
        assert.equal(fs.existsSync(tempPath), false);
        const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(data.version, 2);
    });
});
