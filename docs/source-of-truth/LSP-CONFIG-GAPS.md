# LSP Configuration Gaps — Voice Mirror vs VS Code

> Research notes from 2026-02-28. Captures differences between our LSP setup and VS Code's,
> with actionable items for improving diagnostic accuracy and coverage.

---

## Current Issue

Voice Mirror shows **19 false-positive errors** in the Lens editor across JavaScript files.
The red dots appear on valid code (e.g. optional chaining on DOM elements in `main.js`).
Users must open each file individually to see diagnostics — no unified Problems panel exists.

---

## 1. Config Differences: Voice Mirror vs VS Code

### 1.1 Initialization Options

| Setting | VS Code | Voice Mirror |
|---------|---------|-------------|
| `initializationOptions` | Passes TypeScript-specific settings (log level, plugin paths, locale, implicit project config) | **None passed** — TS server uses defaults |
| `workspaceFolders` | Sent in initialize request | **Not sent** — only `rootUri` |
| `implicitProjectConfig` | Configurable per-workspace (`target`, `module`, `checkJs`, `strict`) | **Not configurable** — relies on `jsconfig.json` |
| `enableProjectDiagnostics` | Toggle for workspace-wide vs open-files-only | **Not exposed** |

### 1.2 Diagnostic Request Strategy

| Aspect | VS Code | Voice Mirror |
|--------|---------|-------------|
| Request method | Active: `geterr` (batch open files) or `geterrForProject` (workspace-wide) | **Passive only**: waits for `publishDiagnostics` notifications |
| Debounce | 200-800ms based on file size | No debounce (fires on every LSP notification) |
| Visible range hints | Sends visible viewport ranges to TS server (API 5.6+) for region-only semantics | **Not implemented** |
| Diagnostic kinds | 4 separate kinds: syntax, semantic, suggestion, regionSemantic | **Single flat list** per file |

### 1.3 publishDiagnostics Capability

| Setting | VS Code | Voice Mirror |
|---------|---------|-------------|
| `relatedInformation` | `true` | `false` |
| `tagSupport` | `{ valueSet: [1, 2] }` (unnecessary, deprecated) | **Not declared** |
| `versionSupport` | `true` (matches diagnostics to document version) | **Not declared** |
| `codeDescriptionSupport` | `true` | **Not declared** |

### 1.4 jsconfig.json

Our current config:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "target": "ESNext",
    "module": "ESNext",
    "checkJs": true,
    "paths": { "$lib/*": ["./src/lib/*"] }
  },
  "include": ["src/**/*.d.ts", "src/**/*.js", "src/**/*.svelte"],
  "exclude": ["node_modules", "dist", "test", "src-tauri"]
}
```

**`checkJs: true`** is the primary source of false-positive errors. The TypeScript server
type-checks all JS files as if they were TypeScript. This catches real bugs but also flags
valid patterns (optional chaining on DOM, dynamic Tauri APIs, etc.) as errors.

**Options:**
1. Change `checkJs: false` — eliminates noise, keeps intellisense/autocomplete
2. Keep `checkJs: true` + add `// @ts-expect-error` or `// @ts-ignore` for false positives
3. Keep `checkJs: true` + add proper JSDoc type annotations to silence false positives
4. **Recommended**: Add `"strict": false` and `"noImplicitAny": false` to reduce noise while keeping basic checking

---

## 2. Problems Panel — Missing Feature

### What VS Code Has

A dedicated **Problems panel** (Ctrl+Shift+M) with:
- **Tree view** grouped by file → individual diagnostics
- **Severity filtering** (toggle errors/warnings/info independently)
- **Text search** across all diagnostic messages
- **`files.exclude` support** — respects workspace exclusion globs
- **Click to navigate** — jumps to exact file:line:col
- **Badge in status bar** — aggregate error/warning count (always visible)
- **Multi-source aggregation** — LSP, ESLint, task runners, extensions all feed one `MarkerService`

### What Voice Mirror Has

- Inline squiggles in editor (per-file, only when open)
- Error/warning count badges on FileTree nodes
- Aggregate count in status bar (bottom-left) — **only for open files**
- `lsp-diagnostics.svelte.js` store with `rawDiagnostics` Map

### What Voice Mirror Needs

| Component | Effort | Notes |
|-----------|--------|-------|
| **ProblemsPanel.svelte** — tree view component | Medium | Group by file, show severity icon + message + line:col |
| **Wire as bottom panel tab** — alongside Voice Agent, Output, Terminal | Small | Add fourth tab |
| **Aggregate diagnostics across all known files** | Medium | Currently only files with `didOpen`; need to request diagnostics for project files |
| **Severity filter toggles** | Small | Error/Warning/Info toggle buttons in panel header |
| **Click-to-navigate** | Small | Open file + set cursor position on click |
| **Text search/filter** | Small-Medium | Filter diagnostics by text |

---

## 3. Actionable Items (Priority Order)

### Quick Win: Fix False Positives

**Modify `jsconfig.json`** to reduce noise while keeping useful checking:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "target": "ESNext",
    "module": "ESNext",
    "checkJs": true,
    "strict": false,
    "noImplicitAny": false,
    "skipLibCheck": true,
    "paths": { "$lib/*": ["./src/lib/*"] }
  }
}
```

### Medium Term: Improve LSP Initialization

Pass `initializationOptions` to the TypeScript language server with:
```json
{
  "preferences": {
    "includeInlayParameterNameHints": "none",
    "includeInlayVariableTypeHints": false
  },
  "tsserver": {
    "logVerbosity": "off"
  }
}
```

Enhance `publishDiagnostics` capability declaration:
```json
{
  "relatedInformation": true,
  "tagSupport": { "valueSet": [1, 2] },
  "versionSupport": true,
  "codeDescriptionSupport": true
}
```

### Larger: Build Problems Panel

See §2 above. Estimated effort: Medium (3-5 files, reuses existing diagnostic store).
Already tracked as **UX Audit item #22**.

---

## References

- VS Code TypeScript config: `extensions/typescript-language-features/src/configuration/configuration.ts`
- VS Code diagnostic manager: `extensions/typescript-language-features/src/languageFeatures/diagnostics.ts`
- VS Code buffer sync (geterr): `extensions/typescript-language-features/src/tsServer/bufferSyncSupport.ts`
- VS Code markers model: `src/vs/workbench/contrib/markers/browser/markersModel.ts`
- VS Code markers view: `src/vs/workbench/contrib/markers/browser/markersView.ts`
- Voice Mirror LSP init: `src-tauri/src/lsp/mod.rs` (lines 256-326)
- Voice Mirror diagnostic handler: `src-tauri/src/lsp/client.rs` (lines 214-297)
- Voice Mirror diagnostic store: `src/lib/stores/lsp-diagnostics.svelte.js`
