# Theme System

Voice Mirror is a voice-assisted development environment where developers spend
extended sessions -- editing code, previewing in the browser, running terminal
commands, and talking to AI. A unified theme system ensures every surface stays
visually coherent: the editor, the terminal, the chat panel, the orb, and the
browser chrome all derive their colors from a single 10-color palette.

The engine lives in a Svelte 5 reactive store
(`src/lib/stores/theme.svelte.js`) that derives 50+ CSS variables, CodeMirror
syntax highlighting, orb canvas colors, and a 16-color ANSI terminal palette
from just 10 base hex colors and 2 font stacks. Voice Mirror ships with 8
built-in presets and supports custom themes.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Preset List](#2-preset-list)
3. [Color Derivation](#3-color-derivation)
4. [CSS Variable Reference](#4-css-variable-reference)
5. [Orb Color Derivation](#5-orb-color-derivation)
6. [Terminal Theme](#6-terminal-theme)
7. [CodeMirror Editor Theme](#7-codemirror-editor-theme)
8. [Custom Themes](#8-custom-themes)
9. [Theme Resolution](#9-theme-resolution)
10. [Adding a New Preset](#10-adding-a-new-preset)

---

## 1. Overview

| Concept | Detail |
|---------|--------|
| **Source file** | `src/lib/stores/theme.svelte.js` |
| **CSS tokens** | `src/styles/tokens.css` |
| **Built-in presets** | 8 (colorblind, light, midnight, emerald, rose, slate, black, gray) |
| **Custom themes** | Persisted in config under `appearance.colors` / `appearance.fonts` |
| **Base inputs** | 10 hex colors + 2 font-family strings |
| **Derived outputs** | 50+ CSS custom properties (including CodeMirror syntax vars), orb RGB arrays, terminal palette |

When a theme is applied (via `applyTheme(colors, fonts)`), `deriveTheme()`
computes CSS variable values and sets them on `:root`. The function detects
whether the background is light or dark using weighted luminance and adjusts
derivation formulas accordingly.

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
| `accent` | `#22c55e` |
| `ok` | `#4ade80` |
| `warn` | `#bfa86f` |
| `danger` | `#bf6f6f` |
| `orbCore` | `#0a0a0a` |

### Claude Gray

| Key | Hex |
|-----|-----|
| `bg` | `#292724` |
| `bgElevated` | `#353330` |
| `text` | `#cecaba` |
| `textStrong` | `#ece8df` |
| `muted` | `#8b8579` |
| `accent` | `#c96442` |
| `ok` | `#6bba6b` |
| `warn` | `#e0a832` |
| `danger` | `#d45b5b` |
| `orbCore` | `#3d2e1f` |

### Font Stacks

Most built-in presets use the same font stacks:

```
fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
fontMono:   "'Cascadia Code', 'Fira Code', monospace"
```

Exception: **Claude Gray** uses a different system font order:

```
fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
```

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
| Luminance check | `r*0.299 + g*0.587 + b*0.114` | Decides light/dark mode and `--accent-contrast` |

### Light/Dark Detection

The function computes weighted luminance of the `bg` color:

```js
const bgLum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
const isLight = bgLum > 0.5;
```

When `isLight` is true, several derivation formulas change to ensure
readability on light backgrounds (e.g., borders get higher opacity, shadows use
fixed black instead of darkened-bg, hover states darken instead of lighten).

### Derivation formulas

The following table shows how each derived variable is computed. `c.*` refers
to base color inputs; `f.*` refers to font inputs.

| Variable | Dark Mode Formula | Light Mode Override |
|----------|-------------------|---------------------|
| `--bg` | `c.bg` (pass-through) | -- |
| `--bg-accent` | `blend(c.bg, c.bgElevated, 0.4)` | -- |
| `--bg-elevated` | `c.bgElevated` (pass-through) | -- |
| `--bg-hover` | `lighten(c.bgElevated, 0.06)` | `darken(c.bgElevated, 0.04)` |
| `--chrome` | `blend(c.bg, c.bgElevated, 0.65)` | -- |
| `--card` | `blend(c.bg, c.bgElevated, 0.3)` | -- |
| `--card-highlight` | `hexToRgba(c.textStrong, 0.03)` | -- |
| `--text` | `c.text` (pass-through) | -- |
| `--text-strong` | `c.textStrong` (pass-through) | -- |
| `--muted` | `c.muted` (pass-through) | -- |
| `--border` | `hexToRgba(c.textStrong, 0.10)` | `hexToRgba(c.textStrong, 0.14)` |
| `--border-strong` | `hexToRgba(c.textStrong, 0.16)` | `hexToRgba(c.textStrong, 0.22)` |
| `--accent` | `c.accent` (pass-through) | -- |
| `--accent-hover` | `lighten(c.accent, 0.12)` | -- |
| `--accent-subtle` | `hexToRgba(c.accent, 0.15)` | -- |
| `--accent-glow` | `hexToRgba(c.accent, 0.25)` | -- |
| `--accent-contrast` | `#ffffff` if accent luminance <= 160 | `#000000` if > 160 |
| `--ok` | `c.ok` (pass-through) | -- |
| `--ok-subtle` | `hexToRgba(c.ok, 0.15)` | -- |
| `--ok-glow` | `hexToRgba(c.ok, 0.5)` | -- |
| `--warn` | `c.warn` (pass-through) | -- |
| `--warn-subtle` | `hexToRgba(c.warn, 0.15)` | -- |
| `--danger` | `c.danger` (pass-through) | -- |
| `--danger-subtle` | `hexToRgba(c.danger, 0.15)` | -- |
| `--danger-glow` | `hexToRgba(c.danger, 0.5)` | -- |
| `--shadow-sm` | `0 1px 3px` with `hexToRgba(darken(c.bg, 0.05), 0.4)` | `0 1px 3px rgba(0,0,0,0.08)` |
| `--shadow-md` | `0 4px 12px` with `hexToRgba(darken(c.bg, 0.05), 0.5)` | `0 4px 12px rgba(0,0,0,0.12)` |
| `--shadow-lg` | `0 12px 28px` with `hexToRgba(darken(c.bg, 0.05), 0.6)` | `0 12px 28px rgba(0,0,0,0.15)` |
| `--font-family` | `f.fontFamily` (fallback: Colorblind preset default) | -- |
| `--font-mono` | `f.fontMono` (fallback: Colorblind preset default) | -- |
| `--msg-font-size` | `14px` (hard-coded) | -- |
| `--msg-line-height` | `1.5` (hard-coded) | -- |
| `--msg-padding` | `12px 16px` (hard-coded) | -- |
| `--msg-avatar-size` | `36px` (hard-coded) | -- |
| `--msg-user-bg` | 135deg gradient: `rgba(accent, 0.4)` to `rgba(darken(accent, 0.15), 0.35)` | 135deg gradient: `rgba(accent, 0.18)` to `rgba(darken(accent, 0.08), 0.14)` |
| `--msg-user-border` | `hexToRgba(c.accent, 0.3)` | `hexToRgba(c.accent, 0.25)` |
| `--msg-user-radius` | `16px 16px 4px 16px` | -- |
| `--msg-ai-bg` | 135deg gradient: `blend(bg, bgElevated, 0.5)` to `blend(bg, bgElevated, 0.2)` | 135deg gradient: `darken(bg, 0.04)` to `darken(bg, 0.06)` |
| `--msg-ai-border` | `hexToRgba(c.textStrong, 0.10)` | `hexToRgba(c.textStrong, 0.12)` |
| `--msg-ai-radius` | `4px 16px 16px 16px` | -- |

See [Section 7](#7-codemirror-editor-theme) for the `--cm-*` CodeMirror
variables which are also generated by `deriveTheme()`.

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
| `--border` | Default separator borders (10% dark / 14% light) |
| `--border-strong` | Emphasized borders (16% dark / 22% light) |

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
| `--space-xs` | `4px` | Extra-small spacing |
| `--space-sm` | `8px` | Small spacing |
| `--space-md` | `16px` | Medium spacing |
| `--space-lg` | `24px` | Large spacing |
| `--radius-sm` | `6px` | Small border radius (inputs, chips) |
| `--radius-md` | `10px` | Medium border radius (cards) |
| `--radius-lg` | `16px` | Large border radius (panels) |
| `--radius-xl` | `20px` | Extra-large border radius (modals) |
| `--radius-full` | `9999px` | Fully round (pills, circles) |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Standard ease-out curve |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard ease-in-out curve |
| `--duration-fast` | `100ms` | Fast transition (hover, focus) |
| `--duration-normal` | `200ms` | Normal transition |
| `--duration-slow` | `400ms` | Slow transition (modals, panels) |

---

## 5. Orb Color Derivation

The orb canvas renderer uses five RGB triplet arrays derived from theme colors.
These are mapped from the theme presets and applied when the orb is rendered.

| Output | Source | Derivation |
|--------|--------|------------|
| `borderRgb` | `colors.accent` | Direct hex-to-RGB conversion |
| `centerRgb` | `colors.orbCore` | Direct hex-to-RGB conversion |
| `edgeRgb` | `colors.orbCore` | `darken(orbCore, 0.15)` then hex-to-RGB |
| `iconRgb` | `colors.text` | Direct hex-to-RGB conversion |
| `eyeRgb` | `colors.orbCore` | `darken(orbCore, 0.10)` then hex-to-RGB |

Each value is an array of `[r, g, b]` integers (0-255). When the theme
changes, the orb canvas repaints with the new colors.

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

---

## 7. CodeMirror Editor Theme

`deriveTheme()` also produces `--cm-*` CSS variables that drive the CodeMirror
6 editor theme (defined in `src/lib/editor-theme.js`). These map the 10 base
colors to syntax highlighting, editor chrome, and gutter styling.

### Editor Chrome Variables

| Variable | Dark Mode | Light Mode |
|----------|-----------|------------|
| `--cm-background` | `c.bg` | `c.bg` |
| `--cm-foreground` | `c.text` | `c.text` |
| `--cm-cursor` | `c.accent` | `c.accent` |
| `--cm-selection` | `rgba(accent, 0.3)` | `rgba(accent, 0.18)` |
| `--cm-selection-match` | `rgba(accent, 0.12)` | `rgba(accent, 0.1)` |
| `--cm-line-highlight` | `rgba(accent, 0.04)` | `rgba(accent, 0.05)` |
| `--cm-bracket-match` | `rgba(accent, 0.25)` | `rgba(accent, 0.2)` |
| `--cm-bracket-match-border` | `rgba(accent, 0.5)` | `rgba(accent, 0.5)` |
| `--cm-bracket-mismatch` | `rgba(danger, 0.3)` | `rgba(danger, 0.3)` |
| `--cm-search-match` | `rgba(accent, 0.2)` | `rgba(accent, 0.15)` |
| `--cm-gutter-bg` | `c.bg` | `c.bg` |
| `--cm-gutter-fg` | `darken(muted, 0.1)` | `darken(muted, 0.05)` |
| `--cm-gutter-active-bg` | `rgba(accent, 0.06)` | `rgba(accent, 0.06)` |
| `--cm-gutter-active-fg` | `c.text` | `c.text` |
| `--cm-panel-bg` | `lighten(bg, 0.03)` | `darken(bg, 0.03)` |
| `--cm-tooltip-bg` | `c.bgElevated` | `c.bgElevated` |
| `--cm-autocomplete-selected` | `rgba(accent, 0.2)` | `rgba(accent, 0.2)` |
| `--cm-fold-placeholder` | `c.muted` | `c.muted` |
| `--cm-accent` | `c.accent` | `c.accent` |

### Syntax Highlighting Variables

| Variable | Dark Mode | Light Mode |
|----------|-----------|------------|
| `--cm-keyword` | `c.accent` | `darken(accent, 0.08)` |
| `--cm-string` | `c.ok` | `darken(ok, 0.08)` |
| `--cm-comment` | `c.muted` | `c.muted` |
| `--cm-function` | `blend(accent, textStrong, 0.35)` | `blend(darken(accent, 0.15), warn, 0.35)` |
| `--cm-property` | `lighten(danger, 0.08)` | `darken(danger, 0.1)` |
| `--cm-type` | `c.warn` | `darken(warn, 0.12)` |
| `--cm-number` | `lighten(warn, 0.12)` | `blend(ok, accent, 0.35)` |
| `--cm-constant` | `blend(danger, warn, 0.5)` | `blend(accent, danger, 0.4)` |
| `--cm-operator` | `lighten(muted, 0.2)` | `darken(muted, 0.2)` |
| `--cm-variable` | `c.text` | `c.text` |
| `--cm-variable-def` | `c.textStrong` | `c.textStrong` |
| `--cm-punctuation` | `lighten(muted, 0.1)` | `darken(muted, 0.1)` |
| `--cm-tag` | `c.danger` | `darken(danger, 0.08)` |
| `--cm-attribute` | `blend(warn, danger, 0.25)` | `darken(warn, 0.08)` |
| `--cm-link` | `c.accent` | `c.accent` |
| `--cm-invalid` | `c.danger` | `c.danger` |

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

### Persistence

Custom color/font overrides are stored in the config under `appearance`:

```json
{
    "appearance": {
        "theme": "colorblind",
        "colors": { ... },
        "fonts": { ... }
    }
}
```

Setting `colors: null` means "use the preset's built-in palette." Setting it
to an object with 10 hex color values means "override the preset palette."

Config is managed via the Tauri IPC layer: `invoke('set_config', { patch })`
sends a partial config update to the Rust backend, which merges and persists it.

---

## 9. Theme Resolution

`resolveTheme(name)` determines which colors and fonts to use. It is given a
theme name string and follows this logic:

```
1. Look up PRESETS[name]
2. If not found, fall back to PRESETS.colorblind
3. Return { colors: preset.colors, fonts: preset.fonts }
```

The reactive store `currentThemeName` tracks which preset is active (Svelte 5
`$state` internally). Only valid preset names are accepted.

### Configuration Defaults

From `src/lib/stores/config.svelte.js`:

```js
appearance: {
    orbSize: 80,
    theme: 'colorblind',
    panelWidth: 500,
    panelHeight: 700,
    colors: null,     // null = use preset colors
    fonts: null,      // null = use preset fonts
    messageCard: {
        aiAvatar: 'cube',
        userAvatar: 'person',
        customAvatars: null,
    },
    orb: null,
}
```

---

## 10. Adding a New Preset

To add a new built-in theme preset, follow these steps:

### Step 1: Define the preset in `theme.svelte.js`

Add a new entry to the `PRESETS` object in
`src/lib/stores/theme.svelte.js`. The key becomes the internal identifier;
the `name` is the display label in the settings UI.

```js
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

### Step 2: Add a test

In the appropriate test file, add a test case confirming the preset exists:

```js
it('should define ocean preset', () => {
    assert.ok(src.includes("ocean:"));
    assert.ok(src.includes("name: 'Ocean'"));
});
```

### Step 3: Verify

1. Run `npm test` to confirm the test passes.
2. Launch the app, open Settings > Appearance.
3. Verify the new preset card appears in the grid with correct swatch colors.
4. Click it and confirm the theme applies to the entire app -- UI, orb,
   terminal, and editor.

### Tips

- **Check contrast**: Use the light-mode detection threshold (`bgLum > 0.5`)
  as a guide. If your `bg` is above that threshold, terminal bright colors
  will be darkened instead of lightened, and editor syntax will use deepened
  color variants.
- **Test the orb**: The `orbCore` color is darkened by 10-15% for the edge and
  eye. Make sure the result is not pure black unless intended.
- **Test the editor**: Open a code file in Lens to verify syntax highlighting
  colors derived from your palette look good.
