//! AI Manager — Orchestrates AI providers.
//!
//! The `AiManager` is the central coordinator for AI provider lifecycle:
//! starting, stopping, switching providers, and routing input/output.
//!
//! It maintains a generation counter to prevent stale operations (e.g., output
//! from a stopped provider reaching the frontend after a new provider starts).
//!
//! Thread-safe: designed to be held in `Arc<Mutex<>>` as Tauri managed state.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::mpsc;

use super::{create_provider, is_cli_provider, Provider, ProviderConfig, ProviderEvent};

/// The AI manager state.
pub struct AiManager {
    /// The currently active provider (if any).
    provider: Option<Box<dyn Provider>>,
    /// Generation counter — bumped on stop() to invalidate stale callbacks.
    generation: Arc<AtomicU64>,
    /// Whether a start operation is in progress (prevents concurrent spawns).
    starting: bool,
    /// Event receiver — consumers (Tauri event emitter) read from this.
    /// Stored here so it can be taken by the command layer.
    event_rx: Option<mpsc::UnboundedReceiver<ProviderEvent>>,
    /// Event sender — passed to providers for emitting events.
    event_tx: mpsc::UnboundedSender<ProviderEvent>,
}

impl AiManager {
    /// Create a new AI manager.
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        Self {
            provider: None,
            generation: Arc::new(AtomicU64::new(0)),
            starting: false,
            event_rx: Some(event_rx),
            event_tx,
        }
    }

    /// Take the event receiver.
    ///
    /// This can only be called once — the receiver is moved to the consumer
    /// (typically the Tauri event forwarding loop). Returns `None` if already taken.
    pub fn take_event_rx(&mut self) -> Option<mpsc::UnboundedReceiver<ProviderEvent>> {
        self.event_rx.take()
    }

    /// Get the current generation counter value.
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Start an AI provider.
    ///
    /// Creates and starts a provider based on the given type and configuration.
    /// If a provider is already running, it must be stopped first.
    ///
    /// # Arguments
    /// * `provider_type` - The provider identifier (e.g., "claude", "ollama")
    /// * `cols` - Initial terminal columns
    /// * `rows` - Initial terminal rows
    /// * `config` - Provider-specific configuration
    pub fn start(
        &mut self,
        provider_type: &str,
        cols: u16,
        rows: u16,
        config: ProviderConfig,
    ) -> Result<(), String> {
        if self.starting {
            return Err("Start already in progress".to_string());
        }
        self.starting = true;

        // If there's a running provider of a different type, stop it first
        if let Some(ref provider) = self.provider {
            if provider.is_running() {
                self.starting = false;
                return Err(format!(
                    "Provider {} is already running. Stop it first.",
                    provider.provider_type()
                ));
            }
        }

        // Create the provider
        let mut provider = create_provider(provider_type, self.event_tx.clone(), config);

        // Start it
        match provider.start(cols, rows) {
            Ok(()) => {
                self.provider = Some(provider);
                self.starting = false;
                Ok(())
            }
            Err(e) => {
                self.starting = false;
                Err(e)
            }
        }
    }

    /// Stop the currently active provider.
    ///
    /// Bumps the generation counter to invalidate stale callbacks.
    /// Returns `true` if a provider was stopped.
    pub fn stop(&mut self) -> bool {
        // Bump generation FIRST — invalidates output from dying provider
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.starting = false;

        if let Some(ref mut provider) = self.provider {
            if provider.is_running() {
                provider.stop();
                self.provider = None;
                return true;
            }
        }

        self.provider = None;
        false
    }

    /// Switch to a different provider.
    ///
    /// Stops the current provider and starts a new one.
    pub fn switch(
        &mut self,
        provider_type: &str,
        cols: u16,
        rows: u16,
        config: ProviderConfig,
    ) -> Result<(), String> {
        self.stop();
        self.start(provider_type, cols, rows, config)
    }

    /// Send text input to the active provider.
    pub fn send_input(&mut self, data: &str) -> bool {
        if let Some(ref mut provider) = self.provider {
            if provider.is_running() {
                provider.send_input(data);
                return true;
            }
        }
        false
    }

    /// Send raw bytes to the active provider (PTY passthrough).
    pub fn send_raw_input(&mut self, data: &[u8]) -> bool {
        if let Some(ref mut provider) = self.provider {
            if provider.is_running() {
                provider.send_raw_input(data);
                return true;
            }
        }
        false
    }

    /// Resize the terminal of the active provider.
    pub fn resize(&mut self, cols: u16, rows: u16) {
        if let Some(ref mut provider) = self.provider {
            if provider.is_running() {
                provider.resize(cols, rows);
            }
        }
    }

    /// Check if any provider is currently running.
    pub fn is_running(&self) -> bool {
        self.provider
            .as_ref()
            .map(|p| p.is_running())
            .unwrap_or(false)
    }

    /// Interrupt the current operation.
    ///
    /// For PTY providers: sends Ctrl+C.
    /// For API providers: aborts the HTTP request.
    pub fn interrupt(&mut self) -> bool {
        if let Some(ref mut provider) = self.provider {
            if provider.is_running() {
                provider.interrupt();
                return true;
            }
        }
        false
    }

    /// Get the current provider type (if running).
    pub fn provider_type(&self) -> Option<&str> {
        self.provider.as_ref().map(|p| p.provider_type())
    }

    /// Get the display name of the current provider.
    pub fn display_name(&self) -> Option<&str> {
        self.provider.as_ref().map(|p| p.display_name())
    }

    /// Get the mode of the current provider (pty or api).
    pub fn mode(&self) -> Option<&str> {
        self.provider.as_ref().map(|p| {
            if is_cli_provider(p.provider_type()) {
                "pty"
            } else {
                "api"
            }
        })
    }

    /// Send the voice listen loop command to CLI agents.
    ///
    /// For CLI providers that support MCP, this sends a prompt instructing
    /// the agent to listen for voice input and respond in a loop.
    pub fn send_voice_loop(&mut self, sender_name: &str) {
        if let Some(ref mut provider) = self.provider {
            if provider.is_running() && is_cli_provider(provider.provider_type()) {
                let prompt = format!(
                    "Use voice_listen to wait for voice input from {}, then reply with voice_send. Loop forever.\n",
                    sender_name
                );
                provider.send_input(&prompt);
            }
        }
    }
}

impl Default for AiManager {
    fn default() -> Self {
        Self::new()
    }
}
