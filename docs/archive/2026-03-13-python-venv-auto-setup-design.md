# Python Venv Auto-Setup

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Detect missing Python virtual environments and offer one-click setup before starting dev servers

## Problem

When Voice Mirror detects a Python project (Flask, Django, etc.) and offers to start the dev server, the start command uses bare `python` if no venv exists. This fails with `ModuleNotFoundError` because system Python lacks the project's dependencies. The user sees a cryptic error in the terminal with no guidance on how to fix it.

## Solution

Extend the Rust detection pipeline to flag Python projects that need environment setup. When no venv exists but a dependency file is found, include `needsSetup: true` and a `setupCommands` array in the detection response. The frontend shows a different toast ("Set up & start?") and runs the setup commands in the terminal before the start command.

After setup completes once, the venv exists on disk. Subsequent detections find the venv normally and skip the setup flow entirely.

## Rust Backend Changes

### DetectedDevServer struct

Add two new fields with `#[serde(default)]` so existing Node.js construction sites don't need changes:

```rust
pub struct DetectedDevServer {
    pub framework: String,
    pub port: u16,
    pub url: String,
    pub start_command: String,
    pub source: String,
    pub running: bool,
    #[serde(default)]
    pub needs_setup: bool,           // NEW: defaults to false
    #[serde(default)]
    pub setup_commands: Vec<String>,  // NEW: defaults to empty vec
}
```

`#[serde(default)]` means `needs_setup` defaults to `false` and `setup_commands` defaults to `[]` during deserialization. For struct construction, use `..Default::default()` on existing Node.js sites or add a constructor. Only the Python detection site needs to set these explicitly.

Serde `rename_all = "camelCase"` applies — frontend receives `needsSetup` and `setupCommands`.

### Detection logic in `detect_python_servers()`

After calling `detect_python_venv(root)`:

**If venv prefix is non-empty** (venv exists):
- `needs_setup = false`
- `setup_commands = vec![]`
- `start_command` uses venv prefix as today — no changes

**If venv prefix is empty** (no venv) AND a dependency file exists:
- `needs_setup = true`
- Build `setup_commands` based on dependency file source and platform
- Build `start_command` WITH `.venv` prefix (anticipating that setup will create it)

### Setup commands by dependency file

**requirements.txt:**
```
# Windows:
["python -m venv .venv", ".venv\\Scripts\\pip install --prefer-binary -r requirements.txt"]

# Unix:
["python3 -m venv .venv", ".venv/bin/pip install --prefer-binary -r requirements.txt"]
```

**pyproject.toml:**
```
# Windows:
["python -m venv .venv", ".venv\\Scripts\\pip install --prefer-binary -e ."]

# Unix:
["python3 -m venv .venv", ".venv/bin/pip install --prefer-binary -e ."]
```

**Pipfile:** No setup commands — Pipenv manages its own venv. `needs_setup` stays `false` for Pipfile-only projects (Pipenv's `pipenv run` prefix is used instead).

### Platform detection

Use existing `cfg!(target_os = "windows")` pattern already in the codebase:
- Windows: `python`, `.venv\Scripts\pip`, `.venv\Scripts\python.exe`
- Unix: `python3`, `.venv/bin/pip`, `.venv/bin/python`

### Start command when needs_setup is true

When `needs_setup = true`, the `start_command` must be built with the `.venv` prefix that will exist after setup completes. This means `detect_python_servers()` should call `build_python_start_command()` with a hardcoded `.venv` prefix rather than the empty string from `detect_python_venv()`.

Example for Agent Zero (Flask, Windows, no venv yet):
```json
{
  "framework": "Flask",
  "port": 5000,
  "url": "http://localhost:5000",
  "startCommand": ".venv\\Scripts\\python.exe run_ui.py",
  "source": "requirements.txt",
  "running": false,
  "needsSetup": true,
  "setupCommands": [
    "python -m venv .venv",
    ".venv\\Scripts\\pip install --prefer-binary -r requirements.txt"
  ]
}
```

### Node.js projects

For non-Python detections, both fields default to `false` / `[]`. No behavior change for Node.js projects.

## Frontend Changes

### LensPreview.svelte — Toast flow

In `detectAndNavigate()`, when showing the toast for a stopped server:

**If `stoppedServer.needsSetup === false`** — unchanged behavior:
- Message: "Flask on :5000 is not running. Start it?"
- Actions: [Always start] [Start once] [Not now]

**If `stoppedServer.needsSetup === true`** — setup toast:
- Message: "Flask detected but no virtual environment. Set up & start?"
- Actions: [Set up & start] [Not now]
- No "Always start" — setup is one-time. After venv exists, subsequent detections see `needsSetup = false` and show the normal toast with "Always start" available.

**"Set up & start" callback:**
```javascript
devServerManager.startServer(stoppedServer, project.path, packageManager);
```

Same call as "Start once" — `startServer()` handles the setup commands internally.

### dev-server-manager.svelte.js — startServer()

After spawning the PTY and before sending the start command (line ~268):

```javascript
// Chain setup commands with start command using && so the shell
// handles sequencing. terminalInput() is fire-and-forget (sends to
// PTY stdin, returns immediately), so we CANNOT send commands one
// at a time — they'd pile up before the previous command finishes.
if (server.setupCommands && server.setupCommands.length > 0) {
    const fullCommand = [...server.setupCommands, startCommand].join(' && ');
    await terminalInput(shellId, fullCommand + '\n');
} else {
    await terminalInput(shellId, startCommand + '\n');
}
```

The `&&` chaining means:
- Each command only runs if the previous succeeded (fail-fast)
- The shell handles sequencing — no timing issues
- All output streams live to the terminal tab
- If `pip install` fails, the start command is skipped — the user sees the pip error clearly

The existing port polling (500ms for 30s) still applies. The poll timeout may be insufficient for setup flows since pip install can take minutes, but the current behavior (show "didn't start — check terminal" warning on timeout) is acceptable for v1 — the server will eventually start and the user can see progress in the terminal.

### ServerState — no changes needed

`setupCommands` is only needed during the initial `startServer()` call. It doesn't need to be persisted in `ServerState` because:
- `restartServer()` rebuilds `serverConfig` from state — by restart time, the venv already exists
- Detection on next project switch will return `needsSetup = false`

## Known Limitations (v1)

- **`python` may not be available on PATH** — On some Windows systems (Microsoft Store Python), `python` opens the Store. The `python -m venv` command will fail. Users must install Python properly. Future: detect `py -3` launcher as fallback.
- **pip install timeout** — Port polling times out after 30s, but pip install can take minutes. The "didn't start" warning will show, but the terminal keeps running and the server eventually starts. Future: reset poll timer when terminal output is active.
- **Empty `pyproject.toml`** — If `pyproject.toml` exists with no dependencies, detection still offers setup. The venv creation and `pip install -e .` will succeed but install nothing useful. Low impact.

## What Stays Unchanged

- **`detect_python_venv()`** — still returns empty string when no venv. Used by `detect_python_servers()` to decide `needs_setup`.
- **`build_python_start_command()`** — no changes. Called with `.venv` prefix when setup is needed.
- **Node.js detection pipeline** — steps 1-4 unaffected. `needs_setup` defaults to `false`.
- **Port polling, crash detection, LRU eviction** — all unchanged.
- **`restartServer()`** — works as-is. Only called after server has been started (venv exists).
- **Auto-start consent flag** — `autoStartServer` works correctly. After venv setup, next detection returns `needsSetup = false`, auto-start flows normally.

## File Changes

### Rust: `src-tauri/src/services/dev_server.rs`

- Add `needs_setup: bool` and `setup_commands: Vec<String>` to `DetectedDevServer` with `#[serde(default)]`
- Derive `Default` for `DetectedDevServer` (or add `..Default::default()` to existing construction sites)
- In `detect_python_servers()`: after `detect_python_venv()`, set `needs_setup` and build `setup_commands` when prefix is empty
- When `needs_setup = true`, pass hardcoded `.venv` prefix to `build_python_start_command()`
- Non-Python construction sites remain unchanged (default values apply)

### Frontend: `src/components/lens/LensPreview.svelte`

- In toast creation block: check `stoppedServer.needsSetup`
- If true: show "Set up & start?" toast with 2 actions
- If false: existing 3-action toast unchanged

### Frontend: `src/lib/stores/dev-server-manager.svelte.js`

- In `startServer()`: before sending start command, iterate `server.setupCommands` and send each to terminal

## Testing

### Rust unit tests

- `test_detect_python_needs_setup_no_venv` — project with requirements.txt but no .venv → `needs_setup = true`, correct setup_commands
- `test_detect_python_no_setup_with_venv` — project with requirements.txt AND .venv → `needs_setup = false`, empty setup_commands
- `test_setup_commands_requirements_txt` — correct pip install command for requirements.txt
- `test_setup_commands_pyproject_toml` — correct pip install command for pyproject.toml
- `test_setup_commands_pipfile_skipped` — Pipfile-only project → `needs_setup = false`
- `test_setup_start_command_uses_venv_prefix` — when `needs_setup = true`, `start_command` uses `.venv` prefix (not bare python)
- `test_setup_commands_platform` — Windows vs Unix path construction
- `test_node_projects_no_setup` — Node.js detections have `needs_setup = false`

### Frontend source-inspection tests

- `test_toast_checks_needsSetup` — LensPreview source contains `needsSetup` check
- `test_startServer_sends_setupCommands` — dev-server-manager iterates `setupCommands` before start command
