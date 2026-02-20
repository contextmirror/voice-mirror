pub mod api;
pub mod cli;
pub mod dictation;
pub mod manager;
pub mod tool_calling;

use std::fmt;

/// Known CLI-based providers (spawned in a PTY terminal).
pub const CLI_PROVIDERS: &[&str] = &["claude", "opencode", "codex", "gemini-cli", "kimi-cli"];

/// Check if a provider type is a CLI (PTY) provider.
pub fn is_cli_provider(provider_type: &str) -> bool {
    CLI_PROVIDERS.contains(&provider_type)
}

/// Events emitted by providers to be forwarded to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum ProviderEvent {
    /// Terminal output data (for PTY providers) or streamed tokens (for API providers).
    Output(String),
    /// Provider process exited with a code.
    Exit(i32),
    /// Provider is ready to accept input.
    Ready,
    /// An error occurred.
    Error(String),
    /// Stream token for real-time chat UI (API providers).
    StreamToken(String),
    /// End of streaming response with full text (API providers).
    StreamEnd(String),
    /// Full assistant response text (API providers, for TTS/chat cards).
    Response(String),
    /// The model requested tool calls (API providers with function calling).
    /// Contains the request payload with tool calls, assistant text, and
    /// raw tool call data needed for conversation history injection.
    ToolCalls(tool_calling::ToolCallRequest),
}

impl fmt::Display for ProviderEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderEvent::Output(s) => write!(f, "Output({} bytes)", s.len()),
            ProviderEvent::Exit(code) => write!(f, "Exit({})", code),
            ProviderEvent::Ready => write!(f, "Ready"),
            ProviderEvent::Error(s) => write!(f, "Error({})", s),
            ProviderEvent::StreamToken(s) => write!(f, "StreamToken({} bytes)", s.len()),
            ProviderEvent::StreamEnd(s) => write!(f, "StreamEnd({} bytes)", s.len()),
            ProviderEvent::Response(s) => write!(f, "Response({} bytes)", s.len()),
            ProviderEvent::ToolCalls(req) => write!(f, "ToolCalls({} calls)", req.calls.len()),
        }
    }
}

/// The common provider trait.
///
/// All AI providers (CLI/PTY and API) implement this trait.
/// Providers are `Send + Sync` so they can be held in an `Arc<Mutex<>>`.
pub trait Provider: Send {
    /// Start the provider. For CLI providers, this spawns a PTY process.
    /// For API providers, this marks the provider as ready.
    fn start(&mut self, cols: u16, rows: u16) -> Result<(), String>;

    /// Stop the provider and clean up resources.
    fn stop(&mut self);

    /// Send text input to the provider.
    /// For CLI providers, this writes to the PTY stdin.
    /// For API providers, this sends a chat message.
    fn send_input(&mut self, data: &str);

    /// Send raw bytes to the provider (PTY passthrough).
    /// API providers can ignore this.
    fn send_raw_input(&mut self, data: &[u8]);

    /// Resize the terminal (PTY providers only).
    fn resize(&mut self, cols: u16, rows: u16);

    /// Check if the provider is currently running.
    fn is_running(&self) -> bool;

    /// Get the provider type identifier (e.g., "claude", "ollama").
    fn provider_type(&self) -> &str;

    /// Get a human-readable display name.
    fn display_name(&self) -> &str;

    /// Interrupt the current operation (Ctrl+C for PTY, abort for API).
    fn interrupt(&mut self);

    /// Send text input with an image attachment.
    ///
    /// Default: ignores the image and sends text only via `send_input`.
    /// API providers override this to build multimodal content arrays.
    fn send_input_with_image(&mut self, data: &str, _image_path: &str) {
        self.send_input(data);
    }

    /// Send the voice listen loop command.
    ///
    /// Default: sends the voice loop prompt via `send_input`.
    /// CLI providers may override this to handle provider-specific setup
    /// (e.g., OpenCode needs `/new` first to refresh MCP tools).
    fn send_voice_loop(&mut self, sender_name: &str) {
        let prompt = format!(
            "Use voice_listen to wait for voice input from {}, then reply with voice_send. Loop forever.\n",
            sender_name
        );
        self.send_input(&prompt);
    }
}

/// Create a provider instance based on the provider type.
///
/// Returns a boxed trait object. The caller must call `start()` to begin.
///
/// # Arguments
/// * `provider_type` - The provider identifier (e.g., "claude", "ollama")
/// * `event_tx` - Channel sender for provider events
/// * `config` - Provider-specific configuration
pub fn create_provider(
    provider_type: &str,
    event_tx: tokio::sync::mpsc::UnboundedSender<ProviderEvent>,
    config: ProviderConfig,
) -> Box<dyn Provider> {
    if provider_type == "dictation" {
        Box::new(dictation::DictationProvider::new(provider_type, event_tx, config))
    } else if is_cli_provider(provider_type) {
        Box::new(cli::CliProvider::new(provider_type, event_tx, config))
    } else {
        Box::new(api::ApiProvider::new(provider_type, event_tx, config))
    }
}

/// Configuration passed to provider constructors.
#[derive(Clone, Debug)]
pub struct ProviderConfig {
    /// Model name/identifier (e.g., "llama3.2:latest", "gpt-4o-mini").
    pub model: Option<String>,
    /// Base URL for API providers (e.g., "http://127.0.0.1:11434").
    pub base_url: Option<String>,
    /// API key for authenticated providers.
    pub api_key: Option<String>,
    /// Context window size in tokens.
    pub context_length: u32,
    /// Custom system prompt.
    pub system_prompt: Option<String>,
    /// Working directory for CLI providers.
    pub cwd: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            model: None,
            base_url: None,
            api_key: None,
            context_length: 32768,
            system_prompt: None,
            cwd: None,
        }
    }
}
