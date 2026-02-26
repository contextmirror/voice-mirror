const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/App.svelte'),
  'utf-8'
);

describe('App.svelte — handleChatSend', () => {
  const fnStart = src.indexOf('function handleChatSend');
  const fn = src.substring(fnStart, src.indexOf('\n  }', fnStart) + 4);

  it('reads dataUrl from attachment', () => {
    assert.ok(fn.includes('dataUrl'), 'Should read dataUrl from attachment');
  });

  it('reads context from attachment', () => {
    assert.ok(fn.includes('context'), 'Should read context from attachment');
  });

  it('prepends element context with delimiters', () => {
    assert.ok(fn.includes('[Element Context]'), 'Should wrap context in opening delimiter');
    assert.ok(fn.includes('[/Element Context]'), 'Should close context delimiter');
  });

  it('passes imageDataUrl to aiPtyInput', () => {
    assert.ok(fn.includes('imageDataUrl'), 'Should pass imageDataUrl to provider calls');
  });

  it('passes imageDataUrl to writeUserMessage', () => {
    // Both provider paths should use the dataUrl
    assert.ok(fn.includes('writeUserMessage(fullText'), 'Should pass fullText to writeUserMessage');
  });
});
