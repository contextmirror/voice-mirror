//! Workspace state persistence — save/load per-project editor state.

use super::{hash_filename, IpcResponse};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

/// Get the workspace-state directory under %APPDATA%/voice-mirror/.
fn state_dir() -> Result<PathBuf, String> {
    let app_data = dirs::config_dir()
        .ok_or("Cannot determine config directory")?;
    Ok(app_data.join("voice-mirror").join("workspace-state"))
}

// ── save_workspace_state ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStateParams {
    pub project_path: String,
    pub state: Value,
}

#[tauri::command]
pub fn save_workspace_state(params: SaveStateParams) -> IpcResponse {
    let dir = match state_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return IpcResponse::err(format!("Failed to create state directory: {e}"));
    }

    let hash = hash_filename(&params.project_path);
    let filename = format!("{hash}.json");
    let dest = dir.join(&filename);
    let tmp = dir.join(format!("{hash}.json.tmp"));

    // Serialize JSON
    let json = match serde_json::to_string_pretty(&params.state) {
        Ok(j) => j,
        Err(e) => return IpcResponse::err(format!("Failed to serialize state: {e}")),
    };

    // Atomic write: write to .tmp, then rename
    if let Err(e) = std::fs::write(&tmp, &json) {
        return IpcResponse::err(format!("Failed to write state file: {e}"));
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        // Fallback: try direct write if rename fails (cross-device)
        let _ = std::fs::remove_file(&tmp);
        if let Err(e2) = std::fs::write(&dest, &json) {
            return IpcResponse::err(format!("Failed to save state: {e}, {e2}"));
        }
    }

    IpcResponse::ok_empty()
}

// ── load_workspace_state ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadStateParams {
    pub project_path: String,
}

#[tauri::command]
pub fn load_workspace_state(params: LoadStateParams) -> IpcResponse {
    let dir = match state_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };

    let hash = hash_filename(&params.project_path);
    let path = dir.join(format!("{hash}.json"));

    if !path.exists() {
        return IpcResponse::ok(Value::Null);
    }

    match std::fs::read_to_string(&path) {
        Ok(contents) => {
            match serde_json::from_str::<Value>(&contents) {
                Ok(state) => IpcResponse::ok(state),
                Err(e) => {
                    tracing::warn!("Corrupt workspace state file {}: {e}", path.display());
                    IpcResponse::ok(Value::Null)
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to read workspace state {}: {e}", path.display());
            IpcResponse::ok(Value::Null)
        }
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_and_load_workspace_state() {
        let project_path = "E:\\Projects\\test-project-ws-state".to_string();

        let state = serde_json::json!({
            "version": 1,
            "tabs": [{ "path": "src/main.rs", "pinned": false }],
            "activeTabId": "src/main.rs"
        });

        let result = save_workspace_state(SaveStateParams {
            project_path: project_path.clone(),
            state: state.clone(),
        });
        assert!(result.success, "save should succeed");

        let result = load_workspace_state(LoadStateParams {
            project_path: project_path.clone(),
        });
        assert!(result.success, "load should succeed");
        let loaded = result.data.unwrap();
        assert_eq!(loaded["version"], 1);
        assert_eq!(loaded["activeTabId"], "src/main.rs");

        // Cleanup
        let hash = hash_filename(&project_path);
        let path = state_dir().unwrap().join(format!("{hash}.json"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_load_missing_state_returns_null() {
        let result = load_workspace_state(LoadStateParams {
            project_path: "E:\\Projects\\nonexistent-project-xyz".to_string(),
        });
        assert!(result.success);
        assert_eq!(result.data.unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn test_load_corrupt_state_returns_null() {
        let dir = state_dir().unwrap();
        let _ = std::fs::create_dir_all(&dir);
        let hash = hash_filename("E:\\corrupt-test-ws");
        let path = dir.join(format!("{hash}.json"));
        std::fs::write(&path, b"not valid json {{{").unwrap();

        let result = load_workspace_state(LoadStateParams {
            project_path: "E:\\corrupt-test-ws".to_string(),
        });
        assert!(result.success, "should not error on corrupt file");
        assert_eq!(result.data.unwrap(), serde_json::Value::Null);

        let _ = std::fs::remove_file(&path);
    }
}
