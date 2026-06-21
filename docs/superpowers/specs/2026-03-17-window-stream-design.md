# Window Stream to Localhost

**Date:** 2026-03-17
**Status:** Approved

## Problem

When developing non-web applications (WoW addons, desktop apps, games), Claude can't see the running application without manual screenshots. The user has to repeatedly take and share screenshots during the development loop. This breaks the conversational flow — "I've reloaded, does it look right?" requires stopping to capture and paste.

## Solution

Stream any open window to `http://localhost:PORT/` as a live MJPEG feed. The Browser panel auto-opens the stream so Claude can screenshot on demand using existing MCP tools. One click to start, then the visual feedback loop is always available.

## User Flow

```
Click "+" → "Stream Window..."
  → Window picker modal (thumbnails of open windows)
  → Select "World of Warcraft"
  → Stream starts at http://localhost:9876/
  → Browser panel auto-navigates to stream URL
  → URL copied to clipboard
  → Toast: "Streaming 'World of Warcraft' to localhost:9876"

User: "Claude, take a screenshot — does the addon look right?"
Claude: [screenshots Browser panel via existing browser_action MCP tool]
Claude: "I can see the addon panel. The tooltip text is cut off..."

Click "+" → "Stop Stream"
  → Stream stops, HTTP server shuts down
  → Toast: "Stream stopped"
```

## Capture: Windows.Graphics.Capture (WGC)

The same API OBS uses for modern game/window capture. Handles DirectX, OpenGL, Vulkan, UWP apps, borderless and exclusive fullscreen — all window types.

### Implementation

WGC requires a dedicated thread with a WinRT `DispatcherQueue`. The capture runs on this thread, not on Tokio worker threads.

**Initialization chain:**
1. Spawn a dedicated capture thread
2. Create `DispatcherQueueController` via `CreateDispatcherQueueController` (from `CoreMessaging.dll`) — required for WGC callbacks
3. Create D3D11 device: `D3D11CreateDevice` → `IDXGIDevice` → `CreateDirect3D11DeviceFromDXGIDevice` → `IDirect3DDevice` (WinRT interop)
4. `GraphicsCaptureItem::CreateForWindow(HWND(hwnd as _))` — note: HWND is pointer-sized, cast from i64
5. `Direct3D11CaptureFramePool::CreateFreeThreaded(device, format, 2, size)` — pool size 2 (double buffer, intentional — we only need the latest frame, dropped frames are fine)
6. Register `FrameArrived` callback on the frame pool
7. Create `GraphicsCaptureSession` and call `StartCapture()`

**Per-frame callback:**
1. `TryGetNextFrame()` → `Direct3D11CaptureFrame`
2. Get `IDirect3DSurface` → query `IDirect3DDxgiInterfaceAccess` → `ID3D11Texture2D`
3. Copy to staging texture (`ID3D11DeviceContext::CopyResource`) → map to CPU memory
4. BGRA pixels → JPEG encode (quality 80) via `image` crate
5. Swap into shared frame buffer (lock-free `ArcSwap<Vec<u8>>`)
6. Rate-limit: skip frames if less than `1/fps` seconds since last encode

**Teardown:**
1. Stop capture session
2. Close frame pool
3. Shut down dispatcher queue
4. Thread exits

### Shared Frame Buffer

Use `arc_swap::ArcSwap<Vec<u8>>` instead of `Mutex` for lock-free reads. The capture thread calls `store()` with each new JPEG. The MJPEG server calls `load()` to get the latest frame. No contention, no tearing.

Add `arc-swap = "1"` to `Cargo.toml`.

### New Windows Crate Features

Add to `Cargo.toml` `[target.'cfg(windows)'.dependencies.windows]` features:

```toml
"Graphics_Capture",
"Graphics_DirectX",
"Graphics_DirectX_Direct3D11",
"Graphics_Imaging",
"Win32_Graphics_Direct3D11",
"Win32_Graphics_Direct3D",
"Win32_Graphics_Dxgi",
"Win32_System_WinRT_Direct3D11",
"Foundation",
```

### WGC Requirements

- Windows 10 version 1903+ (build 18362). All modern Windows 10/11 systems.
- Requires the app to be DPI-aware (Tauri apps already are).
- `CreateForWindow` needs HWND — obtained from existing `list_windows()` command.

## MJPEG Server

A minimal HTTP server serving a multipart JPEG stream. Browsers render MJPEG natively — no JavaScript, no HLS player, no video codec.

### Protocol

```
GET /stream → HTTP 200
Content-Type: multipart/x-mixed-replace; boundary=frame

--frame\r\n
Content-Type: image/jpeg\r\n
Content-Length: 45231\r\n
\r\n
<JPEG bytes>
--frame\r\n
Content-Type: image/jpeg\r\n
...
```

### HTML Page

`GET /` serves a simple HTML page with auto-reconnect (WebView2/Chromium can stall on long-lived MJPEG streams):

```html
<html>
<body style="margin:0;background:#000">
  <img id="stream" src="/stream" style="width:100%;height:100%;object-fit:contain">
  <script>
    const img = document.getElementById('stream');
    img.onerror = () => { setTimeout(() => { img.src = '/stream?' + Date.now(); }, 1000); };
  </script>
</body>
</html>
```

### Port Selection

Default port: `9876`. If busy, auto-increment through `9877`–`9886`. If all taken, return error. Port is included in the response from `start_window_stream` so the frontend knows where to navigate.

### Performance

- JPEG quality: 80 (good clarity, small size)
- At 1920×1080 @ 30 FPS: ~50–100 KB per frame → ~2–3 MB/s
- Localhost only — bandwidth is irrelevant
- CPU cost is dominated by JPEG encoding, not capture (WGC is GPU-accelerated)

## "+" Menu Changes

In `ChatInput.svelte`, the action menu gains a context-sensitive streaming item:

**When not streaming:**
```
[+] Menu:
  📷 Screenshot
  🎥 Stream Window...    ← NEW (opens window picker)
  💾 Save chat
  🗑 Clear chat
```

**When streaming:**
```
[+] Menu:
  📷 Screenshot
  ⏹ Stop Stream          ← Replaces "Stream Window..." while active
  💾 Save chat
  🗑 Clear chat
```

### On "Stream Window..." click:

1. Call `list_windows()` (existing) → show `WindowPickerModal`
2. User selects a window
3. Call `start_window_stream(hwnd, fps)` → returns `{ port, url }`
4. Navigate Browser panel to `http://localhost:{port}/`
5. Copy URL to clipboard
6. Show toast: "Streaming '{title}' to localhost:{port}"

### On "Stop Stream" click:

1. Call `stop_window_stream()`
2. Show toast: "Stream stopped"
3. Menu item reverts to "Stream Window..."

## Backend Architecture

```
┌─ WindowStreamService ────────────────────────────────┐
│                                                       │
│  WGC Capture ──→ Frame Buffer ──→ MJPEG Server       │
│  (30 FPS)        (Arc<Mutex<>>    (localhost:9876)    │
│                   latest JPEG)                        │
│                                                       │
│  State: { hwnd, running, port, fps, title }           │
└───────────────────────────────────────────────────────┘
```

### Shared Frame Buffer

`Arc<Mutex<Vec<u8>>>` holding the latest JPEG-encoded frame. The capture thread writes to it at the configured FPS. The MJPEG server reads from it on each client frame delivery. No queue, no history — always the latest frame.

### Single Stream Constraint

Only one stream at a time. Starting a new stream stops the previous one. YAGNI — multiple simultaneous streams add complexity with no clear use case.

## Tauri Commands

### `start_window_stream`

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStreamParams {
    pub hwnd: i64,
    pub fps: Option<u32>,  // default: 30
}

#[tauri::command]
pub async fn start_window_stream(params: StartStreamParams) -> IpcResponse
// Returns: { port: 9876, url: "http://localhost:9876/" }
```

### `stop_window_stream`

```rust
#[tauri::command]
pub async fn stop_window_stream() -> IpcResponse
// Returns: ok_empty
// Async because it needs to signal the capture thread and HTTP server to shut down gracefully.
```

### `get_stream_status`

```rust
#[tauri::command]
pub fn get_stream_status() -> IpcResponse
// Returns: { running: bool, hwnd: i64?, title: String?, port: u32?, fps: u32? }
```

## Window Picker Modal

New `WindowPickerModal.svelte` component. Reuses the existing `list_windows()` command which already returns thumbnails for all visible windows.

```
┌─ Stream Window ──────────────────────────────┐
│                                               │
│  FPS: [30 ▾]                                  │
│                                               │
│  ┌─────┐  World of Warcraft                   │
│  │thumb│  WowClassic.exe — 2560×1440          │
│  └─────┘                                      │
│                                               │
│  ┌─────┐  Discord                              │
│  │thumb│  Discord.exe — 1920×1080              │
│  └─────┘                                      │
│                                               │
│  ┌─────┐  Firefox                              │
│  │thumb│  firefox.exe — 1920×1080              │
│  └─────┘                                      │
│                                               │
│              [Cancel]  [Stream]                │
└───────────────────────────────────────────────┘
```

- Window list from `list_windows()` (already returns title, processName, dimensions, thumbnail)
- FPS dropdown: 5, 15, 30 (default 30)
- Click a window to select it (highlight), click "Stream" to start
- Freezes WebView2 lens while open (airspace problem — same pattern as EditProjectModal)

## FPS Configuration

- Default: 30 FPS
- Configurable via the picker modal dropdown
- Not persisted to config (session-only setting — most users will leave it at 30)
- Stored on the `WindowStreamService` instance

## Edge Cases

- **Window closed while streaming:** WGC fires `Closed` event on `GraphicsCaptureItem`. Stop stream, show toast "Stream ended — window was closed."
- **Window minimized:** WGC continues capturing minimized windows (renders last-known content). Frame continues to update.
- **Port busy:** Auto-increment 9876→9886. If all taken, return error.
- **App shutdown:** Stop stream + HTTP server in cleanup. `Drop` impl on `WindowStreamService`.
- **Multiple browser clients:** MJPEG server handles multiple concurrent GET /stream connections. Each client gets the same frames independently.
- **DPI scaling:** WGC captures at native resolution regardless of DPI. JPEG encoding works on raw pixels.
- **Permission prompt:** Windows may show a one-time "Allow this app to record your screen?" dialog for WGC. This is OS-level and cannot be suppressed.
- **No WGC support (old Windows):** Return clear error: "Window streaming requires Windows 10 version 1903 or later."
- **Browser panel on stop:** After stopping the stream, the Browser panel stays on the last page (localhost URL will show connection refused). This is acceptable — the user can navigate elsewhere. No auto-redirect.
- **Streaming Voice Mirror itself:** The window picker does NOT filter out the Voice Mirror window. If the user selects it, the stream will show an infinite mirror effect. This is a cosmetic curiosity, not a crash — accepted as an edge case.

## Dependencies

### New Rust Dependencies

```toml
# HTTP server for MJPEG streaming (lightweight, minimal deps)
tiny_http = "0.12"

# Lock-free frame buffer
arc-swap = "1"

# JPEG encoding (already have `image` crate with jpeg feature)
# No new dependency needed — image crate handles it
```

`tiny_http` is preferred over `hyper` — it's ~50KB, synchronous (runs on its own thread alongside the capture thread), and perfect for a 2-endpoint MJPEG server. No async runtime needed for the HTTP side.

### New Windows Crate Features

```toml
"Graphics_Capture",
"Graphics_DirectX",
"Graphics_DirectX_Direct3D11",
"Graphics_Imaging",
```

## API Wrappers

In `src/lib/api.js`:

```javascript
export async function startWindowStream(hwnd, fps) {
  return invoke('start_window_stream', { params: { hwnd, fps: fps || null } });
}

export async function stopWindowStream() {
  return invoke('stop_window_stream');
}

export async function getStreamStatus() {
  return invoke('get_stream_status');
}
```

## Files to Create/Modify

| File | Change |
|------|--------|
| `src-tauri/src/services/window_stream.rs` | New: WGC capture loop + MJPEG HTTP server + frame buffer |
| `src-tauri/src/services/mod.rs` | Add `pub mod window_stream;` |
| `src-tauri/src/commands/screenshot.rs` | Add `start_window_stream`, `stop_window_stream`, `get_stream_status` commands |
| `src-tauri/src/lib.rs` | Register 3 new commands |
| `src-tauri/Cargo.toml` | Add WGC features, hyper dependencies |
| `src/components/chat/ChatInput.svelte` | Add "Stream Window..." / "Stop Stream" menu items |
| `src/components/chat/WindowPickerModal.svelte` | New: window selection modal with FPS dropdown |
| `src/lib/api.js` | Add 3 API wrappers |
