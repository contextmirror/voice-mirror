/**
 * voice-handler.js - Voice event handling
 * Processes voice state changes from the voice backend and updates UI accordingly.
 */

import { createLog } from './log.js';
import { setOrbState } from './orb-canvas.js';
import { setRecordingVisual } from './chat-input.js';
import { updateAIStatus, updateProviderDisplay } from './terminal.js';
import { showToast } from './notifications.js';
import { setAIStatus } from './ai-status.js';
import { updateCaptureButtonState } from './image-handler.js';

const log = createLog('[Voice]');

// DOM elements
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

/**
 * Handle voice events from voice backend
 */
export function handleVoiceEvent(data) {
    log.debug('Voice event:', data);
    switch (data.type) {
        case 'starting':
            statusText.textContent = 'Starting...';
            statusIndicator.className = '';
            break;
        case 'ready':
            statusIndicator.className = '';
            // Hide reconnect button on successful connection
            const reconnectBtnReady = document.getElementById('voice-reconnect-btn');
            if (reconnectBtnReady) reconnectBtnReady.style.display = 'none';
            window.voiceMirror.config.get().then(cfg => {
                const mode = cfg.behavior?.activationMode || 'wakeWord';
                if (mode === 'pushToTalk') {
                    const key = cfg.behavior?.pttKey || 'Space';
                    statusText.textContent = `Ready - hold ${key} to talk`;
                } else {
                    const phrase = (cfg.wakeWord?.phrase || 'hey_claude')
                        .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    statusText.textContent = `Ready - say "${phrase}"`;
                }
            }).catch(() => {
                statusText.textContent = 'Ready';
            });
            break;
        case 'reconnecting':
            statusText.textContent = `Reconnecting (${data.attempt}/${data.maxAttempts})...`;
            statusIndicator.className = 'warning';
            showToast(`Voice backend disconnected. Reconnecting (attempt ${data.attempt})...`, 'warning', 5000);
            break;
        case 'restart_failed':
            statusText.textContent = 'Voice backend offline';
            statusIndicator.className = 'error';
            showToast('Voice backend failed to restart. Click Reconnect to try again.', 'error', 0);
            // Show reconnect button
            const reconnectBtnFailed = document.getElementById('voice-reconnect-btn');
            if (reconnectBtnFailed) reconnectBtnFailed.style.display = 'inline-block';
            break;
        case 'wake':
            setOrbState('idle');
            statusText.textContent = 'Wake word detected!';
            statusIndicator.className = 'wake';
            break;
        case 'recording':
            setOrbState('recording');
            statusIndicator.className = 'recording';
            statusText.textContent = 'Recording...';
            setRecordingVisual(true);
            setAIStatus('Recording...', true, 0, 'voice');
            break;
        case 'processing':
            setOrbState('thinking');
            statusIndicator.className = 'thinking';
            statusText.textContent = 'Processing...';
            setRecordingVisual(false);
            setAIStatus('Processing speech...', true, 0, 'voice');
            break;
        case 'thinking':
            setOrbState('thinking');
            statusIndicator.className = 'thinking';
            statusText.textContent = data.source ? `Asking ${data.source}...` : 'Thinking...';
            setAIStatus(data.source ? `Asking ${data.source}...` : 'Thinking...', true, 0, 'voice');
            break;
        case 'speaking':
            setOrbState('speaking');
            statusIndicator.className = 'speaking';
            statusText.textContent = 'Speaking...';
            setAIStatus('Speaking...', true, 0, 'voice');
            break;
        case 'idle':
            // Don't downgrade from recording/dictating (e.g. PTT interrupted TTS —
            // speaking_end arrives after recording already started)
            if (statusIndicator.className === 'recording' ||
                statusIndicator.className === 'dictating') break;
            setOrbState('idle');
            statusIndicator.className = '';
            statusText.textContent = 'Listening...';
            setRecordingVisual(false);
            setAIStatus(null, true, 0, 'voice');
            break;
        case 'claude_message':
            // Claude responded via inbox — transition to idle after a short delay
            // (gives TTS time to claim 'speaking' state if notifications are on)
            setTimeout(() => {
                if (statusText.textContent === 'Processing...') {
                    setOrbState('idle');
                    statusIndicator.className = '';
                    statusText.textContent = 'Listening...';
                }
            }, 2000);
            break;
        case 'dictation_start':
            setOrbState('dictating');
            setRecordingVisual(true);
            setAIStatus('Dictating...', true, 0, 'voice');
            break;
        case 'dictation_stop':
            setOrbState('idle');
            setRecordingVisual(false);
            setAIStatus(null, true, 0, 'voice');
            break;
        case 'mode_change':
            log.info('Mode changed to:', data.mode);
            break;
        case 'claude_connected':
            // Note: terminal clear on provider switch is handled in handleAIOutput('start')
            // which fires before this event, ensuring old output is wiped before new output
            updateAIStatus(true);
            // Update provider display if info is included
            if (data.provider && data.providerName) {
                updateProviderDisplay(data.providerName, data.provider, data.model);
            }
            updateCaptureButtonState();
            break;
        case 'claude_disconnected':
            updateAIStatus(false);
            updateCaptureButtonState();
            break;
        case 'disconnected':
            statusText.textContent = 'Disconnected';
            statusIndicator.className = 'error';
            break;
        case 'error':
            statusText.textContent = 'Error: ' + (data.message || 'Unknown');
            statusIndicator.className = 'error';
            break;
    }

}
