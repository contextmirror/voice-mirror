/**
 * diagnostics-export.test.cjs
 *
 * Covers the MCP-failure capture + diagnostics export feature:
 * - MCP binary persists its logs (and panics) to a file
 * - export_diagnostics command bundles all channels + the MCP server log
 * - Settings exposes a "Copy diagnostics" button
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

describe('MCP binary: persistent file logging', () => {
  const mcp = read('src-tauri/src/bin/mcp.rs');

  it('adds a FileLayer alongside the stderr layer', () => {
    assert.ok(mcp.includes('FileLayer::new'), 'Should attach a FileLayer');
    assert.ok(mcp.includes('with_writer(std::io::stderr)'), 'Should keep stderr output too');
    assert.ok(mcp.includes('tracing_subscriber::registry()'), 'Should use a layered registry');
  });

  it('installs a panic hook that persists the crash reason', () => {
    assert.ok(mcp.includes('set_hook'), 'Should set a panic hook');
    assert.ok(mcp.includes('append_log_line'), 'Panic hook should append to the log file');
    assert.ok(mcp.includes('PANIC'), 'Should label the entry as a panic');
    assert.ok(mcp.includes('default_hook'), 'Should chain to the default panic hook');
  });
});

describe('output.rs: FileLayer + helpers', () => {
  const out = read('src-tauri/src/services/output.rs');

  it('exposes a dedicated MCP server log path (not shared with mcp.jsonl)', () => {
    assert.ok(out.includes('pub fn mcp_server_log_path'), 'Should expose mcp_server_log_path');
    assert.ok(out.includes('mcp-server.jsonl'), 'Should use a distinct file from the app process');
  });

  it('provides a FileLayer and raw append/read helpers', () => {
    assert.ok(out.includes('pub struct FileLayer'), 'Should define FileLayer');
    assert.ok(out.includes('pub fn append_log_line'), 'Should expose append_log_line for the panic hook');
    assert.ok(out.includes('pub fn read_log_file'), 'Should expose read_log_file for export');
  });
});

describe('export_diagnostics command', () => {
  const cmd = read('src-tauri/src/commands/output.rs');

  it('defines the command and bundles the MCP server log', () => {
    assert.ok(cmd.includes('pub fn export_diagnostics'), 'Should define export_diagnostics');
    assert.ok(cmd.includes('mcp_server_log_path'), 'Should include the MCP server process log');
    assert.ok(cmd.includes('read_log_file'), 'Should read the MCP server log file');
  });

  it('iterates all system channels and project channels', () => {
    // Iterates Channel::ALL so every system channel (incl. App Preview) is exported.
    assert.ok(cmd.includes('Channel::ALL'), 'Should cover all system channels via Channel::ALL');
    assert.ok(cmd.includes('list_project_channels'), 'Should include project channels');
  });

  it('is registered as a Tauri command', () => {
    const lib = read('src-tauri/src/lib.rs');
    assert.ok(lib.includes('output_cmds::export_diagnostics'), 'Should register export_diagnostics');
  });
});

describe('frontend: diagnostics export', () => {
  it('api.js wraps export_diagnostics with a params object', () => {
    const api = read('src/lib/api.js');
    assert.ok(api.includes('export async function exportDiagnostics'), 'Should export exportDiagnostics');
    assert.ok(api.includes("invoke('export_diagnostics', { params:"), 'Should pass params per command convention');
  });

  it('DiagnosticsSettings copies the bundle to the clipboard', () => {
    const comp = read('src/components/settings/DiagnosticsSettings.svelte');
    assert.ok(comp.includes('exportDiagnostics('), 'Should call exportDiagnostics');
    assert.ok(comp.includes('navigator.clipboard.writeText'), 'Should copy to clipboard for pasting');
    assert.ok(comp.includes('Copy diagnostics'), 'Should label the action button');
  });

  it('SettingsPanel renders DiagnosticsSettings in the General tab', () => {
    const panel = read('src/components/settings/SettingsPanel.svelte');
    assert.ok(panel.includes("import DiagnosticsSettings from './DiagnosticsSettings.svelte'"), 'Should import it');
    assert.ok(panel.includes('<DiagnosticsSettings'), 'Should render it');
  });
});
