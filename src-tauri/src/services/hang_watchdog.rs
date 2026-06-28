//! UI-thread **hang watchdog**. A dedicated thread — unaffected by a frozen UI —
//! polls the main window with `IsHungAppWindow` once a second. If the UI stays
//! unresponsive past a threshold, it logs the hang to `logs/crashes.log` AND writes
//! a process minidump (`logs/hang-<epoch>.dmp`) capturing the **stuck main-thread
//! stack** — turning "it freezes sometimes" into "the main thread was stuck in X".
//!
//! This is the hang equivalent of `crash_handler` (native faults) and the panic hook
//! (Rust panics): a "Not Responding" freeze is neither, so it needs its own detector.

#[cfg(not(windows))]
pub fn start(_main_hwnd: i64) {}

/// Start the watchdog for the app's main window (HWND as i64, from `window.hwnd()`).
#[cfg(windows)]
pub fn start(main_hwnd: i64) {
    if main_hwnd == 0 {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("hang-watchdog".into())
        .spawn(move || imp::run(main_hwnd));
    if spawned.is_err() {
        tracing::warn!("Failed to spawn hang watchdog thread");
    } else {
        tracing::info!("UI hang watchdog started (IsHungAppWindow poll)");
    }
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsHungAppWindow;

    /// Seconds of *observed* unresponsiveness before we dump. IsHungAppWindow itself
    /// only reports `true` after the window has ignored input for ~5s, so the real
    /// freeze is already well underway by the time we count up to this — together
    /// that's a confident "this is a genuine hang, not a brief stutter".
    const THRESHOLD_SECS: u32 = 6;

    pub(super) fn run(main_hwnd: i64) {
        let hwnd = HWND(main_hwnd as *mut std::ffi::c_void);
        let mut hung_secs: u32 = 0;
        let mut dumped = false;

        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let hung = unsafe { IsHungAppWindow(hwnd).as_bool() };

            if hung {
                hung_secs += 1;
                if hung_secs >= THRESHOLD_SECS && !dumped {
                    dumped = true;
                    record_hang(hung_secs);
                }
            } else {
                if dumped {
                    tracing::info!(target: "app", "UI thread recovered after ~{}s hang", hung_secs);
                    append_crashes_log(&format!(
                        "UI thread RECOVERED after ~{hung_secs}s freeze\n\n"
                    ));
                }
                hung_secs = 0;
                dumped = false;
            }
        }
    }

    /// Log the hang + snapshot the stuck main-thread stack into a minidump.
    fn record_hang(secs: u32) {
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let dir = crate::services::platform::get_log_dir();
        let _ = std::fs::create_dir_all(&dir);
        let dump_path = dir.join(format!("hang-{epoch}.dmp"));
        let dumped = crate::services::crash_handler::capture_process_dump(&dump_path);

        tracing::error!(
            target: "app",
            "UI HANG: main window unresponsive ~{}s; minidump written={}",
            secs,
            dumped
        );

        let report = format!(
            "==== Voice Mirror UI HANG ====\n\
             epoch: {epoch}\n\
             UI thread unresponsive for ~{secs}s (IsHungAppWindow)\n\
             minidump: {}\n\
             (open in WinDbg/Visual Studio; inspect the MAIN thread's call stack to\n\
              see what it was blocked on)\n\
             ==============================\n\n",
            if dumped {
                dump_path.display().to_string()
            } else {
                "<minidump write failed>".to_string()
            }
        );
        let _ = std::fs::write(dir.join(format!("hang-{epoch}.log")), &report);
        append_crashes_log(&report);
    }

    fn append_crashes_log(text: &str) {
        let dir = crate::services::platform::get_log_dir();
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("crashes.log"))
        {
            use std::io::Write;
            let _ = f.write_all(text.as_bytes());
        }
    }
}
