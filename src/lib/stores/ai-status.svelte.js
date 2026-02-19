/**
 * ai-status.svelte.js -- Reactive AI provider status store.
 *
 * Tracks whether the AI provider is running, its display name,
 * and auto-starts the configured provider when the app loads.
 *
 * Also wires API provider streaming events (ai-stream-token, ai-stream-end,
 * ai-response) to the chat store so API responses appear in the chat UI.
 *
 * Listens to Tauri events: ai-status-change, ai-error, ai-output,
 * ai-stream-token, ai-stream-end, ai-response.
 */
import { listen } from '@tauri-apps/api/event';
import { startAI, stopAI, getAIStatus, setProvider as apiSetProvider, speakText } from '../api.js';
import { configStore } from './config.svelte.js';
import { chatStore } from './chat.svelte.js';
import { buildLocalLlmInstructions } from '../local-llm-instructions.js';

const PROVIDER_NAMES = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'OpenAI Codex',
  'gemini-cli': 'Gemini CLI',
  'kimi-cli': 'Kimi CLI',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  jan: 'Jan',
  openai: 'OpenAI',
  groq: 'Groq',
};

/** CLI providers that use a PTY terminal (not HTTP API). */
const CLI_PROVIDERS = ['claude', 'opencode', 'codex', 'gemini-cli', 'kimi-cli'];

/** Module-level streaming message tracker for API providers. */
let _apiStreamingMsgId = null;

function createAiStatusStore() {
  let running = $state(false);
  let providerType = $state('');
  let displayName = $state('');
  let error = $state(null);
  let starting = $state(false);

  return {
    get running() { return running; },
    get providerType() { return providerType; },
    get displayName() { return displayName; },
    get error() { return error; },
    get starting() { return starting; },

    /** Whether the current provider is a CLI/PTY provider. */
    get isCliProvider() { return CLI_PROVIDERS.includes(providerType); },

    /** Whether the current provider is an API (HTTP) provider. */
    get isApiProvider() { return !!providerType && !CLI_PROVIDERS.includes(providerType); },

    /** Update status from an event or poll. */
    _setStatus(isRunning, provider, name) {
      running = isRunning;
      if (provider) providerType = provider;
      if (name) displayName = name;
      if (isRunning) {
        error = null;
        starting = false;
      }
    },

    _setError(msg) {
      error = msg;
      starting = false;
    },

    _setStarting() {
      starting = true;
      error = null;
    },
  };
}

export const aiStatusStore = createAiStatusStore();

/** Start the configured AI provider. */
export async function startProvider(opts = {}) {
  const cfg = configStore.value;
  const provider = opts.providerType || cfg?.ai?.provider || 'claude';
  const name = PROVIDER_NAMES[provider] || provider;

  aiStatusStore._setStatus(false, provider, name);
  aiStatusStore._setStarting();

  // Reset streaming state when starting a new provider
  _apiStreamingMsgId = null;

  try {
    const endpoints = cfg?.ai?.endpoints || {};
    const isApi = !CLI_PROVIDERS.includes(provider);

    // For API providers (Ollama, LM Studio, etc.), inject the local LLM
    // system prompt if no custom prompt is configured. CLI providers have
    // their own prompt systems (--append-system-prompt, AGENTS.md, etc.)
    let systemPrompt = opts.systemPrompt || cfg?.ai?.systemPrompt;
    if (!systemPrompt && isApi) {
      systemPrompt = buildLocalLlmInstructions({
        userName: cfg?.user?.name || 'User',
        modelName: opts.model || cfg?.ai?.model,
      });
    }

    const result = await startAI({
      providerType: provider,
      model: opts.model || cfg?.ai?.model,
      baseUrl: opts.baseUrl || endpoints[provider] || cfg?.ai?.baseUrl,
      apiKey: opts.apiKey || cfg?.ai?.apiKeys?.[provider] || cfg?.ai?.apiKey,
      contextLength: opts.contextLength || cfg?.ai?.contextLength,
      systemPrompt,
      cwd: opts.cwd,
      cols: opts.cols || 120,
      rows: opts.rows || 30,
    });

    if (result?.success === false) {
      aiStatusStore._setError(result.error || 'Failed to start provider');
    }
    // Running status will be confirmed by the ai-status-change event
  } catch (err) {
    aiStatusStore._setError(err?.message || String(err));
  }
}

/** Stop the running AI provider. */
export async function stopProvider() {
  _apiStreamingMsgId = null;
  try {
    await stopAI();
    aiStatusStore._setStatus(false, aiStatusStore.providerType, aiStatusStore.displayName);
  } catch (err) {
    console.warn('[ai-status] Stop failed:', err);
  }
}

/**
 * Switch to a different provider (stop current + start new).
 *
 * Unlike startProvider(), this calls set_provider which handles the
 * stop+start atomically in the Rust backend.
 */
export async function switchProvider(providerId, opts = {}) {
  const name = PROVIDER_NAMES[providerId] || providerId;

  aiStatusStore._setStatus(false, providerId, name);
  aiStatusStore._setStarting();
  _apiStreamingMsgId = null;

  try {
    const isApi = !CLI_PROVIDERS.includes(providerId);
    const cfg = configStore.value;

    // Inject local LLM instructions for API providers without a custom prompt
    let systemPrompt = opts.systemPrompt;
    if (!systemPrompt && isApi) {
      systemPrompt = buildLocalLlmInstructions({
        userName: cfg?.user?.name || 'User',
        modelName: opts.model,
      });
    }

    const result = await apiSetProvider(providerId, {
      model: opts.model || undefined,
      baseUrl: opts.baseUrl || undefined,
      apiKey: opts.apiKey || undefined,
      contextLength: opts.contextLength || undefined,
      systemPrompt,
      cwd: opts.cwd || undefined,
      cols: opts.cols || 120,
      rows: opts.rows || 30,
    });

    if (result?.success === false) {
      aiStatusStore._setError(result.error || 'Failed to switch provider');
    }
  } catch (err) {
    aiStatusStore._setError(err?.message || String(err));
  }
}

/** Poll current status from the backend. */
export async function refreshStatus() {
  try {
    const result = await getAIStatus();
    const data = result?.data || result;
    if (data) {
      const name = PROVIDER_NAMES[data.provider] || data.displayName || data.provider || '';
      aiStatusStore._setStatus(!!data.running, data.provider || '', name);
    }
  } catch {
    // Ignore — backend may not be ready yet
  }
}

/** Set up event listeners for AI status changes. Call once on app mount. */
export async function initAiStatusListeners() {
  // Listen for explicit status changes from the Rust forwarding loop
  await listen('ai-status-change', (event) => {
    const data = event.payload;
    if (data.running) {
      aiStatusStore._setStatus(true, aiStatusStore.providerType, aiStatusStore.displayName);
    } else {
      aiStatusStore._setStatus(false, aiStatusStore.providerType, aiStatusStore.displayName);
    }
  });

  await listen('ai-error', (event) => {
    const data = event.payload;
    aiStatusStore._setError(data?.error || 'Unknown error');

    // If we were streaming an API response, finalize and show the error
    if (_apiStreamingMsgId) {
      chatStore.finalizeStreamingMessage();
      _apiStreamingMsgId = null;
    }
    if (aiStatusStore.isApiProvider) {
      chatStore.addMessage('error', data?.error || 'Unknown error');
    }
  });

  // === API provider streaming events → chat store ===

  await listen('ai-stream-token', (event) => {
    const token = event.payload?.token;
    if (!token) return;

    // Start a new streaming message on first token
    if (!_apiStreamingMsgId) {
      _apiStreamingMsgId = chatStore.startStreamingMessage('assistant');
    }
    chatStore.updateStreamingMessage(token);
  });

  await listen('ai-stream-end', () => {
    if (_apiStreamingMsgId) {
      chatStore.finalizeStreamingMessage();
      _apiStreamingMsgId = null;
    }
  });

  await listen('ai-response', (event) => {
    // ai-response fires after ai-stream-end with the full text.
    // If streaming was already finalized, nothing to do.
    // If somehow we missed stream-end, finalize now.
    if (_apiStreamingMsgId) {
      chatStore.finalizeStreamingMessage();
      _apiStreamingMsgId = null;
    }

    // Speak the response via TTS (API providers only — CLI providers
    // speak via the MCP voice_send path in voice.svelte.js).
    const text = event.payload?.text;
    if (text) {
      speakText(text).catch((err) => {
        console.warn('[ai-status] Failed to speak API response:', err);
      });
    }
  });

  await listen('ai-tool-calls', (event) => {
    const calls = event.payload?.calls;
    if (!calls) return;

    // Finalize any in-progress streaming message first
    if (_apiStreamingMsgId) {
      chatStore.finalizeStreamingMessage({ toolCalls: calls.calls || [] });
      _apiStreamingMsgId = null;
    } else {
      // Tool calls without preceding text — add as system message
      const names = (calls.calls || []).map((c) => c.name).join(', ');
      chatStore.addMessage('system', `Tool calls: ${names}`, { toolCalls: calls.calls || [] });
    }
  });

  // Initial status poll
  await refreshStatus();
}
