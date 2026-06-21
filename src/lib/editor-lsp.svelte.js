/**
 * editor-lsp.svelte.js -- LSP helper module extracted from FileEditor.svelte.
 *
 * Provides a createEditorLsp() factory that encapsulates all LSP-specific state,
 * event listeners, handlers, and CodeMirror extension factories for the file editor.
 */

import { lspOpenFile, lspCloseFile, lspChangeFile, lspSaveFile, lspRequestCompletion, lspRequestHover, lspRequestDefinition, lspRequestTypeDefinition, lspRequestDeclaration, lspRequestImplementation, lspRequestReferences, lspRequestDocumentHighlight, lspRequestInlayHints, lspRequestCodeLens, lspRequestDocumentColors, lspRequestFoldingRanges, lspRequestSemanticTokensFull, lspPrepareRename, lspRename, lspApplyWorkspaceEdit, lspRequestCodeActions, lspRequestFormatting, lspRequestRangeFormatting, lspRequestSignatureHelp, lspRequestLinkedEditingRange, lspRequestOnTypeFormatting } from './api.js';
import { foldService } from '@codemirror/language';
import { projectStore } from './stores/project.svelte.js';
import { tabsStore } from './stores/tabs.svelte.js';
import { basename } from './utils.js';
/** @type {((text: string) => string) | null} */
let _renderHoverMarkdown = null;

/** Lazily load hover-markdown.js on first use (avoids loading highlight.js/dompurify upfront) */
async function getRenderHoverMarkdown() {
  if (!_renderHoverMarkdown) {
    const mod = await import('./hover-markdown.js');
    _renderHoverMarkdown = mod.renderHoverMarkdown;
  }
  return _renderHoverMarkdown;
}

/** Set of file extensions that have LSP support */
export const LSP_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'rs', 'py',
  'css', 'scss', 'html', 'svelte', 'json', 'md', 'markdown',
]);

/** Convert a file:// URI to a project-relative path.
 *  Returns { path, external } where external=true if outside project root. */
export function uriToRelativePath(uri, root) {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;
    let filePath = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    // On Windows, pathname starts with /C:/... — strip leading slash
    if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
    const filePathLower = filePath.toLowerCase();
    const rootLower = normalizedRoot.toLowerCase();
    if (filePathLower.startsWith(rootLower + '/')) {
      return { path: filePath.slice(normalizedRoot.length + 1), external: false };
    }
    return { path: filePath, external: true };
  } catch {
    return null;
  }
}

/** Convert an LSP position { line, character } to a CodeMirror offset */
export function lspPositionToOffset(doc, pos) {
  const line = doc.line(Math.min(pos.line + 1, doc.lines));
  return line.from + Math.min(pos.character, line.length);
}

/**
 * CodeMirror WidgetType for an inlay hint (inline type/parameter annotation).
 * Lives at module scope (state passed via constructor) for performance.
 * @type {any}
 */
let InlayHintWidget = null;

/**
 * CodeMirror WidgetType for a code lens (reference count / test link).
 * Lives at module scope (state passed via constructor) for performance.
 * @type {any}
 */
let CodeLensWidget = null;

/**
 * CodeMirror WidgetType for an inline color swatch.
 * Lives at module scope (state passed via constructor) for performance.
 * @type {any}
 */
let ColorSwatchWidget = null;

/**
 * Lazily define the module-scope widget classes once the CodeMirror view
 * module (which provides WidgetType) is available. Idempotent.
 * @param {typeof import('@codemirror/view')} cmView
 */
function ensureWidgetClasses(cmView) {
  if (InlayHintWidget) return;
  const { WidgetType } = cmView;

  InlayHintWidget = class extends WidgetType {
    constructor(label, kind, paddingLeft, paddingRight) {
      super();
      this.label = label;
      this.kind = kind;
      this.paddingLeft = paddingLeft;
      this.paddingRight = paddingRight;
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-inlay-hint';
      if (this.kind === 1) span.classList.add('cm-inlay-hint-type');
      if (this.kind === 2) span.classList.add('cm-inlay-hint-parameter');
      span.textContent = this.label;
      if (this.paddingLeft) span.style.marginLeft = '2px';
      if (this.paddingRight) span.style.marginRight = '2px';
      return span;
    }

    eq(other) {
      return this.label === other.label && this.kind === other.kind
        && this.paddingLeft === other.paddingLeft && this.paddingRight === other.paddingRight;
    }

    ignoreEvent() { return true; }
  };

  CodeLensWidget = class extends WidgetType {
    constructor(title) {
      super();
      this.title = title;
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-code-lens';
      span.textContent = this.title;
      return span;
    }

    eq(other) {
      return this.title === other.title;
    }

    ignoreEvent() { return true; }
  };

  ColorSwatchWidget = class extends WidgetType {
    // onActivate(widget, anchorEl) is invoked on mousedown to open the picker.
    constructor(r, g, b, a, rangeFrom, rangeTo, onActivate) {
      super();
      this.r = r; this.g = g; this.b = b; this.a = a;
      this.rangeFrom = rangeFrom;
      this.rangeTo = rangeTo;
      this.onActivate = onActivate;
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-color-swatch';
      span.style.background = `rgba(${Math.round(this.r * 255)}, ${Math.round(this.g * 255)}, ${Math.round(this.b * 255)}, ${this.a})`;
      const self = this;
      span.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.onActivate(self, span);
      });
      return span;
    }

    eq(other) {
      return this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a;
    }

    ignoreEvent() { return true; }
  };
}

/** Map LSP CompletionItemKind number to CodeMirror completion type string */
export function mapCompletionKind(kind) {
  const kinds = {
    1: 'text', 2: 'method', 3: 'function', 4: 'constructor',
    5: 'field', 6: 'variable', 7: 'class', 8: 'interface',
    9: 'module', 10: 'property', 11: 'unit', 12: 'value',
    13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color',
    17: 'file', 18: 'reference', 19: 'folder', 20: 'enum',
    21: 'constant', 22: 'struct', 23: 'event', 24: 'operator',
    25: 'type',
  };
  return kinds[kind] || 'text';
}

/**
 * Create an editor LSP helper instance. Encapsulates all LSP state, event
 * listeners, handlers, and CodeMirror extension factories.
 *
 * @returns LSP helper object with state, handlers, extension factories, and lifecycle methods
 */
export function createEditorLsp() {
  let lspVersion = $state(0);
  let hasLsp = $state(false);
  let cachedDiagnostics = $state(new Map());

  // References state
  let showReferences = $state(false);
  let referencesResult = $state([]);

  // Rename state
  let showRename = $state(false);
  let renamePosition = $state({ x: 0, y: 0 });
  let renamePlaceholder = $state('');

  // Code actions state
  let showCodeActions = $state(false);
  let codeActions = $state([]);
  let codeActionsPosition = $state({ x: 0, y: 0 });

  // Signature help state
  let showSignatureHelp = $state(false);
  let signatureHelpData = $state(null);
  let signatureHelpPos = $state(0);
  let signatureHelpCoords = $state({ x: 0, y: 0 });

  let lspDebounceTimer = null;

  // ── Handlers ──

  function openFile(path, content, root) {
    if (!hasLsp) return;
    lspOpenFile(path, content, root).catch(() => {});
  }

  function closeFile(path, root) {
    if (!hasLsp) return;
    lspCloseFile(path, root).catch(() => {});
  }

  function changeFile(path, content, root) {
    lspVersion++;
    clearTimeout(lspDebounceTimer);
    lspDebounceTimer = setTimeout(() => {
      lspChangeFile(path, content, lspVersion, root).catch(() => {});
    }, 300);
  }

  function saveFile(path, content, root) {
    if (!hasLsp) return;
    lspSaveFile(path, content, root).catch(() => {});
  }

  async function handleGoToDefinition(view, pos) {
    if (!view || !hasLsp) return;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;
    const currentPath = view._lspPath; // set by FileEditor

    try {
      const result = await lspRequestDefinition(currentPath, line, character, root);
      if (!result?.data?.locations?.length) return;
      const loc = result.data.locations[0];
      const rootStr = projectStore.root || '';
      const resolved = uriToRelativePath(loc.uri, rootStr);
      if (!resolved) return;
      if (resolved.path === currentPath && !resolved.external) {
        const targetLine = view.state.doc.line(loc.range.start.line + 1);
        view.dispatch({
          selection: { anchor: targetLine.from + loc.range.start.character },
          scrollIntoView: true,
        });
      } else {
        const fileName = basename(resolved.path);
        tabsStore.openFile({ name: fileName, path: resolved.path, readOnly: resolved.external, external: resolved.external });
      }
    } catch {}
  }

  async function handleGoToTypeDefinition(view, pos) {
    if (!view || !hasLsp) return;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;
    const currentPath = view._lspPath;

    try {
      const result = await lspRequestTypeDefinition(currentPath, line, character, root);
      if (!result?.data?.locations?.length) return;
      const loc = result.data.locations[0];
      const rootStr = projectStore.root || '';
      const resolved = uriToRelativePath(loc.uri, rootStr);
      if (!resolved) return;
      if (resolved.path === currentPath && !resolved.external) {
        const targetLine = view.state.doc.line(loc.range.start.line + 1);
        view.dispatch({
          selection: { anchor: targetLine.from + loc.range.start.character },
          scrollIntoView: true,
        });
      } else {
        const fileName = basename(resolved.path);
        tabsStore.openFile({ name: fileName, path: resolved.path, readOnly: resolved.external, external: resolved.external });
      }
    } catch {}
  }

  async function handleGoToDeclaration(view, pos) {
    if (!view || !hasLsp) return;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;
    const currentPath = view._lspPath;

    try {
      const result = await lspRequestDeclaration(currentPath, line, character, root);
      if (!result?.data?.locations?.length) return;
      const loc = result.data.locations[0];
      const rootStr = projectStore.root || '';
      const resolved = uriToRelativePath(loc.uri, rootStr);
      if (!resolved) return;
      if (resolved.path === currentPath && !resolved.external) {
        const targetLine = view.state.doc.line(loc.range.start.line + 1);
        view.dispatch({
          selection: { anchor: targetLine.from + loc.range.start.character },
          scrollIntoView: true,
        });
      } else {
        const fileName = basename(resolved.path);
        tabsStore.openFile({ name: fileName, path: resolved.path, readOnly: resolved.external, external: resolved.external });
      }
    } catch {}
  }

  async function handleGoToImplementation(view, pos) {
    if (!view || !hasLsp) return;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;
    const currentPath = view._lspPath;

    try {
      const result = await lspRequestImplementation(currentPath, line, character, root);
      if (!result?.data?.locations?.length) return;
      const loc = result.data.locations[0];
      const rootStr = projectStore.root || '';
      const resolved = uriToRelativePath(loc.uri, rootStr);
      if (!resolved) return;
      if (resolved.path === currentPath && !resolved.external) {
        const targetLine = view.state.doc.line(loc.range.start.line + 1);
        view.dispatch({
          selection: { anchor: targetLine.from + loc.range.start.character },
          scrollIntoView: true,
        });
      } else {
        const fileName = basename(resolved.path);
        tabsStore.openFile({ name: fileName, path: resolved.path, readOnly: resolved.external, external: resolved.external });
      }
    } catch {}
  }

  async function handleFindReferences(view, currentPath) {
    if (!view || !hasLsp || !currentPath) return;
    const pos = view.state.selection.main.head;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;

    try {
      const result = await lspRequestReferences(currentPath, line, character, root);
      if (result?.data?.locations?.length) {
        referencesResult = result.data.locations.map(loc => {
          const rootStr = projectStore.root || '';
          const resolved = uriToRelativePath(loc.uri, rootStr);
          return {
            path: resolved?.path || loc.uri,
            external: resolved?.external || false,
            range: loc.range,
          };
        });
        showReferences = true;
      }
    } catch {}
  }

  async function handleRenameSymbol(view, currentPath) {
    if (!view || !hasLsp || !currentPath) return;
    const pos = view.state.selection.main.head;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;

    try {
      const result = await lspPrepareRename(currentPath, line, character, root);
      if (result?.data) {
        const coords = view.coordsAtPos(pos);
        renamePosition = { x: coords?.left || 0, above: (coords?.top || 0) - 4, below: (coords?.bottom || 0) + 4 };
        renamePlaceholder = result.data.placeholder || view.state.sliceDoc(
          lspPositionToOffset(view.state.doc, result.data.range?.start || { line, character }),
          lspPositionToOffset(view.state.doc, result.data.range?.end || { line, character })
        );
        showRename = true;
      }
    } catch {}
  }

  async function executeRename(view, currentPath, newName) {
    if (!view || !hasLsp || !currentPath) return;
    const pos = view.state.selection.main.head;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;
    showRename = false;

    try {
      const result = await lspRename(currentPath, line, character, newName, root);
      if (result?.data?.workspaceEdit) {
        await lspApplyWorkspaceEdit(result.data.workspaceEdit, root);
      }
    } catch (err) {
      console.warn('[editor-lsp] Rename failed:', err);
    }
  }

  async function formatDocument(view, path, root) {
    if (!hasLsp) return false;
    try {
      // Read tab size from editor state (defaults to 2 spaces)
      const tabSize = view.state.tabSize || 2;
      const insertSpaces = true; // CodeMirror uses spaces by default
      const result = await lspRequestFormatting(path, tabSize, insertSpaces, root);
      if (result?.data?.edits?.length > 0) {
        const doc = view.state.doc;
        // Sort edits in reverse document order so earlier offsets aren't invalidated
        const sorted = [...result.data.edits].sort((a, b) => {
          const lineA = a.range.start.line;
          const lineB = b.range.start.line;
          if (lineA !== lineB) return lineB - lineA;
          return b.range.start.character - a.range.start.character;
        });
        const changes = sorted.map(edit => ({
          from: lspPositionToOffset(doc, edit.range.start),
          to: lspPositionToOffset(doc, edit.range.end),
          insert: edit.newText,
        }));
        view.dispatch({ changes });
        return true;
      }
    } catch (err) {
      console.warn('[editor-lsp] Format document failed:', err);
    }
    return false;
  }

  async function formatSelection(view, path, root) {
    if (!hasLsp) return false;
    root = root || projectStore.root;
    const sel = view.state.selection.main;
    if (sel.from === sel.to) return false; // No selection
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const tabSize = view.state.tabSize || 2;
    const insertSpaces = true;
    try {
      const result = await lspRequestRangeFormatting(
        path,
        startLine.number - 1, sel.from - startLine.from,
        endLine.number - 1, sel.to - endLine.from,
        tabSize, insertSpaces, root
      );
      if (result?.data?.edits?.length > 0) {
        const doc = view.state.doc;
        const sorted = [...result.data.edits].sort((a, b) => {
          const lineA = a.range.start.line;
          const lineB = b.range.start.line;
          if (lineA !== lineB) return lineB - lineA;
          return b.range.start.character - a.range.start.character;
        });
        const changes = sorted.map(edit => ({
          from: lspPositionToOffset(doc, edit.range.start),
          to: lspPositionToOffset(doc, edit.range.end),
          insert: edit.newText,
        }));
        view.dispatch({ changes });
        return true;
      }
    } catch (err) {
      console.warn('[editor-lsp] Format selection failed:', err);
    }
    return false;
  }

  /**
   * CodeMirror ViewPlugin that triggers LSP on-type formatting
   * when the user types `;`, `}`, or Enter.
   */
  function onTypeFormattingExtension(currentPath, cmView) {
    const ON_TYPE_TRIGGERS = new Set([';', '}', '\n']);

    return cmView.ViewPlugin.fromClass(class {
      update(update) {
        if (!update.docChanged || !hasLsp || !currentPath) return;

        // Detect inserted trigger character from the transaction
        let triggerChar = null;
        let triggerPos = null;
        update.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
          if (triggerChar) return; // only first trigger
          const text = inserted.toString();
          if (text.length === 1 && ON_TYPE_TRIGGERS.has(text)) {
            triggerChar = text;
            triggerPos = toB;
          } else if (text === '\r\n' || text === '\r') {
            triggerChar = '\n';
            triggerPos = toB;
          }
        });

        if (!triggerChar || triggerPos == null) return;

        const view = update.view;
        const lineInfo = view.state.doc.lineAt(triggerPos);
        const line = lineInfo.number - 1;
        const character = triggerPos - lineInfo.from;
        const tabSize = view.state.tabSize || 2;
        const root = projectStore.root;

        lspRequestOnTypeFormatting(currentPath, line, character, triggerChar, tabSize, true, root)
          .then(result => {
            if (!result?.data?.edits?.length) return;
            const doc = view.state.doc;
            const sorted = [...result.data.edits].sort((a, b) => {
              if (a.range.start.line !== b.range.start.line)
                return b.range.start.line - a.range.start.line;
              return b.range.start.character - a.range.start.character;
            });
            const changes = sorted.map(edit => ({
              from: lspPositionToOffset(doc, edit.range.start),
              to: lspPositionToOffset(doc, edit.range.end),
              insert: edit.newText,
            }));
            view.dispatch({ changes });
          })
          .catch(() => {});
      }
    });
  }

  async function handleCodeActions(view, currentPath, diagnosticsAtCursor) {
    if (!view || !hasLsp || !currentPath) return;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const root = projectStore.root;

    try {
      const lspDiags = (diagnosticsAtCursor || [])
        .map(d => d.lspDiagnostic)
        .filter(Boolean);
      const result = await lspRequestCodeActions(
        currentPath,
        startLine.number - 1, sel.from - startLine.from,
        endLine.number - 1, sel.to - endLine.from,
        lspDiags,
        root
      );
      if (result?.data?.actions?.length) {
        const coords = view.coordsAtPos(sel.head);
        codeActionsPosition = { x: coords?.left || 0, above: (coords?.top || 0) - 4, below: (coords?.bottom || 0) + 4 };
        codeActions = result.data.actions;
        showCodeActions = true;
      }
    } catch (err) {
      console.warn('[editor-lsp] Code actions request failed:', err);
    }
  }

  async function requestSignatureHelp(view, currentPath, triggerChar) {
    if (!view || !hasLsp || !currentPath) return;
    const pos = view.state.selection.main.head;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;

    try {
      const result = await lspRequestSignatureHelp(currentPath, line, character, root);
      if (result?.data?.signatures?.length) {
        signatureHelpData = result.data;
        signatureHelpPos = pos;
        showSignatureHelp = true;
        // Update cursor coordinates for tooltip positioning
        const coords = view.coordsAtPos(pos);
        if (coords) signatureHelpCoords = { x: coords.left, y: coords.top };
      } else {
        showSignatureHelp = false;
        signatureHelpData = null;
      }
    } catch {
      showSignatureHelp = false;
      signatureHelpData = null;
    }
  }

  function dismissSignatureHelp() {
    showSignatureHelp = false;
    signatureHelpData = null;
  }

  async function handleLinkedEditing(view, currentPath) {
    if (!view || !hasLsp || !currentPath) return;
    const pos = view.state.selection.main.head;
    const lineInfo = view.state.doc.lineAt(pos);
    const line = lineInfo.number - 1;
    const character = pos - lineInfo.from;
    const root = projectStore.root;

    try {
      const result = await lspRequestLinkedEditingRange(currentPath, line, character, root);
      if (result?.data?.ranges?.length >= 2) {
        // For now, just log the ranges — full synchronized editing is a future enhancement.
        // The ranges identify matching tag pairs (e.g. <div> and </div>).
        console.debug('[editor-lsp] Linked editing ranges:', result.data.ranges);
      }
    } catch {}
  }

  /**
   * CodeMirror ViewPlugin that synchronizes editing of HTML tag pairs
   * via LSP textDocument/linkedEditingRange.
   *
   * When the cursor is inside a tag name, it fetches linked ranges from LSP
   * and highlights them. Edits to one range are mirrored to the other.
   */
  function linkedEditingExtension(currentPath, cmView, cmState) {
    const { ViewPlugin, Decoration } = cmView;
    const { StateEffect, StateField, RangeSet, Annotation, EditorState, EditorSelection } = cmState;

    const setLinkedRanges = StateEffect.define();
    // Annotation to tag transactions from our mirrored edits
    const linkedEditTag = Annotation.define();

    const linkedMark = Decoration.mark({ class: 'cm-linked-editing' });

    function buildDecos(ranges) {
      if (!ranges) return Decoration.none;
      const marks = ranges
        .slice()
        .sort((a, b) => a.from - b.from)
        .map(r => linkedMark.range(r.from, r.to));
      return RangeSet.of(marks);
    }

    const linkedField = StateField.define({
      create() { return { ranges: null, decos: Decoration.none }; },
      update(val, tr) {
        for (const e of tr.effects) {
          if (e.is(setLinkedRanges)) return e.value;
        }
        if (tr.docChanged && val.ranges) {
          // If this is our own mirrored edit, map ranges through changes
          if (tr.annotation(linkedEditTag)) {
            const newRanges = val.ranges.map(r => ({
              from: tr.changes.mapPos(r.from, -1),
              to: tr.changes.mapPos(r.to, 1),
            }));
            // Validate ranges are still sane
            const doc = tr.state.doc;
            if (newRanges.every(r => r.from >= 0 && r.to <= doc.length && r.from < r.to)) {
              return { ranges: newRanges, decos: buildDecos(newRanges) };
            }
          }
          // External edit — invalidate, fetcher will re-query
          return { ranges: null, decos: Decoration.none };
        }
        return val;
      },
    });

    const linkedFetcher = ViewPlugin.fromClass(class {
      constructor(view) {
        this._timer = null;
        this._reqId = 0;
        this._lastPos = -1;
        this._scheduleCheck(view);
      }

      update(update) {
        if (!update.selectionSet && !update.docChanged) return;
        this._scheduleCheck(update.view);
      }

      _scheduleCheck(view) {
        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const pos = view.state.selection.main.head;
        if (pos === this._lastPos && !view.state.field(linkedField).ranges) return;
        this._lastPos = pos;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._fetchRanges(view, reqId);
        }, 150);
      }

      async _fetchRanges(view, reqId) {
        try {
          const pos = view.state.selection.main.head;
          const lineInfo = view.state.doc.lineAt(pos);
          const line = lineInfo.number - 1;
          const character = pos - lineInfo.from;
          const root = projectStore.root;

          const result = await lspRequestLinkedEditingRange(currentPath, line, character, root);
          if (reqId !== this._reqId) return;

          if (!result?.data?.ranges?.length || result.data.ranges.length < 2) {
            const current = view.state.field(linkedField);
            if (current.ranges) {
              view.dispatch({ effects: setLinkedRanges.of({ ranges: null, decos: Decoration.none }) });
            }
            return;
          }

          const doc = view.state.doc;
          const ranges = result.data.ranges.map(r => ({
            from: lspPositionToOffset(doc, r.start),
            to: lspPositionToOffset(doc, r.end),
          })).filter(r => r.from >= 0 && r.to <= doc.length && r.from < r.to);

          if (ranges.length < 2) return;

          view.dispatch({
            effects: setLinkedRanges.of({ ranges, decos: buildDecos(ranges) }),
          });
        } catch {
          // Silently ignore
        }
      }

      destroy() {
        clearTimeout(this._timer);
      }
    });

    // Transaction filter: mirror ALL edits (typing + backspace/delete) within linked ranges
    const linkedMirrorFilter = EditorState.transactionFilter.of(tr => {
      if (tr.annotation(linkedEditTag)) return tr;
      if (!tr.docChanged) return tr;

      const field = tr.startState.field(linkedField);
      if (!field.ranges || field.ranges.length < 2) return tr;

      // Collect individual changes from the transaction
      const editChanges = [];
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        editChanges.push({ from: fromA, to: toA, insert: inserted.toString() });
      });

      // Only mirror single-change transactions (normal typing/deletion)
      if (editChanges.length !== 1) return tr;
      const change = editChanges[0];

      // Find which linked range contains this edit
      const editRange = field.ranges.find(r => change.from >= r.from && change.to <= r.to);
      if (!editRange) return tr;

      const offsetInRange = change.from - editRange.from;
      const deleteLen = change.to - change.from;
      const allChanges = [change];

      for (const r of field.ranges) {
        if (r === editRange) continue;
        const mirrorFrom = r.from + offsetInRange;
        const mirrorTo = mirrorFrom + deleteLen;
        if (mirrorFrom >= r.from && mirrorTo <= r.to) {
          allChanges.push({ from: mirrorFrom, to: mirrorTo, insert: change.insert });
        }
      }

      if (allChanges.length <= 1) return tr;

      // Sort in document order (required by ChangeSet)
      allChanges.sort((a, b) => a.from - b.from);

      // Compute cursor position: account for mirror changes before the user's edit
      let shift = 0;
      for (const c of allChanges) {
        if (c.from >= change.from) break;
        shift += c.insert.length - (c.to - c.from);
      }
      const cursorPos = change.from + change.insert.length + shift;

      return {
        changes: allChanges,
        selection: EditorSelection.cursor(cursorPos),
        annotations: linkedEditTag.of(true),
        scrollIntoView: true,
      };
    });

    // Provide decorations from the StateField
    const linkedDecorations = cmView.EditorView.decorations.compute([linkedField], state => {
      return state.field(linkedField).decos;
    });

    return [linkedField, linkedFetcher, linkedMirrorFilter, linkedDecorations];
  }

  // ── CodeMirror extension factories ──

  const COMPLETION_TRIGGERS = new Set(['.', ':', '<', '"', '/', '@', '#', '(']);

  function completionSource(currentPath) {
    return async function lspCompletionSource(context) {
      if (!hasLsp || !currentPath) return null;

      // Only activate on explicit invocation (Ctrl+Space), trigger characters,
      // or when typing an identifier. Avoids completions on }, ), ;, etc.
      if (!context.explicit) {
        const word = context.matchBefore(/\w+/);
        if (!word) {
          // Check if the character before the cursor is a trigger character
          const before = context.pos > 0
            ? context.state.sliceDoc(context.pos - 1, context.pos)
            : '';
          if (!COMPLETION_TRIGGERS.has(before)) return null;
        }
      }

      const pos = context.state.doc.lineAt(context.pos);
      const line = pos.number - 1;
      const character = context.pos - pos.from;
      const root = projectStore.root;

      try {
        const result = await lspRequestCompletion(currentPath, line, character, root);
        if (!result?.data?.items?.length) return null;

        return {
          from: context.pos - (context.matchBefore(/\w*/)?.text.length || 0),
          options: result.data.items.map(item => ({
            label: item.label,
            type: mapCompletionKind(item.kind),
            detail: item.detail || undefined,
            info: item.documentation || undefined,
            apply: item.textEdit?.newText || item.insertText || item.label,
          })),
        };
      } catch {
        return null;
      }
    };
  }

  function hoverTooltipExtension(currentPath, hoverTooltip) {
    return hoverTooltip(async (v, pos) => {
      // Skip hover when rename or code actions are active
      if (showRename || showCodeActions) return null;
      // Skip hover tooltip if there's a diagnostic at this position
      // (CodeMirror's lint tooltip already shows diagnostic info)
      const diags = cachedDiagnostics.get(currentPath) || [];
      if (diags.some(d => pos >= d.from && pos <= d.to)) return null;

      const lineInfo = v.state.doc.lineAt(pos);
      const line = lineInfo.number - 1;
      const character = pos - lineInfo.from;
      const root = projectStore.root;

      try {
        const result = await lspRequestHover(currentPath, line, character, root);
        if (!result?.data?.contents) return null;

        const renderFn = await getRenderHoverMarkdown();
        return {
          pos,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'lsp-hover-tooltip';
            const raw = typeof result.data.contents === 'string'
              ? result.data.contents
              : result.data.contents.value || '';
            dom.innerHTML = renderFn(raw);
            return { dom };
          },
        };
      } catch {
        return null;
      }
    });
  }

  /**
   * CodeMirror ViewPlugin that highlights all occurrences of the symbol under
   * the cursor via LSP textDocument/documentHighlight.
   *
   * On cursor position change (debounced 150ms), requests highlights from the
   * server and applies Decoration.mark with class 'cm-lsp-highlight'.
   *
   * @param {string} currentPath - current file path for the editor
   * @param {typeof import('@codemirror/view')} cmView - CodeMirror view module
   * @param {typeof import('@codemirror/state')} cmState - CodeMirror state module
   * @returns {import('@codemirror/state').Extension} CM extension
   */
  function documentHighlightExtension(currentPath, cmView, cmState) {
    const { ViewPlugin, Decoration } = cmView;
    const { RangeSet } = cmState;

    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.decorations = RangeSet.empty;
        this._timer = null;
        this._reqId = 0;
      }

      update(update) {
        if (!update.selectionSet && !update.docChanged) return;
        // Clear existing highlights immediately on cursor move
        this.decorations = RangeSet.empty;

        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._requestHighlights(update.view, reqId);
        }, 150);
      }

      async _requestHighlights(view, reqId) {
        try {
          const pos = view.state.selection.main.head;
          const lineInfo = view.state.doc.lineAt(pos);
          const line = lineInfo.number - 1;
          const character = pos - lineInfo.from;
          const root = projectStore.root;

          const result = await lspRequestDocumentHighlight(currentPath, line, character, root);
          // Check if a newer request has been made since
          if (reqId !== this._reqId) return;

          if (!result?.data?.highlights?.length) {
            this.decorations = RangeSet.empty;
            view.requestMeasure();
            return;
          }

          const doc = view.state.doc;
          const marks = [];
          for (const h of result.data.highlights) {
            const from = lspPositionToOffset(doc, h.range.start);
            const to = lspPositionToOffset(doc, h.range.end);
            if (from < to && to <= doc.length) {
              marks.push(
                Decoration.mark({ class: 'cm-lsp-highlight' }).range(from, to)
              );
            }
          }
          // RangeSet.of requires sorted ranges
          marks.sort((a, b) => a.from - b.from || a.to - b.to);
          this.decorations = RangeSet.of(marks);
          view.requestMeasure();
        } catch {
          // Silently ignore — highlight is best-effort
        }
      }

      destroy() {
        clearTimeout(this._timer);
      }
    }, {
      decorations: v => v.decorations,
    });
  }

  /**
   * CodeMirror ViewPlugin that renders inlay hints (inline type annotations,
   * parameter names) via LSP textDocument/inlayHint.
   *
   * On viewport change or document change (debounced 500ms), requests inlay
   * hints for the visible range and renders them as Decoration.widget with
   * class 'cm-inlay-hint'.
   *
   * @param {string} currentPath - current file path for the editor
   * @param {typeof import('@codemirror/view')} cmView - CodeMirror view module
   * @param {typeof import('@codemirror/state')} cmState - CodeMirror state module
   * @returns {import('@codemirror/state').Extension} CM extension
   */
  function inlayHintExtension(currentPath, cmView, cmState) {
    const { ViewPlugin, Decoration } = cmView;
    const { RangeSet } = cmState;
    ensureWidgetClasses(cmView);

    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.decorations = RangeSet.empty;
        this._timer = null;
        this._reqId = 0;
        this._scheduleRequest(view);
      }

      update(update) {
        if (!update.docChanged && !update.viewportChanged) return;
        this._scheduleRequest(update.view);
      }

      _scheduleRequest(view) {
        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._requestHints(view, reqId);
        }, 500);
      }

      async _requestHints(view, reqId) {
        try {
          const viewport = view.viewport;
          const startLine = view.state.doc.lineAt(viewport.from).number - 1;
          const endLine = view.state.doc.lineAt(viewport.to).number;
          const root = projectStore.root;

          const result = await lspRequestInlayHints(currentPath, startLine, endLine, root);
          if (reqId !== this._reqId) return;

          if (!result?.data?.hints?.length) {
            this.decorations = RangeSet.empty;
            view.requestMeasure();
            return;
          }

          const doc = view.state.doc;
          const widgets = [];
          for (const hint of result.data.hints) {
            const pos = lspPositionToOffset(doc, hint.position);
            if (pos >= 0 && pos <= doc.length) {
              widgets.push(
                Decoration.widget({
                  widget: new InlayHintWidget(
                    hint.label,
                    hint.kind,
                    hint.paddingLeft,
                    hint.paddingRight
                  ),
                  side: 1, // after the position
                }).range(pos)
              );
            }
          }
          widgets.sort((a, b) => a.from - b.from);
          this.decorations = RangeSet.of(widgets);
          view.requestMeasure();
        } catch {
          // Silently ignore -- inlay hints are best-effort
        }
      }

      destroy() {
        clearTimeout(this._timer);
      }
    }, {
      decorations: v => v.decorations,
    });
  }

  /**
   * CodeMirror ViewPlugin that renders code lenses (reference counts, test links)
   * via LSP textDocument/codeLens.
   *
   * @param {string} currentPath - current file path
   * @param {typeof import('@codemirror/view')} cmView - CodeMirror view module
   * @param {typeof import('@codemirror/state')} cmState - CodeMirror state module
   * @returns {import('@codemirror/state').Extension} CM extension
   */
  function codeLensExtension(currentPath, cmView, cmState) {
    const { ViewPlugin, Decoration } = cmView;
    const { RangeSet, StateField, StateEffect } = cmState;
    ensureWidgetClasses(cmView);

    // Block decorations MUST come from a StateField, not a ViewPlugin.
    const setCodeLenses = StateEffect.define();

    const codeLensField = StateField.define({
      create() { return Decoration.none; },
      update(decos, tr) {
        for (const e of tr.effects) {
          if (e.is(setCodeLenses)) return e.value;
        }
        return tr.docChanged ? Decoration.none : decos;
      },
      provide: f => cmView.EditorView.decorations.from(f),
    });

    // ViewPlugin handles async fetching and dispatches effects to the StateField.
    const codeLensFetcher = ViewPlugin.fromClass(class {
      constructor(view) {
        this._timer = null;
        this._reqId = 0;
        this._scheduleRequest(view);
      }

      update(update) {
        if (!update.docChanged) return;
        this._scheduleRequest(update.view);
      }

      _scheduleRequest(view) {
        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._requestLenses(view, reqId);
        }, 1000);
      }

      async _requestLenses(view, reqId) {
        try {
          const root = projectStore.root;
          const result = await lspRequestCodeLens(currentPath, root);
          if (reqId !== this._reqId) return;

          if (!result?.data?.lenses?.length) {
            view.dispatch({ effects: setCodeLenses.of(Decoration.none) });
            return;
          }

          const doc = view.state.doc;
          const widgets = [];
          for (const lens of result.data.lenses) {
            if (!lens.command?.title) continue;
            const pos = lspPositionToOffset(doc, lens.range.start);
            if (pos >= 0 && pos <= doc.length) {
              widgets.push(
                Decoration.widget({
                  widget: new CodeLensWidget(lens.command.title),
                  side: -1,
                  block: true,
                }).range(pos)
              );
            }
          }
          widgets.sort((a, b) => a.from - b.from);
          view.dispatch({
            effects: setCodeLenses.of(RangeSet.of(widgets)),
          });
        } catch {
          // Silently ignore — code lenses are best-effort
        }
      }

      destroy() {
        clearTimeout(this._timer);
      }
    });

    return [codeLensField, codeLensFetcher];
  }

  /**
   * CodeMirror ViewPlugin that renders inline color swatches
   * via LSP textDocument/documentColor. Includes an inline color picker
   * (SV gradient + hue bar + alpha bar) that opens on swatch click.
   *
   * @param {string} currentPath - current file path
   * @param {typeof import('@codemirror/view')} cmView - CodeMirror view module
   * @param {typeof import('@codemirror/state')} cmState - CodeMirror state module
   * @returns {import('@codemirror/state').Extension} CM extension
   */
  function documentColorsExtension(currentPath, cmView, cmState) {
    const { ViewPlugin, Decoration } = cmView;
    const { RangeSet } = cmState;
    ensureWidgetClasses(cmView);

    let currentView = null;
    let activePicker = null;
    let pickerIsEditing = false;

    // ── Color conversion utilities ──

    function rgbToHsv(r, g, b) {
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const s = max === 0 ? 0 : d / max, v = max;
      let h = 0;
      if (d) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      return { h, s, v };
    }

    function hsvToRgb(h, s, v) {
      const i = Math.floor(h * 6), f = h * 6 - i;
      const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
      const m = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]];
      const [r, g, b] = m[i % 6];
      return { r, g, b };
    }

    function rgbToHsl(r, g, b) {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      return { h, s, l };
    }

    function detectColorFormat(text) {
      const t = text.trim().toLowerCase();
      if (t.startsWith('#')) return t.length > 7 ? 'hexa' : 'hex';
      if (t.startsWith('rgba')) return 'rgba';
      if (t.startsWith('rgb')) return 'rgb';
      if (t.startsWith('hsla')) return 'hsla';
      if (t.startsWith('hsl')) return 'hsl';
      return 'hex';
    }

    function formatColor(r, g, b, a, fmt) {
      const R = Math.round(r * 255), G = Math.round(g * 255), B = Math.round(b * 255);
      const hex2 = (n) => n.toString(16).padStart(2, '0');
      const alphaStr = parseFloat(a.toFixed(2));
      switch (fmt) {
        case 'hex': return `#${hex2(R)}${hex2(G)}${hex2(B)}`;
        case 'hexa': return `#${hex2(R)}${hex2(G)}${hex2(B)}${hex2(Math.round(a * 255))}`;
        case 'rgb': return `rgb(${R}, ${G}, ${B})`;
        case 'rgba': return `rgba(${R}, ${G}, ${B}, ${alphaStr})`;
        case 'hsl': { const { h, s, l } = rgbToHsl(r, g, b); return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`; }
        case 'hsla': { const { h, s, l } = rgbToHsl(r, g, b); return `hsla(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${alphaStr})`; }
        default: return `#${hex2(R)}${hex2(G)}${hex2(B)}`;
      }
    }

    // ── Color picker ──

    function closeColorPicker() {
      if (activePicker) {
        activePicker.el.remove();
        if (activePicker.highlight) activePicker.highlight.remove();
        activePicker.cleanup();
        activePicker = null;
      }
    }

    function openColorPicker(view, r, g, b, a, from, to, anchor) {
      closeColorPicker();

      const originalText = view.state.doc.sliceString(from, to);
      const hasAlpha = a < 1;
      // Format cycle order: RGB → HSL → HEX (matching VS Code)
      const formats = hasAlpha ? ['rgba', 'hsla', 'hexa'] : ['rgb', 'hsl', 'hex'];
      let formatIndex = Math.max(0, formats.indexOf(detectColorFormat(originalText)));
      let format = formats[formatIndex];
      const hsv = rgbToHsv(r, g, b);
      let alpha = a;

      const SVW = 180, SVH = 150, BAR = 14, GAP = 6, PAD = 8;

      // Create picker DOM with inline styles (lives on document.body, outside CM)
      const picker = document.createElement('div');
      Object.assign(picker.style, {
        position: 'fixed', zIndex: '10000',
        background: '#1e1e2e', border: '1px solid #444',
        borderRadius: '6px', padding: `${PAD}px`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: `${GAP}px`,
        fontFamily: 'var(--font-mono, monospace)', fontSize: '12px',
        userSelect: 'none',
      });

      // Top row: SV gradient | Hue bar | Alpha bar (VS Code layout)
      const topRow = document.createElement('div');
      Object.assign(topRow.style, { display: 'flex', gap: `${GAP}px` });

      const svCanvas = document.createElement('canvas');
      svCanvas.width = SVW; svCanvas.height = SVH;
      Object.assign(svCanvas.style, { borderRadius: '3px', cursor: 'crosshair', display: 'block' });
      topRow.appendChild(svCanvas);

      const hueCanvas = document.createElement('canvas');
      hueCanvas.width = BAR; hueCanvas.height = SVH;
      Object.assign(hueCanvas.style, { borderRadius: '3px', cursor: 'pointer', display: 'block' });
      topRow.appendChild(hueCanvas);

      const alphaCanvas = document.createElement('canvas');
      alphaCanvas.width = BAR; alphaCanvas.height = SVH;
      Object.assign(alphaCanvas.style, { borderRadius: '3px', cursor: 'pointer', display: 'block' });
      topRow.appendChild(alphaCanvas);

      picker.appendChild(topRow);

      const valueRow = document.createElement('div');
      Object.assign(valueRow.style, { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' });
      const preview = document.createElement('span');
      Object.assign(preview.style, {
        width: '20px', height: '20px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.3)', flexShrink: '0',
      });
      const valueText = document.createElement('span');
      Object.assign(valueText.style, {
        color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', cursor: 'pointer', padding: '2px 4px',
        borderRadius: '3px',
      });
      // Click value text to cycle format (RGB → HSL → HEX), matching VS Code
      valueText.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        formatIndex = (formatIndex + 1) % formats.length;
        format = formats[formatIndex];
        redraw();
        applyColor();
        updateHighlight();
      });
      valueText.addEventListener('mouseenter', () => { valueText.style.background = 'rgba(255,255,255,0.1)'; });
      valueText.addEventListener('mouseleave', () => { valueText.style.background = 'transparent'; });
      valueRow.appendChild(preview);
      valueRow.appendChild(valueText);
      // Value row on top, matching VS Code layout
      picker.insertBefore(valueRow, topRow);

      // ── Text range highlight overlay ──
      let highlightEl = null;
      function updateHighlight() {
        if (highlightEl) highlightEl.remove();
        const fromCoords = view.coordsAtPos(from);
        const toCoords = view.coordsAtPos(to);
        if (!fromCoords || !toCoords) return;
        highlightEl = document.createElement('div');
        Object.assign(highlightEl.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '9999',
          left: `${fromCoords.left}px`, top: `${fromCoords.top}px`,
          width: `${toCoords.right - fromCoords.left}px`,
          height: `${fromCoords.bottom - fromCoords.top}px`,
          background: 'rgba(100, 150, 255, 0.15)',
          border: '1px solid rgba(100, 150, 255, 0.3)',
          borderRadius: '2px',
        });
        document.body.appendChild(highlightEl);
        if (activePicker) activePicker.highlight = highlightEl;
      }
      updateHighlight();

      // ── Drawing ──

      function drawSV() {
        const ctx = svCanvas.getContext('2d');
        const { r: hr, g: hg, b: hb } = hsvToRgb(hsv.h, 1, 1);
        ctx.fillStyle = `rgb(${Math.round(hr*255)},${Math.round(hg*255)},${Math.round(hb*255)})`;
        ctx.fillRect(0, 0, SVW, SVH);
        const wg = ctx.createLinearGradient(0, 0, SVW, 0);
        wg.addColorStop(0, 'rgba(255,255,255,1)');
        wg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = wg;
        ctx.fillRect(0, 0, SVW, SVH);
        const bg = ctx.createLinearGradient(0, 0, 0, SVH);
        bg.addColorStop(0, 'rgba(0,0,0,0)');
        bg.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, SVW, SVH);
        // Handle
        const x = hsv.s * SVW, y = (1 - hsv.v) * SVH;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      function drawHue() {
        const ctx = hueCanvas.getContext('2d');
        // Vertical hue gradient (top to bottom)
        const grad = ctx.createLinearGradient(0, 0, 0, SVH);
        for (let i = 0; i <= 6; i++) {
          const { r: cr, g: cg, b: cb } = hsvToRgb(i / 6, 1, 1);
          grad.addColorStop(i / 6, `rgb(${Math.round(cr*255)},${Math.round(cg*255)},${Math.round(cb*255)})`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, BAR, SVH);
        // Horizontal handle
        const y = hsv.h * SVH;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, y - 2, BAR, 4);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, y - 2, BAR, 4);
      }

      function drawAlpha() {
        const ctx = alphaCanvas.getContext('2d');
        // Checkerboard
        ctx.clearRect(0, 0, BAR, SVH);
        for (let cx = 0; cx < BAR; cx += 5) {
          for (let cy = 0; cy < SVH; cy += 5) {
            ctx.fillStyle = ((Math.floor(cx / 5) + Math.floor(cy / 5)) % 2 === 0) ? '#ccc' : '#fff';
            ctx.fillRect(cx, cy, 5, 5);
          }
        }
        // Vertical alpha gradient (top=transparent, bottom=solid)
        const { r: cr, g: cg, b: cb } = hsvToRgb(hsv.h, hsv.s, hsv.v);
        const grad = ctx.createLinearGradient(0, 0, 0, SVH);
        grad.addColorStop(0, `rgba(${Math.round(cr*255)},${Math.round(cg*255)},${Math.round(cb*255)},0)`);
        grad.addColorStop(1, `rgba(${Math.round(cr*255)},${Math.round(cg*255)},${Math.round(cb*255)},1)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, BAR, SVH);
        // Horizontal handle
        const y = alpha * SVH;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, y - 2, BAR, 4);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, y - 2, BAR, 4);
      }

      function updateDisplay() {
        const { r: cr, g: cg, b: cb } = hsvToRgb(hsv.h, hsv.s, hsv.v);
        const text = formatColor(cr, cg, cb, alpha, format);
        valueText.textContent = text;
        preview.style.background = `rgba(${Math.round(cr*255)},${Math.round(cg*255)},${Math.round(cb*255)},${alpha})`;
      }

      function applyColor() {
        const { r: cr, g: cg, b: cb } = hsvToRgb(hsv.h, hsv.s, hsv.v);
        const text = formatColor(cr, cg, cb, alpha, format);
        const currentText = view.state.doc.sliceString(from, to);
        if (text !== currentText) {
          pickerIsEditing = true;
          view.dispatch({ changes: { from, to, insert: text } });
          to = from + text.length;
          pickerIsEditing = false;
          updateHighlight();
        }
      }

      function redraw() { drawSV(); drawHue(); drawAlpha(); updateDisplay(); }

      // ── Drag interaction ──

      function makeDrag(canvas, onDrag) {
        const handler = (e) => {
          const rect = canvas.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
          onDrag(x, y);
          redraw();
          applyColor();
        };
        canvas.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handler(e);
          const move = (e2) => { e2.preventDefault(); handler(e2); };
          const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }

      makeDrag(svCanvas, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
      makeDrag(hueCanvas, (_x, y) => { hsv.h = y; });
      makeDrag(alphaCanvas, (_x, y) => { alpha = y; });

      redraw();

      // ── Position above swatch ──
      const rect = anchor.getBoundingClientRect();
      const totalH = SVH + GAP + 24 + PAD * 2;
      picker.style.left = `${rect.left}px`;
      picker.style.top = `${rect.top - totalH - 4}px`;
      document.body.appendChild(picker);

      // Flip below if no room above
      const pickerRect = picker.getBoundingClientRect();
      if (pickerRect.top < 0) {
        picker.style.top = `${rect.bottom + 4}px`;
      }
      // Clamp to right edge
      if (pickerRect.right > window.innerWidth) {
        picker.style.left = `${window.innerWidth - pickerRect.width - 8}px`;
      }

      // ── Close handlers ──
      const onOutside = (e) => {
        if (!picker.contains(e.target) && e.target !== anchor) closeColorPicker();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') closeColorPicker();
      };
      setTimeout(() => {
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onKey);
      }, 0);

      activePicker = {
        el: picker,
        highlight: highlightEl,
        cleanup: () => {
          if (highlightEl) highlightEl.remove();
          document.removeEventListener('mousedown', onOutside);
          document.removeEventListener('keydown', onKey);
        },
      };
    }

    // ── Widget activation ──
    // Bridges the module-scope ColorSwatchWidget back to this closure's
    // currentView + openColorPicker (which capture per-editor state).
    function activateSwatch(widget, anchorEl) {
      if (currentView) {
        openColorPicker(currentView, widget.r, widget.g, widget.b, widget.a, widget.rangeFrom, widget.rangeTo, anchorEl);
      }
    }

    // ── ViewPlugin ──

    return ViewPlugin.fromClass(class {
      constructor(view) {
        currentView = view;
        this.decorations = RangeSet.empty;
        this._timer = null;
        this._reqId = 0;
        this._scheduleRequest(view);
      }

      update(update) {
        currentView = update.view;
        if (!update.docChanged) return;
        // Don't re-fetch while the picker is applying edits
        if (pickerIsEditing) return;
        // Close picker if document changed externally
        if (activePicker) closeColorPicker();
        this._scheduleRequest(update.view);
      }

      _scheduleRequest(view) {
        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._requestColors(view, reqId);
        }, 500);
      }

      async _requestColors(view, reqId) {
        try {
          const root = projectStore.root;
          const result = await lspRequestDocumentColors(currentPath, root);
          if (reqId !== this._reqId) return;

          if (!result?.data?.colors?.length) {
            this.decorations = RangeSet.empty;
            view.requestMeasure();
            return;
          }

          const doc = view.state.doc;
          const widgets = [];
          for (const item of result.data.colors) {
            const pos = lspPositionToOffset(doc, item.range.start);
            const endPos = lspPositionToOffset(doc, item.range.end);
            if (pos >= 0 && pos <= doc.length && endPos > pos) {
              const { red, green, blue, alpha } = item.color;
              widgets.push(
                Decoration.widget({
                  widget: new ColorSwatchWidget(red, green, blue, alpha ?? 1, pos, endPos, activateSwatch),
                  side: -1,
                }).range(pos)
              );
            }
          }
          widgets.sort((a, b) => a.from - b.from);
          this.decorations = RangeSet.of(widgets);
          view.requestMeasure();
        } catch {
          // Silently ignore — document colors are best-effort
        }
      }

      destroy() {
        clearTimeout(this._timer);
        closeColorPicker();
      }
    }, {
      decorations: v => v.decorations,
    });
  }

  /**
   * CodeMirror extensions that provide LSP-based folding ranges.
   * A ViewPlugin fetches ranges asynchronously; a foldService serves
   * them synchronously to CodeMirror's fold system.
   *
   * @param {string} currentPath - current file path
   * @param {typeof import('@codemirror/view')} cmView - CodeMirror view module
   * @returns {import('@codemirror/state').Extension[]} CM extensions array
   */
  function foldingRangeExtension(currentPath, cmView) {
    const { ViewPlugin } = cmView;

    // Shared cache between the ViewPlugin (writer) and foldService (reader)
    let cachedRanges = [];

    const fetcher = ViewPlugin.fromClass(class {
      constructor(view) {
        this._timer = null;
        this._reqId = 0;
        this._scheduleRequest(view);
      }

      update(update) {
        if (!update.docChanged) return;
        this._scheduleRequest(update.view);
      }

      _scheduleRequest(view) {
        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._requestRanges(view, reqId);
        }, 500);
      }

      async _requestRanges(view, reqId) {
        try {
          const root = projectStore.root;
          const result = await lspRequestFoldingRanges(currentPath, root);
          if (reqId !== this._reqId) return;

          cachedRanges = (result?.data?.ranges || []).map(r => ({
            startLine: r.startLine,
            endLine: r.endLine,
          }));
        } catch {
          // Silently ignore
        }
      }

      destroy() {
        clearTimeout(this._timer);
        cachedRanges = [];
      }
    });

    const folder = foldService.of((state, lineStart, _lineEnd) => {
      const line = state.doc.lineAt(lineStart);
      const lineNum = line.number - 1; // 0-based (LSP uses 0-based lines)
      for (const r of cachedRanges) {
        if (r.startLine === lineNum) {
          // Convert 0-based LSP endLine to 1-based CM line number
          const endLineNum = Math.min(r.endLine + 1, state.doc.lines);
          const endLine = state.doc.line(endLineNum);
          // Use endLine.from (not .to) to keep closing delimiter visible,
          // matching CodeMirror's foldInside convention and VS Code behavior
          return { from: line.to, to: endLine.from };
        }
      }
      return null;
    });

    return [fetcher, folder];
  }

  /**
   * Standard LSP semantic token types legend.
   * Index position maps to the tokenType integer in the response data.
   */
  const SEMANTIC_TOKEN_TYPES = [
    'namespace', 'type', 'class', 'enum', 'interface', 'struct',
    'typeParameter', 'parameter', 'variable', 'property', 'enumMember',
    'event', 'function', 'method', 'macro', 'keyword', 'modifier',
    'comment', 'string', 'number', 'regexp', 'operator', 'decorator',
  ];

  /** Token types that get CSS classes (ones that add value beyond syntax highlighting) */
  const STYLED_TOKEN_TYPES = new Set([
    'type', 'interface', 'enum', 'enumMember', 'typeParameter',
    'parameter', 'property', 'namespace', 'decorator', 'macro',
  ]);

  /**
   * CodeMirror ViewPlugin that applies semantic token decorations
   * via LSP textDocument/semanticTokens/full.
   *
   * @param {string} currentPath - current file path
   * @param {typeof import('@codemirror/view')} cmView - CodeMirror view module
   * @param {typeof import('@codemirror/state')} cmState - CodeMirror state module
   * @returns {import('@codemirror/state').Extension} CM extension
   */
  function semanticTokensExtension(currentPath, cmView, cmState) {
    const { ViewPlugin, Decoration } = cmView;
    const { RangeSet } = cmState;

    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.decorations = RangeSet.empty;
        this._timer = null;
        this._reqId = 0;
        this._scheduleRequest(view);
      }

      update(update) {
        if (!update.docChanged) return;
        this._scheduleRequest(update.view);
      }

      _scheduleRequest(view) {
        clearTimeout(this._timer);
        if (!hasLsp || !currentPath) return;

        const reqId = ++this._reqId;
        this._timer = setTimeout(() => {
          this._requestTokens(view, reqId);
        }, 500);
      }

      async _requestTokens(view, reqId) {
        try {
          const root = projectStore.root;
          const result = await lspRequestSemanticTokensFull(currentPath, root);
          if (reqId !== this._reqId) return;

          const data = result?.data?.tokens?.data;
          if (!data?.length) {
            this.decorations = RangeSet.empty;
            view.requestMeasure();
            return;
          }

          const doc = view.state.doc;
          const marks = [];
          let line = 0;
          let char = 0;

          for (let i = 0; i < data.length; i += 5) {
            const deltaLine = data[i];
            const deltaStartChar = data[i + 1];
            const length = data[i + 2];
            const tokenTypeIdx = data[i + 3];

            line += deltaLine;
            char = deltaLine > 0 ? deltaStartChar : char + deltaStartChar;

            const tokenType = SEMANTIC_TOKEN_TYPES[tokenTypeIdx];
            if (!tokenType || !STYLED_TOKEN_TYPES.has(tokenType)) continue;

            // Convert 0-based line/char to document offset
            const lineNum = line + 1; // CM lines are 1-based
            if (lineNum > doc.lines) continue;
            const lineObj = doc.line(lineNum);
            const from = lineObj.from + char;
            const to = from + length;
            if (to > doc.length) continue;

            marks.push(
              Decoration.mark({ class: `cm-semantic-${tokenType}` }).range(from, to)
            );
          }

          // RangeSet.of requires sorted ranges
          marks.sort((a, b) => a.from - b.from || a.to - b.to);
          this.decorations = RangeSet.of(marks);
          view.requestMeasure();
        } catch {
          // Silently ignore — semantic tokens are best-effort
        }
      }

      destroy() {
        clearTimeout(this._timer);
      }
    }, {
      decorations: v => v.decorations,
    });
  }

  function diagnosticListener(currentPath, getView, cmCache) {
    return (event) => {
      const { uri, diagnostics: lspDiags } = event.payload;
      const v = getView();
      if (!v || !currentPath) return;
      const normalizedPath = currentPath.replace(/\\/g, '/');
      if (!uri.includes(normalizedPath)) return;

      try {
        const cm = cmCache;
        if (!cm) return;
        const cmDiags = lspDiags.map(d => {
          let from = lspPositionToOffset(v.state.doc, d.range.start);
          let to = lspPositionToOffset(v.state.doc, d.range.end);
          from = Math.max(0, Math.min(from, v.state.doc.length));
          to = Math.max(0, Math.min(to, v.state.doc.length));
          if (from > to) { const tmp = from; from = to; to = tmp; }
          return {
            from,
            to,
            severity: d.severity || 'error',
            message: d.message,
            source: d.source || undefined,
            lspDiagnostic: d,
          };
        });
        cachedDiagnostics.set(currentPath, cmDiags);
        v.dispatch(cm.setDiagnostics(v.state, cmDiags));
      } catch (err) {
        console.warn('[editor-lsp] Failed to apply diagnostics:', err);
      }
    };
  }

  // ── Lifecycle ──

  function reset() {
    clearTimeout(lspDebounceTimer);
    lspVersion = 0;
    hasLsp = false;
    dismissSignatureHelp();
  }

  function destroy() {
    clearTimeout(lspDebounceTimer);
  }

  return {
    // State (reactive getters)
    get lspVersion() { return lspVersion; },
    get hasLsp() { return hasLsp; },
    get cachedDiagnostics() { return cachedDiagnostics; },
    get showReferences() { return showReferences; },
    get referencesResult() { return referencesResult; },
    get showRename() { return showRename; },
    get renamePosition() { return renamePosition; },
    get renamePlaceholder() { return renamePlaceholder; },
    get showCodeActions() { return showCodeActions; },
    get codeActions() { return codeActions; },
    get codeActionsPosition() { return codeActionsPosition; },
    get showSignatureHelp() { return showSignatureHelp; },
    get signatureHelpData() { return signatureHelpData; },
    get signatureHelpPos() { return signatureHelpPos; },
    get signatureHelpCoords() { return signatureHelpCoords; },

    // Setters
    setHasLsp(val) { hasLsp = val; },
    setShowReferences(val) { showReferences = val; },
    setShowRename(val) { showRename = val; },
    setShowCodeActions(val) { showCodeActions = val; },
    setShowSignatureHelp(val) { showSignatureHelp = val; if (!val) signatureHelpData = null; },

    // Handlers
    openFile,
    closeFile,
    changeFile,
    saveFile,
    handleGoToDefinition,
    handleGoToTypeDefinition,
    handleGoToDeclaration,
    handleGoToImplementation,
    handleFindReferences,
    handleRenameSymbol,
    executeRename,
    handleCodeActions,
    requestSignatureHelp,
    dismissSignatureHelp,
    formatDocument,
    formatSelection,
    handleLinkedEditing,

    // CodeMirror extension factories
    completionSource,
    hoverTooltipExtension,
    documentHighlightExtension,
    inlayHintExtension,
    codeLensExtension,
    documentColorsExtension,
    foldingRangeExtension,
    semanticTokensExtension,
    onTypeFormattingExtension,
    linkedEditingExtension,
    diagnosticListener,

    // Lifecycle
    reset,
    destroy,
  };
}
