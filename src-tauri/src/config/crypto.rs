//! DPAPI-based encryption for sensitive config values (API keys).
//!
//! Reuses the same AES-256-GCM + DPAPI key infrastructure from `auth_vault`.
//! Encrypted values are prefixed with `ENC:` followed by base64-encoded
//! `nonce (12 bytes) ++ ciphertext`, making them distinguishable from
//! plaintext values on disk.
//!
//! The encryption key is stored in `{config_dir}/.vault_key`, protected
//! with Windows DPAPI so only the current user session can decrypt.

use std::path::Path;

use tracing::{info, warn};

use crate::services::auth_vault;

/// Prefix for encrypted values in config.json.
const ENC_PREFIX: &str = "ENC:";

/// Key file name within the config directory.
const KEY_FILENAME: &str = ".vault_key";

/// Encrypt a plaintext API key. Returns `"ENC:<base64>"`.
///
/// If encryption fails (e.g. DPAPI unavailable), returns the original
/// plaintext so the app continues to work — just without at-rest protection.
pub fn encrypt_value(plaintext: &str, key: &[u8; 32]) -> String {
    if plaintext.is_empty() {
        return String::new();
    }
    match auth_vault::encrypt_data(plaintext.as_bytes(), key) {
        Ok(encrypted) => {
            let b64 = crate::voice::tts::crypto::base64_encode(&encrypted);
            format!("{}{}", ENC_PREFIX, b64)
        }
        Err(e) => {
            warn!("Failed to encrypt config value: {} — storing plaintext", e);
            plaintext.to_string()
        }
    }
}

/// Decrypt an encrypted value. Accepts both `"ENC:<base64>"` and plain strings.
///
/// - `"ENC:..."` → decrypt and return plaintext
/// - Anything else → return as-is (legacy plaintext / empty)
pub fn decrypt_value(stored: &str, key: &[u8; 32]) -> String {
    if stored.is_empty() {
        return String::new();
    }
    let Some(b64) = stored.strip_prefix(ENC_PREFIX) else {
        // Not encrypted — legacy plaintext value
        return stored.to_string();
    };
    let encrypted = match crate::voice::tts::crypto::base64_decode(b64) {
        Ok(bytes) => bytes,
        Err(e) => {
            warn!("Failed to decode encrypted config value: {} — returning empty", e);
            return String::new();
        }
    };
    match auth_vault::decrypt_data(&encrypted, key) {
        Ok(plaintext) => String::from_utf8(plaintext).unwrap_or_default(),
        Err(e) => {
            warn!("Failed to decrypt config value: {} — returning empty", e);
            String::new()
        }
    }
}

/// Check if a value is already encrypted.
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENC_PREFIX)
}

/// Load or create the vault key for config encryption.
///
/// Uses the same DPAPI-protected key pattern as auth_vault, but stored
/// in the config directory alongside config.json.
pub fn ensure_config_key(config_dir: &Path) -> Result<[u8; 32], String> {
    let key_path = config_dir.join(KEY_FILENAME);
    if key_path.exists() {
        auth_vault::load_key_from(config_dir, KEY_FILENAME)
    } else {
        info!("Creating new vault key for config encryption");
        let key = auth_vault::generate_key();
        auth_vault::save_key_to(config_dir, KEY_FILENAME, &key)?;
        Ok(key)
    }
}

/// Mask an API key for display. Shows first 7 and last 4 characters.
/// Returns `None` for empty/unset keys.
///
/// Example: `"sk-ant-api03-abc123...xyz"` → `"sk-ant-•••••xyz"`
pub fn mask_api_key(key: &str) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    let len = key.len();
    if len <= 11 {
        // Too short to meaningfully mask — just show dots
        return Some("•••••".to_string());
    }
    let prefix = &key[..7];
    let suffix = &key[len - 4..];
    Some(format!("{}•••••{}", prefix, suffix))
}
