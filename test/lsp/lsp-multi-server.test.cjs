const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/manifest.rs'), 'utf-8'
);
const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);
const detectionSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/detection.rs'), 'utf-8'
);

describe('manifest.rs: multi-server support', () => {
  it('has find_servers_for_extension (plural) returning Vec', () => {
    assert.ok(
      manifestSrc.includes('fn find_servers_for_extension'),
      'Should have find_servers_for_extension function'
    );
    assert.ok(
      manifestSrc.includes('Vec<(String, ServerEntry)>'),
      'find_servers_for_extension should return Vec<(String, ServerEntry)>'
    );
  });

  it('keeps find_server_for_extension (singular) for primary-only routing', () => {
    assert.ok(
      manifestSrc.includes('fn find_server_for_extension'),
      'Should still have singular find_server_for_extension'
    );
  });

  it('sorts primary before supplementary in plural version', () => {
    // The sort logic should compare primary vs supplementary
    assert.ok(
      manifestSrc.includes('sort_by') && manifestSrc.includes('"primary"') && manifestSrc.includes('"supplementary"'),
      'Should sort results with primary before supplementary'
    );
  });

  it('respects exclude_extensions in plural version', () => {
    // find_servers_for_extension should skip excluded extensions
    assert.ok(
      manifestSrc.includes('exclude_extensions') && manifestSrc.includes('find_servers_for_extension'),
      'find_servers_for_extension should check exclude_extensions'
    );
  });

  it('checks enabled flag in plural version', () => {
    // find_servers_for_extension should skip disabled servers
    const fnBody = manifestSrc.substring(
      manifestSrc.indexOf('fn find_servers_for_extension'),
      manifestSrc.indexOf('fn find_servers_for_extension') + 800
    );
    assert.ok(
      fnBody.includes('entry.enabled'),
      'find_servers_for_extension should check enabled flag'
    );
  });
});

describe('detection.rs: multi-server detection', () => {
  it('has detect_all_for_extension function', () => {
    assert.ok(
      detectionSrc.includes('fn detect_all_for_extension'),
      'Should have detect_all_for_extension function'
    );
  });

  it('has language_ids_for_extension (plural) function', () => {
    assert.ok(
      detectionSrc.includes('fn language_ids_for_extension'),
      'Should have language_ids_for_extension function'
    );
  });

  it('detect_all_for_extension applies user overrides', () => {
    const fnBody = detectionSrc.substring(
      detectionSrc.indexOf('fn detect_all_for_extension'),
      detectionSrc.indexOf('fn detect_all_for_extension') + 1000
    );
    assert.ok(
      fnBody.includes('apply_overrides'),
      'detect_all_for_extension should apply user config overrides'
    );
  });
});

describe('mod.rs: multi-server lifecycle', () => {
  it('has ensure_servers_for_extension method', () => {
    assert.ok(
      modSrc.includes('fn ensure_servers_for_extension'),
      'Should have ensure_servers_for_extension method'
    );
  });

  it('ensure_servers_for_extension returns Vec<String> of started servers', () => {
    assert.ok(
      modSrc.includes('Result<Vec<String>, String>'),
      'ensure_servers_for_extension should return Result<Vec<String>, String>'
    );
  });

  it('ensure_servers_for_extension calls detect_all_for_extension', () => {
    const fnBody = modSrc.substring(
      modSrc.indexOf('fn ensure_servers_for_extension'),
      modSrc.indexOf('fn ensure_servers_for_extension') + 800
    );
    assert.ok(
      fnBody.includes('detect_all_for_extension'),
      'Should use detect_all_for_extension to find all matching servers'
    );
  });

  it('ensure_servers_for_extension logs warnings for failed starts', () => {
    const fnBody = modSrc.substring(
      modSrc.indexOf('fn ensure_servers_for_extension'),
      modSrc.indexOf('fn ensure_servers_for_extension') + 800
    );
    assert.ok(
      fnBody.includes('warn!'),
      'Should warn when a server fails to start'
    );
  });
});

describe('commands/lsp.rs: multi-server file operations', () => {
  it('lsp_open_file starts all matching servers', () => {
    assert.ok(
      cmdSrc.includes('ensure_servers_for_extension'),
      'lsp_open_file should use ensure_servers_for_extension'
    );
  });

  it('lsp_open_file sends didOpen to all started servers', () => {
    // Should loop over started server IDs and call open_document for each
    const openSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_open_file'),
      cmdSrc.indexOf('pub async fn lsp_open_file') + 1200
    );
    assert.ok(
      openSection.includes('for server_id in'),
      'lsp_open_file should loop over all started servers'
    );
    assert.ok(
      openSection.includes('open_document'),
      'lsp_open_file should call open_document for each server'
    );
  });

  it('lsp_close_file closes in all running servers', () => {
    const closeSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_close_file'),
      cmdSrc.indexOf('pub async fn lsp_close_file') + 1200
    );
    assert.ok(
      closeSection.includes('language_ids_for_extension'),
      'lsp_close_file should find all matching server IDs'
    );
    assert.ok(
      closeSection.includes('for lang_id in'),
      'lsp_close_file should loop over all matching servers'
    );
    assert.ok(
      closeSection.includes('close_document'),
      'lsp_close_file should call close_document for each server'
    );
  });

  it('lsp_change_file notifies all running servers', () => {
    const changeSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_change_file'),
      cmdSrc.indexOf('pub async fn lsp_change_file') + 1200
    );
    assert.ok(
      changeSection.includes('language_ids_for_extension'),
      'lsp_change_file should find all matching server IDs'
    );
    assert.ok(
      changeSection.includes('for lang_id in'),
      'lsp_change_file should loop over all matching servers'
    );
    assert.ok(
      changeSection.includes('change_document'),
      'lsp_change_file should call change_document for each server'
    );
  });

  it('lsp_save_file notifies all running servers', () => {
    const saveSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_save_file'),
      cmdSrc.indexOf('pub async fn lsp_save_file') + 1200
    );
    assert.ok(
      saveSection.includes('language_ids_for_extension'),
      'lsp_save_file should find all matching server IDs'
    );
    assert.ok(
      saveSection.includes('for lang_id in'),
      'lsp_save_file should loop over all matching servers'
    );
    assert.ok(
      saveSection.includes('save_document'),
      'lsp_save_file should call save_document for each server'
    );
  });

  it('request commands still route to primary server only', () => {
    // Completion, hover, definition etc. should still use language_id_for_extension (singular)
    const completionSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_request_completion'),
      cmdSrc.indexOf('pub async fn lsp_request_completion') + 500
    );
    assert.ok(
      completionSection.includes('language_id_for_extension'),
      'lsp_request_completion should use singular language_id_for_extension'
    );

    const hoverSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_request_hover'),
      cmdSrc.indexOf('pub async fn lsp_request_hover') + 500
    );
    assert.ok(
      hoverSection.includes('language_id_for_extension'),
      'lsp_request_hover should use singular language_id_for_extension'
    );

    const defSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_request_definition'),
      cmdSrc.indexOf('pub async fn lsp_request_definition') + 500
    );
    assert.ok(
      defSection.includes('language_id_for_extension'),
      'lsp_request_definition should use singular language_id_for_extension'
    );
  });

  it('close/change/save check if document is open before sending', () => {
    // All three commands should check open_docs before sending notifications
    const closeSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_close_file'),
      cmdSrc.indexOf('pub async fn lsp_close_file') + 1200
    );
    assert.ok(
      closeSection.includes('open_docs') || closeSection.includes('background_docs'),
      'lsp_close_file should check if document is tracked'
    );

    const changeSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_change_file'),
      cmdSrc.indexOf('pub async fn lsp_change_file') + 1200
    );
    assert.ok(
      changeSection.includes('open_docs'),
      'lsp_change_file should check if document is tracked'
    );

    const saveSection = cmdSrc.substring(
      cmdSrc.indexOf('pub async fn lsp_save_file'),
      cmdSrc.indexOf('pub async fn lsp_save_file') + 1200
    );
    assert.ok(
      saveSection.includes('open_docs'),
      'lsp_save_file should check if document is tracked'
    );
  });
});
