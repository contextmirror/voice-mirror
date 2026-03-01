use std::path::PathBuf;
use tracing::{info, warn};

/// Strip ANSI escape sequences from a string.
///
/// Handles CSI sequences (ESC [ ... final_byte), OSC sequences (ESC ] ... ST),
/// and simple two-byte escapes (ESC char).
pub fn strip_ansi_codes(input: &str) -> String {
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

/// Escape a string for safe embedding inside a JS single-quoted string literal.
pub fn escape_js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

/// Check if a directory looks like the Voice Mirror project root.
pub fn is_project_root(path: &std::path::Path) -> bool {
    path.join("src-tauri").join("tauri.conf.json").exists()
}

/// Resolve the Voice Mirror project root directory.
///
/// Search order:
/// 1. `VOICE_MIRROR_ROOT` env var (explicit override — always wins)
/// 2. Walk up from executable path (works in dev: target/debug → project root)
/// 3. Walk up from current working directory
/// 4. Common dev path: walk up from exe looking for `package.json` with "voice-mirror"
///
/// Validates by checking for `src-tauri/tauri.conf.json`.
pub fn find_project_root() -> Option<PathBuf> {
    // 1. Explicit env var override
    if let Ok(root) = std::env::var("VOICE_MIRROR_ROOT") {
        let path = PathBuf::from(&root);
        if is_project_root(&path) {
            info!("Project root from VOICE_MIRROR_ROOT: {}", path.display());
            return Some(path);
        }
        warn!(
            "VOICE_MIRROR_ROOT={} does not contain src-tauri/tauri.conf.json",
            root
        );
    }

    // 2. Walk up from executable path (dev: target/debug/release, up to 8 levels)
    if let Ok(exe) = std::env::current_exe() {
        let mut path = exe.clone();
        for _ in 0..8 {
            if !path.pop() {
                break;
            }
            if is_project_root(&path) {
                info!("Project root from exe walk-up: {}", path.display());
                return Some(path);
            }
        }
    }

    // 3. Walk up from current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.clone();
        for _ in 0..4 {
            if is_project_root(&path) {
                info!("Project root from cwd walk-up: {}", path.display());
                return Some(path);
            }
            if !path.pop() {
                break;
            }
        }
    }

    warn!(
        "Could not find project root (src-tauri/tauri.conf.json). \
         MCP tools will NOT be available. Set VOICE_MIRROR_ROOT env var \
         or run from the project directory."
    );
    None
}
