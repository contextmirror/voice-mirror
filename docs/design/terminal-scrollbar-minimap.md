# Terminal Scrollbar Minimap -- Error Markers Design

## Context

VS Code shows colored markers on the terminal scrollbar (the "overview ruler") to indicate command outcomes: red for errors (non-zero exit), green/blue for success, and default gray for running commands. These markers give users an instant visual map of where problems occurred in their terminal history without needing to scroll through output.

VS Code achieves this via xterm.js's built-in `registerDecoration()` API with `overviewRulerOptions`, which renders colored blocks directly into xterm.js's scrollbar canvas. Voice Mirror uses ghostty-web -- a WASM canvas-based terminal emulator -- which has no decoration or marker API. ghostty-web renders everything onto a single `<canvas>` element, including its own scrollbar (a thin overlay rendered within the canvas, not a DOM element). There is no extension point for adding markers to the scrollbar.

A custom DOM overlay is needed to bring this capability to Voice Mirror.

## VS Code Reference

### Implementation files

- **`src/vs/workbench/contrib/terminal/browser/xterm/decorationAddon.ts`** -- main addon that registers decorations for shell commands
- **`src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts`** -- configures xterm.js with `scrollbar.overviewRuler` options (14px wide, top border enabled)
- **`src/vs/workbench/contrib/terminal/common/terminalColorRegistry.ts`** -- defines decoration colors

### How VS Code does it

```typescript
// decorationAddon.ts, line ~297
const decoration = this._terminal.registerDecoration({
  marker,
  overviewRulerOptions: this._showOverviewRulerDecorations
    ? (beforeCommandExecution
      ? { color, position: 'left' }
      : { color, position: command?.exitCode ? 'right' : 'left' })
    : undefined
});
```

### Color scheme

| State | Color (dark theme) | Color (light theme) | Overview ruler position |
|-------|-------------------|--------------------|-----------------------|
| Running / default | `#ffffff40` | `#00000040` | `left` |
| Success (exit 0) | `#1B81A8` | `#2090D3` | `left` |
| Error (exit != 0) | `#F14C4C` | `#E51400` | `right` |

### Shell integration dependency

VS Code's markers depend on **shell integration** -- a capability where the shell (bash, zsh, pwsh) emits special escape sequences (OSC 633) to mark prompt start, command start, command end + exit code. This gives xterm.js structured knowledge of where commands begin and end, and whether they succeeded.

Voice Mirror does not have shell integration. Our terminals are raw PTY sessions. This means we must rely on alternative detection strategies (see "Error sources" below).

## Proposed Architecture for Voice Mirror

### Overview

Create a thin vertical DOM strip (`TerminalScrollbarOverlay.svelte`) positioned absolutely over the terminal's right edge, rendering colored marker blocks that map to notable lines in the terminal buffer. Track markers in a per-shell reactive store (`terminal-markers.svelte.js`).

### Component structure

```
TerminalPanel.svelte
  +-- terminal-content
       +-- Terminal.svelte (contains ghostty-web canvas)
       +-- TerminalScrollbarOverlay.svelte (absolute positioned, right edge)
```

The overlay sits beside (not on top of) ghostty-web's canvas-rendered scrollbar. ghostty-web's FitAddon already reserves 15px on the right for a scrollbar area (`DEFAULT_SCROLLBAR_WIDTH = 15` in `lib/addons/fit.ts`). The overlay occupies the rightmost ~12px of this reserved space.

### Marker data model

```javascript
// terminal-markers.svelte.js
/**
 * @typedef {Object} TerminalMarker
 * @property {number} line        - Absolute buffer line (0 = top of scrollback)
 * @property {'error'|'warning'|'success'|'info'} type - Marker category
 * @property {string} message     - Tooltip text (e.g. "Exit code 1" or "Error: ENOENT")
 * @property {number} timestamp   - When the marker was created
 */

// Store shape: Map<shellId, TerminalMarker[]>
```

### Rendering logic

The overlay is a `<div>` with `position: absolute; right: 0; top: 0; bottom: 0; width: 12px`. Each marker renders as a tiny colored block:

```
markerPixelY = (marker.line / totalBufferLines) * overlayHeight
```

Where:
- `marker.line` is the absolute buffer position (scrollback + viewport)
- `totalBufferLines` = `term.buffer.active.length` (scrollback lines + visible rows)
- `overlayHeight` = overlay element's `clientHeight`

Markers are rendered as 2px-tall colored `<div>` blocks (or a single `<canvas>` for performance if marker count is high). Colors map to Voice Mirror's theme tokens:

| Marker type | CSS variable | Fallback |
|-------------|-------------|----------|
| `error` | `var(--danger)` | `#d55e00` |
| `warning` | `var(--warn)` | `#e69f00` |
| `success` | `var(--ok)` | `#0072b2` |
| `info` | `var(--accent)` | `#56b4e9` |

### Error sources

Since Voice Mirror lacks shell integration (no OSC 633), markers come from two sources:

**1. Shell exit codes (structured)**

Already captured in `Terminal.svelte` line 163:
```javascript
case 'exit':
  term.writeln(`\x1b[33m[Shell exited with code ${data.code ?? '?'}]\x1b[0m`);
```

And in `AiTerminal.svelte` line 265:
```javascript
term.writeln(`\x1b[33m[Process exited with code ${data.code ?? '?'}]\x1b[0m`);
```

When `data.code !== 0`, add an error marker at the current buffer line.

**2. Output pattern matching (heuristic)**

Lightweight regex matching on terminal output to detect error patterns. This runs on each `stdout` chunk:

```javascript
const ERROR_PATTERNS = [
  /^error\b/im,
  /^fatal\b/im,
  /\bERROR\b/,
  /\bFAILED\b/,
  /\bpanic\b/i,
  /^E\d{4}\b/,           // Rust compiler errors (E0308, etc.)
  /\berror\[E\d+\]/,     // Rust error codes in brackets
  /^npm ERR!/m,
  /^SyntaxError\b/m,
  /^TypeError\b/m,
  /^ReferenceError\b/m,
];

const WARNING_PATTERNS = [
  /^warning\b/im,
  /\bWARN\b/,
  /\bwarning\[/,          // Rust warnings
  /^npm warn/im,
];
```

Pattern matching is debounced and rate-limited to avoid performance impact on high-throughput terminal output. Only the first N characters of each output chunk are scanned (e.g., 2000 chars).

### Scroll position sync

ghostty-web exposes buffer state through its xterm.js-compatible API:

- `term.buffer.active.length` -- total lines (scrollback + viewport rows)
- `term.buffer.active.viewportY` -- current scroll offset (NOTE: currently hardcoded to 0 in ghostty-web's `Buffer` class; needs upstream patch or workaround)
- `term.rows` -- visible row count

The viewport indicator (a translucent rectangle showing the currently visible region) can be calculated:

```
viewportTop = (viewportY / totalLines) * overlayHeight
viewportHeight = (visibleRows / totalLines) * overlayHeight
```

**Limitation:** ghostty-web's `Buffer.viewportY` is currently hardcoded to return 0 (see `lib/buffer.ts` line 138-141: `"For now, return 0 (no scrollback navigation implemented yet)"`). This means the viewport indicator cannot track scroll position until ghostty-web exposes the actual viewport offset. The markers themselves are still useful since they show absolute positions in the full buffer.

### Click-to-scroll

Clicking a marker in the overlay should scroll the terminal to that line. ghostty-web does not currently expose a `scrollToLine()` API. Options:

1. **Add `scrollToLine(y)` to ghostty-web** -- requires upstream fork change
2. **Simulate scroll events** -- send synthetic wheel events to scroll to approximate position
3. **Defer** -- implement markers as visual-only first, add click-to-scroll when ghostty-web gains the API

Recommendation: implement visual markers first (Steps 1-4), defer click-to-scroll to a follow-up.

## Implementation Plan

### Step 1: Create `terminal-markers.svelte.js` store

Reactive store tracking markers per shell ID.

```javascript
// src/lib/stores/terminal-markers.svelte.js

function createTerminalMarkersStore() {
  /** @type {Map<string, TerminalMarker[]>} */
  let markersMap = $state(new Map());

  return {
    /** Get markers for a specific shell */
    getMarkers(shellId) {
      return markersMap.get(shellId) ?? [];
    },

    /** Add a marker for a shell */
    addMarker(shellId, marker) {
      const existing = markersMap.get(shellId) ?? [];
      existing.push(marker);
      // Cap at 500 markers per shell to bound memory
      if (existing.length > 500) existing.shift();
      markersMap.set(shellId, existing);
      markersMap = new Map(markersMap); // trigger reactivity
    },

    /** Clear all markers for a shell */
    clearMarkers(shellId) {
      markersMap.delete(shellId);
      markersMap = new Map(markersMap);
    },

    /** Remove a shell entirely (on close) */
    removeShell(shellId) {
      markersMap.delete(shellId);
      markersMap = new Map(markersMap);
    },
  };
}

export const terminalMarkersStore = createTerminalMarkersStore();
```

### Step 2: Create `TerminalScrollbarOverlay.svelte`

Positioned absolutely within the terminal container, rendering markers as colored blocks.

```svelte
<script>
  import { terminalMarkersStore } from '../../lib/stores/terminal-markers.svelte.js';

  let { shellId, totalLines = 0, visibleRows = 0 } = $props();
  let overlayEl = $state(null);
  let overlayHeight = $state(0);

  const markers = $derived(terminalMarkersStore.getMarkers(shellId));

  // Track overlay height for position calculations
  $effect(() => {
    if (!overlayEl) return;
    const observer = new ResizeObserver(([entry]) => {
      overlayHeight = entry.contentRect.height;
    });
    observer.observe(overlayEl);
    return () => observer.disconnect();
  });

  function markerY(line) {
    if (totalLines <= 0) return 0;
    return (line / totalLines) * overlayHeight;
  }

  function markerColor(type) {
    switch (type) {
      case 'error': return 'var(--danger)';
      case 'warning': return 'var(--warn)';
      case 'success': return 'var(--ok)';
      default: return 'var(--accent)';
    }
  }
</script>

<div class="scrollbar-overlay" bind:this={overlayEl}>
  {#each markers as marker}
    <div
      class="marker"
      style:top="{markerY(marker.line)}px"
      style:background={markerColor(marker.type)}
      title={marker.message}
    ></div>
  {/each}
</div>

<style>
  .scrollbar-overlay {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 12px;
    pointer-events: auto;
    z-index: 1;
  }
  .marker {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 3px;
    border-radius: 1px;
    pointer-events: auto;
    cursor: pointer;
    opacity: 0.85;
  }
  .marker:hover {
    opacity: 1;
    height: 5px;
    margin-top: -1px;
  }
</style>
```

### Step 3: Hook into Terminal.svelte output handler

Modify `handleShellOutput()` to detect error patterns and record markers.

```javascript
// In Terminal.svelte's handleShellOutput:
import { terminalMarkersStore } from '../../lib/stores/terminal-markers.svelte.js';

// Track current buffer line count for marker positioning
function getCurrentLine() {
  if (!term?.buffer?.active) return 0;
  return term.buffer.active.length;
}

case 'stdout':
  if (data.text) {
    term.write(data.text);
    // Lightweight error detection
    detectMarkers(data.text, shellId, getCurrentLine());
  }
  break;

case 'exit':
  // ... existing code ...
  if (data.code !== 0 && data.code !== undefined) {
    terminalMarkersStore.addMarker(shellId, {
      line: getCurrentLine(),
      type: 'error',
      message: `Exit code ${data.code}`,
      timestamp: Date.now(),
    });
  } else if (data.code === 0) {
    terminalMarkersStore.addMarker(shellId, {
      line: getCurrentLine(),
      type: 'success',
      message: 'Exited successfully',
      timestamp: Date.now(),
    });
  }
  break;
```

### Step 4: Render markers in TerminalPanel layout

Add the overlay alongside each Terminal instance:

```svelte
<!-- In TerminalPanel.svelte or directly in Terminal.svelte's template -->
<div class="terminal-view">
  <div class="terminal-container" bind:this={containerEl}></div>
  <TerminalScrollbarOverlay
    {shellId}
    totalLines={term?.buffer?.active?.length ?? 0}
    visibleRows={term?.rows ?? 0}
  />
</div>
```

### Step 5: Click-to-scroll (deferred)

Requires ghostty-web to expose a `scrollToLine(y)` or `scrollTo(viewportOffset)` API. This should be tracked as a follow-up task in the ghostty-web fork. Until then, markers are visual-only.

Possible workaround: send `\x1b[{line}H` (cursor position) escape sequences via PTY input, but this only works in normal mode and would interfere with running processes.

## Key Challenges

### 1. ghostty-web buffer state limitations

ghostty-web's `Buffer.viewportY` is hardcoded to 0. This means:
- The viewport position indicator cannot track scroll state
- Click-to-scroll requires a new API in the ghostty-web fork
- Marker positions are calculated against `buffer.length` (total scrollback + viewport), which IS available and accurate

**Mitigation:** The markers still have correct absolute positions. Only the viewport indicator and click-to-scroll are blocked. These can be added after the ghostty-web fork gains scroll position tracking.

### 2. Canvas-based scrollbar positioning

ghostty-web renders its scrollbar within the canvas, not as a DOM element. The overlay strip sits in the 15px reserved space to the right of the text area (per FitAddon's `DEFAULT_SCROLLBAR_WIDTH`). The overlay is positioned BESIDE the canvas scrollbar, occupying the same vertical strip. This means the overlay's markers visually appear within/near the scrollbar track, which is the desired UX.

If ghostty-web's scrollbar is not visible (e.g., no scrollback content), the overlay still renders markers in the same position -- this is fine since markers indicate notable positions regardless of scrollbar visibility.

### 3. Error pattern detection accuracy

Regex-based error detection on raw terminal output produces false positives (e.g., the word "error" in documentation, variable names like `errorHandler`). Strategies to manage this:

- **Conservative patterns:** Only match at line start or with capitalized keywords (`^error\b`, `\bERROR\b`)
- **Rate limiting:** Max 1 marker per N lines to avoid flooding on verbose error output
- **Context awareness:** Skip detection when in alternate screen mode (TUI apps manage their own display)
- **Deduplication:** Collapse adjacent markers of the same type within 5 lines into a single marker

### 4. Performance on high-throughput output

Terminal output can be very high volume (e.g., `cat` of a large file, build output). Pattern matching on every chunk could cause jank.

**Mitigations:**
- Only scan the first 2000 characters of each output chunk
- Debounce marker additions (batch within 100ms window)
- Skip scanning entirely in alternate screen mode (TUI apps)
- Use a pre-compiled combined regex instead of iterating N patterns
- Cap markers per shell at 500 (LRU eviction of oldest)

### 5. Marker position accuracy

Terminal output is written in chunks that don't align with line boundaries. The "current line" at the time a chunk is processed may not correspond to the actual line where the error text appears. The error text in chunk N might be rendered across multiple lines due to wrapping.

**Acceptable tradeoff:** A marker at approximately the right position (within a few lines) is still useful for navigation. Exact line-level accuracy would require parsing the terminal's line state after each write, which is prohibitively expensive.

## Files to Create/Modify

### Create

| File | Purpose |
|------|---------|
| `src/components/terminal/TerminalScrollbarOverlay.svelte` | DOM overlay component rendering colored marker blocks |
| `src/lib/stores/terminal-markers.svelte.js` | Reactive store tracking markers per shell ID |

### Modify

| File | Change |
|------|--------|
| `src/components/terminal/Terminal.svelte` | Hook `handleShellOutput()` to detect errors and add markers; expose `term.buffer.active.length` to parent |
| `src/components/terminal/AiTerminal.svelte` | Same hooks for the AI provider terminal |
| `src/components/terminal/TerminalPanel.svelte` | Add overlay to terminal content area (or adjust Terminal.svelte template directly) |

### Upstream (ghostty-web fork)

| Change | Priority |
|--------|----------|
| Expose actual `viewportY` from scroll state (currently hardcoded to 0) | Medium -- needed for viewport indicator |
| Add `scrollToLine(y)` API | Low -- needed for click-to-scroll |

## Future Enhancements

- **Shell integration (OSC 633):** If Voice Mirror ever adds shell integration support, markers can be placed with exact precision at command boundaries, matching VS Code's behavior exactly.
- **Gutter decorations:** In addition to scrollbar markers, render small icons in the terminal gutter (left margin) at command prompts, like VS Code's gutter decorations.
- **Marker navigation:** Keyboard shortcuts (e.g., `F8` / `Shift+F8`) to jump between error markers.
- **Marker filtering:** Toggle marker types on/off from the terminal toolbar.
- **AI terminal markers:** Track Claude Code tool call results (success/failure) as markers in the AI terminal.
