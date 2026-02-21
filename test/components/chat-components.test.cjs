/**
 * chat-components.test.js -- Source-inspection tests for tauri/src/components/chat/
 *
 * Tests ChatBubble, ChatInput, ChatPanel, MessageGroup, StreamingCursor, ToolCard.
 * Svelte components cannot be imported in Node.js -- we read source and assert patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CHAT_DIR = path.join(__dirname, '../../src/components/chat');

function readComponent(name) {
  return fs.readFileSync(path.join(CHAT_DIR, name), 'utf-8');
}

// ---- ChatBubble.svelte ----

describe('ChatBubble.svelte', () => {
  const src = readComponent('ChatBubble.svelte');

  it('imports renderMarkdown from markdown.js', () => {
    assert.ok(src.includes("import { renderMarkdown } from '../../lib/markdown.js'"), 'Should import renderMarkdown');
  });

  it('imports StreamingCursor', () => {
    assert.ok(src.includes("import StreamingCursor from './StreamingCursor.svelte'"), 'Should import StreamingCursor');
  });

  it('imports ToolCard', () => {
    assert.ok(src.includes("import ToolCard from './ToolCard.svelte'"), 'Should import ToolCard');
  });

  it('uses $props for message', () => {
    assert.ok(src.includes('let { message } = $props()'), 'Should destructure message from $props');
  });

  it('has user class variant', () => {
    assert.ok(src.includes('class:user={isUser}'), 'Should have user class binding');
  });

  it('has assistant class variant', () => {
    assert.ok(src.includes('class:assistant={!isUser && !isError}'), 'Should have assistant class');
  });

  it('has error class variant', () => {
    assert.ok(src.includes('class:error={isError}'), 'Should have error class binding');
  });

  it('has streaming class variant', () => {
    assert.ok(src.includes('class:streaming={message.streaming}'), 'Should have streaming class');
  });

  it('derives isUser from message.role', () => {
    assert.ok(src.includes("message.role === 'user'"), 'Should check role for user');
  });

  it('derives isError from message.role', () => {
    assert.ok(src.includes("message.role === 'error'"), 'Should check role for error');
  });

  it('renders markdown content via @html', () => {
    assert.ok(src.includes('{@html htmlContent}'), 'Should render HTML from markdown');
  });

  it('uses renderMarkdown to derive htmlContent', () => {
    assert.ok(src.includes('renderMarkdown(message.text)'), 'Should call renderMarkdown');
  });

  it('has copy button with aria-label', () => {
    assert.ok(src.includes('aria-label='), 'Should have aria-label on copy button');
    assert.ok(src.includes('Copy message'), 'Should have copy message label');
  });

  it('has .chat-bubble CSS class', () => {
    assert.ok(src.includes('.chat-bubble'), 'Should have .chat-bubble CSS');
  });

  it('has .chat-bubble.user CSS', () => {
    assert.ok(src.includes('.chat-bubble.user'), 'Should style user variant');
  });

  it('has .chat-bubble.error CSS', () => {
    assert.ok(src.includes('.chat-bubble.error'), 'Should style error variant');
  });

  it('has .chat-bubble.assistant CSS', () => {
    assert.ok(src.includes('.chat-bubble.assistant'), 'Should style assistant variant');
  });

  it('renders ToolCard for each tool call', () => {
    assert.ok(src.includes('<ToolCard'), 'Should render ToolCard component');
  });

  it('has tool-calls-section', () => {
    assert.ok(src.includes('tool-calls-section'), 'Should have tool calls section');
  });

  it('has streaming indicator with pulse animation', () => {
    assert.ok(src.includes('streaming-dot'), 'Should have streaming dot indicator');
    assert.ok(src.includes('@keyframes pulse'), 'Should have pulse animation');
  });

  it('derives hasAttachments from message.attachments', () => {
    assert.ok(src.includes('hasAttachments'), 'Should derive hasAttachments');
    assert.ok(src.includes('attachments.length > 0'), 'Should check attachments length');
  });

  it('renders attachment images using dataUrl', () => {
    assert.ok(src.includes('bubble-attachments'), 'Should have bubble-attachments container');
    assert.ok(src.includes('att.dataUrl'), 'Should use att.dataUrl for image src');
    assert.ok(src.includes('bubble-attachment-img'), 'Should have bubble-attachment-img class');
  });
});

// ---- ChatInput.svelte ----

describe('ChatInput.svelte', () => {
  const src = readComponent('ChatInput.svelte');

  it('imports chatStore', () => {
    assert.ok(src.includes("import { chatStore } from '../../lib/stores/chat.svelte.js'"), 'Should import chatStore');
  });

  it('has onSend prop', () => {
    assert.ok(src.includes('onSend'), 'Should have onSend prop');
  });

  it('has isRecording prop', () => {
    assert.ok(src.includes('isRecording'), 'Should have isRecording prop');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });

  it('has textarea element', () => {
    assert.ok(src.includes('<textarea'), 'Should have a textarea element');
  });

  it('has send button with aria-label', () => {
    assert.ok(src.includes('aria-label="Send message"'), 'Should have aria-label on send button');
  });

  it('handles Enter key for send', () => {
    assert.ok(src.includes("e.key === 'Enter'"), 'Should handle Enter key');
  });

  it('handles Shift+Enter for newline (does not send)', () => {
    assert.ok(src.includes('!e.shiftKey'), 'Should allow Shift+Enter for newline');
  });

  it('has auto-resize functionality', () => {
    assert.ok(src.includes('autoResize'), 'Should have autoResize function');
  });

  it('has recording indicator', () => {
    assert.ok(src.includes('recording-indicator'), 'Should have recording indicator');
    assert.ok(src.includes('recording-dot'), 'Should have recording dot');
  });

  it('has .chat-textarea CSS', () => {
    assert.ok(src.includes('.chat-textarea'), 'Should have textarea CSS');
  });

  it('has .send-btn CSS', () => {
    assert.ok(src.includes('.send-btn'), 'Should have send button CSS');
  });

  it('derives sendDisabled from state', () => {
    assert.ok(src.includes('sendDisabled'), 'Should have sendDisabled derived');
  });

  it('has attachments prop', () => {
    assert.ok(src.includes('attachments'), 'Should have attachments prop');
  });

  it('has onRemoveAttachment prop', () => {
    assert.ok(src.includes('onRemoveAttachment'), 'Should have onRemoveAttachment prop');
  });

  it('has onClearAttachments prop', () => {
    assert.ok(src.includes('onClearAttachments'), 'Should have onClearAttachments prop');
  });

  it('has attachment preview strip', () => {
    assert.ok(src.includes('attachment-preview-strip'), 'Should have attachment preview strip');
    assert.ok(src.includes('attachment-thumb'), 'Should have attachment thumbnail');
    assert.ok(src.includes('attachment-remove-btn'), 'Should have attachment remove button');
  });

  it('derives thumbnailUrls using dataUrl', () => {
    assert.ok(src.includes('thumbnailUrls'), 'Should derive thumbnailUrls');
    assert.ok(src.includes('att.dataUrl'), 'Should use att.dataUrl for thumbnail URLs');
  });

  it('allows sending with attachments only (no text required)', () => {
    assert.ok(
      src.includes('!hasAttachments'),
      'sendDisabled should consider hasAttachments'
    );
  });

  it('passes attachments to onSend callback', () => {
    assert.ok(src.includes('onSend(trimmed, attachments)'), 'Should pass attachments to onSend');
  });

  it('calls onClearAttachments after send', () => {
    assert.ok(src.includes('onClearAttachments()'), 'Should clear attachments after send');
  });
});

// ---- ChatPanel.svelte ----

describe('ChatPanel.svelte', () => {
  const src = readComponent('ChatPanel.svelte');

  it('imports MessageGroup', () => {
    assert.ok(src.includes("import MessageGroup from './MessageGroup.svelte'"), 'Should import MessageGroup');
  });

  it('imports ChatInput', () => {
    assert.ok(src.includes("import ChatInput from './ChatInput.svelte'"), 'Should import ChatInput');
  });

  it('imports chatStore', () => {
    assert.ok(src.includes("import { chatStore } from '../../lib/stores/chat.svelte.js'"), 'Should import chatStore');
  });

  it('imports voiceStore', () => {
    assert.ok(src.includes("import { voiceStore } from '../../lib/stores/voice.svelte.js'"), 'Should import voiceStore');
  });

  it('has chat-scroll-area', () => {
    assert.ok(src.includes('chat-scroll-area'), 'Should have scroll area');
  });

  it('has messages-container', () => {
    assert.ok(src.includes('messages-container'), 'Should have messages container');
  });

  it('has empty state', () => {
    assert.ok(src.includes('empty-state'), 'Should have empty state');
  });

  it('shows start conversation message', () => {
    assert.ok(src.includes('Start a conversation'), 'Should show start conversation prompt');
  });

  it('groups messages by role via messageGroups derived', () => {
    assert.ok(src.includes('messageGroups'), 'Should have messageGroups derived');
  });

  it('has auto-scroll functionality', () => {
    assert.ok(src.includes('autoScroll'), 'Should have autoScroll function');
  });

  it('defines SCROLL_THRESHOLD', () => {
    assert.ok(src.includes('SCROLL_THRESHOLD'), 'Should define SCROLL_THRESHOLD');
  });

  it('renders MessageGroup for each group', () => {
    assert.ok(src.includes('<MessageGroup'), 'Should render MessageGroup component');
  });

  it('renders ChatInput at bottom', () => {
    assert.ok(src.includes('<ChatInput'), 'Should render ChatInput component');
  });

  it('has $props for onSend and inputDisabled', () => {
    assert.ok(src.includes('onSend'), 'Should accept onSend prop');
    assert.ok(src.includes('inputDisabled'), 'Should accept inputDisabled prop');
  });

  it('imports ScreenshotPicker', () => {
    assert.ok(src.includes("import ScreenshotPicker from './ScreenshotPicker.svelte'"), 'Should import ScreenshotPicker');
  });

  it('has showScreenshotPicker state', () => {
    assert.ok(src.includes('showScreenshotPicker'), 'Should have showScreenshotPicker state');
  });

  it('renders ScreenshotPicker conditionally', () => {
    assert.ok(src.includes('<ScreenshotPicker'), 'Should render ScreenshotPicker component');
  });

  it('imports attachmentsStore for shared attachment state', () => {
    assert.ok(src.includes("import { attachmentsStore } from '../../lib/stores/attachments.svelte.js'"), 'Should import attachmentsStore');
  });

  it('derives pendingAttachments from attachmentsStore', () => {
    assert.ok(src.includes('attachmentsStore.pending'), 'Should derive from attachmentsStore.pending');
  });

  it('handleScreenshotCapture uses attachmentsStore.add (not chat store)', () => {
    const captureBlock = src.slice(src.indexOf('function handleScreenshotCapture'));
    const captureEnd = captureBlock.indexOf('}');
    const captureBody = captureBlock.slice(0, captureEnd);
    assert.ok(
      !captureBody.includes("chatStore.addMessage"),
      'handleScreenshotCapture should NOT add system message to chatStore'
    );
    assert.ok(
      captureBody.includes('attachmentsStore.add'),
      'handleScreenshotCapture should add to attachmentsStore'
    );
  });

  it('handleRemoveAttachment calls attachmentsStore.remove', () => {
    assert.ok(src.includes('attachmentsStore.remove'), 'Should call attachmentsStore.remove');
  });

  it('handleClearAttachments calls attachmentsStore.clear', () => {
    assert.ok(src.includes('attachmentsStore.clear'), 'Should call attachmentsStore.clear');
  });

  it('passes attachment props to ChatInput', () => {
    assert.ok(
      src.includes('attachments={pendingAttachments}'),
      'Should pass pendingAttachments to ChatInput'
    );
    assert.ok(
      src.includes('onRemoveAttachment={handleRemoveAttachment}'),
      'Should pass onRemoveAttachment to ChatInput'
    );
    assert.ok(
      src.includes('onClearAttachments={handleClearAttachments}'),
      'Should pass onClearAttachments to ChatInput'
    );
  });
});

// ---- ScreenshotPicker.svelte ----

describe('ScreenshotPicker.svelte', () => {
  const src = readComponent('ScreenshotPicker.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has onCapture and onClose props', () => {
    assert.ok(src.includes('onCapture'), 'Should have onCapture prop');
    assert.ok(src.includes('onClose'), 'Should have onClose prop');
  });

  it('imports listMonitors and listWindows from api', () => {
    assert.ok(src.includes('listMonitors'), 'Should import listMonitors');
    assert.ok(src.includes('listWindows'), 'Should import listWindows');
  });

  it('imports captureMonitor and captureWindow from api', () => {
    assert.ok(src.includes('captureMonitor'), 'Should import captureMonitor');
    assert.ok(src.includes('captureWindow'), 'Should import captureWindow');
  });

  it('has three tabs: Browser Tab, Window, Entire Screen', () => {
    assert.ok(src.includes('Browser Tab'), 'Should have Browser Tab');
    assert.ok(src.includes("switchTab('window')"), 'Should have Window tab');
    assert.ok(src.includes('Entire Screen'), 'Should have Entire Screen tab');
  });

  it('has picker-overlay with z-index 10001', () => {
    assert.ok(src.includes('picker-overlay'), 'Should have picker-overlay');
    assert.ok(src.includes('z-index: 10001'), 'Should have z-index 10001');
  });

  it('has Cancel and Share buttons', () => {
    assert.ok(src.includes('Cancel'), 'Should have Cancel button');
    assert.ok(src.includes('Share'), 'Should have Share button');
  });

  it('has loading state with spinner', () => {
    assert.ok(src.includes('loading'), 'Should track loading state');
    assert.ok(src.includes('Loading previews'), 'Should show loading text');
  });

  it('renders thumbnail images from base64', () => {
    assert.ok(src.includes('data:image/png;base64'), 'Should render base64 thumbnails');
  });

  it('has selected class for thumbnail cards', () => {
    assert.ok(src.includes('class:selected'), 'Should highlight selected thumbnail');
  });

  it('handles Escape key to close', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should close on Escape');
  });

  it('enables browser tab when snapshot available', () => {
    assert.ok(src.includes('hasBrowser'), 'Should check for browser snapshot availability');
    assert.ok(src.includes('browserSnapshot'), 'Should accept browserSnapshot prop');
  });

  it('has backdrop-filter for blur effect', () => {
    assert.ok(src.includes('backdrop-filter: blur'), 'Should have backdrop blur');
  });
});

// ---- MessageGroup.svelte ----

describe('MessageGroup.svelte', () => {
  const src = readComponent('MessageGroup.svelte');

  it('imports ChatBubble', () => {
    assert.ok(src.includes("import ChatBubble from './ChatBubble.svelte'"), 'Should import ChatBubble');
  });

  it('imports formatTime from utils', () => {
    assert.ok(src.includes("import { formatTime } from '../../lib/utils.js'"), 'Should import formatTime');
  });

  it('has group prop via $props', () => {
    assert.ok(src.includes('let { group } = $props()'), 'Should destructure group from $props');
  });

  it('has user CSS class variant', () => {
    assert.ok(src.includes('class:user={isUser}'), 'Should have user class binding');
  });

  it('has assistant CSS class variant', () => {
    assert.ok(src.includes('class:assistant={!isUser}'), 'Should have assistant class binding');
  });

  it('derives isUser from group.role', () => {
    assert.ok(src.includes("group.role === 'user'"), 'Should derive isUser from group role');
  });

  it('shows sender name (You or Assistant)', () => {
    assert.ok(src.includes("'You'"), 'Should show You for user');
    assert.ok(src.includes("'Assistant'"), 'Should show Assistant for AI');
  });

  it('has message-avatar section', () => {
    assert.ok(src.includes('message-avatar'), 'Should have avatar section');
  });

  it('has message-header section', () => {
    assert.ok(src.includes('message-header'), 'Should have header section');
  });

  it('has message-bubbles container', () => {
    assert.ok(src.includes('message-bubbles'), 'Should have bubbles container');
  });

  it('renders ChatBubble for each message in group', () => {
    assert.ok(src.includes('<ChatBubble'), 'Should render ChatBubble');
  });

  it('uses svelte/transition fly', () => {
    assert.ok(src.includes("import { fly } from 'svelte/transition'"), 'Should import fly transition');
  });
});

// ---- StreamingCursor.svelte ----

describe('StreamingCursor.svelte', () => {
  const src = readComponent('StreamingCursor.svelte');

  it('has streaming-cursor CSS class', () => {
    assert.ok(src.includes('.streaming-cursor'), 'Should have streaming-cursor class');
  });

  it('has blink animation', () => {
    assert.ok(src.includes('@keyframes blink-cursor'), 'Should have blink-cursor animation');
  });

  it('has aria-hidden for accessibility', () => {
    assert.ok(src.includes('aria-hidden="true"'), 'Should be aria-hidden');
  });

  it('uses block cursor character', () => {
    assert.ok(src.includes('&#x2588;') || src.includes('\u2588'), 'Should use block cursor char');
  });

  it('respects prefers-reduced-motion', () => {
    assert.ok(src.includes('prefers-reduced-motion'), 'Should respect reduced motion');
  });

  it('has animation CSS property', () => {
    assert.ok(src.includes('animation:'), 'Should have animation CSS');
  });
});

// ---- ToolCard.svelte ----

describe('ToolCard.svelte', () => {
  const src = readComponent('ToolCard.svelte');

  it('has tool prop via $props', () => {
    assert.ok(src.includes('let { tool } = $props()'), 'Should destructure tool from $props');
  });

  it('displays tool name', () => {
    assert.ok(src.includes('tool-name'), 'Should have tool-name class');
    assert.ok(src.includes('displayName'), 'Should derive displayName');
  });

  it('derives displayName from tool.displayName or tool.name', () => {
    assert.ok(
      src.includes("tool.displayName || tool.name || 'Tool'"),
      'Should fall back to tool.name then Tool'
    );
  });

  it('has running status class', () => {
    assert.ok(src.includes("class:running={tool.status === 'running'}"), 'Should have running class');
  });

  it('has success status class', () => {
    assert.ok(src.includes("class:success={tool.status === 'success'}"), 'Should have success class');
  });

  it('has failed status class', () => {
    assert.ok(src.includes("class:failed={tool.status === 'failed'}"), 'Should have failed class');
  });

  it('derives statusLabel from tool.status', () => {
    assert.ok(src.includes('statusLabel'), 'Should derive statusLabel');
    assert.ok(src.includes("'Running'"), 'Should map running to Running');
    assert.ok(src.includes("'Done'"), 'Should map success to Done');
    assert.ok(src.includes("'Failed'"), 'Should map failed to Failed');
  });

  it('has tool-card CSS class', () => {
    assert.ok(src.includes('.tool-card'), 'Should have tool-card CSS');
  });

  it('has tool-card-header', () => {
    assert.ok(src.includes('tool-card-header'), 'Should have tool card header');
  });

  it('has args preview section', () => {
    assert.ok(src.includes('argsPreview'), 'Should derive argsPreview');
    assert.ok(src.includes('tool-card-args'), 'Should have tool-card-args section');
  });

  it('uses svelte/transition fly', () => {
    assert.ok(src.includes("import { fly } from 'svelte/transition'"), 'Should import fly transition');
  });

  it('has pulse animation for running status', () => {
    assert.ok(src.includes('@keyframes pulse-subtle'), 'Should have pulse animation for running');
  });
});
