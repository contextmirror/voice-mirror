/**
 * local-llm-instructions.test.mjs -- Tests for tauri/src/lib/local-llm-instructions.js
 *
 * Direct ES module import tests for buildLocalLlmInstructions and DEFAULT_LOCAL_LLM_PROMPT.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalLlmInstructions,
  DEFAULT_LOCAL_LLM_PROMPT,
} from '../../src/lib/local-llm-instructions.js';

describe('buildLocalLlmInstructions', () => {
  it('returns a non-empty string', () => {
    const result = buildLocalLlmInstructions();
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('uses default userName "User" when no options', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(result.includes("The user's name is User"), 'Should include default "User" name');
  });

  it('uses default userName "User" when empty options', () => {
    const result = buildLocalLlmInstructions({});
    assert.ok(result.includes("The user's name is User"));
  });

  it('uses custom userName when provided', () => {
    const result = buildLocalLlmInstructions({ userName: 'Alice' });
    assert.ok(result.includes("The user's name is Alice"), 'Should include custom name "Alice"');
    // Also check the contextual usage of the name
    assert.ok(result.includes('Alice speaks to you'), 'Should use custom name in context');
  });

  it('includes "Voice Mirror" identity', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('Voice Mirror'),
      'Should identify as Voice Mirror'
    );
  });

  it('identifies as a voice assistant', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('voice assistant called Voice Mirror'),
      'Should describe itself as a voice assistant called Voice Mirror'
    );
  });

  it('includes "RULES YOU MUST FOLLOW" section', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('RULES YOU MUST FOLLOW'),
      'Should contain rules section header'
    );
  });

  it('includes instruction about speech transcription', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('speech is transcribed'),
      'Should mention speech transcription'
    );
  });

  it('includes instruction about staying on topic', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('Stay on topic'),
      'Should instruct to stay on topic'
    );
  });

  it('includes instruction about markdown formatting', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('markdown'),
      'Should mention markdown formatting'
    );
  });

  it('includes instruction about not guessing', () => {
    const result = buildLocalLlmInstructions();
    assert.ok(
      result.includes('Do not guess'),
      'Should instruct not to guess'
    );
  });
});

describe('DEFAULT_LOCAL_LLM_PROMPT', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof DEFAULT_LOCAL_LLM_PROMPT, 'string');
    assert.ok(DEFAULT_LOCAL_LLM_PROMPT.length > 0);
  });

  it('matches no-args buildLocalLlmInstructions() call', () => {
    const fromFunction = buildLocalLlmInstructions();
    assert.equal(DEFAULT_LOCAL_LLM_PROMPT, fromFunction);
  });

  it('uses default "User" name', () => {
    assert.ok(DEFAULT_LOCAL_LLM_PROMPT.includes("The user's name is User"));
  });
});
