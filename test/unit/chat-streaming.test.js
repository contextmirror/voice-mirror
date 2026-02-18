const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Source-inspection tests for streaming chat features (ES modules can't be imported in Node.js tests)

describe('Chat streaming - messages.js exports', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/messages.js'), 'utf-8');

    it('exports startStreamingMessage function', () => {
        assert.ok(src.includes('export function startStreamingMessage'));
    });

    it('exports appendStreamingToken function', () => {
        assert.ok(src.includes('export function appendStreamingToken'));
    });

    it('exports finalizeStreamingMessage function', () => {
        assert.ok(src.includes('export function finalizeStreamingMessage'));
    });

    it('startStreamingMessage creates streaming class on message group', () => {
        assert.ok(src.includes("'message-group assistant streaming'"));
    });

    it('startStreamingMessage clears previous streamingFinalizedAt flag', () => {
        const startFn = src.slice(src.indexOf('export function startStreamingMessage'));
        const fnEnd = startFn.indexOf('export function', 10);
        const fnBody = startFn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes('state.streamingFinalizedAt = 0'));
    });

    it('appendStreamingToken uses textContent (no innerHTML during streaming)', () => {
        // Verify the append function uses textContent, not innerHTML
        const appendFn = src.slice(src.indexOf('export function appendStreamingToken'));
        const fnEnd = appendFn.indexOf('export function', 10);
        const fnBody = appendFn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes('.textContent = state.streamingText'));
    });

    it('finalizeStreamingMessage applies markdown rendering', () => {
        assert.ok(src.includes('renderMarkdown(displayText)'));
    });

    it('finalizeStreamingMessage registers in dedup map', () => {
        // Ensures the later chat-message from inbox-watcher is suppressed
        const finalizeFn = src.slice(src.indexOf('export function finalizeStreamingMessage'));
        const fnEnd = finalizeFn.indexOf('export function', 10);
        const fnBody = finalizeFn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes('isDuplicate(fullText)'));
    });

    it('finalizeStreamingMessage sets streamingFinalizedAt timestamp', () => {
        const finalizeFn = src.slice(src.indexOf('export function finalizeStreamingMessage'));
        const fnEnd = finalizeFn.indexOf('export function', 10);
        const fnBody = finalizeFn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes('state.streamingFinalizedAt = Date.now()'));
    });

    it('uses instant scroll during streaming (no smooth animation)', () => {
        assert.ok(src.includes("behavior: 'instant'"));
    });

    it('creates streaming cursor element', () => {
        assert.ok(src.includes('streaming-cursor'));
    });

    it('removes cursor on finalize', () => {
        assert.ok(src.includes(".querySelector('.streaming-cursor')"));
    });
});

describe('Chat streaming - state.js fields', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/state.js'), 'utf-8');

    it('has streamingActive field', () => {
        assert.ok(src.includes('streamingActive'));
    });

    it('has streamingMessageGroup field', () => {
        assert.ok(src.includes('streamingMessageGroup'));
    });

    it('has streamingBubble field', () => {
        assert.ok(src.includes('streamingBubble'));
    });

    it('has streamingText field', () => {
        assert.ok(src.includes('streamingText'));
    });

    it('has streamingFinalizedAt field for dedup timing', () => {
        assert.ok(src.includes('streamingFinalizedAt'));
    });

    it('has streamingToolCount field for inline tool cards', () => {
        assert.ok(src.includes('streamingToolCount'));
    });
});

describe('Chat streaming - preload.js IPC channels', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/preload.js'), 'utf-8');

    it('exposes onChatStreamToken listener', () => {
        assert.ok(src.includes('onChatStreamToken'));
    });

    it('exposes onChatStreamEnd listener', () => {
        assert.ok(src.includes('onChatStreamEnd'));
    });

    it('uses chat-stream-token IPC channel', () => {
        assert.ok(src.includes("'chat-stream-token'"));
    });

    it('uses chat-stream-end IPC channel', () => {
        assert.ok(src.includes("'chat-stream-end'"));
    });
});

describe('Chat streaming - openai-provider.js events', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/providers/openai-provider.js'), 'utf-8');

    it('emits stream-token events during streaming', () => {
        assert.ok(src.includes("this.emitOutput('stream-token', content)"));
    });

    it('emits stream-end event at response completion', () => {
        assert.ok(src.includes("this.emitOutput('stream-end', fullResponse)"));
    });
});

describe('Chat streaming - main.js IPC routing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf-8');

    it('routes stream-token to chat-stream-token IPC channel', () => {
        assert.ok(src.includes("safeSend('chat-stream-token'"));
    });

    it('routes stream-end to chat-stream-end IPC channel', () => {
        assert.ok(src.includes("safeSend('chat-stream-end'"));
    });
});

describe('Chat streaming - renderer main.js wiring', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/main.js'), 'utf-8');

    it('imports streaming functions from messages.js', () => {
        assert.ok(src.includes('startStreamingMessage'));
        assert.ok(src.includes('appendStreamingToken'));
        assert.ok(src.includes('finalizeStreamingMessage'));
    });

    it('has stream token batching with STREAM_BATCH_MS', () => {
        assert.ok(src.includes('STREAM_BATCH_MS'));
    });

    it('listens for onChatStreamToken events', () => {
        assert.ok(src.includes('onChatStreamToken'));
    });

    it('listens for onChatStreamEnd events', () => {
        assert.ok(src.includes('onChatStreamEnd'));
    });

    it('suppresses assistant chat-message after streaming finalize (dedup)', () => {
        assert.ok(src.includes('streamingFinalizedAt'));
        assert.ok(src.includes('Suppressed duplicate assistant message'));
    });
});

describe('Chat streaming - inline tool cards', () => {
    const msgSrc = fs.readFileSync(path.join(__dirname, '../../electron/renderer/messages.js'), 'utf-8');

    it('exports addStreamingToolCard function', () => {
        assert.ok(msgSrc.includes('export function addStreamingToolCard'));
    });

    it('exports updateStreamingToolCard function', () => {
        assert.ok(msgSrc.includes('export function updateStreamingToolCard'));
    });

    it('addStreamingToolCard creates tool-card with inline class', () => {
        assert.ok(msgSrc.includes("'tool-card tool-call inline'"));
    });

    it('addStreamingToolCard uses data-tool-iteration attribute', () => {
        assert.ok(msgSrc.includes('data-tool-iteration'));
    });

    it('updateStreamingToolCard updates status badge to success or error', () => {
        const fn = msgSrc.slice(msgSrc.indexOf('export function updateStreamingToolCard'));
        const fnEnd = fn.indexOf('export function', 10);
        const fnBody = fn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes("'success'"));
        assert.ok(fnBody.includes("'error'"));
    });

    it('finalizeStreamingMessage handles multiple streaming-text nodes', () => {
        assert.ok(msgSrc.includes(".querySelectorAll('.streaming-text')"));
    });

    it('copyMessage targets markdown-content specifically', () => {
        assert.ok(msgSrc.includes(".querySelector('.markdown-content')"));
    });
});

describe('Chat streaming - openai-provider tool iteration', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/providers/openai-provider.js'), 'utf-8');

    it('includes iteration in onToolResult calls', () => {
        assert.ok(src.includes('iteration: this.currentToolIteration'));
    });

    it('emits stream-end on max tool iterations', () => {
        // After max iterations message, stream-end should fire to finalize the card
        const maxIterSection = src.slice(src.indexOf('[Max tool iterations reached]'));
        const nextLines = maxIterSection.slice(0, 200);
        assert.ok(nextLines.includes("stream-end"));
    });
});

describe('Chat streaming - renderer main.js tool wiring', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/main.js'), 'utf-8');

    it('imports addStreamingToolCard from messages.js', () => {
        assert.ok(src.includes('addStreamingToolCard'));
    });

    it('imports updateStreamingToolCard from messages.js', () => {
        assert.ok(src.includes('updateStreamingToolCard'));
    });

    it('calls addStreamingToolCard on tool call when streaming is active', () => {
        assert.ok(src.includes('addStreamingToolCard(data.tool'));
    });

    it('calls updateStreamingToolCard on tool result', () => {
        assert.ok(src.includes('updateStreamingToolCard(data.iteration'));
    });

    it('flushes stream tokens before inserting tool card', () => {
        // onToolCall handler should flush pending tokens
        const toolCallHandler = src.slice(src.indexOf('onToolCall'));
        const handlerEnd = toolCallHandler.indexOf('onToolResult');
        const handlerBody = toolCallHandler.slice(0, handlerEnd > 0 ? handlerEnd : undefined);
        assert.ok(handlerBody.includes('flushStreamTokens'));
    });
});

describe('Chat streaming - CSS styles', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/styles/chat.css'), 'utf-8');

    it('has streaming-cursor class with blink animation', () => {
        assert.ok(src.includes('.streaming-cursor'));
        assert.ok(src.includes('blink-cursor'));
    });

    it('has streaming-text class with pre-wrap', () => {
        assert.ok(src.includes('.streaming-text'));
        assert.ok(src.includes('pre-wrap'));
    });

    it('has inline tool card styles', () => {
        assert.ok(src.includes('.tool-card.inline'));
    });
});
