# Context Menu Presets — Design

> **Goal:** Add a "Context Menus" section to Appearance settings with 4 presets, a live preview, and custom override sliders.

## Presets

| Preset | Menu Radius | Item Radius | Item Padding | Font Size | Shadow | Divider Margin |
|--------|------------|-------------|-------------|-----------|--------|----------------|
| Default | 6px | 0 | 6px 12px | 12px | `0 4px 16px rgba(0,0,0,0.3)` | 4px 8px |
| Rounded | 12px | 8px | 8px 14px | 12px | `0 8px 24px rgba(0,0,0,0.35)` | 4px 12px |
| Compact | 4px | 0 | 4px 8px | 11px | `0 2px 8px rgba(0,0,0,0.2)` | 2px 6px |
| Flat | 2px | 0 | 6px 12px | 12px | none | 4px 8px |

## UI Layout

New section in Appearance settings, between Message Cards and Typography:

```
Context Menus
┌─ Preset grid (4 cards, same style as orb presets) ─┐
│  [Default]  [Rounded]  [Compact]  [Flat]           │
└─────────────────────────────────────────────────────┘

┌─ Live Preview ──────────────────────────────────────┐
│   ┌──────────────────────┐                          │
│   │  Cut          Ctrl+X │                          │
│   │  Copy         Ctrl+C │                          │
│   │──────────────────────│                          │
│   │  Paste        Ctrl+V │                          │
│   │──────────────────────│                          │
│   │  Delete              │  ← danger item (red)     │
│   └──────────────────────┘                          │
└─────────────────────────────────────────────────────┘

┌─ Customize (collapsible) ───────────────────────────┐
│  Border Radius   ──●──────  6px                     │
│  Item Padding    ──●──────  6px                     │
│  Font Size       ──●──────  12px                    │
│  Shadow          [None|Small|Medium|Large] dropdown  │
│  Item Radius     ──●──────  0px                     │
└─────────────────────────────────────────────────────┘
```

## Data Flow

1. Presets defined in `src/lib/context-menu-presets.js` (like `orb-presets.js`)
2. Config stored at `appearance.contextMenu: { preset: 'default', overrides: null | { ... } }`
3. On load/change: merge preset + overrides → set CSS custom properties on `:root`
4. `context-menu.css` references CSS vars instead of hardcoded values
5. Live preview in settings renders a fake context menu using current vars

## CSS Variables (set on :root)

- `--ctx-menu-radius` — menu border-radius
- `--ctx-menu-shadow` — menu box-shadow
- `--ctx-menu-padding` — menu padding
- `--ctx-item-radius` — item border-radius
- `--ctx-item-padding` — item padding
- `--ctx-item-font-size` — item font size
- `--ctx-divider-margin` — divider margin

## New Files

- `src/lib/context-menu-presets.js` — preset definitions + `applyContextMenuPreset()` function
- `src/components/settings/ContextMenuSection.svelte` — settings UI with preview

## Modified Files

- `src/styles/context-menu.css` — replace hardcoded values with CSS vars (with fallbacks)
- `src/components/settings/AppearanceSettings.svelte` — import + render ContextMenuSection
- `src/lib/stores/theme.svelte.js` — call `applyContextMenuPreset()` during theme application

## Not In Scope

- Per-component context menu overrides (all menus share one preset)
- Custom color overrides (colors follow the active theme)
- Import/export of context menu presets (can add later)
