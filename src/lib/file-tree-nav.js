/**
 * file-tree-nav.js — Pure utility functions for file tree navigation and drag-to-move.
 *
 * Used by FileTree.svelte for keyboard navigation (flattenVisibleEntries)
 * and drag-to-move validation (isDescendantOf, getParentPath).
 */

/**
 * Flatten the recursive file tree into a visible-entry list for keyboard navigation.
 * Walks rootEntries, recursing into expanded directories.
 *
 * @param {Array<{name: string, path: string, type: 'file'|'directory'}>} rootEntries
 * @param {Set<string>} expandedDirs - Paths of currently expanded directories
 * @param {Map<string, Array>} dirChildren - Map of dir path → child entries
 * @returns {Array<{entry: {name: string, path: string, type: string}, depth: number, parentPath: string}>}
 */
export function flattenVisibleEntries(rootEntries, expandedDirs, dirChildren) {
  const result = [];
  function walk(entries, depth, parentPath) {
    for (const entry of entries) {
      result.push({ entry, depth, parentPath });
      if (entry.type === 'directory' && expandedDirs.has(entry.path)) {
        const children = dirChildren.get(entry.path);
        if (children) walk(children, depth + 1, entry.path);
      }
    }
  }
  walk(rootEntries, 0, '');
  return result;
}

/**
 * Check if childPath is the same as or a descendant of ancestorPath.
 * Uses separator-aware prefix matching to avoid false positives
 * (e.g. 'src-backup' is NOT a descendant of 'src').
 *
 * @param {string} childPath
 * @param {string} ancestorPath
 * @returns {boolean}
 */
export function isDescendantOf(childPath, ancestorPath) {
  if (!ancestorPath) return false;
  return childPath === ancestorPath || childPath.startsWith(ancestorPath + '/');
}

/**
 * Extract the parent directory path from a slash-separated relative path.
 * Returns '' for root-level entries (no slash in path).
 *
 * @param {string} filePath
 * @returns {string}
 */
export function getParentPath(filePath) {
  const idx = filePath.lastIndexOf('/');
  return idx > 0 ? filePath.substring(0, idx) : '';
}
