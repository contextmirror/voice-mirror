# docs/

Project documentation for Voice Mirror Electron.

## Documents

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, component diagram, data flow |
| [CONFIGURATION.md](CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev setup, running locally, project conventions |
| [VOICE-PIPELINE.md](VOICE-PIPELINE.md) | Rust voice-core architecture, STT/TTS/VAD, audio IPC protocol |
| [PROVIDER-SYSTEM.md](PROVIDER-SYSTEM.md) | Multi-AI provider system: Claude Code, CLI agents, OpenAI HTTP |
| [THEME-SYSTEM.md](THEME-SYSTEM.md) | Theme presets, color derivation, custom themes, TUI theming |
| [IPC-PROTOCOL.md](IPC-PROTOCOL.md) | Complete IPC channel reference (70+ channels, validators) |
| [BROWSER-CONTROL-REFERENCE.md](BROWSER-CONTROL-REFERENCE.md) | Deep-dive into browser control via CDP |
| [POLISH-PLAN.md](POLISH-PLAN.md) | Roadmap: e2e tests, error recovery, crash logging, telemetry |

Also see the repo root:
- [CLAUDE.md](../CLAUDE.md) — project context for Claude Code AI assistants
- [CONTRIBUTING.md](../CONTRIBUTING.md) — contributor onboarding guide

## Suggested Reading Order

1. ARCHITECTURE.md — understand the system
2. CONFIGURATION.md — know where settings live
3. DEVELOPMENT.md — get a dev environment running
4. PROVIDER-SYSTEM.md — understand the multi-AI provider layer
5. VOICE-PIPELINE.md — understand the Rust voice backend
6. THEME-SYSTEM.md — understand the theme/appearance system
7. IPC-PROTOCOL.md — reference for all IPC channels
8. BROWSER-CONTROL-REFERENCE.md — understand browser integration
