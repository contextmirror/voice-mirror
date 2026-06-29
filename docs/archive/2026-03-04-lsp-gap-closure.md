# LSP Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all LSP gaps between Voice Mirror and VS Code, bringing coverage from 51% to near-100%.

**Architecture:** Five waves of changes, starting with configuration alignment (Rust backend), then features (Rust command + JS API wrapper + CM extension per feature). Each wave is independently committable. All changes follow the existing patterns in `src-tauri/src/lsp/` (Rust) and `src/lib/editor-lsp.svelte.js` (frontend).

**Tech Stack:** Rust (Tauri commands, LSP client), JavaScript (Svelte 5, CodeMirror 6), source-inspection tests (node:test).

---

## Wave 1: Configuration Alignment

### Task 1: Diagnostic Severity Remapping

VS Code remaps 8 "style check" diagnostic codes from Error → Warning. We need to do the same in our diagnostic handler.

**Files:**
- Modify: `src-tauri/src/lsp/types.rs`
- Modify: `src-tauri/src/lsp/client.rs`
- Test: `test/lsp/lsp-severity-remap.test.cjs`

**Step 1: Write the failing test**

Create `test/lsp/lsp-severity-remap.test.cjs`:

```javascript
/**
 * lsp-severity-remap.test.cjs -- Source-inspection tests for diagnostic severity remapping.
 *
 * Validates that VS Code-compatible style check codes are remapped from error to warning.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);
const clientSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/client.rs'), 'utf-8'
);

describe('types.rs: style check codes', () => {
  it('defines STYLE_CHECK_CODES constant', () => {
    assert.ok(typesSrc.includes('STYLE_CHECK_CODES'), 'Should define STYLE_CHECK_CODES');
  });

  for (const code of [6133, 6138, 6192, 6196, 7027, 7028, 7029, 7030]) {
    it(`includes code ${code}`, () => {
      assert.ok(typesSrc.includes(`${code}`), `Should include style check code ${code}`);
    });
  }
});

describe('client.rs: severity remapping', () => {
  it('imports STYLE_CHECK_CODES from types', () => {
    assert.ok(clientSrc.includes('STYLE_CHECK_CODES'), 'Should reference STYLE_CHECK_CODES');
  });

  it('checks diagnostic code against style check codes', () => {
    assert.ok(
      clientSrc.includes('is_style_check') || clientSrc.includes('STYLE_CHECK_CODES'),
      'Should check if diagnostic code is a style check'
    );
  });

  it('remaps severity from error to warning for style checks', () => {
    // The handler should downgrade severity 1 (error) to "warning" for style checks
    assert.ok(
      clientSrc.includes('"warning"') && clientSrc.includes('STYLE_CHECK_CODES'),
      'Should remap error to warning for style check codes'
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/lsp/lsp-severity-remap.test.cjs`
Expected: FAIL — STYLE_CHECK_CODES not found in types.rs

**Step 3: Implement severity remapping in types.rs**

Add to `src-tauri/src/lsp/types.rs` after the existing imports:

```rust
/// VS Code-compatible "style check" diagnostic codes.
/// When these codes have severity=error, they are downgraded to warning.
/// See: VS Code `reportStyleChecksAsWarnings` (default: true)
pub const STYLE_CHECK_CODES: &[i64] = &[
    6133, // Variable declared but never used
    6138, // Property declared but never used
    6192, // All imports are unused
    6196, // Variable declared but never read
    7027, // Unreachable code
    7028, // Unused label
    7029, // Fall-through case in switch
    7030, // Not all code paths return a value
];
```

**Step 4: Implement severity remapping in client.rs**

In `src-tauri/src/lsp/client.rs`, modify `handle_diagnostics()`. After the severity mapping (`Some(1) => "error"` etc.), add the style check remap:

```rust
// After: let severity = match severity_num { ... };
// Add style check remapping (VS Code reportStyleChecksAsWarnings behavior)
let code_num = d.get("code").and_then(|v| v.as_i64());
let severity = if severity == "error" {
    if let Some(code) = code_num {
        if types::STYLE_CHECK_CODES.contains(&code) {
            "warning".to_string()
        } else {
            severity
        }
    } else {
        severity
    }
} else {
    severity
};
```

**Step 5: Run test to verify it passes**

Run: `node --test test/lsp/lsp-severity-remap.test.cjs`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/lsp/types.rs src-tauri/src/lsp/client.rs test/lsp/lsp-severity-remap.test.cjs
git commit -m "feat(lsp): add VS Code-compatible diagnostic severity remapping"
```

---

### Task 2: Enhanced publishDiagnostics Capability

Declare richer publishDiagnostics capabilities so servers can send more detailed diagnostic data.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs`
- Test: `test/lsp/lsp-capabilities.test.cjs`

**Step 1: Write the failing test**

Create `test/lsp/lsp-capabilities.test.cjs`:

```javascript
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
```

**Step 2: Run test to verify it fails**

Run: `node --test test/lsp/lsp-capabilities.test.cjs`
Expected: FAIL — relatedInformation is currently false, others not declared

**Step 3: Update capability declaration in mod.rs**

Replace the existing `publishDiagnostics` section and add all missing capability blocks. In `src-tauri/src/lsp/mod.rs`, find the capabilities JSON and replace/extend:

```json
"publishDiagnostics": {
    "relatedInformation": true,
    "versionSupport": true,
    "codeDescriptionSupport": true,
    "tagSupport": {
        "valueSet": [1, 2]
    }
},
"documentHighlight": {
    "dynamicRegistration": false
},
"typeDefinition": {
    "dynamicRegistration": false
},
"declaration": {
    "dynamicRegistration": false
},
"implementation": {
    "dynamicRegistration": false
},
"linkedEditingRange": {
    "dynamicRegistration": false
},
"onTypeFormatting": {
    "dynamicRegistration": false
},
"codeLens": {
    "dynamicRegistration": false
},
"colorProvider": {
    "dynamicRegistration": false
},
"foldingRange": {
    "dynamicRegistration": false,
    "lineFoldingOnly": true
},
"inlayHint": {
    "dynamicRegistration": false
},
"semanticTokens": {
    "dynamicRegistration": false,
    "requests": {
        "full": { "delta": true },
        "range": true
    },
    "tokenTypes": [
        "namespace", "type", "class", "enum", "interface",
        "struct", "typeParameter", "parameter", "variable",
        "property", "enumMember", "event", "function",
        "method", "macro", "keyword", "modifier",
        "comment", "string", "number", "regexp", "operator",
        "decorator"
    ],
    "tokenModifiers": [
        "declaration", "definition", "readonly", "static",
        "deprecated", "abstract", "async", "modification",
        "documentation", "defaultLibrary"
    ],
    "formats": ["relative"],
    "multilineTokenSupport": false,
    "overlappingTokenSupport": false
}
```

Also update `completion.completionItem.snippetSupport` from `false` to `true`.

And add workspace symbol capability:

```json
"workspace": {
    "workspaceFolders": true,
    "symbol": {
        "dynamicRegistration": false
    }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/lsp/lsp-capabilities.test.cjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs test/lsp/lsp-capabilities.test.cjs
git commit -m "feat(lsp): declare VS Code-compatible capabilities for all LSP features"
```

---

### Task 3: TypeScript Server Initialization Options

Add VS Code-compatible `initializationOptions` to the TypeScript manifest entry.

**Files:**
- Modify: `src-tauri/src/lsp/lsp-servers.json`
- Test: `test/lsp/lsp-ts-init-options.test.cjs`

**Step 1: Write the failing test**

Create `test/lsp/lsp-ts-init-options.test.cjs`:

```javascript
/**
 * lsp-ts-init-options.test.cjs -- Source-inspection tests for TypeScript server init options.
 *
 * Validates VS Code-compatible initialization options in the manifest.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/lsp-servers.json'), 'utf-8'
));

const tsEntry = manifest.servers.typescript;

describe('lsp-servers.json: TypeScript initializationOptions', () => {
  it('has non-empty initializationOptions', () => {
    assert.ok(tsEntry.initializationOptions && Object.keys(tsEntry.initializationOptions).length > 0,
      'TypeScript should have non-empty initializationOptions');
  });

  it('has preferences object', () => {
    assert.ok(tsEntry.initializationOptions.preferences, 'Should have preferences');
  });

  it('has includeInlayParameterNameHints preference', () => {
    assert.ok('includeInlayParameterNameHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayParameterNameHints');
  });

  it('has includeInlayVariableTypeHints preference', () => {
    assert.ok('includeInlayVariableTypeHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayVariableTypeHints');
  });

  it('has includeInlayFunctionLikeReturnTypeHints preference', () => {
    assert.ok('includeInlayFunctionLikeReturnTypeHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayFunctionLikeReturnTypeHints');
  });

  it('has includeInlayPropertyDeclarationTypeHints preference', () => {
    assert.ok('includeInlayPropertyDeclarationTypeHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayPropertyDeclarationTypeHints');
  });

  it('has includeInlayEnumMemberValueHints preference', () => {
    assert.ok('includeInlayEnumMemberValueHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayEnumMemberValueHints');
  });

  it('has hostInfo set to voice-mirror', () => {
    assert.ok(tsEntry.initializationOptions.hostInfo === 'voice-mirror',
      'hostInfo should be voice-mirror');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/lsp/lsp-ts-init-options.test.cjs`
Expected: FAIL — initializationOptions is empty `{}`

**Step 3: Update lsp-servers.json**

Replace the TypeScript entry's `initializationOptions` in `src-tauri/src/lsp/lsp-servers.json`:

```json
"initializationOptions": {
    "hostInfo": "voice-mirror",
    "preferences": {
        "includeInlayParameterNameHints": "none",
        "includeInlayVariableTypeHints": false,
        "includeInlayPropertyDeclarationTypeHints": false,
        "includeInlayFunctionLikeReturnTypeHints": false,
        "includeInlayEnumMemberValueHints": false,
        "quotePreference": "auto",
        "importModuleSpecifierPreference": "shortest"
    }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/lsp/lsp-ts-init-options.test.cjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/lsp-servers.json test/lsp/lsp-ts-init-options.test.cjs
git commit -m "feat(lsp): add VS Code-compatible TypeScript server initialization options"
```

---

## Wave 2: High-Value Features

### Task 4: Document Highlight

Highlight all occurrences of the symbol under cursor. Small effort, visible impact.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_document_highlight` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add `lsp_request_document_highlight` command)
- Modify: `src/lib/api.js` (add `lspRequestDocumentHighlight` wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add CM ViewPlugin for cursor-move highlight)
- Test: `test/lsp/lsp-document-highlight.test.cjs`
- Test: `test/api/api-lsp-highlight.test.cjs`

**Step 1: Write the failing tests**

Create `test/lsp/lsp-document-highlight.test.cjs`:

```javascript
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

describe('mod.rs: document highlight', () => {
  it('has request_document_highlight method', () => {
    assert.ok(modSrc.includes('request_document_highlight'), 'Should have request_document_highlight');
  });

  it('sends textDocument/documentHighlight request', () => {
    assert.ok(modSrc.includes('textDocument/documentHighlight'), 'Should send documentHighlight request');
  });
});

describe('commands/lsp.rs: document highlight command', () => {
  it('has lsp_request_document_highlight command', () => {
    assert.ok(cmdSrc.includes('lsp_request_document_highlight'), 'Should have command');
  });

  it('is a tauri::command', () => {
    // Find the function and verify it has the tauri::command attribute
    const idx = cmdSrc.indexOf('lsp_request_document_highlight');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});
```

Create `test/api/api-lsp-highlight.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('api.js: document highlight', () => {
  it('exports lspRequestDocumentHighlight', () => {
    assert.ok(src.includes('export async function lspRequestDocumentHighlight('),
      'Should export lspRequestDocumentHighlight');
  });

  it('invokes lsp_request_document_highlight', () => {
    assert.ok(src.includes("invoke('lsp_request_document_highlight'"),
      'Should invoke lsp_request_document_highlight');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/lsp/lsp-document-highlight.test.cjs test/api/api-lsp-highlight.test.cjs`
Expected: FAIL

**Step 3: Implement document highlight**

**In `src-tauri/src/lsp/mod.rs`**, add method (follows same pattern as `request_references`):

```rust
pub async fn request_document_highlight(
    &mut self,
    uri: &str,
    lang_id: &str,
    line: u32,
    character: u32,
    project_root: &str,
) -> Result<Value, String> {
    let key = Self::server_key(lang_id, project_root);
    let server = self.servers.get_mut(&key)
        .ok_or_else(|| format!("No server for {}", key))?;

    let params = serde_json::json!({
        "textDocument": { "uri": uri },
        "position": { "line": line, "character": character }
    });

    server.send_request("textDocument/documentHighlight", params).await
}
```

**In `src-tauri/src/commands/lsp.rs`**, add command (follows `lsp_request_references` pattern):

```rust
#[tauri::command]
pub async fn lsp_request_document_highlight(
    path: String,
    line: u32,
    character: u32,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };
    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };
    let uri = types::file_uri(&path, &project_root);
    let mut manager = state.0.lock().await;
    match manager.request_document_highlight(&uri, &lang_id, line, character, &project_root).await {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}
```

Register in `src-tauri/src/lib.rs` command list.

**In `src/lib/api.js`**, add wrapper:

```javascript
export async function lspRequestDocumentHighlight(path, line, character, projectRoot) {
  return invoke('lsp_request_document_highlight', { path, line, character, projectRoot });
}
```

**In `src/lib/editor-lsp.svelte.js`**, add a ViewPlugin that fires on cursor position change (debounced 150ms), calls `lspRequestDocumentHighlight`, and applies `Decoration.mark` with class `cm-lsp-highlight` for each result. Clear highlights on cursor move before requesting new ones.

**Step 4: Run tests to verify they pass**

Run: `node --test test/lsp/lsp-document-highlight.test.cjs test/api/api-lsp-highlight.test.cjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/commands/lsp.rs src-tauri/src/lib.rs \
  src/lib/api.js src/lib/editor-lsp.svelte.js \
  test/lsp/lsp-document-highlight.test.cjs test/api/api-lsp-highlight.test.cjs
git commit -m "feat(lsp): add document highlight (symbol occurrence highlighting)"
```

---

### Task 5: Inlay Hints

Inline type annotations in the editor. Requires capability (Task 2), init options (Task 3), Rust request, API wrapper, and CM widget.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_inlay_hints` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add `lsp_request_inlay_hints` command)
- Modify: `src/lib/api.js` (add `lspRequestInlayHints` wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add CM ViewPlugin for inlay hint rendering)
- Test: `test/lsp/lsp-inlay-hints.test.cjs`

**Step 1: Write the failing test**

Create `test/lsp/lsp-inlay-hints.test.cjs`:

```javascript
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
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);
const editorLspSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8'
);

describe('mod.rs: inlay hints', () => {
  it('has request_inlay_hints method', () => {
    assert.ok(modSrc.includes('request_inlay_hints'), 'Should have request_inlay_hints');
  });

  it('sends textDocument/inlayHint request', () => {
    assert.ok(modSrc.includes('textDocument/inlayHint'), 'Should send inlayHint request');
  });
});

describe('commands/lsp.rs: inlay hints command', () => {
  it('has lsp_request_inlay_hints command', () => {
    assert.ok(cmdSrc.includes('lsp_request_inlay_hints'), 'Should have command');
  });
});

describe('api.js: inlay hints', () => {
  it('exports lspRequestInlayHints', () => {
    assert.ok(apiSrc.includes('export async function lspRequestInlayHints('),
      'Should export lspRequestInlayHints');
  });

  it('invokes lsp_request_inlay_hints', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_inlay_hints'"),
      'Should invoke correct command');
  });
});

describe('editor-lsp.svelte.js: inlay hints', () => {
  it('imports lspRequestInlayHints', () => {
    assert.ok(editorLspSrc.includes('lspRequestInlayHints'),
      'Should import lspRequestInlayHints');
  });

  it('has inlay hint widget or decoration', () => {
    assert.ok(
      editorLspSrc.includes('inlay-hint') || editorLspSrc.includes('InlayHint') || editorLspSrc.includes('inlayHint'),
      'Should have inlay hint rendering'
    );
  });

  it('has inlayHintExtension or similar factory', () => {
    assert.ok(
      editorLspSrc.includes('inlayHint'),
      'Should have inlay hint extension factory'
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/lsp/lsp-inlay-hints.test.cjs`
Expected: FAIL

**Step 3: Implement inlay hints**

**Rust backend** (`mod.rs`): Add `request_inlay_hints` method that sends `textDocument/inlayHint` with a range parameter (start line 0, end line = document line count or viewport range).

```rust
pub async fn request_inlay_hints(
    &mut self,
    uri: &str,
    lang_id: &str,
    start_line: u32,
    end_line: u32,
    project_root: &str,
) -> Result<Value, String> {
    let key = Self::server_key(lang_id, project_root);
    let server = self.servers.get_mut(&key)
        .ok_or_else(|| format!("No server for {}", key))?;

    let params = serde_json::json!({
        "textDocument": { "uri": uri },
        "range": {
            "start": { "line": start_line, "character": 0 },
            "end": { "line": end_line, "character": 0 }
        }
    });

    server.send_request("textDocument/inlayHint", params).await
}
```

**Tauri command** (`commands/lsp.rs`):

```rust
#[tauri::command]
pub async fn lsp_request_inlay_hints(
    path: String,
    start_line: u32,
    end_line: u32,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };
    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };
    let uri = types::file_uri(&path, &project_root);
    let mut manager = state.0.lock().await;
    match manager.request_inlay_hints(&uri, &lang_id, start_line, end_line, &project_root).await {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}
```

**API wrapper** (`api.js`):

```javascript
export async function lspRequestInlayHints(path, startLine, endLine, projectRoot) {
  return invoke('lsp_request_inlay_hints', { path, startLine, endLine, projectRoot });
}
```

**CM extension** (`editor-lsp.svelte.js`): Create a `ViewPlugin` that:
1. On document change or viewport scroll (debounced 500ms), requests inlay hints for visible range
2. Renders each hint as a `Decoration.widget` with class `cm-inlay-hint`
3. InlayHint kinds: 1 = Type (shown as `: Type`), 2 = Parameter (shown as `param:`)
4. Hints are inline widgets positioned at the hint's `position` offset

**Step 4: Run tests to verify they pass**

Run: `node --test test/lsp/lsp-inlay-hints.test.cjs`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All pass

**Step 6: Commit**

```bash
git add src-tauri/src/lsp/mod.rs src-tauri/src/commands/lsp.rs src-tauri/src/lib.rs \
  src/lib/api.js src/lib/editor-lsp.svelte.js \
  test/lsp/lsp-inlay-hints.test.cjs
git commit -m "feat(lsp): add inlay hints (inline type annotations)"
```

---

### Task 6: Workspace Symbols

Cross-project symbol search. Integrates with Command Palette `@` mode or a new `#` mode.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_workspace_symbols` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add `lsp_request_workspace_symbols` command)
- Modify: `src/lib/api.js` (add `lspRequestWorkspaceSymbols` wrapper)
- Modify: `src/components/lens/CommandPalette.svelte` (add `#` workspace symbol mode)
- Test: `test/lsp/lsp-workspace-symbols.test.cjs`

**Step 1: Write the failing test**

Create `test/lsp/lsp-workspace-symbols.test.cjs`:

```javascript
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
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);

describe('mod.rs: workspace symbols', () => {
  it('has request_workspace_symbols method', () => {
    assert.ok(modSrc.includes('request_workspace_symbols'), 'Should have request_workspace_symbols');
  });

  it('sends workspace/symbol request', () => {
    assert.ok(modSrc.includes('workspace/symbol'), 'Should send workspace/symbol request');
  });
});

describe('commands/lsp.rs: workspace symbols command', () => {
  it('has lsp_request_workspace_symbols command', () => {
    assert.ok(cmdSrc.includes('lsp_request_workspace_symbols'), 'Should have command');
  });
});

describe('api.js: workspace symbols', () => {
  it('exports lspRequestWorkspaceSymbols', () => {
    assert.ok(apiSrc.includes('export async function lspRequestWorkspaceSymbols('),
      'Should export lspRequestWorkspaceSymbols');
  });
});
```

**Step 2: Run test, verify fail, implement, verify pass**

Follow the same pattern as Task 4. The Rust method sends `workspace/symbol` with `{ "query": query }`. The command palette gets a new `#` prefix mode that calls the API and shows results with symbol kind badges.

**Step 3: Commit**

```bash
git commit -m "feat(lsp): add workspace symbols (cross-project symbol search)"
```

---

### Task 7: Range Formatting

Wire the existing backend to a frontend keybinding.

**Files:**
- Modify: `src/lib/editor-lsp.svelte.js` (add `formatSelection` method)
- Test: `test/lib/editor-lsp-range-format.test.cjs`

**Step 1: Write the failing test**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8'
);

describe('editor-lsp.svelte.js: range formatting', () => {
  it('has formatSelection method', () => {
    assert.ok(src.includes('formatSelection'), 'Should have formatSelection');
  });

  it('imports lspRequestRangeFormatting', () => {
    assert.ok(src.includes('lspRequestRangeFormatting'), 'Should import range formatting API');
  });
});
```

**Step 2: Implement**

Add `formatSelection()` to `editor-lsp.svelte.js` that gets the current selection range, calls `lspRequestRangeFormatting`, and applies the returned edits. Bind to Ctrl+K Ctrl+F.

**Step 3: Commit**

```bash
git commit -m "feat(lsp): wire range formatting to Ctrl+K Ctrl+F"
```

---

## Wave 3: Navigation Extras

### Task 8: Type Definition

**Files:** Same pattern as go-to-definition. Modify `mod.rs`, `commands/lsp.rs`, `api.js`, `editor-lsp.svelte.js`.

**Rust method:** `request_type_definition` sends `textDocument/typeDefinition` with position params.

**Command:** `lsp_request_type_definition` — same pattern as `lsp_request_definition`.

**API:** `lspRequestTypeDefinition(path, line, character, projectRoot)`

**Frontend:** Add `handleGoToTypeDefinition()` in editor-lsp. Context menu item "Go to Type Definition". No default shortcut (VS Code doesn't have one either — it's context menu only).

**Test:** `test/lsp/lsp-type-definition.test.cjs` — source inspection for method, command, API wrapper.

**Commit:** `feat(lsp): add go-to-type-definition`

---

### Task 9: Go-to-Declaration

Same pattern as Task 8. Method: `request_declaration`, LSP method: `textDocument/declaration`, command: `lsp_request_declaration`, API: `lspRequestDeclaration`. Context menu item "Go to Declaration".

**Commit:** `feat(lsp): add go-to-declaration`

---

### Task 10: Go-to-Implementation

Same pattern as Task 8. Method: `request_implementation`, LSP method: `textDocument/implementation`, command: `lsp_request_implementation`, API: `lspRequestImplementation`. Context menu item "Go to Implementation".

**Commit:** `feat(lsp): add go-to-implementation`

---

### Task 11: Linked Editing (HTML Tag Pairs)

Edit matching HTML open/close tags simultaneously.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_linked_editing_range` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add CM extension that requests linked ranges on cursor move inside HTML tags, creates synchronized editing mirrors)
- Test: `test/lsp/lsp-linked-editing.test.cjs`

**Rust method:** `request_linked_editing_range` sends `textDocument/linkedEditingRange` with position.

**Frontend:** On cursor position change inside `<tag>`, request linked ranges. If the response has `ranges`, use CodeMirror's `EditorView.updateListener` to sync edits between the open and close tag positions. This is the most complex part — CodeMirror doesn't have built-in linked editing, so we need to intercept transactions and mirror changes.

**Commit:** `feat(lsp): add linked editing for HTML tag pairs`

---

### Task 12: On-Type Formatting

Auto-format when typing trigger characters like `}`, `;`, `\n`.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_on_type_formatting` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add CM ViewPlugin that triggers on `;`, `}`, `\n`)
- Test: `test/lsp/lsp-on-type-formatting.test.cjs`

**Rust method:** `request_on_type_formatting` sends `textDocument/onTypeFormatting` with position + trigger character + formatting options.

**Frontend:** Listen for keypress of trigger characters. On trigger, send request, apply returned text edits. Debounce to avoid double-formatting.

**Commit:** `feat(lsp): add on-type formatting`

---

## Wave 4: Polish & Visual

### Task 13: Code Lens

Inline annotations above functions (e.g., "3 references", "Run test").

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_code_lens` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add CM line decoration widget for code lens items)
- Test: `test/lsp/lsp-code-lens.test.cjs`

**Implementation:** Request code lenses on file open and after edits (debounced 1s). Each lens has a `range` (line to display above) and a `command` (action to execute). Render as line decorations with class `cm-code-lens`. Click handler executes the lens command.

**Commit:** `feat(lsp): add code lens (inline annotations)`

---

### Task 14: Semantic Tokens

Token-based highlighting that augments syntax highlighting.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_semantic_tokens_full` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-extensions.js` (add semantic token decoration layer)
- Test: `test/lsp/lsp-semantic-tokens.test.cjs`

**Implementation:** Request semantic tokens on file open and after edits (debounced 500ms). Decode the token data array (relative encoding: deltaLine, deltaStartChar, length, tokenType, tokenModifiers). Map token types to CSS classes (e.g., `cm-semantic-variable`, `cm-semantic-function`). Apply as `Decoration.mark` overlay that augments (not replaces) syntax highlighting.

**Note:** This is the highest-effort item. Delta encoding requires careful decoding. Consider implementing `textDocument/semanticTokens/full` first, then `textDocument/semanticTokens/full/delta` for incremental updates.

**Commit:** `feat(lsp): add semantic token highlighting`

---

### Task 15: Document Colors

CSS color picker for color values.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_document_colors` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add color swatch widgets inline)
- Test: `test/lsp/lsp-document-colors.test.cjs`

**Implementation:** Request document colors on file open for CSS/SCSS files. Each color has a `range` and `color` (RGBA 0-1). Render as small inline color swatch widgets before the color value. Click to open a color picker (native `<input type="color">` positioned at the widget).

**Commit:** `feat(lsp): add document colors (CSS color picker)`

---

### Task 16: Folding Ranges

LSP-aware code folding to complement CodeMirror's syntax-based folding.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_folding_ranges` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-extensions.js` (add LSP fold service)
- Test: `test/lsp/lsp-folding-ranges.test.cjs`

**Implementation:** Request folding ranges on file open. Return ranges as CodeMirror fold service (override the default syntax-based fold when LSP ranges are available). LSP folding kinds: `comment`, `imports`, `region`.

**Commit:** `feat(lsp): add LSP-aware folding ranges`

---

## Wave 5: Deep Polish

### Task 17: Incremental Document Sync

Send only changed text instead of full file content on every edit.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (change `change_document` to support incremental)
- Modify: `src/lib/editor-lsp.svelte.js` (convert CM ChangeDesc to LSP TextDocumentContentChangeEvent ranges)
- Test: `test/lsp/lsp-incremental-sync.test.cjs`

**Implementation:** In the frontend, when a CM transaction has changes, convert each `ChangeDesc` to an LSP `TextDocumentContentChangeEvent` with `range` (start/end position) and `text` (inserted text). Send these as an array instead of the full content. Backend must declare `TextDocumentSyncKind.Incremental` (2) instead of `Full` (1) in capabilities.

**Commit:** `feat(lsp): switch to incremental document sync`

---

### Task 18: Completion Resolve + Snippets

Lazy-load completion details and support snippet expansion.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `resolve_completion_item` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (add resolve on select, snippet parsing)
- Test: `test/lsp/lsp-completion-resolve.test.cjs`

**Implementation:** On completion item select (not just insert), call `completionItem/resolve` to get full documentation/additionalTextEdits. For snippets, parse TabStop (`$1`, `$2`, `$0`) and Placeholder (`${1:default}`) syntax, create CodeMirror snippet template.

**Commit:** `feat(lsp): add completion resolve and snippet support`

---

### Task 19: Pull Diagnostics

Request diagnostics on-demand instead of waiting for server push.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_diagnostics` method)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Test: `test/lsp/lsp-pull-diagnostics.test.cjs`

**Implementation:** Send `textDocument/diagnostic` request with `textDocument` param. Handle `DocumentDiagnosticReport` response (full or unchanged). Use this as a supplement to `publishDiagnostics` — request on file open for immediate feedback instead of waiting for server to push.

**Commit:** `feat(lsp): add pull diagnostics for on-demand refresh`

---

### Task 20: Call Hierarchy

"Who calls this function?" tree view.

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add 3 methods: prepare, incoming, outgoing)
- Modify: `src-tauri/src/commands/lsp.rs` (add 3 commands)
- Modify: `src/lib/api.js` (add 3 wrappers)
- Create: `src/components/lens/CallHierarchyPanel.svelte`
- Test: `test/lsp/lsp-call-hierarchy.test.cjs`

**Implementation:** Three-step protocol:
1. `textDocument/prepareCallHierarchy` — get the call hierarchy item at cursor
2. `callHierarchy/incomingCalls` — who calls this?
3. `callHierarchy/outgoingCalls` — what does this call?

New panel component renders as expandable tree. Triggered from context menu "Show Call Hierarchy".

**Commit:** `feat(lsp): add call hierarchy (incoming/outgoing calls)`

---

### Task 21: Type Hierarchy

Class inheritance tree view.

**Files:**
- Same pattern as Task 20 but with `typeHierarchy/` methods
- Create: `src/components/lens/TypeHierarchyPanel.svelte`

**Implementation:** Three-step protocol:
1. `textDocument/prepareTypeHierarchy`
2. `typeHierarchy/supertypes`
3. `typeHierarchy/subtypes`

**Commit:** `feat(lsp): add type hierarchy (supertypes/subtypes)`

---

### Task 22: Selection Range (Smart Expand)

Expand selection semantically (word → expression → statement → block → function → file).

**Files:**
- Modify: `src-tauri/src/lsp/mod.rs` (add `request_selection_range`)
- Modify: `src-tauri/src/commands/lsp.rs` (add command)
- Modify: `src/lib/api.js` (add wrapper)
- Modify: `src/lib/editor-lsp.svelte.js` (bind to Alt+Shift+Right/Left for expand/shrink)
- Test: `test/lsp/lsp-selection-range.test.cjs`

**Implementation:** Request selection ranges at current cursor position. Response is a linked list of ranges (each parent is wider). Alt+Shift+Right expands to next parent, Alt+Shift+Left shrinks to child. Cache the range tree per cursor position.

**Commit:** `feat(lsp): add smart selection expand/shrink`

---

## Post-Implementation

After all waves are complete:

1. **Update LSP-GAP.md** — mark all items as Done, update coverage percentages
2. **Update IDE-GAPS.md** — update summary table
3. **Update LSP-DESIGN.md** — add new commands, architecture changes
4. **Run full test suite** — `npm test` (should be ~6200+ tests)
5. **Run `cargo check --tests`** — verify Rust compilation

---

## Summary

| Wave | Tasks | Items | Commits |
|------|-------|-------|---------|
| 1: Config Alignment | 1-3 | Severity remap, capabilities, init options | 3 |
| 2: High-Value Features | 4-7 | Document highlight, inlay hints, workspace symbols, range formatting | 4 |
| 3: Navigation Extras | 8-12 | Type def, declaration, implementation, linked editing, on-type format | 5 |
| 4: Polish & Visual | 13-16 | Code lens, semantic tokens, document colors, folding ranges | 4 |
| 5: Deep Polish | 17-22 | Incremental sync, completion resolve, pull diagnostics, call hierarchy, type hierarchy, selection range | 6 |
| **Total** | **22** | | **22 commits** |
