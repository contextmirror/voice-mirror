# Python Dev Server Detection

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Extend `dev_server.rs` detection engine to support Python web frameworks

## Problem

The dev server detection engine only recognizes Node.js projects (package.json scripts, vite.config, tauri.conf.json). Python web apps like Agent Zero (Flask + Uvicorn on port 5000) go undetected, requiring manual server startup. This limits Voice Mirror's vision as a universal dev environment.

## Solution

Add Python project detection as step 5 in the existing `detect_dev_servers()` pipeline. Reuse the same `DetectedDevServer` struct, same Tauri command, same frontend flow.

One small frontend fix is needed: preserve `start_command` across server restarts (see "Prerequisite Fix" section).

## Detection Pipeline

After existing Node.js steps (1: tauri.conf.json, 2: vite.config, 3: .env, 4: package.json), add:

**Step 5 — Python project detection:**
1. Confirm Python project by presence of `requirements.txt`, `pyproject.toml`, or `Pipfile`
2. Parse dependency file to identify framework
3. Locate entry file using framework-specific conventions
4. Extract port from entry file source, .env vars, or framework default
5. Detect virtual environment and build start command with venv python path

Existing `seen_ports` dedup ensures Python servers don't clash with Node.js detections.

## Supported Frameworks

Detection priority order (first match in deps wins):

| Framework | Dep Marker | Entry File Candidates | Default Port | Start Command |
|-----------|-----------|----------------------|-------------|---------------|
| Django | `django` | `manage.py` | 8000 | `python manage.py runserver` |
| Flask | `flask` | `app.py`, `run_ui.py`, `server.py`, `wsgi.py` | 5000 | `python {entry}` or `flask run` |
| FastAPI | `fastapi` or `uvicorn` | `main.py`, `app.py`, `server.py` | 8000 | `uvicorn {module}:app --port {port}` |
| Streamlit | `streamlit` | `app.py`, `main.py`, `streamlit_app.py` | 8501 | `streamlit run {entry}` |
| Gradio | `gradio` | `app.py`, `main.py`, `demo.py` | 7860 | `python {entry}` |
| Generic Python | none of above | `run_ui.py`, `server.py`, `app.py`, `main.py` | 8000 | `python {entry}` |

Generic Python is the fallback — if a Python project has no recognized framework but has a conventional entry file, detect it anyway.

Note: Django and FastAPI both default to port 8000, but since detection stops at first framework match, only one will be detected per project.

## Port Extraction

Three-layer detection, first match wins:

### Layer 1 — Entry file source parsing

Regex scan the detected entry file for:
- `port = 5000` or `port=5000`
- `"port": 5000` (JSON-style config)
- `.run(port=8080)` (Flask pattern)
- `--port 8080` in uvicorn/streamlit invocations
- `os.environ.get("PORT", "5000")` — extract the default value

### Layer 2 — .env file scanning (new function)

A new `extract_python_port_from_env()` function (NOT extending the existing `extract_port_from_env()`) scans `.env` and `.env.local` for Python-specific variables:
- `FLASK_RUN_PORT`
- `UVICORN_PORT`
- `WEB_UI_PORT` (Agent Zero convention)
- `DJANGO_PORT`
- `GRADIO_SERVER_PORT`
- `STREAMLIT_SERVER_PORT`

This is a separate function because the existing `extract_port_from_env()` creates `DetectedDevServer` entries hardcoded with `framework: "Vite"`. Python-specific vars must only be consumed by the Python detection path.

Note: generic `PORT` is already handled by the existing Node.js `.env` detection in step 3.

### Layer 3 — Framework default

Fall back to the default port from the framework table above.

## Virtual Environment Detection

Instead of shell-dependent activation commands (which vary between cmd.exe, PowerShell, and bash), use the venv's Python/tool executable directly. This works regardless of shell type.

Detection order (first match wins):

| Venv Type | Marker | Python path (Windows) | Python path (Unix) |
|-----------|--------|----------------------|-------------------|
| venv/virtualenv | `.venv/` dir | `.venv\Scripts\python.exe` | `.venv/bin/python` |
| venv (alt) | `venv/` dir | `venv\Scripts\python.exe` | `venv/bin/python` |
| Conda | `environment.yml` | `conda run -n {envname}` prefix | `conda run -n {envname}` prefix |
| Pipenv | `Pipfile` present | `pipenv run` prefix | `pipenv run` prefix |
| None | — | bare `python` | bare `python` |

### Conda environment name

Read the `name:` field from `environment.yml` to get the conda env name. If `environment.yml` doesn't exist but `.conda/` does, fall back to using the project directory name as the env name.

### Start command construction

For venv/virtualenv, replace `python` and tool names with the venv path:

**Windows examples:**
- `.venv\Scripts\python.exe run_ui.py` (Flask with .venv)
- `.venv\Scripts\uvicorn.exe main:app --port 8000` (FastAPI with .venv)
- `.venv\Scripts\streamlit.exe run app.py` (Streamlit with .venv)

**Unix examples:**
- `.venv/bin/python run_ui.py` (Flask with .venv)
- `.venv/bin/uvicorn main:app --port 8000` (FastAPI with .venv)

**Conda/Pipenv examples (cross-platform):**
- `conda run -n myenv python run_ui.py`
- `pipenv run python run_ui.py`
- `pipenv run streamlit run app.py`

**No venv:**
- `python manage.py runserver` (bare system Python)

Platform detection uses existing `cfg!(target_os = "windows")` pattern already in the codebase.

## Dependency File Parsing

### requirements.txt
Line-by-line scan for package names. Handle:
- `flask==2.0.0` → `flask`
- `flask>=2.0` → `flask`
- `Flask` → normalize to lowercase
- `-r other.txt` lines → skip (don't recurse)
- Comments and blank lines → skip

### pyproject.toml
Two formats to handle:

**PEP 621** (`[project.dependencies]`): Uses TOML array syntax that may span multiple lines:
```toml
[project]
dependencies = [
    "flask>=2.0",
    "uvicorn",
]
```
Parser must track opening `[` and closing `]` brackets to handle multi-line arrays. Extract quoted package names within the array.

**Poetry** (`[tool.poetry.dependencies]`): Key-value per line:
```toml
[tool.poetry.dependencies]
flask = "^2.0"
```
Simpler — take the key from each line under the section header.

Also check `[project.scripts]` for explicit entry point commands that override default entry file detection.

### Pipfile
Scan `[packages]` section for dependency names (key-value format, same as Poetry).

## Prerequisite Fix: restartServer start_command preservation

**Bug:** `restartServer()` in `dev-server-manager.svelte.js` (line 420-440) only preserves `url`, `port`, and `framework` when reconstructing `serverConfig` for restart. The `start_command` field is lost, and `startServer()` falls back to `npm run dev` (line 259). For Node.js projects this happens to work; for Python projects it would run `npm run dev` in a Python project directory.

**Fix:** Add `startCommand` to the `ServerState` typedef and populate it in `startServer()`. Update `restartServer()` to include it in `serverConfig`:

```javascript
// In restartServer():
const serverConfig = {
    url: state.url,
    port: state.port,
    framework: state.framework,
    start_command: state.startCommand,  // preserve original command
};
```

Also update `startServer()` to store it:
```javascript
updateState(projectPath, {
    status: 'starting',
    port: server.port,
    framework: server.framework || null,
    url: server.url,
    startCommand: server.start_command || null,  // new field
    lastActiveTime: Date.now(),
});
```

This is a small frontend change (~4 lines) but is required for Python server restarts to work.

## What Stays Unchanged

- **`DetectedDevServer` struct** — all fields map naturally to Python projects
- **`detect_dev_servers` Tauri command** — no signature changes
- **Frontend** — LensPreview, ServersTab, StatusDropdown all work as-is (only `devServerManager` gets the small `startCommand` preservation fix above)
- **`detect_package_manager()`** — returns "npm" for Python projects (harmless; `start_command` is self-contained and the npm-prefix logic in `startServer()` only triggers for `npm run` commands)
- **Port probing & kill** — `is_port_listening()` and `kill_port_process()` work for any TCP server

## File Changes

### Rust: `src-tauri/src/services/dev_server.rs`

New functions:
- `detect_python_servers(root: &Path, seen_ports: &mut HashSet<u16>) -> Vec<DetectedDevServer>`
- `detect_python_venv(root: &Path) -> String` — returns venv python/tool path prefix
- `parse_python_deps(root: &Path) -> Option<Vec<String>>` — normalized dep names from requirements.txt, pyproject.toml, or Pipfile
- `identify_python_framework(deps: &[String], root: &Path) -> Option<PythonFramework>`
- `extract_python_port(entry_path: &Path, root: &Path, default: u16) -> u16` — scans entry file + .env for port
- `extract_python_port_from_env(root: &Path) -> Option<u16>` — Python-specific .env var scanning (separate from existing `extract_port_from_env`)
- `read_conda_env_name(root: &Path) -> Option<String>` — reads `name:` from environment.yml

Internal struct (not serialized):
```rust
struct PythonFramework {
    name: &'static str,
    entry_candidates: &'static [&'static str],
    default_port: u16,
    make_command: fn(entry: &str, port: u16, venv_prefix: &str) -> String,
}
```

Extend existing:
- `detect_dev_servers()` — add step 5 calling `detect_python_servers()`

### Frontend: `src/lib/stores/dev-server-manager.svelte.js`

- Add `startCommand: null` to `ServerState` typedef and `getOrCreateState()` default
- Store `start_command` in `startServer()` via `updateState()`
- Include `start_command` in `restartServer()` serverConfig

## Testing

Unit tests for all new functions:
- `test_parse_requirements_txt` — various pip format lines (versioned, extras, comments, `-r` lines)
- `test_parse_pyproject_toml_pep621` — single-line and multi-line array formats
- `test_parse_pyproject_toml_poetry` — key-value dependency format
- `test_parse_pipfile` — packages section parsing
- `test_identify_framework_flask`, `_django`, `_fastapi`, `_streamlit`, `_gradio`
- `test_identify_framework_priority` — Django wins over Flask when both present
- `test_identify_framework_generic_fallback` — no framework deps but entry file exists
- `test_extract_python_port_from_source` — all regex patterns
- `test_extract_python_port_from_env` — all Python-specific vars
- `test_extract_python_port_default` — framework default when no port found
- `test_detect_python_venv_dot_venv`, `_venv`, `_conda`, `_pipenv`, `_none`
- `test_detect_python_venv_platform` — Windows vs Unix path construction
- `test_read_conda_env_name` — parses environment.yml name field
- `test_detect_python_servers_integration` — end-to-end with temp dir
- `test_python_port_dedup_with_node` — Python server skipped when Node already claimed port

## Agent Zero Specific

With this detection, Agent Zero at `E:\Projects\references\Agent Zero` would produce:

```json
{
  "framework": "Flask",
  "port": 5000,
  "url": "http://localhost:5000",
  "start_command": ".venv\\Scripts\\python.exe run_ui.py",
  "source": "requirements.txt",
  "running": false
}
```

If `.env` contains `WEB_UI_PORT=5555`, port would be 5555 instead. If no `.venv/` directory exists, the command would be `python run_ui.py`.
