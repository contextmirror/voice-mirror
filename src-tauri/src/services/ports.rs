//! Listening TCP port enumeration (port → PID → process name).
//!
//! Backs the `list_ports` MCP tool and the `sandbox_start` port-conflict message
//! so the agent can see WHICH process holds a port without shelling out to
//! PowerShell/netstat. Uses the Win32 IP Helper `GetExtendedTcpTable`
//! (`TCP_TABLE_OWNER_PID_LISTENER`) for the port→PID map, and `OpenProcess` +
//! `QueryFullProcessImageNameW` for PID→process name (same pattern as
//! `commands::screenshot`). System-wide query — needs no app state, so it runs
//! directly in the MCP binary.

use serde::Serialize;

/// One listening TCP port and the process that owns it.
#[derive(Debug, Clone, Serialize)]
pub struct PortInfo {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub state: String,
}

/// All listening TCP ports (IPv4 + IPv6), deduped by (port, pid), sorted by port.
/// When `filter` is set, only that port is returned.
pub fn list_ports(filter: Option<u16>) -> Result<Vec<PortInfo>, String> {
    let mut all = enumerate()?;
    all.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    all.dedup_by(|a, b| a.port == b.port && a.pid == b.pid);
    if let Some(p) = filter {
        all.retain(|e| e.port == p);
    }
    Ok(all)
}

/// The first process found listening on `port`, if any.
pub fn find_port(port: u16) -> Option<PortInfo> {
    list_ports(Some(port)).ok().and_then(|mut v| v.drain(..).next())
}

/// A short human suffix naming the process holding `port`, e.g.
/// ` (held by PID 43468 — vite)`. Empty string when nothing is found (so it can
/// be concatenated unconditionally into a message).
pub fn describe_port_holder(port: u16) -> String {
    match find_port(port) {
        Some(info) => {
            let name = if info.process_name.is_empty() {
                String::new()
            } else {
                format!(" — {}", info.process_name)
            };
            format!(" (held by PID {}{})", info.pid, name)
        }
        None => String::new(),
    }
}

/// Render a small text table of port rows for the MCP tool output.
pub fn format_table(rows: &[PortInfo]) -> String {
    if rows.is_empty() {
        return "No listening TCP ports found.".to_string();
    }
    let mut out = String::from("PORT   PID      STATE       PROCESS\n");
    for r in rows {
        out.push_str(&format!(
            "{:<6} {:<8} {:<11} {}\n",
            r.port,
            r.pid,
            r.state,
            if r.process_name.is_empty() { "?" } else { &r.process_name }
        ));
    }
    out
}

// ── Windows implementation ────────────────────────────────────────────────────

#[cfg(windows)]
fn enumerate() -> Result<Vec<PortInfo>, String> {
    let mut rows = Vec::new();
    collect_v4(&mut rows);
    collect_v6(&mut rows);
    Ok(rows)
}

// AF_INET / AF_INET6 address-family constants (avoids pulling a WinSock import
// just for two integers; GetExtendedTcpTable takes the family as a raw u32).
#[cfg(windows)]
const AF_INET: u32 = 2;
#[cfg(windows)]
const AF_INET6: u32 = 23;

/// `dwLocalPort` stores the port in the low 16 bits in network byte order; swap
/// the two bytes to host order.
#[cfg(windows)]
fn ntohs(v: u32) -> u16 {
    (((v & 0xff) << 8) | ((v & 0xff00) >> 8)) as u16
}

/// Map a `MIB_TCP_STATE` numeric value to a readable name.
#[cfg(windows)]
fn state_name(s: u32) -> String {
    match s {
        1 => "CLOSED",
        2 => "LISTEN",
        3 => "SYN_SENT",
        4 => "SYN_RCVD",
        5 => "ESTABLISHED",
        6 => "FIN_WAIT1",
        7 => "FIN_WAIT2",
        8 => "CLOSE_WAIT",
        9 => "CLOSING",
        10 => "LAST_ACK",
        11 => "TIME_WAIT",
        12 => "DELETE_TCB",
        _ => "UNKNOWN",
    }
    .to_string()
}

#[cfg(windows)]
fn collect_v4(out: &mut Vec<PortInfo>) {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };

    unsafe {
        let mut size: u32 = 0;
        // First call sizes the buffer (returns ERROR_INSUFFICIENT_BUFFER).
        let _ = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if size == 0 {
            return;
        }
        let mut buf = vec![0u8; size as usize];
        let ret = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
            &mut size,
            false,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if ret != 0 {
            return;
        }
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let n = table.dwNumEntries as usize;
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), n);
        for row in rows {
            let pid = row.dwOwningPid;
            out.push(PortInfo {
                port: ntohs(row.dwLocalPort),
                pid,
                process_name: process_name(pid),
                state: state_name(row.dwState),
            });
        }
    }
}

#[cfg(windows)]
fn collect_v6(out: &mut Vec<PortInfo>) {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6TABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };

    unsafe {
        let mut size: u32 = 0;
        let _ = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            AF_INET6,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if size == 0 {
            return;
        }
        let mut buf = vec![0u8; size as usize];
        let ret = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
            &mut size,
            false,
            AF_INET6,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if ret != 0 {
            return;
        }
        let table = &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
        let n = table.dwNumEntries as usize;
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), n);
        for row in rows {
            let pid = row.dwOwningPid;
            out.push(PortInfo {
                port: ntohs(row.dwLocalPort),
                pid,
                process_name: process_name(pid),
                state: state_name(row.dwState),
            });
        }
    }
}

/// Resolve a PID to its executable's base name (e.g. "vite", "node"). Empty
/// string when the process can't be opened (access denied / already exited).
#[cfg(windows)]
fn process_name(pid: u32) -> String {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if pid == 0 {
        return String::new();
    }
    unsafe {
        let process = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return String::new(),
        };
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
            return String::new();
        }
        let full_path = String::from_utf16_lossy(&buf[..size as usize]);
        std::path::Path::new(&full_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    }
}

// ── Non-Windows stub ─────────────────────────────────────────────────────────

#[cfg(not(windows))]
fn enumerate() -> Result<Vec<PortInfo>, String> {
    Err("Listing ports is only supported on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_table_empty() {
        assert!(format_table(&[]).contains("No listening"));
    }

    #[test]
    fn test_format_table_rows() {
        let rows = vec![PortInfo {
            port: 1430,
            pid: 43468,
            process_name: "vite".into(),
            state: "LISTEN".into(),
        }];
        let t = format_table(&rows);
        assert!(t.contains("1430"));
        assert!(t.contains("43468"));
        assert!(t.contains("vite"));
        assert!(t.contains("LISTEN"));
    }

    #[test]
    fn test_describe_port_holder_unused_port() {
        // A port nothing is listening on yields an empty suffix.
        assert_eq!(describe_port_holder(1), "");
    }
}
