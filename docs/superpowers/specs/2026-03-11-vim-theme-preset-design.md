# Vim Theme Preset — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Summary

Replace the "Slate" theme preset with a "Vim" preset using the gruvbox-dark colorscheme and monospace font stacks popular in the Vim community.

## Motivation

Add a theme that captures the look and feel of Vim, the iconic terminal code editor. Gruvbox is the most strongly associated colorscheme with Vim — warm retro tones with earthy browns, oranges, and muted greens.

## Design

### Approach

Simple preset swap — replace the `slate` key in `PRESETS` with `vim`. No architecture changes. Slots directly into the existing 8-preset theme system.

### Color Palette (gruvbox-dark)

| Key | Hex | Gruvbox Name |
|-----|-----|-------------|
| `bg` | `#282828` | dark0 |
| `bgElevated` | `#3c3836` | dark1 |
| `text` | `#ebdbb2` | light1 |
| `textStrong` | `#fbf1c7` | light0 |
| `muted` | `#a89984` | gray |
| `accent` | `#fe8019` | orange |
| `ok` | `#b8bb26` | green |
| `warn` | `#fabd2f` | yellow |
| `danger` | `#fb4934` | red |
| `orbCore` | `#fe8019` | orange (matches accent) |

### Fonts

Both `fontFamily` and `fontMono` use the same monospace stack — in Vim, everything is mono:

```
'Hack', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace
```

Font priority reflects Vim community popularity: Hack > JetBrains Mono > Fira Code, with Windows system fallbacks.

### Files Changed

1. `src/lib/stores/theme.svelte.js` — Replace `slate` preset with `vim`
2. `test/stores/theme.test.cjs` — Update preset name references
3. `docs/THEME-SYSTEM.md` — Update preset listings and color table
4. `docs/CONFIGURATION.md` — Update preset table
5. `docs/ARCHITECTURE.md` — Update preset table

### Migration

Users who had `slate` selected will fall back to the default `colorblind` theme (handled by existing `resolveTheme()` fallback logic).
