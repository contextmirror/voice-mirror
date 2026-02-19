# docs/

Project documentation for Voice Mirror.

> Voice Mirror has migrated from Electron to **Tauri 2**. The `tauri/` directory is the source of truth. Legacy Electron documentation may reference outdated patterns.

## Documents

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, component diagram, data flow |
| [CONFIGURATION.md](CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev setup, Tauri commands, project structure, testing |
| [VOICE-PIPELINE.md](VOICE-PIPELINE.md) | Rust-native voice pipeline: STT (Whisper ONNX), TTS (Kokoro/Edge), VAD |
| [PROVIDER-SYSTEM.md](PROVIDER-SYSTEM.md) | Multi-AI provider system: CLI agents (PTY), HTTP API providers |
| [THEME-SYSTEM.md](THEME-SYSTEM.md) | Theme presets, color derivation, custom themes |
| [IPC-PROTOCOL.md](IPC-PROTOCOL.md) | Tauri command reference, invoke() patterns |
| [BROWSER-CONTROL-REFERENCE.md](BROWSER-CONTROL-REFERENCE.md) | Browser control via CDP |
| [TAURI-MIGRATION.md](TAURI-MIGRATION.md) | Migration notes from Electron to Tauri 2 |

Also see the repo root:
- [CLAUDE.md](../CLAUDE.md) -- project context for Claude Code AI assistants
- [CONTRIBUTING.md](../CONTRIBUTING.md) -- contributor onboarding guide

## Suggested Reading Order

1. **ARCHITECTURE.md** -- understand the Tauri 2 system (Rust backend + Svelte 5 frontend)
2. **CONFIGURATION.md** -- know where settings live
3. **DEVELOPMENT.md** -- get a dev environment running with `cargo tauri dev`
4. **PROVIDER-SYSTEM.md** -- understand CLI (portable-pty) and HTTP API providers
5. **VOICE-PIPELINE.md** -- understand the Rust-native STT/TTS/VAD pipeline
6. **THEME-SYSTEM.md** -- understand the theme/appearance system
7. **IPC-PROTOCOL.md** -- reference for Tauri commands and invoke() wrappers
8. **BROWSER-CONTROL-REFERENCE.md** -- understand browser integration
