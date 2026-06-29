# docs/

Project documentation for Voice Mirror.

> **Voice Mirror** is a voice-native IDE built on **Tauri 2** (Rust backend, Svelte 5 frontend). You build apps and websites by voice, watch them render live in an in-app App Preview, and the in-app AI can see and drive the running app. The **Lens workspace** combines a CodeMirror editor with LSP, a file tree, a live browser/app preview, an integrated terminal, and dev-server management. The launch is **Windows-first** — the live App Preview, native-app driving, and push-to-talk are Windows-only for v1. The `src-tauri/` directory holds the Rust backend; `src/` the Svelte frontend.

## Folder Structure

```
docs/
├── source-of-truth/   Living decision-making docs (architecture, audits, gap analyses)
├── guides/            User- and contributor-facing setup and feature docs
├── implementation/    Design notes for implemented subsystems
├── internal/          Internal roadmaps and launch tracking
├── archive/           Historical designs and completed-plan specs
├── ROADMAP.md         High-level project roadmap
├── CODE-AUDIT.md      Codebase audit notes
└── README.md          This file
```

## Source of Truth

Living documents that track the current state of the project and drive decisions.

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](source-of-truth/ARCHITECTURE.md) | System overview, component diagram, data flow |
| [BROWSER-CONTROL.md](source-of-truth/BROWSER-CONTROL.md) | Browser/app control via the native WebView2 bridge |
| [IDE-GAPS.md](source-of-truth/IDE-GAPS.md) | IDE feature gap analysis vs VS Code / Zed |
| [UX-AUDIT.md](source-of-truth/UX-AUDIT.md) | UX completeness audit — context menus, status bar, tabs, editor, shortcuts |
| [LSP-GAP.md](source-of-truth/LSP-GAP.md) | LSP feature gap tracking |
| [LSP-WIRING-AUDIT.md](source-of-truth/LSP-WIRING-AUDIT.md) | Audit of how LSP is wired through the Lens editor |
| [AUDIT-TRACKER.md](source-of-truth/AUDIT-TRACKER.md) | Cross-audit tracker / status roll-up |

## Guides

How-to docs for getting started and using features.

| File | Description |
|------|-------------|
| [GETTING-STARTED.md](guides/GETTING-STARTED.md) | Dev setup, project structure, commands, testing |
| [CONFIGURATION.md](guides/CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [VOICE-PIPELINE.md](guides/VOICE-PIPELINE.md) | Voice pipeline: STT (Whisper), TTS (Kokoro / Edge), VAD |
| [THEME-SYSTEM.md](guides/THEME-SYSTEM.md) | Theme presets, color derivation, custom themes |

## Implementation

Design notes for subsystems that have been built.

| File | Description |
|------|-------------|
| [LSP-DESIGN.md](implementation/LSP-DESIGN.md) | LSP integration design, tiers, and Zed comparison |

## Internal

Roadmaps and launch tracking maintained by the core team.

| File | Description |
|------|-------------|
| [LAUNCH-READINESS.md](internal/LAUNCH-READINESS.md) | Windows-first public launch readiness tracking |
| [PREVIEW-LIFECYCLE.md](internal/PREVIEW-LIFECYCLE.md) | Live App Preview lifecycle architecture & roadmap |

## Archive

Historical design specs kept for their non-obvious rationale (WGC/D3D11 window capture, the MCP handshake, WebView2 download/inspector gotchas, Python dev-server/venv detection, async-command performance, workspace-state persistence, LSP gap-closure) plus older scoping notes. Completed step-by-step implementation plans were removed once shipped; the surviving specs hold knowledge worth keeping. Browse the directory for the full set.

## Also See

- [../README.md](../README.md) — project landing page and quick start
- [../CLAUDE.md](../CLAUDE.md) — project context for AI assistants
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contributor onboarding guide
- [ROADMAP.md](ROADMAP.md) — high-level roadmap

## Suggested Reading Order

1. **guides/GETTING-STARTED.md** — get a dev environment running
2. **source-of-truth/ARCHITECTURE.md** — system overview: Rust backend, Svelte 5 frontend, Lens workspace
3. **guides/CONFIGURATION.md** — settings, AI providers, voice engine
4. **guides/VOICE-PIPELINE.md** — the Rust-native STT/TTS/VAD pipeline
5. **source-of-truth/BROWSER-CONTROL.md** — native WebView2 browser/app integration
6. **internal/PREVIEW-LIFECYCLE.md** — how the live App Preview tracks and drives the running app
7. **implementation/LSP-DESIGN.md** — if working on the Lens editor
8. **source-of-truth/IDE-GAPS.md** + **source-of-truth/UX-AUDIT.md** — feature and UX gap tracking
