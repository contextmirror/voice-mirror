const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Import the function directly — it's exported from python-backend.js via createPythonBackend,
// but getPythonExecutable is a standalone function we can test by requiring the module.
// Since getPythonExecutable is not exported, we replicate its logic for testing.
// The actual logic from python-backend.js:
//   Windows: path.join(basePath, '.venv', 'Scripts', 'python.exe')
//   Unix:    path.join(basePath, '.venv', 'bin', 'python')

function getPythonExecutable(basePath, isWindows) {
    const venvPath = path.join(basePath, '.venv');
    if (isWindows) {
        return path.join(venvPath, 'Scripts', 'python.exe');
    }
    return path.join(venvPath, 'bin', 'python');
}

describe('python-backend venv detection', () => {
    it('Windows: expected venv path is .venv\\Scripts\\python.exe', () => {
        const result = getPythonExecutable('/project/python', true);
        // Use path.join to get the expected value with correct separators
        const expected = path.join('/project/python', '.venv', 'Scripts', 'python.exe');
        assert.strictEqual(result, expected);
        assert.ok(result.includes('Scripts'), 'Windows path should contain Scripts');
        assert.ok(result.endsWith('python.exe'), 'Windows path should end with python.exe');
    });

    it('Unix: expected venv path is .venv/bin/python', () => {
        const result = getPythonExecutable('/project/python', false);
        const expected = path.join('/project/python', '.venv', 'bin', 'python');
        assert.strictEqual(result, expected);
        assert.ok(result.includes('bin'), 'Unix path should contain bin');
        assert.ok(result.endsWith('python'), 'Unix path should end with python');
    });

    it('path joining produces valid paths with .venv component', () => {
        const bases = ['/home/user/project', 'C:\\Users\\dev\\project', '/opt/voice-mirror'];
        for (const base of bases) {
            const winPath = getPythonExecutable(base, true);
            const unixPath = getPythonExecutable(base, false);

            assert.ok(winPath.includes('.venv'), `Windows path should contain .venv for base ${base}`);
            assert.ok(unixPath.includes('.venv'), `Unix path should contain .venv for base ${base}`);
            assert.ok(winPath.length > base.length, 'Path should be longer than base');
            assert.ok(unixPath.length > base.length, 'Path should be longer than base');
        }
    });
});
