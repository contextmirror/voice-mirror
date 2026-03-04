/**
 * lsp-capabilities.test.cjs -- Source-inspection tests for LSP capability declarations.
 *
 * Validates that our initialize request declares VS Code-compatible capabilities.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: publishDiagnostics capability', () => {
  it('declares relatedInformation: true', () => {
    assert.ok(src.includes('"relatedInformation": true'), 'Should declare relatedInformation: true');
  });

  it('declares versionSupport: true', () => {
    assert.ok(src.includes('"versionSupport": true'), 'Should declare versionSupport');
  });

  it('declares codeDescriptionSupport: true', () => {
    assert.ok(src.includes('"codeDescriptionSupport": true'), 'Should declare codeDescriptionSupport');
  });

  it('declares tagSupport with valueSet', () => {
    assert.ok(src.includes('"tagSupport"'), 'Should declare tagSupport');
    assert.ok(src.includes('"valueSet"'), 'tagSupport should have valueSet');
  });
});

describe('mod.rs: document highlight capability', () => {
  it('declares documentHighlight capability', () => {
    assert.ok(src.includes('"documentHighlight"'), 'Should declare documentHighlight capability');
  });
});

describe('mod.rs: inlay hint capability', () => {
  it('declares inlayHint capability', () => {
    assert.ok(src.includes('"inlayHint"'), 'Should declare inlayHint capability');
  });
});

describe('mod.rs: type definition capability', () => {
  it('declares typeDefinition capability', () => {
    assert.ok(src.includes('"typeDefinition"'), 'Should declare typeDefinition capability');
  });
});

describe('mod.rs: declaration capability', () => {
  it('declares declaration capability', () => {
    assert.ok(src.includes('"declaration"'), 'Should declare declaration capability');
  });
});

describe('mod.rs: implementation capability', () => {
  it('declares implementation capability', () => {
    assert.ok(src.includes('"implementation"'), 'Should declare implementation capability');
  });
});

describe('mod.rs: workspace symbol capability', () => {
  it('declares workspace/symbol capability', () => {
    assert.ok(src.includes('"symbol"'), 'Should declare workspace symbol capability');
  });
});

describe('mod.rs: linked editing range capability', () => {
  it('declares linkedEditingRange capability', () => {
    assert.ok(src.includes('"linkedEditingRange"'), 'Should declare linkedEditingRange capability');
  });
});

describe('mod.rs: on-type formatting capability', () => {
  it('declares onTypeFormatting capability', () => {
    assert.ok(src.includes('"onTypeFormatting"'), 'Should declare onTypeFormatting capability');
  });
});

describe('mod.rs: code lens capability', () => {
  it('declares codeLens capability', () => {
    assert.ok(src.includes('"codeLens"'), 'Should declare codeLens capability');
  });
});

describe('mod.rs: semantic tokens capability', () => {
  it('declares semanticTokens capability', () => {
    assert.ok(src.includes('"semanticTokens"'), 'Should declare semanticTokens capability');
  });
});

describe('mod.rs: document color capability', () => {
  it('declares colorProvider capability', () => {
    assert.ok(src.includes('"colorProvider"'), 'Should declare colorProvider capability');
  });
});

describe('mod.rs: folding range capability', () => {
  it('declares foldingRange capability', () => {
    assert.ok(src.includes('"foldingRange"'), 'Should declare foldingRange capability');
  });
});

describe('mod.rs: completion snippet support', () => {
  it('declares snippetSupport: true', () => {
    assert.ok(src.includes('"snippetSupport": true'), 'Should declare snippetSupport: true');
  });
});
