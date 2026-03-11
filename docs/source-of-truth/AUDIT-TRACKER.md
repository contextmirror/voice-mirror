# Voice Mirror — Audit Tracker

> Living checklist of codebase audits. Each section tracks scope, status, and findings.
> Run periodically (monthly or before releases) to catch regressions.

**Last updated:** 2026-03-11

---

## 1. Compliance

### 1.1 License Audit

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| npm dependencies (93 packages) | Done | 2026-03-11 | All permissive (MIT, Apache-2.0, BSD, ISC) |
| Cargo dependencies (698 crates) | Done | 2026-03-11 | 12 MPL-2.0 (file-level, unmodified — no obligation) |
| CodeMirror 6 deep-dive (32 packages) | Done | 2026-03-11 | All MIT |
| Vendored/copied code | Done | 2026-03-11 | File icons (MIT, attributed), ghostty-web (MIT) |
| Project LICENSE file | Done | 2026-03-11 | MIT, Copyright 2026 Context Mirror |

**Action items from last run:**
- [x] Add `license = "MIT"` to `src-tauri/Cargo.toml`
- [x] Created `THIRD-PARTY-NOTICES` file at project root
- [x] Removed Flameshot references from `design-overlay.js` comments

### 1.2 Attribution

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| File icons (OpenCode) | Done | 2026-03-11 | `src/assets/icons/LICENSE-file-icons` — properly attributed |
| Provider brand icons | Done | 2026-03-11 | Nominative fair use for referential UI |

---

## 2. Security

### 2.1 Dependency Vulnerabilities

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| `npm audit` (production) | Done | 2026-03-11 | 1 moderate: dompurify XSS (GHSA-v2wj-7wpq-c8vv) — fix available |
| `npm audit` (dev) | Done | 2026-03-11 | 2 moderate: svelte SSR-only XSS — not exploitable in Tauri desktop app |
| `cargo audit` | Done | 2026-03-11 | 0 CVEs. 20 warnings (unmaintained/unsound) — all transitive via Tauri/GTK3 |

**Findings:**

| Package | Severity | Advisory | Exploitable? | Fix |
|---------|----------|----------|-------------|-----|
| dompurify 3.3.1 | Moderate | GHSA-v2wj-7wpq-c8vv (XSS) | **Yes** — we use it to sanitize HTML | `npm audit fix` |
| svelte 5.53.0 | Moderate | GHSA-qgvg-pr8v-6rr3 (SSR XSS) | No — no SSR in Tauri | `npm audit fix` |
| svelte 5.53.0 | Moderate | GHSA-phwv-c562-gvmh (SSR XSS) | No — no SSR in Tauri | `npm audit fix` |
| glib 0.18.5 (Rust) | Unsound | RUSTSEC-2024-0429 | Low — transitive via GTK3/Linux | Awaiting upstream |
| 19 Rust crates | Unmaintained | Various | No — GTK3/Linux transitive deps | Awaiting Tauri updates |

**Action items:**
- [x] Run `npm audit fix` — dompurify + svelte patched, 0 vulnerabilities remaining
- [ ] Cargo warnings are all transitive — no action until Tauri updates upstream deps

### 2.2 Secret Scanning

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Committed API keys/tokens | Clean | 2026-03-11 | No secrets in git history (last 50 commits checked) |
| .env files in repo | Clean | 2026-03-11 | No secret files tracked; 5 .gitignore gaps (see below) |
| Hardcoded credentials in source | Clean | 2026-03-11 | Only dummy `"s3cret!Pass"` in `auth_vault.rs` test — not real |
| Private keys/certificates | Clean | 2026-03-11 | No .pem, .key, .p12, .pfx, .cert files in repo |
| Config files | Clean | 2026-03-11 | `tauri.conf.json`, `.cargo/config.toml` — no embedded secrets |

**Action items:**
- [x] Added missing .gitignore patterns: `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `credentials.json`, `token_cache.json`

### 2.3 IPC / Tauri Command Surface

**140 commands registered** in `lib.rs`. Full audit completed.

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Input validation | Done | 2026-03-11 | File commands have path traversal defense; chat IDs validated; see HIGH findings |
| Permission scoping | Done | 2026-03-11 | `shell:allow-execute` removed (unused); devtools denied |
| Error info leakage | Low | 2026-03-11 | Error messages include OS paths — minor for desktop app |

**HIGH findings:**

| Command | File | Issue |
|---------|------|-------|
| ~~`export_chat_to_file`~~ | `chat.rs:236` | Fixed — extension whitelist + path validation added |
| `lens_eval_tab_js` | `lens.rs:1782` | **Arbitrary JS exec** in child WebView2 — by design, but XSS amplification risk |
| `lens_eval_device_js` | `lens.rs:1637` | Same as above |

**MEDIUM findings:**

| Command | File | Issue |
|---------|------|-------|
| ~~`lens_open_download`~~ | `lens.rs:2059` | Fixed — validates path against downloads list |
| `read_external_file` | `read_write.rs:80` | Reads any file on system (2MB cap) — by design but no restrictions |
| ~~`terminal_spawn` / `start_ai`~~ | Various | Fixed — validates `cwd` is existing directory |
| `kill_port_process` | `dev_server.rs:57` | Can kill any process on any port |

**Positive security patterns:**
- File commands use canonicalization + `starts_with()` for path traversal defense
- Chat IDs validated with `[a-zA-Z0-9_-]` allowlist
- `update_npm_package` whitelists allowed package names
- Regex uses `regex` crate (guaranteed linear-time, no ReDoS)
- Search results capped (200 files, 5000 matches)
- File writes use temp+rename atomic pattern
- Deletion tries OS trash before permanent delete

**Action items:**
- [x] Add path validation to `export_chat_to_file` — extension whitelist + path validation added
- [x] Validate `lens_open_download` path exists in downloads list before `opener::open()`
- [x] Validate `cwd` is an existing directory in `terminal_spawn` / `start_ai` / `set_provider`

### 2.4 WebView2 Bridge Security

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| JS eval sandboxing | Done | 2026-03-11 | ExecuteScript used for MCP actions — trusted input, proper escaping |
| CSS selector injection | **MEDIUM** | 2026-03-11 | `resolve_element_target()` only escapes `'` not `\` — real injection vector |
| Message passing validation | Clean | 2026-03-11 | Length-prefixed, typed serde enums, 10MB max, no open-ended dispatch |
| URI scheme handlers | Clean | 2026-03-11 | Whitelist-based keys, data emitted as events not executed |
| Named pipe security | Clean | 2026-03-11 | PID-based name, first-instance-only, single-client |
| Auth vault key storage | Done | 2026-03-11 | AES-256-GCM key now DPAPI-protected; auto-migrates old plaintext keys |
| `escape_js_string` coverage | Clean | 2026-03-11 | Adequate for single-quoted contexts (all current usage) |

**Findings by risk level:**

**HIGH (FIXED):**
- ~~`"csp": null` in `tauri.conf.json:32`~~ — CSP added: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ...`
- ~~`shell:allow-execute` in `capabilities/default.json:9`~~ — removed (frontend only uses `shell:allow-open`)
- ~~Combined: any XSS in main webview = remote code execution~~ — mitigated by CSP + permission scoping

**MEDIUM:**
- ~~CSS selector injection in `browser_bridge.rs:383-388`~~ — fixed, now uses `escape_js()` for proper escaping
- `withGlobalTauri: true` — `window.__TAURI__` exposed globally (mitigated: main webview only)
- ~~Auth vault key at `%APPDATA%/voice-mirror/auth/.key`~~ — now DPAPI-protected (current-user scope)
- `waitforurl` regex — MCP-controlled pattern in `new RegExp()`, ReDoS possible

**Action items:**
- [x] Add CSP to `tauri.conf.json` — full policy with `default-src 'self'`, scoped `connect-src`, `img-src`, etc.
- [x] Remove `shell:allow-execute` — frontend only uses `open` (confirmed via grep)
- [x] Fix CSS selector escaping in `browser_bridge.rs` — now uses `escape_js()` (backslash + quote escaping)
- [x] DPAPI protection for auth vault key — `CryptProtectData` wraps key on disk, auto-migration of old plaintext keys
- [x] Deny devtools in production — added `core:webview:deny-internal-toggle-devtools` to capabilities

### 2.5 CSP (Content Security Policy)

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Main window CSP | Done | 2026-03-11 | CSP enabled: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ...` |
| Child WebView2 CSP | Done | 2026-03-11 | Separate processes, no `__TAURI__` global — lower risk |
| `unsafe-inline` / `unsafe-eval` usage | Done | 2026-03-11 | Only `style-src 'unsafe-inline'` (required by Svelte); no `unsafe-eval` |
| DevTools access | Done | 2026-03-11 | `deny-internal-toggle-devtools` added to capabilities |

---

## 3. Code Quality

### 3.1 Dead Code

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Stale Svelte components | **2 found** | 2026-03-11 | `SessionPanel.svelte`, `ChatList.svelte` — never imported |
| Unused API wrappers | **13 found** | 2026-03-11 | LSP Tier 2+ stubs in `api.js` — intentional forward stubs |
| Unused Rust functions | Clean | 2026-03-11 | Zero dead code warnings from `cargo check` |
| All other components/libs | Clean | 2026-03-11 | 90+ components, all imported somewhere |

**Dead components to remove:**
- [x] `src/components/sidebar/SessionPanel.svelte` — deleted (superseded by `ChatSessionDropdown`)
- [x] `src/components/sidebar/ChatList.svelte` — deleted (old sidebar design remnant)

**Unused API wrappers (keep as forward stubs or remove):**
`lspRequestWorkspaceSymbols`, `lspResolveCompletionItem`, `lspRequestDiagnostics`, `lspPrepareCallHierarchy`, `lspRequestIncomingCalls`, `lspRequestOutgoingCalls`, `lspPrepareTypeHierarchy`, `lspRequestSupertypes`, `lspRequestSubtypes`, `lspRequestSelectionRange`, `lspScanProject`, `lspSetServerEnabled`, `lspGetServerDetail`

### 3.2 Bundle Size

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Production bundle | Done | 2026-03-11 | **2,319 KB JS** (706 KB gzip), 257 KB CSS, 423 KB WASM, 956 KB SVG sprite |
| Main chunk | **WARNING** | 2026-03-11 | 1,959 KB — exceeds Vite's 500 KB warning |
| CodeMirror + Lezer | 1,630 KB | 2026-03-11 | 38% of bundle — largest contributor |
| ghostty-web | 688 KB | 2026-03-11 | 16% of bundle — terminal renderer |
| Markdown + highlight.js + DOMPurify | 135 KB | 2026-03-11 | 3% — hover tooltips |

**Top modules by size:**

| Module | Size |
|--------|------|
| ghostty-web.js | 704 KB |
| @codemirror/view | 479 KB |
| @codemirror/state | 144 KB |
| @codemirror/autocomplete | 88 KB |
| @lezer/markdown | 86 KB |
| @lezer/common | 83 KB |
| @lezer/javascript | 81 KB |
| highlight.js/lib/core | 78 KB |

**Optimization opportunities:**

| Change | Savings | Effort |
|--------|---------|--------|
| `manualChunks` to split CodeMirror + ghostty | ~2.3 MB off main chunk | Low — vite config only |
| Dynamic-import `hover-markdown.js` on first hover | ~135 KB off initial load | Low — import() change |
| SVG sprite subset (if many icons unused) | Up to ~700 KB | Medium — icon audit needed |
| Add `rollup-plugin-visualizer` for future audits | N/A | Low — dev dependency |

**Action items:**
- [x] Add `manualChunks` in `vite.config.js` — codemirror, ghostty, markdown chunks split off main
- [x] Dynamic-import `hover-markdown.js` — lazy-loads on first LSP hover via `await import()`
- [x] Add `rollup-plugin-visualizer` as dev dependency — gated on production build, outputs `stats.html`

### 3.3 Test Coverage

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Test health | Done | 2026-03-11 | 6,419 tests, 6,415 pass, 0 fail, 4 skipped, ~5.4s runtime |
| Frontend stores | Done | 2026-03-11 | **26/28 (93%)** — missing: `browser-history`, `downloads` |
| Frontend libs | Done | 2026-03-11 | **24/32 (75%)** — 8 untested (see gaps below) |
| Components | Done | 2026-03-11 | **~71/88 (81%)** — 11 components without dedicated tests |
| Rust backend | Done | 2026-03-11 | **309 tests across 39 files** — strong in services/logic |
| Rust commands layer | **Gap** | 2026-03-11 | Most `commands/*.rs` files have NO tests |

**Testing approach:** Source-inspection pattern (read `.svelte.js` as text, assert on structure). Only plain `.js` files get direct import tests. Framework: `node:test`.

**Priority gaps:**

| Priority | Module | Why |
|----------|--------|-----|
| P1 | `browser-history.svelte.js` | Heavily used in Lens, no tests |
| P1 | `downloads.svelte.js` | Download tracking, no tests |
| P2 | `voice-adapters.js` | Voice pipeline; runtime failures are silent |
| P2 | `providers.js` | Provider definitions; affects AI backend list |
| P2 | `file-icons.js`, `smart-position.js` | Real logic, no tests |
| P3 | `commands/lsp.rs` | 7 Tauri commands, zero tests — LSP bridge |
| P3 | `commands/ai.rs` | AI provider orchestration, no tests |
| P3 | `commands/config.rs`, `commands/lens.rs` | Config + browser bridge commands |
| P4 | `orb-presets.js`, `avatar-presets.js` | Static config, low risk |
| P4 | BrowserMenu, DownloadsPanel, HistoryPanel | UI-only, lower blast radius |

### 3.4 Error Handling

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Global error handlers | Clean | 2026-03-11 | `window.onerror` + `unhandledrejection` in `main.js` — comprehensive |
| API layer (`api.js`) | Clean | 2026-03-11 | 140+ thin invoke wrappers, errors bubble to callers — by design |
| Store error handling | Clean | 2026-03-11 | All async store operations have try/catch |
| Event listener callbacks | Low risk | 2026-03-11 | No try/catch but global handlers catch bubbled errors |
| Silent catch blocks | Clean | 2026-03-11 | 14 in `editor-lsp.svelte.js` — intentional best-effort LSP operations |
| `.then()` without `.catch()` | Clean | 2026-03-11 | None found |
| `todo!()` / `unimplemented!()` | Clean | 2026-03-11 | None found in production code |
| Rust `.unwrap()` | **MEDIUM** | 2026-03-11 | ~15 risky in production paths (see below) |
| Rust `.expect()` | Low | 2026-03-11 | ~6 in production — mostly startup/infallible contexts |

**Risky `.unwrap()` calls (could panic in production):**

| File | Count | Context | Risk |
|------|-------|---------|------|
| `commands/lens.rs` | 10 | `state.tabs.lock().unwrap()` / `state.downloads.lock().unwrap()` | **MEDIUM** — poisoned mutex cascades |
| `voice/tts/kokoro_impl.rs` | 4 | `self.voice.lock().unwrap()` / `self.session.lock().unwrap()` | **MEDIUM** — ONNX panic poisons session |
| `mcp/handlers/n8n.rs` | 3 | Chained `.unwrap()` on external n8n API JSON responses | **MEDIUM** — API format change = crash |
| `commands/screenshot.rs` | 3 | `.expect()` on image encoding | Low — unlikely but corrupt bitmap = panic |

**Action items:**
- [x] Convert `lens.rs` mutex unwraps — 11 `.unwrap()` → `match` with `IpcResponse::err()` on poison
- [x] Convert `kokoro_impl.rs` mutex unwraps — 4 → `map_err(TtsError)` or warn+fallback
- [x] Replace `n8n.rs` chained unwraps — 5 → `.and_then()` chains with warn+continue
- [x] `screenshot.rs` `.expect()` → match with fallback on encoding failure

### 3.5 Accessibility

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| ARIA attributes | Done | 2026-03-11 | Mixed — shared components good, some custom elements missing roles |
| Keyboard navigation | Done | 2026-03-11 | Tabs excellent; search box and some panels keyboard-inaccessible |
| Focus management | **HIGH** | 2026-03-11 | No focus trapping in modals; focus not returned on menu close |
| Semantic HTML | Done | 2026-03-11 | Good landmarks (`header`, `main`, `aside`, `nav`, `footer`) |
| `aria-live` regions | **MEDIUM** | 2026-03-11 | Only Toast uses aria-live; voice/AI/LSP status changes not announced |
| Form labels | **MEDIUM** | 2026-03-11 | ChatInput textarea and SearchPanel input lack labels |
| Color contrast | Not run | — | Needs manual testing per theme |
| `prefers-reduced-motion` | Clean | 2026-03-11 | 26 files implement motion sensitivity — excellent |

**HIGH findings:**

| Issue | File | Details |
|-------|------|---------|
| No focus trapping in modals | CommandPalette, ScreenshotPicker | Tab key escapes modal overlay |
| Search box inaccessible | `App.svelte:449` | `<div onclick>` — no `role`, `tabindex`, or `onkeydown` |
| Collapsible headers inaccessible | `DevicePickerMenu.svelte:91` | `<div onclick>` with empty `onkeydown={() => {}}` |

**MEDIUM findings:**

| Issue | File | Details |
|-------|------|---------|
| `outline: none` without `:focus-visible` | Select.svelte, TextInput.svelte | Keyboard focus indicator suppressed |
| GitChangesPanel missing keyboard handler | `GitChangesPanel.svelte:27-82` | Has `role="button"` + `tabindex` but no Enter/Space |
| FileTree items lack tree semantics | `FileTreeNode.svelte` | No `role="treeitem"` or `aria-expanded` |
| ChatInput textarea lacks label | `ChatInput.svelte:203` | Only `placeholder`, no `aria-label` |
| SearchPanel input lacks label | `SearchPanel.svelte:61` | Only `placeholder`, no `aria-label` |
| No `aria-live` for status changes | voice, AI, LSP, dev server | Visual-only state indicators |
| Focus not returned on menu close | TitleBar, StatusBar menus | Focus lost to document body |
| 47 suppressed a11y warnings | Various files | `svelte-ignore a11y_no_static_element_interactions` |

**Positive patterns:**
- Tab components use proper `role="tab"` / `aria-selected` / keyboard handlers
- Toast system has complete ARIA support (`role="alert"`, `aria-live`, `role="progressbar"`)
- Shared Toggle, Slider use proper `<label>` association
- Sidebar nav items have `aria-label`
- Orb has `role="button"` + keyboard handlers
- ChatList uses `role="listbox"` / `role="option"` properly

**Action items:**
- [x] Focus trap added to CommandPalette and ScreenshotPicker modals (`role="dialog"`, `aria-modal`, Tab wrapping)
- [x] Titlebar search box keyboard-accessible (`role="button"`, `tabindex="0"`, Enter/Space handler)
- [x] `aria-label` added to ChatInput textarea and SearchPanel input
- [x] `role="treeitem"` + `aria-expanded` added to FileTreeNode directory/file buttons
- [x] `:focus-visible` outline added to Select and TextInput (keyboard focus visible, mouse clean)
- [x] `aria-live="polite"` added to provider status div for screen reader announcements

---

## 4. Performance

### 4.1 Memory Leaks

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Tauri `listen()` cleanup | **RISK** | 2026-03-11 | 16 listeners across 5 init functions never unlistened (see below) |
| `addEventListener` cleanup | Clean | 2026-03-11 | All DOM listeners properly paired with removeEventListener |
| `setInterval` cleanup | Clean | 2026-03-11 | All intervals managed (statusBar, stats, devicePreview) |
| WebView2 disposal | Clean | 2026-03-11 | LensPreview properly cleans up on destroy |
| Terminal instances | Clean | 2026-03-11 | Both Terminal + AiTerminal have thorough dispose/unlisten/ResizeObserver cleanup |
| Unbounded data structures | **RISK** | 2026-03-11 | `seenMessageIds` Set in voice store grows indefinitely |

**Tauri listener leak details (all app-lifetime singletons — low real-world impact):**

| Init Function | Listeners | File | Cleanup? |
|---------------|-----------|------|----------|
| `initAiStatusListeners()` | 6 | `ai-status.svelte.js:197-272` | No (called once from App.svelte) |
| `initVoiceListeners()` | 3 | `voice.svelte.js:199-253` | No |
| `initStartupGreeting()` | 1 | `voice-greeting.js:20` | No (becomes no-op after greeting) |
| `outputStore.startListening()` | 3 | `output.svelte.js:108-167` | No (has `listening` guard) |
| App.svelte PTT listeners | 3 | `App.svelte:222-226` | **Fragile** — inside `$effect`, unlisten discarded |

**Properly cleaned up (OK):** FileTree, FileEditor, Terminal, AiTerminal, LensPreview, StatusBar, LspTab, shortcutsStore, overlayStore, lspDiagnosticsStore, browserHistoryStore, downloadsStore, popup-utils, editor-extensions, terminal-link-overlay.

**Action items:**
- [x] Store and return unlisten functions from App.svelte PTT `$effect` — proper cleanup on re-run
- [x] Add size cap to `seenMessageIds` Set in `voice.svelte.js` — trims to 500 when exceeding 1000
- [ ] Low priority: refactor singleton init functions to return cleanup (defense-in-depth for HMR)

### 4.2 Startup Time

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Critical path analysis | Done | 2026-03-11 | Minimal sync work in `main.js`; startup well-gated by `configStore.loaded` |
| Deferred loading | **PERF** | 2026-03-11 | App.svelte eagerly imports 20+ modules including all views |
| Backend init sequence | Done | 2026-03-11 | Rust `setup()` not analyzed in detail but app starts hidden, shows after config |
| CodeMirror lazy loading | Clean | 2026-03-11 | Already uses dynamic `import()` with caching |
| ghostty-web WASM | Clean | 2026-03-11 | Properly deferred via `await init()` inside `$effect` |

**Action items:**
- [ ] Consider dynamic imports for non-default views (Settings, Terminal) in App.svelte

### 4.3 Render Performance

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| `$effect` chain analysis | Done | 2026-03-11 | StatusBar read-then-write pattern; LensPreview project detection chain (debounced) |
| Large list rendering | **PERF** | 2026-03-11 | OutputPanel (2000 entries), FileTree, ChatPanel — no virtualization |
| Terminal event fan-out | **PERF** | 2026-03-11 | All Terminal instances receive all `terminal-output` events, filter by shellId (O(n)) |

**Action items:**
- [ ] Consider virtualized list for OutputPanel (2000 entry cap)
- [ ] Consider virtualized list for ChatPanel (long conversations)
- [x] Terminal event fan-out — scoped to `terminal-output-{shellId}` per instance (Rust + frontend)

---

## 5. Architecture

### 5.1 Circular Dependencies

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| JS/Svelte import cycles | **1 found** | 2026-03-11 | `dev-server-manager → toast → status-bar → dev-server-manager` |

**The cycle:** `dev-server-manager.svelte.js` imports `toastStore` → `toast.svelte.js` imports `statusBarStore` → `status-bar.svelte.js` imports `devServerManager` → cycle.

**Action items:**
- [x] Break cycle: `statusBarStore.updateDevServer()` now accepts `serverState` param instead of importing `devServerManager`

### 5.2 API Consistency

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Tauri command return types | **4 patterns** | 2026-03-11 | Should standardize on `IpcResponse` / `Result<IpcResponse, ()>` |
| Frontend API wrappers | Done | 2026-03-11 | 130+ functions, consistent thin-wrapper pattern |
| Missing API wrappers | **~10 gaps** | 2026-03-11 | `interrupt_ai`, `stop_speaking`, `get_provider`, etc. missing from `api.js` |
| Params struct wrapping | Inconsistent | 2026-03-11 | Output commands use `{ params: {...} }`, all others use flat args |
| Null coercion | Inconsistent | 2026-03-11 | Some use `\|\| null`, others `\|\| undefined` — Tauri treats them differently |
| Store patterns | Done | 2026-03-11 | 23/24 stores use factory function pattern; `output.svelte.js` is outlier |

**Rust command return type inconsistencies:**

| Pattern | Count | Used By |
|---------|-------|---------|
| `-> IpcResponse` | ~80 | Most commands (correct pattern) |
| `-> Result<IpcResponse, ()>` | ~35 | LSP commands (acceptable for async) |
| `-> Result<IpcResponse, String>` | ~5 | Some lens commands |
| `-> Result<serde_json::Value, String>` | ~4 | Output + lens — bypasses `IpcResponse` envelope |
| `-> Result<(), String>` | ~4 | Log + channel commands |

**Action items:**
- [x] Migrate `Result<serde_json::Value, String>` commands to `IpcResponse` — `output.rs` (2 commands)
- [x] Add missing `api.js` wrappers — 14 new wrappers added
- [x] Standardize null coercion — `|| undefined` → `|| null` in `listModels`
- [ ] Refactor `output.svelte.js` to factory function pattern (low priority, cosmetic)

### 5.3 Config Schema Drift

| Item | Status | Last Run | Notes |
|------|--------|----------|-------|
| Frontend vs backend defaults | **BUG** | 2026-03-11 | `activationMode` defaults differ: `"wakeWord"` (frontend) vs `"hybrid"` (serde default_fn) |
| Missing Rust fields | **Drift** | 2026-03-11 | `browser` section, `editor.fontSize`, `editor.indentGuides` missing from Rust schema |
| Extra Rust fields | Low | 2026-03-11 | `terminal_layout` exists in Rust but not frontend defaults |
| Option vs value defaults | Low | 2026-03-11 | `devicePreview.syncEnabled` is `true` (frontend) vs `None` (Rust Option) |

**Critical drift detail:**
- `default_activation_mode()` in `schema.rs:497` returns `"hybrid"` but `Default::default()` on line 242 returns `"wakeWord"`. Partial config load (missing field) gets `"hybrid"`; full reset gets `"wakeWord"`. Frontend expects `"wakeWord"`.

**Missing from Rust `AppConfig`:**
- `browser.downloadAskLocation` / `browser.downloadPath` — entire section missing, silently round-trips as `serde_json::Value`
- `editor.fontSize` / `editor.indentGuides` — missing from `EditorConfig` struct
- `voice.sttModel` — present in frontend, absent in Rust

**Action items:**
- [x] **Fix `default_activation_mode()`** — changed `"hybrid"` to `"wakeWord"` (was latent bug)
- [x] Add `BrowserConfig` struct to Rust schema with `downloadAskLocation` and `downloadPath`
- [x] Add `fontSize` and `indentGuides` to Rust `EditorConfig`
- [x] Reconcile `devicePreview` — `sync_enabled` now `bool` with `default_true` (was `Option<bool>`)

---

## Run Schedule

| Audit | Frequency | Trigger |
|-------|-----------|---------|
| Dependency vulnerabilities | Weekly / before release | `npm audit`, `cargo audit` |
| Secret scanning | Before any push to public | Manual or CI hook |
| License audit | Monthly / new dependency added | `npx license-checker` |
| Dead code | Monthly | Manual |
| Test coverage | After major features | Manual |
| IPC surface review | After adding Tauri commands | Manual |
| Config schema drift | After config changes | Manual |
| Bundle size | Before releases | Build analysis |
| Memory leaks | After UI component changes | Manual testing |
