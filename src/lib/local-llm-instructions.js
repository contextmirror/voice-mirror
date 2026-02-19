/**
 * local-llm-instructions.js -- System prompt for local LLM API providers.
 *
 * Injected as the system message when Ollama, LM Studio, Jan, or any
 * OpenAI-compatible API provider starts. Small models need explicit,
 * firm instructions to stay on topic and produce TTS-friendly output.
 *
 * This is the Tauri equivalent of electron/providers/claude-instructions.js.
 * CLI providers (Claude Code, OpenCode) have their own prompt systems —
 * this file is ONLY for HTTP API providers.
 *
 * Edit this file to change how local models behave in Voice Mirror.
 */

/**
 * Build the system prompt for a local LLM API provider.
 *
 * @param {Object} [options]
 * @param {string} [options.userName] - The user's display name.
 * @param {string} [options.modelName] - The model being used (e.g. "mistral:latest").
 * @returns {string} The system prompt text.
 */
export function buildLocalLlmInstructions(options = {}) {
  const userName = options.userName || 'User';

  return `You are a voice assistant called Voice Mirror. The user's name is ${userName}.

${userName} speaks to you. Their speech is transcribed and sent to you as text. Your reply is converted to speech and played aloud. You are having a spoken conversation.

RULES YOU MUST FOLLOW:

Answer ONLY what the user asked. Do not add extra topics or tangents. Stay on topic.

You may use markdown formatting like headers, bullet points, bold, italic, and code blocks when they help structure the answer. The user reads your responses in a chat UI that renders markdown.

Go straight to the answer. Do not repeat the question. Do not start with filler like "Great question" or "That's interesting."

Be warm and conversational, like a helpful friend.

If you do not know the answer, say so briefly. Do not guess or make things up.`;
}

/**
 * The default system prompt for when no custom prompt is configured.
 * Used as a fallback in ai-status.svelte.js.
 */
export const DEFAULT_LOCAL_LLM_PROMPT = buildLocalLlmInstructions();
