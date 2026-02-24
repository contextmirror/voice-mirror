use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::IpcResponse;
use super::lens::LensState;
use tauri::{AppHandle, Manager};

// ── Data structures ─────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct WindowInfo {
    pub hwnd: i64,
    pub title: String,
    #[serde(rename = "processName")]
    pub process_name: String,
    pub width: i32,
    pub height: i32,
    pub thumbnail: String,
    pub icon: String,
}

/// Lightweight window info without thumbnails/icons (for MCP tool responses).
#[derive(Debug, Clone, serde::Serialize)]
pub struct WindowInfoLight {
    pub hwnd: i64,
    pub title: String,
    #[serde(rename = "processName")]
    pub process_name: String,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorInfo {
    pub index: u32,
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub x: i32,
    pub y: i32,
    pub primary: bool,
    pub thumbnail: String,
}

// ── Shared helpers (all platforms) ──────────────────────────────────────

/// Read a PNG file and return a `data:image/png;base64,...` URL.
fn read_as_data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let b64 = crate::voice::tts::crypto::base64_encode(&bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

/// Temporarily disable always-on-top, run an async closure, then re-enable.
async fn with_aot_disabled<F, Fut>(app: &AppHandle, f: F) -> IpcResponse
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = IpcResponse>,
{
    let was_on_top = if let Some(window) = app.get_webview_window("main") {
        let on_top = window.is_always_on_top().unwrap_or(false);
        if on_top {
            let _ = window.set_always_on_top(false);
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
        on_top
    } else {
        false
    };

    let result = f().await;

    if was_on_top {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_always_on_top(true);
        }
    }

    result
}

/// Clean up old screenshots, keeping only the most recent `keep_count`.
fn cleanup_old_screenshots(dir: &Path, keep_count: usize) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut files: Vec<(std::path::PathBuf, SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "png")
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let mtime = meta.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();

    files.sort_by(|a, b| b.1.cmp(&a.1));

    if files.len() > keep_count {
        for (path, _) in &files[keep_count..] {
            let _ = fs::remove_file(path);
        }
    }
}

// ── Windows native capture implementation ──────────────────────────────

#[cfg(target_os = "windows")]
mod win32 {
    use super::*;
    use base64::Engine as _;
    use image::codecs::png::PngEncoder;
    use image::{ImageEncoder, Rgba};
    use std::ffi::c_void;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::Xps::*;
    use windows::Win32::System::Threading::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    /// Convert BGRA pixel data to a PNG byte buffer.
    ///
    /// GDI bitmaps are bottom-up BGRA; we flip rows and swap B/R channels.
    pub fn bgra_to_png(data: &[u8], width: u32, height: u32) -> Vec<u8> {
        let stride = (width * 4) as usize;
        let mut rgba = vec![0u8; data.len()];
        for y in 0..height as usize {
            let src_row = (height as usize - 1 - y) * stride;
            let dst_row = y * stride;
            for x in 0..width as usize {
                let si = src_row + x * 4;
                let di = dst_row + x * 4;
                rgba[di] = data[si + 2];     // R <- B
                rgba[di + 1] = data[si + 1]; // G
                rgba[di + 2] = data[si];     // B <- R
                rgba[di + 3] = data[si + 3]; // A
            }
        }

        let img = image::ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba)
            .expect("ImageBuffer::from_raw failed");
        let mut buf = Vec::new();
        let encoder = PngEncoder::new(&mut buf);
        encoder
            .write_image(img.as_raw(), width, height, image::ExtendedColorType::Rgba8)
            .expect("PNG encode failed");
        buf
    }

    /// Resize a PNG image to fit within `max_width`, preserving aspect ratio.
    pub fn resize_thumbnail(png_bytes: &[u8], max_width: u32) -> Vec<u8> {
        let img = match image::load_from_memory(png_bytes) {
            Ok(i) => i,
            Err(_) => return png_bytes.to_vec(),
        };
        if img.width() <= max_width {
            return png_bytes.to_vec();
        }
        let ratio = max_width as f64 / img.width() as f64;
        let new_height = (img.height() as f64 * ratio) as u32;
        let resized =
            img.resize_exact(max_width, new_height, image::imageops::FilterType::Lanczos3);
        let mut buf = Vec::new();
        let encoder = PngEncoder::new(&mut buf);
        encoder
            .write_image(
                resized.as_bytes(),
                resized.width(),
                resized.height(),
                image::ExtendedColorType::Rgba8,
            )
            .expect("PNG encode failed");
        buf
    }

    /// Check if a bitmap's pixel data is effectively blank (near-black).
    pub fn is_blank_bitmap(data: &[u8], width: i32, height: i32) -> bool {
        if width < 10 || height < 10 {
            return false;
        }
        let stride = (width * 4) as usize;
        let sample_pixel = |x: i32, y: i32| -> u32 {
            let flipped_y = (height - 1 - y) as usize;
            let offset = flipped_y * stride + (x as usize) * 4;
            if offset + 2 < data.len() {
                data[offset] as u32 + data[offset + 1] as u32 + data[offset + 2] as u32
            } else {
                0
            }
        };
        let p1 = sample_pixel(width / 2, height / 2);
        let p2 = sample_pixel(width / 4, height / 4);
        let p3 = sample_pixel(width * 3 / 4, height * 3 / 4);
        p1 < 15 && p2 < 15 && p3 < 15
    }

    /// Capture a window's content as raw BGRA pixels using a multi-tier strategy.
    pub fn capture_window_bitmap(hwnd: HWND, width: i32, height: i32) -> Option<Vec<u8>> {
        if width <= 0 || height <= 0 {
            return None;
        }

        unsafe {
            let hdc_window = GetDC(Some(hwnd));
            if hdc_window.is_invalid() {
                return None;
            }

            let hdc_mem = CreateCompatibleDC(Some(hdc_window));
            if hdc_mem.is_invalid() {
                ReleaseDC(Some(hwnd), hdc_window);
                return None;
            }

            let hbmp = CreateCompatibleBitmap(hdc_window, width, height);
            if hbmp.is_invalid() {
                let _ = DeleteDC(hdc_mem);
                ReleaseDC(Some(hwnd), hdc_window);
                return None;
            }

            let old_bmp = SelectObject(hdc_mem, hbmp.into());

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD::default()],
            };

            let pixel_count = (width * height * 4) as usize;
            let mut pixels = vec![0u8; pixel_count];

            // Tier 1: PrintWindow with PW_RENDERFULLCONTENT (flag 2)
            let pw_result = PrintWindow(hwnd, hdc_mem, PRINT_WINDOW_FLAGS(2));
            let mut got_content = pw_result.as_bool();

            if got_content {
                GetDIBits(
                    hdc_mem,
                    hbmp,
                    0,
                    height as u32,
                    Some(pixels.as_mut_ptr() as *mut c_void),
                    &mut bmi,
                    DIB_RGB_COLORS,
                );
                if is_blank_bitmap(&pixels, width, height) {
                    got_content = false;
                }
            }

            // Tier 2: PrintWindow with standard flag (0)
            if !got_content {
                let pw_result2 = PrintWindow(hwnd, hdc_mem, PRINT_WINDOW_FLAGS(0));
                got_content = pw_result2.as_bool();

                if got_content {
                    GetDIBits(
                        hdc_mem,
                        hbmp,
                        0,
                        height as u32,
                        Some(pixels.as_mut_ptr() as *mut c_void),
                        &mut bmi,
                        DIB_RGB_COLORS,
                    );
                    if is_blank_bitmap(&pixels, width, height) {
                        got_content = false;
                    }
                }
            }

            // Tier 3: BitBlt from screen DC
            if !got_content {
                let mut rect = RECT::default();
                let _ = GetWindowRect(hwnd, &mut rect);
                let hdc_screen = GetDC(None);
                if !hdc_screen.is_invalid() {
                    let _ = BitBlt(
                        hdc_mem,
                        0,
                        0,
                        width,
                        height,
                        Some(hdc_screen),
                        rect.left,
                        rect.top,
                        SRCCOPY,
                    );
                    GetDIBits(
                        hdc_mem,
                        hbmp,
                        0,
                        height as u32,
                        Some(pixels.as_mut_ptr() as *mut c_void),
                        &mut bmi,
                        DIB_RGB_COLORS,
                    );
                    ReleaseDC(None, hdc_screen);
                }
            }

            SelectObject(hdc_mem, old_bmp);
            let _ = DeleteObject(hbmp.into());
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(Some(hwnd), hdc_window);

            Some(pixels)
        }
    }

    /// Capture a screen region as raw BGRA pixels.
    pub fn capture_screen_region(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
        if w <= 0 || h <= 0 {
            return None;
        }

        unsafe {
            let hdc_screen = GetDC(None);
            if hdc_screen.is_invalid() {
                return None;
            }

            let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
            if hdc_mem.is_invalid() {
                ReleaseDC(None, hdc_screen);
                return None;
            }

            let hbmp = CreateCompatibleBitmap(hdc_screen, w, h);
            if hbmp.is_invalid() {
                let _ = DeleteDC(hdc_mem);
                ReleaseDC(None, hdc_screen);
                return None;
            }

            let old_bmp = SelectObject(hdc_mem, hbmp.into());

            let _ = BitBlt(hdc_mem, 0, 0, w, h, Some(hdc_screen), x, y, SRCCOPY);

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD::default()],
            };

            let pixel_count = (w * h * 4) as usize;
            let mut pixels = vec![0u8; pixel_count];

            GetDIBits(
                hdc_mem,
                hbmp,
                0,
                h as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, old_bmp);
            let _ = DeleteObject(hbmp.into());
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);

            Some(pixels)
        }
    }

    /// Extract a process icon as a base64-encoded PNG string.
    ///
    /// Uses window class icon or WM_GETICON message to get the icon.
    pub fn extract_process_icon(hwnd: HWND) -> Option<String> {
        unsafe {
            let hicon = {
                // Try class icon first
                let h = GetClassLongPtrW(hwnd, GCLP_HICON);
                if h != 0 {
                    Some(HICON(h as *mut c_void))
                } else {
                    // Try WM_GETICON (ICON_BIG = 1)
                    let result =
                        SendMessageW(hwnd, WM_GETICON, Some(WPARAM(1)), Some(LPARAM(0)));
                    if result.0 != 0 {
                        Some(HICON(result.0 as *mut c_void))
                    } else {
                        // Try WM_GETICON (ICON_SMALL = 0)
                        let result =
                            SendMessageW(hwnd, WM_GETICON, Some(WPARAM(0)), Some(LPARAM(0)));
                        if result.0 != 0 {
                            Some(HICON(result.0 as *mut c_void))
                        } else {
                            // Try GCLP_HICONSM (small class icon)
                            let h = GetClassLongPtrW(hwnd, GCLP_HICONSM);
                            if h != 0 {
                                Some(HICON(h as *mut c_void))
                            } else {
                                None
                            }
                        }
                    }
                }
            };

            let hicon = hicon?;
            icon_to_base64_png(hicon)
        }
    }

    /// Convert an HICON to a base64-encoded PNG string.
    unsafe fn icon_to_base64_png(hicon: HICON) -> Option<String> {
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            return None;
        }

        let hbm_color = icon_info.hbmColor;
        if hbm_color.is_invalid() {
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask.into());
            }
            return None;
        }

        let mut bmp_struct = BITMAP::default();
        GetObjectW(
            hbm_color.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp_struct as *mut _ as *mut c_void),
        );

        let w = bmp_struct.bmWidth;
        let h = bmp_struct.bmHeight;
        if w <= 0 || h <= 0 {
            let _ = DeleteObject(hbm_color.into());
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask.into());
            }
            return None;
        }

        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        let old_bmp = SelectObject(hdc_mem, hbm_color.into());

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD::default()],
        };

        let pixel_count = (w * h * 4) as usize;
        let mut pixels = vec![0u8; pixel_count];

        GetDIBits(
            hdc_mem,
            hbm_color,
            0,
            h as u32,
            Some(pixels.as_mut_ptr() as *mut c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_bmp);
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);
        let _ = DeleteObject(hbm_color.into());
        if !icon_info.hbmMask.is_invalid() {
            let _ = DeleteObject(icon_info.hbmMask.into());
        }

        let png_bytes = bgra_to_png(&pixels, w as u32, h as u32);
        Some(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
    }

    /// Get the process name (exe filename without extension) for a PID.
    fn get_process_name(pid: u32) -> Option<String> {
        unsafe {
            let process =
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_FORMAT(0),
                windows_core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(process);

            if ok.is_err() || size == 0 {
                return None;
            }

            let full_path = String::from_utf16_lossy(&buf[..size as usize]);
            Path::new(&full_path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
        }
    }

    /// Enumerate all visible windows, excluding our own process and cloaked UWP windows.
    pub fn enumerate_windows(our_pid: u32) -> Vec<WindowInfo> {
        let mut results: Vec<WindowInfo> = Vec::new();

        struct EnumCtx {
            our_pid: u32,
            results: *mut Vec<WindowInfo>,
        }

        unsafe {
            let results_ptr = &mut results as *mut Vec<WindowInfo>;

            let mut ctx = EnumCtx {
                our_pid,
                results: results_ptr,
            };

            unsafe extern "system" fn enum_callback(
                hwnd: HWND,
                lparam: LPARAM,
            ) -> windows_core::BOOL {
                let ctx = &mut *(lparam.0 as *mut EnumCtx);

                if !IsWindowVisible(hwnd).as_bool() {
                    return windows_core::BOOL(1);
                }

                if IsIconic(hwnd).as_bool() {
                    return windows_core::BOOL(1);
                }

                let mut title_buf = [0u16; 256];
                let title_len = GetWindowTextW(hwnd, &mut title_buf);
                if title_len == 0 {
                    return windows_core::BOOL(1);
                }
                let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);
                if title.is_empty() || title == "Voice Mirror" {
                    return windows_core::BOOL(1);
                }

                let mut cloaked: i32 = 0;
                let _ = DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_CLOAKED,
                    &mut cloaked as *mut _ as *mut c_void,
                    std::mem::size_of::<i32>() as u32,
                );
                if cloaked != 0 {
                    return windows_core::BOOL(1);
                }

                let mut rect = RECT::default();
                let _ = GetWindowRect(hwnd, &mut rect);
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                if w < 100 || h < 50 {
                    return windows_core::BOOL(1);
                }

                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == ctx.our_pid {
                    return windows_core::BOOL(1);
                }

                let process_name = get_process_name(pid).unwrap_or_default();

                let thumbnail = match capture_window_bitmap(hwnd, w, h) {
                    Some(pixels) => {
                        let png = bgra_to_png(&pixels, w as u32, h as u32);
                        let resized = resize_thumbnail(&png, 300);
                        base64::engine::general_purpose::STANDARD.encode(&resized)
                    }
                    None => String::new(),
                };

                let icon = extract_process_icon(hwnd).unwrap_or_default();

                let results = &mut *ctx.results;
                results.push(WindowInfo {
                    hwnd: hwnd.0 as i64,
                    title,
                    process_name,
                    width: w,
                    height: h,
                    thumbnail,
                    icon,
                });

                windows_core::BOOL(1)
            }

            let _ = EnumWindows(
                Some(enum_callback),
                LPARAM(&mut ctx as *mut EnumCtx as isize),
            );
        }

        results
    }

    /// Enumerate visible windows returning only metadata (no thumbnails/icons).
    /// Much faster than `enumerate_windows` — skips all bitmap capture.
    pub fn enumerate_windows_metadata(our_pid: u32) -> Vec<WindowInfoLight> {
        let mut results: Vec<WindowInfoLight> = Vec::new();

        struct EnumCtx {
            our_pid: u32,
            results: *mut Vec<WindowInfoLight>,
        }

        unsafe {
            let results_ptr = &mut results as *mut Vec<WindowInfoLight>;

            let mut ctx = EnumCtx {
                our_pid,
                results: results_ptr,
            };

            unsafe extern "system" fn enum_callback(
                hwnd: HWND,
                lparam: LPARAM,
            ) -> windows_core::BOOL {
                let ctx = &mut *(lparam.0 as *mut EnumCtx);

                if !IsWindowVisible(hwnd).as_bool() {
                    return windows_core::BOOL(1);
                }

                if IsIconic(hwnd).as_bool() {
                    return windows_core::BOOL(1);
                }

                let mut title_buf = [0u16; 256];
                let title_len = GetWindowTextW(hwnd, &mut title_buf);
                if title_len == 0 {
                    return windows_core::BOOL(1);
                }
                let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);
                if title.is_empty() || title == "Voice Mirror" {
                    return windows_core::BOOL(1);
                }

                let mut cloaked: i32 = 0;
                let _ = DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_CLOAKED,
                    &mut cloaked as *mut _ as *mut c_void,
                    std::mem::size_of::<i32>() as u32,
                );
                if cloaked != 0 {
                    return windows_core::BOOL(1);
                }

                let mut rect = RECT::default();
                let _ = GetWindowRect(hwnd, &mut rect);
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                if w < 100 || h < 50 {
                    return windows_core::BOOL(1);
                }

                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == ctx.our_pid {
                    return windows_core::BOOL(1);
                }

                let process_name = get_process_name(pid).unwrap_or_default();

                let results = &mut *ctx.results;
                results.push(WindowInfoLight {
                    hwnd: hwnd.0 as i64,
                    title,
                    process_name,
                    width: w,
                    height: h,
                });

                windows_core::BOOL(1)
            }

            let _ = EnumWindows(
                Some(enum_callback),
                LPARAM(&mut ctx as *mut EnumCtx as isize),
            );
        }

        results
    }

    /// Enumerate all monitors.
    pub fn enumerate_monitors() -> Vec<MonitorInfo> {
        let mut results: Vec<MonitorInfo> = Vec::new();

        unsafe {
            let results_ptr = &mut results as *mut Vec<MonitorInfo>;

            unsafe extern "system" fn monitor_callback(
                hmonitor: HMONITOR,
                _hdc: HDC,
                _lprect: *mut RECT,
                lparam: LPARAM,
            ) -> windows_core::BOOL {
                let results = &mut *(lparam.0 as *mut Vec<MonitorInfo>);
                let index = results.len() as u32;

                let mut mi = MONITORINFOEXW::default();
                mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

                if !GetMonitorInfoW(
                    hmonitor,
                    &mut mi as *mut _ as *mut MONITORINFO,
                )
                .as_bool()
                {
                    return windows_core::BOOL(1);
                }

                let bounds = mi.monitorInfo.rcMonitor;
                let w = bounds.right - bounds.left;
                let h = bounds.bottom - bounds.top;

                let name = String::from_utf16_lossy(
                    &mi.szDevice[..mi
                        .szDevice
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(mi.szDevice.len())],
                );

                let primary = (mi.monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0;

                let thumbnail =
                    match capture_screen_region(bounds.left, bounds.top, w, h) {
                        Some(pixels) => {
                            let png = bgra_to_png(&pixels, w as u32, h as u32);
                            let resized = resize_thumbnail(&png, 300);
                            base64::engine::general_purpose::STANDARD.encode(&resized)
                        }
                        None => String::new(),
                    };

                results.push(MonitorInfo {
                    index,
                    name,
                    width: w,
                    height: h,
                    x: bounds.left,
                    y: bounds.top,
                    primary,
                    thumbnail,
                });

                windows_core::BOOL(1)
            }

            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(monitor_callback),
                LPARAM(results_ptr as isize),
            );
        }

        results
    }

    /// Capture the primary screen using native Win32 APIs.
    pub fn capture_primary_screen(output_path: &str) -> Result<(), String> {
        unsafe {
            let w = GetSystemMetrics(SM_CXSCREEN);
            let h = GetSystemMetrics(SM_CYSCREEN);

            if w <= 0 || h <= 0 {
                return Err(format!("Invalid screen dimensions: {}x{}", w, h));
            }

            match capture_screen_region(0, 0, w, h) {
                Some(pixels) => {
                    let png = bgra_to_png(&pixels, w as u32, h as u32);
                    fs::write(output_path, &png)
                        .map_err(|e| format!("Failed to write screenshot: {}", e))
                }
                None => Err("Failed to capture screen region".into()),
            }
        }
    }
}

// ── Public reusable functions (for MCP pipe handler) ───────────────────

/// Capture a window by HWND and return (base64_png, width, height).
#[cfg(target_os = "windows")]
pub fn capture_window_as_base64(hwnd: i64) -> Result<(String, i32, i32), String> {
    use base64::Engine as _;
    use windows::Win32::Foundation::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    unsafe {
        let hwnd_handle = HWND(hwnd as *mut std::ffi::c_void);
        let mut rect = RECT::default();
        GetWindowRect(hwnd_handle, &mut rect)
            .map_err(|e| format!("GetWindowRect failed: {}", e))?;
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;

        if w <= 0 || h <= 0 {
            return Err(format!("Invalid window dimensions: {}x{}", w, h));
        }

        let pixels = win32::capture_window_bitmap(hwnd_handle, w, h)
            .ok_or_else(|| "Failed to capture window bitmap".to_string())?;
        let png = win32::bgra_to_png(&pixels, w as u32, h as u32);
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
        Ok((b64, w, h))
    }
}

/// List visible windows (excluding our own).
#[cfg(target_os = "windows")]
pub fn list_visible_windows() -> Result<Vec<WindowInfo>, String> {
    let our_pid = std::process::id();
    Ok(win32::enumerate_windows(our_pid))
}

/// List visible windows metadata only (no thumbnails/icons). Used by MCP tools.
#[cfg(target_os = "windows")]
pub fn list_visible_windows_metadata() -> Result<Vec<WindowInfoLight>, String> {
    let our_pid = std::process::id();
    Ok(win32::enumerate_windows_metadata(our_pid))
}

// ── Platform-native screen capture (cross-platform) ────────────────────

fn capture_screen_native(output_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win32::capture_primary_screen(output_path)
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("screencapture")
            .args(["-x", output_path])
            .output()
            .map_err(|e| format!("Failed to run screencapture: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("screencapture failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("cosmic-screenshot")
            .args([
                "--interactive=false",
                "--modal=false",
                "--notify=false",
                &format!(
                    "--save-dir={}",
                    Path::new(output_path)
                        .parent()
                        .unwrap_or(Path::new("."))
                        .display()
                ),
            ])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        if let Ok(output) = std::process::Command::new("gnome-screenshot")
            .args(["-f", output_path])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        let output = std::process::Command::new("import")
            .args(["-window", "root", output_path])
            .output()
            .map_err(|e| format!("No screenshot tool available: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Screenshot failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Screenshot not supported on this platform".into())
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────

/// Take a screenshot of the primary display.
#[tauri::command]
pub async fn take_screenshot() -> IpcResponse {
    let screenshots_dir = crate::services::platform::get_data_dir().join("screenshots");
    if let Err(e) = fs::create_dir_all(&screenshots_dir) {
        return IpcResponse::err(format!("Failed to create screenshots dir: {}", e));
    }

    cleanup_old_screenshots(&screenshots_dir, 5);

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("screenshot-{}.png", now_ms);
    let filepath = screenshots_dir.join(&filename);
    let filepath_str = filepath.to_string_lossy().to_string();

    let result =
        tokio::task::spawn_blocking(move || capture_screen_native(&filepath_str)).await;

    match result {
        Ok(Ok(())) => {
            IpcResponse::ok(serde_json::json!({ "path": filepath.to_string_lossy() }))
        }
        Ok(Err(e)) => IpcResponse::err(e),
        Err(e) => IpcResponse::err(format!("Screenshot task panicked: {}", e)),
    }
}

/// List all monitors with thumbnail previews (base64 PNG).
///
/// Returns JSON array: `[{ index, name, width, height, x, y, primary, thumbnail }]`
#[tauri::command]
pub async fn list_monitors(app: AppHandle) -> IpcResponse {
    with_aot_disabled(&app, || async {
        let result = tokio::task::spawn_blocking(|| {
            #[cfg(target_os = "windows")]
            {
                let monitors = win32::enumerate_monitors();
                serde_json::to_value(&monitors)
                    .map_err(|e| format!("Failed to serialize monitors: {}", e))
            }

            #[cfg(not(target_os = "windows"))]
            {
                Ok::<serde_json::Value, String>(serde_json::json!([]))
            }
        })
        .await;

        match result {
            Ok(Ok(data)) => IpcResponse::ok(data),
            Ok(Err(e)) => IpcResponse::err(e),
            Err(e) => IpcResponse::err(format!("list_monitors task panicked: {}", e)),
        }
    })
    .await
}

/// List all visible windows with thumbnail previews and process icons.
///
/// Returns JSON array: `[{ hwnd, title, processName, width, height, thumbnail, icon }]`
#[tauri::command]
pub async fn list_windows(app: AppHandle) -> IpcResponse {
    let our_pid = std::process::id();

    with_aot_disabled(&app, move || async move {
        let result = tokio::task::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                let windows = win32::enumerate_windows(our_pid);
                serde_json::to_value(&windows)
                    .map_err(|e| format!("Failed to serialize windows: {}", e))
            }

            #[cfg(not(target_os = "windows"))]
            {
                let _ = our_pid;
                Ok::<serde_json::Value, String>(serde_json::json!([]))
            }
        })
        .await;

        match result {
            Ok(Ok(data)) => IpcResponse::ok(data),
            Ok(Err(e)) => IpcResponse::err(e),
            Err(e) => IpcResponse::err(format!("list_windows task panicked: {}", e)),
        }
    })
    .await
}

/// Capture a specific monitor at full resolution.
///
/// Saves to `{data_dir}/screenshots/screenshot-{timestamp}.png`.
/// Returns `{ path, dataUrl }`.
#[tauri::command]
pub async fn capture_monitor(app: AppHandle, index: u32) -> IpcResponse {
    with_aot_disabled(&app, move || async move {
        let screenshots_dir = crate::services::platform::get_data_dir().join("screenshots");
        if let Err(e) = fs::create_dir_all(&screenshots_dir) {
            return IpcResponse::err(format!("Failed to create screenshots dir: {}", e));
        }

        cleanup_old_screenshots(&screenshots_dir, 5);

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let filename = format!("screenshot-{}.png", now_ms);
        let filepath = screenshots_dir.join(&filename);
        let filepath_for_write = filepath.clone();

        let result = tokio::task::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                let monitors = win32::enumerate_monitors();
                let monitor = monitors.get(index as usize).ok_or_else(|| {
                    format!(
                        "Monitor index {} not found (have {})",
                        index,
                        monitors.len()
                    )
                })?;

                let pixels = win32::capture_screen_region(
                    monitor.x,
                    monitor.y,
                    monitor.width,
                    monitor.height,
                )
                .ok_or_else(|| "Failed to capture monitor region".to_string())?;
                let png =
                    win32::bgra_to_png(&pixels, monitor.width as u32, monitor.height as u32);
                fs::write(&filepath_for_write, &png)
                    .map_err(|e| format!("Failed to write screenshot: {}", e))?;
                Ok::<(), String>(())
            }

            #[cfg(not(target_os = "windows"))]
            {
                let _ = (index, filepath_for_write);
                Err::<(), String>("Monitor capture not supported on this platform".into())
            }
        })
        .await;

        match result {
            Ok(Ok(())) => {
                let data_url = read_as_data_url(&filepath).unwrap_or_default();
                IpcResponse::ok(serde_json::json!({
                    "path": filepath.to_string_lossy(),
                    "dataUrl": data_url
                }))
            }
            Ok(Err(e)) => IpcResponse::err(e),
            Err(e) => {
                IpcResponse::err(format!("capture_monitor task panicked: {}", e))
            }
        }
    })
    .await
}

/// Capture a specific window by HWND at full resolution.
///
/// Saves to `{data_dir}/screenshots/screenshot-{timestamp}.png`.
/// Returns `{ path, dataUrl }`.
#[tauri::command]
pub async fn capture_window(app: AppHandle, hwnd: i64) -> IpcResponse {
    with_aot_disabled(&app, move || async move {
        let screenshots_dir = crate::services::platform::get_data_dir().join("screenshots");
        if let Err(e) = fs::create_dir_all(&screenshots_dir) {
            return IpcResponse::err(format!("Failed to create screenshots dir: {}", e));
        }

        cleanup_old_screenshots(&screenshots_dir, 5);

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let filename = format!("screenshot-{}.png", now_ms);
        let filepath = screenshots_dir.join(&filename);
        let filepath_for_write = filepath.clone();

        let result = tokio::task::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                use windows::Win32::Foundation::*;
                use windows::Win32::UI::WindowsAndMessaging::*;

                unsafe {
                    let hwnd_handle = HWND(hwnd as *mut std::ffi::c_void);
                    let mut rect = RECT::default();
                    let _ = GetWindowRect(hwnd_handle, &mut rect);
                    let w = rect.right - rect.left;
                    let h = rect.bottom - rect.top;

                    if w <= 0 || h <= 0 {
                        return Err(format!("Invalid window dimensions: {}x{}", w, h));
                    }

                    let pixels = win32::capture_window_bitmap(hwnd_handle, w, h)
                        .ok_or_else(|| "Failed to capture window bitmap".to_string())?;
                    let png = win32::bgra_to_png(&pixels, w as u32, h as u32);
                    fs::write(&filepath_for_write, &png)
                        .map_err(|e| format!("Failed to write screenshot: {}", e))?;
                    Ok::<(), String>(())
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                let _ = (hwnd, filepath_for_write);
                Err::<(), String>("Window capture not supported on this platform".into())
            }
        })
        .await;

        match result {
            Ok(Ok(())) => {
                let data_url = read_as_data_url(&filepath).unwrap_or_default();
                IpcResponse::ok(serde_json::json!({
                    "path": filepath.to_string_lossy(),
                    "dataUrl": data_url
                }))
            }
            Ok(Err(e)) => IpcResponse::err(e),
            Err(e) => {
                IpcResponse::err(format!("capture_window task panicked: {}", e))
            }
        }
    })
    .await
}

/// Capture the Lens browser webview content.
///
/// Finds the WebView2 rendering surface (child window of the main window)
/// and uses PrintWindow to capture it. Returns `{ path, thumbnail, dataUrl }`.
///
/// Must be called while the webview is still visible (before hiding it).
#[tauri::command]
pub async fn lens_capture_browser(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    tracing::info!("[screenshot] lens_capture_browser called");

    // Read state synchronously before any .await
    let webview_bounds = {
        let active_id = state
            .active_tab_id
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if active_id.is_none() {
            tracing::warn!("[screenshot] No active browser tab");
            return Ok(IpcResponse::err("No active browser tab"));
        }
        let active_id_str = active_id.clone().unwrap();

        let tabs = state
            .tabs
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let tab = tabs.get(&active_id_str);
        if tab.is_none() {
            tracing::warn!("[screenshot] Active tab not found in tabs map");
            return Ok(IpcResponse::err("Active tab not found"));
        }
        tracing::info!(
            "[screenshot] Lens webview label: {}",
            tab.unwrap().webview_label
        );

        let bounds_guard = state
            .bounds
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *bounds_guard
    };

    // Capture the main window directly — PrintWindow with PW_RENDERFULLCONTENT
    // renders all child windows including WebView2 surfaces.
    let (capture_hwnd, scale_factor) = {
        let window = app
            .get_window("main")
            .ok_or_else(|| "Main window not found".to_string())?;
        let hwnd_val = window
            .hwnd()
            .map(|h| h.0 as i64)
            .map_err(|e| format!("Failed to get main HWND: {}", e))?;
        let scale = window.scale_factor().unwrap_or(1.0);
        tracing::info!(
            "[screenshot] Capture HWND: {}, scale: {}, bounds: {:?}",
            hwnd_val,
            scale,
            webview_bounds
        );
        (hwnd_val, scale)
    };

    let screenshots_dir = crate::services::platform::get_data_dir().join("screenshots");
    if let Err(e) = fs::create_dir_all(&screenshots_dir) {
        return Ok(IpcResponse::err(format!(
            "Failed to create screenshots dir: {}",
            e
        )));
    }

    cleanup_old_screenshots(&screenshots_dir, 5);

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("browser-{}.png", now_ms);
    let filepath = screenshots_dir.join(&filename);
    let filepath_str = filepath.to_string_lossy().to_string();

    // Compute crop bounds in physical pixels (for cropping webview area from window)
    let (crop_x, crop_y, crop_w, crop_h) = if let Some((bx, by, bw, bh)) = webview_bounds {
        (
            (bx * scale_factor) as i32,
            (by * scale_factor) as i32,
            (bw * scale_factor) as i32,
            (bh * scale_factor) as i32,
        )
    } else {
        (0, 0, 0, 0)
    };

    let result = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            // PowerShell script that:
            // 1. Captures the main window via PrintWindow (PW_RENDERFULLCONTENT)
            // 2. Crops to the lens webview bounds
            // 3. Creates a thumbnail (max 300px wide)
            // 4. Saves full capture + returns thumbnail as base64
            let ps_script = format!(
                r#"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BrowserCapture {{
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {{ public int Left, Top, Right, Bottom; }}
}}
"@
$targetHwnd = [IntPtr]{capture_hwnd}
$rect = New-Object BrowserCapture+RECT
[void][BrowserCapture]::GetWindowRect($targetHwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) {{ throw "Window has zero size ($w x $h)" }}
# Capture using PrintWindow PW_RENDERFULLCONTENT
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [BrowserCapture]::PrintWindow($targetHwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
if (-not $ok) {{
    # Fallback: CopyFromScreen
    $bmp.Dispose()
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g2 = [System.Drawing.Graphics]::FromImage($bmp)
    $g2.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $g2.Dispose()
}}
# Crop to webview bounds if specified
$cropX = {crop_x}
$cropY = {crop_y}
$cropW = {crop_w}
$cropH = {crop_h}
if ($cropW -gt 0 -and $cropH -gt 0) {{
    # Clamp crop to actual bitmap size
    if ($cropX + $cropW -gt $w) {{ $cropW = $w - $cropX }}
    if ($cropY + $cropH -gt $h) {{ $cropH = $h - $cropY }}
    if ($cropW -gt 0 -and $cropH -gt 0) {{
        $srcRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropW, $cropH)
        $cropped = $bmp.Clone($srcRect, $bmp.PixelFormat)
        $bmp.Dispose()
        $bmp = $cropped
        $w = $cropW
        $h = $cropH
    }}
}}
# Save capture
$bmp.Save('{filepath}')
# Create thumbnail (max 300px wide)
$maxW = 300
$thumbB64 = ""
if ($w -gt $maxW) {{
    $ratio = $maxW / $w
    $newH = [int]($h * $ratio)
    $thumb = New-Object System.Drawing.Bitmap($maxW, $newH)
    $tg = [System.Drawing.Graphics]::FromImage($thumb)
    $tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $tg.DrawImage($bmp, 0, 0, $maxW, $newH)
    $tg.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $thumb.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $thumbB64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    $thumb.Dispose()
}} else {{
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $thumbB64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
}}
$bmp.Dispose()
Write-Output $thumbB64
"#,
                capture_hwnd = capture_hwnd,
                crop_x = crop_x,
                crop_y = crop_y,
                crop_w = crop_w,
                crop_h = crop_h,
                filepath = filepath_str.replace('\'', "''"),
            );

            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .output()
                .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Browser capture failed: {}", stderr.trim()));
            }

            let thumbnail = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(thumbnail)
        }

        #[cfg(not(target_os = "windows"))]
        {
            Err("Browser capture not yet supported on this platform".into())
        }
    })
    .await;

    match result {
        Ok(Ok(thumbnail)) => {
            tracing::info!(
                "[screenshot] Browser capture succeeded, thumbnail len: {}",
                thumbnail.len()
            );
            let data_url = read_as_data_url(&filepath).unwrap_or_default();
            Ok(IpcResponse::ok(serde_json::json!({
                "path": filepath.to_string_lossy(),
                "thumbnail": thumbnail,
                "dataUrl": data_url
            })))
        }
        Ok(Err(e)) => {
            tracing::error!("[screenshot] Browser capture error: {}", e);
            Ok(IpcResponse::err(e))
        }
        Err(e) => {
            tracing::error!("[screenshot] Browser capture task panicked: {}", e);
            Ok(IpcResponse::err(format!(
                "Browser capture task panicked: {}",
                e
            )))
        }
    }
}
