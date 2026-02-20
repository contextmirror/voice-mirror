/**
 * api.js -- Wrapper around Tauri invoke for IPC with the Rust backend.
 *
 * Mirrors the Voice Mirror IPC pattern: grouped commands returning
 * { success: boolean, data?: any, error?: string }
 *
 * Every Rust #[tauri::command] should have a corresponding wrapper here
 * so that frontend code never calls invoke() directly.
 */

import { invoke } from '@tauri-apps/api/core';

// ============ Config ============

export async function getConfig() {
  return invoke('get_config');
}

export async function setConfig(patch) {
  return invoke('set_config', { patch });
}

export async function resetConfig() {
  return invoke('reset_config');
}

export async function getPlatformInfo() {
  return invoke('get_platform_info');
}

// ============ Window ============

export async function getWindowPosition() {
  return invoke('get_window_position');
}

export async function setWindowPosition(x, y) {
  return invoke('set_window_position', { x, y });
}

export async function saveWindowBounds() {
  return invoke('save_window_bounds');
}

export async function minimizeWindow() {
  return invoke('minimize_window');
}

export async function maximizeWindow() {
  return invoke('maximize_window');
}

export async function quitApp() {
  return invoke('quit_app');
}

export async function setWindowSize(width, height) {
  return invoke('set_window_size', { width, height });
}

export async function setAlwaysOnTop(value) {
  return invoke('set_always_on_top', { value });
}

export async function setResizable(value) {
  return invoke('set_resizable', { value });
}

// ============ Voice ============

export async function startVoice() {
  return invoke('start_voice');
}

export async function stopVoice() {
  return invoke('stop_voice');
}

export async function getVoiceStatus() {
  return invoke('get_voice_status');
}

export async function setVoiceMode(mode) {
  return invoke('set_voice_mode', { mode });
}

export async function listAudioDevices() {
  return invoke('list_audio_devices');
}

export async function stopSpeaking() {
  return invoke('stop_speaking');
}

export async function speakText(text) {
  return invoke('speak_text', { text });
}

export async function pttPress() {
  return invoke('ptt_press');
}

export async function pttRelease() {
  return invoke('ptt_release');
}

/**
 * Configure the PTT key binding in the native input hook.
 * Formats: "kb:52" (keyboard vkey), "mouse:4" (mouse button), "MouseButton4" (legacy)
 */
export async function configurePttKey(keySpec) {
  return invoke('configure_ptt_key', { keySpec });
}

/**
 * Configure the dictation key binding in the native input hook.
 * Same format as configurePttKey.
 */
export async function configureDictationKey(keySpec) {
  return invoke('configure_dictation_key', { keySpec });
}

/**
 * Inject text into the currently focused field via clipboard + Ctrl+V.
 * Used by dictation: transcribed speech → paste into active app.
 */
export async function injectText(text) {
  return invoke('inject_text', { text });
}

// ============ AI ============

/**
 * Start the AI provider.
 *
 * @param {Object} [options] - Optional provider configuration.
 * @param {string} [options.providerType] - Provider ID (e.g. "claude", "ollama").
 * @param {string} [options.model] - Model name/identifier.
 * @param {string} [options.baseUrl] - API base URL (for API providers).
 * @param {string} [options.apiKey] - API key (for API providers).
 * @param {number} [options.contextLength] - Context window size.
 * @param {string} [options.systemPrompt] - System prompt text.
 * @param {string} [options.cwd] - Working directory for CLI providers.
 * @param {number} [options.cols] - Terminal columns (default: 120).
 * @param {number} [options.rows] - Terminal rows (default: 30).
 */
export async function startAI(options = {}) {
  return invoke('start_ai', {
    providerType: options.providerType,
    model: options.model,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    contextLength: options.contextLength,
    systemPrompt: options.systemPrompt,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
  });
}

export async function stopAI() {
  return invoke('stop_ai');
}

export async function getAIStatus() {
  return invoke('get_ai_status');
}

export async function aiPtyInput(data) {
  return invoke('ai_pty_input', { data });
}

export async function aiRawInput(data) {
  return invoke('ai_raw_input', { data });
}

export async function aiPtyResize(cols, rows) {
  return invoke('ai_pty_resize', { cols, rows });
}

export async function interruptAi() {
  return invoke('interrupt_ai');
}

export async function sendVoiceLoop(senderName) {
  return invoke('send_voice_loop', { senderName });
}

export async function scanProviders() {
  return invoke('scan_providers');
}

/**
 * Switch to a different AI provider.
 *
 * @param {string} providerId - Provider identifier (e.g. "claude", "ollama").
 * @param {Object} [options] - Optional provider configuration.
 * @param {string} [options.model] - Model name/identifier.
 * @param {string} [options.baseUrl] - API base URL.
 * @param {string} [options.apiKey] - API key.
 * @param {number} [options.contextLength] - Context window size.
 * @param {string} [options.systemPrompt] - System prompt text.
 * @param {string} [options.cwd] - Working directory for CLI providers.
 * @param {number} [options.cols] - Terminal columns.
 * @param {number} [options.rows] - Terminal rows.
 */
export async function setProvider(providerId, options = {}) {
  return invoke('set_provider', {
    providerId,
    model: options.model,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    contextLength: options.contextLength,
    systemPrompt: options.systemPrompt,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
  });
}

export async function getProvider() {
  return invoke('get_provider');
}

/**
 * Fetch available models from a local LLM server.
 *
 * Calls the provider's /v1/models endpoint and returns the model list
 * with embedding models filtered out.
 *
 * @param {string} providerType - Provider ID (e.g. "ollama", "lmstudio").
 * @param {string} [baseUrl] - Custom base URL (uses default if omitted).
 * @returns {{ success: boolean, data?: { online: boolean, models: string[], default: string } }}
 */
export async function listModels(providerType, baseUrl) {
  return invoke('list_models', {
    providerType,
    baseUrl: baseUrl || undefined,
  });
}

// ============ Inbox / Messaging ============

/**
 * Write a user message to the MCP inbox file.
 *
 * This is how chat input reaches the AI provider — the message goes into
 * inbox.json, and the AI reads it via `voice_listen`.
 *
 * @param {string} message - The message text
 * @param {string} [from] - Sender name (defaults to config user name)
 * @param {string} [threadId] - Thread ID (defaults to "voice-mirror")
 */
export async function writeUserMessage(message, from, threadId) {
  return invoke('write_user_message', { message, from, threadId });
}

// ============ Chat ============

export async function chatList() {
  return invoke('chat_list');
}

export async function chatLoad(id) {
  return invoke('chat_load', { id });
}

export async function chatSave(chat) {
  return invoke('chat_save', { chat: JSON.stringify(chat) });
}

export async function chatDelete(id) {
  return invoke('chat_delete', { id });
}

export async function chatRename(id, name) {
  return invoke('chat_rename', { id, name });
}

export async function exportChatToFile(path, content) {
  return invoke('export_chat_to_file', { path, content });
}

// ============ Screenshot ============

export async function takeScreenshot() {
  return invoke('take_screenshot');
}

export async function listMonitors() {
  return invoke('list_monitors');
}

export async function listWindows() {
  return invoke('list_windows');
}

export async function captureMonitor(index) {
  return invoke('capture_monitor', { index });
}

export async function captureWindow(hwnd) {
  return invoke('capture_window', { hwnd });
}

// ============ Tools ============

/**
 * Scan for CLI tools the app depends on.
 * Returns an array of { name, available, version, path } objects.
 */
export async function scanCliTools() {
  return invoke('scan_cli_tools');
}

/**
 * Check npm package versions (installed vs latest) and system tool status.
 * Returns { npm: { ghosttyWeb, opencode, claudeCode }, system: { node, ollama, ffmpeg } }
 */
export async function checkNpmVersions() {
  return invoke('check_npm_versions');
}

/**
 * Update (install) a global npm package to latest.
 * Only whitelisted packages are allowed: ghostty-web, opencode, @anthropic-ai/claude-code
 */
export async function updateNpmPackage(pkg) {
  return invoke('update_npm_package', { package: pkg });
}

// ============ Shortcuts ============

export async function registerShortcut(id, keys) {
  return invoke('register_shortcut', { id, keys });
}

export async function unregisterShortcut(id) {
  return invoke('unregister_shortcut', { id });
}

export async function listShortcuts() {
  return invoke('list_shortcuts');
}

export async function unregisterAllShortcuts() {
  return invoke('unregister_all_shortcuts');
}

// ============ Performance Stats ============

export async function getProcessStats() {
  return invoke('get_process_stats');
}

// ============ Config Migration ============

/**
 * Attempt to migrate settings from the old Electron app.
 * Returns the migrated config if an old config was found,
 * or null/empty if nothing to migrate.
 */
export async function migrateElectronConfig() {
  return invoke('migrate_electron_config');
}
