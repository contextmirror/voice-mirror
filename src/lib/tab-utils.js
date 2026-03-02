/**
 * Get an icon category for a tab based on its type and file extension.
 * @param {{ type?: string, title?: string }} tab
 * @returns {string}
 */
export function getTabIcon(tab) {
  if (tab.type === 'diff') return 'diff';
  const ext = tab.title?.split('.').pop()?.toLowerCase() || '';
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) return 'code';
  if (['rs'].includes(ext)) return 'code';
  if (['css', 'scss', 'less'].includes(ext)) return 'palette';
  if (['html', 'svelte', 'vue'].includes(ext)) return 'code';
  if (['json', 'toml', 'yaml', 'yml'].includes(ext)) return 'settings';
  if (['md', 'txt', 'log'].includes(ext)) return 'doc';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  return 'file';
}
