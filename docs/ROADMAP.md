# Voice Mirror — Roadmap

Known bugs, active work, and planned improvements.

---

## Known Bugs

### Mouse button keybinds block keyboard keys — SEMI-FIXED

**Priority:** Medium (was High)
**Affects:** Windows (pynput keyboard hook)
**Status:** Semi-fixed in Patch 0.7.2

**What was fixed:**
- Bound keyboard keys now pass through to other apps (Discord/OBS-style non-suppression)
- Key-repeat flooding is suppressed during hold
- Dictation auto-cleans the stray character with a queued Backspace
- pynput implicit `None` suppression bug fixed (was blocking ALL keyboard input)

**What remains imperfect:**
- Pressing keyboard "4" while PTT is bound to "4" will still trigger PTT (no way to distinguish source)
- Dictation Backspace cleanup has a 30ms delay — works reliably but is a heuristic
- Mouse buttons 6+ are firmware-mapped to keyboard keys by the mouse hardware. Windows only supports 5 mouse buttons at every API level (`mouhid.sys`, `WH_MOUSE_LL`, Raw Input, `GetAsyncKeyState`). This is an OS limitation, not a Voice Mirror bug

**Perfect fix would require one of:**
- **Interception driver** (kernel-level per-device input filtering, requires reboot) + Keymapper or AutoHotInterception
- **HID Remapper** hardware dongle (~$4 Raspberry Pi Pico, USB-level remapping)
- **Vendor mouse software** (Razer Synapse, Logitech G HUB, etc.) remapping side buttons to F13-F24

**Recommendation for users:** If your mouse vendor software can remap side buttons to F13-F20, do that — zero keyboard conflicts. Voice Mirror's pynput listener already supports F13-F15; F16-F20 support can be added when needed

---

## TODO

### OpenCode MCP dynamic tool loading

**Priority:** High
**Affects:** All OpenCode providers (Kimi, GPT, Gemini, etc.)

Currently OpenCode providers receive the **full MCP toolkit** (58 tools) on startup because the dynamic tool group system (load_tools/unload_tools) isn't configured for OpenCode. Claude Code handles this via profiles that gate which tools are initially loaded, but OpenCode doesn't have the same profile mechanism.

**Impact:** Models like Kimi K2.5 Free get all 58 tool schemas injected into context immediately, wasting tokens and confusing smaller models that can't handle large tool sets.

**Needed:**
- Check [OpenCode docs](https://opencode.ai/docs/config/) for MCP tool filtering/gating options
- Update settings page to allow configuring which MCP tool groups load for OpenCode sessions
- Ensure the meta tools (list_tool_groups, load_tools, unload_tools) work correctly with OpenCode's MCP client
- May need to adjust `mcp-server/index.js` to respect a provider profile or start with minimal tools

**Reference:** Claude Code uses `python/CLAUDE.md` to instruct the agent on dynamic loading. OpenCode uses `AGENTS.md` which documents the groups but can't enforce gating at the protocol level.

---

## Recently Completed

### ghostty-web terminal migration (Feb 2026)

Replaced xterm.js with [ghostty-web](https://github.com/coder/ghostty-web) (Ghostty's VT parser compiled to WASM). Merged to `dev`, feature branch deleted. See `CHANGELOG.md` Patch 0.8.0 for full details.

**Highlights:**
- ghostty-web UMD + async WASM init, FitAddon, SGR mouse events for Bubble Tea TUIs
- Inverted `customKeyEventHandler` semantics handled
- Visual rendering glitch during streaming output fixed
- All dead xterm.js CSS, packages, and references removed
- HTML IDs, JS variables, and function names renamed (`xterm-container` → `terminal-mount`, `initXterm` → `initTerminal`)

### Provider switch stability (Feb 2026)

Stress-tested rapid provider switches (Claude Code → Ollama → OpenCode → back). Fixed three classes of bleed-through:

1. **Terminal garbling** — 4-layer output gating: spawner generation counters, main-process `outputGated` flag, renderer-side generation check, aggressive `clearTerminal()` with canvas wipe
2. **Python TTS crash** — Thread-safe `_play_audio()` with local process reference + `stop_speaking()` before adapter replacement
3. **Notification watcher replay** — Reseed `last_seen_message_id` on provider change to prevent old inbox messages being spoken

---

## Research Archive

### Terminal embedding alternatives to xterm.js

**Status:** Resolved — ghostty-web shipped in Patch 0.8.0, xterm.js fully removed.

**Research findings (Feb 2026):**

#### Option A: ghostty-web (shipped)

[ghostty-web](https://github.com/coder/ghostty-web) by Coder — Ghostty's terminal emulation compiled to WASM, packaged as an xterm.js-compatible drop-in replacement. v0.4.0 on npm.

- **xterm.js-compatible API** — same `Terminal`, `FitAddon`, `WebglAddon` interface
- **Ghostty's VT parser** — better escape sequence handling, better Bubble Tea / TUI rendering
- **WASM performance** — parser runs in WASM, rendering uses canvas
- **Resolved issues:** Wheel events workaround in place, visual rendering artifacts fixed, provider switch gating added

#### Option B: xterm.js v6 (shelved)

xterm.js v6 adds synchronized output via DEC private mode 2026. Shelved — ghostty-web solved the rendering issues without waiting for v6.

#### Option C: libghostty WASM (future, ~mid-2026+)

Ghostty's core library with full GPU rendering in-browser. Not yet available. Would be the most complete solution but timeline is uncertain. Current ghostty-web works well enough that this isn't blocking.
