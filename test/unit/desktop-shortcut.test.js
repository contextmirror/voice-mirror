const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Desktop shortcut - no console window on Windows', () => {
    const vbsPath = path.join(__dirname, '../../scripts/launch-hidden.vbs');
    const vbsSource = fs.readFileSync(vbsPath, 'utf-8');
    const setupSource = fs.readFileSync(
        path.join(__dirname, '../../cli/setup.mjs'), 'utf-8'
    );

    it('launch-hidden.vbs should exist', () => {
        assert.ok(fs.existsSync(vbsPath));
    });

    it('launch-hidden.vbs should use WScript.Shell', () => {
        assert.ok(vbsSource.includes('WScript.Shell'));
    });

    it('launch-hidden.vbs should run with hidden window (0)', () => {
        assert.ok(
            vbsSource.includes(', 0,'),
            'Should pass 0 (vbHide) to shell.Run'
        );
    });

    it('launch-hidden.vbs should reference launch.js', () => {
        assert.ok(vbsSource.includes('launch.js'));
    });

    it('setup.mjs should use wscript.exe for Windows shortcut', () => {
        assert.ok(
            setupSource.includes("'wscript.exe'"),
            'Should target wscript.exe instead of cmd/voice-mirror.cmd'
        );
    });

    it('setup.mjs should reference launch-hidden.vbs', () => {
        assert.ok(
            setupSource.includes('launch-hidden.vbs'),
            'Should use launch-hidden.vbs in shortcut args'
        );
    });

    it('setup.mjs should NOT reference voice-mirror.cmd', () => {
        assert.ok(
            !setupSource.includes('voice-mirror.cmd'),
            'Should not use voice-mirror.cmd (causes console window)'
        );
    });
});
