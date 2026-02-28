/**
 * editor-extensions.js -- Builds the CodeMirror 6 extensions array for FileEditor.
 *
 * Pure function module (no Svelte runes, no store imports). All dependencies
 * are passed in via parameters so FileEditor.svelte retains control of state.
 */
import { indentWithTab } from '@codemirror/commands';
import { showMinimap } from '@replit/codemirror-minimap';
import { createGitGutter } from './editor-git-gutter.js';

/**
 * Creates a CodeMirror ViewPlugin that underlines the word under the cursor
 * when Ctrl (or Meta on Mac) is held, providing visual feedback for Ctrl+Click
 * go-to-definition.
 */
function createDefinitionHintPlugin(cm) {
  const { ViewPlugin, Decoration } = cm;

  const hintMark = Decoration.mark({ class: 'cm-definition-hint' });

  return ViewPlugin.fromClass(class {
    decorations;
    ctrlDown = false;
    mouseX = 0;
    mouseY = 0;

    constructor(view) {
      this.decorations = Decoration.set([]);
      this.view = view;
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleKeyUp = this.handleKeyUp.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseLeave = this.handleMouseLeave.bind(this);

      view.dom.addEventListener('keydown', this.handleKeyDown);
      view.dom.addEventListener('keyup', this.handleKeyUp);
      view.dom.addEventListener('mousemove', this.handleMouseMove);
      view.dom.addEventListener('mouseleave', this.handleMouseLeave);
    }

    handleKeyDown(e) {
      if (e.key === 'Control' || e.key === 'Meta') {
        this.ctrlDown = true;
        this.updateDecoration();
      }
    }

    handleKeyUp(e) {
      if (e.key === 'Control' || e.key === 'Meta') {
        this.ctrlDown = false;
        this.decorations = Decoration.set([]);
        this.view.requestMeasure();
      }
    }

    handleMouseMove(e) {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.ctrlDown) {
        this.updateDecoration();
      }
    }

    handleMouseLeave() {
      this.ctrlDown = false;
      this.decorations = Decoration.set([]);
    }

    updateDecoration() {
      const pos = this.view.posAtCoords({ x: this.mouseX, y: this.mouseY });
      if (pos == null) {
        this.decorations = Decoration.set([]);
        return;
      }

      // Find word boundaries at position
      const { state } = this.view;
      const line = state.doc.lineAt(pos);
      const lineText = line.text;
      const col = pos - line.from;

      // Find word start/end using simple word boundary detection
      let start = col;
      let end = col;
      while (start > 0 && /\w/.test(lineText[start - 1])) start--;
      while (end < lineText.length && /\w/.test(lineText[end])) end++;

      if (start === end) {
        this.decorations = Decoration.set([]);
        return;
      }

      const from = line.from + start;
      const to = line.from + end;
      this.decorations = Decoration.set([hintMark.range(from, to)]);
    }

    destroy() {
      this.view.dom.removeEventListener('keydown', this.handleKeyDown);
      this.view.dom.removeEventListener('keyup', this.handleKeyUp);
      this.view.dom.removeEventListener('mousemove', this.handleMouseMove);
      this.view.dom.removeEventListener('mouseleave', this.handleMouseLeave);
    }
  }, {
    decorations: (v) => v.decorations,
  });
}

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
 * @param {function} [options.getOriginalContent] - Async callback returning original git content for diff gutter
 * @param {function} [options.onClick] - Callback for Ctrl+Click go-to-definition (event, view)
 * @param {function} [options.onFontZoom] - Callback for font zoom (delta: +1, -1, or 0 to reset)
 * @param {function} [options.onCursorActivity] - Callback for cursor position changes (update)
 * @param {function} [options.onNavigateBack] - Callback for Alt+Left navigation history back
 * @param {function} [options.onNavigateForward] - Callback for Alt+Right navigation history forward
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
    getOriginalContent,
    onFontZoom,
    onCursorActivity,
    onNavigateBack,
    onNavigateForward,
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
      // Status bar cursor tracking
      if (update.selectionSet || update.docChanged) {
        if (onCursorActivity) {
          onCursorActivity(update);
        }
      }
    }),
    cm.keymap.of([
      indentWithTab,
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
      // Font zoom: Ctrl+= (increase), Ctrl+- (decrease), Ctrl+0 (reset)
      ...(onFontZoom ? [
        { key: 'Ctrl-=', run: () => { onFontZoom(1); return true; } },
        { key: 'Ctrl--', run: () => { onFontZoom(-1); return true; } },
        { key: 'Ctrl-0', run: () => { onFontZoom(0); return true; } },
      ] : []),
      // Navigation history: Alt+Left (back), Alt+Right (forward)
      ...(onNavigateBack ? [{ key: 'Alt-Left', run: () => { onNavigateBack(); return true; } }] : []),
      ...(onNavigateForward ? [{ key: 'Alt-Right', run: () => { onNavigateForward(); return true; } }] : []),
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

  // Git change gutter — skip for read-only / external files
  if (getOriginalContent && !isReadOnly) {
    extensions.push(...createGitGutter(getOriginalContent));
  }

  // Add hover tooltip and LSP keybindings
  if (lsp.hasLsp) {
    extensions.push(lsp.hoverTooltipExtension(filePath, cm.hoverTooltip));
    extensions.push(cm.keymap.of([
      { key: 'F12', run: (v) => { lsp.handleGoToDefinition(v, v.state.selection.main.head); return true; } },
      { key: 'F2', run: (v) => { lsp.handleRenameSymbol(v, filePath); return true; } },
      { key: 'Shift-F12', run: (v) => { lsp.handleFindReferences(v, filePath); return true; } },
      { key: 'Mod-.', run: (v) => { lsp.handleCodeActions(v, filePath); return true; } },
      { key: 'Ctrl-Shift-Space', run: (v) => { lsp.requestSignatureHelp(v, filePath, null); return true; } },
    ]));
  }

  // Ctrl+hover definition underline hint
  if (lsp.hasLsp) {
    extensions.push(createDefinitionHintPlugin(cm));
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
