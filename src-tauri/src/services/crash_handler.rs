//! Native crash handler (Windows) — captures unhandled **SEH** exceptions (access
//! violations, stack overflows, illegal instructions, heap corruption, fast-fail,
//! etc.) that the Rust panic hook CANNOT catch, because they are hardware/OS faults
//! rather than Rust panics.
//!
//! Without this, a native crash returns straight to the shell with no trace at all
//! (no panic message, no WER entry under `cargo run`, no JSONL). On a fatal native
//! fault this appends a human-readable report to `logs/crashes.log` (exception type,
//! faulting address + the **owning module** — which tells us whether the fault was in
//! our exe, WebView2, the WinRT capture DLL, CUDA, …) plus a best-effort **minidump**
//! (`logs/crash-<epoch>.dmp`) for post-mortem debugging in WinDbg / Visual Studio.
//!
//! Complements `install_panic_hook()` in `lib.rs`, which handles Rust panics.

#[cfg(not(windows))]
pub fn install() {}

#[cfg(windows)]
pub fn install() {
    unsafe {
        windows::Win32::System::Diagnostics::Debug::SetUnhandledExceptionFilter(Some(
            imp::crash_filter,
        ));
    }
    tracing::info!("Native crash handler installed (SetUnhandledExceptionFilter)");
}

#[cfg(windows)]
mod imp {
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, FALSE, HMODULE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ,
    };
    use windows::Win32::System::Diagnostics::Debug::{
        MiniDumpWithDataSegs, MiniDumpWithThreadInfo, MiniDumpWriteDump, EXCEPTION_POINTERS,
        MINIDUMP_EXCEPTION_INFORMATION, MINIDUMP_TYPE,
    };
    use windows::Win32::System::LibraryLoader::{
        GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
        GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId,
    };

    /// Re-entrancy guard: never run the handler twice (a fault inside the handler).
    static IN_HANDLER: AtomicBool = AtomicBool::new(false);

    /// The filter returns this to let the OS default handler run after we've logged.
    const EXCEPTION_CONTINUE_SEARCH: i32 = 0;

    fn exception_name(code: u32) -> &'static str {
        match code {
            0xC000_0005 => "ACCESS_VIOLATION",
            0xC000_00FD => "STACK_OVERFLOW",
            0xC000_0409 => "STACK_BUFFER_OVERRUN / FAST_FAIL",
            0xC000_001D => "ILLEGAL_INSTRUCTION",
            0xC000_0094 => "INTEGER_DIVIDE_BY_ZERO",
            0xC000_0374 => "HEAP_CORRUPTION",
            0xC000_0096 => "PRIVILEGED_INSTRUCTION",
            0xC000_008C => "ARRAY_BOUNDS_EXCEEDED",
            0xC000_008E => "FLT_DIVIDE_BY_ZERO",
            0x8000_0003 => "BREAKPOINT",
            0xE06D_7363 => "C++ EXCEPTION (unwound past FFI)",
            _ => "UNKNOWN",
        }
    }

    /// Resolve the module (DLL/exe) that owns a code address. The single most useful
    /// signal: it says whether the crash was in our code or a third-party module.
    unsafe fn module_for_address(addr: usize) -> String {
        let mut hmod = HMODULE::default();
        if GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(addr as *const u16),
            &mut hmod,
        )
        .is_err()
        {
            return "<unknown module>".to_string();
        }
        let mut buf = [0u16; 260];
        let len = GetModuleFileNameW(Some(hmod), &mut buf);
        if len == 0 {
            return "<unknown module>".to_string();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    /// Best-effort minidump for post-mortem stack/symbol inspection.
    unsafe fn write_minidump(path: &std::path::Path, info: *const EXCEPTION_POINTERS) -> bool {
        const GENERIC_WRITE: u32 = 0x4000_0000;
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let hfile = match CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_WRITE,
            FILE_SHARE_READ,
            None,
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            None,
        ) {
            Ok(h) => h,
            Err(_) => return false,
        };
        let mut mei = MINIDUMP_EXCEPTION_INFORMATION {
            ThreadId: GetCurrentThreadId(),
            ExceptionPointers: info as *mut _,
            ClientPointers: FALSE,
        };
        let dump_type = MINIDUMP_TYPE(MiniDumpWithThreadInfo.0 | MiniDumpWithDataSegs.0);
        let ok = MiniDumpWriteDump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            hfile,
            dump_type,
            Some(&mei as *const _),
            None,
            None,
        )
        .is_ok();
        let _ = CloseHandle(hfile);
        ok
    }

    pub(super) unsafe extern "system" fn crash_filter(info: *const EXCEPTION_POINTERS) -> i32 {
        if IN_HANDLER.swap(true, Ordering::SeqCst) {
            return EXCEPTION_CONTINUE_SEARCH;
        }
        if info.is_null() || (*info).ExceptionRecord.is_null() {
            return EXCEPTION_CONTINUE_SEARCH;
        }

        let rec = &*(*info).ExceptionRecord;
        let code = rec.ExceptionCode.0 as u32;
        let addr = rec.ExceptionAddress as usize;
        let module = module_for_address(addr);
        let name = exception_name(code);
        let tid = GetCurrentThreadId();

        // Access-violation detail: read/write/execute + the inaccessible address.
        let av_detail = if code == 0xC000_0005 && rec.NumberParameters >= 2 {
            let kind = match rec.ExceptionInformation[0] {
                0 => "reading",
                1 => "writing",
                8 => "executing (DEP)",
                _ => "accessing",
            };
            format!(" ({} address 0x{:016x})", kind, rec.ExceptionInformation[1])
        } else {
            String::new()
        };

        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let dir = crate::services::platform::get_log_dir();
        let _ = std::fs::create_dir_all(&dir);
        let dump_path = dir.join(format!("crash-{epoch}.dmp"));
        let dumped = write_minidump(&dump_path, info);

        let report = format!(
            "==== Voice Mirror NATIVE CRASH ====\n\
             epoch: {epoch}\n\
             exception: {name} (0x{code:08x}){av_detail}\n\
             faulting address: 0x{addr:016x}\n\
             faulting module: {module}\n\
             thread id: {tid}\n\
             minidump: {}\n\
             ===================================\n\n",
            if dumped {
                dump_path.display().to_string()
            } else {
                "<minidump write failed>".to_string()
            }
        );

        let _ = std::fs::write(dir.join(format!("native-crash-{epoch}.log")), &report);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("crashes.log"))
        {
            use std::io::Write;
            let _ = f.write_all(report.as_bytes());
        }

        // Let the OS default handler proceed (terminate / WER) now that we've logged.
        EXCEPTION_CONTINUE_SEARCH
    }
}
