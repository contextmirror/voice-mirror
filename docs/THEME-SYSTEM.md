# Theme System

Voice Mirror Electron ships with 8 built-in theme presets and supports fully
custom themes that users can create, import, export, and persist across
sessions. The engine lives in a single renderer-side module
(`theme-engine.js`) that derives 35+ CSS variables, orb canvas colors, and a
full 16-color ANSI terminal palette from just 10 base hex colors and 2 font
stacks.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Preset List](#2-preset-list)
3. [Color Derivation](#3-color-derivation)
4. [CSS Variable Reference](#4-css-variable-reference)
5. [Orb Color Derivation](#5-orb-color-derivation)
6. [Terminal Theme](#6-terminal-theme)
7. [TUI Theme Adaptation](#7-tui-theme-adaptation)
8. [Custom Themes](#8-custom-themes)
9. [Theme Resolution](#9-theme-resolution)
10. [Adding a New Preset](#10-adding-a-new-preset)

---

## 1. Overview

| Concept | Detail |
|---------|--------|
| **Source file** | `electron/renderer/theme-engine.js` |
| **UI** | `electron/renderer/settings-appearance.js` |
| **CSS tokens** | `electron/renderer/styles/tokens.css` |
| **Built-in presets** | 8 (colorblind, light, midnight, emerald, rose, slate, black, gray) |
| **Custom themes** | Unlimited; persisted in `config.json` under `appearance.customThemes` |
| **Base inputs** | 10 hex colors + 2 font-family strings |
| **Derived outputs** | 35+ CSS custom properties, 5 orb RGB arrays, 16-color terminal palette |

When a theme is applied (via `applyTheme(colors, fonts)`), three things happen
in sequence:

1. `deriveTheme()` computes CSS variable values and sets them on `:root`.
2. `deriveOrbColors()` maps base colors to RGB arrays and pushes them to the
   orb canvas via a registered callback.
3. `deriveTerminalTheme()` builds a ghostty-web compatible palette and pushes
   it to the embedded terminal via a registered callback.
4. The 10 base colors are forwarded to the TUI renderer (if active) over IPC
   via `window.voiceMirror.claude.setTuiTheme(colors)`.

---

## 2. Preset List

Every preset defines 10 colors and 2 font stacks. The default preset is
**Colorblind** -- chosen because its palette uses the Okabe-Ito palette
conventions for accessibility.

### Colorblind (default)

| Key | Hex | Role |
|-----|-----|------|
| `bg` | `#0c0d10` | App background |
| `bgElevated` | `#14161c` | Elevated surfaces (cards, panels) |
| `text` | `#e4e4e7` | Body text |
| `textStrong` | `#fafafa` | Headings, emphasis |
| `muted` | `#71717a` | Secondary text, timestamps |
| `accent` | `#56b4e9` | Primary accent (Okabe-Ito sky blue) |
| `ok` | `#0072b2` | Success states |
| `warn` | `#e69f00` | Warning states |
| `danger` | `#d55e00` | Error / destructive states |
| `orbCore` | `#1b2e4e` | Orb center fill |

### Light

| Key | Hex |
|-----|-----|
| `bg` | `#f5f5f5` |
| `bgElevated` | `#ffffff` |
| `text` | `#1a1a2e` |
| `textStrong` | `#0a0a0a` |
| `muted` | `#6b7280` |
| `accent` | `#4f46e5` |
| `ok` | `#16a34a` |
| `warn` | `#d97706` |
| `danger` | `#dc2626` |
| `orbCore` | `#c7d2fe` |

### Midnight

| Key | Hex |
|-----|-----|
| `bg` | `#0a0e1a` |
| `bgElevated` | `#111827` |
| `text` | `#d1d5db` |
| `textStrong` | `#f9fafb` |
| `muted` | `#6b7280` |
| `accent` | `#3b82f6` |
| `ok` | `#34d399` |
| `warn` | `#f59e0b` |
| `danger` | `#f87171` |
| `orbCore` | `#1e3a5f` |

### Emerald

| Key | Hex |
|-----|-----|
| `bg` | `#0a1210` |
| `bgElevated` | `#111f1a` |
| `text` | `#d1e7dd` |
| `textStrong` | `#ecfdf5` |
| `muted` | `#6b9080` |
| `accent` | `#10b981` |
| `ok` | `#34d399` |
| `warn` | `#fbbf24` |
| `danger` | `#f87171` |
| `orbCore` | `#064e3b` |

### Rose

| Key | Hex |
|-----|-----|
| `bg` | `#140a0e` |
| `bgElevated` | `#1f1115` |
| `text` | `#f0dde3` |
| `textStrong` | `#fdf2f8` |
| `muted` | `#b07a8a` |
| `accent` | `#ec4899` |
| `ok` | `#4ade80` |
| `warn` | `#fbbf24` |
| `danger` | `#ef4444` |
| `orbCore` | `#4a0e2b` |

### Slate

| Key | Hex |
|-----|-----|
| `bg` | `#0f1114` |
| `bgElevated` | `#1e2028` |
| `text` | `#cbd5e1` |
| `textStrong` | `#f1f5f9` |
| `muted` | `#94a3b8` |
| `accent` | `#6366f1` |
| `ok` | `#4ade80` |
| `warn` | `#fbbf24` |
| `danger` | `#ef4444` |
| `orbCore` | `#1e1b4b` |

### Black

| Key | Hex |
|-----|-----|
| `bg` | `#000000` |
| `bgElevated` | `#0e0e0e` |
| `text` | `#d4d4d4` |
| `textStrong` | `#ffffff` |
| `muted` | `#707070` |
| `accent` | `#e0e0e0` |
| `ok` | `#4ade80` |
| `warn` | `#bfa86f` |
| `danger` | `#bf6f6f` |
| `orbCore` | `#0a0a0a` |

### Claude Gray

| Key | Hex |
|-----|-----|
| `bg` | `#191919` |
| `bgElevated` | `#232323` |
| `text` | `#d4cfc7` |
| `textStrong` | `#f5f0e8` |
| `muted` | `#8a8580` |
| `accent` | `#d4873e` |
| `ok` | `#6bba6b` |
| `warn` | `#e0a832` |
| `danger` | `#d45b5b` |
| `orbCore` | `#3d2e1f` |

### Shared Font Stacks

All built-in presets use the same font stacks:

```
fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
fontMono:   "'Cascadia Code', 'Fira Code', monospace"
```

Users can override these per-theme or upload custom font files through the
Appearance settings panel.

---

## 3. Color Derivation

`deriveTheme(colors, fonts)` takes the 10 base color values and 2 font strings
and returns a flat object mapping CSS property names to their computed values.
Every derived value is produced by one of five internal color-math utilities:

| Utility | Signature | Behavior |
|---------|-----------|----------|
| `lighten(hex, amount)` | HSL lightness + amount | Clamps at 1.0 |
| `darken(hex, amount)` | HSL lightness - amount | Clamps at 0.0 |
| `blend(hex1, hex2, t)` | Linear RGB interpolation | `t=0` returns hex1, `t=1` returns hex2 |
| `hexToRgba(hex, alpha)` | Produces `rgba(r, g, b, a)` string | Used for translucent overlays |
| Luminance check | `r*0.299 + g*0.587 + b*0.114` | Decides `--accent-contrast` (black or white) |

### Derivation formulas

The following table shows how each derived variable is computed. `c.*` refers
to base color inputs; `f.*` refers to font inputs.

| Variable | Formula |
|----------|---------|
| `--bg` | `c.bg` (pass-through) |
| `--bg-accent` | `blend(c.bg, c.bgElevated, 0.4)` |
| `--bg-elevated` | `c.bgElevated` (pass-through) |
| `--bg-hover` | `lighten(c.bgElevated, 0.06)` |
| `--chrome` | `blend(c.bg, c.bgElevated, 0.65)` |
| `--card` | `blend(c.bg, c.bgElevated, 0.3)` |
| `--card-highlight` | `hexToRgba(c.textStrong, 0.03)` |
| `--text` | `c.text` (pass-through) |
| `--text-strong` | `c.textStrong` (pass-through) |
| `--muted` | `c.muted` (pass-through) |
| `--border` | `hexToRgba(c.textStrong, 0.06)` |
| `--border-strong` | `hexToRgba(c.textStrong, 0.10)` |
| `--accent` | `c.accent` (pass-through) |
| `--accent-hover` | `lighten(c.accent, 0.12)` |
| `--accent-subtle` | `hexToRgba(c.accent, 0.15)` |
| `--accent-glow` | `hexToRgba(c.accent, 0.25)` |
| `--accent-contrast` | `#000000` if accent luminance > 160, else `#ffffff` |
| `--ok` | `c.ok` (pass-through) |
| `--ok-subtle` | `hexToRgba(c.ok, 0.15)` |
| `--ok-glow` | `hexToRgba(c.ok, 0.5)` |
| `--warn` | `c.warn` (pass-through) |
| `--warn-subtle` | `hexToRgba(c.warn, 0.15)` |
| `--danger` | `c.danger` (pass-through) |
| `--danger-subtle` | `hexToRgba(c.danger, 0.15)` |
| `--danger-glow` | `hexToRgba(c.danger, 0.5)` |
| `--shadow-sm` | `0 1px 3px` with `hexToRgba(darken(c.bg, 0.05), 0.4)` |
| `--shadow-md` | `0 4px 12px` with `hexToRgba(darken(c.bg, 0.05), 0.5)` |
| `--shadow-lg` | `0 12px 28px` with `hexToRgba(darken(c.bg, 0.05), 0.6)` |
| `--font-family` | `f.fontFamily` (fallback: Colorblind preset default) |
| `--font-mono` | `f.fontMono` (fallback: Colorblind preset default) |
| `--msg-font-size` | `14px` (hard-coded default) |
| `--msg-line-height` | `1.5` (hard-coded default) |
| `--msg-padding` | `12px 16px` (hard-coded default) |
| `--msg-avatar-size` | `36px` (hard-coded default) |
| `--msg-user-bg` | 135deg gradient from `hexToRgba(c.accent, 0.4)` to `hexToRgba(darken(c.accent, 0.15), 0.35)` |
| `--msg-user-border` | `hexToRgba(c.accent, 0.3)` |
| `--msg-user-radius` | `16px 16px 4px 16px` |
| `--msg-ai-bg` | 135deg gradient from `blend(c.bg, c.bgElevated, 0.5)` to `blend(c.bg, c.bgElevated, 0.2)` |
| `--msg-ai-border` | `hexToRgba(c.textStrong, 0.10)` |
| `--msg-ai-radius` | `4px 16px 16px 16px` |

The `--msg-*` variables can be independently overridden by the message card
customization panel (see `applyMessageCardOverrides()`).

---

## 4. CSS Variable Reference

The following variables are set on `:root` by `deriveTheme()` and consumed
throughout the app's stylesheets.

### Background

| Variable | What it controls |
|----------|-----------------|
| `--bg` | Root background (body, app shell) |
| `--bg-accent` | Subtle accent-tinted background areas |
| `--bg-elevated` | Elevated cards, modals, dropdowns |
| `--bg-hover` | Hover state for elevated surfaces |
| `--chrome` | Window chrome / title bar background |
| `--card` | Card backgrounds |
| `--card-highlight` | Subtle card highlight overlay |

### Text

| Variable | What it controls |
|----------|-----------------|
| `--text` | Default body text |
| `--text-strong` | Headings, bold labels |
| `--muted` | Timestamps, secondary info, placeholders |

### Borders

| Variable | What it controls |
|----------|-----------------|
| `--border` | Default separator borders (6% opacity) |
| `--border-strong` | Emphasized borders (10% opacity) |

### Accent

| Variable | What it controls |
|----------|-----------------|
| `--accent` | Primary brand color (buttons, links, focus rings) |
| `--accent-hover` | Accent on hover (lightened +12%) |
| `--accent-subtle` | Accent at 15% opacity (tag backgrounds, badges) |
| `--accent-glow` | Accent at 25% opacity (glowing focus rings) |
| `--accent-contrast` | Guaranteed readable text on `--accent` (black or white) |

### Semantic

| Variable | What it controls |
|----------|-----------------|
| `--ok` | Success / connected / online states |
| `--ok-subtle` | Success background (15% opacity) |
| `--ok-glow` | Success glow effect (50% opacity) |
| `--warn` | Warning states |
| `--warn-subtle` | Warning background (15% opacity) |
| `--danger` | Error / destructive states |
| `--danger-subtle` | Error background (15% opacity) |
| `--danger-glow` | Error glow effect (50% opacity) |

### Shadows

| Variable | What it controls |
|----------|-----------------|
| `--shadow-sm` | Small shadow (buttons, inputs) |
| `--shadow-md` | Medium shadow (cards, dropdowns) |
| `--shadow-lg` | Large shadow (modals, overlays) |

### Typography

| Variable | What it controls |
|----------|-----------------|
| `--font-family` | UI font stack (labels, buttons, body text) |
| `--font-mono` | Monospace font stack (terminal, code blocks) |

### Message Cards

| Variable | What it controls |
|----------|-----------------|
| `--msg-font-size` | Chat message font size |
| `--msg-line-height` | Chat message line height |
| `--msg-padding` | Chat bubble padding |
| `--msg-avatar-size` | Avatar diameter in chat |
| `--msg-user-bg` | User message bubble gradient |
| `--msg-user-border` | User message bubble border |
| `--msg-user-radius` | User message bubble border-radius |
| `--msg-ai-bg` | AI message bubble gradient |
| `--msg-ai-border` | AI message bubble border |
| `--msg-ai-radius` | AI message bubble border-radius |

### Static Tokens (from `tokens.css`, not overridden by themes)

| Variable | Value | What it controls |
|----------|-------|-----------------|
| `--radius-sm` | `6px` | Small border radius (inputs, chips) |
| `--radius-md` | `8px` | Medium border radius (cards) |
| `--radius-lg` | `12px` | Large border radius (panels) |
| `--radius-xl` | `16px` | Extra-large border radius (modals) |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Standard ease-out curve |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Springy overshoot curve |
| `--duration-fast` | `120ms` | Fast transition (hover, focus) |
| `--duration-normal` | `200ms` | Normal transition |
| `--duration-slow` | `350ms` | Slow transition (modals, panels) |

---

## 5. Orb Color Derivation

`deriveOrbColors(colors)` maps theme colors to five RGB triplet arrays used
by the orb canvas renderer (`orb-canvas.js`).

| Output | Source | Derivation |
|--------|--------|------------|
| `borderRgb` | `colors.accent` | Direct hex-to-RGB conversion |
| `centerRgb` | `colors.orbCore` | Direct hex-to-RGB conversion |
| `edgeRgb` | `colors.orbCore` | `darken(orbCore, 0.15)` then hex-to-RGB |
| `iconRgb` | `colors.text` | Direct hex-to-RGB conversion |
| `eyeRgb` | `colors.orbCore` | `darken(orbCore, 0.10)` then hex-to-RGB |

Each value is an array of `[r, g, b]` integers (0-255). The orb renderer
accepts these through a callback registered via `onOrbColorsChanged(fn)`. When
`applyTheme()` runs, it calls `deriveOrbColors()` and pushes the result to
the callback, triggering an immediate repaint of the orb canvas.

---

## 6. Terminal Theme

`deriveTerminalTheme(colors)` produces a ghostty-web compatible theme object
containing 18 color properties: background, foreground, cursor, cursor accent,
selection background, and the 16 standard ANSI colors (8 normal + 8 bright).

### Light-Mode Detection

The function uses weighted luminance to detect whether the base `bg` color is
light or dark:

```js
const { r, g, b } = hexToRgb(c.bg);
const isLight = (r * 0.299 + g * 0.587 + b * 0.114) > 128;
const shift = isLight ? darken : lighten;
```

When the background is light, "bright" ANSI variants are produced by
**darkening** instead of lightening, so they remain readable on light
surfaces.

### ANSI Color Mapping

| Terminal Slot | Source | Notes |
|---------------|--------|-------|
| `background` | `c.bg` | Direct |
| `foreground` | `c.text` | Direct |
| `cursor` | `c.accent` | |
| `cursorAccent` | `c.bg` | Cursor text color |
| `selectionBackground` | `hexToRgba(c.accent, 0.3)` | |
| `black` | Light: `darken(bg, 0.05)`, Dark: `lighten(bg, 0.05)` | |
| `red` | `c.danger` | |
| `green` | `c.ok` | |
| `yellow` | `c.warn` | |
| `blue` | `c.accent` | |
| `magenta` | `shift(blend(accent, danger, 0.5), 0.1)` | Synthetic |
| `cyan` | `shift(blend(accent, ok, 0.5), 0.1)` | Synthetic |
| `white` | Light: `lighten(bg, 0.05)`, Dark: `c.text` | |
| `brightBlack` | `c.muted` | |
| `brightRed` | `shift(danger, 0.15)` | |
| `brightGreen` | `shift(ok, 0.15)` | |
| `brightYellow` | `shift(warn, 0.15)` | |
| `brightBlue` | `shift(accent, 0.15)` | |
| `brightMagenta` | `shift(blend(accent, danger, 0.5), 0.25)` | Synthetic |
| `brightCyan` | `shift(blend(accent, ok, 0.5), 0.25)` | Synthetic |
| `brightWhite` | `c.textStrong` | |

Note that magenta and cyan are synthetic -- they are blended from accent +
danger and accent + ok respectively, since the base palette does not include
dedicated magenta or cyan inputs.

The terminal theme callback is registered via `onTerminalThemeChanged(fn)`.
The terminal module (`terminal.js`) uses this to live-update the ghostty-web
terminal emulator.

---

## 7. TUI Theme Adaptation

When local AI providers (Ollama, LM Studio, Jan) are active, Voice Mirror
renders a rich text dashboard inside the terminal using the `TUIRenderer`
class in `electron/providers/tui-renderer.js`. The TUI uses ANSI escape
sequences for all rendering and needs its own color scheme.

### Data Flow

```
applyTheme(colors, fonts)
  |
  +-> window.voiceMirror.claude.setTuiTheme(colors)    [preload.js bridge]
        |
        +-> ipcRenderer.invoke('ai-set-tui-theme', colors)
              |
              +-> ipcMain handler in ai.js
                    |
                    +-> provider.tui.setThemeColors(colors)
                          |
                          +-> TUIRenderer.setThemeColors()
```

### `setThemeColors(colors)` in `TUIRenderer`

This method receives the 10 base hex color values and rebuilds the internal
ANSI theme object using 24-bit (true color) escape sequences:

```js
setThemeColors(colors) {
    this._bgCode = bgHex(colors.bg);       // \x1b[48;2;R;G;Bm
    this._fgCode = fgHex(colors.text);      // \x1b[38;2;R;G;Bm

    this._theme = {
        border:    fgHex(colors.accent),
        user:      bold + fgHex(colors.textStrong),
        assistant: fgHex(colors.text),
        dim:       fgHex(colors.muted),
        toolRun:   fgHex(colors.warn),
        toolOk:    fgHex(colors.ok),
        toolFail:  fgHex(colors.danger),
        status:    fgHex(colors.muted),
        accent:    fgHex(colors.accent),
        green:     fgHex(colors.ok),
    };
}
```

The method also rebuilds helper strings used for screen clearing and line
resets:

- `_resetBg` = `RESET` + background ANSI code + foreground ANSI code, so
  that `CLEAR_EOL` fills with the themed background color instead of the
  terminal default.
- `_clearEol` = background code + `\x1b[K`, ensuring erased regions match
  the theme background.
- `_clearScreen` = background code + `\x1b[2J\x1b[H`.

After updating all color codes, the method forces a full repaint by setting
`_firstRender = true`, invalidating cached chat lines, and calling
`this.render()`.

### Default (fallback) TUI Theme

If `setThemeColors` is never called, the TUI falls back to 256-color ANSI
codes:

| Slot | ANSI Code |
|------|-----------|
| `border` | `\x1b[38;5;69m` (steel blue) |
| `user` | `\x1b[1;37m` (bold white) |
| `assistant` | `\x1b[97m` (bright white) |
| `dim` | `\x1b[90m` (dark gray) |
| `toolRun` | `\x1b[33m` (yellow) |
| `toolOk` | `\x1b[32m` (green) |
| `toolFail` | `\x1b[31m` (red) |
| `status` | `\x1b[90m` (dark gray) |
| `accent` | `\x1b[38;5;69m` (steel blue) |
| `green` | `\x1b[32m` (green) |

---

## 8. Custom Themes

### Import/Export JSON Format

Custom themes use a simple versioned JSON format:

```json
{
    "name": "My Custom Theme",
    "version": 1,
    "colors": {
        "bg": "#0c0d10",
        "bgElevated": "#14161c",
        "text": "#e4e4e7",
        "textStrong": "#fafafa",
        "muted": "#71717a",
        "accent": "#56b4e9",
        "ok": "#0072b2",
        "warn": "#e69f00",
        "danger": "#d55e00",
        "orbCore": "#1b2e4e"
    },
    "fonts": {
        "fontFamily": "'Segoe UI', system-ui, -apple-system, sans-serif",
        "fontMono": "'Cascadia Code', 'Fira Code', monospace"
    }
}
```

### Required Fields

| Field | Type | Constraint |
|-------|------|------------|
| `version` | `number` | Must be `1` |
| `colors` | `object` | Must contain all 10 color keys |
| Each color value | `string` | Must match `/^#[0-9a-fA-F]{6}$/` |
| `fonts` | `object` | Optional; defaults to Colorblind preset fonts |
| `name` | `string` | Optional; defaults to `"Custom Theme"` |

### Validation

`validateImportData(data)` checks the imported object and returns:

- `{ valid: true, colors, fonts }` on success.
- `{ valid: false, error: string }` on failure, with a human-readable error
  such as `"Invalid or missing color: accent"` or `"Unsupported theme version"`.

### Persistence

Custom themes are stored in the config file under `appearance.customThemes`
as an array of objects:

```json
{
    "appearance": {
        "theme": "custom-1706000000000",
        "customThemes": [
            {
                "key": "custom-1706000000000",
                "name": "Ocean Breeze",
                "colors": { ... },
                "fonts": { ... }
            }
        ]
    }
}
```

Keys are auto-generated with the pattern `custom-{Date.now()}`. When a user
imports a theme, it is appended to `_customThemes` in memory and persisted via
`window.voiceMirror.config.update()`. Custom theme cards appear in the preset
grid alongside built-in presets and include a delete button.

### Import/Export IPC

File I/O for import and export goes through the preload bridge:

- **Export**: `window.voiceMirror.theme.export(data)` invokes `theme-export`
  IPC, which opens a "Save As" dialog and writes the JSON file.
- **Import**: `window.voiceMirror.theme.import()` invokes `theme-import` IPC,
  which opens a file picker, reads the JSON, and returns `{ success, data }`.

---

## 9. Theme Resolution

`resolveTheme(appearance)` determines which colors and fonts to use at
startup. It is given the `config.appearance` object and follows this logic:

```
1. Read appearance.theme (default: 'colorblind')
2. Look up PRESETS[theme] (built-in preset lookup)
3. If not found, fall back to PRESETS.colorblind
4. Use appearance.colors if provided, otherwise use preset.colors
5. Use appearance.fonts if provided, otherwise use preset.fonts
6. Return { colors, fonts }
```

In the settings UI (`loadAppearanceUI()`), the resolution is slightly
extended to also check the `_customThemes` array:

```
1. Read appearance.theme from config
2. Check if it matches a built-in preset key
3. If not, check if it matches a custom theme key in _customThemes
4. Fall back to PRESETS.colorblind if neither matches
5. If appearance.colors is set and this is not a custom theme,
   mark the theme as "customized" (shows a badge on the preset card)
```

### Configuration Defaults

From `electron/config.js`:

```js
appearance: {
    orbSize: 64,
    theme: 'colorblind',
    panelWidth: 500,
    panelHeight: 700,
    colors: null,     // null = use preset colors
    fonts: null,      // null = use preset fonts
    messageCard: null  // null = use theme defaults
}
```

Setting `colors: null` means "use the preset's built-in palette." Setting it
to an object with 10 hex color values means "override the preset palette."

### Validation (IPC layer)

From `electron/ipc/validators.js`, the `set-config` validator enforces:

- `appearance.theme` must be one of: `colorblind`, `midnight`, `emerald`,
  `rose`, `slate`, `black`, `gray`, `light`, `custom`, or a string starting
  with `custom-`.
- `appearance.colors` must be `null` or an object where every key is one of
  the 10 valid color keys and every value matches `#RRGGBB`.
- `appearance.fonts` must be `null` or an object with string-valued
  `fontFamily` and `fontMono` fields.

---

## 10. Adding a New Preset

To add a new built-in theme preset, follow these steps:

### Step 1: Define the preset in `theme-engine.js`

Add a new entry to the `PRESETS` object. The key becomes the internal
identifier; the `name` is the display label in the settings UI.

```js
// In electron/renderer/theme-engine.js, inside PRESETS:

ocean: {
    name: 'Ocean',
    colors: {
        bg: '#0b1622',
        bgElevated: '#132238',
        text: '#c8d6e5',
        textStrong: '#f0f4f8',
        muted: '#6b8299',
        accent: '#00b4d8',
        ok: '#06d6a0',
        warn: '#ffd166',
        danger: '#ef476f',
        orbCore: '#023e58'
    },
    fonts: {
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        fontMono: "'Cascadia Code', 'Fira Code', monospace"
    }
},
```

All 10 color keys are required. Every value must be a 6-digit hex string
(`#RRGGBB`). You do not need to define derived colors -- those are computed
automatically.

### Step 2: Register the theme in the validator

Open `electron/ipc/validators.js` and add the new key to the `VALID_THEMES`
array inside the `set-config` validator:

```js
const VALID_THEMES = [
    'colorblind', 'midnight', 'emerald', 'rose', 'slate',
    'black', 'gray', 'light', 'custom',
    'ocean'  // <-- add here
];
```

### Step 3: Add a test

In `test/unit/theme-engine.test.js`, add a test case confirming the preset
exists:

```js
it('should define ocean preset', () => {
    assert.ok(src.includes("ocean:"));
    assert.ok(src.includes("name: 'Ocean'"));
});
```

### Step 4: Verify

1. Run `npm test` to confirm the test passes.
2. Launch the app, open Settings > Appearance.
3. Verify the new preset card appears in the grid with correct swatch colors.
4. Click it and confirm the theme applies to the entire app -- UI, orb, and
   terminal.

### Tips

- **Check contrast**: Use the light-mode detection threshold (`luminance > 128`)
  as a guide. If your `bg` is above that threshold, terminal bright colors
  will be darkened instead of lightened.
- **Test the orb**: The `orbCore` color is darkened by 10-15% for the edge and
  eye. Make sure the result is not pure black unless intended.
- **Test the TUI**: If you use a local AI provider, switch to it and verify
  that the TUI dashboard renders with correct border, text, and status colors.
