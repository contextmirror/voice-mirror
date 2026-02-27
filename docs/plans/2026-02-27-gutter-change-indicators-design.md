# Inline Gutter Change Indicators — Design

> **Date:** 2026-02-27
> **Branch:** feature/lens
> **IDE-GAPS.md ref:** Gap #1 (Inline gutter change indicators), partial #2 (hunk-level revert)

## Goal

Show colored bars in the editor gutter indicating which lines have been added, modified, or deleted since the last git commit. Clicking a bar opens an inline peek widget with the original content and a "Revert Change" button. Matches VS Code's "Quick Diff" / dirty diff feature.

## Architecture

A pure CodeMirror 6 extension in `src/lib/editor-git-gutter.js`. Self-contained — owns its own StateField, gutter, ViewPlugin, and peek widget. No new stores, no new Rust commands, no new npm packages.

### Data Flow

```
File opens → ViewPlugin fetches HEAD content via getFileGitContent()
           → Myers line diff (original vs current)
           → StateEffect dispatched → StateField updated
           → gutter() renders colored bars

User edits → ViewPlugin sees docChanged
           → 200ms debounce
           → Recompute diff → StateEffect → gutter updates

User saves → FileEditor re-fetches original content
           → Recompute diff (handles staged changes)

User clicks gutter bar → Peek widget appears below change
                        → Shows original hunk + "Revert Change" button
                        → Revert replaces current hunk with original lines
```

### Three Visual States

| State | Appearance | CSS Class | Color | When |
|-------|-----------|-----------|-------|------|
| Added | 3px solid green bar | `.cm-git-added` | `var(--ok)` | Lines in current but not original |
| Modified | 3px solid blue bar | `.cm-git-modified` | `var(--accent)` | Lines differ between original and current |
| Deleted | Red triangle (CSS border trick) | `.cm-git-deleted` | `var(--danger)` | Lines in original but removed |

Bars render in a dedicated gutter column between line numbers and fold gutter.

### Peek Widget

Clicking a gutter marker opens an inline block decoration below the change:
- Header: "N of M changes" + prev/next arrows + close (Escape)
- Body: Side-by-side hunk view (original in red, current in green) — plain HTML, not a CM editor
- Action: "Revert Change" button replaces current hunk with original lines

### Constraints

- **File size gate:** Skip for files >10,000 lines
- **Debounce:** 200ms after last keystroke before recomputing diff
- **New files:** No gutter (no original to diff against — `isNew: true` from API)
- **External/read-only files:** No gutter (not in project git)
- **Binary files:** No gutter

## Files

| File | Change |
|------|--------|
| `src/lib/editor-git-gutter.js` | **New** — CM6 extension |
| `src/lib/editor-extensions.js` | Wire git gutter into `buildEditorExtensions()` |
| `src/components/lens/FileEditor.svelte` | Pass callback, re-fetch on save |
| `src/styles/editor.css` | Gutter bar + peek widget styles |
| `test/components/editor-git-gutter.test.cjs` | Source-inspection tests |

No Rust changes — `getFileGitContent` API already exists.

## What This Closes

- IDE-GAPS.md Gap #1: Inline gutter change indicators (❌ → ✅)
- IDE-GAPS.md Gap #2 partial: Hunk-level revert (not staging)

## What Remains After This

- Hunk-level staging (stage individual chunks from gutter — separate feature)
- Secondary decorations (index vs HEAD — VS Code only, low priority)
- Overview ruler markers (low priority)
