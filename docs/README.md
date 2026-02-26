# docs/

Project documentation for Voice Mirror.

> **Voice Mirror** is a voice-assisted development environment built on **Tauri 2**. It combines voice control (STT/TTS/VAD), AI agent integration (Claude Code, OpenCode), and a full-featured Lens workspace (file editor, live browser preview, terminal, dev server management) into a single desktop app. The `src-tauri/` directory contains the Rust backend and `src/` the Svelte 5 frontend.

## Folder Structure

```
docs/
├── guides/            User-facing setup and feature docs
├── reference/         Technical architecture and API reference
├── design/            Architecture decisions and design docs
├── implementation/    Active feature plans and roadmaps
├── troubleshooting/   Known issues and debugging guides
└── README.md          This file
```

## Guides

How-to docs for getting started and using features.

| File | Description |
|------|-------------|
| [GETTING-STARTED.md](guides/GETTING-STARTED.md) | Dev setup, project structure, Tauri commands, testing |
| [CONFIGURATION.md](guides/CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [VOICE-PIPELINE.md](guides/VOICE-PIPELINE.md) | Voice pipeline: STT (Whisper), TTS (Kokoro/Edge), VAD |
| [THEME-SYSTEM.md](guides/THEME-SYSTEM.md) | Theme presets, color derivation, custom themes |

## Reference

Technical architecture and API documentation.

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](reference/ARCHITECTURE.md) | System overview, component diagram, data flow |
| [BROWSER-CONTROL.md](reference/BROWSER-CONTROL.md) | Browser control via native WebView2 bridge |

## Design

Architecture decisions, design documents, and integration plans.

| File | Description |
|------|-------------|
| [LSP-DESIGN.md](design/LSP-DESIGN.md) | LSP integration design, tiers, Zed comparison |
| [CODE-NAVIGATION-MCP.md](design/CODE-NAVIGATION-MCP.md) | MCP tool group for voice-first IDE control |
| [UNIFIED-SERVER-PLAN.md](design/UNIFIED-SERVER-PLAN.md) | Unified server plan (dev servers, MCP, LSP tabs) |

## Implementation

Active feature plans, roadmaps, and research.

| File | Description |
|------|-------------|
| [DEV-SERVER-DETECTION.md](implementation/DEV-SERVER-DETECTION.md) | Dev server auto-detection and workspace integration |
| [MCP-SERVERS.md](implementation/MCP-SERVERS.md) | External MCP server management plan |
| [STT-MODELS.md](implementation/STT-MODELS.md) | Speech-to-text model comparison and research |
| [IDE-GAPS.md](implementation/IDE-GAPS.md) | IDE feature gap analysis vs VS Code/Zed |
| [INSTALLER-PLAN.md](implementation/INSTALLER-PLAN.md) | Optional component installation plan |

## Troubleshooting

Known issues, bug trackers, and debugging guides.

| File | Description |
|------|-------------|
| [KNOWN-ISSUES.md](troubleshooting/KNOWN-ISSUES.md) | Known bugs and issues tracker |
| [TERMINAL-RENDERING-BUG.md](troubleshooting/TERMINAL-RENDERING-BUG.md) | Terminal rendering glitch analysis and fix |

## Also See

- [CLAUDE.md](../CLAUDE.md) -- project context for Claude Code AI assistants
- [CONTRIBUTING.md](../CONTRIBUTING.md) -- contributor onboarding guide

## Suggested Reading Order

1. **guides/GETTING-STARTED.md** -- get a dev environment running
2. **reference/ARCHITECTURE.md** -- system overview: Rust backend, Svelte 5 frontend, Lens workspace
3. **guides/CONFIGURATION.md** -- settings, AI providers, voice engine
4. **guides/VOICE-PIPELINE.md** -- Rust-native STT/TTS/VAD pipeline
5. **reference/BROWSER-CONTROL.md** -- native WebView2 browser integration
6. **guides/THEME-SYSTEM.md** -- theme presets, color derivation, custom themes
7. **design/LSP-DESIGN.md** -- if working on the Lens editor
