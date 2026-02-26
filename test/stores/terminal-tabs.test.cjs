const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('terminal-tabs.svelte.js -- exports', () => {
  it('exports terminalTabsStore', () => {
    assert.ok(src.includes('export const terminalTabsStore'), 'Should export terminalTabsStore');
  });
});

describe('terminal-tabs.svelte.js -- reactive state', () => {
  it('uses $state for tabs array', () => {
    assert.ok(src.includes('$state(['), 'Should use $state for tabs');
  });

  it('uses $state for activeTabId', () => {
    assert.ok(src.includes("let activeTabId = $state("), 'Should use $state for activeTabId');
  });

  it('has AI tab as default with id ai', () => {
    assert.ok(src.includes("id: 'ai'"), 'Should have AI tab with id ai');
  });

  it('has AI tab with type ai', () => {
    assert.ok(src.includes("type: 'ai'"), 'Should have AI tab with type ai');
  });
});

describe('terminal-tabs.svelte.js -- getters', () => {
  it('has tabs getter', () => {
    assert.ok(src.includes('get tabs()'), 'Should have tabs getter');
  });

  it('has activeTabId getter', () => {
    assert.ok(src.includes('get activeTabId()'), 'Should have activeTabId getter');
  });

  it('has activeTab getter', () => {
    assert.ok(src.includes('get activeTab()'), 'Should have activeTab getter');
  });
});

describe('terminal-tabs.svelte.js -- methods', () => {
  it('has setActive method', () => {
    assert.ok(src.includes('setActive('), 'Should have setActive method');
  });

  it('has addTerminalTab method', () => {
    assert.ok(src.includes('addTerminalTab('), 'Should have addTerminalTab method');
  });

  it('has closeTab method', () => {
    assert.ok(src.includes('closeTab('), 'Should have closeTab method');
  });

  it('has markExited method', () => {
    assert.ok(src.includes('markExited('), 'Should have markExited method');
  });

  it('has renameTab method', () => {
    assert.ok(src.includes('renameTab('), 'Should have renameTab method');
  });

  it('has nextTab method for cycling', () => {
    assert.ok(src.includes('nextTab()'), 'Should have nextTab method');
  });

  it('has prevTab method for cycling', () => {
    assert.ok(src.includes('prevTab()'), 'Should have prevTab method');
  });

  it('has moveTab method for reordering', () => {
    assert.ok(src.includes('moveTab('), 'Should have moveTab method');
  });
});

describe('terminal-tabs.svelte.js -- tab cycling', () => {
  it('nextTab wraps around with modulo', () => {
    assert.ok(src.includes('% groups.length'), 'nextTab should wrap around through groups');
  });

  it('prevTab wraps to last group', () => {
    assert.ok(src.includes('groups.length - 1'), 'prevTab should wrap to end');
  });
});

describe('terminal-tabs.svelte.js -- smart numbering', () => {
  it('has nextTerminalNumber function', () => {
    assert.ok(src.includes('nextTerminalNumber'), 'Should have nextTerminalNumber');
  });

  it('fills gaps in terminal numbering', () => {
    assert.ok(src.includes("match(/^Terminal (\\d+)$/)"), 'Should parse existing terminal numbers');
  });

  it('uses Set for existing numbers', () => {
    assert.ok(src.includes('new Set('), 'Should use Set for gap detection');
  });
});

describe('terminal-tabs.svelte.js -- tab reordering', () => {
  it('prevents moving AI tab', () => {
    assert.ok(src.includes("if (id === 'ai') return"), 'moveTab should prevent moving AI tab');
  });

  it('prevents moving before AI tab', () => {
    assert.ok(src.includes('toIndex <= 0'), 'Should prevent moving before AI tab');
  });

  it('uses splice for reordering', () => {
    assert.ok(src.includes('tabs.splice(fromIndex, 1)'), 'Should splice to reorder');
  });
});

describe('terminal-tabs.svelte.js -- dev-server tabs', () => {
  it('has addDevServerTab method', () => {
    assert.ok(src.includes('addDevServerTab('), 'Should have addDevServerTab method');
  });

  it('has getDevServerTab method', () => {
    assert.ok(src.includes('getDevServerTab('), 'Should have getDevServerTab method');
  });

  it('addDevServerTab creates tab with type dev-server', () => {
    assert.ok(src.includes("type: 'dev-server'"), 'Should create tab with type dev-server');
  });

  it('addDevServerTab includes projectPath', () => {
    const block = src.split('addDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(block.includes('projectPath'), 'dev-server tab should include projectPath');
  });

  it('addDevServerTab includes framework field', () => {
    const block = src.split('addDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(block.includes('framework'), 'dev-server tab should include framework');
  });

  it('addDevServerTab includes port field', () => {
    const block = src.split('addDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(block.includes('port'), 'dev-server tab should include port');
  });

  it('addDevServerTab sets running to true', () => {
    const block = src.split('addDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(block.includes('running: true'), 'dev-server tab should start as running');
  });

  it('addDevServerTab sets activeTabId', () => {
    const block = src.split('addDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(block.includes('activeTabId = shellId'), 'addDevServerTab should switch to new tab');
  });

  it('getDevServerTab filters by type and projectPath', () => {
    const block = src.split('getDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(
      block.includes("t.type === 'dev-server'") && block.includes('t.projectPath === projectPath'),
      'getDevServerTab should filter by type and projectPath'
    );
  });

  it('getDevServerTab returns null when not found', () => {
    const block = src.split('getDevServerTab')[1]?.split('},')[0] || '';
    assert.ok(block.includes('|| null'), 'getDevServerTab should return null when not found');
  });
});

describe('terminal-tabs.svelte.js -- behavior', () => {
  it('prevents closing AI tab', () => {
    assert.ok(src.includes("if (id === 'ai') return"), 'Should prevent closing AI tab');
  });

  it('imports terminalSpawn from api', () => {
    assert.ok(src.includes('terminalSpawn'), 'Should import terminalSpawn');
  });

  it('imports terminalKill from api', () => {
    assert.ok(src.includes('terminalKill'), 'Should import terminalKill');
  });

  it('calls terminalSpawn in addTerminalTab', () => {
    assert.ok(src.includes('await terminalSpawn('), 'Should call terminalSpawn');
  });

  it('calls terminalKill in closeTab', () => {
    assert.ok(src.includes('await terminalKill('), 'Should call terminalKill');
  });
});

describe('terminal-tabs.svelte.js -- hiddenTabs state', () => {
  it('uses $state for hiddenTabs', () => {
    assert.ok(src.includes('let hiddenTabs = $state([])'), 'Should use $state for hiddenTabs');
  });

  it('has hiddenTabs getter', () => {
    assert.ok(src.includes('get hiddenTabs()'), 'Should have hiddenTabs getter');
  });
});

describe('terminal-tabs.svelte.js -- hideTab method', () => {
  it('has hideTab method', () => {
    assert.ok(src.includes('hideTab('), 'Should have hideTab method');
  });

  it('prevents hiding AI tab', () => {
    const block = src.split('hideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes("id === 'ai'"), 'hideTab should prevent hiding AI tab');
  });

  it('removes tab from visible tabs via splice', () => {
    const block = src.split('hideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('tabs.splice('), 'hideTab should splice from tabs');
  });

  it('pushes to hiddenTabs', () => {
    const block = src.split('hideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('hiddenTabs.push('), 'hideTab should push to hiddenTabs');
  });

  it('switches active tab to neighbor', () => {
    const block = src.split('hideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('activeTabId ==='), 'hideTab should switch active tab');
  });
});

describe('terminal-tabs.svelte.js -- unhideTab method', () => {
  it('has unhideTab method', () => {
    assert.ok(src.includes('unhideTab('), 'Should have unhideTab method');
  });

  it('removes from hiddenTabs via splice', () => {
    const block = src.split('unhideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('hiddenTabs.splice('), 'unhideTab should splice from hiddenTabs');
  });

  it('pushes back to visible tabs', () => {
    const block = src.split('unhideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('tabs.push('), 'unhideTab should push back to tabs');
  });

  it('makes unhidden tab active', () => {
    const block = src.split('unhideTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('activeTabId = tab.id'), 'unhideTab should set activeTabId');
  });
});

describe('terminal-tabs.svelte.js -- getDevServerTabByShellId method', () => {
  it('has getDevServerTabByShellId method', () => {
    assert.ok(src.includes('getDevServerTabByShellId('), 'Should have getDevServerTabByShellId method');
  });

  it('searches visible tabs by shellId and type', () => {
    const block = src.split('getDevServerTabByShellId(')[1]?.split('\n    },')[0] || '';
    assert.ok(
      block.includes("t.type === 'dev-server'") && block.includes('t.shellId === shellId'),
      'Should search visible tabs by type and shellId'
    );
  });

  it('searches hidden tabs as fallback', () => {
    const block = src.split('getDevServerTabByShellId(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('hiddenTabs.find('), 'Should search hiddenTabs as fallback');
  });

  it('returns null when not found', () => {
    const block = src.split('getDevServerTabByShellId(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('|| null'), 'Should return null when not found');
  });
});
