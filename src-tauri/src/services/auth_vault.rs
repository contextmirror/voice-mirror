//! Encrypted credential vault for browser auto-login.
//!
//! Stores website login credentials (username + password) encrypted with
//! AES-256-GCM. Each profile is a JSON file on disk with the sensitive
//! fields encrypted; a 256-bit key is stored separately in `.key`.
//!
//! The nonce (12 bytes, random per encryption) is prepended to the
//! ciphertext so that decrypt only needs the key.

use std::fs;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A decrypted auth profile (plaintext in memory, encrypted on disk).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthProfile {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub selectors: Option<AuthSelectors>,
    pub created_at: String,
    pub last_login_at: Option<String>,
}

/// Optional CSS selectors for auto-filling login forms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSelectors {
    pub username_selector: Option<String>,
    pub password_selector: Option<String>,
    pub submit_selector: Option<String>,
}

// ---------------------------------------------------------------------------
// On-disk format (encrypted fields)
// ---------------------------------------------------------------------------

/// The serialized form written to `{auth_dir}/{name}.json`.
/// Username and password are AES-256-GCM encrypted + base64-encoded.
#[derive(Serialize, Deserialize)]
struct EncryptedProfile {
    name: String,
    url: String,
    /// Base64 of (nonce ++ ciphertext) for the username.
    username_enc: String,
    /// Base64 of (nonce ++ ciphertext) for the password.
    password_enc: String,
    /// Base64 of the nonce used (stored for reference / debugging).
    nonce: String,
    selectors: Option<AuthSelectors>,
    created_at: String,
    last_login_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

const KEY_FILENAME: &str = ".key";

/// Generate a random 256-bit encryption key.
pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

/// Save a 256-bit key to `{auth_dir}/.key`.
pub fn save_key(auth_dir: &Path, key: &[u8; 32]) -> Result<(), String> {
    fs::create_dir_all(auth_dir).map_err(|e| format!("Failed to create auth dir: {e}"))?;
    let path = auth_dir.join(KEY_FILENAME);
    fs::write(&path, key).map_err(|e| format!("Failed to write key file: {e}"))
}

/// Load the 256-bit key from `{auth_dir}/.key`.
pub fn load_key(auth_dir: &Path) -> Result<[u8; 32], String> {
    let path = auth_dir.join(KEY_FILENAME);
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read key file: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!(
            "Invalid key length: expected 32 bytes, got {}",
            bytes.len()
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Load the existing key or generate + save a new one.
pub fn ensure_key(auth_dir: &Path) -> Result<[u8; 32], String> {
    match load_key(auth_dir) {
        Ok(key) => Ok(key),
        Err(_) => {
            let key = generate_key();
            save_key(auth_dir, &key)?;
            Ok(key)
        }
    }
}

// ---------------------------------------------------------------------------
// Encryption / decryption
// ---------------------------------------------------------------------------

/// Encrypt `plaintext` with AES-256-GCM. Returns `nonce (12 bytes) ++ ciphertext`.
pub fn encrypt_data(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;

    // Prepend the nonce so decrypt can extract it.
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decrypt data produced by [`encrypt_data`]. Expects `nonce (12 bytes) ++ ciphertext`.
pub fn decrypt_data(encrypted: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if encrypted.len() < 12 {
        return Err("Encrypted data too short (missing nonce)".into());
    }

    let (nonce_bytes, ciphertext) = encrypted.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {e}"))
}

// ---------------------------------------------------------------------------
// Profile CRUD
// ---------------------------------------------------------------------------

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Encrypt and save a profile to `{auth_dir}/{name}.json`.
pub fn save_profile(auth_dir: &Path, profile: &AuthProfile, key: &[u8; 32]) -> Result<(), String> {
    fs::create_dir_all(auth_dir).map_err(|e| format!("Failed to create auth dir: {e}"))?;

    let username_encrypted = encrypt_data(profile.username.as_bytes(), key)?;
    let password_encrypted = encrypt_data(profile.password.as_bytes(), key)?;

    // Store the nonce from the username encryption for reference.
    let nonce_b64 = B64.encode(&username_encrypted[..12]);

    let encrypted = EncryptedProfile {
        name: profile.name.clone(),
        url: profile.url.clone(),
        username_enc: B64.encode(&username_encrypted),
        password_enc: B64.encode(&password_encrypted),
        nonce: nonce_b64,
        selectors: profile.selectors.clone(),
        created_at: profile.created_at.clone(),
        last_login_at: profile.last_login_at.clone(),
    };

    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize profile: {e}"))?;

    let path = auth_dir.join(format!("{}.json", profile.name));
    fs::write(&path, json).map_err(|e| format!("Failed to write profile: {e}"))
}

/// Load and decrypt a profile from `{auth_dir}/{name}.json`.
pub fn load_profile(auth_dir: &Path, name: &str, key: &[u8; 32]) -> Result<AuthProfile, String> {
    let path = auth_dir.join(format!("{name}.json"));
    let json = fs::read_to_string(&path).map_err(|e| format!("Failed to read profile: {e}"))?;

    let encrypted: EncryptedProfile =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse profile: {e}"))?;

    let username_bytes = B64
        .decode(&encrypted.username_enc)
        .map_err(|e| format!("Failed to decode username: {e}"))?;
    let password_bytes = B64
        .decode(&encrypted.password_enc)
        .map_err(|e| format!("Failed to decode password: {e}"))?;

    let username = String::from_utf8(decrypt_data(&username_bytes, key)?)
        .map_err(|e| format!("Username is not valid UTF-8: {e}"))?;
    let password = String::from_utf8(decrypt_data(&password_bytes, key)?)
        .map_err(|e| format!("Password is not valid UTF-8: {e}"))?;

    Ok(AuthProfile {
        name: encrypted.name,
        url: encrypted.url,
        username,
        password,
        selectors: encrypted.selectors,
        created_at: encrypted.created_at,
        last_login_at: encrypted.last_login_at,
    })
}

/// List all saved profile names (sorted). Excludes the `.key` file.
pub fn list_profiles(auth_dir: &Path) -> Result<Vec<String>, String> {
    let entries =
        fs::read_dir(auth_dir).map_err(|e| format!("Failed to read auth dir: {e}"))?;

    let mut names: Vec<String> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.ends_with(".json") {
                Some(file_name.trim_end_matches(".json").to_string())
            } else {
                None
            }
        })
        .collect();

    names.sort();
    Ok(names)
}

/// Delete a profile file `{auth_dir}/{name}.json`.
pub fn delete_profile(auth_dir: &Path, name: &str) -> Result<(), String> {
    let path = auth_dir.join(format!("{name}.json"));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete profile: {e}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::process;

    /// Create a unique temporary directory for a test.
    fn test_dir(suffix: &str) -> std::path::PathBuf {
        let dir = env::temp_dir().join(format!("vm-auth-test-{}-{}", process::id(), suffix));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    /// Clean up a test directory.
    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_key();
        let plaintext = b"hello, world!";
        let encrypted = encrypt_data(plaintext, &key).expect("encrypt");
        let decrypted = decrypt_data(&encrypted, &key).expect("decrypt");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext() {
        let key = generate_key();
        let plaintext = b"same data";
        let enc1 = encrypt_data(plaintext, &key).expect("encrypt 1");
        let enc2 = encrypt_data(plaintext, &key).expect("encrypt 2");
        // Random nonces mean different ciphertext every time.
        assert_ne!(enc1, enc2);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = generate_key();
        let key2 = generate_key();
        let encrypted = encrypt_data(b"secret", &key1).expect("encrypt");
        let result = decrypt_data(&encrypted, &key2);
        assert!(result.is_err(), "Decryption with wrong key should fail");
    }

    #[test]
    fn test_save_and_load_profile() {
        let dir = test_dir("profile");
        let key = generate_key();

        let profile = AuthProfile {
            name: "github".into(),
            url: "https://github.com/login".into(),
            username: "user@example.com".into(),
            password: "s3cret!Pass".into(),
            selectors: Some(AuthSelectors {
                username_selector: Some("#login_field".into()),
                password_selector: Some("#password".into()),
                submit_selector: Some("[type=submit]".into()),
            }),
            created_at: "2026-02-27T00:00:00Z".into(),
            last_login_at: None,
        };

        save_profile(&dir, &profile, &key).expect("save");
        let loaded = load_profile(&dir, "github", &key).expect("load");

        assert_eq!(loaded.name, profile.name);
        assert_eq!(loaded.url, profile.url);
        assert_eq!(loaded.username, profile.username);
        assert_eq!(loaded.password, profile.password);
        assert_eq!(loaded.created_at, profile.created_at);
        assert_eq!(loaded.last_login_at, profile.last_login_at);

        let sel = loaded.selectors.expect("selectors should exist");
        assert_eq!(sel.username_selector, Some("#login_field".into()));
        assert_eq!(sel.password_selector, Some("#password".into()));
        assert_eq!(sel.submit_selector, Some("[type=submit]".into()));

        cleanup(&dir);
    }

    #[test]
    fn test_list_profiles() {
        let dir = test_dir("list");
        let key = generate_key();

        let names = ["alpha", "charlie", "bravo"];
        for name in &names {
            let profile = AuthProfile {
                name: name.to_string(),
                url: format!("https://{name}.example.com"),
                username: "user".into(),
                password: "pass".into(),
                selectors: None,
                created_at: "2026-01-01T00:00:00Z".into(),
                last_login_at: None,
            };
            save_profile(&dir, &profile, &key).expect("save");
        }

        // Also save the key file to ensure it's excluded from listing.
        save_key(&dir, &key).expect("save key");

        let listed = list_profiles(&dir).expect("list");
        assert_eq!(listed, vec!["alpha", "bravo", "charlie"]);

        cleanup(&dir);
    }

    #[test]
    fn test_delete_profile() {
        let dir = test_dir("delete");
        let key = generate_key();

        let profile = AuthProfile {
            name: "disposable".into(),
            url: "https://example.com".into(),
            username: "u".into(),
            password: "p".into(),
            selectors: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            last_login_at: None,
        };

        save_profile(&dir, &profile, &key).expect("save");
        delete_profile(&dir, "disposable").expect("delete");

        let result = load_profile(&dir, "disposable", &key);
        assert!(result.is_err(), "Loading deleted profile should fail");

        cleanup(&dir);
    }

    #[test]
    fn test_save_and_load_key() {
        let dir = test_dir("key");
        let key = generate_key();

        save_key(&dir, &key).expect("save key");
        let loaded = load_key(&dir).expect("load key");
        assert_eq!(key, loaded);

        cleanup(&dir);
    }
}
