# Terminal Rendering Bug — Provider Switch Artifacts

**Status:** FIXED
**Component:** ghostty-web fork (E:\Projects\ghostty-web) + Terminal.svelte
**Symptoms:** Visual artifacts (missing sidebars, duplicate lines, broken status bars) after AI provider switching. Resizing/jiggling the terminal fixes it.

## Fix Applied (2026-02-24)

**Root cause was NOT dirty-row tracking** — it was **partial TUI frames**. The TUI sends 8-14 separate `write()` calls with escape sequence fragments during startup. Each intermediate WASM buffer state is genuinely garbled (half-cleared screen, mispositioned cursor). ForceAll rendering faithfully paints this garbage.

**Solution:** Multi-layered fix — freeze during switch + automated resize jiggle on reveal.

**What actually fixed it:** An automated -1/+1 row resize after the reveal delay. This forces the full WASM terminal resize path (text reflow + `DirtyState.FULL` + canvas dimension reset) which consistently produces clean output. Every other approach (forceAll, forceDirty, freeze/unfreeze alone) failed because they don't trigger WASM text reflow.

- `Terminal.svelte`: `term.freeze()` after `term.reset()` in switch handler (prevents painting partial frames)
- `Terminal.svelte`: Second `term.reset()` + `term.freeze()` when 'start' arrives (wipes old provider's leaked output)
- `Terminal.svelte`: Drop 'exit' event during switch (prevents old provider pollution)
- `Terminal.svelte`: **Automated jiggle** — `term.resize(cols, rows-1)` then `term.resize(cols, rows)` on next rAF after reveal
- `ghostty-web` fork: ForceAll-Until-Quiet + `forceDirty()` + stale wasmTerm ref fix (commit afa77d9)

## Problem Description

When switching AI providers (e.g., Claude Code → OpenCode, or restarting the same provider), the terminal displays visual artifacts. The TUI app's UI appears garbled — missing sidebars, duplicate/overlapping lines, broken status bars, stale pixels from the previous provider. Manually resizing the terminal (even by 1px) instantly fixes the display.

This has been the most persistent and user-facing bug in Voice Mirror. Multiple fix attempts from the Terminal.svelte side have failed. The root cause is in ghostty-web's rendering pipeline.

## Architecture Overview

```
Terminal.svelte (Voice Mirror)
  → ghostty-web Terminal class (lib/terminal.ts)
    → GhosttyTerminal WASM wrapper (lib/ghostty.ts)
      → libghostty-vt Zig WASM (immutable, compiled binary)
    → CanvasRenderer (lib/renderer.ts)
    → SelectionManager (lib/selection-manager.ts)
    → InputHandler (lib/input-handler.ts)
```

### Provider Switch Flow

1. User switches AI provider in Voice Mirror
2. `ai-provider-switching` DOM event fires synchronously
3. Terminal.svelte handler: hides container via `visibility: hidden`, calls `term.reset()`
4. `reset()` frees old WASM terminal, creates new one, resets renderer, sets `_forceAllFrames = 30`
5. New CLI process starts, outputs TUI startup sequences
6. After ~500ms, `ai-output` `'start'` event fires
7. Terminal.svelte: calls `fitTerminal()`, `resizePtyIfChanged()`, `term.refresh()`, reveals container

## Root Cause Analysis

### Primary: `_forceAllFrames` Expires Too Early

In `terminal.ts` `reset()` (line 774):
```typescript
this._forceAllFrames = 30; // ~500ms at 60fps
```

After reset, the render loop forces full redraws for 30 frames. But TUI apps (Claude Code, OpenCode) continue sending data well beyond 500ms during startup. After `_forceAllFrames` reaches 0, the renderer falls back to dirty-row tracking (`wasmTerm.isRowDirty(y)`).

**The dirty-row tracking has gaps.** The WASM layer's dirty tracking is optimized for normal operation — it marks rows dirty when individual cells change. But TUI startup involves rapid scroll-region operations, cursor repositioning, and bulk rewrites that can change content without marking all affected rows as dirty.

### Why Resize Fixes It

`terminal.resize()` (line 663) calls `wasmTerm.resize()` (ghostty.ts line 351):
```typescript
resize(cols: number, rows: number): void {
    if (cols === this._cols && rows === this._rows) return; // dimension guard!
    this._cols = cols;
    this._rows = rows;
    this.exports.ghostty_terminal_resize(this.handle, cols, rows);
    // ...
}
```

`ghostty_terminal_resize` in the Zig WASM unconditionally sets `DirtyState.FULL`. This forces every row to be repainted on the next frame. The dimension guard at the top prevents this from working when cols/rows haven't changed.

### Secondary: Stale wasmTerm References After reset()

`reset()` frees the old WASM terminal and creates a new one:
```typescript
this.wasmTerm.free();        // Free old terminal
this.wasmTerm = this.ghostty!.createTerminal(...); // Create new one
```

But `SelectionManager` and `InputHandler` capture `wasmTerm` in their constructors:
```typescript
// selection-manager.ts line 38
private wasmTerm: GhosttyTerminal;
// Stores reference at construction time — never updated after reset()

// input-handler.ts mouseConfig closure
const mouseConfig: MouseTrackingConfig = {
    isAlternateScreen: () => wasmTerm.isAlternateScreen(),
    hasMouseTracking: () => wasmTerm.hasMouseTracking(),
    // These closures close over the OLD wasmTerm reference
};
```

After `reset()`, these components call methods on the freed WASM terminal. WASM memory reuse may not cause a crash, but the return values are unreliable. Mouse tracking queries return stale values, leading to incorrect event routing.

## What We've Already Tried (From Terminal.svelte Side)

All of these approaches failed — the issue is in ghostty-web, not the integration layer:

1. **Extra `term.refresh()` calls** — refresh() calls `renderer.resize()` + forceAll render, but the TUI keeps sending data after the refresh
2. **`fitTerminal()` + `resizePtyIfChanged()` after `term.reset()`** — dimensions don't change, so the WASM dimension guard no-ops
3. **Double rAF delays** — timing doesn't help because the root issue is dirty-tracking gaps, not timing
4. **`term.freeze()` / `term.unfreeze()`** — prevents rendering during startup but the unfreeze does one forceAll render, then falls back to broken dirty tracking
5. **Longer hide delays (500ms+)** — the TUI outputs data continuously; there's no clean "done" signal
6. **Multiple `_forceAllFrames` values** — increasing from 30 to higher values helps but doesn't eliminate the issue because it's a fixed budget, not demand-driven

## Proposed Fixes (In ghostty-web Fork)

### Fix 1: Add `forceDirty()` Method (Essential)

Add a new method to `GhosttyTerminal` that calls `ghostty_terminal_resize` with the current dimensions, bypassing the dimension guard:

```typescript
// ghostty.ts — GhosttyTerminal class
forceDirty(): void {
    // Call resize with current dimensions — the WASM layer unconditionally
    // sets DirtyState.FULL on resize, which is exactly what we need.
    // We bypass the dimension guard by calling the WASM export directly.
    this.exports.ghostty_terminal_resize(this.handle, this._cols, this._rows);
}
```

Expose this on Terminal:
```typescript
// terminal.ts
forceDirty(): void {
    if (this.wasmTerm) {
        this.wasmTerm.forceDirty();
    }
}
```

Then Terminal.svelte can call `term.forceDirty()` after the TUI has had time to render, guaranteeing a full repaint.

### Fix 2: ForceAll-Until-Quiet (Best Long-Term Fix)

Replace the fixed frame counter with a demand-driven approach:

```typescript
// terminal.ts — in the render loop
private _forceAllUntilQuiet: boolean = false;
private _quietFrames: number = 0;
private static readonly QUIET_THRESHOLD = 5; // 5 frames of no dirty rows

// In startRenderLoop():
const dirtyState = this.wasmTerm!.update();
const hasDirtyRows = dirtyState !== DirtyState.NONE;

if (this._forceAllUntilQuiet) {
    if (hasDirtyRows) {
        this._quietFrames = 0;
    } else {
        this._quietFrames++;
        if (this._quietFrames >= Terminal.QUIET_THRESHOLD) {
            this._forceAllUntilQuiet = false;
            this._quietFrames = 0;
        }
    }
    // Force full render while waiting for quiet
    this.renderer!.render(this.wasmTerm!, true, ...);
} else {
    this.renderer!.render(this.wasmTerm!, false, ...);
}
```

In `reset()`:
```typescript
this._forceAllUntilQuiet = true;
this._quietFrames = 0;
```

This keeps forcing full redraws until the TUI stops updating for 5 consecutive frames (~83ms of silence), which reliably indicates startup is complete.

### Fix 3: Fix Stale wasmTerm References (Important)

Update `reset()` to refresh references held by SelectionManager and InputHandler:

```typescript
// terminal.ts reset() — after creating new wasmTerm
if (this.selectionManager) {
    this.selectionManager.updateWasmTerm(this.wasmTerm);
}
if (this.inputHandler) {
    this.inputHandler.updateWasmTerm(this.wasmTerm);
}
```

Add `updateWasmTerm()` to both classes:
```typescript
// selection-manager.ts
public updateWasmTerm(wasmTerm: GhosttyTerminal): void {
    this.wasmTerm = wasmTerm;
}

// input-handler.ts — needs to rebuild mouseConfig closure
public updateWasmTerm(wasmTerm: GhosttyTerminal): void {
    // Rebuild the mouse tracking config with the new wasmTerm reference
    this.mouseConfig = {
        isAlternateScreen: () => wasmTerm.isAlternateScreen(),
        hasMouseTracking: () => wasmTerm.hasMouseTracking(),
        // ... other config
    };
}
```

### Fix 4: Remove Dimension Guard from GhosttyTerminal.resize() (Alternative)

An alternative to Fix 1 — remove or weaken the dimension guard:
```typescript
resize(cols: number, rows: number): void {
    // Always call WASM resize — it sets DirtyState.FULL which we need
    // for provider switches even when dimensions don't change
    this._cols = cols;
    this._rows = rows;
    this.exports.ghostty_terminal_resize(this.handle, cols, rows);
    this.invalidateBuffers();
    this.initCellPool();
}
```

**Trade-off:** This makes every `resize()` call go through WASM even for no-ops. The cost is minimal (single WASM call) but changes the existing contract. Fix 1 (`forceDirty()`) is cleaner because it explicitly communicates intent.

## Priority Order

1. **Fix 2** (ForceAll-Until-Quiet) — eliminates the root cause permanently
2. **Fix 1** (forceDirty) — provides immediate escape hatch from Terminal.svelte
3. **Fix 3** (Stale references) — prevents subtle bugs with mouse interaction after reset
4. **Fix 4** (Remove guard) — only if Fix 1 is insufficient

## Implementation Notes

- All fixes are in the TypeScript layer of ghostty-web (patchable) — the Zig WASM binary is unchanged
- After making changes: `bun run build:lib` → commit source + dist → push → `npm install` in Voice Mirror
- Run `bun test` (328 tests) to verify nothing breaks
- The `refresh()` method already exists and partially addresses this, but it only does ONE full render. The issue is that the TUI keeps changing content after that render.

## Test Plan

1. Start Voice Mirror with Claude Code
2. Switch to OpenCode — verify no artifacts
3. Switch back to Claude Code — verify no artifacts
4. Rapid switching (click between providers quickly) — verify no artifacts
5. Resize terminal during/after switch — verify proper rendering
6. Mouse interaction after switch — verify clicks/scrolling work correctly
7. Selection after switch — verify text selection works

## Related Files

| File | Location | Role |
|------|----------|------|
| `lib/terminal.ts` | ghostty-web | Terminal class with reset(), resize(), render loop |
| `lib/ghostty.ts` | ghostty-web | WASM wrapper with dimension guard |
| `lib/renderer.ts` | ghostty-web | CanvasRenderer with dirty-row optimization |
| `lib/selection-manager.ts` | ghostty-web | Selection with stale wasmTerm reference |
| `lib/input-handler.ts` | ghostty-web | Input with stale mouseConfig closure |
| `Terminal.svelte` | Voice Mirror | Integration layer, provider switch handler |
| `lib/stores/ai-status.svelte.js` | Voice Mirror | Fires `ai-provider-switching` event |
