use std::path::PathBuf;

/// App name used in platform paths.
const APP_NAME: &str = "voice-mirror";

/// Get the platform-appropriate configuration directory.
///
/// - Windows: `%APPDATA%\voice-mirror\`
/// - macOS:   `~/Library/Application Support/voice-mirror/`
/// - Linux:   `~/.config/voice-mirror/`
pub fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_NAME)
}

/// Get the platform-appropriate data directory.
///
/// - Windows: `%APPDATA%\voice-mirror\data\`
/// - macOS:   `~/Library/Application Support/voice-mirror/data/`
/// - Linux:   `~/.local/share/voice-mirror/data/`
pub fn get_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(get_config_dir)
        .join(APP_NAME)
        .join("data")
}

/// Get the platform-appropriate log directory.
///
/// - Windows: `%APPDATA%\voice-mirror\logs\`
/// - macOS:   `~/Library/Application Support/voice-mirror/logs\`
/// - Linux:   `~/.local/share/voice-mirror/logs/`
///
/// Falls back to `{data_dir}/logs` if data_dir is available.
pub fn get_log_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(get_config_dir)
        .join(APP_NAME)
        .join("logs")
}

/// Get the data directory with fallback to the Electron app's data dir.
///
/// Checks the primary Tauri data dir first. If its `models/` subdirectory
/// doesn't exist, falls back to the Electron data dir where models were
/// previously downloaded.
pub fn get_data_dir_with_fallback() -> PathBuf {
    let primary = get_data_dir();
    if primary.join("models").exists() {
        return primary;
    }
    // Fallback: check Electron data directory
    if let Some(roaming) = dirs::data_dir() {
        let electron = roaming.join("voice-mirror-electron").join("data");
        if electron.join("models").exists() {
            tracing::info!(
                "Using Electron model directory: {}",
                electron.display()
            );
            return electron;
        }
    }
    primary
}

/// Get the platform-appropriate cache directory.
///
/// - Windows: `%LOCALAPPDATA%\voice-mirror\cache\`
/// - macOS:   `~/Library/Caches/voice-mirror/`
/// - Linux:   `~/.cache/voice-mirror/`
pub fn get_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| get_config_dir().join("cache"))
        .join(APP_NAME)
}

/// Get the OS name as a string matching the Electron convention.
pub fn get_os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Get the CPU architecture as a string.
pub fn get_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        std::env::consts::ARCH
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_dir_contains_app_name() {
        let dir = get_config_dir();
        assert!(dir.to_string_lossy().contains(APP_NAME));
    }

    #[test]
    fn test_data_dir_contains_app_name() {
        let dir = get_data_dir();
        assert!(dir.to_string_lossy().contains(APP_NAME));
    }

    #[test]
    fn test_log_dir_contains_app_name() {
        let dir = get_log_dir();
        assert!(dir.to_string_lossy().contains(APP_NAME));
    }

    #[test]
    fn test_cache_dir_contains_app_name() {
        let dir = get_cache_dir();
        assert!(dir.to_string_lossy().contains(APP_NAME));
    }

    #[test]
    fn test_os_name_valid() {
        let os = get_os_name();
        assert!(
            os == "windows" || os == "macos" || os == "linux",
            "unexpected os: {}",
            os
        );
    }

    #[test]
    fn test_arch_valid() {
        let arch = get_arch();
        assert!(
            !arch.is_empty(),
            "arch should not be empty"
        );
    }
}
