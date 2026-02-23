# LSP Integration — Design & Status

> Internal design doc. `docs/internal/` is gitignored (some files force-added).

---

## What is LSP?

**Language Server Protocol** is a JSON-RPC protocol that separates code intelligence from editors. Instead of every editor implementing its own parser for every language, a single **language server** binary provides the smarts, and the editor just renders the results.

**How it works:**
1. Editor opens a file (e.g., `app.ts`)
2. Editor spawns the appropriate language server (`typescript-language-server`)
3. Editor sends the file content to the server via JSON-RPC over stdin/stdout
4. Server analyzes the code and sends back:
   - **Diagnostics** — errors (red squiggly), warnings (yellow squiggly)
   - **Completions** — context-aware autocomplete (not just keywords)
   - **Hover info** — type signatures, documentation on mouse hover
   - **Go-to-definition** — jump to where a symbol is defined
   - And more (symbols, references, rename, etc.)
5. Editor renders these in the UI

**Key insight:** The language servers are **external binaries** we don't write. They already exist (`rust-analyzer`, `typescript-language-server`, `pyright`, etc.). We just spawn them and speak the protocol.

**Protocol:** JSON-RPC 2.0 over stdin/stdout. Messages have a `Content-Length` header followed by a JSON body:

```
Content-Length: 52\r\n
\r\n
{"jsonrpc":"2.0","method":"initialized","params":{}}
```

---

## Implementation Status

### Implemented (Phases 1–5 complete)

| Feature | Status | Where |
|---------|--------|-------|
| Rust LSP infrastructure | Done | `src-tauri/src/lsp/` (4 files, ~1,525 lines) |
| Server auto-detection (7 languages) | Done | `lsp/detection.rs` |
| JSON-RPC framing (Content-Length) | Done | `lsp/client.rs` |
| 9 Tauri commands | Done | `commands/lsp.rs` |
| 9 API wrappers | Done | `src/lib/api.js` |
| Diagnostics (squiggly underlines) | Done | `FileEditor.svelte` → `@codemirror/lint` |
| Rich completions | Done | `FileEditor.svelte` → `@codemirror/autocomplete` |
| Hover tooltips | Done | `FileEditor.svelte` → `@codemirror/view` hoverTooltip |
| Go-to-definition (Ctrl+Click) | Done | `FileEditor.svelte` + `EditorContextMenu.svelte` |
| External file navigation (read-only) | Done | `FileEditor.svelte` — opens files outside project |
| Diagnostic caching per file | Done | `FileEditor.svelte` — `cachedDiagnostics` Map |
| `didSave` on Ctrl+S | Done | `FileEditor.svelte` |
| LSP status panel | Done | `LspTab.svelte` (130 lines) |
| Windows handling | Done | `.cmd` resolution, `CREATE_NO_WINDOW`, drive letter normalization |
| Live file sync (AI edits → editor) | Done | `fs-file-changed` event → CodeMirror update → LSP re-analysis |
| Tests | Done | 45+ tests across 3 test files, all passing |
| Documentation | Done | This file |

### Not Implemented

These are standard LSP capabilities that we **do not** currently support. Listed roughly by value:

| Feature | LSP Method | Value | Notes |
|---------|-----------|-------|-------|
| **FileTree diagnostic decorations** | — (UI only) | **High** | Red/yellow filenames + error badges in the file tree, like VS Code's Explorer. All data already available from `lsp-diagnostics` events — just needs UI wiring in `FileTree.svelte`. |
| **Document symbols / outline** | `textDocument/documentSymbol` | Medium | Shows an outline of functions, classes, variables in the current file. Useful for navigation in large files. |
| **Find all references** | `textDocument/references` | Medium | "Where is this symbol used?" — helpful for refactoring. |
| **Rename symbol** | `textDocument/rename` | Medium | Rename a variable/function across all files. Requires `textDocument/prepareRename` + workspace edit application. |
| **Workspace symbols** | `workspace/symbol` | Low | Search for symbols across the entire project. Overlaps with Command Palette file search. |
| **Code actions / quick fixes** | `textDocument/codeAction` | Medium | Auto-fix suggestions (e.g., "add missing import", "convert to const"). Would appear as lightbulb icon in gutter. |
| **Inlay hints** | `textDocument/inlayHint` | Low | Inline type annotations (e.g., showing inferred types). Can be noisy. |
| **Semantic highlighting** | `textDocument/semanticTokens` | Low | Token-based highlighting (more accurate than syntax regex). Marginal visual improvement. |
| **Code lens** | `textDocument/codeLens` | Low | Inline annotations above functions (e.g., "3 references", "Run test"). |
| **Call hierarchy** | `callHierarchy/incomingCalls` | Low | "Who calls this function?" tree view. Niche use case. |
| **Folding ranges** | `textDocument/foldingRange` | Low | LSP-aware code folding. CodeMirror already has syntax-based folding. |
| **Signature help** | `textDocument/signatureHelp` | Low | Shows function parameter info as you type `(`. Overlaps with completions. |
| **Crash recovery** | — | Low | Restart server with exponential backoff on unexpected exit. Not yet needed — servers are stable in practice. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Svelte)                      │
│                                                           │
│  FileEditor.svelte (~939 lines)                          │
│    ├── @codemirror/lint      ← diagnostics (squigglies)   │
│    ├── @codemirror/autocomplete ← LSP completions         │
│    ├── @codemirror/view      ← hover tooltips             │
│    ├── Ctrl+Click keymap     ← go-to-definition           │
│    └── Context menu          ← right-click "Go to Def"    │
│                                                           │
│  LspTab.svelte (~130 lines)                              │
│    └── Server status list with green/grey dots            │
│                                                           │
│  Tauri events: lsp-diagnostics, lsp-server-status         │
│  Tauri invoke: 9 commands (open, close, change, save,     │
│                completion, hover, definition, status,      │
│                shutdown)                                   │
├───────────────────────────────────────────────────────────┤
│                  Rust Backend (Tauri)                      │
│                                                           │
│  src-tauri/src/lsp/                                       │
│    ├── mod.rs (723 lines)   ← LspManager: spawn, manage  │
│    │     ensure_server(), open/close/change_document(),   │
│    │     request_completion/hover/definition(),           │
│    │     get_status(), shutdown_server/all()              │
│    ├── client.rs (359 lines) ← JSON-RPC transport        │
│    │     write_message(), read_message(),                 │
│    │     spawn_reader_loop(), send_request/notification() │
│    │     handle_diagnostics() → lsp-diagnostics event     │
│    ├── detection.rs (279 lines) ← server discovery       │
│    │     detect_for_extension(), language_id_for_ext(),   │
│    │     detect_all(), resolve_node_script() (Windows)    │
│    └── types.rs (164 lines) ← helpers + event structs    │
│          file_uri(), uri_to_relative_path(),              │
│          LspDiagnosticEvent, LspServerStatusEvent         │
│                                                           │
│  src-tauri/src/commands/lsp.rs (256 lines)               │
│    └── 9 async commands exposed via invoke()              │
├───────────────────────────────────────────────────────────┤
│              Language Servers (external)                    │
│                                                           │
│  typescript-language-server  ← JS / TS (8 extensions)    │
│  rust-analyzer               ← Rust                       │
│  pyright-langserver          ← Python                     │
│  vscode-css-language-server  ← CSS / SCSS                │
│  vscode-html-language-server ← HTML / Svelte             │
│  vscode-json-language-server ← JSON                      │
│  marksman                    ← Markdown                   │
└───────────────────────────────────────────────────────────┘
```

**Data flow — diagnostics (implemented):**
1. User edits a `.ts` file in FileEditor
2. Frontend sends `lspChangeFile()` (debounced 300ms) to Rust with updated content
3. Rust forwards `textDocument/didChange` to `typescript-language-server`
4. Server analyzes and sends `textDocument/publishDiagnostics` back
5. Rust receives it via `spawn_reader_loop()`, emits `lsp-diagnostics` Tauri event
6. Frontend receives event, converts LSP positions to CodeMirror offsets, caches per file
7. CodeMirror draws red/yellow squiggly underlines via `setDiagnostics()` + `lintGutter()`

**Data flow — completions (implemented):**
1. User types in a `.ts` file, CodeMirror triggers the LSP completion source
2. `lspCompletionSource()` calls `lspRequestCompletion(path, line, character, projectRoot)`
3. Rust forwards `textDocument/completion` to the language server
4. Server returns completion items with labels, kinds, insertText/textEdit
5. `mapCompletionKind()` converts LSP kinds (1–25) to CodeMirror types
6. 5-second timeout falls back to keyword completions if server is slow

---

## Language Servers

| Language | Server Binary | Install | Extensions |
|----------|--------------|---------|------------|
| JavaScript / TypeScript | `typescript-language-server` | `npm i -g typescript-language-server typescript` | js, jsx, ts, tsx, mjs, mts, cjs, cts |
| Rust | `rust-analyzer` | Ships with `rustup component add rust-analyzer` | rs |
| Python | `pyright-langserver` | `npm i -g pyright` | py |
| CSS / SCSS | `vscode-css-language-server` | `npm i -g vscode-langservers-extracted` | css, scss, less |
| HTML / Svelte | `vscode-html-language-server` | `npm i -g vscode-langservers-extracted` | html, svelte |
| JSON | `vscode-json-language-server` | `npm i -g vscode-langservers-extracted` | json, jsonc |
| Markdown | `marksman` | Standalone binary | md |

**Auto-detection:** When a file is opened, check the extension → map to server binary → check if it exists on PATH → spawn if found.

**One server per language:** All open `.ts` files share one `typescript-language-server` instance. Server is spawned on first file open, killed when last file of that language closes (or on app exit).

**Windows-specific:** npm-installed language servers on Windows are `.cmd` batch wrappers. `resolve_node_script()` in `detection.rs` converts these to `node <script>` invocations so stdin/stdout piping works correctly.

---

## Tauri Commands

| Command | Parameters | Returns | Purpose |
|---------|-----------|---------|---------|
| `lsp_open_file` | path, content, project_root | `()` | Detect language, ensure server, send `didOpen` |
| `lsp_close_file` | path, project_root | `()` | Send `didClose`, kill server if no more docs |
| `lsp_change_file` | path, content, version, project_root | `()` | Send `didChange` (full sync) |
| `lsp_save_file` | path, content, project_root | `()` | Send `didSave` (with text) |
| `lsp_request_completion` | path, line, character, project_root | CompletionItem[] | Completions at cursor |
| `lsp_request_hover` | path, line, character, project_root | HoverContents | Type info / docs at cursor |
| `lsp_request_definition` | path, line, character, project_root | Location[] | Definition location(s) |
| `lsp_get_status` | — | ServerStatus[] | Running servers + doc counts |
| `lsp_shutdown` | — | `()` | Graceful shutdown of all servers |

---

## Frontend Features

### FileEditor.svelte

| Feature | How It Works |
|---------|-------------|
| **Diagnostics** | Listens for `lsp-diagnostics` event → `lspPositionToOffset()` converts 1-indexed LSP positions to 0-indexed CodeMirror offsets → `setDiagnostics()` renders squiggly underlines → `lintGutter()` shows gutter markers |
| **Completions** | `lspCompletionSource()` async function registered as CodeMirror autocomplete override → `mapCompletionKind()` maps LSP kinds to CM types → falls back to keyword completions on 5s timeout |
| **Hover** | `hoverTooltip()` extension calls `lspRequestHover()` → renders plaintext/markdown in styled `.lsp-hover-tooltip` div |
| **Go-to-definition** | Ctrl+Click keymap + context menu → `lspRequestDefinition()` → same-file scroll or open in new tab → `uriToRelativePath()` handles external files (opened read-only) |
| **Document sync** | `lspOpenFile()` on load, debounced `lspChangeFile()` on edit (300ms), `lspSaveFile()` on Ctrl+S, `lspCloseFile()` on close/destroy |
| **Diagnostic cache** | `cachedDiagnostics` Map stores diagnostics per file path, restored on tab switch |
| **Live file sync** | `fs-file-changed` event from Rust file watcher → CodeMirror dispatch → triggers LSP re-analysis |

### LspTab.svelte

Server status panel in StatusDropdown:
- Fetches `lspGetStatus()` when tab becomes visible
- Listens for `lsp-server-status` event for live updates
- Green dot = running, grey dot = not found on PATH
- Shows server binary name + language ID + open file count
- "No LSP servers active" empty state
- Footer: "Auto-detected from open file types"

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `test/api/api-lsp.test.cjs` | 9 | All 9 API wrappers (exports + invoke calls) |
| `test/components/file-editor-lsp.test.cjs` | 17 | Imports, helpers, events, extensions, debouncing, lifecycle, completions, hover, go-to-def, language detection, save, CSS, position clamping |
| `test/components/status-dropdown-lsp.test.cjs` | 13 | API imports, state, events, rendering (dots, names, counts, empty state), auto-detection hint, cleanup |

All passing as part of `npm test` (2476+ tests total).

---

## Design Decisions

1. **Auto-detect, don't configure.** Language servers are discovered from PATH based on open file types. No manual config needed. Matches OpenCode's approach.

2. **Rust client, not JS.** The LSP client runs entirely in Rust (`src-tauri/src/lsp/`). This matches the project architecture where Rust manages all external processes (CLI PTY, MCP binary, etc.).

3. **One server per language.** All `.ts` files share one `typescript-language-server` instance. Efficient and standard.

4. **Lazy spawn.** Servers are only started when a file of that language is first opened. Killed when the last file closes or the app exits.

5. **Graceful degradation.** If a language server isn't installed, the editor still works — just without diagnostics/rich completions. The keyword-level autocomplete (`@codemirror/autocomplete`) remains as fallback.

6. **No bundled servers.** We don't ship language servers with the app. Users install them via their package manager. This keeps the app size small and servers up-to-date.

---

## Live File Sync — AI Edits Appear in Real-Time

When an AI provider (Claude Code, OpenCode) edits a file on disk, the file editor updates instantly — the user watches their code change as the AI writes it.

**The full loop (implemented):**
1. User gives a voice command ("add a login form to App.svelte")
2. Claude Code edits the file on disk
3. Rust file watcher (`notify` crate) detects the change
4. Rust reads the new content, emits `file-changed` Tauri event with `{ path, content }`
5. FileEditor receives it → updates CodeMirror via `view.dispatch()` (preserves cursor + scroll)
6. LSP server receives `textDocument/didChange` → diagnostics update live
7. Vite dev server hot-reloads → browser panel shows the result
8. All visible simultaneously in the Lens workspace

---

## Known Issues — Addressed

### Browser Cache on Localhost Dev

WebView2 aggressively caches localhost assets. Mitigated with:

- **Initialization script** — overrides `fetch()` with `cache: 'no-store'` and `XMLHttpRequest.prototype.open` with `Cache-Control: no-cache, no-store` for localhost/127.0.0.1
- **Hard Refresh** — Ctrl+Shift+R triggers `lens_hard_refresh` with cache-busting reload
- **WebView2 cache clearing on project switch** — clears browsing data when switching projects

### LSP Stderr Log Spam

Language servers can be chatty on stderr. Addressed with deduplicated + rate-limited logging in `client.rs`.

### Windows Path Handling

- Drive letter normalization in `file://` URIs (lowercase)
- Case-insensitive path comparison for go-to-definition
- `.cmd` wrapper resolution for npm-installed servers

---

## Comparison: Zed Editor LSP

Zed (`E:\Projects\references\Zed`) is a high-performance code editor written in Rust. Their LSP implementation is massive — `lsp_store.rs` alone is **14,386 lines** (nearly 10x our entire LSP module). This comparison was done in Feb 2026 against their current codebase.

### Feature Comparison
    ┌─────────────────────────────────┬─────────────────────────────────────────────────┬──────────────┬───────┐
    │             Feature             │                       Zed                       │ Voice Mirror │  Gap  │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Diagnostics (squiggly lines)    │ Yes                                             │ Yes          │ --    │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Completions                     │ Yes (with resolve + snippets)                   │ Yes (basic)  │ Minor │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Hover tooltips                  │ Yes (markdown, keyboard grace)                  │ Yes          │ Minor │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Go-to-definition                │ Yes                                             │ Yes          │ --    │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Type definition                 │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Declaration                     │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Implementation                  │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Find all references             │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Rename symbol                   │ Yes (with prepare)                              │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Code actions / quick fixes      │ Yes (resolve + filtering)                       │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Signature help                  │ Yes (auto-trigger on ()                         │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Inlay hints                     │ Yes (50-row chunking, resolve on hover)         │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Semantic tokens                 │ Yes (delta encoding, augments syntax)           │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Code lens                       │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Document symbols / outline      │ Yes (LSP + tree-sitter fallback)                │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Workspace symbols               │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Document colors                 │ Yes (color picker)                              │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Folding ranges                  │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Linked editing                  │ Yes (e.g. HTML tag pairs)                       │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ On-type formatting              │ Yes                                             │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ FileTree diagnostic decorations │ Yes (error/warning counts on files AND folders) │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Multi-server per file           │ Yes (primary + supplementary)                   │ No           │       │
    ├─────────────────────────────────┼─────────────────────────────────────────────────┼──────────────┼───────┤
    │ Remote LSP (SSH)                │ Yes                                             │ No           │       │
    └─────────────────────────────────┴─────────────────────────────────────────────────┴──────────────┴───────┘ 

### Interesting Patterns from Zed

**FileTree diagnostic decorations** — They aggregate error/warning counts up through folders too, not just files. A red `src/` folder means "something inside has errors." All our diagnostic data is already available from `lsp-diagnostics` events — this is purely a UI wiring task in `FileTree.svelte`.

**Inlay hint chunking** — Instead of fetching all hints for a file at once, Zed splits large files into 50-row chunks and fetches hints per-chunk. Avoids LSP timeouts on large files, enables lazy loading as the user scrolls.

**Tree-sitter fallback** — If no LSP server is available, document symbols still work via syntax-level parsing. Graceful degradation at every level.

**Multi-server per file** — One file can have a TypeScript server AND a CSS server simultaneously (for CSS-in-JS, embedded languages). They track primary + supplementary servers per buffer.

**Semantic token augmentation** — Zed doesn't replace syntax highlighting with LSP semantic tokens — it augments it. Tree-sitter does the base highlighting, LSP refines specific tokens (e.g., distinguishing a local variable from a parameter). Best of both worlds.

### What's Worth Adopting

Ranked by effort vs value for Voice Mirror:

1. **FileTree diagnostic decorations** — Low effort, high value. We have the data, just need UI wiring.
2. **Code actions / quick fixes** — Medium effort, high value. The "add missing import" lightbulb.
3. **Find all references** — Medium effort, medium value. "Where is this used?"
4. **Rename symbol** — Medium effort, medium value. Rename across all files.
5. **Document symbols / outline** — Medium effort, nice for large file navigation.

The rest (semantic tokens, inlay hints, code lens, linked editing, multi-server) are polish features. Zed invests in them because they're building a VS Code competitor. Voice Mirror's differentiator is AI + voice + browser integration — our current LSP covers the core editing experience.

### Zed's Architecture (for reference)

| Module | Lines | Purpose |
|--------|-------|---------|
| `crates/lsp/src/lsp.rs` | ~3,200 | Low-level JSON-RPC protocol, stdio, capabilities |
| `crates/project/src/lsp_store.rs` | ~14,386 | High-level LSP store (95+ public methods) |
| `crates/project/src/lsp_store/inlay_hints.rs` | ~346 | Chunk-based hint caching + resolution |
| `crates/project/src/lsp_store/semantic_tokens.rs` | — | Delta encoding, syntax augmentation |
| `crates/project/src/lsp_store/code_lens.rs` | — | Aggregation across servers |
| `crates/editor/src/hover_popover.rs` | ~2,008 | Hover UI with keyboard grace |
| `crates/editor/src/signature_help.rs` | — | Parameter info on `(` |
| `crates/project_panel/src/project_panel.rs` | — | FileTree with diagnostic decorations |
| `crates/diagnostics/src/` | — | Dedicated diagnostic panel + inline rendering |

---

## Open Questions

- [ ] Should we bundle `vscode-langservers-extracted` as a convenience install?
- [ ] Svelte LSP (`svelte-language-server`) — worth adding alongside generic HTML?
- [ ] Do we want an "install missing server" button in the LSP status tab?
- [ ] Crash recovery with exponential backoff — needed in practice?

### Resolved

- [x] ~~Should diagnostics persist across file switches?~~ — Yes, implemented via `cachedDiagnostics` Map in FileEditor.
- [x] ~~Rate-limit `textDocument/didChange`?~~ — Yes, 300ms debounce implemented.

---

## Git History (LSP-related commits)

| Hash | Message |
|------|---------|
| `353b70a2` | feat: LSP integration — diagnostics, completions, hover, go-to-definition |
| `c5614606` | feat: context-aware editor right-click menu with AI actions |
| `ab8df62f` | fix: deduplicate LSP stderr log spam |
| `69d1cdd2` | fix: prevent Ctrl+Click from opening browser in editor |
| `6d267061` | feat: read-only viewing of external files via go-to-definition |
| `30977570` | fix: case-insensitive path comparison for Windows go-to-definition |
