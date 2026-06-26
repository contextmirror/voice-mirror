//! Sandbox mode commands.
//!
//! Sandbox mode runs an app *being built* in its own isolated process (launched
//! with `--remote-debugging-port`) and drives it over CDP — so it can't crash
//! Voice Mirror, and the AI can see/interact with the real running app through
//! the same element-ref model it uses for websites.

use super::IpcResponse;

/// Snapshot an external app's UI via its CDP remote-debugging `port`.
///
/// Returns `{ pageUrl, tree, refCount }` where `tree` is the accessibility tree
/// rendered to `@ref` element refs (the same format the AI uses for the browser).
#[tauri::command]
pub async fn sandbox_snapshot(port: u16) -> IpcResponse {
    match crate::services::sandbox::snapshot(port).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Click an element in the sandboxed app by its `@ref` (from the last snapshot).
#[tauri::command]
pub async fn sandbox_click(port: u16, element_ref: String) -> IpcResponse {
    match crate::services::sandbox::click(port, &element_ref).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Type `text` into an element in the sandboxed app by its `@ref`.
#[tauri::command]
pub async fn sandbox_type(port: u16, element_ref: String, text: String) -> IpcResponse {
    match crate::services::sandbox::type_text(port, &element_ref, &text).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Screenshot the sandboxed app's web contents (JPEG). Returns `{ base64, contentType }`.
#[tauri::command]
pub async fn sandbox_screenshot(port: u16) -> IpcResponse {
    match crate::services::sandbox::screenshot(port).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Record the CDP port of the active sandbox app, so the sandbox MCP tools can
/// default to it when the AI omits an explicit `port`.
#[tauri::command]
pub fn sandbox_set_active_port(port: u16) -> IpcResponse {
    crate::services::sandbox::set_active_cdp_port(Some(port));
    IpcResponse::ok(serde_json::json!({ "port": port }))
}

/// Clear the active sandbox CDP port (e.g. when the dev server stops/crashes).
#[tauri::command]
pub fn sandbox_clear_active_port() -> IpcResponse {
    crate::services::sandbox::set_active_cdp_port(None);
    IpcResponse::ok(serde_json::json!({ "ok": true }))
}
