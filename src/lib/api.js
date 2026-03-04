/**
 * api.js -- Wrapper around Tauri invoke for IPC with the Rust backend.
 *
 * Mirrors the Voice Mirror IPC pattern: grouped commands returning
 * { success: boolean, data?: unknown, error?: string }
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

// ============ Window ============

export async function getWindowPosition() {
  return invoke('get_window_position');
}

export async function setWindowPosition(x, y) {
  return invoke('set_window_position', { x, y });
}

export async function minimizeWindow() {
  return invoke('minimize_window');
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

export async function restartVoice() {
  return invoke('restart_voice');
}

export async function ensureSttModel(modelSize) {
  return invoke('ensure_stt_model', { modelSize });
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

export async function aiPtyInput(data, imagePath, imageDataUrl) {
  return invoke('ai_pty_input', { data, imagePath: imagePath || null, imageDataUrl: imageDataUrl || null });
}

export async function aiRawInput(data) {
  return invoke('ai_raw_input', { data });
}

export async function aiPtyResize(cols, rows) {
  return invoke('ai_pty_resize', { cols, rows });
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
export async function writeUserMessage(message, from = null, threadId = null, imagePath = null, imageDataUrl = null) {
  return invoke('write_user_message', { message, from, threadId, imagePath: imagePath || null, imageDataUrl: imageDataUrl || null });
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

export async function unregisterAllShortcuts() {
  return invoke('unregister_all_shortcuts');
}

// ============ Performance Stats ============

export async function getProcessStats() {
  return invoke('get_process_stats');
}

// ============ Config Migration ============

// ============ Lens ============

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

export async function lensSetVisible(visible) {
  return invoke('lens_set_visible', { visible });
}

/** Hard-refresh the lens browser, bypassing all caches. */
export async function lensHardRefresh() {
  return invoke('lens_hard_refresh');
}

/** Clear all browsing data (cache, cookies, localStorage) for the lens browser. */
export async function lensClearCache() {
  return invoke('lens_clear_cache');
}

// ============ Design Overlay ============

/** Send a design overlay command (set_tool, set_color, undo, redo, clear, enable, disable). */
export async function designCommand(action, args = {}) {
  return invoke('design_command', { action, args });
}

/** Get the selected element data from the design overlay. */
export async function designGetElement() {
  return invoke('design_get_element');
}

// ============ Browser Tabs ============

export async function lensCreateTab(tabId, url, x, y, width, height) {
  return invoke('lens_create_tab', { tabId, url, x, y, width, height });
}

export async function lensCloseTab(tabId) {
  return invoke('lens_close_tab', { tabId });
}

export async function lensSwitchTab(tabId) {
  return invoke('lens_switch_tab', { tabId });
}

export async function lensCloseAllTabs() {
  return invoke('lens_close_all_tabs');
}

// ============ Device Preview ============

export async function lensCreateDeviceWebview({ presetId, url, width, height, x, y }) {
  return invoke('lens_create_device_webview', { presetId, url, width, height, x, y });
}

export async function lensCloseDeviceWebview(label) {
  return invoke('lens_close_device_webview', { label });
}

export async function lensCloseAllDeviceWebviews() {
  return invoke('lens_close_all_device_webviews');
}

export async function lensResizeDeviceWebview(label, x, y, width, height) {
  return invoke('lens_resize_device_webview', { label, x, y, width, height });
}

/** Evaluate JS in a device-preview webview (fire-and-forget). Used for sync script injection and replay. */
export async function lensEvalDeviceJs(label, js) {
  return invoke('lens_eval_device_js', { label, js });
}

/** Set CDP device emulation on a device-preview webview (viewport, DPR, user agent, touch). */
export async function lensSetDeviceEmulation(label, { width, height, deviceScaleFactor, mobile, userAgent, scale }) {
  return invoke('lens_set_device_emulation', { label, width, height, deviceScaleFactor, mobile, userAgent, scale: scale ?? null });
}

// ============ Dev Server ============

/**
 * Detect dev server configurations in a project directory.
 * Scans tauri.conf.json, vite.config.*, .env, package.json for framework patterns.
 * @param {string} projectRoot - Absolute path to the project root directory.
 * @returns {Promise<{success: boolean, data?: {servers: Array, packageManager: string}}>}
 */
export async function detectDevServers(projectRoot) {
  return invoke('detect_dev_servers', { projectRoot });
}

/**
 * Check if a specific port is accepting TCP connections on localhost.
 * @param {number} port - Port number to probe.
 * @returns {Promise<{success: boolean, data?: {listening: boolean}}>}
 */
export async function probePort(port) {
  return invoke('probe_port', { port });
}

/**
 * Kill the process listening on a specific port.
 * @param {number} port - Port number to kill.
 * @returns {Promise<{success: boolean, data?: {killed: boolean}}>}
 */
export async function killPortProcess(port) {
  return invoke('kill_port_process', { port });
}

// ============ GPU / Model Management ============

export async function detectGpu() {
  return invoke('detect_gpu');
}

export async function listSttModels() {
  return invoke('list_stt_models');
}

export async function deleteSttModel(modelSize) {
  return invoke('delete_stt_model', { modelSize });
}

// ============ Files ============

export async function listDirectory(path, root) {
  return invoke('list_directory', { path: path || null, root: root || null });
}

export async function getGitChanges(root) {
  return invoke('get_git_changes', { root: root || null });
}

export async function readFile(path, root) {
  return invoke('read_file', { path, root: root || null });
}

export async function readExternalFile(path) {
  return invoke('read_external_file', { path });
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

export async function gitStage(paths, root) { return invoke('git_stage', { paths, root: root || null }); }
export async function gitUnstage(paths, root) { return invoke('git_unstage', { paths, root: root || null }); }
export async function gitStageAll(root) { return invoke('git_stage_all', { root: root || null }); }
export async function gitUnstageAll(root) { return invoke('git_unstage_all', { root: root || null }); }
export async function gitCommit(message, root) { return invoke('git_commit', { message, root: root || null }); }
export async function gitDiscard(paths, root) { return invoke('git_discard', { paths, root: root || null }); }
export async function gitPush(root) { return invoke('git_push', { root: root || null }); }
export async function gitAheadBehind(root) { return invoke('git_ahead_behind', { root: root || null }); }
export async function gitFetch(root) { return invoke('git_fetch', { root: root || null }); }
export async function gitPull(rebase, root) { return invoke('git_pull', { rebase: rebase || false, root: root || null }); }
export async function gitForcePush(root) { return invoke('git_force_push', { root: root || null }); }
export async function gitListBranches(root) { return invoke('git_list_branches', { root: root || null }); }
export async function gitCheckoutBranch(branch, root) { return invoke('git_checkout_branch', { branch, root: root || null }); }
export async function gitStashSave(message, root) { return invoke('git_stash_save', { message: message || null, root: root || null }); }
export async function gitStashList(root) { return invoke('git_stash_list', { root: root || null }); }
export async function gitStashPop(index, root) { return invoke('git_stash_pop', { index: index ?? null, root: root || null }); }
export async function gitStashApply(index, root) { return invoke('git_stash_apply', { index: index ?? null, root: root || null }); }
export async function gitStashDrop(index, root) { return invoke('git_stash_drop', { index, root: root || null }); }
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

/**
 * Search file contents across the project using regex.
 * Results are grouped by file with line number, column range, and text.
 * @param {string} query - Search query (plain text or regex).
 * @param {Object} [options] - Search options.
 * @param {string} [options.root] - Project root override.
 * @param {boolean} [options.caseSensitive] - Case-sensitive search.
 * @param {boolean} [options.isRegex] - Treat query as regex.
 * @param {boolean} [options.wholeWord] - Match whole words only.
 * @param {string} [options.includePattern] - Comma-separated include globs.
 * @param {string} [options.excludePattern] - Comma-separated exclude globs.
 * @returns {Promise<{success: boolean, data?: {matches: Array, totalMatches: number, truncated: boolean}, error?: string}>}
 */
export async function searchContent(query, options = {}) {
  return invoke('search_content', {
    query,
    root: options.root || null,
    caseSensitive: options.caseSensitive || null,
    isRegex: options.isRegex || null,
    wholeWord: options.wholeWord || null,
    includePattern: options.includePattern || null,
    excludePattern: options.excludePattern || null,
  });
}

export async function startFileWatching(projectRoot) {
  return invoke('start_file_watching', { projectRoot });
}

export async function stopFileWatching() {
  return invoke('stop_file_watching');
}

// ============ Terminal ============

/**
 * Spawn a new terminal session.
 * @param {Object} [options]
 * @param {number} [options.cols] - Terminal columns.
 * @param {number} [options.rows] - Terminal rows.
 * @param {string} [options.cwd] - Working directory.
 * @param {string} [options.profileId] - Terminal profile ID (shell).
 * @returns {Promise<Object>}
 */
export async function terminalSpawn(options = {}) {
  return invoke('terminal_spawn', {
    cols: options.cols || null,
    rows: options.rows || null,
    cwd: options.cwd || null,
    profileId: options.profileId || null,
    outputChannel: options.outputChannel || null,
  });
}

/**
 * Send raw input to a terminal session.
 * @param {string} id - Terminal session ID.
 * @param {string} data - Raw input data.
 * @returns {Promise<Object>}
 */
export async function terminalInput(id, data) {
  return invoke('terminal_input', { id, data });
}

/**
 * Resize a terminal session's PTY.
 * @param {string} id - Terminal session ID.
 * @param {number} cols - New column count.
 * @param {number} rows - New row count.
 * @returns {Promise<Object>}
 */
export async function terminalResize(id, cols, rows) {
  return invoke('terminal_resize', { id, cols, rows });
}

/**
 * Kill a terminal session.
 * @param {string} id - Terminal session ID.
 * @returns {Promise<Object>}
 */
export async function terminalKill(id) {
  return invoke('terminal_kill', { id });
}

/**
 * Detect available terminal profiles (shells) on the system.
 * Returns { success: boolean, data?: TerminalProfile[] }
 * where TerminalProfile has { id, name, path, args, icon, color, is_default, is_builtin }.
 * @returns {Promise<Object>}
 */
export async function terminalDetectProfiles() {
  return invoke('terminal_detect_profiles');
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

export async function lspRequestSignatureHelp(path, line, character, projectRoot) {
  return invoke('lsp_request_signature_help', { path, line, character, projectRoot });
}

export async function lspRequestDefinition(path, line, character, projectRoot) {
  return invoke('lsp_request_definition', { path, line, character, projectRoot });
}

export async function lspRequestTypeDefinition(path, line, character, projectRoot) {
  return invoke('lsp_request_type_definition', { path, line, character, projectRoot });
}

export async function lspRequestDeclaration(path, line, character, projectRoot) {
  return invoke('lsp_request_declaration', { path, line, character, projectRoot });
}

export async function lspRequestImplementation(path, line, character, projectRoot) {
  return invoke('lsp_request_implementation', { path, line, character, projectRoot });
}

export async function lspGetStatus() {
  return invoke('lsp_get_status');
}

export async function lspRequestDocumentSymbols(path, projectRoot) {
  return invoke('lsp_request_document_symbols', { path, projectRoot });
}

export async function lspRequestReferences(path, line, character, projectRoot) {
  return invoke('lsp_request_references', { path, line, character, projectRoot });
}

export async function lspRequestWorkspaceSymbols(query, langId, projectRoot) {
  return invoke('lsp_request_workspace_symbols', { query, langId, projectRoot });
}

export async function lspRequestDocumentHighlight(path, line, character, projectRoot) {
  return invoke('lsp_request_document_highlight', { path, line, character, projectRoot });
}

export async function lspRequestInlayHints(path, startLine, endLine, projectRoot) {
  return invoke('lsp_request_inlay_hints', { path, startLine, endLine, projectRoot });
}

export async function lspRequestCodeActions(path, rangeStartLine, rangeStartChar, rangeEndLine, rangeEndChar, diagnostics, projectRoot) {
  return invoke('lsp_request_code_actions', { path, rangeStartLine, rangeStartChar, rangeEndLine, rangeEndChar, diagnostics, projectRoot });
}

export async function lspPrepareRename(path, line, character, projectRoot) {
  return invoke('lsp_prepare_rename', { path, line, character, projectRoot });
}

export async function lspRename(path, line, character, newName, projectRoot) {
  return invoke('lsp_rename', { path, line, character, newName, projectRoot });
}

export async function lspApplyWorkspaceEdit(edits, projectRoot) {
  return invoke('lsp_apply_workspace_edit', { edits, projectRoot });
}

export async function lspRequestFormatting(path, tabSize, insertSpaces, projectRoot) {
  return invoke('lsp_request_formatting', { path, tabSize, insertSpaces, projectRoot });
}

export async function lspRequestRangeFormatting(path, rangeStartLine, rangeStartChar, rangeEndLine, rangeEndChar, tabSize, insertSpaces, projectRoot) {
  return invoke('lsp_request_range_formatting', { path, rangeStartLine, rangeStartChar, rangeEndLine, rangeEndChar, tabSize, insertSpaces, projectRoot });
}

export async function lspRequestOnTypeFormatting(path, line, character, triggerChar, tabSize, insertSpaces, projectRoot) {
  return invoke('lsp_request_on_type_formatting', { path, line, character, triggerChar, tabSize, insertSpaces, projectRoot });
}

export async function lspRequestLinkedEditingRange(path, line, character, projectRoot) {
  return invoke('lsp_request_linked_editing_range', { path, line, character, projectRoot });
}

export async function lspRequestCodeLens(path, projectRoot) {
  return invoke('lsp_request_code_lens', { path, projectRoot });
}

export async function lspRequestSemanticTokensFull(path, projectRoot) {
  return invoke('lsp_request_semantic_tokens_full', { path, projectRoot });
}

export async function lspRequestDocumentColors(path, projectRoot) {
  return invoke('lsp_request_document_colors', { path, projectRoot });
}

export async function lspRequestFoldingRanges(path, projectRoot) {
  return invoke('lsp_request_folding_ranges', { path, projectRoot });
}

export async function lspResolveCompletionItem(item, langId, projectRoot) {
  return invoke('lsp_resolve_completion_item', { item, langId, projectRoot });
}

export async function lspRequestDiagnostics(path, projectRoot) {
  return invoke('lsp_request_diagnostics', { path, projectRoot });
}

export async function lspScanProject(langId, projectRoot) {
  return invoke('lsp_scan_project', { langId, projectRoot });
}

// ============ LSP Server Management ============

export async function lspGetServerList() {
  return invoke('lsp_get_server_list');
}

export async function lspInstallServer(serverId) {
  return invoke('lsp_install_server', { serverId });
}

export async function lspSetServerEnabled(serverId, enabled) {
  return invoke('lsp_set_server_enabled', { serverId, enabled });
}

export async function lspRestartServer(langId, projectRoot) {
  return invoke('lsp_restart_server', { langId, projectRoot });
}

export async function lspGetServerDetail(langId, projectRoot) {
  return invoke('lsp_get_server_detail', { langId, projectRoot });
}

export async function lspShutdown() {
  return invoke('lsp_shutdown');
}

// ============ Project Output Channels ============

export async function registerProjectChannel(label, projectPath, framework, port) {
  return invoke('register_project_channel', { params: { label, projectPath, framework: framework || null, port: port || null } });
}

export async function unregisterProjectChannel(label) {
  return invoke('unregister_project_channel', { params: { label } });
}

export async function pushProjectLog(label, level, message) {
  return invoke('push_project_log', { params: { label, level, message } });
}

export async function listProjectChannels() {
  return invoke('list_project_channels');
}

// ============ Output / Diagnostics ============

export async function getOutputLogs(params) {
  return invoke('get_output_logs', { params });
}

export async function logFrontendError(params) {
  return invoke('log_frontend_error', { params });
}
