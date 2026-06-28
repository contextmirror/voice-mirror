//! Window Stream Service: captures any window via Windows.Graphics.Capture
//! and streams MJPEG to localhost for Claude to screenshot on demand.

use arc_swap::ArcSwap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{error, info, warn};

/// Global stream state — only one stream at a time.
static STREAM_STATE: std::sync::OnceLock<std::sync::Mutex<StreamState>> = std::sync::OnceLock::new();

fn state() -> &'static std::sync::Mutex<StreamState> {
    STREAM_STATE.get_or_init(|| std::sync::Mutex::new(StreamState::default()))
}

/// Monotonic stream generation. Each `start()` bumps it and stamps the new
/// stream + its capture thread. A previous stream's thread (still winding down
/// after a re-target) must NOT clobber the current stream's `running` flag or
/// its frame buffer — it checks this generation and bails if it's stale. This is
/// what makes a close→re-target (e.g. Settings closed, snap back to main) recover
/// reliably instead of the old thread's late teardown leaving running=false / an
/// empty buffer permanently.
static STREAM_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct StreamState {
    /// A capture thread is running (some window is being mirrored).
    running: bool,
    /// Generation of the stream currently owning the global state + buffer.
    generation: u64,
    /// The STABLE MJPEG port. The server (and this port) live ACROSS re-targets —
    /// only the capture thread's target HWND is swapped — so the live preview
    /// `<img>` keeps the same `/stream` URL and shows the new window seamlessly.
    port: u16,
    hwnd: i64,
    title: String,
    fps: u32,
    /// True once the MJPEG server thread is up and its port is bound.
    server_running: bool,
    /// Stops ONLY the capture thread (swapped on every re-target).
    capture_stop: Option<Arc<AtomicBool>>,
    /// Stops the MJPEG server (only on a full `stop()`), keeping the port stable
    /// while we re-point the captured window.
    server_stop: Option<Arc<AtomicBool>>,
    /// True when the frame source is an EXTERNAL CDP screencast task
    /// (`start_external`) rather than the WGC capture thread. Used so the screenshot
    /// path doesn't try to re-point a (non-existent) WGC window, and so `current_hwnd`
    /// reports "no real OS window" for a CDP-backed preview.
    external: bool,
}

/// Shared frame buffer — latest JPEG bytes, lock-free.
static FRAME_BUFFER: std::sync::OnceLock<Arc<ArcSwap<Vec<u8>>>> = std::sync::OnceLock::new();

fn frame_buffer() -> &'static Arc<ArcSwap<Vec<u8>>> {
    FRAME_BUFFER.get_or_init(|| Arc::new(ArcSwap::from_pointee(Vec::new())))
}

/// The HWND the live stream is currently capturing, if one is running. Lets the
/// sandbox screenshot verify it is mirroring the SAME window snapshot/click is
/// driving (the unified active-window model) and re-target it when it isn't.
pub(crate) fn current_hwnd() -> Option<i64> {
    state()
        .lock()
        .ok()
        // A CDP-backed (external) stream has no single WGC OS window — report None
        // so the screenshot/snapshot "mirror the preview window" logic stays dormant.
        .filter(|s| s.running && !s.external)
        .map(|s| s.hwnd)
}

/// True when the live stream is currently fed by an EXTERNAL CDP screencast task
/// (an opaque window WGC couldn't capture) rather than the WGC capture thread.
pub(crate) fn is_external() -> bool {
    state().lock().map(|s| s.running && s.external).unwrap_or(false)
}

/// True if `generation` is the stream's CURRENT (live) generation. Lets an
/// external CDP screencast task verify it still owns the stream before tearing it
/// down on socket close, so it never kills a newer source that superseded it.
pub(crate) fn is_current_generation(generation: u64) -> bool {
    state()
        .lock()
        .map(|s| s.running && s.generation == generation)
        .unwrap_or(false)
}

/// The most recent captured JPEG frame, if a stream is running and has produced
/// at least one frame. Lets the sandbox screenshot reuse exactly what the live
/// preview shows (reliable for transparent windows that CDP can't capture).
pub(crate) fn latest_frame() -> Option<Vec<u8>> {
    if !state().lock().map(|s| s.running).unwrap_or(false) {
        return None;
    }
    let buf = frame_buffer().load();
    if buf.is_empty() {
        None
    } else {
        Some(buf.as_ref().clone())
    }
}

/// Start (or RE-TARGET) the window mirror. Returns the (stable) MJPEG port.
///
/// PORT-PRESERVING retarget: if the MJPEG server is already running we REUSE its
/// port + server thread and only swap the capture thread's target HWND. The live
/// preview `<img>` is pinned to `/stream` on that port, so re-pointing the
/// captured window (from `capture_app_window` OR the frontend switcher) shows the
/// new window with no flicker and no port churn. Only `stop()` tears the server
/// down. The capture thread and server now have SEPARATE stop flags.
pub fn start(hwnd: i64, fps: u32) -> Result<u16, String> {
    let buffer = frame_buffer().clone();

    // Claim a fresh generation for THIS capture thread. Any older capture thread
    // still tearing down will see a newer generation and refuse to touch the
    // shared state/buffer, so it can't wedge us at running=false / empty.
    let generation = STREAM_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Get window title for display
    let title = get_window_title(hwnd);

    // Stop flag for THIS capture thread only (the server's is independent).
    let capture_stop = Arc::new(AtomicBool::new(false));

    // Decide: reuse the existing server (port-preserving retarget) or start one.
    let (port, start_server, server_stop) = {
        let mut st = state().lock().unwrap();

        // Stop ONLY the previous capture thread; leave the MJPEG server running.
        if let Some(flag) = st.capture_stop.take() {
            flag.store(true, Ordering::SeqCst);
        }

        // Drop the previous window's last frame so a re-target never momentarily
        // shows the OLD window's stale picture before the new window's first frame.
        buffer.store(Arc::new(Vec::new()));

        let (port, start_server, server_stop) =
            if st.server_running && st.port != 0 && st.server_stop.is_some() {
                // Reuse the live server + its port. No find_available_port, no
                // server restart — the /stream URL stays identical.
                (st.port, false, st.server_stop.clone().unwrap())
            } else {
                let p = find_available_port()?;
                (p, true, Arc::new(AtomicBool::new(false)))
            };

        st.running = true;
        st.generation = generation;
        st.port = port;
        st.hwnd = hwnd;
        st.title = title.clone();
        st.fps = fps;
        st.external = false;
        st.capture_stop = Some(capture_stop.clone());
        if start_server {
            st.server_running = true;
            st.server_stop = Some(server_stop.clone());
        }
        (port, start_server, server_stop)
    };

    // Start capture thread (WGC + JPEG encoding) on the (new) target window.
    let capture_buffer = buffer.clone();
    std::thread::Builder::new()
        .name("wgc-capture".into())
        .spawn(move || {
            if let Err(e) = run_capture(hwnd, fps, capture_stop, capture_buffer, generation) {
                error!("WGC capture failed: {}", e);
                // Only fail the stream if we're still the current generation —
                // a superseded thread must not clear a newer stream's running flag.
                let mut st = state().lock().unwrap();
                if st.generation == generation {
                    st.running = false;
                }
            }
        })
        .map_err(|e| format!("Failed to spawn capture thread: {}", e))?;

    // Start the MJPEG server ONLY if one isn't already serving this port. On a
    // retarget the existing server keeps streaming from the same FRAME_BUFFER.
    if start_server {
        let server_buffer = buffer;
        std::thread::Builder::new()
            .name("mjpeg-server".into())
            .spawn(move || {
                run_mjpeg_server(port, server_stop, server_buffer);
            })
            .map_err(|e| format!("Failed to spawn MJPEG server: {}", e))?;
    }

    info!(
        "{} window stream: '{}' (hwnd={}) on port {}",
        if start_server { "Started" } else { "Re-targeted" },
        title,
        hwnd,
        port
    );
    Ok(port)
}

/// Set up the stream to be fed by an EXTERNAL frame source (a CDP screencast
/// task) instead of the WGC capture thread — for an OPAQUE window WGC can't
/// capture (hidden/occluded/not-presenting). Like [`start`], this is a
/// PORT-PRESERVING retarget: it stops any running WGC capture thread, REUSES the
/// MJPEG server + port if one is up, and bumps the stream generation. The caller
/// owns a task that publishes frames via [`publish_external_frame`] until either
/// `stop_flag` is set (a later `start`/`start_external`/`stop` supersedes it) or
/// `publish_external_frame` returns `false` (its generation was superseded).
///
/// Returns `(port, generation, stop_flag)`.
pub(crate) fn start_external(
    title: String,
    fps: u32,
) -> Result<(u16, u64, Arc<AtomicBool>), String> {
    let buffer = frame_buffer().clone();

    // Same generation discipline as the WGC path: claim a fresh generation so an
    // older capture thread / CDP task can't clobber this source's frames.
    let generation = STREAM_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Stop flag for THIS external source (stored as the capture_stop, so a later
    // WGC start()/another start_external()/stop() flips it true to retire us).
    let capture_stop = Arc::new(AtomicBool::new(false));

    let (port, start_server, server_stop) = {
        let mut st = state().lock().unwrap();

        // Stop ONLY the previous capture source (WGC thread or prior CDP task);
        // leave the MJPEG server running for a seamless port-preserving retarget.
        if let Some(flag) = st.capture_stop.take() {
            flag.store(true, Ordering::SeqCst);
        }

        // Drop the previous source's last frame so we never momentarily show its
        // stale picture before the new source's first frame.
        buffer.store(Arc::new(Vec::new()));

        let (port, start_server, server_stop) =
            if st.server_running && st.port != 0 && st.server_stop.is_some() {
                (st.port, false, st.server_stop.clone().unwrap())
            } else {
                let p = find_available_port()?;
                (p, true, Arc::new(AtomicBool::new(false)))
            };

        st.running = true;
        st.generation = generation;
        st.port = port;
        // No single WGC OS window for a CDP-backed source.
        st.hwnd = 0;
        st.title = title;
        st.fps = fps;
        st.external = true;
        st.capture_stop = Some(capture_stop.clone());
        if start_server {
            st.server_running = true;
            st.server_stop = Some(server_stop.clone());
        }
        (port, start_server, server_stop)
    };

    if start_server {
        let server_buffer = buffer;
        std::thread::Builder::new()
            .name("mjpeg-server".into())
            .spawn(move || {
                run_mjpeg_server(port, server_stop, server_buffer);
            })
            .map_err(|e| format!("Failed to spawn MJPEG server: {}", e))?;
    }

    info!(
        "{} CDP screencast source on port {} (gen {})",
        if start_server { "Started" } else { "Re-targeted to" },
        port,
        generation
    );
    Ok((port, generation, capture_stop))
}

/// Publish one JPEG frame from an EXTERNAL source (CDP screencast) into the shared
/// buffer the MJPEG server reads. Returns `false` if a newer stream generation has
/// superseded `generation` — the caller's task must then stop. Mirrors the
/// generation guard the WGC capture thread uses, so a superseded CDP task can't
/// overwrite a newer source's frames.
pub(crate) fn publish_external_frame(generation: u64, jpeg: Vec<u8>) -> bool {
    match state().lock() {
        Ok(s) if s.generation == generation => {
            frame_buffer().store(Arc::new(jpeg));
            true
        }
        _ => false,
    }
}

/// Stop the current stream — tears down BOTH the capture thread and the MJPEG
/// server (releasing the port), and clears the buffer. A subsequent `start()`
/// allocates a fresh port.
pub fn stop() -> Result<(), String> {
    let mut st = state().lock().unwrap();
    if let Some(flag) = st.capture_stop.take() {
        flag.store(true, Ordering::SeqCst);
    }
    if let Some(flag) = st.server_stop.take() {
        flag.store(true, Ordering::SeqCst);
    }
    st.running = false;
    st.server_running = false;
    st.external = false;
    st.port = 0;
    // Drop the last frame so a stopped stream can't serve a stale picture.
    frame_buffer().store(Arc::new(Vec::new()));
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

// ── WGC capture loop ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn run_capture(
    hwnd: i64,
    fps: u32,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<ArcSwap<Vec<u8>>>,
    generation: u64,
) -> Result<(), String> {
    use windows::core::*;
    use windows::Graphics::Capture::*;
    use windows::Graphics::DirectX::Direct3D11::*;
    use windows::Graphics::DirectX::*;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::*;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::System::WinRT::Direct3D11::*;
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

    // Initialize COM on this thread (STA for WGC compatibility)
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_APARTMENTTHREADED,
        )
        .ok();
    }

    // 1. Create D3D11 device
    let mut d3d_device: Option<ID3D11Device> = None;
    let mut d3d_context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut d3d_device),
            None,
            Some(&mut d3d_context),
        )
        .map_err(|e| format!("D3D11CreateDevice failed: {}", e))?;
    }
    let d3d_device = d3d_device.ok_or("D3D11 device is None")?;
    let d3d_context = d3d_context.ok_or("D3D11 context is None")?;

    // 2. Get DXGI device → WinRT IDirect3DDevice
    let dxgi_device: IDXGIDevice =
        d3d_device
            .cast()
            .map_err(|e| format!("Cast to IDXGIDevice failed: {}", e))?;
    let winrt_device = unsafe {
        CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)
            .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice failed: {}", e))?
    };
    let direct3d_device: IDirect3DDevice = winrt_device
        .cast()
        .map_err(|e| format!("Cast to IDirect3DDevice failed: {}", e))?;

    // 3. Create capture item via IGraphicsCaptureItemInterop (NOT CreateForWindow)
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("Failed to get IGraphicsCaptureItemInterop: {}", e))?;
    let item: GraphicsCaptureItem = unsafe {
        interop
            .CreateForWindow(HWND(hwnd as *mut _))
            .map_err(|e| format!("CreateForWindow failed: {}", e))?
    };
    let size = item
        .Size()
        .map_err(|e| format!("GetSize failed: {}", e))?;

    // 4. Register Closed handler to detect window closure
    let closed_flag = stop_flag.clone();
    let closed_buffer = buffer.clone();
    item.Closed(
        &windows::Foundation::TypedEventHandler::new(move |_, _| {
            warn!("WGC: target window closed");
            closed_flag.store(true, Ordering::SeqCst);
            // Drop the last frame so the preview doesn't keep serving the closed
            // window's stale picture while the frontend re-targets a live window —
            // but ONLY if we're still the current stream. If a newer stream has
            // already taken over (the re-target raced ahead of this Closed event),
            // clearing the shared buffer would wipe the new window's frames and
            // wedge the preview at empty. The generation check prevents that.
            if state()
                .lock()
                .map(|s| s.generation == generation)
                .unwrap_or(false)
            {
                closed_buffer.store(Arc::new(Vec::new()));
            }
            Ok(())
        }),
    )
    .map_err(|e| format!("Failed to register Closed handler: {}", e))?;

    // 5. Create frame pool (pool size 2 = double buffer, dropped frames are intentional)
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &direct3d_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )
    .map_err(|e| format!("CreateFreeThreaded failed: {}", e))?;

    // 6. Create session and start
    let session = pool
        .CreateCaptureSession(&item)
        .map_err(|e| format!("CreateCaptureSession failed: {}", e))?;

    // Disable the yellow capture border (privacy indicator)
    // Available on Windows 11 and newer Windows 10 builds
    if let Err(e) = session.SetIsBorderRequired(false) {
        warn!("Could not disable capture border (older Windows?): {}", e);
    }

    // Force a MINIMUM frame cadence. WGC only delivers a frame when the source
    // CHANGES, so a STATIC, transparent window (a pill/overlay that never repaints)
    // produces ZERO frames after the initial one — leaving the buffer empty and the
    // sandbox screenshot stuck at "No live app frame yet". MinUpdateInterval makes
    // WGC re-deliver the current surface on a timer even when nothing changed.
    // It only exists on newer Windows 11 builds, so FEATURE-DETECT: try-set and
    // ignore failure (older builds simply keep the change-driven cadence).
    {
        // TimeSpan is in 100ns ticks; 100ms = 1_000_000 ticks → ~10 fps floor.
        let interval = windows::Foundation::TimeSpan { Duration: 1_000_000 };
        match session.SetMinUpdateInterval(interval) {
            Ok(()) => info!("WGC: MinUpdateInterval set to 100ms (static-window cadence)"),
            Err(e) => warn!("WGC: MinUpdateInterval unsupported (older Windows?): {}", e),
        }
    }

    session
        .StartCapture()
        .map_err(|e| format!("StartCapture failed: {}", e))?;

    info!(
        "WGC capture started: {}x{} @ {} FPS",
        size.Width, size.Height, fps
    );

    // 7. Create staging texture for CPU readback
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: size.Width as u32,
        Height: size.Height as u32,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0u32,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0u32,
    };
    let staging_tex = unsafe {
        let mut tex: Option<ID3D11Texture2D> = None;
        d3d_device
            .CreateTexture2D(&staging_desc, None, Some(&mut tex))
            .map_err(|e| format!("CreateTexture2D staging failed: {}", e))?;
        tex.ok_or("CreateTexture2D returned None")?
    };

    // 8. Frame processing loop
    let frame_interval = std::time::Duration::from_millis(1000 / fps as u64);
    let mut last_frame_time = std::time::Instant::now();
    // Present-nudge bookkeeping: WGC only delivers a frame when the source
    // presents. A visible-but-not-presenting window (transparent pill, or an
    // occluded opaque window) can sit at ZERO frames until the user interacts. If
    // no frame has arrived shortly after StartCapture, kick it ONCE with a Win32
    // present-nudge (no focus steal, never force-shows a hidden window).
    let loop_start = std::time::Instant::now();
    let mut got_frame = false;
    let mut nudged = false;

    while !stop_flag.load(Ordering::SeqCst) {
        // Rate limiting
        let elapsed = last_frame_time.elapsed();
        if elapsed < frame_interval {
            std::thread::sleep(frame_interval - elapsed);
        }
        last_frame_time = std::time::Instant::now();

        // Best-effort present-nudge if nothing has presented within ~400ms.
        if !got_frame && !nudged && loop_start.elapsed() >= std::time::Duration::from_millis(400) {
            present_nudge(hwnd);
            nudged = true;
        }

        // Try to get a frame
        let frame = match pool.TryGetNextFrame() {
            Ok(f) => f,
            Err(_) => continue,
        };
        // A frame arrived → the window is presenting; no nudge needed.
        got_frame = true;

        let surface = match frame.Surface() {
            Ok(s) => s,
            Err(_) => continue,
        };

        // Get the D3D11 texture from the surface
        let access: IDirect3DDxgiInterfaceAccess = surface.cast().unwrap();
        let texture: ID3D11Texture2D = unsafe { access.GetInterface().unwrap() };

        // Copy to staging texture (cast to ID3D11Resource for the API)
        let staging_res: ID3D11Resource = staging_tex.cast().unwrap();
        let texture_res: ID3D11Resource = texture.cast().unwrap();
        unsafe {
            d3d_context.CopyResource(&staging_res, &texture_res);
        }

        // Map staging texture to CPU memory (correct windows 0.61 signature)
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        let map_result = unsafe {
            d3d_context.Map(&staging_res, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
        };
        if map_result.is_err() {
            continue;
        }

        // Encode to JPEG
        let width = size.Width as u32;
        let height = size.Height as u32;
        let row_pitch = mapped.RowPitch as usize;
        let data = unsafe {
            std::slice::from_raw_parts(mapped.pData as *const u8, row_pitch * height as usize)
        };

        // BGRA → RGB for JPEG encoding
        // DXGI_FORMAT_B8G8R8A8_UNORM memory layout: [B, G, R, A] per pixel
        let mut rgb = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height as usize {
            for x in 0..width as usize {
                let offset = y * row_pitch + x * 4;
                rgb.push(data[offset + 2]); // R (byte 2 in BGRA)
                rgb.push(data[offset + 1]); // G (byte 1 in BGRA)
                rgb.push(data[offset]);     // B (byte 0 in BGRA)
            }
        }

        unsafe {
            d3d_context.Unmap(&staging_res, 0);
        }

        // Encode JPEG
        if let Some(img) = image::RgbImage::from_raw(width, height, rgb) {
            let mut jpeg_buf = std::io::Cursor::new(Vec::new());
            match image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, 80).encode(
                &img,
                width,
                height,
                image::ExtendedColorType::Rgb8,
            ) {
                Ok(()) => {
                    // Only the CURRENT generation may publish frames. A superseded
                    // capture thread (the old window, winding down after a
                    // port-preserving retarget) must not overwrite the new window's
                    // frames in the shared buffer the live server reads.
                    if state()
                        .lock()
                        .map(|s| s.generation == generation)
                        .unwrap_or(false)
                    {
                        buffer.store(Arc::new(jpeg_buf.into_inner()));
                    }
                }
                Err(e) => {
                    warn!("JPEG encode failed: {}", e);
                }
            }
        }
    }

    // Cleanup
    session.Close().ok();
    pool.Close().ok();
    // Update state to reflect stream ended — but only if WE are still the current
    // stream. A superseded thread (the previous window, winding down after a
    // re-target) must not flip the new stream's running flag to false, which would
    // make latest_frame() return None forever even though frames are flowing.
    if let Ok(mut st) = state().lock() {
        if st.generation == generation {
            st.running = false;
        }
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
    _generation: u64,
) -> Result<(), String> {
    Err("Window streaming is only supported on Windows".to_string())
}

// ── MJPEG server ────────────────────────────────────────────────────────

pub(crate) fn run_mjpeg_server(port: u16, stop_flag: Arc<AtomicBool>, buffer: Arc<ArcSwap<Vec<u8>>>) {
    use std::net::TcpListener;

    let addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind MJPEG server on {}: {}", addr, e);
            // Mark the server as down so a later start() re-allocates a port + server
            // instead of reusing this dead one in a port-preserving retarget.
            if let Ok(mut st) = state().lock() {
                if st.port == port {
                    st.server_running = false;
                    st.port = 0;
                    st.server_stop = None;
                }
            }
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
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(5)))
        .ok();

    // Read the HTTP request line to determine path
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    // Drain remaining headers
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
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
            html.len(),
            html
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // MJPEG stream
    let header = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
    if stream.write_all(header.as_bytes()).is_err() {
        return;
    }

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

        if stream.write_all(part.as_bytes()).is_err() {
            break;
        }
        if stream.write_all(&frame).is_err() {
            break;
        }
        if stream.write_all(b"\r\n").is_err() {
            break;
        }
        if stream.flush().is_err() {
            break;
        }

        std::thread::sleep(frame_interval);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

pub(crate) fn find_available_port() -> Result<u16, String> {
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

/// Best-effort "present nudge": kick a window into repainting/presenting WITHOUT
/// stealing focus or changing its visibility, so WGC delivers a frame for a window
/// that is visible-but-not-presenting (a transparent pill that never repaints, or
/// an occluded-but-visible opaque window). Never force-shows a window the app
/// intentionally hid — it returns immediately unless `IsWindowVisible` is already
/// true, and uses `SWP_NOACTIVATE | SWP_NOZORDER` (NOT `SWP_SHOWWINDOW`). All
/// failures are ignored.
#[cfg(target_os = "windows")]
fn present_nudge(hwnd: i64) {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, IsWindowVisible, SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER,
    };

    unsafe {
        let h = HWND(hwnd as *mut std::ffi::c_void);
        // Only nudge a window that is ALREADY visible — never reveal a hidden one.
        if !IsWindowVisible(h).as_bool() {
            return;
        }
        // 1. Force an immediate repaint of the window and its children.
        let _ = RedrawWindow(
            Some(h),
            None,
            None,
            RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN,
        );
        // 2. 1px resize-then-restore to force a present, without moving, activating
        //    or restacking the window.
        let mut rect = RECT::default();
        if GetWindowRect(h, &mut rect).is_ok() {
            let w = rect.right - rect.left;
            let ht = rect.bottom - rect.top;
            let _ = SetWindowPos(
                h,
                None,
                0,
                0,
                w + 1,
                ht + 1,
                SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
            );
            let _ = SetWindowPos(
                h,
                None,
                0,
                0,
                w,
                ht,
                SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn present_nudge(_hwnd: i64) {}
