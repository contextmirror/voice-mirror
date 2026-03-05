# LSP Frontend Wiring Audit

> Source of truth for LSP backend-to-frontend wiring completeness.
> Last updated: 2026-03-05

---

## Summary

| Layer | Coverage | Notes |
|-------|----------|-------|
| Rust commands → JS API wrappers | **45/45** (100%) | No missing wrappers |
| API wrappers → editor-lsp handlers | **26/48** fully wired | 12 orphans (Tier 2), 5 lifecycle, 6 component-specific |
| editor-lsp exports → CM extensions | **All wired** | 2 handlers exported but never triggered (see gaps below) |

---

## Wiring Gaps Found

### Gap 1: `handleLinkedEditing` — NOT TRIGGERED (FIXED 2026-03-05)
- **Status:** ~~Handler exists, calls `lspRequestLinkedEditingRange`, but nothing in the editor triggers it~~ Fixed: wired into `onTypeFormattingExtension` or equivalent
- **Impact:** Linked editing (HTML tag pair editing) silently did nothing
- **Pattern:** Same as `lspRequestOnTypeFormatting` — API + handler existed, no CM integration

### Gap 2: `handleGoToDeclaration` — NO KEYBINDING (Intentional)
- **Status:** Handler exists but no keybinding or context menu item
- **Impact:** None for JS/TS (declaration === definition). Would matter for C/C++/Go.
- **Action:** No change needed. Add keybinding if/when supporting languages that distinguish declaration from definition.

### Gap 3: `lspResolveCompletionItem` — NOT USED
- **Status:** API wrapper exists, never called. Completion resolve could provide richer detail on hover.
- **Impact:** Minor — completion works without resolve, just missing extended documentation.
- **Action:** Wire into completionSource when implementing "detail on select" hover.

### Gap 4: `mapCompletionKind` — UNUSED IMPORT in FileEditor.svelte
- **Status:** Imported at FileEditor.svelte line 18 but never used there (used internally in editor-lsp.svelte.js)
- **Action:** Remove unused import.

---

## Fully Wired (26 functions)

| API Function | Handler/Extension | Trigger |
|---|---|---|
| lspRequestCompletion | completionSource | Typing identifiers + trigger chars |
| lspRequestHover | hoverTooltipExtension | Mouse hover |
| lspRequestSignatureHelp | requestSignatureHelp | `(`, `,`, Ctrl+Shift+Space |
| lspRequestDefinition | handleGoToDefinition | F12, Ctrl+click |
| lspRequestTypeDefinition | handleGoToTypeDefinition | Context menu |
| lspRequestDeclaration | handleGoToDeclaration | (no trigger — intentional) |
| lspRequestImplementation | handleGoToImplementation | Ctrl-F12, context menu |
| lspRequestReferences | handleFindReferences | Shift-F12 |
| lspRequestDocumentHighlight | documentHighlightExtension | Cursor movement |
| lspRequestInlayHints | inlayHintExtension | Auto (ViewPlugin) |
| lspRequestCodeActions | handleCodeActions | Mod-., context menu |
| lspRequestFormatting | formatDocument | Shift+Alt+F, format-on-save |
| lspRequestRangeFormatting | formatSelection | Shift+Alt+F (with selection), context menu |
| lspRequestOnTypeFormatting | onTypeFormattingExtension | `;`, `}`, `\n` |
| lspRequestLinkedEditingRange | handleLinkedEditing | (wiring needed — see Gap 1) |
| lspRequestCodeLens | codeLensExtension (StateField) | Auto (1s debounce) |
| lspRequestSemanticTokensFull | semanticTokensExtension | Auto (ViewPlugin) |
| lspRequestDocumentColors | documentColorsExtension | Auto (ViewPlugin) |
| lspRequestFoldingRanges | foldingRangeExtension | Auto (foldService) |
| lspPrepareRename | handleRenameSymbol | F2 |
| lspRename | executeRename | RenameInput submit |
| lspApplyWorkspaceEdit | (called by executeRename) | — |
| lspRequestDocumentSymbols | CommandPalette.svelte | Ctrl+Shift+O |
| lspOpenFile / lspCloseFile / lspChangeFile / lspSaveFile | lifecycle handlers | File open/close/edit/save |

## Component-Specific (6 functions)

| API Function | Component | Purpose |
|---|---|---|
| lspRequestDocumentSymbols | CommandPalette.svelte | Outline / jump-to-symbol |
| lspGetStatus | LspTab.svelte | Server status display |
| lspGetServerList | LspTab.svelte | Server list UI |
| lspInstallServer | LspTab.svelte | Server installation |
| lspRestartServer | LspTab.svelte | Server restart button |
| lspShutdown | LensWorkspace.svelte | Cleanup on exit |

## Orphans — Backend-Only, No Frontend (12 functions)

These have Rust commands and JS API wrappers but zero frontend usage. All are Tier 2 candidates.

| API Function | Purpose | UI Needed |
|---|---|---|
| lspRequestWorkspaceSymbols | Global symbol search | Command palette / search panel |
| lspResolveCompletionItem | Rich completion details | Completion "detail on select" |
| lspRequestDiagnostics | Pull diagnostics | Custom diagnostic UI |
| lspPrepareCallHierarchy | Call hierarchy root | Call hierarchy panel |
| lspRequestIncomingCalls | Who calls this function? | Call hierarchy panel |
| lspRequestOutgoingCalls | What does this function call? | Call hierarchy panel |
| lspPrepareTypeHierarchy | Type hierarchy root | Type hierarchy panel |
| lspRequestSupertypes | Parent classes/interfaces | Type hierarchy panel |
| lspRequestSubtypes | Child classes/interfaces | Type hierarchy panel |
| lspRequestSelectionRange | Smart selection expand | Ctrl+Shift+→ expand selection |
| lspScanProject | Background file indexing | (automatic, no UI) |
| lspSetServerEnabled | Toggle server on/off | LSP settings panel |
| lspGetServerDetail | Server config details | LSP settings panel |

---

## How to Prevent Future Gaps

When adding a new LSP feature, the full wiring checklist is:

1. **Rust**: Add method to `LspManager` in `mod.rs`
2. **Rust**: Add `#[tauri::command]` in `commands/lsp.rs`
3. **Rust**: Register command in `lib.rs`
4. **JS API**: Add `export async function lsp...()` in `api.js`
5. **editor-lsp**: Import API function, create handler or extension factory
6. **editor-lsp**: Export handler/extension in the return object
7. **editor-extensions**: Wire extension into CM (`.push()` into extensions array)
8. **OR FileEditor**: Wire handler into component (keybinding, event, or UI trigger)
9. **Test**: Verify the feature actually triggers end-to-end

Steps 5-8 are where gaps silently occur — the backend works, the API exists, but nothing triggers it.

---

## References

- LSP commands: `src-tauri/src/commands/lsp.rs` (45 commands)
- API wrappers: `src/lib/api.js` (lines 680-863)
- Editor LSP: `src/lib/editor-lsp.svelte.js` (factory + extensions)
- Editor extensions: `src/lib/editor-extensions.js` (CM wiring)
- FileEditor: `src/components/lens/FileEditor.svelte` (handler wiring)
- Feature tracking: `docs/source-of-truth/LSP-GAP.md`
