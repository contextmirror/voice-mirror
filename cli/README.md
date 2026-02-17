# cli/

Setup wizard, health checker, and app launcher for Voice Mirror. Built with [commander](https://www.npmjs.com/package/commander) for CLI parsing and [@clack/prompts](https://www.npmjs.com/package/@clack/prompts) for interactive TUI flows.

## Commands

```bash
voice-mirror setup       # Interactive onboarding wizard (default if no command given)
voice-mirror doctor      # Check system health and dependencies
voice-mirror start       # Launch Voice Mirror (optionally with --dev)
```

### `setup`

Walks users through first-time configuration: AI provider selection, Ollama installation/model pulling, voice-core binary check, and config file generation. Supports `--non-interactive` mode with flags for CI/scripted installs.

### `doctor`

Runs all system checks (Node version, voice-core binary, Ollama, Claude CLI, ffmpeg, MCP server deps) and prints a pass/fail summary. Exits with code 1 if any issues are found.

### `start`

Delegates to `npm start` in the project root. Pass `--dev` for development mode.

## Modules

| File | Purpose |
|------|---------|
| `index.mjs` | CLI entry point, command registration (commander) |
| `setup.mjs` | Interactive onboarding wizard (@clack/prompts) |
| `doctor.mjs` | System health checks with pass/fail output |
| `checks.mjs` | Detection utilities (voice-core, Ollama, Claude CLI, etc.) |
| `ollama-setup.mjs` | Ollama detection, installation, and model pulling |
| `python-setup.mjs` | MCP deps, Chromium, and ffmpeg helpers |
| `banner.mjs` | ASCII banner and version display |
