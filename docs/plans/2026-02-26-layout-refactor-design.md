# Layout Refactor: VS Code-Style Terminal

**Date:** 2026-02-26
**Branch:** feature/lens

## Problem

The terminal occupies a full-width bottom panel spanning all three columns (chat, editor, file tree). VS Code places the terminal in the center column only, below the editor. This wastes horizontal space and prevents future use of the bottom-left area for features like Pixel Agents.

## New Layout

```
| Chat         | Editor/Preview    | File Tree |
|              |-------------------|           |
| Pixel Agents | Terminal          |           |
| (placeholder)|                   |           |
```

Chat and File Tree extend full height. Terminal shares the center column with the editor. Bottom-left holds a placeholder for Pixel Agents.

## SplitPanel Nesting

### Current

```
Vertical(0.75): [everything-top] | [terminal-full-width]
  └─ everything-top: Horizontal(0.18): [chat] | [center+right]
       └─ center+right: Horizontal(0.78): [editor/preview] | [file-tree]
```

### New

```
Horizontal(0.18): [left-column] | [center+right]
  └─ left-column:   Vertical(0.80): [chat] | [pixel-agents-placeholder]
  └─ center+right:  Horizontal(0.78): [center-column] | [file-tree]
       └─ center-column: Vertical(0.75): [editor/preview] | [terminal]
```

## Split Ratios

| Variable | Value | Controls |
|----------|-------|----------|
| `chatRatio` | 0.18 | Left column vs center+right (unchanged) |
| `chatVerticalRatio` | 0.80 | Chat vs Pixel Agents placeholder |
| `centerRatio` | 0.75 | Editor/preview vs terminal (was `verticalRatio`) |
| `previewRatio` | 0.78 | Center column vs file tree (unchanged) |

## Toggle Terminal

`layoutStore.showTerminal` and `layoutStore.toggleTerminal()` are unchanged. The `collapseB={!layoutStore.showTerminal}` prop moves from the outermost vertical SplitPanel to the center-column vertical SplitPanel. The titlebar button (`App.svelte:411-421`) and command palette command (`commands.svelte.js:229-232`) need no changes.

## Pixel Agents Placeholder

Simple div with muted text and subtle icon. Styled to match chat area background. The left-column vertical SplitPanel allows future resizing between chat and Pixel Agents.

## Files Changed

| File | Change |
|------|--------|
| `src/components/lens/LensWorkspace.svelte` | Restructure SplitPanel nesting, rename `verticalRatio` → `centerRatio`, add `chatVerticalRatio`, add placeholder div, adjust CSS |
| `test/components/lens-workspace.test.cjs` | Update assertions for new nesting pattern, ratio name change |

## Files NOT Changed (verified)

| File | Why |
|------|-----|
| `src/lib/stores/layout.svelte.js` | `showTerminal` / `toggleTerminal()` unchanged |
| `src/App.svelte` | Toggle button calls `layoutStore.toggleTerminal()` — unchanged |
| `src/lib/commands.svelte.js` | Command palette "Toggle Terminal" — unchanged |
| `src/lib/stores/config.svelte.js` | `showTerminal: false` default — unchanged |
| `src/lib/stores/terminal-tabs.svelte.js` | Terminal tab management — self-contained |
| `src/components/terminal/TerminalTabs.svelte` | Just mounted in different slot |
| `src/components/terminal/Terminal.svelte` | Internal terminal component — unchanged |
| `src/components/terminal/ShellTerminal.svelte` | Shell terminal — unchanged |
| `src/lib/stores/dev-server-manager.svelte.js` | Adds tabs to terminal store — unchanged |
| `src/components/lens/StatusDropdown.svelte` | Unhides terminal tabs — unchanged |
