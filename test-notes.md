# Test Notes

## Tier-3 Phase 1 — drive native (non-CDP) apps via UI Automation

**Status: RUNTIME-VALIDATED ✅** (2026-06-28)

The tier-3 UIA backend (`src-tauri/src/services/uia.rs`, commit `19eb5dee`) was shipped
with the caveat *"UIA's cross-process COM is untested at runtime."* It has now been tested
live, end to end, through the real MCP tools (`capture_list_windows` → `sandbox_snapshot` →
`sandbox_click` / `sandbox_type` → `sandbox_screenshot`). Everything passed; nothing needed
a tweak.

### Calculator (modern UWP → InvokePattern) — PASS
- `capture_list_windows` filtered to "Calculator" → hwnd resolved via `ApplicationFrameHost`
  (the hosted-UWP case; the app's own `MainWindowHandle` is 0).
- `sandbox_snapshot {hwnd}` → 37 interactive refs, `@ref` tree byte-identical to the CDP path
  (`button "One" @e25`, `"Plus" @e22`, `"Two" @e26`, `"Equals" @e23`, `content "Display is 0" @e7`).
- `sandbox_click` ×4 (One, Plus, Two, Equals) → every call returned `{"method":"invoke","ok":true}`
  — pure UIA InvokePattern, no SendInput fallback, no focus-stealing.
- `sandbox_screenshot` → WGC mirror of the native window; display shows **1 + 2 = 3**.

### Notepad (Windows 11 RichEdit → ValuePattern) — PASS (all 3 sub-paths)
- `sandbox_snapshot {hwnd}` → `textbox "Text editor" @e1` (the document control) found.
- `sandbox_type {@e1, "Hello from UIA"}` → `{"method":"value","ok":true}`. `ValuePattern.SetValue`
  worked on the new RichEdit Notepad — better than expected; the unicode-keystroke `sendinput`
  fallback never had to fire.
- `sandbox_snapshot {window: "Notepad"}` (by title, **no hwnd**) → title→hwnd resolution through
  `decide_sandbox_route` succeeded; re-snapshotted the correct window with the typed text reflected
  (`content "14 characters"`, title `*Hello from UIA - Notepad`).

### What this clears
The genuinely-risky parts that were untested-until-now are all confirmed working live:
- the COM/MTA worker thread (`CoInitializeEx(MULTITHREADED)` + one long-lived `IUIAutomation`),
- cross-process pattern calls — both `Invoke` and `Value`,
- the by-title native-window routing path in `decide_sandbox_route`.

**Conclusion:** Claude can now drive any Windows app that exposes an accessibility tree.
Only pure-canvas apps (Flutter / games) remain → the Phase 2 vision.

## Tier-3 — third-party Electron app via CDP (VS Code) — PASS

**Status: RUNTIME-VALIDATED ✅** (2026-06-28)

Validated the CDP-attach path against an external Electron app (not Voice Mirror's own
WebView) — VS Code 1.125.1 (Electron 42.2.0, Chrome 148).

- No VS Code was running, so it was launched with `--remote-debugging-port=9333 --new-window`.
  CDP endpoint came up clean (`/json/version` returned the browser WebSocket URL).
- `sandbox_attach {port: 9333}` → attached and opened the live App Preview. **Resolved target
  was the VS Code window**, not Voice Mirror — confirmed by URL
  (`vscode-file://vscode-app/.../workbench.html`), correctly distinguishing the two Electron apps.
- `sandbox_snapshot {port: 9333}` → real `@ref` tree of the VS Code workbench, **51 interactive
  refs** (menu bar, activity-bar tabs Explorer/Search/Source Control/Run/Extensions, Welcome-page
  buttons, status bar). Not a generic/empty tree — genuine VS Code UI.
- `sandbox_screenshot` → live view of the Welcome page at true window size.
- Safe click: `sandbox_click {@e25}` (Search tab in the activity bar) → `{"method":"mouse","ok":true}`.
  Follow-up screenshot confirmed the **Search panel opened** in the sidebar (Search/Replace inputs,
  "You have not opened or specified a folder" notice). UI responded as expected.
- No files were opened or modified — interaction stayed on the Welcome/Search chrome.

**Conclusion:** the sandbox CDP path drives arbitrary third-party Electron apps, not just
Voice Mirror's own webview, and correctly resolves the right window when multiple CDP apps exist.

## Tier-3 — native terminal (Windows Terminal) via UIA — PARTIAL (read ✅ / type ⚠️)

**Status: RUNTIME-VALIDATED ✅ read, GAP FOUND ⚠️ type** (2026-06-28)

Attached to a live **Windows Terminal** window (`WindowsTerminal.exe`) running a Claude Code
session, snapshotted by `hwnd` (UIA route).

### Read — PASS
- `capture_list_windows {filter: "cdp"}` → resolved the window + hwnd.
- `sandbox_snapshot {hwnd}` → 12 refs, all **window chrome**: the tab, Close Tab, scrollbar
  buttons, System/Minimise/Maximise/Close, and a single `listbox "" @e1` that IS the text buffer
  (plus `content "C:\Windows\System32\cmd.exe"` = the running shell). No per-line / per-word refs —
  a terminal is one text grid, not a button layout, so there's nothing meaningful to click inside it.
- `sandbox_screenshot` → WGC mirror captured the **entire terminal buffer crisply** (every line,
  the status bar, tab title). Cross-process, no focus needed. Reading a terminal works great.

### Type — DOES NOT WORK (and it is NOT a focus bug)
- The terminal text grid exposes **no `ValuePattern`** (unlike Notepad's edit control or a
  Calculator button's `InvokePattern`), so `sandbox_type` falls back to Unicode **`SendInput`**
  (synthetic `VK_PACKET` key events).
- Tested across multiple attempts, escalating focus each time:
  1. background window → `ok:true`, prompt stayed empty.
  2. programmatic `SetForegroundWindow` (confirmed `GetForegroundWindow == target`) → still empty.
  3. PowerShell `SendKeys` (scan-code path, different mechanism) → still empty. (NOTE: the agent's
     own shell tool is sandboxed in an isolated window station, so its focus/SendKeys calls may not
     reach the real desktop — this attempt is inconclusive on its own.)
  4. **User manually clicked the terminal to give it genuine real-desktop focus** → `sandbox_type`
     STILL did not land. This is the decisive test: focus was real, and it still failed.
- Root cause (corrected — earlier "just needs focus" guess was WRONG): **Windows Terminal pulls
  input through ConPTY and ignores injected/synthetic Unicode key events** (they carry the
  injected flag and bypass its normal keyboard path). So `SendInput` keystrokes are emitted but
  the terminal drops them, regardless of focus.
- **The masking bug remains:** `sandbox_type` returns `ok:true` even though nothing was delivered.
  The success flag does NOT guarantee delivery on the `sendinput` path.

### Fix candidates
1. To actually drive a terminal, bypass `SendInput`: write at the **ConPTY** level or use
   `WriteConsoleInput` against the hosted console — not synthetic keyboard events.
2. Make `sandbox_type` distinguish the `sendinput` path (e.g. `method:"sendinput", verified:false`)
   so callers screenshot-verify instead of trusting `ok:true`.

**Conclusion:** terminals are fully **readable** via UIA+WGC, but **NOT writable** through the
current `sandbox_type` path — Windows Terminal ignores injected keystrokes even with real focus.
Driving a terminal needs a ConPTY/`WriteConsoleInput` write path, not `SendInput`. And the tool's
false-positive `ok:true` on the sendinput path should be fixed so voice-driven typing can't
silently no-op.
