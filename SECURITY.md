# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| Tauri 2 (tauri-migration branch) | :white_check_mark: |
| Electron 0.9.x | :x: (legacy)     |
| < 0.9   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Voice Mirror, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. **Email:** Send details to the maintainers via [GitHub private vulnerability reporting](https://github.com/contextmirror/voice-mirror-electron/security/advisories/new)
3. **Include:** A description of the vulnerability, steps to reproduce, and potential impact

## What to Expect

- **Acknowledgement** within 48 hours
- **Assessment** within 1 week
- **Fix or mitigation** as soon as practical, depending on severity

## Scope

The following are in scope for security reports:

- **Tauri command injection or bypass** — unauthorized calls to `#[tauri::command]` handlers
- **IPC validation failures** — malformed or malicious `invoke()` payloads reaching the Rust backend
- **MCP tool injection or bypass** — exploiting the Rust MCP server tool handlers
- **API key exposure or leakage** — keys reaching the frontend WebView or logs
- **Prompt injection** that bypasses AI provider guardrails
- **PTY escape or privilege escalation** — via CLI provider pseudo-terminals (portable-pty)
- **Named pipe / Unix socket security** — unauthorized access to the MCP IPC channel
- **Dependency vulnerabilities** with a clear exploit path (Rust crates or npm packages)
- **Config file tampering** — bypassing atomic write protections or injecting malicious config

## Security Measures

Voice Mirror implements the following security controls:

### Tauri Security Model
- **No Node.js in the frontend** — the WebView runs only the Svelte bundle; there is no `require()`, no `fs`, no `child_process` available to frontend code
- **Rust type-checked commands** — all `#[tauri::command]` handlers use Rust's type system to validate inputs at compile time. Malformed payloads are rejected before reaching business logic
- **Capability-based permissions** — Tauri 2's permission system restricts which commands the frontend can call, configured in `tauri.conf.json`
- **No `dangerousRemoteDomainIpcAccess`** — the WebView only communicates with the local Rust backend, never with remote origins

### Data Protection
- **API key redaction** — keys are masked before reaching the frontend WebView
- **Filtered PTY environment** — only allowlisted environment variables are passed to spawned CLI processes
- **Atomic config writes** — config is written to `.tmp`, existing backed up to `.bak`, then `.tmp` renamed to config (prevents corruption and partial writes)
- **Named pipe authentication** — the MCP IPC channel uses platform-appropriate security (Windows named pipe ACLs, Unix socket file permissions)

### Input Validation
- **Rust type system** — command parameters are deserialized via serde; invalid types are rejected automatically
- **Config schema validation** — `config/schema.rs` defines the full config structure; unknown or invalid fields are dropped on deserialization
- **Path sanitization** — file paths from the frontend are validated against directory traversal attacks before use

### AI Provider Security
- **First-launch disclaimer** warning users about terminal access permissions for CLI providers
- **Prompt injection defenses** — system prompts include guardrails against tool-chaining and memory poisoning attacks
- **Tool gating** — destructive MCP tools require explicit `confirmed: true` parameter

## Third-Party Security Scanning

This project is monitored by:

- [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/contextmirror/voice-mirror-electron)
- [Snyk](https://snyk.io/test/github/contextmirror/voice-mirror-electron)
- [Socket.dev](https://socket.dev)
- `cargo audit` for Rust dependency vulnerabilities
- `npm audit` for JavaScript dependency vulnerabilities
