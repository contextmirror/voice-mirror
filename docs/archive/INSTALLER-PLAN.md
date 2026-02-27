# Installer Plan

## Current State

Tauri 2 builds platform-specific installers via `release.yml`:
- **Windows:** NSIS installer (`.exe`)
- **macOS:** DMG (`.dmg`)
- **Linux:** AppImage (`.AppImage`) + Debian (`.deb`)

Config: `src-tauri/tauri.conf.json` > `bundle` section.

## Core App (Always Installed)

- Voice Mirror binary (Rust/Tauri)
- Whisper ONNX model (`ggml-base.en.bin`) for STT
- Kokoro TTS engine
- MCP server binary
- Frontend assets (Svelte/Vite bundle)

## Optional Components

### Language Servers (LSP)

Voice Mirror's Lens editor auto-detects language servers on PATH. These could be offered as optional installs during setup:

| Server | Package | Languages | Install Command |
|--------|---------|-----------|----------------|
| rust-analyzer | rustup component | Rust | `rustup component add rust-analyzer` |
| typescript-language-server | npm global | JS/TS | `npm i -g typescript-language-server typescript` |
| vscode-langservers-extracted | npm global | CSS/HTML/JSON | `npm i -g vscode-langservers-extracted` |
| pyright | npm global / pip | Python | `npm i -g pyright` |
| marksman | GitHub release | Markdown | Manual download |

**Dependencies:** npm-based servers require Node.js on the user's machine. The installer should detect if Node.js is available before offering these options.

**UX:** Checkboxes in the installer, all unchecked by default. Tooltip explains what each provides. If Node.js is not found, grey out npm-based options with "Requires Node.js" hint.

### AI Providers

- **Claude Code CLI** — required for CLI provider mode
- **OpenCode CLI** — alternative CLI provider

### Voice Models

- **Whisper models** — base (default), small, medium, large (user picks quality vs speed)
- **Kokoro voices** — additional voice packs beyond the default

### Automation

- **n8n** — workflow automation engine (optional integration)

## Platform-Specific Notes

### Windows (NSIS)

- NSIS supports custom pages with checkboxes for optional components
- Can run shell commands during install (e.g., `npm i -g`)
- Need `CREATE_NO_WINDOW` flag to prevent console flashing during installs
- Consider adding to PATH if needed

### macOS (DMG)

- Post-install script can run `brew install` or direct downloads
- Or provide a "Setup Assistant" on first launch instead of during install

### Linux (AppImage/Deb)

- Deb can declare `Recommends:` for optional deps
- AppImage is self-contained; first-launch setup wizard is better here

## First-Launch Setup Wizard (Alternative)

Instead of (or in addition to) installer checkboxes, a first-launch wizard could:

1. Scan PATH for available tools (language servers, CLI providers, Node.js)
2. Show what's detected vs what's missing
3. Offer one-click install for missing components
4. Let user skip — everything works without optional components

This approach works across all platforms and doesn't require platform-specific installer customization.

## Implementation Priority

1. **v1:** Auto-detection only (current state) — servers found on PATH just work
2. **v2:** First-launch setup wizard — scan and offer installs
3. **v3:** Platform-specific installer integration (NSIS custom pages, etc.)
