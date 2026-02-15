# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.9.x   | :white_check_mark: |
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

- Electron main process vulnerabilities (IPC, preload, node integration)
- MCP tool injection or bypass
- API key exposure or leakage
- Prompt injection that bypasses CLAUDE.md guardrails
- PTY escape or privilege escalation
- Dependency vulnerabilities with a clear exploit path

## Security Measures

Voice Mirror implements the following security controls:

- **Content Security Policy** on all HTML pages
- **Context isolation** and disabled `nodeIntegration` in renderer
- **API key redaction** — keys are masked before reaching the renderer process
- **Filtered PTY environment** — only allowlisted variables are passed to spawned processes
- **Input validation** on all IPC channels
- **First-launch disclaimer** warning users about terminal access permissions
- **Prompt injection defences** in CLAUDE.md (tool-chaining, memory poisoning)

## Third-Party Security Scanning

This project is monitored by:

- [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/contextmirror/voice-mirror-electron)
- [Snyk](https://snyk.io/test/github/contextmirror/voice-mirror-electron)
- [Socket.dev](https://socket.dev)
