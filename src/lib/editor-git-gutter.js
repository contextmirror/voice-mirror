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

class AddedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-git-added';
    return el;
  }
}

class ModifiedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-git-modified';
    return el;
  }
}

class DeletedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-git-deleted';
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
// Peek widget stub (implemented in Task 5)
// ---------------------------------------------------------------------------

/** Stub — will be replaced in Task 5 with inline peek + revert UI */
function showPeekWidget(view, change) {
  // no-op stub
}

// ---------------------------------------------------------------------------
// Gutter definition
// ---------------------------------------------------------------------------

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
        const deleteIdx = deletes[paired].oldIdx;
        // Count how many modified lines exist before this point
        let modLine = 0;
        for (const e of edits) {
          if (e.op === 'equal' || e.op === 'insert') {
            if (e.newIdx !== undefined && e.newIdx < deleteIdx) modLine = e.newIdx + 1;
            else break;
          }
        }
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

    return {
      /** Load original content for a file path and compute initial diff */
      async setPath(filePath) {
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

      /** Re-fetch original content and recompute (e.g. after git commit) */
      async refreshOriginal() {
        const originalContent = view.state.field(originalContentField);
        if (originalContent === null) return;
        // Re-trigger setPath logic if we have a file path stored
        // The caller (FileEditor) should call setPath again with the path
        computeAndDispatch(view);
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

  return [
    gitChangeField,
    originalContentField,
    gitChangeGutter,
    plugin,
  ];
}
