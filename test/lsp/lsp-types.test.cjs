const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);
const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('types.rs: server state enum', () => {
  it('defines ServerState enum with all lifecycle states', () => {
    assert.ok(typesSrc.includes('enum ServerState'), 'Missing ServerState enum');
    for (const state of ['Stopped', 'Starting', 'Running', 'Restarting', 'Stopping', 'Failed']) {
      assert.ok(typesSrc.includes(state), `Missing state: ${state}`);
    }
  });

  it('derives Serialize and Clone for ServerState', () => {
    assert.ok(typesSrc.includes('Serialize') && typesSrc.includes('Clone'),
      'ServerState should derive Serialize and Clone');
  });

  it('derives Deserialize and PartialEq for ServerState', () => {
    assert.ok(typesSrc.includes('Deserialize') && typesSrc.includes('PartialEq'),
      'ServerState should derive Deserialize and PartialEq');
  });

  it('uses camelCase serde rename', () => {
    // Find the ServerState section and check it has rename_all
    const enumIdx = typesSrc.indexOf('enum ServerState');
    const preceding = typesSrc.substring(Math.max(0, enumIdx - 150), enumIdx);
    assert.ok(preceding.includes('rename_all = "camelCase"'),
      'ServerState should use serde camelCase rename');
  });
});

describe('types.rs: extended LspServerStatus', () => {
  it('has state field of type ServerState', () => {
    assert.ok(typesSrc.includes('state: ServerState'), 'LspServerStatus should have state: ServerState');
  });

  it('has crash_count field', () => {
    assert.ok(typesSrc.includes('crash_count'), 'LspServerStatus should have crash_count');
  });

  it('has project_root field', () => {
    assert.ok(typesSrc.includes('project_root'), 'LspServerStatus should have project_root');
  });

  it('has last_error field', () => {
    assert.ok(typesSrc.includes('last_error'), 'LspServerStatus should have last_error');
  });

  it('has pid field', () => {
    assert.ok(typesSrc.includes('pid'), 'LspServerStatus should have pid');
  });

  it('keeps running field for backward compat', () => {
    assert.ok(typesSrc.includes('running: bool'), 'LspServerStatus should keep running: bool');
  });
});

describe('mod.rs: LspServer struct updates', () => {
  it('uses ServerState enum in LspServer struct', () => {
    assert.ok(modSrc.includes('ServerState'), 'LspServer should use ServerState type');
  });

  it('has project_root field on LspServer', () => {
    assert.ok(modSrc.includes('project_root: String'), 'LspServer should store project_root');
  });

  it('has last_error field on LspServer', () => {
    assert.ok(modSrc.includes('last_error: Option<String>'), 'LspServer should store last_error');
  });

  it('has stderr_lines field', () => {
    assert.ok(modSrc.includes('stderr_lines'), 'LspServer should have stderr_lines field');
  });

  it('initializes state to Running in ensure_server', () => {
    assert.ok(modSrc.includes('state: types::ServerState::Running'),
      'ensure_server should set state to Running');
  });

  it('initializes project_root from parameter in ensure_server', () => {
    assert.ok(modSrc.includes('project_root: project_root.to_string()'),
      'ensure_server should store project_root');
  });

  it('populates all new fields in get_status', () => {
    // Find get_status function
    const statusIdx = modSrc.indexOf('fn get_status');
    assert.ok(statusIdx > 0, 'get_status function should exist');
    const statusBody = modSrc.substring(statusIdx, statusIdx + 600);
    assert.ok(statusBody.includes('state: s.state.clone()'), 'get_status should include state');
    assert.ok(statusBody.includes('crash_count: s.crash_count'), 'get_status should include crash_count');
    assert.ok(statusBody.includes('project_root: s.project_root.clone()'), 'get_status should include project_root');
    assert.ok(statusBody.includes('last_error: s.last_error.clone()'), 'get_status should include last_error');
    assert.ok(statusBody.includes('pid: s.process.id()'), 'get_status should include pid');
    assert.ok(statusBody.includes('running: s.state == types::ServerState::Running'),
      'get_status should derive running from state');
  });
});
