const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('LSP API wrappers', () => {
  it('exports lspOpenFile', () => {
    assert.ok(apiSrc.includes('export async function lspOpenFile'));
    assert.ok(apiSrc.includes("invoke('lsp_open_file'"));
  });
  it('exports lspCloseFile', () => {
    assert.ok(apiSrc.includes('export async function lspCloseFile'));
    assert.ok(apiSrc.includes("invoke('lsp_close_file'"));
  });
  it('exports lspChangeFile', () => {
    assert.ok(apiSrc.includes('export async function lspChangeFile'));
    assert.ok(apiSrc.includes("invoke('lsp_change_file'"));
  });
  it('exports lspSaveFile', () => {
    assert.ok(apiSrc.includes('export async function lspSaveFile'));
    assert.ok(apiSrc.includes("invoke('lsp_save_file'"));
  });
  it('exports lspRequestCompletion', () => {
    assert.ok(apiSrc.includes('export async function lspRequestCompletion'));
    assert.ok(apiSrc.includes("invoke('lsp_request_completion'"));
  });
  it('exports lspRequestHover', () => {
    assert.ok(apiSrc.includes('export async function lspRequestHover'));
    assert.ok(apiSrc.includes("invoke('lsp_request_hover'"));
  });
  it('exports lspRequestDefinition', () => {
    assert.ok(apiSrc.includes('export async function lspRequestDefinition'));
    assert.ok(apiSrc.includes("invoke('lsp_request_definition'"));
  });
  it('exports lspGetStatus', () => {
    assert.ok(apiSrc.includes('export async function lspGetStatus'));
    assert.ok(apiSrc.includes("invoke('lsp_get_status'"));
  });
  it('exports lspShutdown', () => {
    assert.ok(apiSrc.includes('export async function lspShutdown'));
    assert.ok(apiSrc.includes("invoke('lsp_shutdown'"));
  });
});
