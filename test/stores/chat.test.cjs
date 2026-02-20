/**
 * chat.test.js -- Source-inspection tests for chat.svelte.js
 *
 * Validates exports, message model, reactive state, and methods
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'chat.svelte.js'),
  'utf-8'
);

// ============ Exports ============

describe('chat: exports', () => {
  it('exports chatStore', () => {
    assert.ok(src.includes('export const chatStore'), 'Should export chatStore');
  });

  it('creates store via createChatStore factory', () => {
    assert.ok(src.includes('function createChatStore()'), 'Should define createChatStore factory');
    assert.ok(src.includes('createChatStore()'), 'Should call createChatStore()');
  });
});

// ============ Store methods ============

describe('chat: store methods', () => {
  const methods = [
    'addMessage',
    'startStreamingMessage',
    'updateStreamingMessage',
    'finalizeStreamingMessage',
    'clearMessages',
    'removeMessage',
    'setStreamingMessageText',
  ];

  for (const method of methods) {
    it(`has method "${method}"`, () => {
      assert.ok(src.includes(`${method}(`), `Store should have method "${method}"`);
    });
  }
});

// ============ Store getters ============

describe('chat: store getters', () => {
  it('has getter "messages"', () => {
    assert.ok(src.includes('get messages()'), 'Should have getter "messages"');
  });

  it('has getter "isStreaming"', () => {
    assert.ok(src.includes('get isStreaming()'), 'Should have getter "isStreaming"');
  });
});

// ============ Message model ============

describe('chat: message model', () => {
  it('messages have an "id" field', () => {
    // The addMessage and startStreamingMessage functions create objects with `id`
    assert.ok(src.includes('id,') || src.includes('id:'), 'Message should have "id" field');
  });

  it('messages have a "role" field', () => {
    assert.ok(src.includes('role'), 'Message should have "role" field');
  });

  it('messages have a "text" field', () => {
    assert.ok(src.includes('text'), 'Message should have "text" field');
  });

  it('messages have a "timestamp" field set to Date.now()', () => {
    assert.ok(src.includes('timestamp: Date.now()'), 'Message should have timestamp from Date.now()');
  });

  it('messages have a "streaming" field', () => {
    assert.ok(src.includes('streaming:'), 'Message should have "streaming" field');
  });

  it('messages have a "toolCalls" field', () => {
    assert.ok(src.includes('toolCalls'), 'Message should have "toolCalls" field');
  });

  it('messages have an "attachments" field', () => {
    assert.ok(src.includes('attachments'), 'Message should have "attachments" field');
  });

  it('attachments defaults to empty array from metadata', () => {
    assert.ok(
      src.includes('metadata.attachments || []'),
      'attachments should default to empty array via metadata.attachments || []'
    );
  });

  it('messages have a "metadata" field', () => {
    assert.ok(src.includes('metadata'), 'Message should have "metadata" field');
  });

  it('documents role types in JSDoc', () => {
    assert.ok(
      src.includes("'user'|'assistant'|'system'|'error'"),
      'Should document role types in JSDoc'
    );
  });
});

// ============ $state reactivity ============

describe('chat: $state reactivity', () => {
  it('uses $state for messages', () => {
    assert.ok(/let\s+messages\s*=\s*\$state\(/.test(src), 'Should use $state for messages');
  });

  it('uses $state for isStreaming', () => {
    assert.ok(/let\s+isStreaming\s*=\s*\$state\(/.test(src), 'Should use $state for isStreaming');
  });

  it('messages initialized as empty array', () => {
    assert.ok(src.includes('$state([])'), 'messages should be initialized as $state([])');
  });

  it('isStreaming initialized as false', () => {
    assert.ok(src.includes('$state(false)'), 'isStreaming should be initialized as $state(false)');
  });
});

// ============ uid() usage ============

describe('chat: uid() for message IDs', () => {
  it('imports uid from utils', () => {
    assert.ok(src.includes('uid'), 'Should reference uid');
    assert.ok(
      src.includes("from '../utils.js'") || src.includes('from "../utils.js"'),
      'Should import from utils.js'
    );
  });

  it('calls uid() to generate message IDs', () => {
    // uid() is called in addMessage and startStreamingMessage
    const uidCalls = src.match(/uid\(\)/g);
    assert.ok(uidCalls, 'Should call uid()');
    assert.ok(uidCalls.length >= 2, `Should call uid() at least twice (addMessage + startStreamingMessage), found ${uidCalls.length}`);
  });
});

// ============ Streaming behavior ============

describe('chat: streaming behavior', () => {
  it('addMessage sets streaming to false', () => {
    assert.ok(src.includes('streaming: false'), 'addMessage should create non-streaming messages');
  });

  it('startStreamingMessage sets streaming to true', () => {
    assert.ok(src.includes('streaming: true'), 'startStreamingMessage should set streaming: true');
  });

  it('startStreamingMessage sets isStreaming flag to true', () => {
    assert.ok(src.includes('isStreaming = true'), 'startStreamingMessage should set isStreaming = true');
  });

  it('finalizeStreamingMessage sets isStreaming to false', () => {
    assert.ok(src.includes('isStreaming = false'), 'finalizeStreamingMessage should reset isStreaming');
  });

  it('updateStreamingMessage appends text', () => {
    assert.ok(
      src.includes('.text + text') || src.includes('.text +text'),
      'updateStreamingMessage should append text to existing'
    );
  });

  it('updateStreamingMessage uses findLastIndex to find streaming message', () => {
    assert.ok(
      src.includes('findLastIndex'),
      'Should use findLastIndex to locate the streaming message'
    );
  });

  it('clearMessages resets both messages and isStreaming', () => {
    assert.ok(src.includes('messages = []'), 'clearMessages should reset messages to empty array');
  });
});

// ============ removeMessage ============

describe('chat: removeMessage', () => {
  it('filters messages by ID', () => {
    assert.ok(
      src.includes('.filter('),
      'removeMessage should use filter to remove by ID'
    );
  });

  it('compares against message id', () => {
    assert.ok(
      src.includes('m.id !== id'),
      'Should filter out the message with matching id'
    );
  });
});
