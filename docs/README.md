# docs/

Project documentation for Voice Mirror.

> **Voice Mirror** is a voice-assisted development environment built on **Tauri 2**. It combines voice control (STT/TTS/VAD), AI agent integration (Claude Code, OpenCode), and a full-featured Lens workspace (file editor, live browser preview, terminal, dev server management) into a single desktop app. The `src-tauri/` directory contains the Rust backend and `src/` the Svelte 5 frontend.

## Documents

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, component diagram, data flow |
| [CONFIGURATION.md](CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev setup, Tauri commands, project structure, testing |
| [VOICE-PIPELINE.md](VOICE-PIPELINE.md) | Rust-native voice pipeline: STT (Whisper ONNX), TTS (Kokoro/Edge), VAD |
| [THEME-SYSTEM.md](THEME-SYSTEM.md) | Theme presets, color derivation, custom themes |
| [BROWSER-CONTROL-REFERENCE.md](BROWSER-CONTROL-REFERENCE.md) | Browser control via native WebView2 bridge |

Also see the repo root:
- [CLAUDE.md](../CLAUDE.md) -- project context for Claude Code AI assistants
- [CONTRIBUTING.md](../CONTRIBUTING.md) -- contributor onboarding guide

### Internal Docs

Design docs and implementation plans in `docs/internal/`:

| File | Description |
|------|-------------|
| [LSP-DESIGN.md](internal/LSP-DESIGN.md) | LSP integration design and architecture |
| [MCP-SERVERS.md](internal/MCP-SERVERS.md) | External MCP server management plan |
| [DEV-SERVER-DETECTION.md](internal/DEV-SERVER-DETECTION.md) | Dev server auto-detection and workspace browser integration |
| [DEV-SERVER-CHECKLIST.md](internal/DEV-SERVER-CHECKLIST.md) | Dev server feature implementation checklist |
| [UNIFIED-SERVER-PLAN.md](internal/UNIFIED-SERVER-PLAN.md) | Unified server plan (Servers/MCP/LSP tabs) |
| [INSTALLER-PLAN.md](internal/INSTALLER-PLAN.md) | Installer and optional component plan |
| [BUGS.md](internal/BUGS.md) | Known bugs tracker |

## Suggested Reading Order

1. **ARCHITECTURE.md** -- system overview: Rust backend, Svelte 5 frontend, Lens workspace, MCP tools
2. **DEVELOPMENT.md** -- get a dev environment running with `npm run dev`
3. **CONFIGURATION.md** -- settings, AI providers, voice engine, workspace preferences
4. **VOICE-PIPELINE.md** -- Rust-native STT/TTS/VAD pipeline
5. **BROWSER-CONTROL-REFERENCE.md** -- native WebView2 browser integration in the Lens workspace
6. **THEME-SYSTEM.md** -- theme presets, color derivation, custom themes
