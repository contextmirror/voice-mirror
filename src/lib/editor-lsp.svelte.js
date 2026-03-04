/**
 * editor-lsp.svelte.js -- LSP helper module extracted from FileEditor.svelte.
 *
 * Provides a createEditorLsp() factory that encapsulates all LSP-specific state,
 * event listeners, handlers, and CodeMirror extension factories for the file editor.
 */

import { lspOpenFile, lspCloseFile, lspChangeFile, lspSaveFile, lspRequestCompletion, lspRequestHover, lspRequestDefinition, lspRequestTypeDefinition, lspRequestDeclaration, lspRequestImplementation, lspRequestReferences, lspRequestDocumentHighlight, lspRequestInlayHints, lspPrepareRename, lspRename, lspApplyWorkspaceEdit, lspRequestCodeActions, lspRequestFormatting, lspRequestRangeFormatting, lspRequestSignatureHelp, lspRequestLinkedEditingRange, lspRequestOnTypeFormatting } from './api.js';
import { projectStore } from './stores/project.svelte.js';
import { tabsStore } from './stores/tabs.svelte.js';
import { basename } from './utils.js';

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
        renamePosition = { x: coords?.left || 0, y: (coords?.bottom || 0) + 4 };
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
        codeActionsPosition = { x: coords?.left || 0, y: (coords?.bottom || 0) + 4 };
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

  // ── CodeMirror extension factories ──

  function completionSource(currentPath) {
    return async function lspCompletionSource(context) {
      if (!hasLsp || !currentPath) return null;
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

        return {
          pos,
          create() {
            const dom = document.createElement('div');
            dom.className = 'lsp-hover-tooltip';
            dom.textContent = typeof result.data.contents === 'string'
              ? result.data.contents
              : result.data.contents.value || '';
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
    const { ViewPlugin, Decoration, WidgetType } = cmView;
    const { RangeSet } = cmState;

    class InlayHintWidget extends WidgetType {
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
    }

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
    diagnosticListener,

    // Lifecycle
    reset,
    destroy,
  };
}
