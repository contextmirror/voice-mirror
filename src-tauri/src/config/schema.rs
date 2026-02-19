use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Root configuration matching Voice Mirror Electron's DEFAULT_CONFIG.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub wake_word: WakeWordConfig,
    #[serde(default)]
    pub voice: VoiceConfig,
    #[serde(default)]
    pub appearance: AppearanceConfig,
    #[serde(default)]
    pub behavior: BehaviorConfig,
    #[serde(default)]
    pub window: WindowConfig,
    #[serde(default)]
    pub overlay: OverlayConfig,
    #[serde(default)]
    pub advanced: AdvancedConfig,
    #[serde(default)]
    pub sidebar: SidebarConfig,
    #[serde(default)]
    pub user: UserConfig,
    #[serde(default)]
    pub system: SystemConfig,
    #[serde(default)]
    pub ai: AiConfig,
}

/// Wake word detection settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeWordConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_wake_phrase")]
    pub phrase: String,
    #[serde(default = "default_sensitivity")]
    pub sensitivity: f64,
}

impl Default for WakeWordConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            phrase: "hey_claude".into(),
            sensitivity: 0.5,
        }
    }
}

/// Voice engine settings (STT, TTS, audio devices).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    #[serde(default = "default_tts_adapter")]
    pub tts_adapter: String,
    #[serde(default = "default_tts_voice")]
    pub tts_voice: String,
    #[serde(default = "default_tts_model_size")]
    pub tts_model_size: String,
    #[serde(default = "default_one")]
    pub tts_speed: f64,
    #[serde(default = "default_one")]
    pub tts_volume: f64,
    #[serde(default)]
    pub tts_api_key: Option<String>,
    #[serde(default)]
    pub tts_endpoint: Option<String>,
    #[serde(default)]
    pub tts_model_path: Option<String>,
    #[serde(default = "default_stt_adapter")]
    pub stt_adapter: String,
    #[serde(default = "default_stt_model_size")]
    pub stt_model_size: String,
    #[serde(default)]
    pub stt_api_key: Option<String>,
    #[serde(default)]
    pub stt_endpoint: Option<String>,
    #[serde(default)]
    pub stt_model_name: Option<String>,
    #[serde(default)]
    pub input_device: Option<String>,
    #[serde(default)]
    pub output_device: Option<String>,
    #[serde(default = "default_true")]
    pub announce_startup: bool,
    #[serde(default = "default_true")]
    pub announce_provider_switch: bool,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            tts_adapter: "kokoro".into(),
            tts_voice: "af_bella".into(),
            tts_model_size: "0.6B".into(),
            tts_speed: 1.0,
            tts_volume: 1.0,
            tts_api_key: None,
            tts_endpoint: None,
            tts_model_path: None,
            stt_adapter: "whisper-local".into(),
            stt_model_size: "base".into(),
            stt_api_key: None,
            stt_endpoint: None,
            stt_model_name: None,
            input_device: None,
            output_device: None,
            announce_startup: true,
            announce_provider_switch: true,
        }
    }
}

/// Appearance and theme settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    #[serde(default = "default_orb_size")]
    pub orb_size: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_panel_width")]
    pub panel_width: u32,
    #[serde(default = "default_panel_height")]
    pub panel_height: u32,
    #[serde(default)]
    pub colors: Option<ThemeColors>,
    #[serde(default)]
    pub fonts: Option<ThemeFonts>,
    #[serde(default)]
    pub message_card: Option<serde_json::Value>,
    #[serde(default)]
    pub orb: Option<OrbConfig>,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            orb_size: 80,
            theme: "colorblind".into(),
            panel_width: 500,
            panel_height: 700,
            colors: None,
            fonts: None,
            message_card: None,
            orb: None,
        }
    }
}

/// Orb visual style configuration.
/// `preset` selects a built-in or custom style.
/// `overrides` stores per-field tweaks the user makes after picking a preset.
/// `custom_presets` stores user-imported orb styles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbConfig {
    #[serde(default = "default_orb_preset")]
    pub preset: String,
    #[serde(default)]
    pub overrides: Option<serde_json::Value>,
    #[serde(default)]
    pub custom_presets: Option<Vec<serde_json::Value>>,
}

fn default_orb_preset() -> String { "classic".into() }

/// Custom theme color overrides (all 10 color keys required).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColors {
    pub bg: String,
    pub bg_elevated: String,
    pub text: String,
    pub text_strong: String,
    pub muted: String,
    pub accent: String,
    pub ok: String,
    pub warn: String,
    pub danger: String,
    pub orb_core: String,
}

/// Custom theme font overrides.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFonts {
    pub font_family: String,
    pub font_mono: String,
}

/// Application behavior settings (hotkeys, startup, activation mode).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorConfig {
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default)]
    pub start_with_system: bool,
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_activation_mode")]
    pub activation_mode: String,
    #[serde(default = "default_ptt_key")]
    pub ptt_key: String,
    #[serde(default = "default_dictation_key")]
    pub dictation_key: String,
    #[serde(default = "default_stats_hotkey")]
    pub stats_hotkey: String,
}

impl Default for BehaviorConfig {
    fn default() -> Self {
        Self {
            start_minimized: false,
            start_with_system: false,
            hotkey: "CommandOrControl+Shift+V".into(),
            activation_mode: "wakeWord".into(),
            ptt_key: "MouseButton4".into(),
            dictation_key: "MouseButton5".into(),
            stats_hotkey: "CommandOrControl+Shift+M".into(),
        }
    }
}

/// Window position and state.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    #[serde(default)]
    pub orb_x: Option<f64>,
    #[serde(default)]
    pub orb_y: Option<f64>,
    #[serde(default)]
    pub expanded: bool,
}

/// Overlay display settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    #[serde(default)]
    pub output_name: Option<String>,
}

/// Advanced/debug settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedConfig {
    #[serde(default)]
    pub debug_mode: bool,
    #[serde(default)]
    pub show_dependencies: bool,
}

/// Sidebar UI state.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarConfig {
    #[serde(default)]
    pub collapsed: bool,
}

/// User identity settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConfig {
    #[serde(default)]
    pub name: Option<String>,
}

/// Internal system state (disclaimer, version tracking).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemConfig {
    #[serde(default)]
    pub accepted_disclaimer: bool,
    #[serde(default)]
    pub first_launch_done: bool,
    #[serde(default)]
    pub last_greeting_period: Option<String>,
    #[serde(default)]
    pub last_seen_version: Option<String>,
}

/// AI provider settings (provider selection, endpoints, API keys, tool profiles).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "default_context_length")]
    pub context_length: u32,
    #[serde(default = "default_true")]
    pub auto_detect: bool,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default = "default_tool_profile")]
    pub tool_profile: String,
    #[serde(default = "default_tool_profiles")]
    pub tool_profiles: HashMap<String, ToolProfile>,
    #[serde(default = "default_endpoints")]
    pub endpoints: HashMap<String, String>,
    #[serde(default = "default_api_keys")]
    pub api_keys: HashMap<String, Option<String>>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "claude".into(),
            model: None,
            context_length: 32768,
            auto_detect: true,
            system_prompt: None,
            tool_profile: "voice-assistant".into(),
            tool_profiles: default_tool_profiles(),
            endpoints: default_endpoints(),
            api_keys: default_api_keys(),
        }
    }
}

/// A named set of MCP tool groups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolProfile {
    pub groups: Vec<String>,
}

// ============ Default value functions ============

fn default_true() -> bool { true }
fn default_wake_phrase() -> String { "hey_claude".into() }
fn default_sensitivity() -> f64 { 0.5 }
fn default_one() -> f64 { 1.0 }
fn default_tts_adapter() -> String { "kokoro".into() }
fn default_tts_voice() -> String { "af_bella".into() }
fn default_tts_model_size() -> String { "0.6B".into() }
fn default_stt_adapter() -> String { "whisper-local".into() }
fn default_stt_model_size() -> String { "base".into() }
fn default_orb_size() -> u32 { 80 }
fn default_theme() -> String { "colorblind".into() }
fn default_panel_width() -> u32 { 500 }
fn default_panel_height() -> u32 { 700 }
fn default_hotkey() -> String { "CommandOrControl+Shift+V".into() }
fn default_activation_mode() -> String { "hybrid".into() }
fn default_ptt_key() -> String { "MouseButton4".into() }
fn default_dictation_key() -> String { "MouseButton5".into() }
fn default_stats_hotkey() -> String { "CommandOrControl+Shift+M".into() }
fn default_provider() -> String { "claude".into() }
fn default_context_length() -> u32 { 32768 }
fn default_tool_profile() -> String { "voice-assistant".into() }

fn default_tool_profiles() -> HashMap<String, ToolProfile> {
    let mut m = HashMap::new();
    m.insert("voice-assistant".into(), ToolProfile {
        groups: vec!["core".into(), "meta".into(), "screen".into(), "memory".into(), "browser".into()],
    });
    m.insert("n8n-workflows".into(), ToolProfile {
        groups: vec!["core".into(), "meta".into(), "n8n".into()],
    });
    m.insert("web-browser".into(), ToolProfile {
        groups: vec!["core".into(), "meta".into(), "screen".into(), "browser".into()],
    });
    m.insert("full-toolbox".into(), ToolProfile {
        groups: vec!["core".into(), "meta".into(), "screen".into(), "memory".into(), "voice-clone".into(), "browser".into(), "n8n".into()],
    });
    m.insert("minimal".into(), ToolProfile {
        groups: vec!["core".into(), "meta".into()],
    });
    m.insert("voice-assistant-lite".into(), ToolProfile {
        groups: vec!["core".into(), "meta".into(), "screen".into(), "memory-facade".into(), "browser-facade".into()],
    });
    m
}

fn default_endpoints() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("ollama".into(), "http://127.0.0.1:11434".into());
    m.insert("lmstudio".into(), "http://127.0.0.1:1234".into());
    m.insert("jan".into(), "http://127.0.0.1:1337".into());
    m
}

fn default_api_keys() -> HashMap<String, Option<String>> {
    let mut m = HashMap::new();
    for key in &["openai", "anthropic", "gemini", "grok", "groq", "mistral", "openrouter", "deepseek", "kimi"] {
        m.insert((*key).into(), None);
    }
    m
}
