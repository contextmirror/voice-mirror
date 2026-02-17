/**
 * ai-status.js - AI activity status bar management
 * Parses PTY output for Claude Code activity, manages status priority & display.
 */

// DOM elements
const aiStatusBar = document.getElementById('ai-status-bar');
const aiStatusText = document.getElementById('ai-status-text');
let aiStatusTimer = null;

export const TOOL_DISPLAY_NAMES = {
    capture_screen: 'Capturing screen',
    browser_search: 'Searching the web',
    browser_fetch: 'Fetching page',
    browser_navigate: 'Navigating browser',
    browser_open: 'Opening tab',
    browser_close_tab: 'Closing tab',
    browser_focus: 'Focusing tab',
    browser_tabs: 'Listing tabs',
    browser_start: 'Starting browser',
    browser_stop: 'Stopping browser',
    browser_status: 'Checking browser',
    browser_act: 'Interacting with page',
    browser_click: 'Clicking element',
    browser_type: 'Typing in browser',
    browser_screenshot: 'Taking screenshot',
    browser_snapshot: 'Reading page structure',
    browser_console: 'Reading console',
    browser_cookies: 'Managing cookies',
    browser_storage: 'Managing storage',
    browser_evaluate: 'Running script',
    memory_search: 'Searching memory',
    memory_get: 'Reading memory',
    memory_remember: 'Saving to memory',
    memory_forget: 'Forgetting memory',
    memory_stats: 'Checking memory stats',
    memory_flush: 'Flushing memory',
    claude_listen: 'Listening for voice',
    claude_send: 'Sending response',
    claude_inbox: 'Reading inbox',
    claude_status: 'Checking status',
    get_diagnostic_logs: 'Reading diagnostics',
    clone_voice: 'Cloning voice',
    clear_voice_clone: 'Clearing voice clone',
    list_voice_clones: 'Listing voice clones',
    n8n_list_workflows: 'Listing workflows',
    n8n_get_workflow: 'Reading workflow',
    n8n_create_workflow: 'Creating workflow',
    n8n_update_workflow: 'Updating workflow',
    n8n_delete_workflow: 'Deleting workflow',
    n8n_trigger_workflow: 'Triggering workflow',
    n8n_search_nodes: 'Searching nodes',
    n8n_get_node: 'Reading node',
    web_search: 'Searching the web',
    load_tools: 'Loading tools',
    unload_tools: 'Unloading tools',
    list_tool_groups: 'Listing tool groups',
};

/**
 * Status priority levels — higher priority sources can override lower ones.
 * MCP watcher events (concrete actions) outrank noisy PTY parsing.
 * Voice events (from voice backend) take top priority.
 */
const STATUS_PRIORITY = { idle: 0, pty: 1, mcp: 2, voice: 3 };
let currentStatusPriority = STATUS_PRIORITY.idle;
let currentStatusSource = 'idle';

/**
 * Minimum display duration — prevents rapid flickering by holding a status
 * on screen for at least this long before allowing changes.
 */
let statusHoldUntil = 0;
const STATUS_HOLD_MS = 1200; // 1.2s minimum for meaningful statuses

/**
 * Set the AI activity status bar text.
 * @param {string} text - Status text to display
 * @param {boolean} active - Whether to show shimmer animation
 * @param {number} [autoClearMs] - Auto-hide after this many ms (0 = don't auto-hide)
 * @param {string} [source] - Source: 'idle', 'pty', or 'voice' (for priority)
 */
export function setAIStatus(text, active = true, autoClearMs = 0, source = 'idle') {
    if (!aiStatusBar || !aiStatusText) return;

    const priority = STATUS_PRIORITY[source] ?? STATUS_PRIORITY.idle;
    const now = Date.now();

    // Don't let lower-priority sources override higher-priority active states
    if (text && currentStatusPriority > priority && currentStatusSource !== 'idle') {
        return;
    }

    // Respect minimum hold time — keep current status visible long enough to read.
    // Only voice events (highest priority) can break through the hold.
    if (text && now < statusHoldUntil && source !== 'voice' && priority <= currentStatusPriority) {
        return;
    }

    if (aiStatusTimer) { clearTimeout(aiStatusTimer); aiStatusTimer = null; }

    if (!text) {
        // Don't clear to idle if we're still within the hold period
        if (now < statusHoldUntil) {
            aiStatusTimer = setTimeout(() => setAIStatus(null), statusHoldUntil - now + 50);
            return;
        }
        aiStatusText.textContent = 'Waiting for input';
        aiStatusText.classList.remove('shiny-text');
        currentStatusPriority = STATUS_PRIORITY.idle;
        currentStatusSource = 'idle';
        return;
    }

    // Avoid redundant DOM updates for the same text
    if (aiStatusText.textContent === text) {
        // Still update timer if needed
        if (autoClearMs > 0) {
            aiStatusTimer = setTimeout(() => setAIStatus(null), autoClearMs);
        }
        return;
    }

    aiStatusText.textContent = text;
    currentStatusPriority = priority;
    currentStatusSource = source;

    // Set hold time so the status stays readable
    statusHoldUntil = now + STATUS_HOLD_MS;

    if (active) {
        aiStatusText.classList.add('shiny-text');
    } else {
        aiStatusText.classList.remove('shiny-text');
    }

    if (autoClearMs > 0) {
        aiStatusTimer = setTimeout(() => setAIStatus(null), autoClearMs);
    }
}

/**
 * Strip ANSI escape codes and TUI control sequences from a string.
 * Claude Code uses a full TUI (cursor positioning, DEC private modes, etc.)
 * so we need to handle much more than basic SGR sequences.
 */
function stripAnsi(str) {
    return str
        // CSI sequences: \x1b[ then ANY non-letter chars until terminating letter/~
        // Permissive — handles all parameter formats including : subparams,
        // ? prefix, 24-bit color, etc.
        .replace(/\x1b\[[^a-zA-Z~]*[a-zA-Z~]/g, '')
        // OSC sequences: \x1b] ... BEL or ST
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        // Other 2-char escapes: charset selection, keypad modes, etc.
        .replace(/\x1b[()#=<>A-Za-z]/g, '')
        // Stray control characters (except \t \n \r)
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/**
 * Parse Claude Code PTY output for activity status.
 * PTY data arrives in small chunks, so we accumulate into a rolling buffer.
 * Uses debouncing to prevent flickering between rapid state changes.
 */
let ptyActivityTimer = null;
let ptyRawBuffer = '';        // Accumulates RAW PTY data (with ANSI codes intact)
const PTY_BUFFER_MAX = 4000;
let lastPtyStatus = '';
let ptyDebounceTimer = null;
let _lastPtyDiag = 0; // Throttle for PTY diagnostic logging

/**
 * Debounced PTY status setter — prevents flickering from rapid PTY output.
 */
function setPtyStatus(text, active = true, autoClearMs = 0) {
    if (text === lastPtyStatus) return; // Skip duplicates
    lastPtyStatus = text;

    if (ptyDebounceTimer) clearTimeout(ptyDebounceTimer);
    ptyDebounceTimer = setTimeout(() => {
        setAIStatus(text, active, autoClearMs, 'pty');
    }, 300); // 300ms debounce — prevents rapid flickering from chunked PTY output
}

/**
 * Format a raw tool name into a readable display string.
 * e.g. "browser_screenshot" -> "Browser screenshot"
 */
export function formatToolName(name) {
    return name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export function parsePtyActivity(rawText) {
    // Accumulate RAW PTY data, then strip ANSI from the full buffer.
    // This handles escape sequences split across chunk boundaries —
    // e.g. \x1b[21 in one chunk and ;33H in the next.
    ptyRawBuffer += rawText;
    if (ptyRawBuffer.length > PTY_BUFFER_MAX) {
        ptyRawBuffer = ptyRawBuffer.slice(-PTY_BUFFER_MAX);
    }
    const text = stripAnsi(ptyRawBuffer);

    // --- MCP tool calls ---
    // Patterns: "• voice-mirror-electron - tool_name (MCP)" or "tool_name (MCP)"
    const mcpMatch = text.match(/[•●]\s*\S+\s*[-–]\s*(\w+)\s*\(?MCP\)?/);
    if (mcpMatch) {
        const tool = mcpMatch[1];
        const displayName = TOOL_DISPLAY_NAMES[tool] || formatToolName(tool);
        setPtyStatus(displayName, true);
        ptyRawBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 15000);
        return;
    }

    // --- Claude Code built-in tools ---
    // Match tool names — flexible: "⏺ Read(" / "Read(" / any prefix before tool name
    const builtinMatch = text.match(/(Read|Edit|Update|Write|Bash|Glob|Grep|WebSearch|WebFetch|Task|NotebookEdit|TodoWrite|TodoRead)\s*\(/);
    if (builtinMatch) {
        const names = {
            Read: 'Reading file', Edit: 'Editing file', Update: 'Editing file',
            Write: 'Writing file', Bash: 'Running command', Glob: 'Searching files',
            Grep: 'Searching code', WebSearch: 'Searching the web', WebFetch: 'Fetching page',
            Task: 'Running task', NotebookEdit: 'Editing notebook',
            TodoWrite: 'Updating todos', TodoRead: 'Reading todos'
        };
        setPtyStatus(names[builtinMatch[1]] || builtinMatch[1], true);
        ptyRawBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 10000);
        return;
    }

    // --- Search/glob result counts ---
    const searchMatch = text.match(/[Ss]earch\w*\s+(?:for\s+)?(\d+)\s*pattern/);
    if (searchMatch) {
        setPtyStatus(`Searched ${searchMatch[1]} patterns`, false, 3000);
        ptyRawBuffer = '';
        return;
    }

    // --- Thinking / running states ---
    // Match Claude Code spinners — use loose matching since TUI garbles text.
    // Just detect the keyword anywhere in the stripped buffer.
    const lowerText = text.toLowerCase();
    const thinkingKeywords = ['thinking', 'ionizing', 'boondoggling', 'crystallizing',
        'percolating', 'synthesizing', 'reasoning', 'planning', 'reflecting'];
    const runningKeywords = ['running', 'generating', 'analyzing', 'compiling',
        'processing', 'evaluating'];
    const matchedThinking = thinkingKeywords.find(kw => lowerText.includes(kw));
    const matchedRunning = runningKeywords.find(kw => lowerText.includes(kw));

    if (matchedThinking) {
        const label = matchedThinking.charAt(0).toUpperCase() + matchedThinking.slice(1);
        setPtyStatus(`${label}...`, true);
        ptyRawBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 15000);
        return;
    }
    if (matchedRunning) {
        const label = matchedRunning.charAt(0).toUpperCase() + matchedRunning.slice(1);
        setPtyStatus(`${label}...`, true);
        ptyRawBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 10000);
        return;
    }

    // "thought for X seconds" / "thought for Xs"
    if (lowerText.includes('thought for')) {
        setPtyStatus('Thinking...', true);
        ptyRawBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 15000);
        return;
    }

    // --- Specific events ---
    if (text.includes('Message sent in thread')) {
        setPtyStatus('Message sent', false, 2000);
        ptyRawBuffer = '';
        return;
    }

    if (lowerText.includes('listening for your voice') || lowerText.includes('listening for voice')) {
        setPtyStatus('Listening for voice...', true);
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 600000);
        return;
    }

    // --- Prompt / waiting for input detection ---
    // Claude Code prompt is "❯ " or "> " at end of output
    if (text.includes('❯') || /^>\s*$/m.test(text) || text.endsWith('> ')) {
        // Claude Code returned to prompt — force clear, bypass hold timer
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        statusHoldUntil = 0;
        setAIStatus(null);
        lastPtyStatus = '';
        ptyRawBuffer = '';
        return;
    }

    // --- Generic activity fallback ---
    // Show "Working..." when idle and receiving substantial PTY data.
    // Use raw chunk length to gauge real activity (stripped buffer is cumulative).
    const chunkLen = stripAnsi(rawText).length;
    const isStatusLineNoise = chunkLen < 80 && /tokens|cost|context|model|%|\d+k/i.test(rawText);
    if (chunkLen > 20 && !isStatusLineNoise) {
        if (currentStatusSource === 'idle') {
            setPtyStatus('Working...', true);
            // Diagnostic: log buffer when fallback triggers (once per 10s)
            const now = Date.now();
            if (now - _lastPtyDiag > 10000 && window.voiceMirror?.devlog) {
                _lastPtyDiag = now;
                window.voiceMirror.devlog('STATUS', 'pty-no-match', { text: text.slice(-400) });
            }
        }
        // Refresh auto-clear timer — keeps status alive while real data flows
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 4000);
    }
}
