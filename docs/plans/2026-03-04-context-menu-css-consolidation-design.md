# Context Menu CSS Consolidation — Design

> **Goal:** Extract duplicated context menu CSS from 10 components into a shared stylesheet, standardise class names.

## Problem

10 components independently define nearly identical `.context-menu` / `.context-menu-item` CSS. Changing the look of context menus requires editing 10 files. Class names are inconsistent (`.context-item` vs `.context-menu-item`, `.context-separator` vs `.context-menu-divider`).

## Affected Components

| Group | Components | Current class names |
|-------|-----------|-------------------|
| Lens (4) | TabContextMenu, FileContextMenu, EditorContextMenu, BrowserTabBar | `.context-item`, `.context-separator` |
| Sidebar (4) | ChatList, SessionPanel, ProjectStrip, ChatSessionDropdown | `.context-menu-item` |
| Terminal (2) | TerminalTabs, TerminalContextMenu | `.context-menu-item`, `.context-menu-divider` |

## Solution

### Shared CSS file: `src/styles/context-menu.css`

Provides base classes imported by each component:

- `.context-menu` — fixed positioning, `var(--bg-elevated)`, border, shadow, padding, `z-index: 10000`
- `.context-menu-item` — flex layout, padding `6px 12px`, font, cursor, hover state (`var(--bg-hover)`)
- `.context-menu-item.danger` — danger color + hover
- `.context-menu-item:disabled` — muted/no-pointer state
- `.context-menu-divider` — 1px separator

### Class name standardisation

All components adopt the same names:

- `.context-item` → `.context-menu-item` (4 Lens components)
- `.context-separator` → `.context-menu-divider` (4 Lens components)
- `.context-shortcut` — kept as-is (Lens-only, no conflict)
- `.context-danger` → `.context-menu-item.danger` (FileContextMenu)

### Per-component overrides (stay in component `<style>`)

- **Lens menus:** `justify-content: space-between` (shortcut alignment), `-webkit-app-region: no-drag`
- **Sidebar menus:** `gap: 8px` (icon spacing), `font-size: 13px`
- **Terminal menus:** `border-radius: 4px` on items, `.item-label`/`.item-shortcut` children, `padding: 6px 10px`

### Z-index standardisation

All menus use `z-index: 10000` (currently mixed 10000/10002/10003 with no reason for variation).

## Approach

Shared CSS file with `@import` — no HTML structure changes, no new Svelte components. Each component imports the shared file and only defines local overrides.

## Not in scope

- Refactoring context menu HTML into a shared Svelte component
- Adding new context menu features
- Changing visual appearance (this is a pure consolidation)
