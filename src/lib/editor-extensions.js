/**
 * editor-extensions.js -- Builds the CodeMirror 6 extensions array for FileEditor.
 *
 * Pure function module (no Svelte runes, no store imports). All dependencies
 * are passed in via parameters so FileEditor.svelte retains control of state.
 */
import { showMinimap } from '@replit/codemirror-minimap';

/**
 * Build the full CodeMirror extensions array for the file editor.
 *
 * @param {object} cm - CodeMirror module cache (EditorView, basicSetup, EditorState,
 *   EditorSelection, keymap, hoverTooltip, autocompletion, setDiagnostics, lintGutter)
 * @param {object} lsp - LSP helper from createEditorLsp()
 * @param {object} options
 * @param {boolean} options.isReadOnly - Whether the editor is read-only
 * @param {string} options.filePath - Current file path
 * @param {Array} options.voiceMirrorEditorTheme - Theme extension array
 * @param {function} options.onDocChanged - Callback for document change updates
 * @param {function} options.onDismissMenu - Callback to dismiss the context menu
 * @param {function} options.onSave - Callback for Mod-s
 * @param {function} [options.onFormat] - Callback for Shift-Alt-f format document
 * @param {object} [options.onSignatureHelp] - Signature help callbacks { onDocChanged(update), onSelectionChanged(update) }
 * @param {function} options.onContextMenu - Callback for context menu events (event, view)
 * @param {function} [options.onClick] - Callback for Ctrl+Click go-to-definition (event, view)
 * @returns {Array} CodeMirror extensions array
 */
export function buildEditorExtensions(cm, lsp, options) {
  const {
    isReadOnly,
    filePath,
    voiceMirrorEditorTheme,
    onDocChanged,
    onDismissMenu,
    onSave,
    onFormat,
    onSignatureHelp,
    onContextMenu,
    onClick,
  } = options;

  const extensions = [
    cm.basicSetup,
    ...voiceMirrorEditorTheme,
    ...(isReadOnly ? [cm.EditorState.readOnly.of(true)] : []),
    cm.lintGutter(),
    cm.autocompletion(lsp.hasLsp ? {
      override: [lsp.completionSource(filePath)],
      maxRenderedOptions: 20,
    } : {
      activateOnTyping: true,
      maxRenderedOptions: 20,
    }),
    cm.EditorView.updateListener.of((update) => {
      if ((update.docChanged || update.viewportChanged)) {
        onDismissMenu();
      }
      if (update.docChanged) {
        onDocChanged(update);
        // Signature help trigger detection
        if (onSignatureHelp) {
          onSignatureHelp.onDocChanged(update);
        }
      }
      // Dismiss signature help when cursor moves without doc change
      if (onSignatureHelp && !update.docChanged && update.selectionSet) {
        onSignatureHelp.onSelectionChanged(update);
      }
    }),
    cm.keymap.of([
      { key: 'Mod-s', run: () => { onSave(); return true; } },
      ...(onFormat ? [{ key: 'Shift-Alt-f', run: () => { onFormat(); return true; } }] : []),
      // Multi-cursor: add cursor on line above/below (VS Code / Zed standard)
      { key: 'Ctrl-Alt-ArrowUp', run: (v) => {
        const ranges = v.state.selection.ranges;
        const first = ranges[0];
        const line = v.state.doc.lineAt(first.head);
        if (line.number <= 1) return false;
        const prevLine = v.state.doc.line(line.number - 1);
        const col = first.head - line.from;
        const newHead = prevLine.from + Math.min(col, prevLine.length);
        v.dispatch({ selection: cm.EditorSelection.create([...ranges, cm.EditorSelection.cursor(newHead)]) });
        return true;
      }},
      { key: 'Ctrl-Alt-ArrowDown', run: (v) => {
        const ranges = v.state.selection.ranges;
        const last = ranges[ranges.length - 1];
        const line = v.state.doc.lineAt(last.head);
        if (line.number >= v.state.doc.lines) return false;
        const nextLine = v.state.doc.line(line.number + 1);
        const col = last.head - line.from;
        const newHead = nextLine.from + Math.min(col, nextLine.length);
        v.dispatch({ selection: cm.EditorSelection.create([...ranges, cm.EditorSelection.cursor(newHead)]) });
        return true;
      }},
    ]),
  ];

  // Minimap — VS Code-style code overview on the right
  extensions.push(
    showMinimap.compute(['doc'], () => {
      return {
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-minimap-container';
          return { dom };
        },
        displayText: 'blocks',
        showOverlay: 'always',
      };
    })
  );

  // Add hover tooltip and LSP keybindings
  if (lsp.hasLsp) {
    extensions.push(lsp.hoverTooltipExtension(filePath, cm.hoverTooltip));
    extensions.push(cm.keymap.of([
      { key: 'F2', run: (v) => { lsp.handleRenameSymbol(v, filePath); return true; } },
      { key: 'Shift-F12', run: (v) => { lsp.handleFindReferences(v, filePath); return true; } },
      { key: 'Mod-.', run: (v) => { lsp.handleCodeActions(v, filePath); return true; } },
      { key: 'Ctrl-Shift-Space', run: (v) => { lsp.requestSignatureHelp(v, filePath, null); return true; } },
    ]));
  }

  // Context menu + optional Ctrl+Click go-to-definition
  const domHandlers = {
    contextmenu: onContextMenu,
  };

  if (lsp.hasLsp && onClick) {
    domHandlers.click = onClick;
  }

  extensions.push(cm.EditorView.domEventHandlers(domHandlers));

  return extensions;
}
