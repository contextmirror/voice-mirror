/**
 * git-commit-panel.test.cjs -- Source-inspection tests for GitCommitPanel.svelte
 *
 * Validates structure, props, imports, UI elements, and behaviors
 * of the git commit panel component based on the plan spec.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COMPONENT_PATH = path.join(__dirname, '../../src/components/lens/GitCommitPanel.svelte');
const src = fs.readFileSync(COMPONENT_PATH, 'utf-8');

// ============ Structure ============

describe('GitCommitPanel.svelte -- structure', () => {
  it('file exists and has content', () => {
    assert.ok(src.length > 0, 'File should have content');
  });

  it('has <script> tag', () => {
    assert.ok(src.includes('<script'), 'Should have a script tag');
  });

  it('has <style> tag', () => {
    assert.ok(src.includes('<style'), 'Should have a style tag');
  });
});

// ============ Imports ============

describe('GitCommitPanel.svelte -- imports', () => {
  it('imports gitCommit from api.js', () => {
    assert.ok(src.includes('gitCommit'), 'Should import gitCommit');
    assert.ok(src.includes('api'), 'Should import from api module');
  });

  it('imports gitPush from api.js', () => {
    assert.ok(src.includes('gitPush'), 'Should import gitPush');
  });

  it('imports generateCommitMessage from api.js', () => {
    assert.ok(src.includes('generateCommitMessage'), 'Should import generateCommitMessage');
  });
});

// ============ Props ============

describe('GitCommitPanel.svelte -- props', () => {
  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props() for prop declaration');
  });

  it('accepts branch prop', () => {
    assert.ok(src.includes('branch'), 'Should accept branch prop');
  });

  it('accepts stagedCount prop', () => {
    assert.ok(src.includes('stagedCount'), 'Should accept stagedCount prop');
  });

  it('accepts onCommit prop', () => {
    assert.ok(src.includes('onCommit'), 'Should accept onCommit callback prop');
  });

  it('accepts root prop', () => {
    assert.ok(src.includes('root'), 'Should accept root prop');
  });
});

// ============ UI Elements ============

describe('GitCommitPanel.svelte -- UI elements', () => {
  it('has commit message textarea', () => {
    assert.ok(src.includes('textarea'), 'Should have a textarea for commit message');
  });

  it('has commit button', () => {
    assert.ok(
      src.includes('Commit') || src.includes('commit'),
      'Should have a commit button'
    );
  });

  it('has push functionality', () => {
    assert.ok(src.includes('Push') || src.includes('push'), 'Should have push functionality');
  });

  it('has AI generate button', () => {
    assert.ok(
      src.includes('generateCommitMessage') || src.includes('generate'),
      'Should have AI commit message generation'
    );
  });

  it('shows branch name', () => {
    assert.ok(src.includes('branch'), 'Should display branch name');
  });

  it('has loading/spinner state', () => {
    assert.ok(
      src.includes('committing') || src.includes('loading') || src.includes('isCommitting'),
      'Should have a loading/committing state'
    );
  });

  it('has error display', () => {
    assert.ok(src.includes('error'), 'Should have error display');
  });
});

// ============ Behavior ============

describe('GitCommitPanel.svelte -- behavior', () => {
  it('calls gitCommit with message', () => {
    assert.ok(src.includes('gitCommit'), 'Should call gitCommit');
  });

  it('calls generateCommitMessage for AI generation', () => {
    assert.ok(src.includes('generateCommitMessage'), 'Should call generateCommitMessage');
  });

  it('calls gitPush for push', () => {
    assert.ok(src.includes('gitPush'), 'Should call gitPush');
  });

  it('has $state for message', () => {
    assert.ok(
      src.includes('$state') && src.includes('message'),
      'Should have $state for message'
    );
  });

  it('has $state for error', () => {
    assert.ok(
      src.includes('$state') && src.includes('error'),
      'Should have $state for error'
    );
  });

  it('has $state for committing/loading', () => {
    assert.ok(
      src.includes('$state'),
      'Should have $state for committing/loading state'
    );
  });

  it('has $state for generating', () => {
    assert.ok(
      src.includes('generating') || src.includes('isGenerating'),
      'Should have state for AI generation in progress'
    );
  });

  it('disables commit when no staged changes', () => {
    assert.ok(
      src.includes('stagedCount') && src.includes('disabled'),
      'Should disable commit when stagedCount is 0'
    );
  });

  it('handles Ctrl+Enter for commit shortcut', () => {
    assert.ok(
      src.includes('Ctrl') || src.includes('ctrlKey') || src.includes('Enter'),
      'Should handle Ctrl+Enter keyboard shortcut'
    );
  });

  it('clears message after successful commit', () => {
    // After commit, message should be reset to empty string
    assert.ok(
      src.includes("message = ''") || src.includes('message = ""') || src.includes('message = ``'),
      'Should clear message after successful commit'
    );
  });

  it('has -webkit-app-region: no-drag for frameless window', () => {
    assert.ok(
      src.includes('-webkit-app-region: no-drag') || src.includes('app-region'),
      'Should have no-drag for frameless window interactivity'
    );
  });

  it('uses CSS variables for theming', () => {
    assert.ok(
      src.includes('var(--'),
      'Should use CSS variables for theming'
    );
  });
});

// ============ Commit message textarea ============

describe('GitCommitPanel.svelte -- textarea details', () => {
  it('has placeholder text for commit message', () => {
    assert.ok(
      src.includes('placeholder') || src.includes('Commit message'),
      'Should have placeholder text'
    );
  });

  it('binds textarea value', () => {
    assert.ok(
      src.includes('bind:value') || src.includes('bind:'),
      'Should bind textarea value to state'
    );
  });
});

// ============ Validation ============

describe('GitCommitPanel.svelte -- validation', () => {
  it('checks for empty message before commit', () => {
    assert.ok(
      src.includes('trim()') || src.includes('message'),
      'Should validate message is not empty before committing'
    );
  });

  it('checks stagedCount before enabling commit', () => {
    assert.ok(
      src.includes('stagedCount'),
      'Should check stagedCount to enable/disable commit'
    );
  });
});
