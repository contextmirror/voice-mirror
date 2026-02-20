use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::IpcResponse;
use tauri::{AppHandle, Manager};

/// Read a PNG file and return a `data:image/png;base64,...` URL.
fn read_as_data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let b64 = crate::voice::tts::crypto::base64_encode(&bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

/// Temporarily disable always-on-top, run an async closure, then re-enable.
///
/// In dashboard mode AOT is already off, so this is a no-op. In orb mode
/// (if a capture is triggered via hotkey etc.), this ensures our window
/// drops below other windows so it doesn't appear in screenshots.
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

/// Platform-native screen capture.
fn capture_screen_native(output_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // PowerShell one-liner: capture primary screen via .NET System.Drawing
        let ps_script = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Drawing.Rectangle]::FromLTRB(0,0,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $bmp = New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('{}'); $g.Dispose(); $bmp.Dispose()"#,
            output_path.replace('\'', "''")
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PowerShell screenshot failed: {}", stderr.trim()));
        }
        Ok(())
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
        // Try cosmic-screenshot first
        if let Ok(output) = std::process::Command::new("cosmic-screenshot")
            .args(["--interactive=false", "--modal=false", "--notify=false",
                   &format!("--save-dir={}", Path::new(output_path).parent().unwrap_or(Path::new(".")).display())])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        // Try gnome-screenshot
        if let Ok(output) = std::process::Command::new("gnome-screenshot")
            .args(["-f", output_path])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        // Try import (ImageMagick)
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

/// Take a screenshot of the primary display.
///
/// Uses platform-native tools:
/// - Windows: PowerShell with .NET System.Drawing
/// - macOS: screencapture CLI
/// - Linux: cosmic-screenshot or gnome-screenshot or import (ImageMagick)
///
/// Saves to `{data_dir}/screenshots/screenshot-{timestamp}.png`.
/// Cleans up old screenshots, keeping the last 5.
#[tauri::command]
pub async fn take_screenshot() -> IpcResponse {
    let screenshots_dir = crate::services::platform::get_data_dir().join("screenshots");
    if let Err(e) = fs::create_dir_all(&screenshots_dir) {
        return IpcResponse::err(format!("Failed to create screenshots dir: {}", e));
    }

    // Clean up old screenshots (keep last 5)
    cleanup_old_screenshots(&screenshots_dir, 5);

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("screenshot-{}.png", now_ms);
    let filepath = screenshots_dir.join(&filename);
    let filepath_str = filepath.to_string_lossy().to_string();

    let result = tokio::task::spawn_blocking(move || {
        capture_screen_native(&filepath_str)
    })
    .await;

    match result {
        Ok(Ok(())) => IpcResponse::ok(serde_json::json!({ "path": filepath.to_string_lossy() })),
        Ok(Err(e)) => IpcResponse::err(e),
        Err(e) => IpcResponse::err(format!("Screenshot task panicked: {}", e)),
    }
}

/// List all monitors with thumbnail previews (base64 PNG).
///
/// Returns JSON array: `[{ index, name, width, height, x, y, primary, thumbnail }]`
/// Thumbnails are resized to max 300px wide.
#[tauri::command]
pub async fn list_monitors(app: AppHandle) -> IpcResponse {
    with_aot_disabled(&app, || async {
        let result = tokio::task::spawn_blocking(|| {
            let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$results = @()
$screens = [System.Windows.Forms.Screen]::AllScreens
for ($i = 0; $i -lt $screens.Length; $i++) {
    $s = $screens[$i]
    $b = $s.Bounds
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)
    $g.Dispose()
    # Resize to thumbnail (max 300px wide)
    $maxW = 300
    if ($b.Width -gt $maxW) {
        $ratio = $maxW / $b.Width
        $newH = [int]($b.Height * $ratio)
        $thumb = New-Object System.Drawing.Bitmap($maxW, $newH)
        $tg = [System.Drawing.Graphics]::FromImage($thumb)
        $tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $tg.DrawImage($bmp, 0, 0, $maxW, $newH)
        $tg.Dispose()
        $bmp.Dispose()
        $bmp = $thumb
    }
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()
    $results += @{
        index = $i
        name = $s.DeviceName
        width = $b.Width
        height = $b.Height
        x = $b.X
        y = $b.Y
        primary = $s.Primary
        thumbnail = $b64
    }
}
$results | ConvertTo-Json -Compress
"#;
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
                .output()
                .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("list_monitors failed: {}", stderr.trim()));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
                .map_err(|e| format!("Failed to parse monitor JSON: {}", e))?;

            // PowerShell ConvertTo-Json returns a single object (not array) for 1 item
            let arr = if parsed.is_array() {
                parsed
            } else {
                serde_json::json!([parsed])
            };

            Ok(arr)
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
            let ps_script = format!(
                r#"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
    [StructLayout(LayoutKind.Sequential)] public struct RECT {{ public int Left, Top, Right, Bottom; }}
}}
"@
$myPid = {}
$results = [System.Collections.ArrayList]::new()
$cb = {{
    param($hWnd, $lParam)
    if (-not [WinAPI]::IsWindowVisible($hWnd)) {{ return $true }}
    if ([WinAPI]::IsIconic($hWnd)) {{ return $true }}
    $sb = New-Object System.Text.StringBuilder 256
    [void][WinAPI]::GetWindowText($hWnd, $sb, 256)
    $title = $sb.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) {{ return $true }}
    if ($title -eq 'Voice Mirror') {{ return $true }}
    $cloaked = 0
    [void][WinAPI]::DwmGetWindowAttribute($hWnd, 14, [ref]$cloaked, 4)
    if ($cloaked -ne 0) {{ return $true }}
    $rect = New-Object WinAPI+RECT
    [void][WinAPI]::GetWindowRect($hWnd, [ref]$rect)
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    if ($w -lt 100 -or $h -lt 50) {{ return $true }}
    $pid = [uint32]0
    [void][WinAPI]::GetWindowThreadProcessId($hWnd, [ref]$pid)
    if ($pid -eq $myPid) {{ return $true }}
    $procName = ""
    try {{ $procName = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName }} catch {{}}
    # Capture window thumbnail using multi-tier strategy:
    # 1. PrintWindow with PW_RENDERFULLCONTENT (flag 2)
    # 2. If blank, try PrintWindow with standard flag (0)
    # 3. If still blank, fall back to CopyFromScreen
    $b64 = ""
    try {{
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $hdc = $g.GetHdc()
        $ok = [WinAPI]::PrintWindow($hWnd, $hdc, 2)
        $g.ReleaseHdc($hdc)
        $g.Dispose()
        # Check if capture produced blank content (sample 3 pixels)
        $useThis = $ok
        if ($ok -and $w -gt 10 -and $h -gt 10) {{
            $p1 = $bmp.GetPixel([int]($w/2), [int]($h/2))
            $p2 = $bmp.GetPixel([int]($w/4), [int]($h/4))
            $p3 = $bmp.GetPixel([int]($w*3/4), [int]($h*3/4))
            if ($p1.R+$p1.G+$p1.B -lt 15 -and $p2.R+$p2.G+$p2.B -lt 15 -and $p3.R+$p3.G+$p3.B -lt 15) {{
                $useThis = $false
            }}
        }}
        if (-not $useThis) {{
            # Try PrintWindow with standard flag
            $g2 = [System.Drawing.Graphics]::FromImage($bmp)
            $hdc2 = $g2.GetHdc()
            $ok2 = [WinAPI]::PrintWindow($hWnd, $hdc2, 0)
            $g2.ReleaseHdc($hdc2)
            $g2.Dispose()
            $useThis = $ok2
            if ($ok2 -and $w -gt 10 -and $h -gt 10) {{
                $p1 = $bmp.GetPixel([int]($w/2), [int]($h/2))
                $p2 = $bmp.GetPixel([int]($w/4), [int]($h/4))
                if ($p1.R+$p1.G+$p1.B -lt 15 -and $p2.R+$p2.G+$p2.B -lt 15) {{
                    $useThis = $false
                }}
            }}
        }}
        if (-not $useThis) {{
            # Last resort: CopyFromScreen (works when AOT is off)
            $bmp.Dispose()
            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            $g3 = [System.Drawing.Graphics]::FromImage($bmp)
            $g3.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
            $g3.Dispose()
        }}
        $maxW = 300
        if ($w -gt $maxW) {{
            $ratio = $maxW / $w
            $newH = [int]($h * $ratio)
            $thumb = New-Object System.Drawing.Bitmap($maxW, $newH)
            $tg = [System.Drawing.Graphics]::FromImage($thumb)
            $tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $tg.DrawImage($bmp, 0, 0, $maxW, $newH)
            $tg.Dispose()
            $bmp.Dispose()
            $bmp = $thumb
        }}
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose()
        $bmp.Dispose()
    }} catch {{}}
    # Extract process icon
    $iconB64 = ""
    try {{
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainModule) {{
            $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($proc.MainModule.FileName)
            if ($ico) {{
                $iconBmp = $ico.ToBitmap()
                $ims = New-Object System.IO.MemoryStream
                $iconBmp.Save($ims, [System.Drawing.Imaging.ImageFormat]::Png)
                $iconB64 = [Convert]::ToBase64String($ims.ToArray())
                $ims.Dispose()
                $iconBmp.Dispose()
                $ico.Dispose()
            }}
        }}
    }} catch {{}}
    [void]$results.Add(@{{
        hwnd = $hWnd.ToInt64()
        title = $title
        processName = $procName
        width = $w
        height = $h
        thumbnail = $b64
        icon = $iconB64
    }})
    return $true
}}
[WinAPI]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$results | ConvertTo-Json -Compress
"#,
                our_pid
            );

            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .output()
                .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("list_windows failed: {}", stderr.trim()));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let trimmed = stdout.trim();
            if trimmed.is_empty() {
                return Ok(serde_json::json!([]));
            }

            let parsed: serde_json::Value = serde_json::from_str(trimmed)
                .map_err(|e| format!("Failed to parse windows JSON: {}", e))?;

            let arr = if parsed.is_array() {
                parsed
            } else {
                serde_json::json!([parsed])
            };

            Ok(arr)
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
/// Returns `{ path }`.
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
        let filepath_str = filepath.to_string_lossy().to_string();

        let result = tokio::task::spawn_blocking(move || {
            let ps_script = format!(
                r#"Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $s = [System.Windows.Forms.Screen]::AllScreens[{}]; $b = $s.Bounds; $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size); $g.Dispose(); $bmp.Save('{}'); $bmp.Dispose()"#,
                index,
                filepath_str.replace('\'', "''")
            );
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .output()
                .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("capture_monitor failed: {}", stderr.trim()));
            }
            Ok(())
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
            Err(e) => IpcResponse::err(format!("capture_monitor task panicked: {}", e)),
        }
    })
    .await
}

/// Capture a specific window by HWND at full resolution.
///
/// Saves to `{data_dir}/screenshots/screenshot-{timestamp}.png`.
/// Returns `{ path }`.
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
        let filepath_str = filepath.to_string_lossy().to_string();

        let result = tokio::task::spawn_blocking(move || {
            let ps_script = format!(
                r#"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {{
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT {{ public int Left, Top, Right, Bottom; }}
}}
"@
$hwnd = [IntPtr]{}
$rect = New-Object WinRect+RECT
[void][WinRect]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -lt 1 -or $h -lt 1) {{ throw "Invalid window dimensions" }}
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WinRect]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
# Check if capture is blank (sample 3 pixels)
$useThis = $ok
if ($ok -and $w -gt 10 -and $h -gt 10) {{
    $p1 = $bmp.GetPixel([int]($w/2), [int]($h/2))
    $p2 = $bmp.GetPixel([int]($w/4), [int]($h/4))
    $p3 = $bmp.GetPixel([int]($w*3/4), [int]($h*3/4))
    if ($p1.R+$p1.G+$p1.B -lt 15 -and $p2.R+$p2.G+$p2.B -lt 15 -and $p3.R+$p3.G+$p3.B -lt 15) {{
        $useThis = $false
    }}
}}
if (-not $useThis) {{
    $g2 = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc2 = $g2.GetHdc()
    $ok2 = [WinRect]::PrintWindow($hwnd, $hdc2, 0)
    $g2.ReleaseHdc($hdc2)
    $g2.Dispose()
    $useThis = $ok2
    if ($ok2 -and $w -gt 10 -and $h -gt 10) {{
        $p1 = $bmp.GetPixel([int]($w/2), [int]($h/2))
        $p2 = $bmp.GetPixel([int]($w/4), [int]($h/4))
        if ($p1.R+$p1.G+$p1.B -lt 15 -and $p2.R+$p2.G+$p2.B -lt 15) {{
            $useThis = $false
        }}
    }}
}}
if (-not $useThis) {{
    $bmp.Dispose()
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g3 = [System.Drawing.Graphics]::FromImage($bmp)
    $g3.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $g3.Dispose()
}}
$bmp.Save('{}')
$bmp.Dispose()
"#,
                hwnd,
                filepath_str.replace('\'', "''")
            );
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .output()
                .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("capture_window failed: {}", stderr.trim()));
            }
            Ok(())
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
            Err(e) => IpcResponse::err(format!("capture_window task panicked: {}", e)),
        }
    })
    .await
}
