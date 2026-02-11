/**
 * chat-input.js - Chat input bar behavior
 * Handles sending text messages, toggling voice, clearing and saving chat history.
 */

import { addMessage, isDuplicate, autoScroll } from './messages.js';

let textarea;
let sendBtn;
let clearBtn;
let saveBtn;
let chatContainer;
let welcomeMessage;

function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    addMessage('user', text);
    isDuplicate(text); // Register in dedup map so Python echo is suppressed
    window.voiceMirror.python.sendQuery({ text });

    textarea.value = '';
    textarea.style.height = '';
}

export function clearChat() {
    const elements = chatContainer.querySelectorAll('.message-group, .tool-card');
    for (const el of elements) {
        if (el.id === 'welcome-message') continue;
        el.remove();
    }

    if (welcomeMessage) {
        welcomeMessage.style.display = '';
    }

    chatContainer.scrollTop = 0;
}

export function getAllMessages() {
    const groups = chatContainer.querySelectorAll('.message-group');
    const messages = [];

    for (const group of groups) {
        if (group.id === 'welcome-message') continue;

        const role = group.classList.contains('user') ? 'user' : 'assistant';
        const bubble = group.querySelector('.message-bubble');
        const timeEl = group.querySelector('.message-time');

        messages.push({
            role,
            text: bubble ? bubble.innerText : '',
            time: timeEl ? timeEl.innerText : ''
        });
    }

    return messages;
}

function saveChat() {
    const messages = getAllMessages();
    if (messages.length === 0) return;

    const json = JSON.stringify(messages, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
}

/**
 * Show/hide the waveform overlay in the input bar during voice recording.
 * Scrolling waveform: samples mic amplitude over time and pushes bars
 * from right to left, building a waveform like a recording visualizer.
 * Bar count adapts to container width on resize.
 */
const BAR_WIDTH = 2.5;     // px per bar
const BAR_GAP = 2.5;       // px gap between bars
const SAMPLE_INTERVAL_MS = 160; // How often to push a new bar
let barCount = 0;
let waveformEl;
let barsContainer;
let bars = [];
let amplitudeHistory = [];
let resizeObserver;
let isRecording = false;

// Web Audio state
let audioCtx;
let analyser;
let micStream;
let rafId;
let sampleTimer;
let timeDomainData;

/** Calculate how many bars fit in the container. */
function calcBarCount() {
    if (!waveformEl) return 0;
    const width = waveformEl.clientWidth - 24; // subtract padding (12px each side)
    return Math.max(10, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
}

/** Rebuild bar DOM elements and resize history to match new count. */
function rebuildBars(newCount) {
    if (newCount === barCount && bars.length === barCount) return;

    const oldHistory = amplitudeHistory;
    barCount = newCount;

    // Resize history, keeping the most recent values (right side)
    amplitudeHistory = new Array(barCount).fill(0);
    if (oldHistory.length > 0) {
        const copyLen = Math.min(oldHistory.length, barCount);
        const srcStart = oldHistory.length - copyLen;
        const dstStart = barCount - copyLen;
        for (let i = 0; i < copyLen; i++) {
            amplitudeHistory[dstStart + i] = oldHistory[srcStart + i];
        }
    }

    // Rebuild DOM bars
    if (!barsContainer) return;
    barsContainer.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
        const bar = document.createElement('div');
        bar.className = 'waveform-bar';
        barsContainer.appendChild(bar);
    }
    bars = Array.from(barsContainer.children);
}

function startAudioVisualizer() {
    stopAudioVisualizer();

    amplitudeHistory = new Array(barCount).fill(0);

    const init = async () => {
        try {
            audioCtx = audioCtx || new AudioContext();
            if (audioCtx.state === 'suspended') await audioCtx.resume();

            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioCtx.createMediaStreamSource(micStream);

            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.3;
            source.connect(analyser);

            timeDomainData = new Uint8Array(analyser.fftSize);

            sampleTimer = setInterval(sampleAmplitude, SAMPLE_INTERVAL_MS);
            drawLoop();
        } catch (err) {
            console.warn('[Waveform] Could not access microphone for visualizer:', err);
        }
    };
    init();
}

function sampleAmplitude() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(timeDomainData);

    let sum = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
        const v = (timeDomainData[i] - 128) / 128;
        sum += v * v;
    }
    const rms = Math.sqrt(sum / timeDomainData.length);
    const amplitude = Math.min(1, rms * 3);

    amplitudeHistory.shift();
    amplitudeHistory.push(amplitude);
}

function drawLoop() {
    for (let i = 0; i < bars.length; i++) {
        const value = amplitudeHistory[i] || 0;
        const scale = 0.06 + value * 0.94;
        bars[i].style.transform = `scaleY(${scale})`;
    }
    rafId = requestAnimationFrame(drawLoop);
}

function stopAudioVisualizer() {
    if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (micStream) {
        for (const track of micStream.getTracks()) track.stop();
        micStream = null;
    }
    analyser = null;
    timeDomainData = null;
}

export function setRecordingVisual(active) {
    if (!waveformEl) waveformEl = document.getElementById('voice-waveform');
    if (!waveformEl) return;
    if (!barsContainer) barsContainer = waveformEl.querySelector('.waveform-bars');

    const inputRow = waveformEl.closest('#chat-input-row');
    isRecording = active;

    if (active) {
        if (inputRow) inputRow.classList.add('recording');
        waveformEl.classList.remove('hidden');

        // Calculate bar count now that element is visible and has layout
        rebuildBars(calcBarCount());

        // Watch for resize
        if (!resizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                if (isRecording) rebuildBars(calcBarCount());
            });
        }
        resizeObserver.observe(waveformEl);

        for (const bar of bars) bar.style.transform = 'scaleY(0.06)';
        startAudioVisualizer();
    } else {
        stopAudioVisualizer();
        if (resizeObserver) resizeObserver.disconnect();
        waveformEl.classList.add('hidden');
        if (inputRow) inputRow.classList.remove('recording');
    }
}

export function initChatInput() {
    textarea = document.getElementById('chat-input');
    sendBtn = document.getElementById('chat-send-btn');
    clearBtn = document.getElementById('action-clear-chat');
    saveBtn = document.getElementById('action-save-chat');
    chatContainer = document.getElementById('chat-container');
    welcomeMessage = document.getElementById('welcome-message');

    // Auto-resize textarea (grows up to 40% of viewport, then scrolls)
    textarea.addEventListener('input', () => {
        textarea.style.height = '';
        const maxHeight = window.innerHeight * 0.4;
        textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
        // Keep chat scrolled to bottom as input bar grows/shrinks
        autoScroll(chatContainer);
    });

    // Send on Enter (Shift+Enter inserts newline)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Send button
    sendBtn.addEventListener('click', sendMessage);

    // Clear chat — two-step confirm
    let clearConfirmTimer = null;
    clearBtn.addEventListener('click', () => {
        if (clearBtn.classList.contains('confirming')) {
            // Second click — actually clear
            clearTimeout(clearConfirmTimer);
            clearChat();
            resetClearBtn();
        } else {
            // First click — switch to confirm state
            clearBtn.classList.add('confirming');
            clearBtn.querySelector('span').textContent = 'Confirm';
            clearBtn.querySelector('svg').innerHTML = '<polyline points="20 6 9 17 4 12"/>';
            clearConfirmTimer = setTimeout(resetClearBtn, 3000);
        }
    });

    function resetClearBtn() {
        clearBtn.classList.remove('confirming');
        clearBtn.querySelector('span').textContent = 'Clear';
        clearBtn.querySelector('svg').innerHTML =
            '<polyline points="3 6 5 6 21 6"/>' +
            '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
            '<path d="M10 11v6"/><path d="M14 11v6"/>';
    }

    // Save chat
    saveBtn.addEventListener('click', saveChat);
}
