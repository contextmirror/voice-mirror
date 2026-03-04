# Context Menu CSS Consolidation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract duplicated context menu CSS from 10 components into `src/styles/context-menu.css`, standardise class names to `.context-menu-item` / `.context-menu-divider`.

**Architecture:** Create a shared CSS file with base menu/item/divider/danger/disabled styles. Each component `@import`s it and keeps only component-specific overrides. Rename `.context-item` → `.context-menu-item` and `.context-separator` → `.context-menu-divider` in the 4 Lens components. Standardise z-index to 10000.

**Tech Stack:** Svelte 5, CSS custom properties, `@import` in `<style>` blocks

---

### Task 1: Create shared context-menu.css

**Files:**
- Create: `src/styles/context-menu.css`

**Step 1: Create the shared CSS file**

```css
/* Shared context menu styles — imported by all context menu components.
   Override specific properties in component <style> blocks as needed. */

.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  font-family: var(--font-family);
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--text);
  font-size: 12px;
  font-family: var(--font-family);
  cursor: pointer;
  text-align: left;
}

.context-menu-item:hover {
  background: var(--accent);
  color: var(--bg);
}

.context-menu-item:disabled {
  color: var(--muted);
  cursor: default;
  opacity: 0.5;
}

.context-menu-item:disabled:hover {
  background: none;
  color: var(--muted);
}

.context-menu-item.danger {
  color: var(--danger);
}

.context-menu-item.danger:hover {
  background: var(--danger);
  color: var(--bg);
}

.context-menu-shortcut {
  color: var(--muted);
  font-size: 11px;
  margin-left: 24px;
}

.context-menu-item:hover:not(:disabled) .context-menu-shortcut {
  color: inherit;
  opacity: 0.7;
}

.context-menu-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--border);
}
```

**Step 2: Commit**

```bash
git add src/styles/context-menu.css
git commit -m "refactor: create shared context-menu.css base styles"
```

---

### Task 2: Migrate TabContextMenu.svelte

**Files:**
- Modify: `src/components/lens/TabContextMenu.svelte`

**Step 1: Rename HTML classes**

In the `<template>` section, rename:
- `class="context-item"` → `class="context-menu-item"` (all instances)
- `class="context-separator"` → `class="context-menu-divider"` (all instances)
- `class="context-shortcut"` → `class="context-menu-shortcut"` (all instances)

**Step 2: Replace CSS block**

Replace the entire context menu CSS (lines ~200-258) with:

```css
@import '../../styles/context-menu.css';

/* TabContextMenu overrides */
.context-menu {
  min-width: 200px;
  max-width: 280px;
  -webkit-app-region: no-drag;
}

.context-menu-item {
  justify-content: space-between;
  -webkit-app-region: no-drag;
}

.context-menu-item:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg);
}
```

**Step 3: Run tests**

```bash
npm test
```

**Step 4: Commit**

```bash
git add src/components/lens/TabContextMenu.svelte
git commit -m "refactor: migrate TabContextMenu to shared context-menu.css"
```

---

### Task 3: Migrate FileContextMenu.svelte

**Files:**
- Modify: `src/components/lens/FileContextMenu.svelte`

**Step 1: Rename HTML classes**

In the `<template>` section, rename:
- `class="context-item"` → `class="context-menu-item"` (all instances)
- `class="context-item context-danger"` → `class="context-menu-item danger"` (delete button)
- `class="context-separator"` → `class="context-menu-divider"` (all instances)
- `class="context-shortcut"` → `class="context-menu-shortcut"` (all instances)

**Step 2: Replace CSS block**

Replace the entire context menu CSS (lines ~199-256) with:

```css
@import '../../styles/context-menu.css';

/* FileContextMenu overrides */
.context-menu {
  min-width: 200px;
  max-width: 280px;
  -webkit-app-region: no-drag;
}

.context-menu-item {
  justify-content: space-between;
  -webkit-app-region: no-drag;
}
```

**Step 3: Run tests**

```bash
npm test
```

**Step 4: Commit**

```bash
git add src/components/lens/FileContextMenu.svelte
git commit -m "refactor: migrate FileContextMenu to shared context-menu.css"
```

---

### Task 4: Migrate EditorContextMenu.svelte

**Files:**
- Modify: `src/components/lens/EditorContextMenu.svelte`

**Step 1: Rename HTML classes**

In the `<template>` section, rename:
- `class="context-item"` → `class="context-menu-item"` (all instances)
- `class="context-item-disabled"` — change to use `:disabled` attribute on the button instead of this class (matches the shared CSS pattern)
- `class="context-separator"` → `class="context-menu-divider"` (all instances)
- `class="context-shortcut"` → `class="context-menu-shortcut"` (all instances)

**Step 2: Replace CSS block**

Replace the entire context menu CSS (lines ~267-334) with:

```css
@import '../../styles/context-menu.css';

/* EditorContextMenu overrides */
.context-menu {
  min-width: 200px;
  max-width: 280px;
  -webkit-app-region: no-drag;
}

.context-menu-item {
  justify-content: space-between;
  -webkit-app-region: no-drag;
}
```

Note: If `.context-item-disabled` is applied via JS class toggling rather than the `disabled` attribute, keep a local override:

```css
.context-menu-item.disabled {
  color: var(--muted);
  cursor: default;
  opacity: 0.4;
}

.context-menu-item.disabled:hover {
  background: none;
  color: var(--text);
}

.context-menu-item.disabled:hover .context-menu-shortcut {
  color: var(--muted);
  opacity: 1;
}
```

**Step 3: Run tests**

```bash
npm test
```

**Step 4: Commit**

```bash
git add src/components/lens/EditorContextMenu.svelte
git commit -m "refactor: migrate EditorContextMenu to shared context-menu.css"
```

---

### Task 5: Migrate BrowserTabBar.svelte

**Files:**
- Modify: `src/components/lens/BrowserTabBar.svelte`

**Step 1: Rename HTML classes**

In the `<template>` section, rename:
- `class="context-item"` → `class="context-menu-item"` (all instances)

**Step 2: Replace CSS block**

Replace the context menu CSS (lines ~210-249) with:

```css
@import '../../styles/context-menu.css';

/* BrowserTabBar context menu — no overrides needed */

/* Keep .context-backdrop as-is (component-specific) */
.context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
```

**Step 3: Run tests**

```bash
npm test
```

**Step 4: Commit**

```bash
git add src/components/lens/BrowserTabBar.svelte
git commit -m "refactor: migrate BrowserTabBar to shared context-menu.css"
```

---

### Task 6: Migrate ChatList.svelte

**Files:**
- Modify: `src/components/sidebar/ChatList.svelte`

**Step 1: Replace CSS block**

Class names already match (`.context-menu-item`). Replace context menu CSS (lines ~561-612) with:

```css
@import '../../styles/context-menu.css';

/* ChatList overrides */
.context-menu {
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.context-menu-item {
  gap: 8px;
  font-size: 13px;
  transition: background var(--duration-fast) var(--ease-out);
}

.context-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.context-menu-item.danger:hover {
  background: var(--danger-subtle);
  color: var(--danger);
}

.context-menu-item svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
```

Keep the `@media (prefers-reduced-motion)` rule but update the selector from `.context-menu-item` — it stays since it references local component classes too.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/sidebar/ChatList.svelte
git commit -m "refactor: migrate ChatList to shared context-menu.css"
```

---

### Task 7: Migrate SessionPanel.svelte

**Files:**
- Modify: `src/components/sidebar/SessionPanel.svelte`

**Step 1: Replace CSS block**

Class names already match. Replace context menu CSS (lines ~463-513) with:

```css
@import '../../styles/context-menu.css';

/* SessionPanel overrides */
.context-menu {
  min-width: 120px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.context-menu-item {
  gap: 8px;
  font-size: 13px;
  transition: background var(--duration-fast) var(--ease-out);
}

.context-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.context-menu-item.danger:hover {
  background: var(--danger-subtle);
  color: var(--danger);
}

.context-menu-item svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
```

Keep `@media (prefers-reduced-motion)` rule.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/sidebar/SessionPanel.svelte
git commit -m "refactor: migrate SessionPanel to shared context-menu.css"
```

---

### Task 8: Migrate ProjectStrip.svelte

**Files:**
- Modify: `src/components/sidebar/ProjectStrip.svelte`

**Step 1: Replace CSS block**

Class names already match. Replace context menu CSS (lines ~173-226) with:

```css
@import '../../styles/context-menu.css';

/* ProjectStrip overrides */
.context-menu {
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.context-menu-item {
  gap: 8px;
  font-size: 13px;
  transition: background var(--duration-fast) var(--ease-out);
}

.context-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.context-menu-item.danger:hover {
  background: var(--danger-subtle);
  color: var(--danger);
}

.context-menu-item svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
```

Keep `@media (prefers-reduced-motion)` rule.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/sidebar/ProjectStrip.svelte
git commit -m "refactor: migrate ProjectStrip to shared context-menu.css"
```

---

### Task 9: Migrate ChatSessionDropdown.svelte

**Files:**
- Modify: `src/components/chat/ChatSessionDropdown.svelte`

**Step 1: Replace CSS block**

Class names already match. Replace context menu CSS (lines ~742-793) with:

```css
@import '../../styles/context-menu.css';

/* ChatSessionDropdown overrides */
.context-menu {
  min-width: 120px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.context-menu-item {
  gap: 8px;
  font-size: 13px;
  transition: background var(--duration-fast) var(--ease-out);
}

.context-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.context-menu-item.danger:hover {
  background: var(--danger-subtle);
  color: var(--danger);
}

.context-menu-item svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}
```

Keep `@media (prefers-reduced-motion)` rule.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/chat/ChatSessionDropdown.svelte
git commit -m "refactor: migrate ChatSessionDropdown to shared context-menu.css"
```

---

### Task 10: Migrate TerminalTabs.svelte

**Files:**
- Modify: `src/components/terminal/TerminalTabs.svelte`

**Step 1: Replace CSS block**

Replace the base context menu CSS (lines ~1007-1040) with import + overrides. Keep all the provider-specific CSS (`.context-menu.wide`, `.context-menu-group-label`, `.provider-item`, `.ctx-*` classes) as local overrides:

```css
@import '../../styles/context-menu.css';

/* TerminalTabs overrides */
.context-menu {
  padding: 4px;
}

.context-menu-item {
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  transition: background 0.1s;
}

.context-menu-item:hover {
  background: rgba(255,255,255,0.06);
  color: var(--text);
}

.context-menu-item.danger {
  color: var(--danger, #ef4444);
}

.context-menu-item.danger:hover {
  background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
}

.context-menu-divider {
  margin: 4px 0;
}

/* Provider submenu — keep as-is */
.context-menu.wide { min-width: 200px; }
.context-menu-group-label { ... keep existing ... }
.context-menu-item.provider-item { ... keep existing ... }
.context-menu-item.current { ... keep existing ... }
.ctx-provider-icon { ... keep existing ... }
.ctx-provider-icon-inner { ... keep existing ... }
.ctx-provider-label { ... keep existing ... }
.ctx-check { ... keep existing ... }
.ctx-provider-status { ... keep existing ... }
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/terminal/TerminalTabs.svelte
git commit -m "refactor: migrate TerminalTabs to shared context-menu.css"
```

---

### Task 11: Migrate TerminalContextMenu.svelte

**Files:**
- Modify: `src/components/terminal/TerminalContextMenu.svelte`

**Step 1: Replace CSS block**

Replace context menu CSS (lines ~207-262) with:

```css
@import '../../styles/context-menu.css';

/* TerminalContextMenu overrides */
.context-menu {
  min-width: 200px;
  padding: 4px;
}

.context-menu-item {
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  transition: background 0.1s;
}

.context-menu-item:hover {
  background: rgba(255,255,255,0.06);
  color: var(--text);
}

.context-menu-item.danger {
  color: var(--danger, #ef4444);
}

.context-menu-item.danger:hover {
  background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
}

.context-menu-divider {
  margin: 4px 0;
}

.item-label {
  flex: 1;
}

.item-shortcut {
  font-size: 11px;
  color: var(--muted);
  margin-left: auto;
}
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/components/terminal/TerminalContextMenu.svelte
git commit -m "refactor: migrate TerminalContextMenu to shared context-menu.css"
```

---

### Task 12: Update CODE-AUDIT.md

**Files:**
- Modify: `docs/CODE-AUDIT.md`

**Step 1: Mark context menu CSS as done**

Change:
```
- [ ] **Context menu CSS** (6+ components)
```
To:
```
- [x] **Context menu CSS** (10 components) — DONE (commit TBD)
  - Shared `src/styles/context-menu.css`, 10 components migrated, class names standardised
```

**Step 2: Commit**

```bash
git add docs/CODE-AUDIT.md
git commit -m "docs: mark context menu CSS consolidation as done"
```
