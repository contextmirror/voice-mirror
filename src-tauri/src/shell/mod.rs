//! Shell PTY management — independent terminal sessions for tabbed shell support.
//!
//! Each shell session owns a PTY pair (via `portable-pty`), a reader thread that
//! forwards stdout chunks as `ShellEvent`s, and a shared writer for sending input.
//! The `ShellManager` holds all active sessions and an async channel that the Tauri
//! setup hook drains into frontend events (`shell-output`).

use std::collections::HashMap;
use std::io::{Read, Write as IoWrite};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::util::find_project_root;

/// Event emitted by a shell session (sent to the frontend via Tauri events).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShellEvent {
    /// The session ID this event belongs to (e.g. "shell-1").
    pub id: String,
    /// Event type: "stdout" for output data, "exit" for process termination.
    #[serde(rename = "type")]
    pub event_type: String,
    /// Output text (present for "stdout" events).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Exit code (present for "exit" events).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

/// A single shell PTY session.
struct ShellSession {
    /// Shared PTY writer for sending input to the shell.
    writer: Arc<Mutex<Box<dyn IoWrite + Send>>>,
    /// Handle to the child process (for killing).
    child: Option<Box<dyn portable_pty::Child + Send>>,
    /// Whether this session is still running.
    running: Arc<AtomicBool>,
    /// PTY master handle (needed for resize).
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    /// Reader thread handle (kept alive; joined on kill).
    _reader_handle: Option<std::thread::JoinHandle<()>>,
}

/// Manages multiple independent shell terminal sessions.
pub struct ShellManager {
    /// Active sessions keyed by ID.
    sessions: HashMap<String, ShellSession>,
    /// Sender side of the event channel (cloned per session reader thread).
    event_tx: mpsc::UnboundedSender<ShellEvent>,
    /// Receiver side — taken once during Tauri setup for the forwarding loop.
    event_rx: Option<mpsc::UnboundedReceiver<ShellEvent>>,
    /// Monotonic counter for generating unique session IDs.
    next_id: u64,
}

/// Find Git Bash on Windows by locating `git.exe` in PATH and deriving the bash path.
/// Falls back to common install locations.
#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<String> {
    // Try to find git.exe via PATH
    if let Ok(output) = std::process::Command::new("where")
        .arg("git.exe")
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(git_path) = stdout.lines().next() {
                // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
                // bash.exe is at:          C:\Program Files\Git\bin\bash.exe
                let git_exe = std::path::Path::new(git_path.trim());
                if let Some(cmd_dir) = git_exe.parent() {
                    if let Some(git_root) = cmd_dir.parent() {
                        let bash = git_root.join("bin").join("bash.exe");
                        if bash.exists() {
                            return Some(bash.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    // Try common install locations
    for path in &[
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ] {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}

impl ShellManager {
    /// Create a new ShellManager with a fresh event channel.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            sessions: HashMap::new(),
            event_tx: tx,
            event_rx: Some(rx),
            next_id: 1,
        }
    }

    /// Take the event receiver. Called once during Tauri `.setup()` to start the
    /// forwarding loop. Returns `None` on subsequent calls.
    pub fn take_event_rx(&mut self) -> Option<mpsc::UnboundedReceiver<ShellEvent>> {
        self.event_rx.take()
    }

    /// Spawn a new shell PTY session.
    ///
    /// Returns the session ID (e.g. "shell-1") on success.
    pub fn spawn(&mut self, cols: u16, rows: u16, cwd: Option<String>) -> Result<String, String> {
        let id = format!("shell-{}", self.next_id);
        self.next_id += 1;

        // Create the PTY pair
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Determine the shell command based on platform.
        // Windows: prefer Git Bash (like OpenCode), fall back to PowerShell.
        // macOS: use $SHELL (default zsh).
        // Linux: use $SHELL (default bash).
        let shell = if cfg!(target_os = "windows") {
            #[cfg(target_os = "windows")]
            {
                find_git_bash().unwrap_or_else(|| "powershell.exe".to_string())
            }
            #[cfg(not(target_os = "windows"))]
            {
                unreachable!()
            }
        } else if cfg!(target_os = "macos") {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        };

        let mut cmd = CommandBuilder::new(&shell);

        // Pass login + interactive flags for bash/zsh shells
        let shell_lower = shell.to_lowercase();
        if shell_lower.contains("bash") || shell_lower.contains("zsh") {
            cmd.arg("--login");
            cmd.arg("-i");
        }

        // Set working directory: explicit cwd > project root > home directory
        let work_dir = cwd
            .map(std::path::PathBuf::from)
            .or_else(find_project_root)
            .or_else(dirs::home_dir);
        if let Some(ref dir) = work_dir {
            cmd.cwd(dir);
        }

        // Environment for proper terminal rendering
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // UTF-8 locale for Windows terminals
        if cfg!(target_os = "windows") {
            cmd.env("LC_ALL", "C.UTF-8");
            cmd.env("LC_CTYPE", "C.UTF-8");
            cmd.env("LANG", "C.UTF-8");

            // Set CLAUDE_CODE_GIT_BASH_PATH so Claude Code works inside our shell
            if shell_lower.contains("bash") {
                cmd.env("CLAUDE_CODE_GIT_BASH_PATH", &shell);
            }
        }

        // Spawn the child process
        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell '{}': {}", shell, e))?;

        // Get the writer (master side — for sending input)
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        // Get the reader (master side — for receiving output)
        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let shared_writer = Arc::new(Mutex::new(writer));
        let running = Arc::new(AtomicBool::new(true));

        // Spawn reader thread: reads PTY output in 4KB chunks, forwards as events
        let event_tx = self.event_tx.clone();
        let session_id = id.clone();
        let thread_running = running.clone();

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — shell exited
                        break;
                    }
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = event_tx.send(ShellEvent {
                            id: session_id.clone(),
                            event_type: "stdout".to_string(),
                            text: Some(text),
                            code: None,
                        });
                    }
                    Err(e) => {
                        if thread_running.load(Ordering::SeqCst) {
                            warn!("Shell {} PTY read error: {}", session_id, e);
                        }
                        break;
                    }
                }
            }

            // Emit exit event
            thread_running.store(false, Ordering::SeqCst);
            let _ = event_tx.send(ShellEvent {
                id: session_id.clone(),
                event_type: "exit".to_string(),
                text: None,
                code: Some(0),
            });

            info!("Shell {} reader thread ended", session_id);
        });

        let session = ShellSession {
            writer: shared_writer,
            child: Some(child),
            running,
            master: Some(pty_pair.master),
            _reader_handle: Some(reader_handle),
        };

        info!("Spawned shell session '{}' (shell={}, cols={}, rows={})", id, shell, cols, rows);
        self.sessions.insert(id.clone(), session);
        Ok(id)
    }

    /// Send raw input bytes to a shell session.
    pub fn send_input(&mut self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Shell session '{}' not found", id))?;

        let mut writer = session
            .writer
            .lock()
            .map_err(|e| format!("Failed to lock writer for '{}': {}", id, e))?;

        writer
            .write_all(data)
            .map_err(|e| format!("Failed to write to '{}': {}", id, e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush '{}': {}", id, e))?;

        Ok(())
    }

    /// Resize a shell session's PTY.
    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Shell session '{}' not found", id))?;

        if let Some(ref master) = session.master {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize '{}': {}", id, e))?;
        }

        Ok(())
    }

    /// Kill a shell session and remove it from the manager.
    pub fn kill(&mut self, id: &str) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(id)
            .ok_or_else(|| format!("Shell session '{}' not found", id))?;

        session.running.store(false, Ordering::SeqCst);

        if let Some(mut child) = session.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        // Drop PTY resources (writer, master) — this will cause the reader thread
        // to get an EOF or error on its next read, ending the thread naturally.
        drop(session.writer);
        session.master = None;
        session._reader_handle = None;

        info!("Killed shell session '{}'", id);
        Ok(())
    }

    /// Kill all active shell sessions.
    pub fn kill_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Err(e) = self.kill(&id) {
                warn!("Failed to kill shell session '{}': {}", id, e);
            }
        }
    }

    /// List IDs of all active shell sessions.
    pub fn list(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }
}

impl Default for ShellManager {
    fn default() -> Self {
        Self::new()
    }
}
