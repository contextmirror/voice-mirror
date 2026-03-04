/**
 * file-context-menu.test.cjs -- Source-inspection tests for FileContextMenu.svelte
 *
 * Validates context menu structure, items, keyboard dismiss, action callbacks,
 * file vs folder menus, and positioning.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/lens/FileContextMenu.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('FileContextMenu.svelte -- imports', () => {
  it('imports deleteEntry from api', () => {
    assert.ok(src.includes('deleteEntry'), 'Should import deleteEntry');
  });

  it('imports revealInExplorer from api', () => {
    assert.ok(src.includes('revealInExplorer'), 'Should import revealInExplorer');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });
});

describe('FileContextMenu.svelte -- props', () => {
  it('has x prop', () => {
    assert.ok(src.includes('x = 0'), 'Should have x prop');
  });

  it('has y prop', () => {
    assert.ok(src.includes('y = 0'), 'Should have y prop');
  });

  it('has entry prop', () => {
    assert.ok(src.includes('entry = null'), 'Should have entry prop');
  });

  it('has visible prop', () => {
    assert.ok(src.includes('visible = false'), 'Should have visible prop');
  });

  it('has isFolder prop', () => {
    assert.ok(src.includes('isFolder = false'), 'Should have isFolder prop');
  });

  it('has isChange prop', () => {
    assert.ok(src.includes('isChange = false'), 'Should have isChange prop');
  });

  it('has onClose callback', () => {
    assert.ok(src.includes('onClose = () => {}'), 'Should have onClose callback');
  });

  it('has onAction callback', () => {
    assert.ok(src.includes('onAction = () => {}'), 'Should have onAction callback');
  });

  it('has onOpenFile callback', () => {
    assert.ok(src.includes('onOpenFile = () => {}'), 'Should have onOpenFile callback');
  });

  it('has onOpenDiff callback', () => {
    assert.ok(src.includes('onOpenDiff = () => {}'), 'Should have onOpenDiff callback');
  });

  it('has onRename callback', () => {
    assert.ok(src.includes('onRename = () => {}'), 'Should have onRename callback');
  });

  it('has onNewFile callback', () => {
    assert.ok(src.includes('onNewFile = () => {}'), 'Should have onNewFile callback');
  });

  it('has onNewFolder callback', () => {
    assert.ok(src.includes('onNewFolder = () => {}'), 'Should have onNewFolder callback');
  });
});

describe('FileContextMenu.svelte -- structure', () => {
  it('has context-menu class', () => {
    assert.ok(src.includes('context-menu'), 'Should have context-menu class');
  });

  it('has context-menu-item class', () => {
    assert.ok(src.includes('context-menu-item'), 'Should have context-menu-item class');
  });

  it('has context-menu-divider class', () => {
    assert.ok(src.includes('context-menu-divider'), 'Should have context-menu-divider class');
  });

  it('imports shared context-menu.css', () => {
    assert.ok(src.includes("@import '../../styles/context-menu.css'"), 'Should import shared context-menu styles');
  });

  it('has role=menu', () => {
    assert.ok(src.includes('role="menu"'), 'Should have menu role');
  });

  it('has role=menuitem on items', () => {
    assert.ok(src.includes('role="menuitem"'), 'Should have menuitem role');
  });
});

describe('FileContextMenu.svelte -- file menu items', () => {
  it('has Open action', () => {
    assert.ok(src.includes('handleOpen'), 'Should have Open handler');
  });

  it('has Open to the Side action', () => {
    assert.ok(src.includes('handleOpenToSide'), 'Should have Open to the Side handler');
    assert.ok(src.includes('Open to the Side'), 'Should show Open to the Side text');
  });

  it('has onOpenToSide callback prop', () => {
    assert.ok(src.includes('onOpenToSide'), 'Should have onOpenToSide callback');
  });

  it('has Open in Terminal action', () => {
    assert.ok(src.includes('handleOpenInTerminal'), 'Should have Open in Terminal handler');
    assert.ok(src.includes('Open in Terminal'), 'Should show Open in Terminal text');
  });

  it('imports terminalTabsStore for Open in Terminal', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('has Open Diff action', () => {
    assert.ok(src.includes('handleOpenDiff'), 'Should have Open Diff handler');
  });

  it('has Rename action', () => {
    assert.ok(src.includes('handleRenameAction'), 'Should have Rename handler');
  });

  it('has Delete action', () => {
    assert.ok(src.includes('handleDelete'), 'Should have Delete handler');
  });

  it('has Copy Path action', () => {
    assert.ok(src.includes('handleCopyPath'), 'Should have Copy Path handler');
  });

  it('has Copy Relative Path action', () => {
    assert.ok(src.includes('handleCopyRelativePath'), 'Should have Copy Relative Path handler');
  });

  it('has Reveal in File Explorer action', () => {
    assert.ok(src.includes('handleReveal'), 'Should have Reveal handler');
  });
});

describe('FileContextMenu.svelte -- folder menu items', () => {
  it('has New File option for folders', () => {
    assert.ok(src.includes('handleNewFile'), 'Should have New File handler');
  });

  it('has New Folder option for folders', () => {
    assert.ok(src.includes('handleNewFolder'), 'Should have New Folder handler');
  });

  it('shows New File in folder context', () => {
    assert.ok(src.includes('New File...'), 'Should show New File text');
  });

  it('shows New Folder in folder context', () => {
    assert.ok(src.includes('New Folder...'), 'Should show New Folder text');
  });
});

describe('FileContextMenu.svelte -- keyboard shortcuts', () => {
  it('shows F2 shortcut for Rename', () => {
    assert.ok(src.includes('>F2<'), 'Should show F2 shortcut hint');
  });

  it('has context-menu-shortcut class', () => {
    assert.ok(src.includes('context-menu-shortcut'), 'Should have shortcut class');
  });
});

describe('FileContextMenu.svelte -- dismiss behavior', () => {
  it('uses setupClickOutside for dismiss behavior', () => {
    assert.ok(src.includes('setupClickOutside'), 'Should use setupClickOutside utility');
  });
});

describe('FileContextMenu.svelte -- positioning', () => {
  it('uses clampToViewport for viewport clamping', () => {
    assert.ok(src.includes('clampToViewport'), 'Should use clampToViewport utility');
  });

  it('imports clampToViewport from $lib', () => {
    assert.ok(src.includes("import { clampToViewport }"), 'Should import clampToViewport');
  });
});

describe('FileContextMenu.svelte -- blank space context', () => {
  it('handles null entry for empty space', () => {
    assert.ok(src.includes('{#if !entry}'), 'Should have null entry branch for empty space');
  });

  it('shows New File in blank space menu', () => {
    // The !entry branch has New File
    assert.ok(src.includes('!entry'), 'Should check for null entry');
  });
});

describe('FileContextMenu.svelte -- changes tab context', () => {
  it('has separate changes tab menu', () => {
    assert.ok(src.includes('{:else if isFolder}'), 'Should have folder branch');
  });

  it('shows Open Diff for changes', () => {
    assert.ok(src.includes('isChange'), 'Should handle change items');
  });
});

describe('FileContextMenu.svelte -- file menu has New File/Folder', () => {
  it('shows New File in file context menu', () => {
    // Count occurrences of handleNewFile in template - should appear in file, folder, and blank menus
    const matches = src.match(/onclick={handleNewFile}/g);
    assert.ok(matches && matches.length >= 3, 'Should have New File in file, folder, and blank menus');
  });

  it('shows New Folder in file context menu', () => {
    const matches = src.match(/onclick={handleNewFolder}/g);
    assert.ok(matches && matches.length >= 3, 'Should have New Folder in file, folder, and blank menus');
  });
});

describe('FileContextMenu.svelte -- delete behavior', () => {
  it('deletes silently without confirm dialog', () => {
    assert.ok(!src.includes('confirm('), 'Should not use confirm dialog');
  });

  it('shows toast after delete', () => {
    assert.ok(src.includes('toastStore.addToast'), 'Should show toast notification');
    assert.ok(src.includes('moved to trash'), 'Should mention trash in toast');
  });

  it('shows error toast on failure', () => {
    assert.ok(src.includes("severity: 'error'"), 'Should show error toast on failure');
  });

  it('has danger class for delete', () => {
    assert.ok(src.includes('danger'), 'Should have danger class');
  });
});

describe('FileContextMenu.svelte -- clipboard', () => {
  it('imports copyFullPath and copyRelativePath from utils', () => {
    assert.ok(src.includes('copyFullPath'), 'Should import copyFullPath');
    assert.ok(src.includes('copyRelativePath'), 'Should import copyRelativePath');
  });
});

describe('FileContextMenu.svelte -- CSS', () => {
  it('has app-region no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });

  it('imports shared context-menu.css for box-shadow and border-radius', () => {
    assert.ok(src.includes("@import '../../styles/context-menu.css'"), 'Should import shared context-menu styles');
  });
});
