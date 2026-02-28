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

  it('has context-item class', () => {
    assert.ok(src.includes('context-item'), 'Should have context-item class');
  });

  it('has context-separator class', () => {
    assert.ok(src.includes('context-separator'), 'Should have context-separator class');
  });

  it('uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'), 'Should use fixed positioning');
  });

  it('has z-index 10002', () => {
    assert.ok(src.includes('z-index: 10002'), 'Should have z-index 10002');
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

  it('has context-shortcut class', () => {
    assert.ok(src.includes('context-shortcut'), 'Should have shortcut class');
  });
});

describe('FileContextMenu.svelte -- dismiss behavior', () => {
  it('closes on Escape', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should close on Escape');
  });

  it('listens for outside clicks', () => {
    assert.ok(src.includes('handleClickOutside'), 'Should handle outside clicks');
  });

  it('adds mousedown listener', () => {
    assert.ok(src.includes("'mousedown', handleClickOutside"), 'Should listen for mousedown');
  });

  it('adds keydown listener', () => {
    assert.ok(src.includes("'keydown', handleKeydown"), 'Should listen for keydown');
  });
});

describe('FileContextMenu.svelte -- positioning', () => {
  it('clamps to viewport width', () => {
    assert.ok(src.includes('window.innerWidth'), 'Should clamp to viewport width');
  });

  it('clamps to viewport height', () => {
    assert.ok(src.includes('window.innerHeight'), 'Should clamp to viewport height');
  });

  it('uses getBoundingClientRect for dynamic clamping', () => {
    assert.ok(src.includes('getBoundingClientRect'), 'Should measure actual menu size for clamping');
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
    assert.ok(src.includes('context-danger'), 'Should have danger class');
  });
});

describe('FileContextMenu.svelte -- clipboard', () => {
  it('uses navigator.clipboard.writeText', () => {
    assert.ok(src.includes('navigator.clipboard.writeText'), 'Should use clipboard API');
  });
});

describe('FileContextMenu.svelte -- CSS', () => {
  it('has app-region no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });

  it('has box-shadow for elevation', () => {
    assert.ok(src.includes('box-shadow'), 'Should have box-shadow');
  });

  it('has border-radius', () => {
    assert.ok(src.includes('border-radius: 6px'), 'Should have rounded corners');
  });
});
