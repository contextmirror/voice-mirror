//! Project icon management commands.

use super::IpcResponse;
use base64::Engine as _;
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Get the project-icons directory under %APPDATA%/voice-mirror/.
fn icons_dir() -> Result<PathBuf, String> {
    let app_data = dirs::config_dir()
        .ok_or("Cannot determine config directory")?;
    Ok(app_data.join("voice-mirror").join("project-icons"))
}

/// Hash a string to a hex filename for uniqueness.
fn hash_filename(source: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

// ── save_project_icon ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveIconParams {
    pub file_path: String,
}

#[tauri::command]
pub fn save_project_icon(params: SaveIconParams) -> IpcResponse {
    let source = Path::new(&params.file_path);

    // Validate extension
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let allowed = ["png", "jpg", "jpeg", "webp", "svg"];
    if !allowed.contains(&ext.as_str()) {
        return IpcResponse::err(format!("Unsupported image format: {ext}"));
    }

    // Ensure icons directory exists
    let dir = match icons_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return IpcResponse::err(format!("Failed to create icons directory: {e}"));
    }

    // Check file size for warning
    let size_warning = std::fs::metadata(source)
        .map(|m| m.len() > 1_048_576)
        .unwrap_or(false);

    let hash = hash_filename(&params.file_path);

    // SVG: copy as-is (vector format, no resize)
    if ext == "svg" {
        let filename = format!("{hash}.svg");
        let dest = dir.join(&filename);
        if let Err(e) = std::fs::copy(source, &dest) {
            return IpcResponse::err(format!("Failed to copy SVG: {e}"));
        }
        let svg_bytes = match std::fs::read(&dest) {
            Ok(b) => b,
            Err(e) => return IpcResponse::err(format!("Failed to read SVG: {e}")),
        };
        let data_url = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&svg_bytes)
        );
        return IpcResponse::ok(serde_json::json!({
            "filename": filename,
            "dataUrl": data_url,
            "sizeWarning": size_warning,
        }));
    }

    // Raster image: load, resize to 128x128, save as PNG
    let img = match image::open(source) {
        Ok(i) => i,
        Err(e) => return IpcResponse::err(format!("Failed to load image: {e}")),
    };

    let resized = img.resize_exact(128, 128, image::imageops::FilterType::Triangle);

    let mut png_buf = std::io::Cursor::new(Vec::new());
    if let Err(e) = resized.write_to(&mut png_buf, image::ImageFormat::Png) {
        return IpcResponse::err(format!("Failed to encode PNG: {e}"));
    }
    let png_bytes = png_buf.into_inner();

    let filename = format!("{hash}.png");
    let dest = dir.join(&filename);
    if let Err(e) = std::fs::write(&dest, &png_bytes) {
        return IpcResponse::err(format!("Failed to save icon: {e}"));
    }

    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    );

    IpcResponse::ok(serde_json::json!({
        "filename": filename,
        "dataUrl": data_url,
        "sizeWarning": size_warning,
    }))
}

// ── remove_project_icon ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveIconParams {
    pub filename: String,
}

#[tauri::command]
pub fn remove_project_icon(params: RemoveIconParams) -> IpcResponse {
    // Path traversal defense: only allow alphanumeric + dot + hyphen
    let valid = params.filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '-')
        && !params.filename.contains("..");
    if !valid {
        return IpcResponse::err("Invalid filename");
    }

    let dir = match icons_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };

    let path = dir.join(&params.filename);
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            return IpcResponse::err(format!("Failed to delete icon: {e}"));
        }
    }

    IpcResponse::ok_empty()
}

// ── load_project_icons ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadIconsParams {
    pub filenames: Vec<String>,
}

#[tauri::command]
pub fn load_project_icons(params: LoadIconsParams) -> IpcResponse {
    let dir = match icons_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };

    let mut icons = serde_json::Map::new();

    for filename in &params.filenames {
        // Path traversal defense: same validation as remove_project_icon
        let valid = filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '-')
            && !filename.contains("..");
        if !valid {
            continue;
        }
        let path = dir.join(filename);
        if let Ok(bytes) = std::fs::read(&path) {
            let mime = if filename.ends_with(".svg") {
                "image/svg+xml"
            } else {
                "image/png"
            };
            let data_url = format!(
                "data:{};base64,{}",
                mime,
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
            icons.insert(filename.clone(), serde_json::Value::String(data_url));
        }
    }

    IpcResponse::ok(serde_json::json!({ "icons": icons }))
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a minimal valid 2x2 red PNG for testing.
    fn create_test_png(path: &Path) {
        let img = image::ImageBuffer::from_fn(2, 2, |_, _| {
            image::Rgba([255u8, 0, 0, 255])
        });
        img.save(path).expect("Failed to save test PNG");
    }

    #[test]
    fn test_save_project_icon_creates_resized_png() {
        let tmp = std::env::temp_dir().join("vm-icon-test-save");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let source = tmp.join("test.png");
        create_test_png(&source);

        let result = save_project_icon(SaveIconParams {
            file_path: source.to_string_lossy().to_string(),
        });

        assert!(result.success, "save_project_icon should succeed");
        let data = result.data.unwrap();
        assert!(data["filename"].as_str().unwrap().ends_with(".png"));
        assert!(data["dataUrl"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(data["sizeWarning"].as_bool().unwrap(), false);

        // Verify the saved file is 128x128
        let saved_path = icons_dir().unwrap().join(data["filename"].as_str().unwrap());
        let saved_img = image::open(&saved_path).unwrap();
        assert_eq!(saved_img.width(), 128);
        assert_eq!(saved_img.height(), 128);

        // Cleanup
        let _ = fs::remove_file(&saved_path);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_remove_project_icon_deletes_file() {
        let dir = icons_dir().unwrap();
        fs::create_dir_all(&dir).unwrap();
        let test_file = dir.join("test-remove.png");
        fs::write(&test_file, b"fake png data").unwrap();

        let result = remove_project_icon(RemoveIconParams {
            filename: "test-remove.png".to_string(),
        });

        assert!(result.success);
        assert!(!test_file.exists(), "File should be deleted");
    }

    #[test]
    fn test_remove_project_icon_rejects_path_traversal() {
        let result = remove_project_icon(RemoveIconParams {
            filename: "../../../etc/passwd".to_string(),
        });
        assert!(!result.success, "Should reject path traversal");
    }

    #[test]
    fn test_load_project_icons_returns_data_urls() {
        let dir = icons_dir().unwrap();
        fs::create_dir_all(&dir).unwrap();
        let test_file = dir.join("test-load.png");
        fs::write(&test_file, b"fake png data").unwrap();

        let result = load_project_icons(LoadIconsParams {
            filenames: vec!["test-load.png".to_string(), "nonexistent.png".to_string()],
        });

        assert!(result.success);
        let data = result.data.unwrap();
        let icons = data["icons"].as_object().unwrap();
        assert!(icons.contains_key("test-load.png"), "Should include existing file");
        assert!(!icons.contains_key("nonexistent.png"), "Should skip missing files");
        assert!(icons["test-load.png"].as_str().unwrap().starts_with("data:image/png;base64,"));

        // Cleanup
        let _ = fs::remove_file(&test_file);
    }

    #[test]
    fn test_load_project_icons_rejects_path_traversal() {
        let result = load_project_icons(LoadIconsParams {
            filenames: vec!["../../../etc/passwd".to_string()],
        });

        assert!(result.success);
        let data = result.data.unwrap();
        let icons = data["icons"].as_object().unwrap();
        assert!(icons.is_empty(), "Should skip path traversal filenames");
    }

    #[test]
    fn test_save_project_icon_rejects_unsupported_format() {
        let tmp = std::env::temp_dir().join("vm-icon-test-reject");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("test.bmp");
        fs::write(&source, b"fake bmp").unwrap();

        let result = save_project_icon(SaveIconParams {
            file_path: source.to_string_lossy().to_string(),
        });

        assert!(!result.success, "Should reject unsupported format");
        assert!(result.error.unwrap().contains("Unsupported"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
