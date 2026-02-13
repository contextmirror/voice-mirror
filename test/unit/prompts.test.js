const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getToolSystemPrompt, getBasicSystemPrompt } = require('../../electron/tools/prompts');

describe('prompts - date awareness', () => {
    it('tool system prompt includes current year prominently', () => {
        const prompt = getToolSystemPrompt();
        const year = new Date().getFullYear().toString();
        assert.ok(prompt.includes(`current year is ${year}`),
            'Should include explicit current year statement');
    });

    it('tool system prompt includes CRITICAL DATE AWARENESS section', () => {
        const prompt = getToolSystemPrompt();
        assert.ok(prompt.includes('CRITICAL DATE AWARENESS'),
            'Should have a prominent date awareness section');
    });

    it('tool system prompt warns about outdated training data', () => {
        const prompt = getToolSystemPrompt();
        assert.ok(prompt.includes('training data may be outdated'),
            'Should warn about outdated training data');
    });

    it('basic system prompt includes current year', () => {
        const prompt = getBasicSystemPrompt();
        const year = new Date().getFullYear().toString();
        assert.ok(prompt.includes(`current year is ${year}`),
            'Basic prompt should include explicit current year');
    });

    it('basic system prompt warns about outdated training data', () => {
        const prompt = getBasicSystemPrompt();
        assert.ok(prompt.includes('training data may be outdated'),
            'Basic prompt should warn about outdated training data');
    });

    it('tool system prompt includes location when provided', () => {
        const prompt = getToolSystemPrompt({ location: 'London, UK' });
        assert.ok(prompt.includes('London, UK'));
    });

    it('basic system prompt includes location when provided', () => {
        const prompt = getBasicSystemPrompt({ location: 'London, UK' });
        assert.ok(prompt.includes('London, UK'));
    });
});
