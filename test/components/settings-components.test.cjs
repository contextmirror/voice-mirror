/**
 * settings-components.test.js -- Source-inspection tests for tauri/src/components/settings/
 *
 * Tests SettingsPanel, AISettings, VoiceSettings, AppearanceSettings,
 * BehaviorSettings, DependencySettings, ToolSettings.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_DIR = path.join(__dirname, '../../src/components/settings');
const LIB_DIR = path.join(__dirname, '../../src/lib');

function readComponent(name) {
  return fs.readFileSync(path.join(SETTINGS_DIR, name), 'utf-8');
}

function readLib(name) {
  return fs.readFileSync(path.join(LIB_DIR, name), 'utf-8');
}

// ---- SettingsPanel.svelte ----

describe('SettingsPanel.svelte', () => {
  const src = readComponent('SettingsPanel.svelte');

  it('imports configStore', () => {
    assert.ok(src.includes("import { configStore } from '../../lib/stores/config.svelte.js'"), 'Should import configStore');
  });

  it('imports AISettings', () => {
    assert.ok(src.includes("import AISettings from './AISettings.svelte'"), 'Should import AISettings');
  });

  it('imports and renders ToolSettings', () => {
    assert.ok(src.includes("import ToolSettings from './ToolSettings.svelte'"), 'Should import ToolSettings');
    assert.ok(src.includes('<ToolSettings'), 'Should render ToolSettings');
  });

  it('imports VoiceSettings', () => {
    assert.ok(src.includes("import VoiceSettings from './VoiceSettings.svelte'"), 'Should import VoiceSettings');
  });

  it('imports AppearanceSettings', () => {
    assert.ok(src.includes("import AppearanceSettings from './AppearanceSettings.svelte'"), 'Should import AppearanceSettings');
  });

  it('imports BehaviorSettings', () => {
    assert.ok(src.includes("import BehaviorSettings from './BehaviorSettings.svelte'"), 'Should import BehaviorSettings');
  });

  it('imports DependencySettings', () => {
    assert.ok(src.includes("import DependencySettings from './DependencySettings.svelte'"), 'Should import DependencySettings');
  });

  it('defines TABS array', () => {
    assert.ok(src.includes('const TABS'), 'Should define TABS');
  });

  it('has General tab', () => {
    assert.ok(src.includes("label: 'General'"), 'Should have General tab');
  });

  it('has AI & Tools tab', () => {
    assert.ok(src.includes("label: 'AI & Tools'"), 'Should have AI & Tools tab');
  });

  it('has Voice & Audio tab', () => {
    assert.ok(src.includes("label: 'Voice & Audio'"), 'Should have Voice & Audio tab');
  });

  it('has Appearance tab', () => {
    assert.ok(src.includes("label: 'Appearance'"), 'Should have Appearance tab');
  });

  it('has Dependencies tab (feature-flagged)', () => {
    assert.ok(src.includes("label: 'Dependencies'"), 'Should have Dependencies tab');
    assert.ok(src.includes("flag: 'showDependencies'"), 'Should be behind feature flag');
  });

  it('has role="tablist" for accessibility', () => {
    assert.ok(src.includes('role="tablist"'), 'Should have tablist role');
  });

  it('has role="tab" on tab buttons', () => {
    assert.ok(src.includes('role="tab"'), 'Should have tab role on buttons');
  });

  it('has aria-selected on tabs', () => {
    assert.ok(src.includes('aria-selected='), 'Should have aria-selected');
  });

  it('has role="tabpanel" on content areas', () => {
    assert.ok(src.includes('role="tabpanel"'), 'Should have tabpanel role');
  });

  it('uses $state for activeTab', () => {
    assert.ok(src.includes("let activeTab = $state('general')"), 'Should default activeTab to general');
  });

  it('derives showDependencies from config', () => {
    assert.ok(src.includes('showDependencies'), 'Should derive showDependencies');
  });

  it('has settings-panel CSS class', () => {
    assert.ok(src.includes('.settings-panel'), 'Should have settings-panel CSS');
  });

  it('has settings-tabs CSS class', () => {
    assert.ok(src.includes('.settings-tabs'), 'Should have settings-tabs CSS');
  });
});

// ---- AISettings.svelte ----

describe('AISettings.svelte', () => {
  const src = readComponent('AISettings.svelte');

  it('imports configStore and updateConfig', () => {
    assert.ok(src.includes("import { configStore, updateConfig } from '../../lib/stores/config.svelte.js'"), 'Should import config store');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore } from '../../lib/stores/toast.svelte.js'"), 'Should import toastStore');
  });

  it('imports Select component', () => {
    assert.ok(src.includes("import Select from '../shared/Select.svelte'"), 'Should import Select');
  });

  it('imports Toggle component', () => {
    assert.ok(src.includes("import Toggle from '../shared/Toggle.svelte'"), 'Should import Toggle');
  });

  it('imports TextInput component', () => {
    assert.ok(src.includes("import TextInput from '../shared/TextInput.svelte'"), 'Should import TextInput');
  });

  it('imports Button component', () => {
    assert.ok(src.includes("import Button from '../shared/Button.svelte'"), 'Should import Button');
  });

  it('uses PROVIDER_NAMES from shared providers module', () => {
    assert.ok(src.includes('PROVIDER_NAMES'), 'Should use PROVIDER_NAMES');
    assert.ok(src.includes("from '../../lib/providers.js'"), 'Should import from providers.js');
  });

  it('uses PROVIDER_ICONS from shared providers module', () => {
    assert.ok(src.includes('PROVIDER_ICONS'), 'Should use PROVIDER_ICONS');
  });

  it('uses PROVIDER_GROUPS from shared providers module', () => {
    assert.ok(src.includes('PROVIDER_GROUPS'), 'Should use PROVIDER_GROUPS');
  });

  it('uses CLI_PROVIDERS and LOCAL_PROVIDERS from shared providers module', () => {
    assert.ok(src.includes('CLI_PROVIDERS'), 'Should use CLI_PROVIDERS');
    assert.ok(src.includes('LOCAL_PROVIDERS'), 'Should use LOCAL_PROVIDERS');
  });

  it('uses DEFAULT_ENDPOINTS from shared providers module', () => {
    assert.ok(src.includes('DEFAULT_ENDPOINTS'), 'Should use DEFAULT_ENDPOINTS');
  });

  it('has model input for non-CLI providers', () => {
    assert.ok(src.includes('showModel'), 'Should conditionally show model input');
  });

  it('has endpoint configuration for local providers', () => {
    assert.ok(src.includes('showEndpoint'), 'Should conditionally show endpoint input');
  });

  it('has context length options', () => {
    assert.ok(src.includes('CONTEXT_LENGTH_OPTIONS'), 'Should define context length options');
  });

  it('delegates tool management to ToolSettings (via SettingsPanel)', () => {
    // Tool profiles and groups are managed by ToolSettings.svelte
    assert.ok(!src.includes('const TOOL_GROUPS'), 'Should NOT define TOOL_GROUPS (handled by ToolSettings)');
    assert.ok(!src.includes('const DEFAULT_PROFILES'), 'Should NOT define DEFAULT_PROFILES (handled by ToolSettings)');
  });

  it('has scan providers functionality', () => {
    assert.ok(src.includes('scanProviders'), 'Should have scanProviders');
    assert.ok(src.includes('scanning'), 'Should track scanning state');
  });

  it('has save handler', () => {
    assert.ok(src.includes('saveAISettings'), 'Should have saveAISettings function');
  });

  it('uses switchProvider on save', () => {
    assert.ok(src.includes('switchProvider'), 'Should call switchProvider on save');
  });

  it('has system prompt textarea', () => {
    assert.ok(src.includes('system-prompt-input'), 'Should have system prompt textarea');
    assert.ok(src.includes('systemPrompt'), 'Should have systemPrompt state');
  });
});

// ---- providers.js (shared provider metadata) ----

describe('providers.js', () => {
  const src = readLib('providers.js');

  it('exports PROVIDER_NAMES mapping', () => {
    assert.ok(src.includes('export const PROVIDER_NAMES'), 'Should export PROVIDER_NAMES');
  });

  it('supports Claude Code provider', () => {
    assert.ok(src.includes("claude: 'Claude Code'"), 'Should have Claude Code provider');
  });

  it('supports Ollama provider', () => {
    assert.ok(src.includes("ollama: 'Ollama'"), 'Should have Ollama provider');
  });

  it('supports LM Studio provider', () => {
    assert.ok(src.includes("lmstudio: 'LM Studio'"), 'Should have LM Studio provider');
  });

  it('exports PROVIDER_ICONS mapping', () => {
    assert.ok(src.includes('export const PROVIDER_ICONS'), 'Should export PROVIDER_ICONS');
  });

  it('exports PROVIDER_GROUPS with CLI Agents and Local LLM Servers', () => {
    assert.ok(src.includes('export const PROVIDER_GROUPS'), 'Should export PROVIDER_GROUPS');
    assert.ok(src.includes("label: 'CLI Agents'"), 'Should have CLI Agents group');
    assert.ok(src.includes("label: 'Local LLM Servers'"), 'Should have Local LLM Servers group');
  });

  it('exports DEFAULT_ENDPOINTS for local providers', () => {
    assert.ok(src.includes('export const DEFAULT_ENDPOINTS'), 'Should export DEFAULT_ENDPOINTS');
    assert.ok(src.includes("'http://127.0.0.1:11434'"), 'Should have Ollama endpoint');
    assert.ok(src.includes("'http://127.0.0.1:1234'"), 'Should have LM Studio endpoint');
  });

  it('exports CLI_PROVIDERS and LOCAL_PROVIDERS', () => {
    assert.ok(src.includes('export const CLI_PROVIDERS'), 'Should export CLI_PROVIDERS');
    assert.ok(src.includes('export const LOCAL_PROVIDERS'), 'Should export LOCAL_PROVIDERS');
  });

  it('exports MCP_PROVIDERS', () => {
    assert.ok(src.includes('export const MCP_PROVIDERS'), 'Should export MCP_PROVIDERS');
  });

  it('exports getProviderIcon helper', () => {
    assert.ok(src.includes('export function getProviderIcon'), 'Should export getProviderIcon');
  });

  it('exports getProviderName helper', () => {
    assert.ok(src.includes('export function getProviderName'), 'Should export getProviderName');
  });
});

// ---- VoiceSettings.svelte ----

describe('VoiceSettings.svelte', () => {
  const src = readComponent('VoiceSettings.svelte');

  it('imports configStore and updateConfig', () => {
    assert.ok(src.includes("import { configStore, updateConfig }"), 'Should import config store');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore }"), 'Should import toastStore');
  });

  it('imports Slider component', () => {
    assert.ok(src.includes("import Slider from '../shared/Slider.svelte'"), 'Should import Slider');
  });

  it('has activation mode options (pushToTalk, toggle, wakeWord)', () => {
    assert.ok(src.includes("value=\"pushToTalk\""), 'Should have pushToTalk option');
    assert.ok(src.includes("value=\"toggle\""), 'Should have toggle option');
    assert.ok(src.includes("value=\"wakeWord\""), 'Should have wakeWord option');
  });

  it('has Push to Talk label', () => {
    assert.ok(src.includes('Push to Talk'), 'Should show Push to Talk');
  });

  it('has Toggle to Talk label', () => {
    assert.ok(src.includes('Toggle to Talk'), 'Should show Toggle to Talk');
  });

  it('has Wake Word label', () => {
    assert.ok(src.includes('Wake Word'), 'Should show Wake Word');
  });

  it('uses STT_REGISTRY from voice-adapters', () => {
    assert.ok(src.includes('STT_REGISTRY'), 'Should use STT_REGISTRY');
    assert.ok(src.includes("from '../../lib/voice-adapters.js'"), 'Should import from voice-adapters.js');
  });

  it('supports whisper-local STT', () => {
    assert.ok(src.includes("'whisper-local'"), 'Should support whisper-local STT');
  });

  it('delegates keybind recording to KeybindRecorder', () => {
    assert.ok(src.includes("import KeybindRecorder from './KeybindRecorder.svelte'"), 'Should import KeybindRecorder');
    assert.ok(src.includes('<KeybindRecorder'), 'Should render KeybindRecorder');
  });

  it('delegates TTS configuration to TTSConfig', () => {
    assert.ok(src.includes("import TTSConfig from './TTSConfig.svelte'"), 'Should import TTSConfig');
    assert.ok(src.includes('<TTSConfig'), 'Should render TTSConfig');
  });

  it('has TTS state variables', () => {
    assert.ok(src.includes('ttsSpeed'), 'Should have ttsSpeed state');
    assert.ok(src.includes('ttsVolume'), 'Should have ttsVolume state');
  });

  it('has audio device selection', () => {
    assert.ok(src.includes('Input Device'), 'Should have input device selection');
    assert.ok(src.includes('Output Device'), 'Should have output device selection');
  });

  it('has announcement toggles', () => {
    assert.ok(src.includes('announceStartup'), 'Should have announceStartup toggle');
    assert.ok(src.includes('announceProvider'), 'Should have announceProvider toggle');
  });

  it('has save handler', () => {
    assert.ok(src.includes('saveVoiceSettings'), 'Should have saveVoiceSettings function');
  });
});

// ---- KeybindRecorder.svelte ----

describe('KeybindRecorder.svelte', () => {
  const src = readComponent('KeybindRecorder.svelte');

  it('imports formatKeybind from voice-adapters', () => {
    assert.ok(src.includes("import { formatKeybind } from '../../lib/voice-adapters.js'"), 'Should import formatKeybind');
  });

  it('has keybind recording state', () => {
    assert.ok(src.includes('recordingKeybind'), 'Should track which keybind is being recorded');
  });

  it('has Toggle Overlay keybind', () => {
    assert.ok(src.includes('Toggle Overlay'), 'Should have toggle overlay keybind');
  });

  it('has Push-to-Talk keybind', () => {
    assert.ok(src.includes('Push-to-Talk'), 'Should have PTT keybind');
  });

  it('has Dictation keybind', () => {
    assert.ok(src.includes('Dictation'), 'Should have dictation keybind');
  });

  it('has Stats Dashboard keybind', () => {
    assert.ok(src.includes('Stats Dashboard'), 'Should have stats keybind');
  });

  it('uses $props for bindable keybind values', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('$bindable'), 'Should use $bindable for two-way binding');
  });

  it('handles keyboard and mouse events', () => {
    assert.ok(src.includes('handleKeybindKeydown'), 'Should handle keyboard events');
    assert.ok(src.includes('handleKeybindMousedown'), 'Should handle mouse events');
  });
});

// ---- TTSConfig.svelte ----

describe('TTSConfig.svelte', () => {
  const src = readComponent('TTSConfig.svelte');

  it('imports ADAPTER_REGISTRY from voice-adapters', () => {
    assert.ok(src.includes("import { ADAPTER_REGISTRY } from '../../lib/voice-adapters.js'"), 'Should import ADAPTER_REGISTRY');
  });

  it('has TTS speed slider', () => {
    assert.ok(src.includes('ttsSpeed'), 'Should have ttsSpeed prop');
    assert.ok(src.includes("label=\"Speed\""), 'Should have Speed label');
  });

  it('has TTS volume slider', () => {
    assert.ok(src.includes('ttsVolume'), 'Should have ttsVolume prop');
    assert.ok(src.includes("label=\"Volume\""), 'Should have Volume label');
  });

  it('has TTS engine selector', () => {
    assert.ok(src.includes("label=\"TTS Engine\""), 'Should have TTS Engine label');
  });

  it('has voice selector', () => {
    assert.ok(src.includes("label=\"Voice\""), 'Should have Voice label');
  });

  it('uses $props for bindable TTS values', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('$bindable'), 'Should use $bindable for two-way binding');
  });
});

// ---- voice-adapters.js (shared voice adapter registries) ----

describe('voice-adapters.js', () => {
  const src = readLib('voice-adapters.js');

  it('exports ADAPTER_REGISTRY', () => {
    assert.ok(src.includes('export const ADAPTER_REGISTRY'), 'Should export ADAPTER_REGISTRY');
  });

  it('supports kokoro TTS', () => {
    assert.ok(src.includes("kokoro:"), 'Should support kokoro TTS');
  });

  it('supports edge TTS', () => {
    assert.ok(src.includes("edge:"), 'Should support edge TTS');
  });

  it('supports piper TTS', () => {
    assert.ok(src.includes("piper:"), 'Should support piper TTS');
  });

  it('exports STT_REGISTRY', () => {
    assert.ok(src.includes('export const STT_REGISTRY'), 'Should export STT_REGISTRY');
  });

  it('supports whisper-local STT', () => {
    assert.ok(src.includes("'whisper-local'"), 'Should support whisper-local STT');
  });

  it('exports VKEY_NAMES', () => {
    assert.ok(src.includes('export const VKEY_NAMES'), 'Should export VKEY_NAMES');
  });

  it('exports formatKeybind helper', () => {
    assert.ok(src.includes('export function formatKeybind'), 'Should export formatKeybind');
  });

  it('exports getVoicesForAdapter helper', () => {
    assert.ok(src.includes('export function getVoicesForAdapter'), 'Should export getVoicesForAdapter');
  });

  it('exports getModelsForAdapter helper', () => {
    assert.ok(src.includes('export function getModelsForAdapter'), 'Should export getModelsForAdapter');
  });
});

// ---- AppearanceSettings.svelte ----

describe('AppearanceSettings.svelte', () => {
  const src = readComponent('AppearanceSettings.svelte');

  it('imports PRESETS and applyTheme from theme store', () => {
    assert.ok(src.includes("import { PRESETS, applyTheme"), 'Should import PRESETS and applyTheme');
  });

  it('delegates to ThemeSection sub-component', () => {
    assert.ok(src.includes("import ThemeSection from './appearance/ThemeSection.svelte'"), 'Should import ThemeSection');
    assert.ok(src.includes('<ThemeSection'), 'Should render ThemeSection');
  });

  it('delegates to OrbSection sub-component', () => {
    assert.ok(src.includes("import OrbSection from './appearance/OrbSection.svelte'"), 'Should import OrbSection');
    assert.ok(src.includes('<OrbSection'), 'Should render OrbSection');
  });

  it('delegates to MessageCardSection sub-component', () => {
    assert.ok(src.includes("import MessageCardSection from './appearance/MessageCardSection.svelte'"), 'Should import MessageCardSection');
    assert.ok(src.includes('<MessageCardSection'), 'Should render MessageCardSection');
  });

  it('delegates to TypographySection sub-component', () => {
    assert.ok(src.includes("import TypographySection from './appearance/TypographySection.svelte'"), 'Should import TypographySection');
    assert.ok(src.includes('<TypographySection'), 'Should render TypographySection');
  });

  it('has reset to defaults button', () => {
    assert.ok(src.includes('Reset to Defaults'), 'Should have reset button');
  });

  it('has save handler', () => {
    assert.ok(src.includes('saveAppearanceSettings'), 'Should have saveAppearanceSettings function');
  });
});

// ---- AppearanceSettings sub-components ----

function readAppearanceComponent(name) {
  return fs.readFileSync(path.join(SETTINGS_DIR, 'appearance', name), 'utf-8');
}

describe('ThemeSection.svelte', () => {
  const src = readAppearanceComponent('ThemeSection.svelte');

  it('has theme preset grid', () => {
    assert.ok(src.includes('theme-preset-grid'), 'Should have theme preset grid');
  });

  it('has color customization toggle', () => {
    assert.ok(src.includes('customizeColors'), 'Should have customizeColors state');
    assert.ok(src.includes('Customize Colors'), 'Should show Customize Colors label');
  });

  it('defines COLOR_GROUPS for picker', () => {
    assert.ok(src.includes('COLOR_GROUPS'), 'Should define COLOR_GROUPS');
  });

  it('has Backgrounds color group', () => {
    assert.ok(src.includes("label: 'Backgrounds'"), 'Should have Backgrounds group');
  });

  it('has Text color group', () => {
    assert.ok(src.includes("label: 'Text'"), 'Should have Text group');
  });

  it('has Accent color group', () => {
    assert.ok(src.includes("label: 'Accent'"), 'Should have Accent group');
  });

  it('has Status color group', () => {
    assert.ok(src.includes("label: 'Status'"), 'Should have Status group');
  });

  it('has type="color" inputs for color pickers', () => {
    assert.ok(src.includes('type="color"'), 'Should have color input elements');
  });

  it('has import/export theme buttons', () => {
    assert.ok(src.includes('Import Theme'), 'Should have Import Theme button');
    assert.ok(src.includes('Export Theme'), 'Should have Export Theme button');
  });

  it('has theme JSON validation', () => {
    assert.ok(src.includes('validateThemeJson'), 'Should have validateThemeJson function');
  });

  it('validates REQUIRED_COLOR_KEYS', () => {
    assert.ok(src.includes('REQUIRED_COLOR_KEYS'), 'Should define required color keys');
    assert.ok(src.includes("'orbCore'"), 'Should require orbCore color key');
  });
});

describe('OrbSection.svelte', () => {
  const src = readAppearanceComponent('OrbSection.svelte');

  it('imports Orb component for preview', () => {
    assert.ok(src.includes("import Orb from"), 'Should import Orb for preview');
  });

  it('has orb size slider', () => {
    assert.ok(src.includes('Orb Size'), 'Should have orb size control');
  });

  it('has type="color" input for orb core color', () => {
    assert.ok(src.includes('type="color"'), 'Should have color input for orb core');
  });
});

describe('MessageCardSection.svelte', () => {
  const src = readAppearanceComponent('MessageCardSection.svelte');

  it('has bubble style selector', () => {
    assert.ok(src.includes('Bubble Style'), 'Should have bubble style selector');
    assert.ok(src.includes('BUBBLE_STYLE_PRESETS'), 'Should define bubble style presets');
  });
});

describe('TypographySection.svelte', () => {
  const src = readAppearanceComponent('TypographySection.svelte');

  it('has font family selection', () => {
    assert.ok(src.includes('UI Font'), 'Should have UI font selector');
    assert.ok(src.includes('Mono Font'), 'Should have Mono font selector');
  });

  it('has font size slider', () => {
    assert.ok(src.includes('Font Size'), 'Should have font size control');
  });

  it('supports custom font upload', () => {
    assert.ok(src.includes('Upload Custom UI Font'), 'Should support UI font upload');
    assert.ok(src.includes('Upload Custom Mono Font'), 'Should support Mono font upload');
  });
});

// ---- BehaviorSettings.svelte ----

describe('BehaviorSettings.svelte', () => {
  const src = readComponent('BehaviorSettings.svelte');

  it('imports configStore and updateConfig', () => {
    assert.ok(src.includes("import { configStore, updateConfig }"), 'Should import config store');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore }"), 'Should import toastStore');
  });

  it('imports Toggle component', () => {
    assert.ok(src.includes("import Toggle from '../shared/Toggle.svelte'"), 'Should import Toggle');
  });

  it('imports TextInput component', () => {
    assert.ok(src.includes("import TextInput from '../shared/TextInput.svelte'"), 'Should import TextInput');
  });

  it('imports Button component', () => {
    assert.ok(src.includes("import Button from '../shared/Button.svelte'"), 'Should import Button');
  });

  it('has user name input', () => {
    assert.ok(src.includes('userName'), 'Should have userName state');
    assert.ok(src.includes("label=\"Name\""), 'Should have Name label');
  });

  it('has startMinimized toggle', () => {
    assert.ok(src.includes('startMinimized'), 'Should have startMinimized');
    assert.ok(src.includes('Start Minimized'), 'Should show Start Minimized label');
  });

  it('has startWithSystem toggle', () => {
    assert.ok(src.includes('startWithSystem'), 'Should have startWithSystem');
    assert.ok(src.includes('Start with System'), 'Should show Start with System label');
  });

  it('has autoStartProvider toggle', () => {
    assert.ok(src.includes('autoStartProvider'), 'Should have autoStartProvider state');
    assert.ok(src.includes('Auto-Start AI Provider'), 'Should show Auto-Start AI Provider label');
  });

  it('includes ai.autoStart in save patch', () => {
    assert.ok(src.includes('autoStart: autoStartProvider'), 'Should save autoStart to ai config');
  });

  it('has debugMode toggle', () => {
    assert.ok(src.includes('debugMode'), 'Should have debugMode');
    assert.ok(src.includes('Debug Mode'), 'Should show Debug Mode label');
  });

  it('has showDependencies toggle', () => {
    assert.ok(src.includes('showDependencies'), 'Should have showDependencies');
    assert.ok(src.includes('Show Dependencies'), 'Should show Show Dependencies label');
  });

  it('has save handler', () => {
    assert.ok(src.includes('saveBehaviorSettings'), 'Should have saveBehaviorSettings function');
  });

  it('has User section heading', () => {
    assert.ok(src.includes('>User<'), 'Should have User section heading');
  });

  it('has Startup section heading', () => {
    assert.ok(src.includes('>Startup<'), 'Should have Startup section heading');
  });

  it('has Advanced section heading', () => {
    assert.ok(src.includes('>Advanced<'), 'Should have Advanced section heading');
  });

  it('has Editor section heading', () => {
    assert.ok(src.includes('>Editor<'), 'Should have Editor section heading');
  });

  it('has markdownPreview toggle', () => {
    assert.ok(src.includes('markdownPreview'), 'Should have markdownPreview state');
    assert.ok(src.includes('Markdown Preview'), 'Should show Markdown Preview label');
  });

  it('reads markdownPreview from editor config', () => {
    assert.ok(
      src.includes('cfg.editor?.markdownPreview'),
      'Should read markdownPreview from config'
    );
  });

  it('includes editor.markdownPreview in save patch', () => {
    assert.ok(
      src.includes('editor:') && src.includes('markdownPreview'),
      'Should save markdownPreview to editor config'
    );
  });
});

// ---- DependencySettings.svelte ----

describe('DependencySettings.svelte', () => {
  const src = readComponent('DependencySettings.svelte');

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore }"), 'Should import toastStore');
  });

  it('imports Button component', () => {
    assert.ok(src.includes("import Button from '../shared/Button.svelte'"), 'Should import Button');
  });

  it('defines BUNDLED components list', () => {
    assert.ok(src.includes('const BUNDLED'), 'Should define BUNDLED list');
  });

  it('lists ghostty-web as bundled', () => {
    assert.ok(src.includes('ghostty-web'), 'Should list ghostty-web');
  });

  it('defines SYSTEM_TOOLS list', () => {
    assert.ok(src.includes('const SYSTEM_TOOLS'), 'Should define SYSTEM_TOOLS');
  });

  it('lists Claude Code as system tool', () => {
    assert.ok(src.includes("label: 'Claude Code'"), 'Should list Claude Code');
  });

  it('lists Ollama as system tool', () => {
    assert.ok(src.includes("label: 'Ollama'"), 'Should list Ollama');
  });

  it('has check for updates functionality', () => {
    assert.ok(src.includes('checkDependencies'), 'Should have checkDependencies function');
  });

  it('has update handler', () => {
    assert.ok(src.includes('handleUpdate'), 'Should have handleUpdate function');
  });

  it('has Update All button (conditional)', () => {
    assert.ok(src.includes('Update All'), 'Should have Update All option');
  });

  it('tracks update status per tool', () => {
    assert.ok(src.includes('updateStatus'), 'Should track update status');
  });

  it('has Bundled section heading', () => {
    assert.ok(src.includes('>Bundled<'), 'Should have Bundled section');
  });

  it('has System Tools section heading', () => {
    assert.ok(src.includes('>System Tools<'), 'Should have System Tools section');
  });

  it('shows last checked time', () => {
    assert.ok(src.includes('lastChecked'), 'Should show last checked time');
    assert.ok(src.includes('Last checked:'), 'Should display last checked label');
  });
});

// ---- ToolSettings.svelte ----

describe('ToolSettings.svelte', () => {
  const src = readComponent('ToolSettings.svelte');

  it('imports configStore and updateConfig', () => {
    assert.ok(src.includes("import { configStore, updateConfig }"), 'Should import config store');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore }"), 'Should import toastStore');
  });

  it('imports Toggle component', () => {
    assert.ok(src.includes("import Toggle from '../shared/Toggle.svelte'"), 'Should import Toggle');
  });

  it('imports Select component', () => {
    assert.ok(src.includes("import Select from '../shared/Select.svelte'"), 'Should import Select');
  });

  it('defines TOOL_GROUPS with user-facing groups only', () => {
    assert.ok(src.includes('const TOOL_GROUPS'), 'Should define TOOL_GROUPS');
    assert.ok(src.includes("id: 'core'"), 'Should have core group');
    assert.ok(src.includes("id: 'meta'"), 'Should have meta group');
    assert.ok(src.includes("id: 'browser'"), 'Should have browser group');
    assert.ok(src.includes("id: 'memory'"), 'Should have memory group');
    assert.ok(src.includes("id: 'n8n'"), 'Should have n8n group');
  });

  it('excludes internal facade and diagnostic groups from UI', () => {
    // These are auto-selected by profiles, not shown to users
    assert.ok(!src.includes("id: 'diagnostic'"), 'Should NOT show diagnostic group');
    assert.ok(!src.includes("id: 'memory-facade'"), 'Should NOT show memory-facade group');
    assert.ok(!src.includes("id: 'n8n-facade'"), 'Should NOT show n8n-facade group');
    assert.ok(!src.includes("id: 'browser-facade'"), 'Should NOT show browser-facade group');
  });

  it('defines DEFAULT_PROFILES', () => {
    assert.ok(src.includes('const DEFAULT_PROFILES'), 'Should define DEFAULT_PROFILES');
    assert.ok(src.includes("'voice-assistant'"), 'Should have voice-assistant profile');
    assert.ok(src.includes("'full-toolbox'"), 'Should have full-toolbox profile');
    assert.ok(src.includes("'minimal'"), 'Should have minimal profile');
  });

  it('has Active Profile selector', () => {
    assert.ok(src.includes("label=\"Active Profile\""), 'Should have Active Profile label');
  });

  it('shows total tool count', () => {
    assert.ok(src.includes('totalToolCount'), 'Should derive totalToolCount');
    assert.ok(src.includes('Total tools:'), 'Should display total tools label');
  });

  it('has group toggle for each tool group', () => {
    assert.ok(src.includes('handleGroupToggle'), 'Should have handleGroupToggle function');
  });

  it('marks core and meta as always loaded', () => {
    // core and meta have alwaysLoaded: true
    assert.ok(src.includes('alwaysLoaded: true'), 'Should mark some groups as always loaded');
  });

  it('has save handler', () => {
    assert.ok(src.includes('saveToolSettings'), 'Should have saveToolSettings function');
  });

  it('has detectMatchingProfile function', () => {
    assert.ok(src.includes('detectMatchingProfile'), 'Should detect matching profile after toggle');
  });
});
