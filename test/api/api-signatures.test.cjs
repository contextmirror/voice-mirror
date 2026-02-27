/**
 * api-signatures.test.js -- Source-inspection tests for tauri/src/lib/api.js
 *
 * Verifies all invoke() commands and exported async functions exist.
 * This file is read as text since it imports from @tauri-apps/api/core
 * which is not available in plain Node.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- Tauri invoke import', () => {
  it('imports invoke from @tauri-apps/api/core', () => {
    assert.ok(
      src.includes("from '@tauri-apps/api/core'"),
      'Should import from @tauri-apps/api/core'
    );
  });

  it('imports the invoke function', () => {
    assert.ok(
      src.includes('import { invoke }'),
      'Should import invoke'
    );
  });
});

describe('api.js -- invoke command count', () => {
  it('has at least 100 invoke() calls', () => {
    const invokeMatches = src.match(/invoke\(\s*'/g);
    assert.ok(invokeMatches, 'Should have invoke() calls');
    assert.ok(
      invokeMatches.length >= 100,
      `Expected at least 100 invoke() calls, found ${invokeMatches.length}`
    );
  });
});

describe('api.js -- critical Tauri command names', () => {
  const criticalCommands = [
    // Config
    'get_config',
    'set_config',
    'reset_config',
    // Window
    'get_window_position',
    'set_window_position',
    'minimize_window',
    'set_window_size',
    'set_always_on_top',
    'set_resizable',
    'show_window',
    // Voice
    'start_voice',
    'stop_voice',
    'get_voice_status',
    'set_voice_mode',
    'list_audio_devices',
    'speak_text',
    'ptt_press',
    'ptt_release',
    'configure_ptt_key',
    'configure_dictation_key',
    // AI
    'start_ai',
    'stop_ai',
    'get_ai_status',
    'ai_pty_input',
    'ai_raw_input',
    'ai_pty_resize',
    'send_voice_loop',
    'scan_providers',
    'set_provider',
    'list_models',
    // Inbox / Messaging
    'write_user_message',
    // Chat
    'chat_list',
    'chat_load',
    'chat_save',
    'chat_delete',
    'chat_rename',
    'export_chat_to_file',
    // Screenshot
    'list_monitors',
    'list_windows',
    'capture_monitor',
    'capture_window',
    // Tools
    'check_npm_versions',
    'update_npm_package',
    // Shortcuts
    'register_shortcut',
    'unregister_shortcut',
    'unregister_all_shortcuts',
    // Lens
    'lens_navigate',
    'lens_go_back',
    'lens_go_forward',
    'lens_reload',
    'lens_resize_webview',
    'lens_set_visible',
    'lens_hard_refresh',
    'lens_clear_cache',
    // Browser Tabs
    'lens_create_tab',
    'lens_close_tab',
    'lens_switch_tab',
    'lens_close_all_tabs',
    // GPU / Model Management
    'detect_gpu',
    'list_stt_models',
    'delete_stt_model',
    // Design Overlay
    'design_get_element',
    // Dev Server
    'detect_dev_servers',
    'probe_port',
    // Files
    'list_directory',
    'get_git_changes',
    'read_file',
    'write_file',
    'create_file',
    'create_directory',
    'rename_entry',
    'delete_entry',
    'reveal_in_explorer',
    'search_files',
    'search_content',
    // Git
    'git_stage',
    'git_unstage',
    'git_stage_all',
    'git_unstage_all',
    'git_commit',
    'git_discard',
    'git_push',
    // Terminal profiles
    'terminal_detect_profiles',
    // LSP
    'lsp_request_formatting',
    'lsp_request_range_formatting',
    'lsp_request_signature_help',
  ];

  for (const cmd of criticalCommands) {
    it(`invokes "${cmd}"`, () => {
      assert.ok(
        src.includes(`invoke('${cmd}'`),
        `Should call invoke('${cmd}')`
      );
    });
  }
});

describe('api.js -- exported async functions', () => {
  const expectedExports = [
    // Config
    'getConfig',
    'setConfig',
    'resetConfig',
    // Window
    'getWindowPosition',
    'setWindowPosition',
    'minimizeWindow',
    'setWindowSize',
    'setAlwaysOnTop',
    'setResizable',
    'showWindow',
    // Voice
    'startVoice',
    'stopVoice',
    'restartVoice',
    'ensureSttModel',
    'getVoiceStatus',
    'setVoiceMode',
    'listAudioDevices',
    'speakText',
    'pttPress',
    'pttRelease',
    'configurePttKey',
    'configureDictationKey',
    'injectText',
    // AI
    'startAI',
    'stopAI',
    'getAIStatus',
    'aiPtyInput',
    'aiRawInput',
    'aiPtyResize',
    'sendVoiceLoop',
    'scanProviders',
    'setProvider',
    'listModels',
    // Messaging
    'writeUserMessage',
    // Chat
    'chatList',
    'chatLoad',
    'chatSave',
    'chatDelete',
    'chatRename',
    'exportChatToFile',
    // Screenshot
    'listMonitors',
    'listWindows',
    'captureMonitor',
    'captureWindow',
    'lensCapturePreview',
    // Tools
    'checkNpmVersions',
    'updateNpmPackage',
    // Shortcuts
    'registerShortcut',
    'unregisterShortcut',
    'unregisterAllShortcuts',
    // Performance Stats
    'getProcessStats',
    // Migration
    // Lens
    'lensNavigate',
    'lensGoBack',
    'lensGoForward',
    'lensReload',
    'lensResizeWebview',
    'lensSetVisible',
    'lensHardRefresh',
    'lensClearCache',
    // Design Overlay
    'designCommand',
    'designGetElement',
    // Browser Tabs
    'lensCreateTab',
    'lensCloseTab',
    'lensSwitchTab',
    'lensCloseAllTabs',
    // GPU / Model Management
    'detectGpu',
    'listSttModels',
    'deleteSttModel',
    // Dev Server
    'detectDevServers',
    'probePort',
    'killPortProcess',
    // Files
    'listDirectory',
    'getGitChanges',
    'readFile',
    'readExternalFile',
    'writeFile',
    'getFileGitContent',
    'createFile',
    'createDirectory',
    'renameEntry',
    'deleteEntry',
    'revealInExplorer',
    'searchFiles',
    'searchContent',
    'startFileWatching',
    'stopFileWatching',
    // Git
    'gitStage',
    'gitUnstage',
    'gitStageAll',
    'gitUnstageAll',
    'gitCommit',
    'gitDiscard',
    'gitPush',
    // Terminals
    'terminalSpawn',
    'terminalInput',
    'terminalResize',
    'terminalKill',
    'terminalDetectProfiles',
    // LSP
    'lspOpenFile',
    'lspCloseFile',
    'lspChangeFile',
    'lspSaveFile',
    'lspRequestCompletion',
    'lspRequestHover',
    'lspRequestDefinition',
    'lspGetStatus',
    'lspRequestDocumentSymbols',
    'lspRequestReferences',
    'lspRequestCodeActions',
    'lspPrepareRename',
    'lspRename',
    'lspApplyWorkspaceEdit',
    'lspRequestFormatting',
    'lspRequestRangeFormatting',
    'lspRequestSignatureHelp',
    'getOutputLogs',
  ];

  for (const fn of expectedExports) {
    it(`exports async function ${fn}()`, () => {
      assert.ok(
        src.includes(`export async function ${fn}(`),
        `Should export async function ${fn}()`
      );
    });
  }

  it('exports the correct number of functions', () => {
    const exportMatches = src.match(/export async function \w+\(/g);
    assert.ok(exportMatches, 'Should have exported async functions');
    assert.equal(
      exportMatches.length,
      expectedExports.length,
      `Expected ${expectedExports.length} exported functions, found ${exportMatches.length}`
    );
  });
});

describe('api.js -- section organization', () => {
  const sections = ['Config', 'Window', 'Voice', 'AI', 'Inbox', 'Chat', 'Screenshot', 'Tools', 'Shortcuts', 'Performance Stats', 'Config Migration', 'Design Overlay', 'Lens', 'Browser Tabs', 'Dev Server', 'GPU / Model Management', 'Files', 'Terminal', 'LSP', 'Output / Diagnostics'];

  for (const section of sections) {
    it(`has "${section}" section comment`, () => {
      assert.ok(
        src.includes(`// ============ ${section}`),
        `Should have organized "${section}" section`
      );
    });
  }
});

describe('api.js -- parameter passing', () => {
  it('setConfig passes patch parameter', () => {
    assert.ok(
      src.includes("invoke('set_config', { patch })"),
      'setConfig should pass patch to invoke'
    );
  });

  it('setWindowPosition passes x, y', () => {
    assert.ok(
      src.includes("invoke('set_window_position', { x, y })"),
      'setWindowPosition should pass x, y'
    );
  });

  it('writeUserMessage passes message, from, threadId, imagePath', () => {
    assert.ok(
      src.includes("invoke('write_user_message', { message, from, threadId, imagePath:"),
      'writeUserMessage should pass message, from, threadId, imagePath'
    );
  });

  it('aiPtyInput passes data and optional imagePath', () => {
    assert.ok(
      src.includes("invoke('ai_pty_input', { data, imagePath:"),
      'aiPtyInput should pass data and imagePath'
    );
  });

  it('aiPtyInput passes imageDataUrl parameter', () => {
    assert.ok(
      src.includes("invoke('ai_pty_input', { data, imagePath:") && src.includes('imageDataUrl'),
      'aiPtyInput should pass imageDataUrl'
    );
  });

  it('writeUserMessage passes imageDataUrl parameter', () => {
    const fn = src.substring(src.indexOf('export async function writeUserMessage'));
    assert.ok(fn.includes('imageDataUrl'), 'writeUserMessage should accept imageDataUrl');
  });

  it('chatLoad passes id', () => {
    assert.ok(
      src.includes("invoke('chat_load', { id })"),
      'chatLoad should pass id'
    );
  });

  it('setProvider passes providerId and options', () => {
    assert.ok(
      src.includes("invoke('set_provider',"),
      'setProvider should invoke set_provider'
    );
    assert.ok(
      src.includes('providerId'),
      'setProvider should pass providerId'
    );
  });

  it('listModels passes providerType and optional baseUrl', () => {
    assert.ok(
      src.includes("invoke('list_models',"),
      'listModels should invoke list_models'
    );
    assert.ok(
      src.includes('providerType'),
      'listModels should accept providerType'
    );
  });
});
