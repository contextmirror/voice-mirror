/**
 * editor-theme.js -- Custom CodeMirror 6 theme using CSS variables.
 *
 * Instead of hardcoding colors (like oneDark), this theme references
 * --cm-xxx CSS variables set by the app's theme system (deriveTheme).
 * When the user switches theme presets, the CSS variables update and
 * the editor recolors instantly with zero JS dispatch.
 *
 * Usage: import { voiceMirrorEditorTheme } from './editor-theme.js'
 * then use it in place of `oneDark` in the extensions array.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ── Editor chrome (gutters, selections, cursor, panels) ──

const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--cm-foreground)',
    backgroundColor: 'var(--cm-background)',
  },
  '.cm-scroller': {
    scrollBehavior: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--cm-cursor)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--cm-font-size, 14px)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--cm-cursor)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--cm-selection)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--cm-panel-bg)',
    color: 'var(--cm-foreground)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border)',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--border)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--cm-search-match)',
    outline: '1px solid var(--cm-accent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--cm-selection)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--cm-line-highlight)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--cm-selection-match)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--cm-bracket-match)',
    outline: '1px solid var(--cm-bracket-match-border)',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--cm-bracket-mismatch)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--cm-gutter-bg)',
    color: 'var(--cm-gutter-fg)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--cm-gutter-active-bg)',
    color: 'var(--cm-gutter-active-fg)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--cm-fold-placeholder)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--cm-tooltip-bg)',
    color: 'var(--cm-foreground)',
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: 'var(--cm-tooltip-bg)',
    borderBottomColor: 'var(--cm-tooltip-bg)',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--cm-autocomplete-selected)',
      color: 'var(--cm-foreground)',
    },
  },
  // ── LSP hover tooltip (markdown) ──
  '.lsp-hover-tooltip': {
    maxWidth: '500px',
    padding: '8px 12px',
    fontSize: '13px',
    lineHeight: '1.4',
    overflow: 'auto',
    maxHeight: '300px',
  },
  '.lsp-hover-tooltip p': {
    margin: '2px 0',
  },
  '.lsp-hover-tooltip p:first-child': {
    marginTop: '0',
  },
  '.lsp-hover-tooltip p:last-child': {
    marginBottom: '0',
  },
  '.lsp-hover-tooltip ul': {
    margin: '2px 0',
    paddingLeft: '16px',
  },
  '.lsp-hover-tooltip li': {
    margin: '0',
  },
  '.lsp-hover-tooltip pre': {
    margin: '4px 0',
    padding: '6px 8px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    overflow: 'auto',
  },
  '.lsp-hover-tooltip pre code': {
    fontSize: '12px',
    fontFamily: "var(--cm-font-family, 'Consolas', 'Monaco', monospace)",
    whiteSpace: 'pre',
  },
  '.lsp-hover-tooltip code': {
    fontSize: '12px',
    fontFamily: "var(--cm-font-family, 'Consolas', 'Monaco', monospace)",
    padding: '1px 4px',
    borderRadius: '3px',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  '.lsp-hover-tooltip pre code': {
    padding: '0',
    backgroundColor: 'transparent',
  },
  '.lsp-hover-tooltip hr': {
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '6px 0',
  },
  // ── highlight.js token colors (mapped to CM CSS vars) ──
  '.lsp-hover-tooltip .hljs-keyword': { color: 'var(--cm-keyword)' },
  '.lsp-hover-tooltip .hljs-built_in': { color: 'var(--cm-function)' },
  '.lsp-hover-tooltip .hljs-type': { color: 'var(--cm-type)' },
  '.lsp-hover-tooltip .hljs-string': { color: 'var(--cm-string)' },
  '.lsp-hover-tooltip .hljs-number': { color: 'var(--cm-number)' },
  '.lsp-hover-tooltip .hljs-literal': { color: 'var(--cm-constant)' },
  '.lsp-hover-tooltip .hljs-comment': { color: 'var(--cm-comment)', fontStyle: 'italic' },
  '.lsp-hover-tooltip .hljs-function': { color: 'var(--cm-function)' },
  '.lsp-hover-tooltip .hljs-title': { color: 'var(--cm-function)' },
  '.lsp-hover-tooltip .hljs-params': { color: 'var(--cm-foreground)' },
  '.lsp-hover-tooltip .hljs-variable': { color: 'var(--cm-variable)' },
  '.lsp-hover-tooltip .hljs-attr': { color: 'var(--cm-attribute)' },
  '.lsp-hover-tooltip .hljs-property': { color: 'var(--cm-property)' },
  '.lsp-hover-tooltip .hljs-punctuation': { color: 'var(--cm-punctuation)' },
  '.lsp-hover-tooltip .hljs-operator': { color: 'var(--cm-operator)' },
  '.lsp-hover-tooltip .hljs-meta': { color: 'var(--cm-keyword)' },
  '.lsp-hover-tooltip .hljs-tag': { color: 'var(--cm-tag)' },
  '.lsp-hover-tooltip .hljs-name': { color: 'var(--cm-tag)' },
  '.lsp-hover-tooltip .hljs-selector-class': { color: 'var(--cm-type)' },
  '.lsp-hover-tooltip .hljs-selector-id': { color: 'var(--cm-type)' },
  // ── Minimap ──
  '.cm-minimap': {
    backgroundColor: 'var(--cm-background)',
  },
  '.cm-minimap-container': {
    borderLeft: '1px solid var(--cm-gutter-bg, var(--border))',
  },
  '.cm-minimap .cm-minimap-overlay': {
    background: 'var(--cm-selection)',
    borderTop: '1px solid var(--cm-accent, var(--accent))',
    borderBottom: '1px solid var(--cm-accent, var(--accent))',
  },
  // ── Git change gutter ──
  // Git gutter bar styles are in editor-git-gutter.js baseTheme (avoids scoping issues)
  // ── Git peek widget ──
  '.cm-git-peek': {
    backgroundColor: 'var(--cm-panel-bg, var(--bg-elevated))',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    margin: '4px 0 4px 24px',
    overflow: 'hidden',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    maxWidth: 'min(600px, calc(100% - 48px))',
    minWidth: '280px',
  },
  '.cm-git-peek-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
    borderBottom: '1px solid var(--border)',
    fontSize: '11px',
    color: 'var(--cm-foreground)',
  },
  '.cm-git-peek-label': {
    fontWeight: '600',
  },
  '.cm-git-peek-nav': {
    display: 'flex',
    gap: '2px',
  },
  '.cm-git-peek-btn': {
    background: 'transparent',
    border: 'none',
    color: 'var(--cm-foreground)',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '12px',
    lineHeight: '1',
  },
  '.cm-git-peek-btn:hover': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  },
  '.cm-git-peek-btn:disabled': {
    opacity: '0.3',
    cursor: 'default',
  },
  '.cm-git-peek-body': {
    padding: '4px 0',
    maxHeight: '200px',
    overflow: 'auto',
  },
  '.cm-git-peek-line': {
    padding: '0 8px',
    lineHeight: '1.6',
    whiteSpace: 'pre',
    minWidth: 'fit-content',
  },
  '.cm-git-peek-line.removed': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)',
    color: 'var(--danger)',
  },
  '.cm-git-peek-line.added': {
    backgroundColor: 'color-mix(in srgb, var(--ok) 12%, transparent)',
    color: 'var(--ok)',
  },
  '.cm-git-peek-actions': {
    padding: '4px 8px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  '.cm-git-peek-revert': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 15%, transparent)',
    color: 'var(--danger)',
    border: '1px solid var(--danger)',
    padding: '3px 10px',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '600',
  },
  '.cm-git-peek-revert:hover': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 25%, transparent)',
  },
  // ── Ctrl+hover definition hint ──
  '.cm-definition-hint': {
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent)',
    cursor: 'pointer',
  },
  // ── Lightbulb gutter (code actions) ──
  '.cm-lightbulb-gutter': {
    width: '16px',
    minWidth: '16px',
  },
  '.cm-lightbulb-gutter .cm-gutterElement': {
    padding: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-lightbulb': {
    fontSize: '12px',
    cursor: 'pointer',
    opacity: '0.85',
    lineHeight: '1',
  },
  '.cm-lightbulb:hover': {
    opacity: '1',
    transform: 'scale(1.15)',
  },
  // ── Document highlight (same-symbol occurrences) ──
  '.cm-lsp-highlight': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    borderRadius: '2px',
  },
  // ── Inlay hints (type annotations, parameter names) ──
  '.cm-inlay-hint': {
    color: '#969696',
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    fontSize: '0.9em',
    padding: '0 4px',
    borderRadius: '3px',
    fontFamily: 'inherit',
  },
  '.cm-inlay-hint-type': {
    fontStyle: 'italic',
  },
  '.cm-inlay-hint-parameter': {
    opacity: '0.8',
  },
  // ── Code lens (reference counts, test actions) ──
  '.cm-code-lens': {
    color: '#969696',
    fontSize: '0.85em',
    fontFamily: 'inherit',
    padding: '2px 0',
    display: 'block',
    cursor: 'default',
  },
  // ── Document colors (inline color swatches) ──
  '.cm-color-swatch': {
    display: 'inline-block',
    width: '0.8em',
    height: '0.8em',
    borderRadius: '2px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    marginRight: '4px',
    verticalAlign: 'middle',
  },
  // ── Semantic tokens (LSP-provided token coloring) ──
  '.cm-semantic-type': { color: 'var(--cm-type)' },
  '.cm-semantic-interface': { color: 'var(--cm-type)', fontStyle: 'italic' },
  '.cm-semantic-enum': { color: 'var(--cm-type)' },
  '.cm-semantic-enumMember': { color: 'var(--cm-constant)' },
  '.cm-semantic-typeParameter': { color: 'var(--cm-type)', opacity: '0.85' },
  '.cm-semantic-parameter': { color: 'var(--cm-variable)' },
  '.cm-semantic-property': { color: 'var(--cm-property)' },
  '.cm-semantic-namespace': { color: 'var(--cm-keyword)' },
  '.cm-semantic-decorator': { color: 'var(--cm-keyword)', fontStyle: 'italic' },
  '.cm-semantic-macro': { color: 'var(--cm-function)', fontWeight: 'bold' },
}, { dark: true });

// ── Syntax highlighting ──
// Maps lezer tags to --cm-xxx CSS variables.
// The color groups follow the oneDark convention but use theme-derived colors.

const highlightStyle = HighlightStyle.define([
  // Keywords (accent color — cyan, blue, pink, etc. per theme)
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: 'var(--cm-keyword)', fontWeight: 'bold' },
  { tag: tags.operatorKeyword, color: 'var(--cm-operator)' },

  // Names and properties
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'var(--cm-property)' },
  { tag: [tags.propertyName], color: 'var(--cm-property)' },
  { tag: [tags.definition(tags.name), tags.separator], color: 'var(--cm-foreground)' },

  // Functions
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--cm-function)' },

  // Types and classes (warm/yellow tones)
  { tag: [tags.typeName, tags.className, tags.annotation, tags.modifier, tags.self, tags.namespace], color: 'var(--cm-type)' },

  // Numbers
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--cm-number)' },
  { tag: [tags.changed], color: 'var(--cm-number)' },

  // Constants and atoms (booleans, null, etc.)
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: 'var(--cm-constant)' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName), tags.null], color: 'var(--cm-constant)' },

  // Strings (green/ok tones)
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: 'var(--cm-string)' },
  { tag: [tags.character, tags.special(tags.string)], color: 'var(--cm-string)' },

  // Operators and special syntax
  { tag: [tags.operator, tags.derefOperator], color: 'var(--cm-operator)' },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: 'var(--cm-operator)' },

  // Comments (muted, italic)
  { tag: [tags.meta, tags.comment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--cm-comment)', fontStyle: 'italic' },

  // Markup / Markdown
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--cm-link)', textDecoration: 'underline' },
  { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3], fontWeight: 'bold', color: 'var(--cm-property)' },

  // Punctuation
  { tag: [tags.punctuation, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren, tags.brace], color: 'var(--cm-punctuation)' },

  // HTML/XML tags
  { tag: tags.tagName, color: 'var(--cm-tag)' },
  { tag: tags.attributeName, color: 'var(--cm-attribute)' },
  { tag: tags.attributeValue, color: 'var(--cm-string)' },

  // Invalid
  { tag: tags.invalid, color: 'var(--cm-invalid)' },

  // Variable names (default text color for local vars)
  { tag: tags.variableName, color: 'var(--cm-variable)' },
  { tag: tags.definition(tags.variableName), color: 'var(--cm-variable-def)' },
]);

// ── Combined export ──
// Drop-in replacement for oneDark

export const voiceMirrorEditorTheme = [editorTheme, syntaxHighlighting(highlightStyle)];
