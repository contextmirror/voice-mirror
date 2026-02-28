# Device Preview — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan from this design.

**Goal:** Add a SwiftUI-style multi-device preview panel to Lens, showing your web app rendered across real device viewports (phones, tablets, desktops) side-by-side with the code editor.

**Architecture:** Each device is a real WebView2 child window rendered at native device dimensions, CSS-scaled to fit the preview pane. Interaction sync (scroll, click, input) broadcasts events across all active devices via injected JS + Rust coordinator.

**Tech Stack:** Svelte 5 (frontend components + stores), Rust/Tauri (WebView2 instance management, sync coordinator), CSS transforms (scaled rendering), modular device preset registry.

---

## 1. UI & Layout

### Activation

A **phone icon button (📱)** in the editor pane's top toolbar strip, next to the existing split view button. This button is a pure toggle — open/close the device preview pane.

### Layout When Active

```
┌─ [ Browser | mod.rs ]                     [ 📱 ] [ ⊞ ] ─┐
│                         │                                 │
│    Editor               │   ┌──────┐    ┌──────┐        │  File Tree
│                         │   │iPhone│    │Pixel │        │  (far right,
│    code here...         │   │ 15   │    │  8   │        │   unchanged)
│                         │   │      │    │      │        │
│                         │   └──────┘    └──────┘        │
│                         │                                │
│                         │  ┌──────────────────┐         │
│                         │  │    iPad Air      │         │
│                         │  └──────────────────┘         │
│                         ├────────────────────────────────┤
│                         │ [iPhone 15 ✕][iPad ✕][+] 🔄    │ ← control strip
├─────────────────────────┴────────────────────────────────┤
│  Voice Agent | Output | Terminal                          │
└──────────────────────────────────────────────────────────┘
```

- **Editor** stays on the left, fully functional
- **Device Preview** opens as a right-side split pane (using existing SplitPanel)
- **File tree** stays on the far right — click files to open in editor
- **Chat panel auto-collapses** when device preview opens (re-expands on close)
- **Terminal** stays at the bottom, unchanged

### First-Open Flow

1. Click 📱 → split pane opens with empty state + control strip at bottom
2. Control strip shows: `[+] 🔄`
3. Empty state message: "No devices selected — Click + to add devices"
4. Click [+] → device picker dropdown opens upward from the strip
5. Pick devices → they render in the pane above
6. Strip updates: `[iPhone 15 ✕] [iPad Air ✕] [+] 🔄`

### Control Strip (Bottom of Preview Pane)

Thin strip sitting just above the terminal divider:
- **Device chips** with ✕ to remove each device
- **[+] button** to open device picker and add more
- **🔄 Orientation toggle** (portrait/landscape for all devices)
- **URL indicator** (auto-detected from dev server, editable)
- **Sync toggle** (enable/disable interaction sync)

### Closing

Click the 📱 button again → all device WebView2s destroyed, pane closes, editor goes full-width, chat re-expands.

---

## 2. Device Catalog

### Modular Registry

All device presets live in a single file: `src/lib/device-presets.js`. Adding a new device = adding one object to an array.

```js
export const DEVICE_PRESETS = [
  {
    id: 'iphone-15',
    name: 'iPhone 15',
    category: 'iPhone',
    width: 393,
    height: 852,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)...',
  },
  // ...
];
```

### Built-in Presets (~28 devices)

| Category | Devices | Viewport Range |
|----------|---------|----------------|
| **iPhone** | SE (3rd gen), 14, 15, 15 Pro, 15 Pro Max, 16, 16 Pro, 16 Pro Max | 375×667 → 430×932 |
| **iPad** | Mini (6th), Air (M2), Pro 11", Pro 13" | 744×1133 → 1032×1376 |
| **Android Phone** | Pixel 8, Pixel 8 Pro, Galaxy S24, Galaxy S24 Ultra, Galaxy Z Fold (folded), Galaxy Z Fold (open) | 360×780 → 412×915 |
| **Android Tablet** | Galaxy Tab S9, Pixel Tablet | 800×1280 → 1200×2000 |
| **Desktop** | Laptop (1366×768), Full HD (1920×1080), 2K (2560×1440) | standard |
| **Custom** | User-defined | any |

### User Custom Devices

Saved to config (`config.devicePreview.customDevices`). Merged with built-in presets at runtime. Shown in "Custom" category group in the picker.

### Device Picker Menu

Dropdown that opens upward from the [+] button:
- Grouped by category with section headers
- Checkboxes for multi-select
- Shows current selection count
- Enforces max 5 simultaneous devices
- "Custom size..." option at the bottom to define ad-hoc dimensions

---

## 3. Rendering

### Real WebView2 Instances

Each active device is a **separate native WebView2 child window**:
- Created at real device dimensions (e.g. 393×852 for iPhone 15)
- Positioned inside the DevicePreview pane's bounds
- CSS `transform: scale()` applied to shrink to fit available space
- Scale factor auto-calculated from pane size and device count

### Scaled Layout

The device grid arranges devices responsively:
- 1 device: centered, large scale
- 2 devices: side-by-side
- 3-5 devices: grid layout, smaller scale
- Pane is scrollable if devices exceed vertical space

### Device Frame

Each device shows:
- The scaled WebView2 content
- A label below: "iPhone 15 — 393×852"
- Optional: thin border to visually separate from background

### Max 5 Simultaneous Devices

Hard limit to keep memory/performance reasonable. The picker enforces this — the [+] button is disabled at 5.

---

## 4. Interaction Sync

### Mechanism

1. Each WebView2 gets a **sync script** injected on page load
2. Script listens for `scroll`, `click`, `input`, `keydown` events on the originating device
3. Events sent to Rust via JS eval polling or `lens-shortcut` scheme
4. Rust **broadcasts** event data to all other device WebView2 instances via `evaluate_js`
5. Receiving instances replay the event

### Sync Strategies

| Event | Strategy |
|-------|----------|
| **Scroll** | By percentage (0.0–1.0), not pixels. Different viewport heights produce same relative position. |
| **Click** | By CSS selector of clicked element. Same element clicked on all devices regardless of position. |
| **Input/keydown** | Replay keystroke to currently focused element on each device. |
| **Navigation** | URL change on one device navigates all others. |

### Performance

- Scroll events debounced to 16ms (60fps cap)
- Click/input events fire immediately (low frequency)
- Sync toggle on the control strip lets users disable when interacting independently

---

## 5. Technical Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/device-presets.js` | Device catalog registry (~28 built-in presets) |
| `src/lib/stores/device-preview.svelte.js` | Reactive store: active devices, orientation, sync state, URL |
| `src/components/lens/DevicePreview.svelte` | Main preview pane — device grid with scaled WebView2 containers |
| `src/components/lens/DevicePreviewStrip.svelte` | Bottom control strip — device chips, [+], orientation, sync toggle |
| `src/components/lens/DevicePickerMenu.svelte` | Dropdown menu from [+] — categorized device list with checkboxes |

### Modified Files

| File | Change |
|------|--------|
| `LensWorkspace.svelte` | Add DevicePreview split pane, toggle logic, chat auto-collapse |
| `TabBar.svelte` or `EditorPane` toolbar | Add 📱 button to toolbar strip |
| `src-tauri/src/commands/lens.rs` | New commands for device preview WebView2 lifecycle |
| `src/lib/api.js` | Add invoke wrappers for new commands |
| `src/lib/stores/config.svelte.js` | Add `devicePreview` config section |
| `src-tauri/src/config/schema.rs` | Add `DevicePreviewConfig` struct |

### Rust Commands (New)

| Command | Purpose |
|---------|---------|
| `lens_create_device_webview` | Create a WebView2 at specific device dimensions + position |
| `lens_close_device_webview` | Destroy a single device WebView2 |
| `lens_close_all_device_webviews` | Destroy all device WebView2s |
| `lens_resize_device_webview` | Reposition/rescale a device WebView2 |
| `lens_inject_sync_script` | Inject interaction sync JS into a device WebView2 |
| `lens_broadcast_sync_event` | Relay sync event to all device WebView2s except origin |

### Data Flow

**Opening preview:**
```
Click 📱 → LensWorkspace.devicePreviewOpen = true → chat collapses
  → SplitPanel renders [Editor | DevicePreview]
  → DevicePreview shows empty state + control strip
```

**Adding a device:**
```
Click [+] → pick iPhone 15
  → devicePreviewStore.addDevice('iphone-15')
  → api.lensCreateDeviceWebview({ id, url, width, height, x, y, scale })
  → Rust creates WebView2, positions it, navigates to URL
  → Injects sync script
  → Device renders in the grid
```

**Interaction sync:**
```
Scroll on iPhone 15 WebView2
  → Sync script: { type: 'scroll', scrollPercent: 0.45 }
  → Rust broadcasts to Pixel 8, iPad Air via evaluate_js
  → Each scrolls to 45% of document height
```

**Closing:**
```
Click 📱 → devicePreviewStore.closeAll()
  → Rust destroys all device WebView2s
  → Chat re-expands, editor full-width
```

### Persistence

- **Last-used device selection** saved to config — next open remembers your picks
- **Custom devices** saved to config
- **Orientation preference** saved to config
- **Sync enabled** state saved to config

### URL Resolution

Priority for what URL devices load:
1. Running dev server (auto-detected via `dev-server-manager`)
2. Manually entered URL from control strip
3. Same URL as the Browser tab (fallback)
