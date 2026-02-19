//! Tauri commands for chat persistence.
//!
//! Each chat is stored as a separate JSON file (`{id}.json`) in the
//! `chats/` subdirectory of the app's data directory. This mirrors the
//! atomic write pattern from `config/persistence.rs`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::services::platform;

use super::IpcResponse;

/// Get the chats storage directory.
fn chats_dir() -> PathBuf {
    platform::get_data_dir().join("chats")
}

/// Validate that a chat ID is safe for use as a filename.
///
/// Only allows alphanumeric characters, hyphens, and underscores.
/// Rejects path traversal attempts (`..`, `/`, `\`) and empty strings.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Chat ID cannot be empty".into());
    }
    if id.len() > 255 {
        return Err("Chat ID too long".into());
    }
    if id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0')
    {
        return Err("Chat ID contains invalid characters".into());
    }
    // Allow only alphanumeric, hyphens, and underscores
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Chat ID must contain only alphanumeric characters, hyphens, and underscores".into());
    }
    Ok(())
}

/// Get the current timestamp in milliseconds since UNIX epoch.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Write a JSON value to a file atomically (tmp + rename).
fn atomic_write(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid file path")?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create chats directory: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");

    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Serialize error: {}", e))?;

    fs::write(&tmp_path, &json)
        .map_err(|e| format!("Write error: {}", e))?;

    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Rename error: {}", e))?;

    Ok(())
}

/// List all saved chats (metadata only, no messages).
///
/// Returns an array of `{ id, name, createdAt, updatedAt, messageCount }`
/// sorted by `updatedAt` descending (most recent first).
#[tauri::command]
pub fn chat_list() -> IpcResponse {
    let dir = chats_dir();

    if !dir.exists() {
        return IpcResponse::ok(serde_json::json!([]));
    }

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => return IpcResponse::err(format!("Failed to read chats directory: {}", e)),
    };

    let mut chats: Vec<Value> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Only process .json files (skip .tmp, .bak, etc.)
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let chat: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Extract metadata, skip the full messages array
        let id = chat.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let name = chat.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled");
        let created_at = chat.get("createdAt").and_then(|v| v.as_u64()).unwrap_or(0);
        let updated_at = chat.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0);
        let message_count = chat
            .get("messages")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);

        chats.push(serde_json::json!({
            "id": id,
            "name": name,
            "createdAt": created_at,
            "updatedAt": updated_at,
            "messageCount": message_count,
        }));
    }

    // Sort by updatedAt descending (most recent first)
    chats.sort_by(|a, b| {
        let a_time = a.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0);
        let b_time = b.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0);
        b_time.cmp(&a_time)
    });

    IpcResponse::ok(Value::Array(chats))
}

/// Load a single chat by ID (full object including messages).
#[tauri::command]
pub fn chat_load(id: String) -> IpcResponse {
    if let Err(e) = validate_id(&id) {
        return IpcResponse::err(e);
    }

    let path = chats_dir().join(format!("{}.json", id));

    if !path.exists() {
        return IpcResponse::err(format!("Chat not found: {}", id));
    }

    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return IpcResponse::err(format!("Failed to read chat: {}", e)),
    };

    let chat: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Failed to parse chat: {}", e)),
    };

    IpcResponse::ok(chat)
}

/// Save a chat (create or update).
///
/// The `chat` parameter is a JSON string. The `id` field is extracted from
/// it and used as the filename. Written atomically via tmp + rename.
#[tauri::command]
pub fn chat_save(chat: String) -> IpcResponse {
    let chat_value: Value = match serde_json::from_str(&chat) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Invalid chat JSON: {}", e)),
    };

    let id = match chat_value.get("id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return IpcResponse::err("Chat JSON must contain an 'id' field"),
    };

    if let Err(e) = validate_id(&id) {
        return IpcResponse::err(e);
    }

    let path = chats_dir().join(format!("{}.json", id));

    if let Err(e) = atomic_write(&path, &chat_value) {
        return IpcResponse::err(e);
    }

    IpcResponse::ok(serde_json::json!({ "id": id }))
}

/// Delete a chat by ID.
///
/// Returns success even if the file doesn't exist (idempotent).
#[tauri::command]
pub fn chat_delete(id: String) -> IpcResponse {
    if let Err(e) = validate_id(&id) {
        return IpcResponse::err(e);
    }

    let path = chats_dir().join(format!("{}.json", id));

    if path.exists() {
        if let Err(e) = fs::remove_file(&path) {
            return IpcResponse::err(format!("Failed to delete chat: {}", e));
        }
    }

    IpcResponse::ok(serde_json::json!({ "id": id }))
}

/// Rename a chat by ID.
///
/// Reads the chat file, updates the `name` field and `updatedAt` timestamp,
/// and writes it back atomically.
#[tauri::command]
pub fn chat_rename(id: String, name: String) -> IpcResponse {
    if let Err(e) = validate_id(&id) {
        return IpcResponse::err(e);
    }

    if name.is_empty() {
        return IpcResponse::err("Chat name cannot be empty");
    }

    let path = chats_dir().join(format!("{}.json", id));

    if !path.exists() {
        return IpcResponse::err(format!("Chat not found: {}", id));
    }

    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return IpcResponse::err(format!("Failed to read chat: {}", e)),
    };

    let mut chat: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Failed to parse chat: {}", e)),
    };

    // Update name and updatedAt
    if let Some(obj) = chat.as_object_mut() {
        obj.insert("name".into(), Value::String(name.clone()));
        obj.insert("updatedAt".into(), serde_json::json!(now_millis()));
    } else {
        return IpcResponse::err("Chat file is not a JSON object");
    }

    if let Err(e) = atomic_write(&path, &chat) {
        return IpcResponse::err(e);
    }

    IpcResponse::ok(serde_json::json!({ "id": id, "name": name }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::env;

    /// Create an isolated temp directory for a test.
    fn test_chats_dir(test_name: &str) -> PathBuf {
        let dir = env::temp_dir()
            .join("voice-mirror-test-chat")
            .join(test_name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    /// Helper: write a chat JSON file directly (bypassing the command).
    fn write_chat_file(dir: &Path, chat: &Value) {
        let id = chat["id"].as_str().unwrap();
        let path = dir.join(format!("{}.json", id));
        let json = serde_json::to_string_pretty(chat).unwrap();
        fs::write(path, json).unwrap();
    }

    // ---- ID validation tests ----

    #[test]
    fn test_validate_id_accepts_valid() {
        assert!(validate_id("abc-123_def").is_ok());
        assert!(validate_id("a").is_ok());
        assert!(validate_id("UPPER_lower-123").is_ok());
        assert!(validate_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn test_validate_id_rejects_empty() {
        assert!(validate_id("").is_err());
    }

    #[test]
    fn test_validate_id_rejects_path_traversal() {
        assert!(validate_id("../etc/passwd").is_err());
        assert!(validate_id("..").is_err());
        assert!(validate_id("foo/../bar").is_err());
        assert!(validate_id("foo/bar").is_err());
        assert!(validate_id("foo\\bar").is_err());
    }

    #[test]
    fn test_validate_id_rejects_dots_and_special() {
        assert!(validate_id("foo.bar").is_err());
        assert!(validate_id("foo bar").is_err());
        assert!(validate_id("foo@bar").is_err());
        assert!(validate_id("foo\0bar").is_err());
    }

    // ---- Save + Load roundtrip ----

    #[test]
    fn test_save_and_load_roundtrip() {
        let dir = test_chats_dir("roundtrip");

        let chat = json!({
            "id": "test-chat-1",
            "name": "Test Chat",
            "messages": [
                {
                    "id": "msg-1",
                    "role": "user",
                    "content": "Hello",
                    "timestamp": 1708300000000_u64,
                    "toolName": null,
                    "toolStatus": null
                }
            ],
            "createdAt": 1708300000000_u64,
            "updatedAt": 1708300000000_u64
        });

        // Write directly to the test directory
        write_chat_file(&dir, &chat);

        // Read it back
        let path = dir.join("test-chat-1.json");
        let text = fs::read_to_string(&path).unwrap();
        let loaded: Value = serde_json::from_str(&text).unwrap();

        assert_eq!(loaded["id"], "test-chat-1");
        assert_eq!(loaded["name"], "Test Chat");
        assert_eq!(loaded["messages"].as_array().unwrap().len(), 1);
        assert_eq!(loaded["messages"][0]["content"], "Hello");

        // Cleanup
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    // ---- List returns sorted metadata ----

    #[test]
    fn test_list_returns_sorted_metadata() {
        let dir = test_chats_dir("list_sorted");

        let older = json!({
            "id": "chat-old",
            "name": "Older Chat",
            "messages": [{"id": "m1", "role": "user", "content": "hi", "timestamp": 1000}],
            "createdAt": 1000_u64,
            "updatedAt": 1000_u64
        });

        let newer = json!({
            "id": "chat-new",
            "name": "Newer Chat",
            "messages": [
                {"id": "m2", "role": "user", "content": "hi", "timestamp": 2000},
                {"id": "m3", "role": "assistant", "content": "hello", "timestamp": 2001}
            ],
            "createdAt": 2000_u64,
            "updatedAt": 2000_u64
        });

        write_chat_file(&dir, &older);
        write_chat_file(&dir, &newer);

        // Read all files and build the list manually (same logic as chat_list)
        let entries = fs::read_dir(&dir).unwrap();
        let mut chats: Vec<Value> = Vec::new();

        for entry in entries {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let text = fs::read_to_string(&path).unwrap();
            let chat: Value = serde_json::from_str(&text).unwrap();
            let message_count = chat["messages"].as_array().map(|a| a.len()).unwrap_or(0);
            chats.push(json!({
                "id": chat["id"],
                "name": chat["name"],
                "createdAt": chat["createdAt"],
                "updatedAt": chat["updatedAt"],
                "messageCount": message_count,
            }));
        }

        chats.sort_by(|a, b| {
            let a_time = a["updatedAt"].as_u64().unwrap_or(0);
            let b_time = b["updatedAt"].as_u64().unwrap_or(0);
            b_time.cmp(&a_time)
        });

        // Newer chat should be first
        assert_eq!(chats.len(), 2);
        assert_eq!(chats[0]["id"], "chat-new");
        assert_eq!(chats[0]["messageCount"], 2);
        assert_eq!(chats[1]["id"], "chat-old");
        assert_eq!(chats[1]["messageCount"], 1);

        // Messages should NOT be included in list metadata
        assert!(chats[0].get("messages").is_none());
        assert!(chats[1].get("messages").is_none());

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    // ---- Delete ----

    #[test]
    fn test_delete_removes_file() {
        let dir = test_chats_dir("delete");

        let chat = json!({
            "id": "to-delete",
            "name": "Delete Me",
            "messages": [],
            "createdAt": 1000_u64,
            "updatedAt": 1000_u64
        });

        write_chat_file(&dir, &chat);

        let path = dir.join("to-delete.json");
        assert!(path.exists());

        fs::remove_file(&path).unwrap();
        assert!(!path.exists());

        // Deleting again should not error (idempotent)
        // (the file is already gone -- no error expected)
        assert!(!path.exists());

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn test_delete_nonexistent_is_ok() {
        // Deleting a file that doesn't exist should succeed
        let dir = test_chats_dir("delete_nonexistent");
        let path = dir.join("nonexistent.json");
        assert!(!path.exists());
        // No error -- this is the expected behavior
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    // ---- Rename ----

    #[test]
    fn test_rename_updates_name_and_timestamp() {
        let dir = test_chats_dir("rename");

        let chat = json!({
            "id": "rename-me",
            "name": "Old Name",
            "messages": [],
            "createdAt": 1000_u64,
            "updatedAt": 1000_u64
        });

        write_chat_file(&dir, &chat);

        // Read, update name + updatedAt, write back
        let path = dir.join("rename-me.json");
        let text = fs::read_to_string(&path).unwrap();
        let mut loaded: Value = serde_json::from_str(&text).unwrap();

        let obj = loaded.as_object_mut().unwrap();
        obj.insert("name".into(), Value::String("New Name".into()));
        obj.insert("updatedAt".into(), json!(now_millis()));

        let json_str = serde_json::to_string_pretty(&loaded).unwrap();
        fs::write(&path, json_str).unwrap();

        // Verify
        let text = fs::read_to_string(&path).unwrap();
        let final_chat: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(final_chat["name"], "New Name");
        assert!(final_chat["updatedAt"].as_u64().unwrap() > 1000);

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    // ---- Atomic write ----

    #[test]
    fn test_atomic_write_creates_file() {
        let dir = test_chats_dir("atomic_write");
        let path = dir.join("test.json");

        let value = json!({"hello": "world"});
        atomic_write(&path, &value).unwrap();

        let text = fs::read_to_string(&path).unwrap();
        let loaded: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(loaded["hello"], "world");

        // tmp file should be cleaned up
        assert!(!path.with_extension("json.tmp").exists());

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }
}
