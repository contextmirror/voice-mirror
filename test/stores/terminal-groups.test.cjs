const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('terminal-tabs.svelte.js -- group model state', () => {
  it('has groups state', () => {
    assert.ok(src.includes('let groups') && src.includes('$state'), 'Should have groups state');
  });
  it('has instances state', () => {
    assert.ok(src.includes('let instances') && src.includes('$state'), 'Should have instances state');
  });
  it('has activeGroupId state', () => {
    assert.ok(src.includes('activeGroupId') && src.includes('$state'), 'Should have activeGroupId');
  });
  it('has activeInstanceId state', () => {
    assert.ok(src.includes('activeInstanceId') && src.includes('$state'), 'Should have activeInstanceId');
  });
});

describe('terminal-tabs.svelte.js -- group getters', () => {
  it('has groups getter', () => {
    assert.ok(src.includes('get groups()'), 'Should have groups getter');
  });
  it('has activeGroup getter', () => {
    assert.ok(src.includes('get activeGroup()'), 'Should have activeGroup getter');
  });
  it('has activeInstance getter', () => {
    assert.ok(src.includes('get activeInstance()'), 'Should have activeInstance getter');
  });
  it('has activeGroupId getter', () => {
    assert.ok(src.includes('get activeGroupId()'), 'Should have activeGroupId getter');
  });
  it('has activeInstanceId getter', () => {
    assert.ok(src.includes('get activeInstanceId()'), 'Should have activeInstanceId getter');
  });
});

describe('terminal-tabs.svelte.js -- group methods', () => {
  it('has addGroup method', () => {
    assert.ok(src.includes('addGroup(') || src.includes('async addGroup('), 'Should have addGroup');
  });
  it('has splitInstance method', () => {
    assert.ok(src.includes('splitInstance(') || src.includes('async splitInstance('), 'Should have splitInstance');
  });
  it('has killInstance method', () => {
    assert.ok(src.includes('killInstance(') || src.includes('async killInstance('), 'Should have killInstance');
  });
  it('has unsplitGroup method', () => {
    assert.ok(src.includes('unsplitGroup('), 'Should have unsplitGroup');
  });
  it('has setActiveGroup method', () => {
    assert.ok(src.includes('setActiveGroup('), 'Should have setActiveGroup');
  });
  it('has focusInstance method', () => {
    assert.ok(src.includes('focusInstance('), 'Should have focusInstance');
  });
  it('has focusPreviousPane method', () => {
    assert.ok(src.includes('focusPreviousPane'), 'Should have focusPreviousPane');
  });
  it('has focusNextPane method', () => {
    assert.ok(src.includes('focusNextPane'), 'Should have focusNextPane');
  });
  it('has getInstance method', () => {
    assert.ok(src.includes('getInstance('), 'Should have getInstance');
  });
  it('has getInstancesForGroup method', () => {
    assert.ok(src.includes('getInstancesForGroup('), 'Should have getInstancesForGroup');
  });
});

describe('terminal-tabs.svelte.js -- instance customization', () => {
  it('has renameInstance method', () => {
    assert.ok(src.includes('renameInstance('), 'Should have renameInstance');
  });
  it('has setInstanceColor method', () => {
    assert.ok(src.includes('setInstanceColor('), 'Should have setInstanceColor');
  });
  it('has setInstanceIcon method', () => {
    assert.ok(src.includes('setInstanceIcon('), 'Should have setInstanceIcon');
  });
});

describe('terminal-tabs.svelte.js -- instance data fields', () => {
  it('instances have groupId field', () => {
    assert.ok(src.includes('groupId'), 'Should have groupId');
  });
  it('instances have profileId field', () => {
    assert.ok(src.includes('profileId'), 'Should have profileId');
  });
  it('instances have color field in instance creation', () => {
    assert.ok(src.includes("color:") || src.includes("color :"), 'Should have color field');
  });
  it('instances have icon field in instance creation', () => {
    assert.ok(src.includes("icon:") || src.includes("icon :"), 'Should have icon field');
  });
});

describe('terminal-tabs.svelte.js -- backward compatibility', () => {
  it('still has addTerminalTab method', () => {
    assert.ok(src.includes('addTerminalTab('), 'Should keep addTerminalTab for compat');
  });
  it('still has closeTab method', () => {
    assert.ok(src.includes('closeTab('), 'Should keep closeTab for compat');
  });
  it('still has markExited method', () => {
    assert.ok(src.includes('markExited('), 'Should keep markExited');
  });
  it('still has addDevServerTab method', () => {
    assert.ok(src.includes('addDevServerTab('), 'Should keep addDevServerTab');
  });
  it('still has hideTab method', () => {
    assert.ok(src.includes('hideTab('), 'Should keep hideTab');
  });
  it('still has unhideTab method', () => {
    assert.ok(src.includes('unhideTab('), 'Should keep unhideTab');
  });
});

describe('terminal-tabs.svelte.js -- group ID generation', () => {
  it('has generateGroupId function', () => {
    assert.ok(src.includes('generateGroupId'), 'Should have generateGroupId');
  });
  it('uses group- prefix for IDs', () => {
    assert.ok(src.includes("'group-'") || src.includes('`group-'), 'Should use group- prefix');
  });
  it('has nextGroupNum counter', () => {
    assert.ok(src.includes('nextGroupNum'), 'Should have nextGroupNum counter');
  });
});

describe('terminal-tabs.svelte.js -- addGroup spawns PTY', () => {
  it('addGroup calls terminalSpawn', () => {
    const block = src.split('async addGroup(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('terminalSpawn'), 'addGroup should call terminalSpawn');
  });
  it('addGroup creates group and instance', () => {
    const block = src.split('async addGroup(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('generateGroupId'), 'addGroup should create a group');
    assert.ok(block.includes('instances'), 'addGroup should create an instance');
  });
  it('addGroup sets activeGroupId and activeInstanceId', () => {
    const block = src.split('async addGroup(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('activeGroupId'), 'addGroup should set activeGroupId');
    assert.ok(block.includes('activeInstanceId'), 'addGroup should set activeInstanceId');
  });
});

describe('terminal-tabs.svelte.js -- splitInstance behavior', () => {
  it('splitInstance calls terminalSpawn', () => {
    const block = src.split('async splitInstance(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('terminalSpawn'), 'splitInstance should call terminalSpawn');
  });
  it('splitInstance adds to active group instanceIds', () => {
    const block = src.split('async splitInstance(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('instanceIds'), 'splitInstance should add to group instanceIds');
  });
});

describe('terminal-tabs.svelte.js -- killInstance cleanup', () => {
  it('killInstance calls terminalKill', () => {
    const block = src.split('async killInstance(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('terminalKill'), 'killInstance should call terminalKill');
  });
  it('killInstance removes empty groups', () => {
    const block = src.split('async killInstance(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('filter'), 'killInstance should filter out empty groups');
  });
  it('killInstance removes instance from instances map', () => {
    const block = src.split('async killInstance(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('instances'), 'killInstance should clean up instances');
  });
});

describe('terminal-tabs.svelte.js -- pane focus wrapping', () => {
  it('focusPreviousPane wraps to end', () => {
    const block = src.split('focusPreviousPane')[1]?.split('\n    },')[0] || '';
    assert.ok(
      block.includes('length - 1') || block.includes('.length -'),
      'focusPreviousPane should wrap to last instance'
    );
  });
  it('focusNextPane wraps with modulo', () => {
    const block = src.split('focusNextPane')[1]?.split('\n    },')[0] || '';
    assert.ok(
      block.includes('%') || block.includes('% group'),
      'focusNextPane should wrap with modulo'
    );
  });
});

describe('terminal-tabs.svelte.js -- legacy sync', () => {
  it('has syncLegacyTabs helper', () => {
    assert.ok(src.includes('syncLegacyTabs'), 'Should have syncLegacyTabs for backward compat');
  });
  it('addDevServerTab creates both instance and legacy tab', () => {
    const block = src.split('addDevServerTab(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('instances'), 'addDevServerTab should create instance');
    assert.ok(block.includes('tabs.push'), 'addDevServerTab should create legacy tab');
  });
  it('markExited updates both instance and legacy tab', () => {
    const block = src.split('markExited(')[1]?.split('\n    },')[0] || '';
    assert.ok(block.includes('instances'), 'markExited should update instance');
    assert.ok(block.includes('tabs.find'), 'markExited should update legacy tab');
  });
});
