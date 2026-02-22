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

/**
 * Show the main window.
 * Called after Svelte mounts and sets the correct mode (overlay vs dashboard)
 * to prevent a flash of wrong content on startup.
 */
export async function showWindow() {
  return invoke('show_window');
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

export async function aiPtyInput(data, imagePath) {
  return invoke('ai_pty_input', { data, imagePath: imagePath || null });
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
 * @returns {Promise<{ success: boolean, data?: { online: boolean, models: string[], default: string } }>}
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
 * @param {string} [imagePath] - Optional screenshot file path for multimodal messages
 */
export async function writeUserMessage(message, from, threadId, imagePath) {
  return invoke('write_user_message', { message, from, threadId, imagePath: imagePath || null });
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

/** Capture the Lens browser webview content. Returns { path, thumbnail, dataUrl }. */
export async function lensCapturePreview() {
  return invoke('lens_capture_browser');
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

// ============ Lens ============

export async function lensCreateWebview(url, x, y, width, height) {
  return invoke('lens_create_webview', { url, x, y, width, height });
}

export async function lensNavigate(url) {
  return invoke('lens_navigate', { url });
}

export async function lensGoBack() {
  return invoke('lens_go_back');
}

export async function lensGoForward() {
  return invoke('lens_go_forward');
}

export async function lensReload() {
  return invoke('lens_reload');
}

export async function lensResizeWebview(x, y, width, height) {
  return invoke('lens_resize_webview', { x, y, width, height });
}

export async function lensCloseWebview() {
  return invoke('lens_close_webview');
}

export async function lensSetVisible(visible) {
  return invoke('lens_set_visible', { visible });
}

// ============ Files ============

export async function listDirectory(path, root) {
  return invoke('list_directory', { path: path || null, root: root || null });
}

export async function getGitChanges(root) {
  return invoke('get_git_changes', { root: root || null });
}

export async function getProjectRoot() {
  return invoke('get_project_root');
}

export async function readFile(path, root) {
  return invoke('read_file', { path, root: root || null });
}

export async function writeFile(path, content, root) {
  return invoke('write_file', { path, content, root: root || null });
}

/**
 * Get the HEAD (committed) version of a file's content from git.
 * Returns { content, path, isNew } for text files, { binary, path } for binary.
 * For new/untracked files, content is "" and isNew is true.
 * @param {string} path - File path relative to project root
 * @param {string} [root] - Optional project root override
 */
export async function getFileGitContent(path, root) {
  return invoke('get_file_git_content', { path, root: root || null });
}

/**
 * Create a new file with optional content.
 * Errors if the file already exists. Creates parent directories as needed.
 * @param {string} path - File path relative to project root
 * @param {string} [content] - Optional initial content
 * @param {string} [root] - Optional project root override
 */
export async function createFile(path, content, root) {
  return invoke('create_file', { path, content: content || null, root: root || null });
}

/**
 * Create a new directory (including parents).
 * Errors if the directory already exists.
 * @param {string} path - Directory path relative to project root
 * @param {string} [root] - Optional project root override
 */
export async function createDirectory(path, root) {
  return invoke('create_directory', { path, root: root || null });
}

/**
 * Rename (move) a file or directory within the project root.
 * @param {string} oldPath - Current path relative to project root
 * @param {string} newPath - New path relative to project root
 * @param {string} [root] - Optional project root override
 */
export async function renameEntry(oldPath, newPath, root) {
  return invoke('rename_entry', { oldPath, newPath, root: root || null });
}

/**
 * Delete a file or directory by moving it to the OS trash.
 * Falls back to permanent delete if trash is unavailable.
 * @param {string} path - Path relative to project root
 * @param {string} [root] - Optional project root override
 */
export async function deleteEntry(path, root) {
  return invoke('delete_entry', { path, root: root || null });
}

/**
 * Reveal a file or directory in the system file explorer.
 * @param {string} path - Path relative to project root
 * @param {string} [root] - Optional project root override
 */
export async function revealInExplorer(path, root) {
  return invoke('reveal_in_explorer', { path, root: root || null });
}

/**
 * Recursively list all files in the project (respects .gitignore).
 * Returns an array of relative file paths.
 * @param {string} [root] - Project root override.
 * @returns {Promise<{success: boolean, data?: string[], error?: string}>}
 */
export async function searchFiles(root) {
  return invoke('search_files', { root: root || null });
}

export async function startFileWatching(projectRoot) {
  return invoke('start_file_watching', { projectRoot });
}

export async function stopFileWatching() {
  return invoke('stop_file_watching');
}

// ============ Shell Terminals ============

/**
 * Spawn a new shell terminal session.
 * @param {Object} [options]
 * @param {number} [options.cols] - Terminal columns.
 * @param {number} [options.rows] - Terminal rows.
 * @param {string} [options.cwd] - Working directory.
 * @returns {Promise<Object>}
 */
export async function shellSpawn(options = {}) {
  return invoke('shell_spawn', {
    cols: options.cols || null,
    rows: options.rows || null,
    cwd: options.cwd || null,
  });
}

/**
 * Send raw input to a shell terminal session.
 * @param {string} id - Shell session ID.
 * @param {string} data - Raw input data.
 * @returns {Promise<Object>}
 */
export async function shellInput(id, data) {
  return invoke('shell_input', { id, data });
}

/**
 * Resize a shell terminal session's PTY.
 * @param {string} id - Shell session ID.
 * @param {number} cols - New column count.
 * @param {number} rows - New row count.
 * @returns {Promise<Object>}
 */
export async function shellResize(id, cols, rows) {
  return invoke('shell_resize', { id, cols, rows });
}

/**
 * Kill a shell terminal session.
 * @param {string} id - Shell session ID.
 * @returns {Promise<Object>}
 */
export async function shellKill(id) {
  return invoke('shell_kill', { id });
}

/**
 * List active shell terminal sessions.
 * @returns {Promise<Object>}
 */
export async function shellList() {
  return invoke('shell_list');
}

// ============ LSP ============

export async function lspOpenFile(path, content, projectRoot) {
  return invoke('lsp_open_file', { path, content, projectRoot });
}

export async function lspCloseFile(path, projectRoot) {
  return invoke('lsp_close_file', { path, projectRoot });
}

export async function lspChangeFile(path, content, version, projectRoot) {
  return invoke('lsp_change_file', { path, content, version, projectRoot });
}

export async function lspSaveFile(path, content, projectRoot) {
  return invoke('lsp_save_file', { path, content, projectRoot });
}

export async function lspRequestCompletion(path, line, character, projectRoot) {
  return invoke('lsp_request_completion', { path, line, character, projectRoot });
}

export async function lspRequestHover(path, line, character, projectRoot) {
  return invoke('lsp_request_hover', { path, line, character, projectRoot });
}

export async function lspRequestDefinition(path, line, character, projectRoot) {
  return invoke('lsp_request_definition', { path, line, character, projectRoot });
}

export async function lspGetStatus() {
  return invoke('lsp_get_status');
}

export async function lspShutdown() {
  return invoke('lsp_shutdown');
}
