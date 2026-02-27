/**
 * editor-git-gutter.js -- CodeMirror 6 extension for inline git change indicators.
 *
 * Shows colored bars in the editor gutter for lines added (green), modified (blue),
 * or deleted (red triangle) since the last git commit. Clicking a bar opens an
 * inline peek widget with the original content and a "Revert Change" button.
 *
 * Usage: import { createGitGutter } from './editor-git-gutter.js'
 * then spread createGitGutter(getOriginalContent) into the extensions array.
 */

import { gutter, GutterMarker, ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';

// ---------------------------------------------------------------------------
// GutterMarker subclasses
// ---------------------------------------------------------------------------

const BAR_STYLE = 'display:block;width:3px;height:1.4em;border-radius:1px;';

class AddedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.style.cssText = BAR_STYLE + 'background:#22c55e;';
    return el;
  }
}

class ModifiedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.style.cssText = BAR_STYLE + 'background:#56b4e9;';
    return el;
  }
}

class DeletedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.style.cssText = BAR_STYLE + 'background:#ef4444;';
    return el;
  }
}

const addedMarker = new AddedMarker();
const modifiedMarker = new ModifiedMarker();
const deletedMarker = new DeletedMarker();

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/** Effect to update git change markers and raw change list */
const setGitChanges = StateEffect.define();

/** StateField storing current git markers + raw changes array */
const gitChangeField = StateField.define({
  create() {
    return { markers: RangeSet.empty, changes: [] };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGitChanges)) {
        return effect.value;
      }
    }
    if (tr.docChanged) {
      return { markers: value.markers.map(tr.changes), changes: value.changes };
    }
    return value;
  },
});

/** Effect to store the original (HEAD) file content */
const setOriginalContent = StateEffect.define();

/** StateField storing the original file text (string or null) */
const originalContentField = StateField.define({
  create() {
    return null;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setOriginalContent)) {
        return effect.value;
      }
    }
    return value;
  },
});

// ---------------------------------------------------------------------------
// Peek widget -- inline diff display with revert
// ---------------------------------------------------------------------------

/** Effect to show/hide the peek widget decoration */
const setPeekWidget = StateEffect.define();

/** StateField managing the peek widget decoration set */
const peekWidgetField = StateField.define({
  create() { return Decoration.none; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setPeekWidget)) return e.value;
    }
    // Close peek on any document edit
    if (tr.docChanged) return Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Map a change (line numbers in modified text) back to original lines using Myers diff ops.
 * Returns the original lines that were deleted/modified for this hunk.
 *
 * @param {Array} ops - Myers diff edit operations
 * @param {string[]} oldLines - Original file lines
 * @param {{type: string, from: number, to: number}} change - The change to look up
 * @returns {string[]} Original lines belonging to this hunk
 */
function getOriginalLinesForChange(ops, oldLines, change) {
  // Walk ops the same way computeLineChanges does, grouping contiguous non-equal ops.
  // When we find the group that produced our change, collect its delete oldIdx values.
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === 'equal') { i++; continue; }

    // Collect contiguous non-equal ops
    const deletes = [];
    const inserts = [];
    while (i < ops.length && ops[i].op !== 'equal') {
      if (ops[i].op === 'delete') deletes.push(ops[i]);
      if (ops[i].op === 'insert') inserts.push(ops[i]);
      i++;
    }

    const paired = Math.min(deletes.length, inserts.length);

    // Check if this group produced our change
    if (change.type === 'modified' && paired > 0) {
      const firstModLine = inserts[0].newIdx + 1;
      const lastModLine = inserts[paired - 1].newIdx + 1;
      if (firstModLine === change.from && lastModLine === change.to) {
        return deletes.slice(0, paired).map(d => oldLines[d.oldIdx]);
      }
    }

    if (change.type === 'added' && inserts.length > paired) {
      const firstAddLine = inserts[paired].newIdx + 1;
      const lastAddLine = inserts[inserts.length - 1].newIdx + 1;
      if (firstAddLine === change.from && lastAddLine === change.to) {
        return []; // Added lines have no original content
      }
    }

    if (change.type === 'deleted' && deletes.length > paired) {
      // Match the anchor calculation from computeLineChanges
      let anchorLine;
      if (inserts.length > 0) {
        anchorLine = inserts[inserts.length - 1].newIdx + 1;
      } else {
        anchorLine = 0;
        for (let j = 0; j < ops.length; j++) {
          if (ops[j] === deletes[paired]) break;
          if (ops[j].op === 'equal' || ops[j].op === 'insert') {
            anchorLine = ops[j].newIdx + 1;
          }
        }
      }
      if (anchorLine === change.from) {
        return deletes.slice(paired).map(d => oldLines[d.oldIdx]);
      }
    }
  }

  return [];
}

/**
 * Peek widget -- shows inline diff (original/modified lines) with revert action.
 */
class PeekWidget extends WidgetType {
  /**
   * @param {{type: string, from: number, to: number}} change
   * @param {string[]} originalLines - Original lines for this hunk
   * @param {string[]} currentLines - Current (modified) lines for this hunk
   * @param {number} changeIndex - 0-based index of this change in the changes array
   * @param {number} totalChanges - Total number of changes
   * @param {EditorView} view
   */
  constructor(change, originalLines, currentLines, changeIndex, totalChanges, view) {
    super();
    this.change = change;
    this.originalLines = originalLines;
    this.currentLines = currentLines;
    this.changeIndex = changeIndex;
    this.totalChanges = totalChanges;
    this.view = view;
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'cm-git-peek';

    // -- Header --
    const header = document.createElement('div');
    header.className = 'cm-git-peek-header';

    const label = document.createElement('span');
    label.className = 'cm-git-peek-label';
    label.textContent = `Change ${this.changeIndex + 1} of ${this.totalChanges}`;
    header.appendChild(label);

    const nav = document.createElement('span');
    nav.className = 'cm-git-peek-nav';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'cm-git-peek-btn prev-change';
    prevBtn.textContent = '\u2191';
    prevBtn.title = 'Previous change';
    prevBtn.disabled = this.changeIndex === 0;
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const { changes } = this.view.state.field(gitChangeField);
      if (this.changeIndex > 0) {
        showPeekWidget(this.view, changes[this.changeIndex - 1]);
      }
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'cm-git-peek-btn next-change';
    nextBtn.textContent = '\u2193';
    nextBtn.title = 'Next change';
    nextBtn.disabled = this.changeIndex >= this.totalChanges - 1;
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const { changes } = this.view.state.field(gitChangeField);
      if (this.changeIndex < changes.length - 1) {
        showPeekWidget(this.view, changes[this.changeIndex + 1]);
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cm-git-peek-btn peek-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closePeekWidget(this.view);
    });

    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    nav.appendChild(closeBtn);
    header.appendChild(nav);
    container.appendChild(header);

    // -- Body: diff lines --
    const body = document.createElement('div');
    body.className = 'cm-git-peek-body';

    // Show removed (original) lines for deleted and modified
    if (this.change.type === 'deleted' || this.change.type === 'modified') {
      for (const line of this.originalLines) {
        const el = document.createElement('div');
        el.className = 'cm-git-peek-line removed';
        el.textContent = '- ' + line;
        body.appendChild(el);
      }
    }

    // Show added (current) lines for added and modified
    if (this.change.type === 'added' || this.change.type === 'modified') {
      for (const line of this.currentLines) {
        const el = document.createElement('div');
        el.className = 'cm-git-peek-line added';
        el.textContent = '+ ' + line;
        body.appendChild(el);
      }
    }

    container.appendChild(body);

    // -- Actions --
    const actions = document.createElement('div');
    actions.className = 'cm-git-peek-actions';

    const revertBtn = document.createElement('button');
    revertBtn.className = 'cm-git-peek-revert';
    revertBtn.textContent = 'Revert Change';
    revertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      revertChange(this.view, this.change, this.originalLines);
      closePeekWidget(this.view);
    });

    actions.appendChild(revertBtn);
    container.appendChild(actions);

    return container;
  }

  ignoreEvent() { return false; }
}

/**
 * Show the inline peek widget for a given change.
 * Computes original lines by re-running Myers diff, then places a block widget.
 *
 * @param {EditorView} view
 * @param {{type: string, from: number, to: number}} change
 */
function showPeekWidget(view, change) {
  const originalContent = view.state.field(originalContentField);
  if (originalContent === null) return;

  const currentDoc = view.state.doc.toString();
  const oldLines = originalContent.split('\n');
  const newLines = currentDoc.split('\n');
  const ops = myersDiff(oldLines, newLines);

  const originalLines = getOriginalLinesForChange(ops, oldLines, change);

  // Get current lines for the hunk (added/modified)
  const currentLines = [];
  if (change.type === 'added' || change.type === 'modified') {
    for (let lineNo = change.from; lineNo <= change.to; lineNo++) {
      if (lineNo >= 1 && lineNo <= view.state.doc.lines) {
        currentLines.push(view.state.doc.line(lineNo).text);
      }
    }
  }

  // Determine change index within the changes array
  const { changes } = view.state.field(gitChangeField);
  const changeIndex = changes.findIndex(
    (c) => c.type === change.type && c.from === change.from && c.to === change.to
  );
  const totalChanges = changes.length;

  // Place widget at the end of the change's last line (or anchor line for deleted)
  const anchorLine = change.type === 'deleted'
    ? Math.max(change.from, 1)
    : change.to;
  if (anchorLine < 1 || anchorLine > view.state.doc.lines) return;

  const lineEnd = view.state.doc.line(anchorLine).to;
  const widget = new PeekWidget(
    change, originalLines, currentLines, changeIndex >= 0 ? changeIndex : 0, totalChanges, view
  );
  const deco = Decoration.widget({ widget, block: true, side: 1 });

  view.dispatch({
    effects: [
      setPeekWidget.of(Decoration.set([deco.range(lineEnd)])),
      EditorView.scrollIntoView(lineEnd, { y: 'center' }),
    ],
  });
}

/**
 * Close the peek widget by clearing its decoration set.
 * @param {EditorView} view
 */
function closePeekWidget(view) {
  view.dispatch({
    effects: setPeekWidget.of(Decoration.none),
  });
}

/**
 * Revert a single change back to the original content.
 *
 * @param {EditorView} view
 * @param {{type: string, from: number, to: number}} change
 * @param {string[]} originalLines - The original lines to restore
 */
function revertChange(view, change, originalLines) {
  const doc = view.state.doc;

  if (change.type === 'deleted') {
    // Re-insert deleted lines at the deletion anchor point
    const insertText = originalLines.join('\n') + '\n';
    // Insert after the anchor line (or at doc start if anchor is 0)
    let insertPos;
    if (change.from === 0) {
      insertPos = 0;
    } else if (change.from <= doc.lines) {
      insertPos = doc.line(change.from).to;
      // Add newline before the inserted content if we're inserting after a line
    } else {
      insertPos = doc.length;
    }
    const text = change.from === 0 ? insertText : '\n' + originalLines.join('\n');
    view.dispatch({
      changes: { from: insertPos, to: insertPos, insert: text },
    });
  } else if (change.type === 'added') {
    // Remove the added lines entirely
    if (change.from >= 1 && change.to <= doc.lines) {
      const from = doc.line(change.from).from;
      let to;
      if (change.to < doc.lines) {
        // Include the trailing newline
        to = doc.line(change.to).to + 1;
      } else {
        // Last line: remove preceding newline if there is content before
        to = doc.line(change.to).to;
        if (from > 0) {
          // Include the newline before the first removed line
          view.dispatch({
            changes: { from: from - 1, to },
          });
          return;
        }
      }
      view.dispatch({
        changes: { from, to },
      });
    }
  } else if (change.type === 'modified') {
    // Replace modified lines with original lines
    if (change.from >= 1 && change.to <= doc.lines) {
      const from = doc.line(change.from).from;
      const to = doc.line(change.to).to;
      view.dispatch({
        changes: { from, to, insert: originalLines.join('\n') },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Gutter definition
// ---------------------------------------------------------------------------

/** Base theme for git gutter — uses baseTheme to avoid scoping issues */
const gitGutterBaseTheme = EditorView.baseTheme({
  '.cm-git-change-gutter': {
    width: '6px',
    minWidth: '6px',
    marginRight: '2px',
  },
  '.cm-git-change-gutter .cm-gutterElement': {
    padding: '0 !important',
    minWidth: '6px',
    width: '6px',
    position: 'relative',
    cursor: 'pointer',
  },
});

const gitChangeGutter = gutter({
  class: 'cm-git-change-gutter',
  markers: (v) => v.state.field(gitChangeField).markers,
  domEventHandlers: {
    mousedown(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const { changes } = view.state.field(gitChangeField);
      const change = changes.find((c) => lineNo >= c.from && lineNo <= c.to);
      if (change) {
        showPeekWidget(view, change);
        return true;
      }
      return false;
    },
  },
});

// ---------------------------------------------------------------------------
// Myers line diff
// ---------------------------------------------------------------------------

/**
 * Compute a shortest-edit-script between two line arrays using Myers' O(ND) algorithm.
 * Returns an array of edit operations: { op: 'equal'|'insert'|'delete', oldIdx, newIdx }
 *
 * @param {string[]} a - Original lines
 * @param {string[]} b - Modified lines
 * @returns {Array<{op: string, oldIdx?: number, newIdx?: number}>}
 */
function myersDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  // Fast paths
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((_, i) => ({ op: 'insert', newIdx: i }));
  if (m === 0) return a.map((_, i) => ({ op: 'delete', oldIdx: i }));

  // V stores the best x-position for each diagonal k, indexed as v[k + offset]
  const offset = max;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  // Trace stores a snapshot of v for each d-step so we can backtrack
  const trace = [];

  // Forward pass: find shortest edit distance
  let found = false;
  outer:
  for (let d = 0; d <= max; d++) {
    // Clone v for backtracking
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      // Decide whether to go down (insert) or right (delete)
      let x;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // move down: insert from b
      } else {
        x = v[k - 1 + offset] + 1; // move right: delete from a
      }
      let y = x - k;

      // Follow diagonal (equal lines)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + offset] = x;

      if (x >= n && y >= m) {
        found = true;
        break outer;
      }
    }
  }

  if (!found) return [];

  // Backtrack to reconstruct the edit script
  const edits = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;

    let prevK;
    if (k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    let prevX = vPrev[prevK + offset];
    let prevY = prevX - prevK;

    // Diagonal moves (equal lines) — walk backwards
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ op: 'equal', oldIdx: x, newIdx: y });
    }

    if (d > 0) {
      if (x === prevX) {
        // Insert: y decreased
        y--;
        edits.push({ op: 'insert', newIdx: y });
      } else {
        // Delete: x decreased
        x--;
        edits.push({ op: 'delete', oldIdx: x });
      }
    }
  }

  edits.reverse();
  return edits;
}

/**
 * Compute line-level changes between original and modified text.
 *
 * @param {string} originalText - The original file content (from git HEAD)
 * @param {string} modifiedText - The current editor content
 * @returns {Array<{type: 'added'|'modified'|'deleted', from: number, to: number}>}
 *   from/to are 1-based line numbers in the modified text.
 *   For 'deleted', from === to and points to the line after which content was removed.
 */
export function computeLineChanges(originalText, modifiedText) {
  const originalLines = originalText.split('\n');
  const modifiedLines = modifiedText.split('\n');

  const edits = myersDiff(originalLines, modifiedLines);

  // Pair up adjacent delete+insert as modifications.
  // Walk through edits and group contiguous delete/insert runs.
  const changes = [];
  let i = 0;

  while (i < edits.length) {
    const edit = edits[i];

    if (edit.op === 'equal') {
      i++;
      continue;
    }

    // Collect contiguous non-equal edits
    const deletes = [];
    const inserts = [];
    while (i < edits.length && edits[i].op !== 'equal') {
      if (edits[i].op === 'delete') deletes.push(edits[i]);
      if (edits[i].op === 'insert') inserts.push(edits[i]);
      i++;
    }

    // Pair deletes with inserts as 'modified', leftover as pure add/delete
    const paired = Math.min(deletes.length, inserts.length);

    if (paired > 0) {
      // Modified lines: the inserts that pair with deletes
      const firstModLine = inserts[0].newIdx + 1; // 1-based
      const lastModLine = inserts[paired - 1].newIdx + 1;
      changes.push({ type: 'modified', from: firstModLine, to: lastModLine });
    }

    // Remaining inserts after pairing → added
    if (inserts.length > paired) {
      const firstAddLine = inserts[paired].newIdx + 1;
      const lastAddLine = inserts[inserts.length - 1].newIdx + 1;
      changes.push({ type: 'added', from: firstAddLine, to: lastAddLine });
    }

    // Remaining deletes after pairing → deleted
    if (deletes.length > paired) {
      // Deleted lines: anchor to the modified text line after which they were removed.
      // Use the last insert's position if any, otherwise the line before the delete block.
      let anchorLine;
      if (inserts.length > 0) {
        anchorLine = inserts[inserts.length - 1].newIdx + 1;
      } else {
        // Find the modified-text line just before this delete position.
        // Look at the edit before this block for context.
        // Find the newIdx of the nearest preceding equal/insert edit
        anchorLine = 0;
        for (let j = 0; j < edits.length; j++) {
          if (edits[j] === deletes[paired]) break;
          if (edits[j].op === 'equal' || edits[j].op === 'insert') {
            anchorLine = edits[j].newIdx + 1;
          }
        }
      }
      changes.push({ type: 'deleted', from: anchorLine, to: anchorLine });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// createGitGutter factory
// ---------------------------------------------------------------------------

/** Module-level reference to the ViewPlugin instance (for FileEditor access) */
export let gitGutterPlugin = null;

/**
 * Build the array of CM6 extensions for git gutter change indicators.
 *
 * @param {function} getOriginalContent - async (filePath) => { content: string, isNew: boolean }
 * @returns {Array} CM6 extensions to spread into the editor
 */
export function createGitGutter(getOriginalContent) {
  /**
   * Compute diff and dispatch marker effects into the editor.
   */
  function computeAndDispatch(view) {
    // File size gate: skip very large files
    if (view.state.doc.lines > 10000) return;

    const originalContent = view.state.field(originalContentField);
    if (originalContent === null) return;

    const currentDoc = view.state.doc.toString();
    const changes = computeLineChanges(originalContent, currentDoc);

    // Build sorted gutter markers from changes
    const markerList = [];
    for (const change of changes) {
      if (change.type === 'added') {
        for (let line = change.from; line <= change.to; line++) {
          if (line >= 1 && line <= view.state.doc.lines) {
            const pos = view.state.doc.line(line).from;
            markerList.push(addedMarker.range(pos));
          }
        }
      } else if (change.type === 'modified') {
        for (let line = change.from; line <= change.to; line++) {
          if (line >= 1 && line <= view.state.doc.lines) {
            const pos = view.state.doc.line(line).from;
            markerList.push(modifiedMarker.range(pos));
          }
        }
      } else if (change.type === 'deleted') {
        // Place deleted marker at the anchor line (or line 1 if anchor is 0)
        const line = Math.max(change.from, 1);
        if (line <= view.state.doc.lines) {
          const pos = view.state.doc.line(line).from;
          markerList.push(deletedMarker.range(pos));
        }
      }
    }

    // RangeSet.of requires sorted markers (by position)
    markerList.sort((a, b) => a.from - b.from);

    view.dispatch({
      effects: setGitChanges.of({
        markers: RangeSet.of(markerList),
        changes,
      }),
    });
  }

  const plugin = ViewPlugin.define((view) => {
    let debounceTimer = null;
    let currentPath = null;

    return {
      /** Load original content for a file path and compute initial diff */
      async setPath(filePath) {
        currentPath = filePath;
        try {
          const result = await getOriginalContent(filePath);
          if (result && result.content !== undefined) {
            view.dispatch({
              effects: setOriginalContent.of(result.content),
            });
            computeAndDispatch(view);
          } else {
            // New file — no original content, everything is added
            view.dispatch({
              effects: setOriginalContent.of(''),
            });
            computeAndDispatch(view);
          }
        } catch {
          // File not in git — treat as entirely new
          view.dispatch({
            effects: setOriginalContent.of(''),
          });
          computeAndDispatch(view);
        }
      },

      /** Re-fetch original content and recompute (e.g. after save or git commit) */
      async refreshOriginal() {
        if (currentPath) {
          await this.setPath(currentPath);
        }
      },

      /** Respond to editor updates — debounce recompute on doc changes */
      update(update) {
        if (update.docChanged) {
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            computeAndDispatch(update.view);
          }, 200);
        }
      },

      destroy() {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
      },
    };
  });

  // Store module-level reference for external access
  gitGutterPlugin = plugin;

  // Escape key handler to close peek widget
  const escapeHandler = EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key === 'Escape' && view.state.field(peekWidgetField) !== Decoration.none) {
        closePeekWidget(view);
        return true;
      }
      return false;
    },
  });

  return [
    gitChangeField,
    originalContentField,
    peekWidgetField,
    gitChangeGutter,
    gitGutterBaseTheme,
    plugin,
    escapeHandler,
  ];
}
