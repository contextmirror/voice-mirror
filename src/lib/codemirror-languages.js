/**
 * codemirror-languages.js -- Shared CodeMirror language extension loader.
 *
 * Lazy-loads CodeMirror language packages based on file extension.
 * Used by FileEditor and DiffViewer to avoid duplicating the switch block.
 */

/**
 * Load the CodeMirror language extension for a given file path.
 *
 * @param {string} filePath - The file path (used to extract extension).
 * @returns {Promise<import('@codemirror/state').Extension | Array>} Language extension or empty array.
 */
export async function loadLanguageExtension(filePath) {
  const ext = filePath?.split('.').pop()?.toLowerCase() || '';
  try {
    switch (ext) {
      case 'js': case 'jsx': case 'mjs': case 'cjs': {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript();
      }
      case 'ts': case 'tsx': {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript({ typescript: true });
      }
      case 'rs': {
        const { rust } = await import('@codemirror/lang-rust');
        return rust();
      }
      case 'css': case 'scss': {
        const { css } = await import('@codemirror/lang-css');
        return css();
      }
      case 'html': case 'svelte': {
        const { html } = await import('@codemirror/lang-html');
        return html();
      }
      case 'json': {
        const { json } = await import('@codemirror/lang-json');
        return json();
      }
      case 'md': case 'markdown': {
        const { markdown } = await import('@codemirror/lang-markdown');
        return markdown();
      }
      case 'py': case 'python': {
        const { python } = await import('@codemirror/lang-python');
        return python();
      }
      default:
        return [];
    }
  } catch (err) {
    console.warn('[codemirror-languages] Language load failed for', ext, err);
    return [];
  }
}
