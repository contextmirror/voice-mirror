# Agent-Browser Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Voice Mirror's 16 individual browser MCP tools with a single `browser_action` tool that provides agent-browser-level capability (~35 actions) including ref-based element identification (@eN), annotated screenshots, and encrypted auth vault.

**Architecture:** Single `browser_action` MCP tool dispatches through the existing named pipe to the Tauri app's `BrowserBridge`. The bridge resolves @eN refs from a Rust-side `HashMap` populated via CDP `Accessibility.getFullAXTree()`, executes actions via WebView2 COM APIs (`ExecuteScript`, `CapturePreview`, `CallDevToolsProtocolMethodAsync`), and returns results through the pipe.

**Tech Stack:** Rust, WebView2 COM (`webview2-com` 0.38), Chrome DevTools Protocol, `aes-gcm` crate for auth vault, Tauri 2 named pipe IPC.

**Design doc:** `docs/plans/2026-02-27-agent-browser-design.md`

---

## Task 1: Add `aes-gcm` dependency to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml:16-41` (dependencies section)

**Step 1: Add the aes-gcm crate**

In `src-tauri/Cargo.toml`, add to `[dependencies]` after the `base64 = "0.22"` line (around line 61):

```toml
# Auth vault encryption (AES-256-GCM)
aes-gcm = "0.10"
rand = "0.8"
```

**Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add aes-gcm and rand deps for auth vault"
```

---

## Task 2: Create CDP helper module (`services/cdp.rs`)

This module wraps WebView2's `CallDevToolsProtocolMethodAsync` COM API and parses CDP accessibility tree responses into our ref system.

**Files:**
- Create: `src-tauri/src/services/cdp.rs`
- Modify: `src-tauri/src/services/mod.rs` — add `pub mod cdp;`

**Step 1: Write the tests (Rust unit tests at bottom of cdp.rs)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_ax_nodes_basic() {
        // Simulated CDP Accessibility.getFullAXTree response
        let cdp_response = json!({
            "nodes": [
                {
                    "nodeId": "1",
                    "role": { "type": "role", "value": "WebArea" },
                    "name": { "type": "computedString", "value": "" },
                    "childIds": ["2", "3", "4"]
                },
                {
                    "nodeId": "2",
                    "role": { "type": "role", "value": "heading" },
                    "name": { "type": "computedString", "value": "Welcome" },
                    "properties": [
                        { "name": "level", "value": { "type": "integer", "value": 1 } }
                    ],
                    "childIds": [],
                    "backendDOMNodeId": 10
                },
                {
                    "nodeId": "3",
                    "role": { "type": "role", "value": "button" },
                    "name": { "type": "computedString", "value": "Submit" },
                    "childIds": [],
                    "backendDOMNodeId": 20
                },
                {
                    "nodeId": "4",
                    "role": { "type": "role", "value": "textbox" },
                    "name": { "type": "computedString", "value": "Email" },
                    "childIds": [],
                    "backendDOMNodeId": 30
                }
            ]
        });

        let (tree_text, ref_map) = parse_ax_tree(&cdp_response);

        // Should have 3 refs (heading, button, textbox)
        assert_eq!(ref_map.len(), 3);
        assert!(ref_map.contains_key("e1"));
        assert!(ref_map.contains_key("e2"));
        assert!(ref_map.contains_key("e3"));

        // Check ref details
        assert_eq!(ref_map["e1"].role, "heading");
        assert_eq!(ref_map["e1"].name, "Welcome");
        assert_eq!(ref_map["e2"].role, "button");
        assert_eq!(ref_map["e2"].name, "Submit");
        assert_eq!(ref_map["e3"].role, "textbox");
        assert_eq!(ref_map["e3"].name, "Email");

        // Tree text should contain refs
        assert!(tree_text.contains("@e1"));
        assert!(tree_text.contains("heading"));
        assert!(tree_text.contains("Welcome"));
    }

    #[test]
    fn test_is_interactive_role() {
        assert!(is_interactive_role("button"));
        assert!(is_interactive_role("link"));
        assert!(is_interactive_role("textbox"));
        assert!(is_interactive_role("checkbox"));
        assert!(!is_interactive_role("generic"));
        assert!(!is_interactive_role("none"));
        assert!(!is_interactive_role("StaticText"));
    }

    #[test]
    fn test_is_content_role() {
        assert!(is_content_role("heading"));
        assert!(is_content_role("cell"));
        assert!(is_content_role("listitem"));
        assert!(!is_content_role("generic"));
        assert!(!is_content_role("group"));
    }

    #[test]
    fn test_build_js_selector() {
        let entry = RefEntry {
            role: "button".into(),
            name: "Submit".into(),
            backend_node_id: Some(20),
            nth: None,
        };
        let sel = build_js_selector(&entry);
        // Should produce a querySelector-compatible expression
        assert!(sel.contains("button") || sel.contains("Submit"));
    }

    #[test]
    fn test_duplicate_role_name_gets_nth() {
        let cdp_response = json!({
            "nodes": [
                {
                    "nodeId": "1",
                    "role": { "type": "role", "value": "WebArea" },
                    "name": { "type": "computedString", "value": "" },
                    "childIds": ["2", "3"]
                },
                {
                    "nodeId": "2",
                    "role": { "type": "role", "value": "button" },
                    "name": { "type": "computedString", "value": "Delete" },
                    "childIds": [],
                    "backendDOMNodeId": 10
                },
                {
                    "nodeId": "3",
                    "role": { "type": "role", "value": "button" },
                    "name": { "type": "computedString", "value": "Delete" },
                    "childIds": [],
                    "backendDOMNodeId": 11
                }
            ]
        });

        let (_tree, ref_map) = parse_ax_tree(&cdp_response);
        assert_eq!(ref_map.len(), 2);
        // Both should have nth set for disambiguation
        let refs: Vec<&RefEntry> = ref_map.values().collect();
        let nths: Vec<Option<u32>> = refs.iter().map(|r| r.nth).collect();
        assert!(nths.contains(&Some(0)));
        assert!(nths.contains(&Some(1)));
    }

    #[test]
    fn test_parse_empty_tree() {
        let cdp_response = json!({ "nodes": [] });
        let (tree_text, ref_map) = parse_ax_tree(&cdp_response);
        assert!(ref_map.is_empty());
        assert!(tree_text.is_empty() || tree_text.contains("empty"));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib cdp -- --nocapture 2>&1 | head -30`
Expected: FAIL — module doesn't exist yet.

**Step 3: Implement cdp.rs**

Create `src-tauri/src/services/cdp.rs`:

```rust
//! Chrome DevTools Protocol helpers for accessibility tree parsing.
//!
//! Parses CDP `Accessibility.getFullAXTree()` responses into a ref map
//! (@e1, @e2, ...) that can be used by browser_bridge for element targeting.

use serde_json::Value;
use std::collections::HashMap;

/// A resolved element reference from the accessibility tree.
#[derive(Debug, Clone)]
pub struct RefEntry {
    pub role: String,
    pub name: String,
    pub backend_node_id: Option<u32>,
    pub nth: Option<u32>,
}

/// Interactive ARIA roles that always get refs.
const INTERACTIVE_ROLES: &[&str] = &[
    "button", "link", "textbox", "checkbox", "radio", "combobox",
    "listbox", "menuitem", "menuitemcheckbox", "menuitemradio",
    "option", "searchbox", "slider", "spinbutton", "switch", "tab",
    "treeitem",
];

/// Content roles that get refs when they have a name.
const CONTENT_ROLES: &[&str] = &[
    "heading", "cell", "gridcell", "columnheader", "rowheader",
    "listitem", "article", "region", "main", "navigation",
];

pub fn is_interactive_role(role: &str) -> bool {
    INTERACTIVE_ROLES.contains(&role)
}

pub fn is_content_role(role: &str) -> bool {
    CONTENT_ROLES.contains(&role)
}

/// Build a JS expression to find an element by its role and name.
pub fn build_js_selector(entry: &RefEntry) -> String {
    let role = &entry.role;
    let name = entry.name.replace('\'', "\\'").replace('\\', "\\\\");

    // Strategy: use querySelectorAll with role attribute + aria-label,
    // then fall back to TreeWalker with text content matching.
    let mut js = format!(
        r#"(function() {{
            // Try role + aria-label first
            var els = document.querySelectorAll('[role="{role}"]');
            for (var i = 0; i < els.length; i++) {{
                var label = els[i].getAttribute('aria-label') || els[i].textContent.trim();
                if (label === '{name}'"#,
    );

    // Handle nth disambiguation
    if let Some(nth) = entry.nth {
        js.push_str(&format!(
            r#") {{
                    if (i === {nth} || els[i].getAttribute('aria-label') === '{name}') {{
                        return els[i];
                    }}
                }}"#
        ));
    } else {
        js.push_str(
            r#") return els[i];
            }"#,
        );
    }

    // Fallback: search by implicit role (tag name mapping)
    let tag_for_role = match role.as_str() {
        "button" => Some("button"),
        "link" => Some("a"),
        "textbox" => Some("input,textarea"),
        "heading" => Some("h1,h2,h3,h4,h5,h6"),
        "checkbox" => Some("input[type=checkbox]"),
        "radio" => Some("input[type=radio]"),
        _ => None,
    };

    if let Some(tags) = tag_for_role {
        js.push_str(&format!(
            r#"
            // Fallback: implicit role from tag
            var fallback = document.querySelectorAll('{tags}');
            for (var j = 0; j < fallback.length; j++) {{
                var t = fallback[j].getAttribute('aria-label') || fallback[j].textContent.trim();
                if (t === '{name}') return fallback[j];
            }}"#
        ));
    }

    js.push_str("\n            return null;\n        })()");
    js
}

/// Parse a CDP `Accessibility.getFullAXTree` response into a text tree and ref map.
///
/// Returns (tree_text, ref_map) where tree_text is a human-readable
/// accessibility tree with @eN annotations, and ref_map maps ref IDs
/// to RefEntry values for element targeting.
pub fn parse_ax_tree(cdp_response: &Value) -> (String, HashMap<String, RefEntry>) {
    let mut ref_map = HashMap::new();
    let mut tree_lines = Vec::new();
    let mut ref_counter = 0u32;

    let nodes = match cdp_response.get("nodes").and_then(|n| n.as_array()) {
        Some(n) => n,
        None => return (String::new(), ref_map),
    };

    if nodes.is_empty() {
        return ("(empty page)".into(), ref_map);
    }

    // Build node index for tree construction
    let mut node_map: HashMap<String, &Value> = HashMap::new();
    for node in nodes {
        if let Some(id) = node.get("nodeId").and_then(|v| v.as_str()) {
            node_map.insert(id.to_string(), node);
        }
    }

    // Track role+name occurrences for duplicate detection
    let mut role_name_counts: HashMap<(String, String), Vec<String>> = HashMap::new();

    // First pass: collect all refs and count duplicates
    let mut pending_refs: Vec<(String, RefEntry)> = Vec::new();

    for node in nodes {
        let role = node
            .get("role")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let name = node
            .get("name")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let backend_id = node
            .get("backendDOMNodeId")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);

        let should_ref = is_interactive_role(role)
            || (is_content_role(role) && !name.is_empty());

        if !should_ref || name.is_empty() {
            continue;
        }

        ref_counter += 1;
        let ref_id = format!("e{}", ref_counter);
        let key = (role.to_string(), name.to_string());
        role_name_counts
            .entry(key)
            .or_default()
            .push(ref_id.clone());

        pending_refs.push((
            ref_id,
            RefEntry {
                role: role.to_string(),
                name: name.to_string(),
                backend_node_id: backend_id,
                nth: None, // Set in second pass
            },
        ));
    }

    // Second pass: assign nth indices for duplicates
    let mut role_name_idx: HashMap<(String, String), u32> = HashMap::new();
    for (ref_id, entry) in &mut pending_refs {
        let key = (entry.role.clone(), entry.name.clone());
        let count = role_name_counts.get(&key).map(|v| v.len()).unwrap_or(0);
        if count > 1 {
            let idx = role_name_idx.entry(key).or_insert(0);
            entry.nth = Some(*idx);
            *idx += 1;
        }
        ref_map.insert(ref_id.clone(), entry.clone());
    }

    // Build tree text output
    // Walk the first node's children for structure
    ref_counter = 0;
    for node in nodes {
        let role = node
            .get("role")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let name = node
            .get("name")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Skip the root WebArea and structural/generic nodes
        if role == "WebArea" || role == "none" || role == "generic" || role == "RootWebArea" {
            continue;
        }

        let should_ref = is_interactive_role(role)
            || (is_content_role(role) && !name.is_empty());

        if should_ref && !name.is_empty() {
            ref_counter += 1;
            let ref_tag = format!("@e{}", ref_counter);
            let nth_suffix = if let Some(entry) = ref_map.get(&format!("e{}", ref_counter)) {
                if entry.nth.is_some() {
                    format!(" [nth={}]", entry.nth.unwrap())
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            tree_lines.push(format!("- {} \"{}\" {}{}", role, name, ref_tag, nth_suffix));
        } else if !role.is_empty() && role != "StaticText" && !name.is_empty() {
            // Non-ref'd named content (e.g. paragraphs)
            let truncated = if name.len() > 80 {
                format!("{}...", &name[..77])
            } else {
                name.to_string()
            };
            tree_lines.push(format!("- {} \"{}\"", role, truncated));
        }
    }

    (tree_lines.join("\n"), ref_map)
}
```

**Step 4: Register the module**

In `src-tauri/src/services/mod.rs`, add:
```rust
pub mod cdp;
```

**Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib cdp -- --nocapture`
Expected: All 5 tests pass.

**Step 6: Commit**

```bash
git add src-tauri/src/services/cdp.rs src-tauri/src/services/mod.rs
git commit -m "feat: add CDP accessibility tree parser with ref system"
```

---

## Task 3: Create auth vault module (`services/auth_vault.rs`)

**Files:**
- Create: `src-tauri/src/services/auth_vault.rs`
- Modify: `src-tauri/src/services/mod.rs` — add `pub mod auth_vault;`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vm-auth-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_key();
        let plaintext = b"my-secret-password";
        let encrypted = encrypt_data(plaintext, &key).unwrap();
        let decrypted = decrypt_data(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext() {
        let key = generate_key();
        let plaintext = b"same-password";
        let e1 = encrypt_data(plaintext, &key).unwrap();
        let e2 = encrypt_data(plaintext, &key).unwrap();
        // Different nonces → different ciphertexts
        assert_ne!(e1, e2);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = generate_key();
        let key2 = generate_key();
        let encrypted = encrypt_data(b"secret", &key1).unwrap();
        assert!(decrypt_data(&encrypted, &key2).is_err());
    }

    #[test]
    fn test_save_and_load_profile() {
        let dir = temp_dir();
        let key = generate_key();
        save_key(&dir, &key).unwrap();

        let profile = AuthProfile {
            name: "github".into(),
            url: "https://github.com/login".into(),
            username: "user@test.com".into(),
            password: "s3cret!".into(),
            selectors: None,
            created_at: "2026-02-27T00:00:00Z".into(),
            last_login_at: None,
        };

        save_profile(&dir, &profile, &key).unwrap();
        let loaded = load_profile(&dir, "github", &key).unwrap();
        assert_eq!(loaded.name, "github");
        assert_eq!(loaded.username, "user@test.com");
        assert_eq!(loaded.password, "s3cret!");
        assert_eq!(loaded.url, "https://github.com/login");

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_list_profiles() {
        let dir = temp_dir();
        let key = generate_key();
        save_key(&dir, &key).unwrap();

        for name in &["github", "vercel", "npm"] {
            save_profile(
                &dir,
                &AuthProfile {
                    name: name.to_string(),
                    url: format!("https://{}.com", name),
                    username: "user".into(),
                    password: "pass".into(),
                    selectors: None,
                    created_at: "2026-01-01T00:00:00Z".into(),
                    last_login_at: None,
                },
                &key,
            )
            .unwrap();
        }

        let list = list_profiles(&dir).unwrap();
        assert_eq!(list.len(), 3);
        assert!(list.iter().any(|p| p == "github"));
        assert!(list.iter().any(|p| p == "vercel"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_delete_profile() {
        let dir = temp_dir();
        let key = generate_key();
        save_key(&dir, &key).unwrap();

        save_profile(
            &dir,
            &AuthProfile {
                name: "test".into(),
                url: "https://test.com".into(),
                username: "u".into(),
                password: "p".into(),
                selectors: None,
                created_at: "2026-01-01T00:00:00Z".into(),
                last_login_at: None,
            },
            &key,
        )
        .unwrap();

        assert!(delete_profile(&dir, "test").is_ok());
        assert!(load_profile(&dir, "test", &key).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_save_and_load_key() {
        let dir = temp_dir();
        let key = generate_key();
        save_key(&dir, &key).unwrap();
        let loaded = load_key(&dir).unwrap();
        assert_eq!(key, loaded);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib auth_vault -- --nocapture 2>&1 | head -20`
Expected: FAIL — module doesn't exist.

**Step 3: Implement auth_vault.rs**

Create `src-tauri/src/services/auth_vault.rs`:

```rust
//! AES-256-GCM encrypted credential vault for browser auth profiles.
//!
//! Stores encrypted username/password pairs keyed by profile name.
//! Key file stored at `{auth_dir}/.key` (256-bit random key).
//! Profile files stored at `{auth_dir}/{name}.json`.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Plaintext auth profile (before/after encryption).
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

/// Encrypted profile stored on disk.
#[derive(Serialize, Deserialize)]
struct EncryptedProfile {
    name: String,
    url: String,
    /// Base64-encoded encrypted username
    username_enc: String,
    /// Base64-encoded encrypted password
    password_enc: String,
    /// Base64-encoded nonce (12 bytes)
    nonce: String,
    selectors: Option<AuthSelectors>,
    created_at: String,
    last_login_at: Option<String>,
}

/// Generate a new 256-bit random encryption key.
pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

/// Save the encryption key to disk.
pub fn save_key(auth_dir: &Path, key: &[u8; 32]) -> Result<(), String> {
    std::fs::create_dir_all(auth_dir).map_err(|e| format!("Failed to create auth dir: {}", e))?;
    let key_path = auth_dir.join(".key");
    std::fs::write(&key_path, key).map_err(|e| format!("Failed to write key: {}", e))
}

/// Load the encryption key from disk.
pub fn load_key(auth_dir: &Path) -> Result<[u8; 32], String> {
    let key_path = auth_dir.join(".key");
    let bytes = std::fs::read(&key_path).map_err(|e| format!("No encryption key found: {}", e))?;
    if bytes.len() != 32 {
        return Err("Invalid key length".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Load or create the encryption key.
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

/// Encrypt data with AES-256-GCM.
pub fn encrypt_data(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext: [12 bytes nonce][ciphertext...]
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    Ok(result)
}

/// Decrypt data with AES-256-GCM.
pub fn decrypt_data(encrypted: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if encrypted.len() < 12 {
        return Err("Encrypted data too short".into());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(&encrypted[..12]);
    let ciphertext = &encrypted[12..];
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

/// Save an auth profile (encrypts username + password).
pub fn save_profile(
    auth_dir: &Path,
    profile: &AuthProfile,
    key: &[u8; 32],
) -> Result<(), String> {
    std::fs::create_dir_all(auth_dir).map_err(|e| format!("Failed to create auth dir: {}", e))?;

    use base64::Engine;
    let enc = base64::engine::general_purpose::STANDARD;

    let username_encrypted = encrypt_data(profile.username.as_bytes(), key)?;
    let password_encrypted = encrypt_data(profile.password.as_bytes(), key)?;
    // Use same nonce reference for metadata (actual nonce is prepended to ciphertext)
    let nonce_bytes = &username_encrypted[..12];

    let stored = EncryptedProfile {
        name: profile.name.clone(),
        url: profile.url.clone(),
        username_enc: enc.encode(&username_encrypted),
        password_enc: enc.encode(&password_encrypted),
        nonce: enc.encode(nonce_bytes),
        selectors: profile.selectors.clone(),
        created_at: profile.created_at.clone(),
        last_login_at: profile.last_login_at.clone(),
    };

    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    let path = auth_dir.join(format!("{}.json", profile.name));
    std::fs::write(&path, json).map_err(|e| format!("Failed to write profile: {}", e))
}

/// Load and decrypt an auth profile.
pub fn load_profile(
    auth_dir: &Path,
    name: &str,
    key: &[u8; 32],
) -> Result<AuthProfile, String> {
    let path = auth_dir.join(format!("{}.json", name));
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Profile '{}' not found: {}", name, e))?;
    let stored: EncryptedProfile =
        serde_json::from_str(&json).map_err(|e| format!("Invalid profile format: {}", e))?;

    use base64::Engine;
    let enc = base64::engine::general_purpose::STANDARD;

    let username_encrypted = enc
        .decode(&stored.username_enc)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let password_encrypted = enc
        .decode(&stored.password_enc)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let username = String::from_utf8(decrypt_data(&username_encrypted, key)?)
        .map_err(|e| format!("UTF-8 error: {}", e))?;
    let password = String::from_utf8(decrypt_data(&password_encrypted, key)?)
        .map_err(|e| format!("UTF-8 error: {}", e))?;

    Ok(AuthProfile {
        name: stored.name,
        url: stored.url,
        username,
        password,
        selectors: stored.selectors,
        created_at: stored.created_at,
        last_login_at: stored.last_login_at,
    })
}

/// List all profile names (without decryption).
pub fn list_profiles(auth_dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = std::fs::read_dir(auth_dir)
        .map_err(|e| format!("Failed to read auth dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// Delete a profile by name.
pub fn delete_profile(auth_dir: &Path, name: &str) -> Result<(), String> {
    let path = auth_dir.join(format!("{}.json", name));
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete profile '{}': {}", name, e))
}
```

**Step 4: Register the module**

In `src-tauri/src/services/mod.rs`, add:
```rust
pub mod auth_vault;
```

**Step 5: Run tests**

Run: `cd src-tauri && cargo test --lib auth_vault -- --nocapture`
Expected: All 6 tests pass.

**Step 6: Commit**

```bash
git add src-tauri/src/services/auth_vault.rs src-tauri/src/services/mod.rs
git commit -m "feat: add AES-256-GCM auth vault for browser credentials"
```

---

## Task 4: Rewrite browser_bridge.rs — CDP support + ref map + expanded actions

This is the largest task. We add CDP `CallDevToolsProtocolMethodAsync`, the ref map, annotated screenshot support, auth vault integration, and all new action handlers.

**Files:**
- Modify: `src-tauri/src/services/browser_bridge.rs` (major rewrite)

**Step 1: Add ref map state and CDP call infrastructure**

At the top of `browser_bridge.rs`, add the necessary imports and a shared ref map:

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;

use crate::services::cdp::{self, RefEntry};

/// Shared ref map populated by snapshot, used by click/fill/etc.
static REF_MAP: Lazy<Arc<RwLock<HashMap<String, RefEntry>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
```

Add the CDP call function (same COM pattern as `ExecuteScript` but uses `CallDevToolsProtocolMethodAsync`):

```rust
/// Call a Chrome DevTools Protocol method on the lens webview.
///
/// Uses WebView2's `ICoreWebView2::CallDevToolsProtocolMethodAsync` COM API.
/// Returns the JSON result from CDP.
#[cfg(windows)]
async fn call_cdp_method(
    webview: &tauri::Webview,
    method: &str,
    params: &str,
) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let method_owned = method.to_string();
    let params_owned = params.to_string();

    webview
        .with_webview(move |platform_webview| {
            use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
            use windows_core::HSTRING;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        let _ = tx.send(Err(format!("CoreWebView2 failed: {:?}", e)));
                        return;
                    }
                };

                let method_h = HSTRING::from(method_owned.as_str());
                let params_h = HSTRING::from(params_owned.as_str());
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(
                    Box::new(move |hresult, result| {
                        if hresult.is_ok() {
                            let _ = tx.send(Ok(result));
                        } else {
                            let _ = tx.send(Err(format!("CDP call failed: {:?}", hresult)));
                        }
                        Ok(())
                    }),
                );

                if let Err(e) = core_webview.CallDevToolsProtocolMethodAsync(
                    &method_h,
                    &params_h,
                    &handler,
                ) {
                    tracing::error!("[browser_bridge] CDP dispatch failed: {:?}", e);
                }
            }
        })
        .map_err(|e| format!("with_webview failed: {}", e))?;

    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(Ok(result_str))) => {
            serde_json::from_str(&result_str)
                .or_else(|_| Ok(json!({ "raw": result_str })))
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("CDP channel closed unexpectedly".into()),
        Err(_) => Err("CDP call timed out".into()),
    }
}

#[cfg(not(windows))]
async fn call_cdp_method(
    _webview: &tauri::Webview,
    _method: &str,
    _params: &str,
) -> Result<Value, String> {
    Err("CDP is only available on Windows".into())
}
```

**Step 2: Implement the new `snapshot` action using CDP**

Replace the old `SNAPSHOT_JS` IIFE with a CDP-based snapshot that builds the ref map:

```rust
"snapshot" => {
    let webview = get_webview(app, &state)?;
    let interactive_only = args
        .get("interactive")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Call CDP to get the full accessibility tree
    let cdp_result = call_cdp_method(
        &webview,
        "Accessibility.getFullAXTree",
        "{}",
    ).await?;

    // Parse into tree text + ref map
    let (tree_text, new_refs) = cdp::parse_ax_tree(&cdp_result);

    // Update the shared ref map
    if let Ok(mut map) = REF_MAP.write() {
        *map = new_refs;
    }

    // Get page metadata
    let meta = evaluate_js_with_result(
        app,
        &webview,
        r#"JSON.stringify({ title: document.title, url: location.href })"#,
        std::time::Duration::from_secs(5),
    ).await.unwrap_or(json!(null));

    let ref_count = REF_MAP.read().map(|m| m.len()).unwrap_or(0);

    Ok(json!({
        "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "url": meta.get("url").and_then(|v| v.as_str()).unwrap_or(""),
        "tree": tree_text,
        "refs": ref_count,
        "note": format!("{} interactive elements found. Use @e1-@e{} to target.", ref_count, ref_count),
    }))
}
```

**Step 3: Add ref resolution helper**

```rust
/// Resolve an @eN ref or CSS selector to a JS expression that finds the element.
fn resolve_element_target(args: &Value) -> Result<String, String> {
    // Check for @ref first
    if let Some(ref_str) = args.get("ref").and_then(|v| v.as_str()) {
        let ref_id = ref_str.trim_start_matches('@');
        let map = REF_MAP.read().map_err(|_| "Ref map lock error")?;
        let entry = map
            .get(ref_id)
            .ok_or_else(|| format!("Ref @{} not found. Run snapshot first.", ref_id))?;
        return Ok(cdp::build_js_selector(entry));
    }

    // Fall back to CSS selector
    if let Some(selector) = args.get("selector").and_then(|v| v.as_str()) {
        return Ok(format!(
            "document.querySelector('{}')",
            selector.replace('\'', "\\'")
        ));
    }

    Err("Either 'ref' (@e1) or 'selector' (CSS) is required".into())
}
```

**Step 4: Rewrite action dispatch with all new actions**

Replace the current match arms in `handle_browser_action`. Keep `navigate`, `screenshot`, `go_back`/`go_forward`/`reload`, `status`, `tabs`, `open`, `close_tab`, `focus`, `cookies`, `storage`. Add new arms:

```rust
// --- Interaction actions ---

"click" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.scrollIntoView({{ block: 'center' }});
            el.click();
            return JSON.stringify({{ ok: true, action: 'click' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"dblclick" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.scrollIntoView({{ block: 'center' }});
            el.dispatchEvent(new MouseEvent('dblclick', {{ bubbles: true }}));
            return JSON.stringify({{ ok: true, action: 'dblclick' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"fill" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let escaped_value = escape_js(value);
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.focus();
            el.value = '{escaped_value}';
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return JSON.stringify({{ ok: true, action: 'fill' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"type" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let escaped_value = escape_js(value);
    // Type character-by-character with key events
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.focus();
            var text = '{escaped_value}';
            for (var i = 0; i < text.length; i++) {{
                el.dispatchEvent(new KeyboardEvent('keydown', {{ key: text[i], bubbles: true }}));
                el.dispatchEvent(new KeyboardEvent('keypress', {{ key: text[i], bubbles: true }}));
                el.value += text[i];
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                el.dispatchEvent(new KeyboardEvent('keyup', {{ key: text[i], bubbles: true }}));
            }}
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return JSON.stringify({{ ok: true, action: 'type', length: text.length }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(30)).await
}

"hover" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
            el.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
            return JSON.stringify({{ ok: true, action: 'hover' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"focus" if args.get("ref").is_some() || args.get("selector").is_some() => {
    // Element focus (not tab focus)
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.focus();
            return JSON.stringify({{ ok: true, action: 'focus' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"scroll" => {
    let webview = get_webview(app, &state)?;
    let x = args.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let y = args.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let js = if args.get("ref").is_some() || args.get("selector").is_some() {
        let target = resolve_element_target(args)?;
        format!(
            r#"(function() {{
                var el = {target};
                if (!el) return JSON.stringify({{ error: 'Element not found' }});
                el.scrollBy({x}, {y});
                return JSON.stringify({{ ok: true, action: 'scroll' }});
            }})()"#
        )
    } else {
        format!(
            r#"(function() {{
                window.scrollBy({x}, {y});
                return JSON.stringify({{ ok: true, action: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY }});
            }})()"#
        )
    };
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"select" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let escaped = escape_js(value);
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            el.value = '{escaped}';
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return JSON.stringify({{ ok: true, action: 'select' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"check" | "uncheck" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let should_check = action == "check";
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            if (el.checked !== {should_check}) {{
                el.click();
            }}
            return JSON.stringify({{ ok: true, action: '{action}', checked: el.checked }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

// --- Observation actions ---

"gettext" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            return JSON.stringify({{ ok: true, text: el.textContent }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"content" => {
    let webview = get_webview(app, &state)?;
    if args.get("ref").is_some() || args.get("selector").is_some() {
        let target = resolve_element_target(args)?;
        let js = format!(
            r#"(function() {{
                var el = {target};
                if (!el) return JSON.stringify({{ error: 'Element not found' }});
                return JSON.stringify({{ ok: true, html: el.outerHTML.slice(0, 5000) }});
            }})()"#
        );
        evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
    } else {
        evaluate_js_with_result(
            app,
            &webview,
            r#"JSON.stringify({ ok: true, html: document.documentElement.outerHTML.slice(0, 10000) })"#,
            std::time::Duration::from_secs(10),
        ).await
    }
}

"boundingbox" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            var r = el.getBoundingClientRect();
            return JSON.stringify({{ ok: true, x: r.x, y: r.y, width: r.width, height: r.height }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"isvisible" => {
    let webview = get_webview(app, &state)?;
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(function() {{
            var el = {target};
            if (!el) return JSON.stringify({{ error: 'Element not found' }});
            var r = el.getBoundingClientRect();
            var visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
            return JSON.stringify({{ ok: true, visible: visible }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

"url" => {
    let webview = get_webview(app, &state)?;
    evaluate_js_with_result(
        app, &webview,
        "JSON.stringify({ url: location.href })",
        std::time::Duration::from_secs(5),
    ).await
}

"title" => {
    let webview = get_webview(app, &state)?;
    evaluate_js_with_result(
        app, &webview,
        "JSON.stringify({ title: document.title })",
        std::time::Duration::from_secs(5),
    ).await
}

// --- JS actions ---

"evaluate" => {
    let webview = get_webview(app, &state)?;
    let expression = args
        .get("expression")
        .and_then(|v| v.as_str())
        .ok_or("expression is required")?;
    let js = format!(
        r#"(function() {{
            try {{
                var result = eval({});
                return JSON.stringify({{ ok: true, result: result }});
            }} catch(e) {{
                return JSON.stringify({{ error: e.message }});
            }}
        }})()"#,
        serde_json::to_string(expression).unwrap_or_default()
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(30)).await
}

"addscript" => {
    let webview = get_webview(app, &state)?;
    let src = args.get("url").and_then(|v| v.as_str());
    let content = args.get("content").and_then(|v| v.as_str());
    let js = if let Some(url) = src {
        format!(
            r#"(function() {{
                var s = document.createElement('script');
                s.src = '{}';
                document.head.appendChild(s);
                return JSON.stringify({{ ok: true }});
            }})()"#,
            escape_js(url)
        )
    } else if let Some(code) = content {
        format!(
            r#"(function() {{
                var s = document.createElement('script');
                s.textContent = {};
                document.head.appendChild(s);
                return JSON.stringify({{ ok: true }});
            }})()"#,
            serde_json::to_string(code).unwrap_or_default()
        )
    } else {
        return Err("Either 'url' or 'content' is required for addscript".into());
    };
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
}

// --- Wait actions ---

"wait" => {
    let webview = get_webview(app, &state)?;
    let timeout_ms = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(5000);
    let target = resolve_element_target(args)?;
    let js = format!(
        r#"(async function() {{
            var start = Date.now();
            while (Date.now() - start < {timeout_ms}) {{
                var el = {target};
                if (el) return JSON.stringify({{ ok: true, action: 'wait', elapsed: Date.now() - start }});
                await new Promise(r => setTimeout(r, 200));
            }}
            return JSON.stringify({{ error: 'Wait timed out after {timeout_ms}ms' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_millis(timeout_ms + 2000)).await
}

"waitforurl" => {
    let webview = get_webview(app, &state)?;
    let pattern = args.get("url").and_then(|v| v.as_str())
        .or_else(|| args.get("pattern").and_then(|v| v.as_str()))
        .ok_or("url pattern is required")?;
    let timeout_ms = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(10000);
    let escaped = escape_js(pattern);
    let js = format!(
        r#"(async function() {{
            var start = Date.now();
            var pattern = new RegExp('{escaped}');
            while (Date.now() - start < {timeout_ms}) {{
                if (pattern.test(location.href)) return JSON.stringify({{ ok: true, url: location.href }});
                await new Promise(r => setTimeout(r, 200));
            }}
            return JSON.stringify({{ error: 'URL did not match pattern after ' + {timeout_ms} + 'ms' }});
        }})()"#
    );
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_millis(timeout_ms + 2000)).await
}

"waitforloadstate" => {
    let webview = get_webview(app, &state)?;
    let state_name = args.get("state").and_then(|v| v.as_str()).unwrap_or("load");
    let timeout_ms = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(30000);
    let js = match state_name {
        "domcontentloaded" => format!(
            r#"(async function() {{
                if (document.readyState !== 'loading') return JSON.stringify({{ ok: true, state: document.readyState }});
                await new Promise(r => document.addEventListener('DOMContentLoaded', r, {{ once: true }}));
                return JSON.stringify({{ ok: true, state: 'domcontentloaded' }});
            }})()"#
        ),
        "load" => format!(
            r#"(async function() {{
                if (document.readyState === 'complete') return JSON.stringify({{ ok: true, state: 'complete' }});
                await new Promise(r => window.addEventListener('load', r, {{ once: true }}));
                return JSON.stringify({{ ok: true, state: 'complete' }});
            }})()"#
        ),
        _ => return Err(format!("Unknown load state: {}. Use 'load' or 'domcontentloaded'.", state_name)),
    };
    evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_millis(timeout_ms + 2000)).await
}

// --- Navigation aliases ---

"back" => {
    let webview = get_webview(app, &state)?;
    webview.eval("history.back()").map_err(|e| format!("Failed: {}", e))?;
    Ok(json!({ "ok": true }))
}

"forward" => {
    let webview = get_webview(app, &state)?;
    webview.eval("history.forward()").map_err(|e| format!("Failed: {}", e))?;
    Ok(json!({ "ok": true }))
}

// --- Tab actions ---

"tab_new" => {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("about:blank");
    let _ = app.emit("lens-open-tab", json!({ "url": url }));
    Ok(json!({ "ok": true, "url": url }))
}

"tab_list" => {
    // Same as existing "tabs" action
    // (delegate to the existing tabs handler)
}

"tab_switch" => {
    let tab_id = args.get("tabId").or_else(|| args.get("index"))
        .and_then(|v| v.as_str())
        .ok_or("tabId is required")?;
    let _ = app.emit("lens-focus-tab", json!({ "tabId": tab_id }));
    Ok(json!({ "ok": true, "tabId": tab_id }))
}

"tab_close" => {
    // Same as existing "close_tab"
}

// --- Auth actions ---

"auth_save" | "auth_login" | "auth_list" | "auth_delete" => {
    handle_auth_action(app, action, args).await
}

// --- HTTP direct (no webview) ---

"search" => {
    // Delegate to existing browser_search logic (reqwest to DuckDuckGo)
}

"fetch" => {
    // Delegate to existing browser_fetch logic (reqwest)
}
```

**Step 5: Add annotated screenshot support**

Modify the `"screenshot"` match arm to support `annotate: true`:

```rust
"screenshot" => {
    let webview = get_webview(app, &state)?;
    let annotate = args.get("annotate").and_then(|v| v.as_bool()).unwrap_or(false);

    if annotate {
        // 1. Get refs (may need to run snapshot first)
        let ref_count = REF_MAP.read().map(|m| m.len()).unwrap_or(0);
        if ref_count == 0 {
            // Auto-run snapshot to populate refs
            let cdp_result = call_cdp_method(&webview, "Accessibility.getFullAXTree", "{}").await?;
            let (_, new_refs) = cdp::parse_ax_tree(&cdp_result);
            if let Ok(mut map) = REF_MAP.write() {
                *map = new_refs;
            }
        }

        // 2. Get bounding boxes for each ref
        let refs = REF_MAP.read().map_err(|_| "Lock error")?;
        let mut annotations = Vec::new();
        let mut overlay_items = Vec::new();
        let mut number = 0u32;

        for (ref_id, entry) in refs.iter() {
            let selector_js = cdp::build_js_selector(entry);
            let box_js = format!(
                r#"(function() {{
                    var el = {};
                    if (!el) return null;
                    var r = el.getBoundingClientRect();
                    if (r.width <= 0 || r.height <= 0) return null;
                    return JSON.stringify({{ x: r.x, y: r.y, w: r.width, h: r.height }});
                }})()"#,
                selector_js
            );
            let box_result = evaluate_js_with_result(
                app, &webview, &box_js, std::time::Duration::from_secs(2),
            ).await.ok();

            if let Some(val) = box_result {
                if !val.is_null() {
                    number += 1;
                    let x = val.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let y = val.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let w = val.get("w").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let h = val.get("h").and_then(|v| v.as_f64()).unwrap_or(0.0);

                    annotations.push(json!({
                        "ref": format!("@{}", ref_id),
                        "number": number,
                        "role": entry.role,
                        "name": entry.name,
                        "box": { "x": x, "y": y, "width": w, "height": h },
                    }));
                    overlay_items.push(json!({
                        "number": number,
                        "x": x, "y": y, "w": w, "h": h,
                    }));
                }
            }
        }
        drop(refs);

        // 3. Inject overlay divs
        let items_json = serde_json::to_string(&overlay_items).unwrap_or_default();
        let inject_js = format!(
            r#"(function() {{
                var items = {items_json};
                var container = document.createElement('div');
                container.id = '__vm_overlay';
                container.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:2147483647;';
                items.forEach(function(it) {{
                    var box = document.createElement('div');
                    var dx = it.x + window.scrollX;
                    var dy = it.y + window.scrollY;
                    box.style.cssText = 'position:absolute;left:'+dx+'px;top:'+dy+'px;width:'+it.w+'px;height:'+it.h+'px;border:2px solid red;box-sizing:border-box;';
                    var label = document.createElement('div');
                    label.textContent = String(it.number);
                    label.style.cssText = 'position:absolute;top:-16px;left:0;background:rgba(255,0,0,0.9);color:white;font:bold 11px monospace;padding:1px 4px;border-radius:2px;';
                    box.appendChild(label);
                    container.appendChild(box);
                }});
                document.body.appendChild(container);
                return JSON.stringify({{ ok: true, count: items.length }});
            }})()"#
        );
        evaluate_js_with_result(app, &webview, &inject_js, std::time::Duration::from_secs(5)).await.ok();

        // 4. Take screenshot with overlays
        let screenshot_result = capture_screenshot_png(&webview).await;

        // 5. Remove overlays
        evaluate_js_with_result(
            app, &webview,
            r#"(function() { var el = document.getElementById('__vm_overlay'); if (el) el.remove(); return 'ok'; })()"#,
            std::time::Duration::from_secs(2),
        ).await.ok();

        // 6. Return
        match screenshot_result {
            Ok(png_bytes) => {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
                Ok(json!({
                    "base64": b64,
                    "contentType": "image/png",
                    "annotated": true,
                    "annotations": annotations,
                }))
            }
            Err(e) => Err(format!("Screenshot failed: {}", e)),
        }
    } else {
        // Non-annotated: existing CapturePreview path (unchanged)
        // ... (keep existing screenshot code)
    }
}
```

**Step 6: Add auth helper function**

```rust
async fn handle_auth_action(
    app: &AppHandle,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    use crate::services::auth_vault;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    let auth_dir = data_dir.join("auth");

    match action {
        "auth_save" => {
            let name = args.get("name").and_then(|v| v.as_str())
                .ok_or("name is required")?;
            let url = args.get("url").and_then(|v| v.as_str())
                .ok_or("url is required")?;
            let username = args.get("username").and_then(|v| v.as_str())
                .ok_or("username is required")?;
            let password = args.get("password").and_then(|v| v.as_str())
                .ok_or("password is required")?;
            let key = auth_vault::ensure_key(&auth_dir)?;
            let profile = auth_vault::AuthProfile {
                name: name.into(),
                url: url.into(),
                username: username.into(),
                password: password.into(),
                selectors: None,
                created_at: chrono_now(),
                last_login_at: None,
            };
            auth_vault::save_profile(&auth_dir, &profile, &key)?;
            Ok(json!({ "ok": true, "name": name }))
        }
        "auth_login" => {
            let name = args.get("name").and_then(|v| v.as_str())
                .ok_or("profile name is required")?;
            let key = auth_vault::ensure_key(&auth_dir)?;
            let profile = auth_vault::load_profile(&auth_dir, name, &key)?;
            let webview = get_webview(app, &app.state::<LensState>())?;

            // Auto-fill username then password
            let username_js = escape_js(&profile.username);
            let password_js = escape_js(&profile.password);
            let fill_js = format!(
                r#"(function() {{
                    var inputs = document.querySelectorAll('input');
                    var userField = null, passField = null;
                    for (var i = 0; i < inputs.length; i++) {{
                        var t = (inputs[i].type || '').toLowerCase();
                        var n = (inputs[i].name || '').toLowerCase();
                        var a = (inputs[i].autocomplete || '').toLowerCase();
                        if (t === 'password') passField = inputs[i];
                        else if (t === 'email' || t === 'text' || a === 'username' || n.includes('user') || n.includes('email')) {{
                            if (!userField) userField = inputs[i];
                        }}
                    }}
                    if (userField) {{
                        userField.focus();
                        userField.value = '{username_js}';
                        userField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        userField.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                    if (passField) {{
                        passField.focus();
                        passField.value = '{password_js}';
                        passField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        passField.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                    return JSON.stringify({{ ok: true, filledUsername: !!userField, filledPassword: !!passField }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &fill_js, std::time::Duration::from_secs(10)).await
        }
        "auth_list" => {
            let names = auth_vault::list_profiles(&auth_dir).unwrap_or_default();
            Ok(json!({ "ok": true, "profiles": names }))
        }
        "auth_delete" => {
            let name = args.get("name").and_then(|v| v.as_str())
                .ok_or("profile name is required")?;
            auth_vault::delete_profile(&auth_dir, name)?;
            Ok(json!({ "ok": true, "deleted": name }))
        }
        _ => Err(format!("Unknown auth action: {}", action)),
    }
}

/// Simple timestamp (no chrono dependency — use SystemTime).
fn chrono_now() -> String {
    use std::time::SystemTime;
    let d = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", d.as_secs())
}
```

**Step 7: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 8: Commit**

```bash
git add src-tauri/src/services/browser_bridge.rs
git commit -m "feat: rewrite browser bridge with CDP refs, annotations, and auth"
```

---

## Task 5: Replace MCP tool definitions (tools.rs)

**Files:**
- Modify: `src-tauri/src/mcp/tools.rs:645-677` (browser group)

**Step 1: Replace the browser group tool definitions**

Find the browser group definition (starts around line 645) and replace the entire `tools: vec![...]` array with a single `browser_action` tool:

```rust
ToolDef {
    name: "browser_action".into(),
    description: "Control the browser. Use snapshot to get @eN element refs, then interact by ref. Actions: navigate, back, forward, reload | click, dblclick, fill, type, hover, focus, scroll, select, check, uncheck | screenshot (annotate=true for numbered overlays), snapshot (@eN refs), gettext, content, boundingbox, isvisible, url, title | evaluate, addscript | tab_new, tab_list, tab_switch, tab_close | wait, waitforurl, waitforloadstate | cookies_get/set/clear, storage_get/set | auth_save/login/list/delete | search, fetch".into(),
    input_schema: json!({
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "navigate", "back", "forward", "reload",
                    "click", "dblclick", "fill", "type", "hover", "focus",
                    "scroll", "drag", "select", "check", "uncheck",
                    "screenshot", "snapshot", "gettext", "content",
                    "boundingbox", "isvisible", "url", "title",
                    "evaluate", "addscript",
                    "tab_new", "tab_list", "tab_switch", "tab_close",
                    "wait", "waitforurl", "waitforloadstate",
                    "cookies_get", "cookies_set", "cookies_clear",
                    "storage_get", "storage_set",
                    "auth_save", "auth_login", "auth_list", "auth_delete",
                    "search", "fetch"
                ],
                "description": "The browser action to perform. Use 'snapshot' first to discover @eN element references."
            },
            "ref": {
                "type": "string",
                "description": "Element reference from snapshot (e.g. '@e1', '@e3'). Preferred over selector."
            },
            "selector": {
                "type": "string",
                "description": "CSS selector (fallback if no ref available)"
            },
            "url": {
                "type": "string",
                "description": "URL for navigate/fetch/search/auth_save"
            },
            "value": {
                "type": "string",
                "description": "Value for fill/type/storage_set/cookies_set/select"
            },
            "annotate": {
                "type": "boolean",
                "description": "For screenshot: overlay numbered boxes on interactive elements"
            },
            "interactive": {
                "type": "boolean",
                "description": "For snapshot: only show interactive elements"
            },
            "expression": {
                "type": "string",
                "description": "JavaScript expression for evaluate action"
            },
            "query": {
                "type": "string",
                "description": "Search query for search action"
            },
            "name": {
                "type": "string",
                "description": "Profile name for auth actions"
            },
            "username": {
                "type": "string",
                "description": "Username for auth_save"
            },
            "password": {
                "type": "string",
                "description": "Password for auth_save"
            },
            "key": {
                "type": "string",
                "description": "Key for storage/cookies"
            },
            "timeout": {
                "type": "number",
                "description": "Timeout in ms for wait actions"
            },
            "tabId": {
                "type": "string",
                "description": "Tab ID for tab_switch/tab_close"
            },
            "x": { "type": "number", "description": "X offset for scroll" },
            "y": { "type": "number", "description": "Y offset for scroll" }
        },
        "required": ["action"]
    }),
},
```

Also update the group description:
```rust
description: "Browser control with element refs and annotated screenshots (1 tool)".into(),
```

And update keywords to include new terms:
```rust
keywords: vec![
    "browser".into(), "web".into(), "page".into(), "html".into(),
    "css".into(), "click".into(), "screenshot".into(), "navigate".into(),
    "url".into(), "dom".into(), "search".into(), "fetch".into(),
    "snapshot".into(), "ref".into(), "annotate".into(), "auth".into(),
    "login".into(), "cookie".into(),
],
```

**Step 2: Update the test**

Find the test `test_browser_loads_without_dependencies` (around line 828) and update:

```rust
#[test]
fn test_browser_loads_without_dependencies() {
    let mut reg = ToolRegistry::new();
    let _names = reg.load_group("browser").unwrap();
    assert!(reg.is_tool_loaded("browser_action"));
}
```

Also update `test_profile_limits_groups`:
```rust
assert!(!reg.is_tool_loaded("browser_action"));
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/mcp/tools.rs
git commit -m "feat: replace 16 browser tools with single browser_action tool"
```

---

## Task 6: Update MCP server dispatch (server.rs)

**Files:**
- Modify: `src-tauri/src/mcp/server.rs:371-387` (browser dispatch section)

**Step 1: Replace the 16 browser dispatch entries with single entry**

Find the browser tools section (around line 371). Replace all `"browser_*"` entries with:

```rust
// ---- Browser control (single unified tool) ----
"browser_action" => {
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
    if action.is_empty() {
        McpToolResult::error("'action' parameter is required for browser_action")
    } else {
        // Direct HTTP tools don't need the pipe
        match action {
            "search" => handlers::browser::handle_browser_search(args, data_dir).await,
            "fetch" => handlers::browser::handle_browser_fetch(args, data_dir).await,
            _ => handlers::browser::handle_browser_control(action, args, data_dir, router).await,
        }
    }
}
```

**Step 2: Update the test in server.rs**

Find the test that checks for `"browser_start"` in tool names and update to check for `"browser_action"` instead.

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/mcp/server.rs
git commit -m "feat: update MCP dispatch for unified browser_action tool"
```

---

## Task 7: Clean up MCP browser handler (handlers/browser.rs)

**Files:**
- Modify: `src-tauri/src/mcp/handlers/browser.rs`

**Step 1: Remove individual handler wrapper functions**

Delete all the individual `handle_browser_*` functions (lines ~384-478):
- `handle_browser_status`
- `handle_browser_tabs`
- `handle_browser_open`
- `handle_browser_close_tab`
- `handle_browser_focus`
- `handle_browser_navigate`
- `handle_browser_screenshot`
- `handle_browser_snapshot`
- `handle_browser_act`
- `handle_browser_console`
- `handle_browser_cookies`
- `handle_browser_storage`
- `handle_browser_start`
- `handle_browser_stop`

Keep:
- `generate_request_id()` — still used
- `is_long_action()` — update to include new long actions
- `pipe_browser_request()` — still the core IPC mechanism
- `require_pipe()` — still used
- `handle_browser_control()` — now the only entry point for pipe-based actions
- `handle_browser_search()` — direct HTTP, called from server.rs
- `handle_browser_fetch()` — direct HTTP, called from server.rs

**Step 2: Update `is_long_action` for new actions**

```rust
fn is_long_action(action: &str) -> bool {
    matches!(action, "screenshot" | "snapshot" | "wait" | "waitforurl" | "waitforloadstate" | "auth_login")
}
```

**Step 3: Update the screenshot handling in `handle_browser_control`**

The existing screenshot handling (checking for `base64` in response) stays the same — it's how annotated screenshots return their data too.

For annotated screenshots, also include the annotations array in the response. Add after the base64 check:

```rust
// Screenshot returns base64 image (annotated or not)
if action == "screenshot" {
    if let Some(base64) = response.get("base64").and_then(|v| v.as_str()) {
        let content_type = response
            .get("contentType")
            .and_then(|v| v.as_str())
            .unwrap_or("image/png");
        let mut result = McpToolResult::image(base64.to_string(), content_type.to_string());
        // Append annotations as text if present
        if let Some(annotations) = response.get("annotations") {
            if let Ok(text) = serde_json::to_string_pretty(annotations) {
                result.content.push(McpContent::Text {
                    text: format!("\nAnnotations:\n{}", text),
                });
            }
        }
        return result;
    }
}
```

**Step 4: Update tests**

Update existing tests and remove tests for deleted functions.

**Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 6: Run Rust tests**

Run: `cd src-tauri && cargo test --bin voice-mirror-mcp -- --nocapture`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src-tauri/src/mcp/handlers/browser.rs
git commit -m "refactor: clean up browser handler, remove 14 wrapper functions"
```

---

## Task 8: Update IPC protocol comment (protocol.rs)

**Files:**
- Modify: `src-tauri/src/ipc/protocol.rs:41-43` (comment only)

**Step 1: Update the action list comment**

Find the comment on lines 41-43 that lists browser actions and update it:

```rust
/// The browser action: any action from browser_action tool — "navigate",
/// "click", "fill", "snapshot", "screenshot", etc. Full list in design doc.
```

**Step 2: Commit**

```bash
git add src-tauri/src/ipc/protocol.rs
git commit -m "docs: update IPC protocol comment for unified browser_action"
```

---

## Task 9: Add JavaScript tests

**Files:**
- Create: `test/components/browser-action.cjs`

**Step 1: Write source-inspection tests**

```javascript
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Read source files
const toolsSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/mcp/tools.rs'), 'utf-8'
);
const bridgeSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/browser_bridge.rs'), 'utf-8'
);
const serverSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/mcp/server.rs'), 'utf-8'
);
const handlerSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/mcp/handlers/browser.rs'), 'utf-8'
);
const cdpSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/cdp.rs'), 'utf-8'
);
const authSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/auth_vault.rs'), 'utf-8'
);

describe('browser_action MCP tool', () => {
  describe('tool definition (tools.rs)', () => {
    it('defines browser_action tool', () => {
      assert.ok(toolsSrc.includes('"browser_action"'));
    });

    it('does not define old individual browser tools', () => {
      assert.ok(!toolsSrc.includes('"browser_start"'));
      assert.ok(!toolsSrc.includes('"browser_stop"'));
      assert.ok(!toolsSrc.includes('"browser_navigate"'));
      assert.ok(!toolsSrc.includes('"browser_screenshot"'));
      assert.ok(!toolsSrc.includes('"browser_snapshot"'));
      assert.ok(!toolsSrc.includes('"browser_act"'));
    });

    it('includes action enum with all actions', () => {
      const actions = [
        'navigate', 'back', 'forward', 'reload',
        'click', 'fill', 'screenshot', 'snapshot',
        'evaluate', 'tab_new', 'tab_list',
        'auth_save', 'auth_login', 'search', 'fetch',
      ];
      for (const action of actions) {
        assert.ok(
          toolsSrc.includes(`"${action}"`),
          `Missing action: ${action}`
        );
      }
    });

    it('has ref parameter', () => {
      assert.ok(toolsSrc.includes('"ref"'));
    });

    it('has annotate parameter', () => {
      assert.ok(toolsSrc.includes('"annotate"'));
    });
  });

  describe('server dispatch (server.rs)', () => {
    it('dispatches browser_action', () => {
      assert.ok(serverSrc.includes('"browser_action"'));
    });

    it('does not dispatch old tools', () => {
      assert.ok(!serverSrc.includes('"browser_start"'));
      assert.ok(!serverSrc.includes('"browser_navigate"'));
    });
  });

  describe('browser bridge (browser_bridge.rs)', () => {
    it('has CDP call method', () => {
      assert.ok(bridgeSrc.includes('CallDevToolsProtocolMethodAsync') || bridgeSrc.includes('call_cdp_method'));
    });

    it('has ref map', () => {
      assert.ok(bridgeSrc.includes('REF_MAP') || bridgeSrc.includes('ref_map'));
    });

    it('handles annotated screenshots', () => {
      assert.ok(bridgeSrc.includes('annotate'));
      assert.ok(bridgeSrc.includes('__vm_overlay'));
    });

    it('resolves element refs', () => {
      assert.ok(bridgeSrc.includes('resolve_element_target'));
    });

    it('handles click action', () => {
      assert.ok(bridgeSrc.includes('"click"'));
    });

    it('handles fill action', () => {
      assert.ok(bridgeSrc.includes('"fill"'));
    });

    it('handles wait action', () => {
      assert.ok(bridgeSrc.includes('"wait"'));
    });

    it('handles auth actions', () => {
      assert.ok(bridgeSrc.includes('auth_save'));
      assert.ok(bridgeSrc.includes('auth_login'));
    });
  });

  describe('CDP module (cdp.rs)', () => {
    it('exports parse_ax_tree function', () => {
      assert.ok(cdpSrc.includes('pub fn parse_ax_tree'));
    });

    it('exports RefEntry struct', () => {
      assert.ok(cdpSrc.includes('pub struct RefEntry'));
    });

    it('defines interactive roles', () => {
      assert.ok(cdpSrc.includes('INTERACTIVE_ROLES'));
      assert.ok(cdpSrc.includes('"button"'));
      assert.ok(cdpSrc.includes('"textbox"'));
    });

    it('defines content roles', () => {
      assert.ok(cdpSrc.includes('CONTENT_ROLES'));
      assert.ok(cdpSrc.includes('"heading"'));
    });

    it('builds JS selectors from refs', () => {
      assert.ok(cdpSrc.includes('pub fn build_js_selector'));
    });

    it('has unit tests', () => {
      assert.ok(cdpSrc.includes('#[cfg(test)]'));
      assert.ok(cdpSrc.includes('test_parse_ax_nodes_basic'));
    });
  });

  describe('auth vault (auth_vault.rs)', () => {
    it('exports AuthProfile struct', () => {
      assert.ok(authSrc.includes('pub struct AuthProfile'));
    });

    it('uses AES-256-GCM', () => {
      assert.ok(authSrc.includes('Aes256Gcm'));
    });

    it('has encrypt/decrypt functions', () => {
      assert.ok(authSrc.includes('pub fn encrypt_data'));
      assert.ok(authSrc.includes('pub fn decrypt_data'));
    });

    it('has profile CRUD', () => {
      assert.ok(authSrc.includes('pub fn save_profile'));
      assert.ok(authSrc.includes('pub fn load_profile'));
      assert.ok(authSrc.includes('pub fn list_profiles'));
      assert.ok(authSrc.includes('pub fn delete_profile'));
    });

    it('has unit tests', () => {
      assert.ok(authSrc.includes('#[cfg(test)]'));
      assert.ok(authSrc.includes('test_encrypt_decrypt_roundtrip'));
    });
  });

  describe('MCP handler (browser handler)', () => {
    it('has handle_browser_control', () => {
      assert.ok(handlerSrc.includes('pub async fn handle_browser_control'));
    });

    it('has handle_browser_search (direct HTTP)', () => {
      assert.ok(handlerSrc.includes('pub async fn handle_browser_search'));
    });

    it('has handle_browser_fetch (direct HTTP)', () => {
      assert.ok(handlerSrc.includes('pub async fn handle_browser_fetch'));
    });

    it('does not have individual handler wrappers', () => {
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_navigate'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_screenshot'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_snapshot'));
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (both new browser-action tests and existing 3400+ tests).

**Step 3: Commit**

```bash
git add test/components/browser-action.cjs
git commit -m "test: add source-inspection tests for browser_action tool"
```

---

## Task 10: Run all Rust tests

**Step 1: Run MCP binary tests**

Run: `cd src-tauri && cargo test --bin voice-mirror-mcp -- --nocapture`
Expected: All tests pass.

**Step 2: Run compilation check**

Run: `cd src-tauri && cargo check --tests`
Expected: Compiles without errors.

**Step 3: Run all JS tests**

Run: `npm test`
Expected: All 3400+ tests pass.

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address test failures in browser_action integration"
```

---

## Summary of Changes

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/Cargo.toml` | Modify | Add `aes-gcm` + `rand` deps |
| `src-tauri/src/services/cdp.rs` | **Create** | CDP AX tree parser, ref system |
| `src-tauri/src/services/auth_vault.rs` | **Create** | AES-256-GCM encrypted credential vault |
| `src-tauri/src/services/mod.rs` | Modify | Add `pub mod cdp; pub mod auth_vault;` |
| `src-tauri/src/services/browser_bridge.rs` | **Rewrite** | CDP calls, ref map, annotations, expanded actions |
| `src-tauri/src/mcp/tools.rs` | Modify | 16 tools → 1 `browser_action` tool |
| `src-tauri/src/mcp/server.rs` | Modify | 16 dispatch entries → 1 |
| `src-tauri/src/mcp/handlers/browser.rs` | Modify | Remove 14 wrapper functions |
| `src-tauri/src/ipc/protocol.rs` | Modify | Update comment |
| `test/components/browser-action.cjs` | **Create** | Source-inspection tests |
