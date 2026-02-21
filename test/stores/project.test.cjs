/**
 * project.test.cjs -- Source-inspection tests for project.svelte.js
 *
 * Validates exports, reactive state, methods, getters, and imports
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/project.svelte.js'),
  'utf-8'
);

// ============ Exports ============

describe('project: exports', () => {
  it('exports projectStore', () => {
    assert.ok(src.includes('export const projectStore'), 'Should export projectStore');
  });

  it('creates store via createProjectStore factory', () => {
    assert.ok(src.includes('function createProjectStore()'), 'Should define createProjectStore factory');
  });
});

// ============ $state reactivity ============

describe('project: $state reactivity', () => {
  it('uses $state for entries', () => {
    assert.ok(/let\s+entries\s*=\s*\$state\(/.test(src), 'Should use $state for entries');
  });

  it('uses $state for activeIndex', () => {
    assert.ok(/let\s+activeIndex\s*=\s*\$state\(/.test(src), 'Should use $state for activeIndex');
  });

  it('uses $state for sessions', () => {
    assert.ok(/let\s+sessions\s*=\s*\$state\(/.test(src), 'Should use $state for sessions');
  });

  it('initializes entries as empty array', () => {
    assert.ok(src.includes('entries = $state([])'), 'entries should start as empty array');
  });

  it('initializes activeIndex to 0', () => {
    assert.ok(src.includes('activeIndex = $state(0)'), 'activeIndex should start as 0');
  });

  it('initializes sessions as empty array', () => {
    assert.ok(src.includes('sessions = $state([])'), 'sessions should start as empty array');
  });
});

// ============ Getters ============

describe('project: getters', () => {
  it('has getter "entries"', () => {
    assert.ok(src.includes('get entries()'), 'Should have getter "entries"');
  });

  it('has getter "activeIndex"', () => {
    assert.ok(src.includes('get activeIndex()'), 'Should have getter "activeIndex"');
  });

  it('has getter "sessions"', () => {
    assert.ok(src.includes('get sessions()'), 'Should have getter "sessions"');
  });

  it('has getter "activeProject"', () => {
    assert.ok(src.includes('get activeProject()'), 'Should have getter "activeProject"');
  });

  it('activeProject returns entry at activeIndex or null', () => {
    assert.ok(
      src.includes('entries[activeIndex]') && src.includes('|| null'),
      'Should return entries[activeIndex] || null'
    );
  });
});

// ============ Store methods ============

describe('project: store methods', () => {
  it('has init() method', () => {
    assert.ok(src.includes('init(config)'), 'Should have init method');
  });

  it('has addProject() method', () => {
    assert.ok(src.includes('addProject(path)'), 'Should have addProject method');
  });

  it('has removeProject() method', () => {
    assert.ok(src.includes('removeProject(index)'), 'Should have removeProject method');
  });

  it('has setActive() method', () => {
    assert.ok(src.includes('setActive(index)'), 'Should have setActive method');
  });

  it('has loadSessions() method', () => {
    assert.ok(src.includes('loadSessions()'), 'Should have loadSessions method');
  });

  it('has _persist() method', () => {
    assert.ok(src.includes('_persist()'), 'Should have _persist method');
  });
});

// ============ init behavior ============

describe('project: init behavior', () => {
  it('init reads entries from config', () => {
    assert.ok(src.includes('config.entries'), 'Should read entries from config');
  });

  it('init reads activeIndex from config', () => {
    assert.ok(src.includes('config.activeIndex'), 'Should read activeIndex from config');
  });

  it('init clamps activeIndex to entries length', () => {
    assert.ok(
      src.includes('activeIndex >= entries.length'),
      'Should clamp activeIndex if out of bounds'
    );
  });

  it('init calls loadSessions when entries exist', () => {
    assert.ok(
      src.includes('this.loadSessions()'),
      'Should load sessions for the active project'
    );
  });
});

// ============ addProject behavior ============

describe('project: addProject behavior', () => {
  it('extracts folder name from path', () => {
    assert.ok(src.includes('.split('), 'Should split path to extract folder name');
    assert.ok(src.includes('.pop()'), 'Should pop last segment as folder name');
  });

  it('assigns color from COLOR_PALETTE', () => {
    assert.ok(src.includes('COLOR_PALETTE['), 'Should pick color from palette');
  });

  it('sets activeIndex to new entry', () => {
    assert.ok(
      src.includes('activeIndex = entries.length - 1'),
      'Should switch to newly added project'
    );
  });

  it('calls _persist after adding', () => {
    assert.ok(src.includes('this._persist()'), 'Should persist after adding');
  });
});

// ============ removeProject behavior ============

describe('project: removeProject behavior', () => {
  it('validates index bounds', () => {
    assert.ok(src.includes('index < 0 || index >= entries.length'), 'Should validate index bounds');
  });

  it('filters out removed entry', () => {
    assert.ok(src.includes('entries.filter('), 'Should filter out removed entry');
  });

  it('adjusts activeIndex when needed', () => {
    assert.ok(src.includes('index < activeIndex'), 'Should adjust activeIndex when removing before current');
  });

  it('clears sessions when all projects removed', () => {
    assert.ok(src.includes("sessions = []"), 'Should clear sessions when empty');
  });
});

// ============ Imports ============

describe('project: imports', () => {
  it('imports updateConfig from config store', () => {
    assert.ok(src.includes('updateConfig'), 'Should import updateConfig');
  });

  it('imports from ./config.svelte.js', () => {
    assert.ok(
      src.includes("'./config.svelte.js'") || src.includes('"./config.svelte.js"'),
      'Should import from ./config.svelte.js'
    );
  });

  it('imports chatList from api', () => {
    assert.ok(src.includes('chatList'), 'Should import chatList');
    assert.ok(
      src.includes("'../api.js'") || src.includes('"../api.js"'),
      'Should import from ../api.js'
    );
  });
});

// ============ Color palette ============

describe('project: color palette', () => {
  it('defines COLOR_PALETTE array', () => {
    assert.ok(src.includes('const COLOR_PALETTE'), 'Should define COLOR_PALETTE');
  });

  it('has at least 8 colors', () => {
    const colorMatches = src.match(/#[0-9a-fA-F]{6}/g);
    assert.ok(colorMatches, 'Should have hex colors');
    assert.ok(colorMatches.length >= 8, `Expected at least 8 colors, found ${colorMatches.length}`);
  });

  it('has hashToIndex function for color assignment', () => {
    assert.ok(src.includes('function hashToIndex'), 'Should have hashToIndex function');
  });
});

// ============ loadSessions behavior ============

describe('project: loadSessions behavior', () => {
  it('calls chatList API', () => {
    assert.ok(src.includes('await chatList()'), 'Should call chatList() to get sessions');
  });

  it('filters sessions by project path', () => {
    assert.ok(src.includes('projectPath'), 'Should filter by projectPath');
  });

  it('handles errors gracefully', () => {
    assert.ok(src.includes('catch'), 'Should have error handling');
    assert.ok(src.includes('console.error'), 'Should log errors');
  });
});

// ============ _persist behavior ============

describe('project: _persist behavior', () => {
  it('calls updateConfig with projects data', () => {
    assert.ok(
      src.includes('updateConfig(') && src.includes('projects:'),
      'Should persist projects via updateConfig'
    );
  });

  it('persists entries and activeIndex', () => {
    assert.ok(src.includes('entries,') || src.includes('entries'), 'Should persist entries');
    assert.ok(src.includes('activeIndex'), 'Should persist activeIndex');
  });
});
