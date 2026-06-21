# Window Stream to Localhost Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream any open window to `http://localhost:PORT/` as a live MJPEG feed, viewable in the Browser panel so Claude can screenshot on demand.

**Architecture:** Windows.Graphics.Capture (WGC) captures frames on a dedicated thread with a DispatcherQueue. Frames are JPEG-encoded and stored in a lock-free `ArcSwap` buffer. A `tiny_http` server serves MJPEG to any browser client. Three Tauri commands (`start_window_stream`, `stop_window_stream`, `get_stream_status`) control the lifecycle. The "+" menu in ChatInput gains "Stream Window..." / "Stop Stream" items.

**Tech Stack:** Rust (Windows.Graphics.Capture, D3D11, tiny_http, arc-swap, image crate for JPEG), Svelte 5 (modal, menu integration).

**Spec:** `docs/superpowers/specs/2026-03-17-window-stream-design.md`

---

### Task 1: Add Dependencies to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add new crate dependencies**

In `src-tauri/Cargo.toml`, add to the `[dependencies]` section:

```toml
arc-swap = "1"
```

Note: We use raw `TcpListener` for the MJPEG server instead of `tiny_http` — no HTTP server dependency needed. The MJPEG protocol is simple enough to write directly.

- [ ] **Step 2: Add WGC and D3D11 features to the windows crate**

In the `[target.'cfg(windows)'.dependencies]` section, add these features to the existing `windows` dependency (after `"Win32_Security_Cryptography"`):

```toml
    "Graphics_Capture",
    "Graphics_DirectX",
    "Graphics_DirectX_Direct3D11",
    "Graphics_Imaging",
    "Win32_Graphics_Direct3D11",
    "Win32_Graphics_Direct3D",
    "Win32_Graphics_Dxgi",
    "Win32_Graphics_Dxgi_Common",
    "Win32_System_WinRT_Direct3D11",
    "Win32_System_WinRT_Graphics_Capture",
    "Foundation",
```

- [ ] **Step 3: Verify compilation**

Run: `cd "E:/Projects/Voice Mirror/src-tauri" && cargo check 2>&1 | tail -5`
Expected: `Finished` — new deps download and build.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(stream): add WGC, D3D11, tiny_http, arc-swap dependencies"
```

---

### Task 2: Window Stream Service — Core Capture + MJPEG Server

This is the largest task. It creates the `WindowStreamService` — the WGC capture loop, JPEG encoding, frame buffer, and MJPEG HTTP server.

**Files:**
- Create: `src-tauri/src/services/window_stream.rs`
- Modify: `src-tauri/src/services/mod.rs`

- [ ] **Step 1: Create `window_stream.rs` with the full service**

Create `src-tauri/src/services/window_stream.rs`. This is a large file (~400 lines) with four main parts:

**Part A — Imports and state:**

```rust
//! Window Stream Service: captures any window via Windows.Graphics.Capture
//! and streams MJPEG to localhost for Claude to screenshot on demand.

use arc_swap::ArcSwap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{error, info, warn};

/// Global stream state — only one stream at a time.
static STREAM_STATE: std::sync::OnceLock<std::sync::Mutex<StreamState>> = std::sync::OnceLock::new();

fn state() -> &'static std::sync::Mutex<StreamState> {
    STREAM_STATE.get_or_init(|| std::sync::Mutex::new(StreamState::default()))
}

#[derive(Default)]
struct StreamState {
    running: bool,
    port: u16,
    hwnd: i64,
    title: String,
    fps: u32,
    stop_flag: Option<Arc<AtomicBool>>,
}

/// Shared frame buffer — latest JPEG bytes, lock-free.
static FRAME_BUFFER: std::sync::OnceLock<Arc<ArcSwap<Vec<u8>>>> = std::sync::OnceLock::new();

fn frame_buffer() -> &'static Arc<ArcSwap<Vec<u8>>> {
    FRAME_BUFFER.get_or_init(|| Arc::new(ArcSwap::from_pointee(Vec::new())))
}
```

**Part B — Start function:**

```rust
/// Start streaming a window. Returns the port number on success.
pub fn start(hwnd: i64, fps: u32) -> Result<u16, String> {
    // Stop any existing stream
    let _ = stop();

    let port = find_available_port()?;
    let stop_flag = Arc::new(AtomicBool::new(false));
    let buffer = frame_buffer().clone();

    // Get window title for display
    let title = get_window_title(hwnd);

    // Update state
    {
        let mut st = state().lock().unwrap();
        st.running = true;
        st.port = port;
        st.hwnd = hwnd;
        st.title = title.clone();
        st.fps = fps;
        st.stop_flag = Some(stop_flag.clone());
    }

    // Start capture thread (WGC + JPEG encoding)
    let capture_stop = stop_flag.clone();
    let capture_buffer = buffer.clone();
    std::thread::Builder::new()
        .name("wgc-capture".into())
        .spawn(move || {
            if let Err(e) = run_capture(hwnd, fps, capture_stop, capture_buffer) {
                error!("WGC capture failed: {}", e);
                let mut st = state().lock().unwrap();
                st.running = false;
            }
        })
        .map_err(|e| format!("Failed to spawn capture thread: {}", e))?;

    // Start MJPEG server thread
    let server_stop = stop_flag.clone();
    let server_buffer = buffer;
    std::thread::Builder::new()
        .name("mjpeg-server".into())
        .spawn(move || {
            run_mjpeg_server(port, server_stop, server_buffer);
        })
        .map_err(|e| format!("Failed to spawn MJPEG server: {}", e))?;

    info!("Started window stream: '{}' (hwnd={}) on port {}", title, hwnd, port);
    Ok(port)
}
```

**Part C — Stop function and status:**

```rust
/// Stop the current stream.
pub fn stop() -> Result<(), String> {
    let mut st = state().lock().unwrap();
    if let Some(flag) = st.stop_flag.take() {
        flag.store(true, Ordering::SeqCst);
    }
    st.running = false;
    info!("Window stream stopped");
    Ok(())
}

/// Get current stream status.
pub fn status() -> serde_json::Value {
    let st = state().lock().unwrap();
    serde_json::json!({
        "running": st.running,
        "hwnd": if st.running { Some(st.hwnd) } else { None },
        "title": if st.running { Some(&st.title) } else { None },
        "port": if st.running { Some(st.port) } else { None },
        "fps": if st.running { Some(st.fps) } else { None },
    })
}
```

**Part D — WGC capture loop (the complex part):**

**IMPORTANT:** The Windows crate 0.61 APIs have specific signatures that differ from documentation examples. The implementer MUST:
- Check actual method signatures via `cargo doc` or the windows crate source
- Use `IGraphicsCaptureItemInterop::CreateForWindow` (NOT `GraphicsCaptureItem::CreateForWindow`)
- Use the correct `Map` API: `Map(&resource, 0, D3D11_MAP_READ, 0, Some(&mut mapped))`
- Use `u32` for `BindFlags`, `CPUAccessFlags`, `MiscFlags` (not wrapper types)
- Register `item.Closed()` handler to detect window closure

```rust
#[cfg(target_os = "windows")]
fn run_capture(
    hwnd: i64,
    fps: u32,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<ArcSwap<Vec<u8>>>,
) -> Result<(), String> {
    use windows::core::*;
    use windows::Graphics::Capture::*;
    use windows::Graphics::DirectX::Direct3D11::*;
    use windows::Graphics::DirectX::*;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Direct3D::*;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::System::WinRT::Direct3D11::*;
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

    // Initialize COM on this thread (STA for WGC compatibility)
    unsafe {
        windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_APARTMENTTHREADED,
        ).ok();
    }

    // 1. Create D3D11 device
    let mut d3d_device: Option<ID3D11Device> = None;
    let mut d3d_context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            None,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut d3d_device),
            None,
            Some(&mut d3d_context),
        ).map_err(|e| format!("D3D11CreateDevice failed: {}", e))?;
    }
    let d3d_device = d3d_device.ok_or("D3D11 device is None")?;
    let d3d_context = d3d_context.ok_or("D3D11 context is None")?;

    // 2. Get DXGI device → WinRT IDirect3DDevice
    let dxgi_device: IDXGIDevice = d3d_device.cast()
        .map_err(|e| format!("Cast to IDXGIDevice failed: {}", e))?;
    let winrt_device = unsafe {
        CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)
            .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice failed: {}", e))?
    };
    let direct3d_device: IDirect3DDevice = winrt_device.cast()
        .map_err(|e| format!("Cast to IDirect3DDevice failed: {}", e))?;

    // 3. Create capture item via IGraphicsCaptureItemInterop (NOT CreateForWindow)
    let interop: IGraphicsCaptureItemInterop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .map_err(|e| format!("Failed to get IGraphicsCaptureItemInterop: {}", e))?;
    let item: GraphicsCaptureItem = unsafe {
        interop.CreateForWindow(HWND(hwnd as *mut _))
            .map_err(|e| format!("CreateForWindow failed: {}", e))?
    };
    let size = item.Size().map_err(|e| format!("GetSize failed: {}", e))?;

    // 4. Register Closed handler to detect window closure
    let closed_flag = stop_flag.clone();
    item.Closed(&windows::Foundation::TypedEventHandler::new(move |_, _| {
        warn!("WGC: target window closed");
        closed_flag.store(true, Ordering::SeqCst);
        Ok(())
    })).map_err(|e| format!("Failed to register Closed handler: {}", e))?;

    // 5. Create frame pool (pool size 2 = double buffer, dropped frames are intentional)
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &direct3d_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    ).map_err(|e| format!("CreateFreeThreaded failed: {}", e))?;

    // 6. Create session and start
    let session = pool.CreateCaptureSession(&item)
        .map_err(|e| format!("CreateCaptureSession failed: {}", e))?;
    session.StartCapture()
        .map_err(|e| format!("StartCapture failed: {}", e))?;

    info!("WGC capture started: {}x{} @ {} FPS", size.Width, size.Height, fps);

    // 7. Create staging texture for CPU readback
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: size.Width as u32,
        Height: size.Height as u32,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0u32,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0u32,
    };
    let staging_tex = unsafe {
        d3d_device.CreateTexture2D(&staging_desc, None)
            .map_err(|e| format!("CreateTexture2D staging failed: {}", e))?
    };

    // 8. Frame processing loop
    let frame_interval = std::time::Duration::from_millis(1000 / fps as u64);
    let mut last_frame_time = std::time::Instant::now();

    while !stop_flag.load(Ordering::SeqCst) {
        // Rate limiting
        let elapsed = last_frame_time.elapsed();
        if elapsed < frame_interval {
            std::thread::sleep(frame_interval - elapsed);
        }
        last_frame_time = std::time::Instant::now();

        // Try to get a frame
        let frame = match pool.TryGetNextFrame() {
            Ok(f) => f,
            Err(_) => continue,
        };

        let surface = match frame.Surface() {
            Ok(s) => s,
            Err(_) => continue,
        };

        // Get the D3D11 texture from the surface
        let access: IDirect3DDxgiInterfaceAccess = surface.cast().unwrap();
        let texture: ID3D11Texture2D = unsafe { access.GetInterface().unwrap() };

        // Copy to staging texture
        unsafe { d3d_context.CopyResource(&staging_tex, &texture); }

        // Map staging texture to CPU memory (correct windows 0.61 signature)
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        let map_result = unsafe {
            d3d_context.Map(&staging_tex, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
        };
        if map_result.is_err() { continue; }

        // Encode to JPEG
        let width = size.Width as u32;
        let height = size.Height as u32;
        let row_pitch = mapped.RowPitch as usize;
        let data = unsafe {
            std::slice::from_raw_parts(mapped.pData as *const u8, row_pitch * height as usize)
        };

        // BGRA → RGB for JPEG encoding
        let mut rgb = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height as usize {
            for x in 0..width as usize {
                let offset = y * row_pitch + x * 4;
                rgb.push(data[offset + 2]); // R
                rgb.push(data[offset + 1]); // G
                rgb.push(data[offset]);     // B
            }
        }

        unsafe { d3d_context.Unmap(&staging_tex, 0); }

        // Encode JPEG
        if let Some(img) = image::RgbImage::from_raw(width, height, rgb) {
            let mut jpeg_buf = std::io::Cursor::new(Vec::new());
            match image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, 80)
                .encode(&img, width, height, image::ExtendedColorType::Rgb8) {
                Ok(()) => { buffer.store(Arc::new(jpeg_buf.into_inner())); }
                Err(e) => { warn!("JPEG encode failed: {}", e); }
            }
        }
    }

    // Cleanup
    session.Close().ok();
    pool.Close().ok();
    // Update state to reflect stream ended
    if let Ok(mut st) = state().lock() {
        st.running = false;
    }
    info!("WGC capture loop ended");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn run_capture(
    _hwnd: i64,
    _fps: u32,
    _stop_flag: Arc<AtomicBool>,
    _buffer: Arc<ArcSwap<Vec<u8>>>,
) -> Result<(), String> {
    Err("Window streaming is only supported on Windows".to_string())
}
```

**Part E — MJPEG server (raw TcpListener — simpler and more reliable than tiny_http for streaming):**

```rust
fn run_mjpeg_server(port: u16, stop_flag: Arc<AtomicBool>, buffer: Arc<ArcSwap<Vec<u8>>>) {
    use std::io::{BufRead, Write};
    use std::net::TcpListener;

    let addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind MJPEG server on {}: {}", addr, e);
            return;
        }
    };

    // Non-blocking so we can check stop_flag
    listener.set_nonblocking(true).ok();

    info!("MJPEG server listening on http://localhost:{}/", port);

    while !stop_flag.load(Ordering::SeqCst) {
        let stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            Err(_) => break,
        };

        // Handle each connection in a thread (allows multiple viewers)
        let client_stop = stop_flag.clone();
        let client_buffer = buffer.clone();
        std::thread::spawn(move || {
            handle_client(stream, client_stop, client_buffer);
        });
    }

    info!("MJPEG server stopped");
}

fn handle_client(
    mut stream: std::net::TcpStream,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<ArcSwap<Vec<u8>>>,
) {
    use std::io::{BufRead, BufReader, Write};

    stream.set_nonblocking(false).ok();
    stream.set_write_timeout(Some(std::time::Duration::from_secs(5))).ok();

    // Read the HTTP request line to determine path
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() { return; }

    // Drain remaining headers
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() { break; }
    }

    let is_stream = request_line.contains("/stream");

    if !is_stream {
        // Serve HTML page
        let html = r#"<html>
<body style="margin:0;background:#000">
  <img id="stream" src="/stream" style="width:100%;height:100%;object-fit:contain">
  <script>
    const img = document.getElementById('stream');
    img.onerror = () => { setTimeout(() => { img.src = '/stream?' + Date.now(); }, 1000); };
  </script>
</body>
</html>"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(), html
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // MJPEG stream
    let header = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
    if stream.write_all(header.as_bytes()).is_err() { return; }

    let frame_interval = std::time::Duration::from_millis(33); // ~30 FPS delivery

    while !stop_flag.load(Ordering::SeqCst) {
        let frame = buffer.load();
        if frame.is_empty() {
            std::thread::sleep(frame_interval);
            continue;
        }

        let part = format!(
            "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
            frame.len()
        );

        if stream.write_all(part.as_bytes()).is_err() { break; }
        if stream.write_all(&frame).is_err() { break; }
        if stream.write_all(b"\r\n").is_err() { break; }
        if stream.flush().is_err() { break; }

        std::thread::sleep(frame_interval);
    }
}
```

**Part F — Helpers:**

```rust
fn find_available_port() -> Result<u16, String> {
    for port in 9876..=9886 {
        if std::net::TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No available port in range 9876-9886".to_string())
}

#[cfg(target_os = "windows")]
fn get_window_title(hwnd: i64) -> String {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;

    unsafe {
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(HWND(hwnd as *mut _), &mut buf);
        if len > 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            "Unknown".to_string()
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn get_window_title(_hwnd: i64) -> String {
    "Unknown".to_string()
}
```

- [ ] **Step 2: Register the module in `services/mod.rs`**

Add to `src-tauri/src/services/mod.rs`:

```rust
pub mod window_stream;
```

- [ ] **Step 3: Verify compilation**

Run: `cd "E:/Projects/Voice Mirror/src-tauri" && cargo check 2>&1 | tail -5`

Note: This will likely have compilation issues with the WGC APIs — the exact type signatures may need adjusting based on the `windows` crate version. The implementer should:
- Check `windows` crate docs for the exact method signatures
- Adjust casts and type annotations as needed
- The overall structure is correct, but specific API details may differ slightly

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/window_stream.rs src-tauri/src/services/mod.rs
git commit -m "feat(stream): add WindowStreamService with WGC capture and MJPEG server"
```

---

### Task 3: Tauri Commands

**Files:**
- Modify: `src-tauri/src/commands/screenshot.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add three stream commands to `screenshot.rs`**

At the end of `src-tauri/src/commands/screenshot.rs` (before any `#[cfg(test)]` block), add:

```rust
// ── Window streaming ──

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStreamParams {
    pub hwnd: i64,
    pub fps: Option<u32>,
}

#[tauri::command]
pub async fn start_window_stream(params: StartStreamParams) -> IpcResponse {
    let fps = params.fps.unwrap_or(30).clamp(1, 60);
    match crate::services::window_stream::start(params.hwnd, fps) {
        Ok(port) => IpcResponse::ok(serde_json::json!({
            "port": port,
            "url": format!("http://localhost:{}/", port),
        })),
        Err(e) => IpcResponse::err(e),
    }
}

#[tauri::command]
pub async fn stop_window_stream() -> IpcResponse {
    match crate::services::window_stream::stop() {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

#[tauri::command]
pub fn get_stream_status() -> IpcResponse {
    IpcResponse::ok(crate::services::window_stream::status())
}
```

- [ ] **Step 2: Register commands in `lib.rs`**

In the `generate_handler!` macro, find the screenshot commands section and add:

```rust
            screenshot_cmds::start_window_stream,
            screenshot_cmds::stop_window_stream,
            screenshot_cmds::get_stream_status,
```

Check how `screenshot_cmds` is aliased — look for existing `use commands::screenshot as screenshot_cmds;` or similar. If no alias exists, add one or use the full path.

- [ ] **Step 3: Verify compilation**

Run: `cd "E:/Projects/Voice Mirror/src-tauri" && cargo check 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/screenshot.rs src-tauri/src/lib.rs
git commit -m "feat(stream): add start/stop/status Tauri commands for window streaming"
```

---

### Task 4: Frontend — API Wrappers

**Files:**
- Modify: `src/lib/api.js`

- [ ] **Step 1: Add three API wrappers**

In `src/lib/api.js`, add after the screenshot-related functions:

```javascript
// ============ Window Streaming ============

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

- [ ] **Step 2: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js
git commit -m "feat(stream): add window stream API wrappers"
```

---

### Task 5: Frontend — Window Picker Modal

**Files:**
- Create: `src/components/chat/WindowPickerModal.svelte`

- [ ] **Step 1: Create the window picker modal**

Create `src/components/chat/WindowPickerModal.svelte`:

```svelte
<script>
  import { onMount } from 'svelte';
  import { listWindows, startWindowStream } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';

  let { onClose, onStreamStarted } = $props();

  let windows = $state([]);
  let loading = $state(true);
  let selectedHwnd = $state(null);
  let fps = $state(30);
  let starting = $state(false);
  let error = $state('');

  onMount(() => {
    lensStore.freeze();
    loadWindows();
    return () => lensStore.unfreeze();
  });

  async function loadWindows() {
    loading = true;
    try {
      const result = await listWindows();
      const data = unwrapResult(result);
      windows = data || [];
    } catch (err) {
      console.error('[window-picker] Failed to list windows:', err);
      windows = [];
    } finally {
      loading = false;
    }
  }

  async function handleStream() {
    if (!selectedHwnd) return;
    starting = true;
    error = '';
    try {
      const result = await startWindowStream(selectedHwnd, fps);
      const data = unwrapResult(result);
      if (data?.url) {
        // Copy URL to clipboard
        try { await navigator.clipboard.writeText(data.url); } catch {}
        onStreamStarted?.(data);
        onClose();
      } else if (result?.error) {
        error = result.error;
      }
    } catch (err) {
      error = String(err);
    } finally {
      starting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="picker-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Stream Window">
    <h3 class="modal-title">Stream Window</h3>

    <div class="fps-row">
      <label class="fps-label">FPS:</label>
      <select class="fps-select" bind:value={fps}>
        <option value={5}>5</option>
        <option value={15}>15</option>
        <option value={30}>30</option>
      </select>
    </div>

    {#if loading}
      <div class="picker-loading">Scanning windows...</div>
    {:else if windows.length === 0}
      <div class="picker-empty">No windows found.</div>
    {:else}
      <div class="window-list">
        {#each windows as win}
          <button
            class="window-item"
            class:selected={selectedHwnd === win.hwnd}
            onclick={() => { selectedHwnd = win.hwnd; }}
          >
            {#if win.thumbnail}
              <img class="window-thumb" src="data:image/png;base64,{win.thumbnail}" alt="" />
            {:else}
              <div class="window-thumb-placeholder"></div>
            {/if}
            <div class="window-info">
              <span class="window-title">{win.title}</span>
              <span class="window-meta">{win.processName} — {win.width}×{win.height}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    {#if error}
      <div class="picker-error">{error}</div>
    {/if}

    <div class="modal-actions">
      <button class="btn-cancel" onclick={onClose}>Cancel</button>
      <button class="btn-stream" onclick={handleStream} disabled={!selectedHwnd || starting}>
        {starting ? 'Starting...' : 'Stream'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .picker-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }

  .modal-title {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .fps-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .fps-label {
    font-size: 12px;
    color: var(--muted);
  }

  .fps-select {
    padding: 4px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .picker-loading, .picker-empty {
    font-size: 13px;
    color: var(--muted);
    padding: 20px 0;
    text-align: center;
  }

  .window-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 400px;
  }

  .window-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    background: var(--bg);
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-family);
    color: var(--text);
  }

  .window-item:hover { background: var(--bg-hover); }
  .window-item.selected { border-color: var(--accent); background: var(--card-highlight); }

  .window-thumb {
    width: 80px;
    height: 50px;
    object-fit: cover;
    border-radius: 4px;
    background: #000;
    flex-shrink: 0;
  }

  .window-thumb-placeholder {
    width: 80px;
    height: 50px;
    border-radius: 4px;
    background: var(--bg-hover);
    flex-shrink: 0;
  }

  .window-info {
    flex: 1;
    min-width: 0;
  }

  .window-title {
    display: block;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window-meta {
    display: block;
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
  }

  .picker-error {
    font-size: 12px;
    color: var(--danger, #ef4444);
    margin-top: 8px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .btn-cancel, .btn-stream {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-cancel:hover { background: var(--bg-hover); }

  .btn-stream {
    background: var(--accent);
    color: #fff;
  }

  .btn-stream:hover { filter: brightness(1.1); }
  .btn-stream:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

- [ ] **Step 2: Add `listWindows` export to api.js if not already present**

Check if `listWindows` is already exported from `api.js`. If not, add:

```javascript
export async function listWindows() {
  return invoke('list_windows');
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/WindowPickerModal.svelte src/lib/api.js
git commit -m "feat(stream): add WindowPickerModal with window selection and FPS config"
```

---

### Task 6: Frontend — Integrate into "+" Menu

**Files:**
- Modify: `src/components/chat/ChatInput.svelte`

- [ ] **Step 1: Add stream state and imports**

Read `ChatInput.svelte` first. In the `<script>` section, add imports:

```javascript
import { stopWindowStream, getStreamStatus } from '../../lib/api.js';
import { unwrapResult } from '../../lib/utils.js';
import WindowPickerModal from './WindowPickerModal.svelte';
```

Add state variables:

```javascript
let showWindowPicker = $state(false);
let isStreaming = $state(false);
let streamUrl = $state('');
```

Add a function to check stream status on mount and handle stream events:

```javascript
// Check if a stream is already running
$effect(() => {
  getStreamStatus().then(result => {
    const data = unwrapResult(result);
    if (data?.running) {
      isStreaming = true;
      streamUrl = `http://localhost:${data.port}/`;
    }
  }).catch(() => {});
});

function handleStreamStarted(data) {
  isStreaming = true;
  streamUrl = data.url;
  // Navigate browser panel to stream URL
  // This depends on how the lens/browser store navigates — check existing patterns
}

async function handleStopStream() {
  await stopWindowStream();
  isStreaming = false;
  streamUrl = '';
}
```

- [ ] **Step 2: Add menu items to the action menu**

In the action menu template (after the Screenshot button, before Save chat), add:

```svelte
          {#if isStreaming}
            <button class="action-menu-item" onclick={() => handleMenuAction(handleStopStream)} role="menuitem">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
              Stop Stream
            </button>
          {:else}
            <button class="action-menu-item" onclick={() => { closeMenu(); showWindowPicker = true; }} role="menuitem">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              Stream Window...
            </button>
          {/if}
```

- [ ] **Step 3: Add the modal render**

At the end of the component template (before `</div>` closing tag or after the main content), add:

```svelte
{#if showWindowPicker}
  <WindowPickerModal
    onClose={() => showWindowPicker = false}
    onStreamStarted={handleStreamStarted}
  />
{/if}
```

- [ ] **Step 4: Wire browser navigation**

The `handleStreamStarted` function needs to navigate the Browser panel to the stream URL. Check how the lens/browser store handles navigation — look for existing patterns like `lensStore.navigate(url)` or a Tauri event. Wire accordingly. This may require importing the lens store and calling a navigate method, or emitting a Tauri event.

- [ ] **Step 5: Verify frontend builds**

Run: `cd "E:/Projects/Voice Mirror" && npm run check 2>&1 | tail -3`

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ChatInput.svelte
git commit -m "feat(stream): integrate Stream Window into + menu with picker modal"
```

---

### Task 7: Integration Test — Manual Verification

**Files:** None (manual testing)

- [ ] **Step 1: Build and run the app**

Run: `npm run dev`

- [ ] **Step 2: Test stream start**

1. Open a target app (e.g., Notepad, a browser window, or a game)
2. Click "+" in the chat input
3. Verify "Stream Window..." appears in the menu
4. Click it → verify window picker modal shows with thumbnails
5. Select a window, choose FPS, click "Stream"
6. Verify Browser panel navigates to `http://localhost:9876/`
7. Verify the stream shows the captured window content

- [ ] **Step 3: Test Claude screenshot**

1. While streaming, ask Claude to take a screenshot of the browser
2. Verify Claude can see the streamed content
3. Change something in the target window
4. Ask Claude to screenshot again — verify it sees the update

- [ ] **Step 4: Test stop stream**

1. Click "+" in the chat input
2. Verify "Stop Stream" appears (replacing "Stream Window...")
3. Click "Stop Stream"
4. Verify toast appears and menu reverts to "Stream Window..."

- [ ] **Step 5: Test edge cases**

1. Close the target window while streaming → verify stream stops with toast
2. Start a stream, then start another → verify first stream stops
3. Try streaming when all ports are busy → verify error message

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix(stream): integration test fixes"
```
