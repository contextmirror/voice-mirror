# Voice Mirror — Roadmap

Voice Mirror is a voice-controlled AI agent IDE for your desktop. It starts as an always-on-top overlay with an embedded AI-native code editor, browser, and terminal — then grows into a cross-platform server and mobile app.

---

## Where We Are Now (v0.1.x, February 2026)

Voice Mirror is a fully functional AI-native IDE built on **Tauri 2 + Rust + Svelte 5**:

- **116 Rust commands** across 14 backend modules
- **63 Svelte components**, 18 reactive stores, 102 API wrappers
- **50 MCP tools** (browser control, memory, n8n, capture)
- **4100+ JS tests**, cargo check clean
- **Voice pipeline**: Whisper STT (CUDA GPU), Kokoro TTS, energy VAD
- **Lens workspace**: CodeMirror 6 editor, file tree, terminal (ghostty-web WASM), browser preview (native WebView2), split editor, command palette (48 commands), LSP Tier 1 (12/29 features)
- **Design mode**: Element capture with hidden context, parent chain, pseudo-class CSS extraction
- **MCP binary**: Separate Rust binary, stdio JSON-RPC, named pipe IPC

See `docs/source-of-truth/IDE-GAPS.md` for detailed feature comparison vs VS Code / Zed / Cursor.

---

## Near-Term: IDE Completeness

Features that close the remaining gaps between Lens and a "real IDE."

### Run / Build System
One-click Run button in the toolbar. Auto-detects project type (`package.json` → npm, `Cargo.toml` → cargo, `pyproject.toml` → python, etc.) and runs the appropriate command in the terminal. Triggered by button click OR voice ("run it"). Output goes to the existing ghostty-web terminal.

### Layout Refactor (VS Code-Style Terminal)
Move the terminal from a full-width bottom panel into the center column, stacked below the editor/preview:

```
| Chat |   Editor/Preview   | File Tree |
|      |--------------------|           |
|      |     Terminal        |           |
```

This aligns with VS Code's layout and frees the bottom area for new panels.

### Spreadsheet Support
Open `.xlsx` / `.csv` files from the file tree in a web-based spreadsheet viewer (SheetJS + Handsontable or Luckysheet) rendered in the browser preview. Claude Code reads the raw data via MCP tools AND sees the spreadsheet visually via screenshot capture. Users speak edits: "Make column B bold", "Sum up Q4 revenue."

### Pixel Agents (Visual AI Agent Monitor)
Integrate [pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT) — pixel art characters representing active AI agents in a virtual office canvas. Characters animate based on real agent activity (reading files, writing code, running commands). Reads Claude Code's JSONL transcripts for activity state. Lives in the bottom panel alongside the terminal.

### Remaining IDE Gaps
From `IDE-GAPS.md`:

| Feature | Status | Priority |
|---------|--------|----------|
| Workspace symbols (cross-project search) | Not started | Medium |
| Inlay hints (inline type annotations) | Not started | Medium |
| Persist split editor layout | Not started | Medium |
| Terminal search (Ctrl+Shift+F in scrollback) | Not started | Low |
| Breadcrumbs | Not started | Low |
| Clickable links/file paths in terminal | Not started | Low |
| Debug adapter (DAP) | Not started | Low — AI handles this |

### Select Element v3
Ideas from real-world testing (see `docs/plans/2026-02-26-select-element-v2-design.md`):

- **Accessibility attributes** — capture `aria-*`, `role`, `tabindex`, `alt`, `lang`
- **Responsive breakpoints** — scan `@media` rules matching the selected element
- **Adopted stylesheets** — check `document.adoptedStyleSheets` for CSS-in-JS (closes the Stripe gap)
- **Transition/animation capture** — add `transition`, `animation`, `transform`, `will-change` to computed styles
- **Hover state diff** — programmatically trigger hover, compare computed styles before/after

---

## Medium-Term: Voice & Automation Platform

### Custom Wake Word — "Mirror"
Replace provider-specific wake words with a custom **"Mirror"** keyword. Train a small ONNX model (~500KB) using OpenWakeWord's training pipeline with synthetic + real samples. Provider-agnostic identity.

### Embedded n8n Dashboard
Bring n8n's workflow automation directly into Voice Mirror. Users build workflows by voice ("Create a workflow that monitors my email for invoices"), trigger them by voice ("Send the weekly report"), and set reminders ("Wake me up at 8am with traffic"). n8n dashboard embedded in the browser preview. Webhook listener in the Rust backend receives callbacks and triggers TTS.

See the detailed plan in the previous ROADMAP version for n8n implementation phases (detection, auto-start, auto-navigate, setup wizard, starter templates).

---

## Long-Term: Cross-Platform

### Phase 2: Voice Mirror Server
Run Voice Mirror as a standalone HTTP server. Access the full dashboard from `localhost:3333` in any browser. The Rust backend compiles as either a Tauri desktop app or a headless `axum` server — same logic, different transport (`invoke()` vs WebSocket/REST).

### Phase 3: Remote Access
- **LAN**: Bind to `0.0.0.0`, access from phone/tablet on the same network
- **Internet**: Cloudflare Tunnel / Tailscale integration, auth tokens
- **Multi-client**: Real-time state sync via WebSocket broadcast

### Phase 4: Mobile App
Thin client connecting to the Voice Mirror server. PWA first (responsive chat UI, push notifications, MediaRecorder for voice input), native Tauri Mobile later if needed. n8n reminders deliver via push notifications.

### Phase 5: Cloud Deployment
`docker run -p 3333:3333 voice-mirror` — hosted service with GPU for STT/TTS, user accounts, BYOK (bring your own API keys). Depends on demand.

---

## Execution Priority

```
Now         IDE completeness (run button, layout refactor, spreadsheet, pixel agents)
Near        Select Element v3, remaining IDE gaps from IDE-GAPS.md
Medium      Custom wake word, n8n dashboard
Later       Server mode, remote access, mobile app
Future      Cloud deployment
```

IDE completeness is the current focus — making Lens comfortable enough that users don't need to leave Voice Mirror for any coding task. The voice + AI features are already the differentiator; the IDE features are table stakes.

---

## Non-Goals

- **VS Code extension marketplace** — MCP servers are Voice Mirror's extension model
- **Node.js runtime** — pure Rust backend, no Node.js at runtime
- **Run voice processing on mobile** — phone is a thin client, STT/TTS stays on server
- **Support Electron codebase** — fully retired, Tauri 2 is the only codebase
