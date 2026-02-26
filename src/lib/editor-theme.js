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
