const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);

describe('mod.rs: project-scoped server keys', () => {
  it('has server_key helper function', () => {
    assert.ok(modSrc.includes('fn server_key'), 'Should have server_key function');
  });

  it('server_key combines lang_id and project_root', () => {
    assert.ok(modSrc.includes('lang_id') && modSrc.includes('project_root') && modSrc.includes('server_key'),
      'server_key should use both lang_id and project_root');
  });

  it('server_key uses :: separator', () => {
    assert.ok(modSrc.includes('{}::{}'),
      'server_key should use :: separator between lang_id and project_root');
  });

  it('ensure_server uses server_key for HashMap check', () => {
    assert.ok(modSrc.includes('server_key(lang_id, project_root)'),
      'ensure_server should use server_key for contains_key check');
  });

  it('open_document accepts project_root parameter', () => {
    // Find open_document signature
    const fnMatch = modSrc.match(/fn open_document\([^)]+\)/s);
    assert.ok(fnMatch, 'open_document function should exist');
    assert.ok(fnMatch[0].includes('project_root'), 'open_document should accept project_root');
  });

  it('close_document accepts project_root parameter', () => {
    const fnMatch = modSrc.match(/fn close_document\([^)]+\)/s);
    assert.ok(fnMatch, 'close_document function should exist');
    assert.ok(fnMatch[0].includes('project_root'), 'close_document should accept project_root');
  });

  it('change_document accepts project_root parameter', () => {
    const fnMatch = modSrc.match(/fn change_document\([^)]+\)/s);
    assert.ok(fnMatch, 'change_document function should exist');
    assert.ok(fnMatch[0].includes('project_root'), 'change_document should accept project_root');
  });

  it('save_document accepts project_root parameter', () => {
    const fnMatch = modSrc.match(/fn save_document\([^)]+\)/s);
    assert.ok(fnMatch, 'save_document function should exist');
    assert.ok(fnMatch[0].includes('project_root'), 'save_document should accept project_root');
  });

  it('request methods accept project_root', () => {
    for (const method of ['request_completion', 'request_hover', 'request_definition',
      'request_signature_help', 'request_document_symbols', 'request_references',
      'request_code_actions', 'request_prepare_rename', 'request_rename',
      'request_formatting', 'request_range_formatting']) {
      const regex = new RegExp(`fn ${method}\\([^)]+\\)`, 's');
      const fnMatch = modSrc.match(regex);
      assert.ok(fnMatch, `${method} function should exist`);
      assert.ok(fnMatch[0].includes('project_root'), `${method} should accept project_root`);
    }
  });

  it('shutdown_server accepts project_root parameter', () => {
    const fnMatch = modSrc.match(/fn shutdown_server\([^)]+\)/s);
    assert.ok(fnMatch, 'shutdown_server function should exist');
    assert.ok(fnMatch[0].includes('project_root'), 'shutdown_server should accept project_root');
  });

  it('methods use server_key for HashMap lookups', () => {
    // Count occurrences of server_key usage (should be many: contains_key, get, get_mut, insert, remove)
    const matches = modSrc.match(/server_key\(lang_id/g);
    assert.ok(matches && matches.length >= 16,
      `Should have at least 16 server_key usages, found ${matches ? matches.length : 0}`);
  });
});

describe('commands/lsp.rs: passes project_root to LspManager methods', () => {
  it('lsp_open_file passes project_root to open_document', () => {
    assert.ok(
      cmdSrc.includes('open_document') && cmdSrc.includes('&project_root'),
      'Should pass project_root to open_document'
    );
  });

  it('lsp_close_file passes project_root to close_document', () => {
    assert.ok(
      cmdSrc.includes('close_document') && cmdSrc.includes('&project_root'),
      'Should pass project_root to close_document'
    );
  });

  it('lsp_change_file passes project_root to change_document', () => {
    assert.ok(
      cmdSrc.includes('change_document') && cmdSrc.includes('&project_root'),
      'Should pass project_root to change_document'
    );
  });

  it('lsp_save_file passes project_root to save_document', () => {
    assert.ok(
      cmdSrc.includes('save_document') && cmdSrc.includes('&project_root'),
      'Should pass project_root to save_document'
    );
  });

  it('request commands pass project_root', () => {
    for (const method of ['request_completion', 'request_hover', 'request_definition',
      'request_signature_help', 'request_document_symbols', 'request_references',
      'request_code_actions', 'request_prepare_rename', 'request_rename',
      'request_formatting', 'request_range_formatting']) {
      assert.ok(
        cmdSrc.includes(method),
        `Should call ${method}`
      );
    }
    // All these calls should include &project_root
    const projectRootRefs = cmdSrc.match(/&project_root/g);
    assert.ok(projectRootRefs && projectRootRefs.length >= 15,
      `Should have at least 15 &project_root references, found ${projectRootRefs ? projectRootRefs.length : 0}`);
  });
});
