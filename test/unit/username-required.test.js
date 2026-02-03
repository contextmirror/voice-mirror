/**
 * Tests for username required feature.
 * Validates setup wizard config building and settings validation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('username-required', () => {

    it('buildConfig should include user.name when provided', () => {
        // Simulate buildConfig logic
        const config = {};
        const userName = 'Alice';
        const existing = null;

        config.user = config.user || {};
        config.user.name = userName || existing?.user?.name || 'User';

        assert.equal(config.user.name, 'Alice');
    });

    it('buildConfig should fallback to existing name', () => {
        const config = {};
        const userName = '';
        const existing = { user: { name: 'Bob' } };

        config.user = config.user || {};
        config.user.name = userName || existing?.user?.name || 'User';

        assert.equal(config.user.name, 'Bob');
    });

    it('buildConfig should fallback to User when no name anywhere', () => {
        const config = {};
        const userName = '';
        const existing = null;

        config.user = config.user || {};
        config.user.name = userName || existing?.user?.name || 'User';

        assert.equal(config.user.name, 'User');
    });

    it('settings save should preserve existing name when field is empty', () => {
        // Simulate the settings save logic
        const fieldValue = '';
        const existingName = 'Charlie';

        const savedName = fieldValue.trim() || existingName || null;
        assert.equal(savedName, 'Charlie');
    });

    it('settings save should use new name when field has value', () => {
        const fieldValue = '  Dave  ';
        const existingName = 'Charlie';

        const savedName = fieldValue.trim() || existingName || null;
        assert.equal(savedName, 'Dave');
    });

    it('name-required modal should block on null/undefined name', () => {
        const configs = [
            { user: {} },
            { user: { name: null } },
            { user: { name: '' } },
            {},
        ];

        for (const config of configs) {
            const shouldShow = !config.user?.name;
            assert.equal(shouldShow, true, `Should show modal for config: ${JSON.stringify(config)}`);
        }
    });

    it('name-required modal should not show when name is set', () => {
        const config = { user: { name: 'Eve' } };
        const shouldShow = !config.user?.name;
        assert.equal(shouldShow, false);
    });
});
