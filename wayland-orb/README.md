# wayland-orb/

Native Wayland overlay that renders a 64px draggable orb using `wlr-layer-shell`. Linux-only companion to the Electron app for compositors that don't support transparent Electron overlays (Hyprland, Sway, etc.).

## Protocol

Communicates with Electron via newline-delimited JSON over stdin/stdout.

### Messages from Electron

| Type | Fields | Description |
|------|--------|-------------|
| `SetState` | `state` | Set orb state: `Idle`, `Recording`, `Speaking`, `Thinking` |
| `Show` | -- | Show the overlay |
| `Hide` | -- | Hide the overlay |
| `SetSize` | `size` | Resize the orb (pixels) |
| `SetPosition` | `x`, `y` | Move the orb |
| `SetOutput` | `name` | Move to a specific monitor |
| `ListOutputs` | -- | Request available monitors |
| `Quit` | -- | Exit the process |

### Messages to Electron

| Type | Fields | Description |
|------|--------|-------------|
| `Ready` | -- | Orb is initialized and visible |
| `ExpandRequested` | -- | User clicked (not dragged) the orb |
| `PositionChanged` | `x`, `y` | Orb was dragged to a new position |
| `OutputList` | `outputs` | List of available monitors |
| `Error` | `message` | Error description |

## Dependencies

- `smithay-client-toolkit` 0.19 -- Wayland client abstractions + layer-shell
- `tiny-skia` 0.11 -- software 2D rendering
- `serde` / `serde_json` -- JSON IPC
- `calloop` 0.13 -- event loop

## Building

```bash
cd wayland-orb
cargo build --release
# Binary: target/release/wayland-orb
```

Accepts `--output <name>` to target a specific monitor.
