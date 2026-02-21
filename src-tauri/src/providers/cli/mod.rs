//! CLI Provider — Spawns interactive CLI tools in a PTY terminal.
//!
//! Uses `portable-pty` to create a pseudo-terminal and spawn CLI-based AI tools
//! (Claude Code, OpenCode, Codex, Gemini CLI, Kimi CLI).
//!
//! For MCP-capable providers (Claude Code, OpenCode), this module also:
//! - Writes MCP server configuration so the provider has access to Voice Mirror tools
//!   (Claude Code: `~/.claude/settings.json`, OpenCode: `~/.config/opencode/opencode.json`)
//! - Injects the voice listen loop command after ready detection
//!
//! Additionally, for Claude Code only:
//! - Passes `--append-system-prompt` with voice workflow instructions
//! - Configures claude-pulse status line
//!
//! Ready detection works by scanning PTY output for configurable patterns,
//! then firing queued "send when ready" callbacks.

mod instructions;
mod mcp_config;
mod status_line;

use std::io::{Read, Write as IoWrite};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc::UnboundedSender;
use tracing::{info, warn};

use super::{Provider, ProviderConfig, ProviderEvent};
use crate::util::find_project_root;

/// Strip ANSI escape sequences from text for clean pattern matching.
///
/// Handles CSI sequences (ESC [ ... final_byte), OSC sequences (ESC ] ... ST),
/// and simple two-byte escapes (ESC char).
fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next(); // consume '['
                    // CSI: consume until final byte (0x40..=0x7E)
                    while let Some(&ch) = chars.peek() {
                        chars.next();
                        if ('@'..='~').contains(&ch) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next(); // consume ']'
                    // OSC: consume until ST (ESC \ or BEL)
                    while let Some(ch) = chars.next() {
                        if ch == '\x07' {
                            break;
                        }
                        if ch == '\x1b' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next(); // consume single char after ESC
                }
                None => {}
            }
        } else {
            out.push(c);
        }
    }

    out
}

/// Configuration for a specific CLI tool.
#[derive(Debug, Clone)]
pub struct CliConfig {
    /// The command to execute (e.g., "claude", "opencode").
    pub command: &'static str,
    /// Command-line arguments.
    pub args: &'static [&'static str],
    /// Patterns in PTY output that indicate the TUI is ready for input.
    pub ready_patterns: &'static [&'static str],
    /// Additional delay (ms) after detecting ready patterns before sending input.
    pub ready_delay_ms: u64,
    /// Human-readable display name.
    pub display_name: &'static str,
}

/// Map of known CLI provider configurations.
/// Mirrors `CLI_CONFIGS` from the Electron codebase.
pub fn get_cli_config(provider_type: &str) -> Option<CliConfig> {
    match provider_type {
        "claude" => Some(CliConfig {
            command: "claude",
            args: &["--dangerously-skip-permissions"],
            ready_patterns: &["\n>", "\r>", "\n❯", "\r❯", "╰─"],
            ready_delay_ms: 3000,
            display_name: "Claude Code",
        }),
        "opencode" => Some(CliConfig {
            command: "opencode",
            args: &[],
            ready_patterns: &["Ask anything", "ctrl+p"],
            ready_delay_ms: 2000,
            display_name: "OpenCode",
        }),
        "codex" => Some(CliConfig {
            command: "codex",
            args: &[],
            ready_patterns: &[">", "What", "How can"],
            ready_delay_ms: 500,
            display_name: "OpenAI Codex",
        }),
        "gemini-cli" => Some(CliConfig {
            command: "gemini",
            args: &[],
            ready_patterns: &[">", "What", "How can"],
            ready_delay_ms: 500,
            display_name: "Gemini CLI",
        }),
        "kimi-cli" => Some(CliConfig {
            command: "kimi",
            args: &[],
            ready_patterns: &[">", "What", "How can"],
            ready_delay_ms: 500,
            display_name: "Kimi CLI",
        }),
        _ => None,
    }
}

/// Check if a CLI command is available on the system PATH.
///
/// On Windows, also checks for `.cmd` wrapper variants (npm global scripts).
pub fn is_cli_available(command: &str) -> bool {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    std::process::Command::new(which_cmd)
        .arg(command)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Resolve the actual command to use, checking for `.cmd` wrappers on Windows.
fn resolve_command(command: &str) -> String {
    if cfg!(target_os = "windows") {
        // Try .cmd first (npm global scripts), fall back to bare name
        let cmd_variant = format!("{}.cmd", command);
        if is_cli_available(&cmd_variant) {
            return cmd_variant;
        }
    }
    command.to_string()
}

/// Scan the system for available CLI providers.
///
/// Returns a list of provider type strings that are available on PATH.
pub fn scan_available_providers() -> Vec<String> {
    let mut available = Vec::new();
    for &provider_type in super::CLI_PROVIDERS {
        if let Some(config) = get_cli_config(provider_type) {
            let resolved = resolve_command(config.command);
            if is_cli_available(&resolved) {
                available.push(provider_type.to_string());
            }
        }
    }
    available
}

// find_project_root is in crate::util (shared with commands::files)

// ============================================================
// CLI Provider Implementation
// ============================================================

/// The CLI provider implementation.
///
/// Spawns a PTY process and forwards output via events.
/// Includes ready detection with configurable patterns and delays.
pub struct CliProvider {
    /// The provider type identifier.
    provider_type_id: String,
    /// CLI configuration for this provider.
    cli_config: CliConfig,
    /// Channel for sending events to the frontend.
    event_tx: UnboundedSender<ProviderEvent>,
    /// Provider configuration (cwd, etc.).
    config: ProviderConfig,
    /// The PTY master (writer) — shared with the reader thread for ready queue.
    pty_writer: Option<Arc<Mutex<Box<dyn IoWrite + Send>>>>,
    /// Handle to the child process.
    child: Option<Box<dyn portable_pty::Child + Send>>,
    /// Whether the provider is running.
    running: Arc<AtomicBool>,
    /// Generation counter for stale callback protection.
    generation: Arc<AtomicU64>,
    /// Whether the TUI is ready for input.
    is_ready: Arc<AtomicBool>,
    /// Pending "send when ready" items (text to send once ready).
    ready_queue: Arc<Mutex<Vec<String>>>,
    /// Handle to the PTY reader thread (for cleanup).
    _reader_handle: Option<std::thread::JoinHandle<()>>,
    /// Handle to the PTY pair (needed for resize).
    pty_pair_master: Option<Box<dyn portable_pty::MasterPty + Send>>,
}

impl CliProvider {
    /// Create a new CLI provider.
    ///
    /// Does not start the PTY process — call `start()` for that.
    pub fn new(
        provider_type: &str,
        event_tx: UnboundedSender<ProviderEvent>,
        config: ProviderConfig,
    ) -> Self {
        let cli_config = get_cli_config(provider_type)
            .unwrap_or(CliConfig {
                command: "unknown",
                args: &[],
                ready_patterns: &[">"],
                ready_delay_ms: 500,
                display_name: "Unknown CLI",
            });

        Self {
            provider_type_id: provider_type.to_string(),
            cli_config,
            event_tx,
            config,
            pty_writer: None,
            child: None,
            running: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            is_ready: Arc::new(AtomicBool::new(false)),
            ready_queue: Arc::new(Mutex::new(Vec::new())),
            _reader_handle: None,
            pty_pair_master: None,
        }
    }
}

impl Provider for CliProvider {
    fn start(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err(format!("{} is already running", self.cli_config.display_name));
        }

        // Bump generation — invalidates any stale callbacks from previous sessions
        self.generation.fetch_add(1, Ordering::SeqCst);
        let my_gen = self.generation.load(Ordering::SeqCst);

        // Resolve the command (check for .cmd wrappers on Windows)
        let command = resolve_command(self.cli_config.command);

        // Check if the CLI tool is available
        if !is_cli_available(&command) {
            return Err(format!(
                "{} CLI not found. Ensure \"{}\" is installed and on your PATH.",
                self.cli_config.display_name, self.cli_config.command
            ));
        }

        // Resolve project root and working directory
        let project_root = find_project_root();
        let work_dir = self.config.cwd.as_ref().map(PathBuf::from)
            .or_else(|| project_root.clone())
            .or_else(dirs::home_dir);

        // MCP-capable providers: Claude Code and OpenCode both support MCP tools
        let is_claude = self.provider_type_id == "claude";
        let is_opencode = self.provider_type_id == "opencode";
        let supports_mcp = is_claude || is_opencode;
        let mut dynamic_args: Vec<String> = Vec::new();

        if supports_mcp {
            // Read config for user name and tool profile
            let config = crate::commands::config::get_config_snapshot();
            let user_name = config.user.name
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("user");

            // Resolve enabled groups from tool profile
            let enabled_groups = {
                let profile_name = &config.ai.tool_profile;
                if let Some(profile) = config.ai.tool_profiles.get(profile_name) {
                    profile.groups.join(",")
                } else {
                    // Fallback to default voice-assistant profile
                    "core,meta,screen,memory,browser".to_string()
                }
            };

            // Write MCP config files for all supported providers
            if let Some(ref root) = project_root {
                if let Err(e) = mcp_config::write_mcp_config(root, &enabled_groups) {
                    warn!("Failed to write MCP config: {}", e);
                }
                // Claude-only: configure status line (claude-pulse)
                if is_claude {
                    status_line::configure_status_line(root);
                }
            } else {
                warn!(
                    "No project root found — MCP tools will NOT be available to {}. \
                     Set VOICE_MIRROR_ROOT env var to the project directory.",
                    self.cli_config.display_name
                );
            }

            // Claude-only: append system prompt with voice mode instructions
            if is_claude {
                let instr = instructions::build_claude_instructions(user_name);
                dynamic_args.push("--append-system-prompt".to_string());
                dynamic_args.push(instr);
            }

            // Queue voice loop command — injected after the TUI signals ready.
            // The voice pipeline auto-starts in App.svelte, so voice_listen
            // will be available by the time Claude processes this command.
            {
                let voice_loop_cmd = instructions::build_voice_loop_command(user_name);
                let mut queue = self.ready_queue.lock().unwrap();
                queue.push(voice_loop_cmd);
            }
        }

        // Create the PTY system
        let pty_system = native_pty_system();

        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Build the command
        let mut cmd = CommandBuilder::new(&command);
        for arg in self.cli_config.args {
            cmd.arg(*arg);
        }
        // Add dynamic args (system prompt for Claude)
        for arg in &dynamic_args {
            cmd.arg(arg);
        }

        // Set working directory
        if let Some(ref dir) = work_dir {
            cmd.cwd(dir);
            info!("CLI provider cwd: {}", dir.display());
        }

        // Set environment variables for proper terminal rendering
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if supports_mcp {
            cmd.env("VOICE_MIRROR_SESSION", "true");
        }

        // Spawn the child process in the PTY
        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn {}: {}", self.cli_config.display_name, e))?;

        // Get the writer (master side of PTY for sending input)
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        // Get the reader (master side of PTY for receiving output)
        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        // Wrap writer in Arc<Mutex> so the reader thread can use it for ready queue
        let shared_writer = Arc::new(Mutex::new(writer));
        self.pty_writer = Some(shared_writer.clone());
        self.child = Some(child);
        self.running.store(true, Ordering::SeqCst);
        self.is_ready.store(false, Ordering::SeqCst);
        self.pty_pair_master = Some(pty_pair.master);

        // Notify that we're starting
        let _ = self.event_tx.send(ProviderEvent::Output(format!(
            "[{}] Starting interactive session...\n",
            self.cli_config.display_name
        )));

        // Spawn a thread to read PTY output
        let event_tx = self.event_tx.clone();
        let running = self.running.clone();
        let generation = self.generation.clone();
        let is_ready = self.is_ready.clone();
        let ready_queue = self.ready_queue.clone();
        let writer_for_ready = shared_writer.clone();
        let ready_delay_ms = self.cli_config.ready_delay_ms;
        let ready_patterns: Vec<String> = self
            .cli_config
            .ready_patterns
            .iter()
            .map(|s| s.to_string())
            .collect();
        let display_name = self.cli_config.display_name.to_string();

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut output_buffer = String::new();

            loop {
                // Check if generation changed (provider was stopped/restarted)
                if generation.load(Ordering::SeqCst) != my_gen {
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — process exited
                        break;
                    }
                    Ok(n) => {
                        // Drop output from stale session
                        if generation.load(Ordering::SeqCst) != my_gen {
                            break;
                        }

                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = event_tx.send(ProviderEvent::Output(data.clone()));

                        // Ready detection
                        if !is_ready.load(Ordering::SeqCst) {
                            output_buffer.push_str(&data);

                            // Strip ANSI escape sequences for pattern matching
                            let clean = strip_ansi_codes(&output_buffer);
                            let has_prompt = ready_patterns.iter().any(|p| clean.contains(p))
                                || clean.len() > 8000; // Fallback: if 8KB+ of clean output, TUI is definitely up

                            if has_prompt {
                                info!(
                                    "{} TUI ready detected (buffer {} bytes, clean {} bytes)",
                                    display_name, output_buffer.len(), clean.len()
                                );
                                is_ready.store(true, Ordering::SeqCst);
                                output_buffer.clear();
                                let _ = event_tx.send(ProviderEvent::Ready);

                                // Drain ready queue after configured delay
                                let writer_clone = writer_for_ready.clone();
                                let queue_clone = ready_queue.clone();
                                let gen_check = generation.clone();
                                std::thread::spawn(move || {
                                    // Wait for the TUI to settle
                                    std::thread::sleep(Duration::from_millis(ready_delay_ms));

                                    if gen_check.load(Ordering::SeqCst) != my_gen {
                                        return;
                                    }

                                    let items: Vec<String> = {
                                        let mut q = queue_clone.lock().unwrap();
                                        q.drain(..).collect()
                                    };

                                    if items.is_empty() {
                                        return;
                                    }

                                    if let Ok(mut w) = writer_clone.lock() {
                                        for text in items {
                                            let clean = text.trim_end_matches(['\r', '\n']);
                                            info!("Sending ready-queue item ({} bytes): {}...",
                                                clean.len(),
                                                &clean[..clean.len().min(60)]);
                                            let _ = w.write_all(clean.as_bytes());
                                            let _ = w.flush();
                                            // Give the TUI time to process the text before
                                            // pressing Enter — without this delay the \r
                                            // arrives in the same chunk and the TUI may not
                                            // register it as a submit action.
                                            std::thread::sleep(Duration::from_millis(200));
                                            let _ = w.write_all(b"\r");
                                            let _ = w.flush();
                                        }
                                    }
                                });
                            }
                        }
                    }
                    Err(e) => {
                        // Check if this is just because the PTY was closed
                        if generation.load(Ordering::SeqCst) != my_gen {
                            break;
                        }
                        let _ = event_tx.send(ProviderEvent::Error(format!(
                            "PTY read error: {}",
                            e
                        )));
                        break;
                    }
                }
            }

            // Only emit exit if we're still the active generation
            if generation.load(Ordering::SeqCst) == my_gen {
                running.store(false, Ordering::SeqCst);
                let _ = event_tx.send(ProviderEvent::Output(format!(
                    "\n[{}] Process exited\n",
                    display_name
                )));
                let _ = event_tx.send(ProviderEvent::Exit(0));
            }
        });

        self._reader_handle = Some(reader_handle);

        Ok(())
    }

    fn stop(&mut self) {
        // Bump generation FIRST — invalidates output callbacks from the dying PTY
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
        self.is_ready.store(false, Ordering::SeqCst);

        // Clear the ready queue
        {
            let mut queue = self.ready_queue.lock().unwrap();
            queue.clear();
        }

        // Clear any active voice_listen lock BEFORE killing the process.
        // The lock file grants exclusive listen access — if we don't clear it,
        // the next provider can't listen until the lock expires (310 seconds).
        {
            let lock_path = crate::services::inbox_watcher::get_mcp_data_dir()
                .join("listener_lock.json");
            if lock_path.exists() {
                match std::fs::remove_file(&lock_path) {
                    Ok(()) => info!("Cleared voice listener lock (provider stopping)"),
                    Err(e) => warn!("Failed to clear listener lock: {}", e),
                }
            }
        }

        // Kill the child process
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        // Drop the PTY resources
        self.pty_writer = None;
        self.pty_pair_master = None;
        self._reader_handle = None;
    }

    fn send_input(&mut self, data: &str) {
        if let Some(ref writer) = self.pty_writer {
            let writer = writer.clone();
            let text = data.trim_end_matches(['\r', '\n']).to_string();
            // TUI apps need a delay between text and carriage return —
            // they must process/render the text before receiving Enter.
            std::thread::spawn(move || {
                if let Ok(mut w) = writer.lock() {
                    let _ = w.write_all(text.as_bytes());
                    let _ = w.flush();
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
                if let Ok(mut w) = writer.lock() {
                    let _ = w.write_all(b"\r");
                    let _ = w.flush();
                }
            });
        }
    }

    fn send_raw_input(&mut self, data: &[u8]) {
        if let Some(ref writer) = self.pty_writer {
            if let Ok(mut w) = writer.lock() {
                let _ = w.write_all(data);
                let _ = w.flush();
            }
        }
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        if let Some(ref master) = self.pty_pair_master {
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn provider_type(&self) -> &str {
        &self.provider_type_id
    }

    fn display_name(&self) -> &str {
        self.cli_config.display_name
    }

    fn interrupt(&mut self) {
        // Send Ctrl+C to the PTY
        self.send_raw_input(b"\x03");
    }

    fn send_voice_loop(&mut self, sender_name: &str) {
        let prompt = format!(
            "Use voice_listen to wait for voice input from {}, then reply with voice_send. Loop forever.\n",
            sender_name
        );

        if self.provider_type_id == "opencode" {
            // OpenCode: send /new first to create a fresh session.
            // After model switches, MCP tools can become unavailable in the
            // current session. A new session forces tool re-discovery.
            if let Some(ref writer) = self.pty_writer {
                let writer = writer.clone();
                let voice_prompt = prompt.trim_end_matches(['\r', '\n']).to_string();
                std::thread::spawn(move || {
                    // Step 1: Send /new to create fresh session
                    if let Ok(mut w) = writer.lock() {
                        let _ = w.write_all(b"/new");
                        let _ = w.flush();
                    }
                    std::thread::sleep(Duration::from_millis(200));
                    if let Ok(mut w) = writer.lock() {
                        let _ = w.write_all(b"\r");
                        let _ = w.flush();
                    }

                    // Step 2: Wait for new session to initialize + MCP tools to re-list
                    std::thread::sleep(Duration::from_millis(2000));

                    // Step 3: Send the voice loop command
                    if let Ok(mut w) = writer.lock() {
                        let _ = w.write_all(voice_prompt.as_bytes());
                        let _ = w.flush();
                    }
                    std::thread::sleep(Duration::from_millis(200));
                    if let Ok(mut w) = writer.lock() {
                        let _ = w.write_all(b"\r");
                        let _ = w.flush();
                    }
                });
            }
        } else {
            // All other providers: just send the voice loop command
            self.send_input(&prompt);
        }
    }
}
