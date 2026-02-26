# Pixel Agents Integration — Scoping Document

**Date:** 2026-02-26
**Status:** Scoping (not yet planned for implementation)
**Source repo:** [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT)
**Local clone:** `E:\Projects\references\Pixel Agents\`

## Overview

Integrate pixel-agents — an animated pixel-art office visualization of AI agent activity — into Voice Mirror's Lens workspace. Characters sit at desks, type when the AI is working, read when it's analyzing, and idle when waiting. Voice Mirror extends the concept with **speaking and listening animations** driven by the voice pipeline.

The visualization lives in the bottom-left placeholder slot created by the layout refactor (`f34136f4`).

## What Pixel-Agents Does

A VS Code extension that:
1. Watches Claude Code's JSONL transcript files (`~/.claude/projects/{hash}/{session}.jsonl`)
2. Parses tool invocations (Read, Write, Bash, etc.) from JSONL records
3. Maps tool activity to character animation states (idle → walk → type/read)
4. Renders an isometric pixel-art office via Canvas 2D with BFS pathfinding
5. Supports sub-agent spawning (Task tool → additional characters)

**Tech stack:** React 19 webview + Canvas 2D engine + TypeScript. No external graphics libraries.

## The Signal Problem

Pixel-agents expects structured JSONL transcripts. Voice Mirror has two AI provider types with different signal characteristics:

### API Providers (OpenAI, Ollama, Groq)

Structured Tauri events — clean mapping to character states:

| Event | Payload | Character State |
|-------|---------|-----------------|
| `ai-stream-token` | `{ token }` | Typing (tokens flowing) |
| `ai-stream-end` | `{ text }` | Idle (response complete) |
| `ai-tool-calls` | `{ calls: [{ name, args }] }` | Typing or Reading (by tool name) |
| `ai-response` | `{ text }` | Speaking (triggers TTS) |
| `ai-error` | `{ error }` | Error state |
| `ai-status-change` | `{ running }` | Spawn/despawn character |

### CLI Providers (Claude Code via PTY)

Raw terminal output only — no structured tool events:

| Event | Payload | Problem |
|-------|---------|---------|
| `ai-output` | `{ type: "stdout", text }` | ANSI escape codes, TUI rendering. No tool names, no structure. |
| `ai-status-change` | `{ running }` | Only start/stop, no granularity. |

**Solution:** Use JSONL sidecar watching for CLI providers. Claude Code writes JSONL transcripts to `~/.claude/projects/` regardless of how it's launched. We can watch these files the same way pixel-agents does — this is proven, well-understood code we can adapt directly from `transcriptParser.ts` and `fileWatcher.ts`.

### Voice Pipeline (Voice Mirror exclusive)

New character states not in the original pixel-agents:

| Event | Payload | Character State |
|-------|---------|-----------------|
| `voice-event` → `speaking_start` | — | Speaking animation (speech bubble) |
| `voice-event` → `speaking_end` | — | Return to idle |
| `voice-event` → `state_change: recording` | — | Listening animation (head tilt / ear cup) |
| `voice-event` → `state_change: processing` | — | Thinking animation |

## Character State Machine

Extended from pixel-agents' original 3 states to 6:

```
                    ┌──────────┐
        spawn ──────│  Walk    │──────── arrive at desk
                    └──────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │  Type  │ │  Read  │ │  Idle  │
         └────────┘ └────────┘ └────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │ Speak  │ │ Listen │ │  Think │   ◄── NEW (Voice Mirror)
         └────────┘ └────────┘ └────────┘
```

**State transitions:**
- **Spawn** → Walk to nearest free desk
- **Tool start (write-type)** → Type (2-frame hand animation)
- **Tool start (read-type)** → Read (static seated frame)
- **No activity for N seconds** → Idle (stand, wander)
- **TTS playback** → Speak (speech bubble with animated dots)
- **VAD recording** → Listen (visual ear/attention indicator)
- **Between user message and first token** → Think (head scratch or loading dots)
- **Provider exit** → Walk away → despawn (matrix dissolve effect)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri Events                                    │
│  ai-stream-token, ai-tool-calls, ai-output,     │
│  ai-status-change, voice-event                   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Activity Adapter Store                          │
│  pixel-agents.svelte.js                          │
│                                                  │
│  - Listens to Tauri events                       │
│  - API provider: direct event mapping            │
│  - CLI provider: JSONL sidecar watcher           │
│  - Voice pipeline: speaking/listening states      │
│  - Emits normalized character state updates       │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Canvas Engine (ported from pixel-agents)         │
│                                                  │
│  officeState.ts  — game state, character mgmt    │
│  characters.ts   — state machine, pathfinding    │
│  renderer.ts     — Canvas 2D drawing, sprites    │
│  gameLoop.ts     — requestAnimationFrame loop    │
│  tileMap.ts      — BFS pathfinding, walkability  │
│  spriteData.ts   — character & furniture sprites │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  PixelAgents.svelte                              │
│  (replaces React OfficeCanvas.tsx)               │
│                                                  │
│  - Mounts in .placeholder-area                   │
│  - Canvas element + ResizeObserver               │
│  - Mouse handling (zoom, pan)                    │
│  - Connects adapter store → engine               │
└─────────────────────────────────────────────────┘
```

## What to Fork vs Rewrite vs Create

### Fork and adapt (~3,900 lines, framework-agnostic Canvas code)

| File | Lines | Notes |
|------|-------|-------|
| `engine/officeState.ts` | 677 | Replace VS Code message handling with our adapter store |
| `engine/renderer.ts` | 608 | Add speaking/listening sprite rendering |
| `engine/characters.ts` | 303 | Add speaking/listening/thinking states |
| `engine/gameLoop.ts` | 38 | Copy as-is |
| `engine/matrixEffect.ts` | ~100 | Copy as-is (spawn/despawn effect) |
| `layout/tileMap.ts` | 105 | Copy as-is |
| `layout/layoutSerializer.ts` | 330 | Copy as-is |
| `layout/furnitureCatalog.ts` | 303 | Copy as-is |
| `sprites/spriteData.ts` | 1122 | Add speaking/listening sprite frames |
| `sprites/spriteCache.ts` | ~100 | Copy as-is |

### Rewrite (React → Svelte 5)

| Original | New | Notes |
|----------|-----|-------|
| `OfficeCanvas.tsx` (~300 lines) | `PixelAgents.svelte` | Canvas mount, resize, mouse/zoom |
| `useExtensionMessages.ts` (~300 lines) | `pixel-agents.svelte.js` | Event adapter (Tauri events, not VS Code messages) |
| `AgentLabels.tsx` | Inline in PixelAgents.svelte | Character name labels (DOM overlay on canvas) |
| `ZoomControls.tsx` | Inline or skip | Zoom +/- buttons |

### Create new (Voice Mirror original)

| Component | Purpose |
|-----------|---------|
| **JSONL sidecar watcher** (Rust command) | Watch `~/.claude/projects/` for CLI provider JSONL files. Adapt from pixel-agents' `fileWatcher.ts` + `transcriptParser.ts`. Emit Tauri events with parsed tool activity. |
| **Speaking sprite frames** | New pixel art frames: character with speech bubble, animated dots |
| **Listening sprite frames** | New pixel art frames: character with visual attention indicator |
| **Thinking sprite frames** | New pixel art frames: character scratching head or loading dots |
| **Activity adapter store** | Svelte 5 store bridging Tauri events → canvas engine character states |

## JSONL Sidecar Watcher

For CLI providers, we watch the same transcript files pixel-agents uses. Implementation options:

**Option A: Rust-side file watcher (recommended)**
- New Tauri command: `start_agent_transcript_watcher(session_id)`
- Watches `~/.claude/projects/{hash}/{session_id}.jsonl`
- Parses JSONL lines (same logic as `transcriptParser.ts`)
- Emits `pixel-agent-activity` Tauri events with `{ tool_name, status, agent_id }`
- Stops when CLI provider exits

**Option B: Frontend-side polling**
- Read JSONL file periodically via `invoke('read_file')`
- Parse in JavaScript
- Simpler but adds latency and IPC overhead

Option A keeps parsing in Rust (fast, no IPC overhead for each line) and matches our pattern of backend event emission.

## Default Layout

Pixel-agents ships with a customizable office layout. For Voice Mirror's small placeholder area, we'd use a simplified default:

- **Small office:** 8×6 tile grid (vs pixel-agents' larger default)
- **1-2 desks** with chairs (one per active provider)
- **Minimal furniture** — a plant, maybe a coffee machine
- **No layout editor** initially (defer to Phase 4)

The placeholder area is roughly 200-300px wide × 150-200px tall. At 16px per tile with 2x zoom, that's ~8-10 tiles visible. Cozy office.

## Phases

### Phase 1: MVP — Single Character + API Provider (~2-3 sessions)

- Port Canvas engine (officeState, renderer, characters, gameLoop)
- Port sprite data, tile map, layout serializer
- Create `PixelAgents.svelte` wrapper
- Create `pixel-agents.svelte.js` adapter store
- Wire API provider events (stream-token → typing, stream-end → idle, tool-calls → reading)
- Default small office layout
- Single character (one AI agent)

### Phase 2: CLI Provider Support (~1-2 sessions)

- Build JSONL sidecar watcher (Rust command)
- Parse tool invocations from transcripts
- Map tool names to character states (Write/Edit/Bash → typing, Read/Grep/Glob → reading)
- Detect sub-agent spawns from Task tool records

### Phase 3: Voice Animations (~1-2 sessions)

- Design speaking/listening/thinking sprite frames
- Add new character states to state machine
- Wire `voice-event` → character speaking/listening
- Speech bubble rendering (animated dots during TTS)
- Listening indicator (visual attention cue during recording)

### Phase 4: Polish (~1-2 sessions)

- Layout editor (tile painting, furniture placement)
- Multi-agent support (multiple characters for sub-agents)
- Character color customization
- Layout persistence to Voice Mirror config
- Zoom/pan controls in the small panel
- Sound effects (optional, keyboard clicking, etc.)

## Dependencies

**No new npm packages required.** The entire engine is vanilla Canvas 2D.

**Rust dependencies (Phase 2 only):**
- `notify` crate (we may already have this for file watcher) — or reuse our existing `file_watcher.rs` service
- JSONL parsing is just `serde_json::from_str` per line

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Small panel size limits visibility | Start with 2x zoom, allow zoom gestures. Minimal furniture. |
| Canvas rendering performance | Game loop already uses `requestAnimationFrame` with delta time. 16×16 sprites are trivial to render. |
| JSONL file location varies | Claude Code uses `~/.claude/projects/{hash}/` — we need to hash the project path the same way. Check pixel-agents' `constants.ts` for the algorithm. |
| Sprite art quality for new states | Start with simple modifications of existing frames (add speech bubble overlay, tint changes). Full pixel art redesign can come later. |
| CLI provider may not write JSONL | If Claude Code is launched in a non-standard way, JSONL may not appear. Fall back to simple active/idle based on `ai-output` flow. |

## Prior Art Comparison

| Feature | Pixel-Agents (VS Code) | Voice Mirror (Planned) |
|---------|----------------------|----------------------|
| Agent tracking | JSONL transcripts only | JSONL + API events + voice events |
| Character states | 3 (idle, walk, type/read) | 6 (+ speak, listen, think) |
| Voice awareness | None | Speaking, listening, thinking animations |
| Platform | VS Code webview | Tauri 2 native window |
| Framework | React 19 | Svelte 5 |
| Multi-agent | Sub-agent spawning via Task tool | Same + multiple API providers |
| Layout | Large office, full editor | Small cozy office, simplified |
| Persistence | `~/.pixel-agents/layout.json` | Voice Mirror config system |
