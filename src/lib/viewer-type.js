/**
 * viewer-type.js — Resolve which in-app viewer should render a given file.
 *
 * The Lens editor pane routes every `type:'file'` tab through FileViewer, which
 * uses this resolver to pick a sub-viewer by file extension. Keeping the mapping
 * here (rather than inside a component) makes it trivially testable and means a
 * non-text click never enters CodeMirror's text-read path — so a raw
 * "File not found (os error 2)" or a dead-end "Binary file" panel can't surface.
 *
 * @typedef {'text'|'image'|'pdf'|'office'|'binary'} ViewerType
 */

/** Image formats WebView2 can render directly as <img src>. */
const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);

/** PDF — rendered in-app via an <iframe> (Edge/WebView2 native PDF viewer). */
const PDF_EXTS = new Set(['pdf']);

/** Word documents — previewed in-app via mammoth (docx) with a binary fallback. */
const OFFICE_EXTS = new Set(['docx', 'doc']);

/**
 * Known-binary formats that have no in-app preview — these route straight to the
 * BinaryFilePanel (open / reveal actions). Anything NOT listed here (and not an
 * image/pdf/office type) defaults to 'text' so unknown code-ish files still open
 * in CodeMirror.
 */
const BINARY_EXTS = new Set([
  // Archives
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz', 'zst',
  // Executables / libraries / objects
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'obj', 'class', 'wasm', 'pdb',
  // Audio / video
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'm4v',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Office (non-Word — no in-app preview yet)
  'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp',
  // Databases / misc binary
  'db', 'sqlite', 'sqlite3', 'dat', 'pack', 'idx',
]);

/**
 * Extract the lowercased extension (without the dot) from a path.
 * Returns '' when there is no extension. Untitled paths (`untitled:1`) and
 * extensionless files resolve to '' → 'text'.
 * @param {string} path
 * @returns {string}
 */
function extOf(path) {
  if (!path || typeof path !== 'string') return '';
  // Strip any trailing query/hash just in case.
  const clean = path.split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return ''; // no dot, or dotfile like ".gitignore"
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Resolve the viewer type for a file path.
 * @param {string} path - File path (relative or absolute).
 * @returns {ViewerType}
 */
export function resolveViewerType(path) {
  const ext = extOf(path);
  if (!ext) return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (OFFICE_EXTS.has(ext)) return 'office';
  if (BINARY_EXTS.has(ext)) return 'binary';
  return 'text';
}

export { IMAGE_EXTS, PDF_EXTS, OFFICE_EXTS, BINARY_EXTS };
