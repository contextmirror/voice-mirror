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
