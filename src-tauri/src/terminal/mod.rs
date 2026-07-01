//! Terminal PTY management — independent terminal sessions for tabbed terminal support.
//!
//! Each terminal session owns a PTY pair (via `portable-pty`), a reader thread that
//! forwards stdout chunks as `TerminalEvent`s, and a shared writer for sending input.
//! The `TerminalManager` holds all active sessions and an async channel that the Tauri
//! setup hook drains into frontend events (`terminal-output`).

use std::collections::HashMap;
use std::io::{Read, Write as IoWrite};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::util::find_project_root;

/// A detected terminal profile (shell) available on the system.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TerminalProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub args: Vec<String>,
    pub icon: String,
    pub color: Option<String>,
    pub is_default: bool,
    pub is_builtin: bool,
}

/// Event emitted by a terminal session (sent to the frontend via Tauri events).
#[derive(Clone, serde::Serialize)]
pub struct TerminalEvent {
    /// The session ID this event belongs to (e.g. "terminal-1").
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
    /// Project output channel label (for forwarding loop to do project logging).
    #[serde(skip)]
    pub output_channel: Option<String>,
    /// Project output store reference (for forwarding loop to do project logging).
    #[serde(skip)]
    pub output_store: Option<std::sync::Arc<crate::services::output::OutputStore>>,
}

impl std::fmt::Debug for TerminalEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TerminalEvent")
            .field("id", &self.id)
            .field("event_type", &self.event_type)
            .field("text", &self.text.as_deref().map(|t| &t[..t.len().min(64)]))
            .field("code", &self.code)
            .field("output_channel", &self.output_channel)
            .finish_non_exhaustive()
    }
}

/// A single terminal PTY session.
struct TerminalSession {
    /// Shared PTY writer for sending input to the terminal.
    writer: Arc<Mutex<Box<dyn IoWrite + Send>>>,
    /// Handle to the child process (for killing).
    child: Option<Box<dyn portable_pty::Child + Send>>,
    /// Whether this session is still running.
    running: Arc<AtomicBool>,
    /// PTY master handle (needed for resize).
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    /// Reader thread handle (kept alive; joined on kill).
    _reader_handle: Option<std::thread::JoinHandle<()>>,
    /// If set, PTY output is also mirrored to this project output channel.
    #[allow(dead_code)]
    output_channel: Option<String>,
}

/// Manages multiple independent terminal sessions.
pub struct TerminalManager {
    /// Active sessions keyed by ID.
    sessions: HashMap<String, TerminalSession>,
    /// Sender side of the event channel (cloned per session reader thread).
    event_tx: mpsc::Sender<TerminalEvent>,
    /// Receiver side — taken once during Tauri setup for the forwarding loop.
    event_rx: Option<mpsc::Receiver<TerminalEvent>>,
    /// Monotonic counter for generating unique session IDs.
    next_id: u64,
}

/// Find Git Bash on Windows by locating `git.exe` in PATH and deriving the bash path.
/// Falls back to common install locations.
#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<String> {
    // Try to find git.exe via PATH
    let mut where_cmd = std::process::Command::new("where");
    where_cmd.arg("git.exe");
    crate::util::hidden(&mut where_cmd);
    if let Ok(output) = where_cmd.output() {
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

/// Detect an HTTP 4xx/5xx status code appearing as a standalone whitespace token.
///
/// Matches exactly-3-digit tokens starting with `4` or `5` (e.g. `404`, `500`).
/// Deliberately conservative: `5173` (4 digits, a port) and `450ms` (not pure
/// digits) are rejected so durations/ports don't masquerade as errors.
fn has_http_error_status(line: &str) -> bool {
    line.split(char::is_whitespace).any(|tok| {
        tok.len() == 3
            && matches!(tok.as_bytes()[0], b'4' | b'5')
            && tok.bytes().all(|b| b.is_ascii_digit())
    })
}

/// Classify a terminal output line into a log level based on content heuristics.
///
/// Recognizes a handful of solid framework/tooling signals rather than a broad
/// `contains("error")` guess (which flagged benign lines like "0 errors").
pub(crate) fn classify_terminal_line(line: &str) -> &'static str {
    // Leading LEVEL token, tolerating a leading '[' (e.g. "[ERROR]", "WARN:", "DEBUG ...").
    let head = line.trim_start().trim_start_matches('[');
    let head_upper: String = head.chars().take(6).collect::<String>().to_ascii_uppercase();
    if head_upper.starts_with("ERROR") || head_upper.starts_with("FATAL") {
        return "ERROR";
    }
    if head_upper.starts_with("WARN") {
        return "WARN";
    }
    if head_upper.starts_with("DEBUG") {
        return "DEBUG";
    }
    if head_upper.starts_with("TRACE") {
        return "TRACE";
    }

    let lower = line.to_ascii_lowercase();

    // Strong ERROR signals from common frameworks/toolchains.
    if lower.contains("panicked at")      // Rust panic
        || lower.contains("error[e")      // rustc diagnostic code, e.g. error[E0308]
        || lower.contains("err!")         // npm ERR!
        || lower.contains("[error]")
        || lower.contains(" error ")
        || lower.contains("error:")
        || lower.contains("failed")
        || lower.contains("unhandled")
        || lower.contains("uncaught")
        || line.trim_start().starts_with('✘')
        || has_http_error_status(line)
    {
        return "ERROR";
    }

    // WARN signals (covers "WARN", "warning:", "[vite] warning", "deprecated").
    if lower.contains("warn") || lower.contains("deprecat") {
        return "WARN";
    }

    // Noisy vite/HMR chatter → DEBUG so it can be filtered out with the level picker.
    if lower.contains("[vite]") || lower.contains("[hmr]") || lower.contains("hmr update") {
        return "DEBUG";
    }

    "INFO"
}

impl TerminalManager {
    /// Create a new TerminalManager with a fresh event channel.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(2048);
        Self {
            sessions: HashMap::new(),
            event_tx: tx,
            event_rx: Some(rx),
            next_id: 1,
        }
    }

    /// Take the event receiver. Called once during Tauri `.setup()` to start the
    /// forwarding loop. Returns `None` on subsequent calls.
    pub fn take_event_rx(&mut self) -> Option<mpsc::Receiver<TerminalEvent>> {
        self.event_rx.take()
    }

    /// Detect available terminal profiles (shells) on the system.
    pub fn detect_profiles(&self) -> Vec<TerminalProfile> {
        let mut profiles = Vec::new();

        #[cfg(target_os = "windows")]
        {
            // Git Bash
            if let Some(bash_path) = find_git_bash() {
                profiles.push(TerminalProfile {
                    id: "git-bash".to_string(),
                    name: "Git Bash".to_string(),
                    path: bash_path,
                    args: vec!["--login".to_string(), "-i".to_string()],
                    icon: "terminal-bash".to_string(),
                    color: None,
                    is_default: true,
                    is_builtin: true,
                });
            }

            // PowerShell Core (pwsh)
            let mut pwsh_cmd = std::process::Command::new("where");
            pwsh_cmd.arg("pwsh.exe");
            crate::util::hidden(&mut pwsh_cmd);
            if let Ok(output) = pwsh_cmd.output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Some(path) = stdout.lines().next() {
                        profiles.push(TerminalProfile {
                            id: "powershell-core".to_string(),
                            name: "PowerShell".to_string(),
                            path: path.trim().to_string(),
                            args: vec![],
                            icon: "terminal-powershell".to_string(),
                            color: None,
                            is_default: profiles.is_empty(),
                            is_builtin: true,
                        });
                    }
                }
            }

            // Windows PowerShell (fallback — only if no PowerShell Core found)
            if !profiles.iter().any(|p| p.id.starts_with("powershell")) {
                let mut ps_cmd = std::process::Command::new("where");
                ps_cmd.arg("powershell.exe");
                crate::util::hidden(&mut ps_cmd);
                if let Ok(output) = ps_cmd.output() {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if let Some(path) = stdout.lines().next() {
                            profiles.push(TerminalProfile {
                                id: "powershell".to_string(),
                                name: "Windows PowerShell".to_string(),
                                path: path.trim().to_string(),
                                args: vec![],
                                icon: "terminal-powershell".to_string(),
                                color: None,
                                is_default: profiles.is_empty(),
                                is_builtin: true,
                            });
                        }
                    }
                }
            }

            // Command Prompt
            if let Some(comspec) = std::env::var_os("COMSPEC") {
                profiles.push(TerminalProfile {
                    id: "cmd".to_string(),
                    name: "Command Prompt".to_string(),
                    path: comspec.to_string_lossy().to_string(),
                    args: vec![],
                    icon: "terminal-cmd".to_string(),
                    color: None,
                    is_default: profiles.is_empty(),
                    is_builtin: true,
                });
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let default_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

            // Default shell
            let shell_name = std::path::Path::new(&default_shell)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            profiles.push(TerminalProfile {
                id: shell_name.clone(),
                name: shell_name.clone(),
                path: default_shell.clone(),
                args: vec!["--login".to_string(), "-i".to_string()],
                icon: format!("terminal-{}", shell_name),
                color: None,
                is_default: true,
                is_builtin: true,
            });

            // Read /etc/shells for additional shells
            if let Ok(shells_content) = std::fs::read_to_string("/etc/shells") {
                for line in shells_content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') { continue; }
                    if line == default_shell { continue; } // already added
                    let name = std::path::Path::new(line)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    // Skip duplicates by name
                    if profiles.iter().any(|p| p.name == name) { continue; }
                    profiles.push(TerminalProfile {
                        id: name.clone(),
                        name: name.clone(),
                        path: line.to_string(),
                        args: vec![],
                        icon: format!("terminal-{}", name),
                        color: None,
                        is_default: false,
                        is_builtin: true,
                    });
                }
            }
        }

        profiles
    }

    /// Spawn a new terminal PTY session.
    ///
    /// Returns `(session_id, profile_name)` on success.
    /// If `profile_id` is given, uses the matching profile's shell and args.
    /// If `output_channel` is given, PTY stdout is also mirrored to that project output channel.
    pub fn spawn(
        &mut self,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        profile_id: Option<String>,
        output_channel: Option<String>,
        env: Option<std::collections::HashMap<String, String>>,
        output_store: Option<Arc<crate::services::output::OutputStore>>,
    ) -> Result<(String, Option<String>), String> {
        let id = format!("terminal-{}", self.next_id);
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

        // Determine the shell command and args.
        // If a profile_id is provided, look it up; otherwise use platform defaults.
        let (shell, shell_args, profile_name) = if let Some(ref pid) = profile_id {
            let profiles = self.detect_profiles();
            if let Some(prof) = profiles.iter().find(|p| p.id == *pid) {
                (prof.path.clone(), prof.args.clone(), Some(prof.name.clone()))
            } else {
                warn!("Profile '{}' not found, falling back to default shell", pid);
                // Fall back to default platform detection
                let default_shell = if cfg!(target_os = "windows") {
                    #[cfg(target_os = "windows")]
                    { find_git_bash().unwrap_or_else(|| "powershell.exe".to_string()) }
                    #[cfg(not(target_os = "windows"))]
                    { unreachable!() }
                } else if cfg!(target_os = "macos") {
                    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
                } else {
                    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
                };
                let default_lower = default_shell.to_lowercase();
                let args = if default_lower.contains("bash") || default_lower.contains("zsh") {
                    vec!["--login".to_string(), "-i".to_string()]
                } else {
                    vec![]
                };
                (default_shell, args, None)
            }
        } else {
            // No profile — use platform defaults
            let default_shell = if cfg!(target_os = "windows") {
                #[cfg(target_os = "windows")]
                { find_git_bash().unwrap_or_else(|| "powershell.exe".to_string()) }
                #[cfg(not(target_os = "windows"))]
                { unreachable!() }
            } else if cfg!(target_os = "macos") {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
            };
            let default_lower = default_shell.to_lowercase();
            let args = if default_lower.contains("bash") || default_lower.contains("zsh") {
                vec!["--login".to_string(), "-i".to_string()]
            } else {
                vec![]
            };
            (default_shell, args, None)
        };

        let mut cmd = CommandBuilder::new(&shell);

        // Apply shell args from profile or default detection
        for arg in &shell_args {
            cmd.arg(arg);
        }
        let shell_lower = shell.to_lowercase();

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

        // Neutralize Voice Mirror's OWN WebView2 debug args before they leak into
        // child shells. The host sets
        //   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
        // process-wide (lib.rs) for its embedded DevTools. That env is inherited
        // by every PTY child, so a Tauri app launched in a terminal would try to
        // bind Voice Mirror's OWN CDP port (9222) — which is already taken, so the
        // app gets NO debuggable port at all and the sandbox tools can't drive it.
        // Clear it unless the caller (dev-server-manager) supplies a dedicated,
        // per-app debug port below.
        let caller_sets_webview2 = env
            .as_ref()
            .map(|e| e.contains_key("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"))
            .unwrap_or(false);
        if !caller_sets_webview2 {
            cmd.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "");
        }

        // Caller-provided environment (e.g. WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
        // to enable CDP remote debugging on a Tauri app being built). Applied last
        // so it can override the defaults above; inherited by child processes
        // (npm -> cargo -> the built app.exe).
        if let Some(env_vars) = &env {
            for (k, v) in env_vars {
                cmd.env(k, v);
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
        let output_channel_clone = output_channel.clone();
        let output_store_clone = output_store;

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — terminal exited
                        break;
                    }
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();

                        if event_tx.try_send(TerminalEvent {
                            id: session_id.clone(),
                            event_type: "stdout".to_string(),
                            text: Some(text),
                            code: None,
                            output_channel: output_channel_clone.clone(),
                            output_store: output_store_clone.clone(),
                        }).is_err() {
                            warn!("Terminal {} channel full, dropping {} bytes", session_id, n);
                        }
                    }
                    Err(e) => {
                        if thread_running.load(Ordering::SeqCst) {
                            warn!("Terminal {} PTY read error: {}", session_id, e);
                        }
                        break;
                    }
                }
            }

            // Emit exit event
            thread_running.store(false, Ordering::SeqCst);
            if event_tx.try_send(TerminalEvent {
                id: session_id.clone(),
                event_type: "exit".to_string(),
                text: None,
                code: Some(0),
                output_channel: None,
                output_store: None,
            }).is_err() {
                warn!("Terminal {} channel full, dropping exit event", session_id);
            }

            info!("Terminal {} reader thread ended", session_id);
        });

        let session = TerminalSession {
            writer: shared_writer,
            child: Some(child),
            running,
            master: Some(pty_pair.master),
            _reader_handle: Some(reader_handle),
            output_channel,
        };

        info!("Spawned terminal session '{}' (shell={}, profile={:?}, cols={}, rows={})", id, shell, profile_name, cols, rows);
        self.sessions.insert(id.clone(), session);
        Ok((id, profile_name))
    }

    /// Send raw input bytes to a terminal session.
    pub fn send_input(&mut self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Terminal session '{}' not found", id))?;

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

    /// Resize a terminal session's PTY.
    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Terminal session '{}' not found", id))?;

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

    /// Kill a terminal session and remove it from the manager.
    pub fn kill(&mut self, id: &str) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(id)
            .ok_or_else(|| format!("Terminal session '{}' not found", id))?;

        session.running.store(false, Ordering::SeqCst);

        // Get PID before killing (needed for process-tree kill on Windows).
        let pid = session.child.as_ref().and_then(|c| c.process_id());

        // Drop PTY resources FIRST — this signals EOF to the reader thread
        // and closes the ConPTY, which in turn signals child processes to exit.
        drop(session.writer);
        session.master = None;

        // On Windows, kill the entire process tree so child processes (e.g. node
        // running a dev server) are also terminated. `TerminateProcess` alone only
        // kills the top-level shell, leaving orphan node processes.
        #[cfg(windows)]
        if let Some(p) = pid {
            info!("Killing process tree for PID {} (session '{}')", p, id);
            let mut kill_cmd = std::process::Command::new("taskkill");
            kill_cmd.args(["/PID", &p.to_string(), "/T", "/F"]);
            crate::util::hidden(&mut kill_cmd);
            let _ = kill_cmd.output();
        }

        if let Some(mut child) = session.child.take() {
            let _ = child.kill();
            // Use try_wait in a loop with timeout instead of blocking forever.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    _ => {
                        warn!("Terminal '{}' did not exit within 3s, abandoning wait", id);
                        break;
                    }
                }
            }
        }

        session._reader_handle = None;

        info!("Killed terminal session '{}'", id);
        Ok(())
    }

    /// Kill all active terminal sessions.
    pub fn kill_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Err(e) = self.kill(&id) {
                warn!("Failed to kill terminal session '{}': {}", id, e);
            }
        }
    }

    /// List IDs of all active terminal sessions.
    pub fn list(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_terminal_line, has_http_error_status};

    #[test]
    fn error_signals() {
        assert_eq!(classify_terminal_line("thread 'main' panicked at src/x.rs:1"), "ERROR");
        assert_eq!(classify_terminal_line("error[E0308]: mismatched types"), "ERROR");
        assert_eq!(classify_terminal_line("npm ERR! code ELIFECYCLE"), "ERROR");
        assert_eq!(classify_terminal_line("[ERROR] build failed"), "ERROR");
        assert_eq!(classify_terminal_line("Error: cannot find module"), "ERROR");
        assert_eq!(classify_terminal_line("Uncaught TypeError: x is undefined"), "ERROR");
        assert_eq!(classify_terminal_line("GET /api/users 500 12ms"), "ERROR");
        assert_eq!(classify_terminal_line("POST /login 404 3ms"), "ERROR");
        assert_eq!(classify_terminal_line("✘ [ERROR] Build failed"), "ERROR");
    }

    #[test]
    fn warn_signals() {
        assert_eq!(classify_terminal_line("WARN something is off"), "WARN");
        assert_eq!(classify_terminal_line("warning: unused variable"), "WARN");
        assert_eq!(classify_terminal_line("[vite] warning: deprecated api"), "WARN");
        assert_eq!(classify_terminal_line("package is deprecated"), "WARN");
    }

    #[test]
    fn leading_level_token() {
        assert_eq!(classify_terminal_line("DEBUG connecting to db"), "DEBUG");
        assert_eq!(classify_terminal_line("TRACE entering fn"), "TRACE");
        assert_eq!(classify_terminal_line("[INFO] listening on 5173"), "INFO");
    }

    #[test]
    fn benign_lines_are_info_or_debug() {
        // "0 errors" no longer trips the ERROR heuristic (it uses precise signals).
        assert_eq!(classify_terminal_line("Compiled successfully, 0 errors"), "INFO");
        assert_eq!(classify_terminal_line("Local:   http://localhost:5173/"), "INFO");
        // Vite/HMR chatter is demoted to DEBUG so it can be filtered out.
        assert_eq!(classify_terminal_line("[vite] hmr update /src/App.svelte"), "DEBUG");
    }

    #[test]
    fn http_status_detection_is_conservative() {
        assert!(has_http_error_status("GET / 404"));
        assert!(has_http_error_status("500 internal"));
        // Ports (4 digits) and durations (not pure digits) must NOT match.
        assert!(!has_http_error_status("listening on 5173"));
        assert!(!has_http_error_status("took 450ms"));
        assert!(!has_http_error_status("200 OK"));
    }
}
