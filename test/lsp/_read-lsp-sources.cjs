// Shared helper: read all LSP Rust source files as a single concatenated string.
// After the lsp/mod.rs → submodules refactor, source-inspection tests need
// to search across all submodule files, not just mod.rs.
const fs = require('node:fs');
const path = require('node:path');

const LSP_DIR = path.join(__dirname, '../../src-tauri/src/lsp');
const LSP_FILES = [
  'mod.rs',
  'lifecycle.rs',
  'documents.rs',
  'requests.rs',
  'scanning.rs',
  'formatting.rs',
];

const modSrc = LSP_FILES
  .map(f => fs.readFileSync(path.join(LSP_DIR, f), 'utf-8'))
  .join('\n');

module.exports = { modSrc };
