# LSP Gap Analysis — Voice Mirror vs VS Code

> Source of truth for LSP feature parity with VS Code. Tracks configuration, features, and behavior differences.
> Reference repo: `E:\Projects\references\VSCode\extensions\typescript-language-features\`
>
> Last updated: 2026-03-04

---

## Current Status: 18/29 Features

Voice Mirror's LSP covers the core editing experience (diagnostics, completions, hover, go-to-definition, references, rename, code actions, formatting, signature help, document symbols). The remaining 11 gaps are Tier 2+ features — inlay hints, workspace symbols, navigation extras, visual enhancements.

**Configuration alignment** with VS Code is partial — `jsconfig.json` matches their defaults, but we're missing diagnostic severity remapping, richer capability declarations, and TypeScript server initialization options.

---

## 1. Configuration Alignment

### 1.1 jsconfig.json

| Setting | Voice Mirror | VS Code Default | Match |
|---------|-------------|-----------------|-------|
| `checkJs` | `false` | `false` | ✅ |
| `strict` | `false` | `true` | ⚠️ No practical effect (checkJs off, no .ts files) |
| `noImplicitAny` | `false` | inherited from strict | ⚠️ Same — no effect |
| `target` | `ESNext` | `ES2024` | ⚠️ Minor — ESNext = always-latest, ES2024 = pinned |
| `module` | `ESNext` | `Preserve` (TS 5.4+) / `ESNext` | ✅ Equivalent for bundled projects |
| `moduleResolution` | `bundler` | `Bundler` (TS 5.4+) | ✅ |
| `skipLibCheck` | `true` | not set (false) | ⚠️ Deliberate — faster, avoids .d.ts noise |
| `paths` | `$lib/* → ./src/lib/*` | not set | ✅ SvelteKit alias |

**Decision:** No changes needed. Differences are intentional or have no practical effect.

### 1.2 Initialization Options

VS Code sends detailed `initializationOptions` to the TypeScript language server on startup. We send only what's in `lsp-servers.json` manifest (currently bare for TypeScript).

| Option | VS Code | Voice Mirror | Gap |
|--------|---------|-------------|-----|
| `preferences.includeInlayParameterNameHints` | `"none"` (configurable) | Not sent | ❌ Needed for inlay hints |
| `preferences.includeInlayVariableTypeHints` | `false` (configurable) | Not sent | ❌ Needed for inlay hints |
| `preferences.includeInlayPropertyDeclarationTypeHints` | `false` | Not sent | ❌ |
| `preferences.includeInlayFunctionLikeReturnTypeHints` | `false` | Not sent | ❌ |
| `preferences.includeInlayEnumMemberValueHints` | `false` | Not sent | ❌ |
| `tsserver.logVerbosity` | `"off"` (configurable) | Not sent | ❌ Minor |
| `implicitProjectConfig.checkJs` | `false` (configurable) | Not sent | ❌ Relies on jsconfig.json instead |
| `implicitProjectConfig.target` | `"ES2024"` | Not sent | ❌ Relies on jsconfig.json instead |
| `locale` | system locale | Not sent | ❌ Minor |
| `hostInfo` | `"vscode"` | Not sent | ❌ Cosmetic |

**Action:** Add `initializationOptions` to the TypeScript entry in `lsp-servers.json` with VS Code-compatible defaults. Required before implementing inlay hints.

**Files:** `src-tauri/src/lsp/lsp-servers.json` (manifest), `src-tauri/src/lsp/mod.rs` (merge manifest options into initialize request)

### 1.3 publishDiagnostics Capability

Our `publishDiagnostics` capability declaration is sparse. VS Code declares richer capabilities, which tells the server it can send more detailed diagnostic data.

| Capability | VS Code | Voice Mirror | Gap |
|-----------|---------|-------------|-----|
| `relatedInformation` | `true` | `false` | ❌ Servers could send "see also" links |
| `versionSupport` | `true` | Not declared | ❌ Can't match diagnostics to document version |
| `codeDescriptionSupport` | `true` | Not declared | ❌ Missing diagnostic detail URLs |
| `tagSupport` | `{ valueSet: [1, 2] }` | Not declared | ❌ Missing "unnecessary"/"deprecated" tags |

**Action:** Enhance the `publishDiagnostics` section of our capability declaration.

**Files:** `src-tauri/src/lsp/mod.rs` (lines ~460-465, capability JSON)

### 1.4 Diagnostic Severity Remapping

VS Code remaps 8 "style check" diagnostic codes from Error → Warning. This is controlled by `reportStyleChecksAsWarnings` (default: `true`). We do no remapping — if `checkJs` were re-enabled, these would show as errors.

| Code | Description | VS Code Severity | Voice Mirror Severity |
|------|-------------|-----------------|----------------------|
| 6133 | Variable declared but never used | Warning | Error ❌ |
| 6138 | Property declared but never used | Warning | Error ❌ |
| 6192 | All imports are unused | Warning | Error ❌ |
| 6196 | Variable declared but never read | Warning | Error ❌ |
| 7027 | Unreachable code | Warning | Error ❌ |
| 7028 | Unused label | Warning | Error ❌ |
| 7029 | Fall-through case in switch | Warning | Error ❌ |
| 7030 | Not all code paths return a value | Warning | Error ❌ |

**Action:** Add severity remapping in the diagnostic handler. When a diagnostic has one of these codes AND severity=error, downgrade to warning.

**Files:** `src-tauri/src/lsp/client.rs` (diagnostic parsing in reader loop), `src-tauri/src/lsp/types.rs` (add style check code set)

---

## 2. Feature Matrix

> Every LSP method VS Code supports, compared against Voice Mirror.

### Core (Tier 0 — baseline)

| Feature | LSP Method | VS Code | Voice Mirror | Status |
|---------|-----------|---------|-------------|--------|
| Diagnostics (errors/warnings) | `publishDiagnostics` | Full | Full | **Done** |
| Completions | `textDocument/completion` | Full (resolve + snippets) | Basic (no resolve/snippets) | Gap: resolve + snippet support |
| Hover tooltips | `textDocument/hover` | Full (markdown, grace period) | Full | **Done** |
| Go-to-definition | `textDocument/definition` | Full | Full | **Done** |
| Document sync (open/change/save/close) | `didOpen/didChange/didSave/didClose` | Full (incremental sync) | Full (full sync) | Gap: incremental sync |

### Navigation (Tier 1 — shipped)

| Feature | LSP Method | VS Code | Voice Mirror | Status |
|---------|-----------|---------|-------------|--------|
| Find all references | `textDocument/references` | Full | Full | **Done** |
| Rename symbol | `prepareRename` + `rename` | Full (workspace edit) | Full (multi-file) | **Done** |
| Code actions / quick fixes | `textDocument/codeAction` | Full (resolve + filtering) | Basic (no resolve) | Gap: resolve |
| Document symbols / outline | `textDocument/documentSymbol` | Full | Full | **Done** |
| Document highlight | `textDocument/documentHighlight` | Full | None | **Gap** |

### Navigation (Tier 2 — not implemented)

| Feature | LSP Method | VS Code | Voice Mirror | Priority | Effort |
|---------|-----------|---------|-------------|----------|--------|
| Type definition | `textDocument/typeDefinition` | Full | None | Low | Small |
| Go-to-declaration | `textDocument/declaration` | Full | None | Low | Small |
| Go-to-implementation | `textDocument/implementation` | Full | None | Low | Small |
| Workspace symbols | `workspace/symbol` | Full | None | Medium | Medium |
| Call hierarchy | `callHierarchy/incomingCalls` | Full | None | Very low | Large |
| Type hierarchy | `typeHierarchy/subtypes` | Full | None | Very low | Large |

### Inline Assistance

| Feature | LSP Method | VS Code | Voice Mirror | Status |
|---------|-----------|---------|-------------|--------|
| Signature help | `textDocument/signatureHelp` | Full (auto on `(`) | Full (auto on `(` `,` + Ctrl+Shift+Space) | **Done** |
| Inlay hints | `textDocument/inlayHint` | Full (resolve on hover) | None | **Gap** — Medium priority |
| Code lens | `textDocument/codeLens` | Full (resolve + refresh) | None | Gap — Low priority |

### Formatting & Editing

| Feature | LSP Method | VS Code | Voice Mirror | Status |
|---------|-----------|---------|-------------|--------|
| Document formatting | `textDocument/formatting` | Full | Full (Shift+Alt+F + format-on-save) | **Done** |
| Range formatting | `textDocument/rangeFormatting` | Full | Backend ready, no UI | Gap — Small |
| On-type formatting | `textDocument/onTypeFormatting` | Full | None | Gap — Low |
| Linked editing | `textDocument/linkedEditingRange` | Full | None | Gap — Low |
| Selection range | `textDocument/selectionRange` | Full | None | Very low (CM has built-in) |

### Visual Enhancements

| Feature | LSP Method | VS Code | Voice Mirror | Status |
|---------|-----------|---------|-------------|--------|
| Semantic tokens | `textDocument/semanticTokens` | Full (delta encoding) | None | Gap — Low |
| Document colors | `textDocument/documentColor` | Full (color picker) | None | Gap — Low |
| Folding ranges | `textDocument/foldingRange` | Full (kind support) | None | Gap — Low (CM has syntax folding) |

### Infrastructure

| Feature | VS Code | Voice Mirror | Status |
|---------|---------|-------------|--------|
| Server registry | Built-in | Full (lsp-servers.json, 7 servers) | **Done** |
| Auto-download servers | Built-in | Full (npm + github-release) | **Done** |
| Server config (initOptions + workspace/config) | Full | Partial (manifest-driven, no runtime config) | Gap |
| Multi-server per file | Full | Full (primary + supplementary routing) | **Done** |
| Crash recovery | Full (backoff) | Full (exponential backoff, max 5, doc replay) | **Done** |
| Health monitoring | Full | Full (30s threshold, Unresponsive state) | **Done** |
| Idle shutdown | Full | Full (60s timer, auto-restart on reopen) | **Done** |
| Project-wide scanning | Full | Full (background didOpen, batched 10/100ms) | **Done** |
| Pull diagnostics | Full | None | Gap — Low |
| Remote LSP (SSH) | Full | None | Not planned |

### Summary

| Category | VS Code | Voice Mirror | Coverage |
|----------|---------|-------------|----------|
| Core (5) | 5/5 | 5/5 | 100% |
| Navigation Tier 1 (5) | 5/5 | 4/5 | 80% |
| Navigation Tier 2 (6) | 6/6 | 0/6 | 0% |
| Inline Assistance (3) | 3/3 | 1/3 | 33% |
| Formatting & Editing (5) | 5/5 | 1/5 | 20% |
| Visual (3) | 3/3 | 0/3 | 0% |
| Infrastructure (10) | 10/10 | 8/10 | 80% |
| **Total** | **37/37** | **19/37** | **51%** |

---

## 3. Behavior Differences

### 3.1 Diagnostic Request Strategy

| Aspect | VS Code | Voice Mirror | Gap |
|--------|---------|-------------|-----|
| Request method | Active: `geterr` (batch open files), `geterrForProject` | Passive: waits for `publishDiagnostics` only | ❌ Can't request on-demand |
| Debounce | 200-800ms based on file size | None (fires on every notification) | ⚠️ Minor perf |
| Visible range hints | Sends viewport ranges (TS API 5.6+) | Not implemented | ❌ Slower on large files |
| Diagnostic kinds | 4 kinds: syntax, semantic, suggestion, regionSemantic | Single flat list | ❌ Can't filter by kind |
| Style check remapping | 8 codes → warning | No remapping | ❌ See §1.4 |

### 3.2 Document Sync

| Aspect | VS Code | Voice Mirror | Gap |
|--------|---------|-------------|-----|
| Sync mode | Incremental (send only changed text + positions) | Full (send entire file on every change) | ⚠️ Overhead on large files |
| Change debounce | Frontend debounces 300ms | Frontend debounces 300ms | ✅ Match |
| didSave includes text | Configurable | Always sends text | ✅ |

### 3.3 Completion Behavior

| Aspect | VS Code | Voice Mirror | Gap |
|--------|---------|-------------|-----|
| Resolve on select | Yes (lazy-load details) | No (all details upfront) | ⚠️ Minor perf |
| Snippet support | Full (TabStop, Placeholder) | None | ❌ |
| Commit characters | Respects per-item commit chars | Not implemented | ❌ |
| Trigger characters | `.` `:` `<` `"` `/` `@` `#` `(` | CodeMirror `activateOnTyping` | ⚠️ Different mechanism |

---

## 4. Implementation Priorities

### Wave 1: Configuration Alignment (No new features, just correctness)

| # | Item | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 1 | **Severity remapping** (8 style codes → warning) | High | Small | `client.rs`, `types.rs` |
| 2 | **publishDiagnostics capability** (relatedInfo, version, codeDescription, tags) | Medium | Small | `mod.rs` |
| 3 | **TS server initializationOptions** (VS Code-compatible defaults) | Medium | Small | `lsp-servers.json` |

### Wave 2: High-Value Features

| # | Item | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 4 | **Inlay hints** | Medium | Medium | `mod.rs` (capability + request), `commands/lsp.rs` (new command), `api.js` (wrapper), `editor-lsp.svelte.js` (CM extension), `lsp-servers.json` (init options for TS) |
| 5 | **Workspace symbols** | Medium | Medium | `mod.rs` (capability + request), `commands/lsp.rs`, `api.js`, `CommandPalette.svelte` (new mode) |
| 6 | **Document highlight** | Medium | Small | `mod.rs` (capability), `commands/lsp.rs`, `api.js`, `editor-lsp.svelte.js` (CM decoration on cursor move) |
| 7 | **Range formatting** | Low | Small | `editor-lsp.svelte.js` (wire existing backend to selection format) |

### Wave 3: Navigation Extras

| # | Item | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 8 | **Type definition** | Low | Small | `mod.rs`, `commands/lsp.rs`, `api.js`, `editor-lsp.svelte.js` (context menu + shortcut) |
| 9 | **Go-to-declaration** | Low | Small | Same pattern as #8 |
| 10 | **Go-to-implementation** | Low | Small | Same pattern as #8 |
| 11 | **Linked editing** (HTML tag pairs) | Low | Small | `mod.rs` (capability), `commands/lsp.rs`, `api.js`, `editor-lsp.svelte.js` |
| 12 | **On-type formatting** | Low | Small | `mod.rs` (capability), `commands/lsp.rs`, `api.js`, `editor-lsp.svelte.js` |

### Wave 4: Polish & Visual

| # | Item | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 13 | **Code lens** | Low | Medium | `mod.rs` (capability + request), `commands/lsp.rs`, `api.js`, new `CodeLens.svelte` or CM widget |
| 14 | **Semantic tokens** | Low | High | `mod.rs` (capability + request + delta), `commands/lsp.rs`, `api.js`, `editor-extensions.js` (token → highlight mapping) |
| 15 | **Document colors** | Low | Medium | `mod.rs` (capability), `commands/lsp.rs`, `api.js`, CM color picker widget |
| 16 | **Folding ranges** | Low | Small | `mod.rs` (capability), `commands/lsp.rs`, `api.js`, CM fold service override |

### Wave 5: Deep Polish (optional)

| # | Item | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 17 | **Incremental document sync** | Low | Medium | `mod.rs` (change didChange to incremental), `editor-lsp.svelte.js` (CM changeDesc → LSP ranges) |
| 18 | **Completion resolve + snippets** | Low | Medium | `commands/lsp.rs` (resolve command), `editor-lsp.svelte.js` (snippet expansion) |
| 19 | **Pull diagnostics** | Low | Medium | `mod.rs` (new request type) |
| 20 | **Call hierarchy** | Very low | Large | New panel component, 3 commands |
| 21 | **Type hierarchy** | Very low | Large | New panel component, 3 commands |
| 22 | **Selection range** | Very low | Small | CM has built-in; marginal improvement |

---

## 5. Files Cleanup

After creating this document:

| File | Action | Reason |
|------|--------|--------|
| `docs/source-of-truth/LSP-CONFIG-GAPS.md` | **Delete** | Absorbed into §1 of this document |
| `docs/LSP-CONFIG.md` | **Delete** | Absorbed into §1.1 of this document |
| `docs/source-of-truth/IDE-GAPS.md` | **Update** | Replace LSP table (lines 56-106) with brief summary + link to this doc |
| `docs/implementation/LSP-DESIGN.md` | **Keep** | Implementation reference (architecture, data flow, commands), not gap tracking |

---

## References

- VS Code TS extension config: `extensions/typescript-language-features/src/configuration/configuration.ts`
- VS Code diagnostics: `extensions/typescript-language-features/src/languageFeatures/diagnostics.ts`
- VS Code severity mapping: `extensions/typescript-language-features/src/typeScriptServiceClientHost.ts`
- VS Code inferred project options: `extensions/typescript-language-features/src/tsconfig.ts`
- VS Code buffer sync: `extensions/typescript-language-features/src/tsServer/bufferSyncSupport.ts`
- Voice Mirror LSP init: `src-tauri/src/lsp/mod.rs` (lines 412-493)
- Voice Mirror diagnostic handler: `src-tauri/src/lsp/client.rs`
- Voice Mirror diagnostic store: `src/lib/stores/lsp-diagnostics.svelte.js`
- Voice Mirror severity util: `src/lib/lsp-severity.js`
- Voice Mirror LSP commands: `src-tauri/src/commands/lsp.rs` (27 commands)
- Voice Mirror API wrappers: `src/lib/api.js` (lines 682-777)
