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
  it('has at least 35 invoke() calls', () => {
    const invokeMatches = src.match(/invoke\(\s*'/g);
    assert.ok(invokeMatches, 'Should have invoke() calls');
    assert.ok(
      invokeMatches.length >= 35,
      `Expected at least 35 invoke() calls, found ${invokeMatches.length}`
    );
  });
});

describe('api.js -- critical Tauri command names', () => {
  const criticalCommands = [
    // Config
    'get_config',
    'set_config',
    'reset_config',
    'get_platform_info',
    // Window
    'get_window_position',
    'set_window_position',
    'save_window_bounds',
    'minimize_window',
    'maximize_window',
    'quit_app',
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
    'stop_speaking',
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
    'interrupt_ai',
    'send_voice_loop',
    'scan_providers',
    'set_provider',
    'get_provider',
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
    'take_screenshot',
    'list_monitors',
    'list_windows',
    'capture_monitor',
    'capture_window',
    // Tools
    'scan_cli_tools',
    'check_npm_versions',
    'update_npm_package',
    // Shortcuts
    'register_shortcut',
    'unregister_shortcut',
    'list_shortcuts',
    'unregister_all_shortcuts',
    // Migration
    'migrate_electron_config',
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
    'getPlatformInfo',
    // Window
    'getWindowPosition',
    'setWindowPosition',
    'saveWindowBounds',
    'minimizeWindow',
    'maximizeWindow',
    'quitApp',
    'setWindowSize',
    'setAlwaysOnTop',
    'setResizable',
    'showWindow',
    // Voice
    'startVoice',
    'stopVoice',
    'getVoiceStatus',
    'setVoiceMode',
    'listAudioDevices',
    'stopSpeaking',
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
    'interruptAi',
    'sendVoiceLoop',
    'scanProviders',
    'setProvider',
    'getProvider',
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
    'takeScreenshot',
    'listMonitors',
    'listWindows',
    'captureMonitor',
    'captureWindow',
    // Tools
    'scanCliTools',
    'checkNpmVersions',
    'updateNpmPackage',
    // Shortcuts
    'registerShortcut',
    'unregisterShortcut',
    'listShortcuts',
    'unregisterAllShortcuts',
    // Performance Stats
    'getProcessStats',
    // Migration
    'migrateElectronConfig',
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
  const sections = ['Config', 'Window', 'Voice', 'AI', 'Inbox', 'Chat', 'Tools', 'Shortcuts', 'Performance Stats', 'Config Migration'];

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

  it('writeUserMessage passes message, from, threadId', () => {
    assert.ok(
      src.includes("invoke('write_user_message', { message, from, threadId })"),
      'writeUserMessage should pass message, from, threadId'
    );
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
