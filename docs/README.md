# docs/

Project documentation for Voice Mirror.

> **Voice Mirror** is a voice-assisted development environment built on **Tauri 2**. It combines voice control (STT/TTS/VAD), AI agent integration (Claude Code, OpenCode), and a full-featured Lens workspace (file editor, live browser preview, terminal, dev server management) into a single desktop app. The `src-tauri/` directory contains the Rust backend and `src/` the Svelte 5 frontend.

## Folder Structure

```
docs/
├── source-of-truth/   Living decision-making docs (gap analyses, audits)
├── guides/            User-facing setup and feature docs
├── plans/             Brainstorming designs and implementation plans
├── archive/           Historical designs, completed plans, research
├── ROADMAP.md         High-level project roadmap
└── README.md          This file
```

## Source of Truth

Living documents that track the current state of the project and drive decisions.

| File | Description |
|------|-------------|
| [IDE-GAPS.md](source-of-truth/IDE-GAPS.md) | IDE feature gap analysis vs VS Code/Zed (15 sections) |
| [UX-AUDIT.md](source-of-truth/UX-AUDIT.md) | UX completeness audit — context menus, status bar, tabs, editor, shortcuts, drag (58 items) |
| [ARCHITECTURE.md](source-of-truth/ARCHITECTURE.md) | System overview, component diagram, data flow |
| [BROWSER-CONTROL.md](source-of-truth/BROWSER-CONTROL.md) | Browser control via native WebView2 bridge |
| [LSP-DESIGN.md](source-of-truth/LSP-DESIGN.md) | LSP integration design, tiers, Zed comparison |

## Guides

How-to docs for getting started and using features.

| File | Description |
|------|-------------|
| [GETTING-STARTED.md](guides/GETTING-STARTED.md) | Dev setup, project structure, Tauri commands, testing |
| [CONFIGURATION.md](guides/CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [VOICE-PIPELINE.md](guides/VOICE-PIPELINE.md) | Voice pipeline: STT (Whisper), TTS (Kokoro/Edge), VAD |
| [THEME-SYSTEM.md](guides/THEME-SYSTEM.md) | Theme presets, color derivation, custom themes |

## Plans

Brainstorming designs and implementation plans for upcoming work.

*Empty — plans will be created here via the brainstorming/writing-plans workflow.*

## Archive

Historical designs, completed plans, and research. Kept for reference.

| File | Description |
|------|-------------|
| [CODE-NAVIGATION-MCP.md](archive/CODE-NAVIGATION-MCP.md) | MCP tool group for voice-first IDE control |
| [CROSS-MODEL-BROWSER-DIALOGUE.md](archive/CROSS-MODEL-BROWSER-DIALOGUE.md) | Cross-model browser dialogue design |
| [DEV-SERVER-DETECTION.md](archive/DEV-SERVER-DETECTION.md) | Dev server auto-detection (implemented) |
| [FOLLOW-AGENT.md](archive/FOLLOW-AGENT.md) | Follow-agent feature design |
| [INSTALLER-PLAN.md](archive/INSTALLER-PLAN.md) | Optional component installation plan |
| [MCP-SERVERS.md](archive/MCP-SERVERS.md) | External MCP server management plan |
| [STT-MODELS.md](archive/STT-MODELS.md) | Speech-to-text model comparison and research |
| [TERMINAL-GAP-ANALYSIS.md](archive/TERMINAL-GAP-ANALYSIS.md) | Terminal feature gap analysis (completed) |
| [UNIFIED-SERVER-PLAN.md](archive/UNIFIED-SERVER-PLAN.md) | Unified server plan (dev servers, MCP, LSP tabs) |
| [VSCODE-TERMINAL-ANALYSIS.md](archive/VSCODE-TERMINAL-ANALYSIS.md) | VS Code terminal system analysis |
| [terminal-scrollbar-minimap.md](archive/terminal-scrollbar-minimap.md) | Terminal scrollbar/minimap design |

## Also See

- [CLAUDE.md](../CLAUDE.md) -- project context for Claude Code AI assistants
- [CONTRIBUTING.md](../CONTRIBUTING.md) -- contributor onboarding guide

## Suggested Reading Order

1. **guides/GETTING-STARTED.md** -- get a dev environment running
2. **source-of-truth/ARCHITECTURE.md** -- system overview: Rust backend, Svelte 5 frontend, Lens workspace
3. **guides/CONFIGURATION.md** -- settings, AI providers, voice engine
4. **guides/VOICE-PIPELINE.md** -- Rust-native STT/TTS/VAD pipeline
5. **source-of-truth/BROWSER-CONTROL.md** -- native WebView2 browser integration
6. **guides/THEME-SYSTEM.md** -- theme presets, color derivation, custom themes
7. **source-of-truth/LSP-DESIGN.md** -- if working on the Lens editor
8. **source-of-truth/IDE-GAPS.md** -- feature gap tracking
9. **source-of-truth/UX-AUDIT.md** -- UX completeness audit
