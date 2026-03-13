# Python Dev Server Detection — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the dev server detection engine to recognize Python web projects (Flask, FastAPI, Django, Streamlit, Gradio) with venv-aware start commands.

**Architecture:** Add Python detection as step 5 in the existing `detect_dev_servers()` pipeline in `dev_server.rs`. Reuse the same `DetectedDevServer` struct and Tauri command — only one frontend fix needed (preserving `start_command` on restart).

**Tech Stack:** Rust (backend detection), JavaScript (frontend store fix), regex for parsing

**Spec:** `docs/superpowers/specs/2026-03-13-python-dev-server-detection-design.md`

---

## Chunk 1: Prerequisite Fix + Dependency Parsing

### Task 1: Fix restartServer start_command preservation (frontend)

**Files:**
- Modify: `src/lib/stores/dev-server-manager.svelte.js:54-65` (ServerState default)
- Modify: `src/lib/stores/dev-server-manager.svelte.js:204-211` (startServer updateState)
- Modify: `src/lib/stores/dev-server-manager.svelte.js:420-439` (restartServer)
- Test: `test/stores/dev-server-manager.test.cjs`

- [ ] **Step 1: Write failing tests for startCommand preservation**

Add to `test/stores/dev-server-manager.test.cjs`:

```javascript
describe('dev-server-manager.svelte.js -- startCommand preservation', () => {
  it('ServerState includes startCommand field in default', () => {
    assert.ok(src.includes('startCommand: null'), 'getOrCreateState should initialize startCommand: null');
  });

  it('startServer stores startCommand in state', () => {
    assert.ok(
      src.includes('startCommand: server.start_command'),
      'startServer should store start_command in state'
    );
  });

  it('restartServer includes start_command in serverConfig', () => {
    assert.ok(
      src.includes('start_command: state.startCommand'),
      'restartServer should include start_command from state'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "startCommand" 2>&1 | tail -20`
Expected: 3 FAIL

- [ ] **Step 3: Add startCommand to ServerState default**

In `src/lib/stores/dev-server-manager.svelte.js`, in `getOrCreateState()` (line 54-65), add `startCommand: null` to the default state object:

```javascript
      servers.set(projectPath, {
        status: 'stopped',
        shellId: null,
        port: null,
        framework: null,
        url: null,
        startCommand: null,
        crashCount: 0,
        lastCrashTime: null,
        lastActiveTime: Date.now(),
        crashLoopDetected: false,
        outputChannel: null,
      });
```

- [ ] **Step 4: Store start_command in startServer**

In `startServer()` (line 204-211), add `startCommand` to the first `updateState` call:

```javascript
    updateState(projectPath, {
      status: 'starting',
      port: server.port,
      framework: server.framework || null,
      url: server.url,
      startCommand: server.start_command || null,
      lastActiveTime: Date.now(),
    });
```

- [ ] **Step 5: Include start_command in restartServer serverConfig**

In `restartServer()` (line 424-429), add `start_command` to `serverConfig`:

```javascript
    const serverConfig = {
      url: state.url,
      port: state.port,
      framework: state.framework,
      start_command: state.startCommand,
    };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: All pass, 0 fail

- [ ] **Step 7: Commit**

```bash
git add src/lib/stores/dev-server-manager.svelte.js test/stores/dev-server-manager.test.cjs
git commit -m "fix(dev-server): preserve start_command across server restarts"
```

---

### Task 2: Python dependency file parsing — requirements.txt

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs` (add `parse_requirements_txt` function)

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block in `dev_server.rs`:

```rust
    #[test]
    fn test_parse_requirements_txt_basic() {
        let content = "flask==2.0.0\nuvicorn>=0.18\nrequests\n";
        let deps = parse_requirements_txt(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
        assert!(deps.contains(&"requests".to_string()));
    }

    #[test]
    fn test_parse_requirements_txt_extras_and_comments() {
        let content = "# comment\nFlask[async]>=2.0\n-r other.txt\n\nDjango>=4.0  # inline comment\n";
        let deps = parse_requirements_txt(content);
        assert!(deps.contains(&"flask".to_string()), "Should lowercase");
        assert!(deps.contains(&"django".to_string()));
        assert!(!deps.iter().any(|d| d.contains("-r")), "Should skip -r lines");
        assert_eq!(deps.len(), 2);
    }

    #[test]
    fn test_parse_requirements_txt_empty() {
        let deps = parse_requirements_txt("");
        assert!(deps.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib parse_requirements_txt 2>&1 | tail -10`
Expected: FAIL — `parse_requirements_txt` not found

- [ ] **Step 3: Implement parse_requirements_txt**

Add above the tests section (before `// ---------------------------------------------------------------------------` / `// Tests`) in `dev_server.rs`:

```rust
// ---------------------------------------------------------------------------
// Python detection helpers
// ---------------------------------------------------------------------------

/// Parse requirements.txt content and return normalized (lowercased) package names.
fn parse_requirements_txt(content: &str) -> Vec<String> {
    static PKG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)").unwrap()
    });

    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            // Skip comments, blank lines, -r/-c/--flags, URLs, paths
            if trimmed.is_empty()
                || trimmed.starts_with('#')
                || trimmed.starts_with('-')
                || trimmed.starts_with("http")
                || trimmed.starts_with('/')
                || trimmed.starts_with('.')
            {
                return None;
            }
            // Remove inline comments
            let before_comment = trimmed.split('#').next().unwrap_or("").trim();
            // Remove extras like [async]
            let before_extras = before_comment.split('[').next().unwrap_or("");
            PKG_RE.captures(before_extras).map(|caps| {
                caps.get(1).unwrap().as_str().to_lowercase()
            })
        })
        .collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib parse_requirements_txt 2>&1 | tail -10`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): add requirements.txt parser for Python detection"
```

---

### Task 3: Python dependency file parsing — pyproject.toml and Pipfile

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs` (add `parse_pyproject_toml`, `parse_pipfile`, `parse_python_deps`)

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn test_parse_pyproject_toml_pep621() {
        let content = r#"
[project]
name = "myapp"
dependencies = [
    "flask>=2.0",
    "uvicorn",
]
"#;
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
    }

    #[test]
    fn test_parse_pyproject_toml_pep621_single_line() {
        let content = r#"
[project]
dependencies = ["django>=4.0", "gunicorn"]
"#;
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"django".to_string()));
        assert!(deps.contains(&"gunicorn".to_string()));
    }

    #[test]
    fn test_parse_pyproject_toml_poetry() {
        let content = r#"
[tool.poetry.dependencies]
python = "^3.12"
flask = "^2.0"
gradio = {version = "^4.0"}
"#;
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"gradio".to_string()));
        assert!(!deps.contains(&"python".to_string()), "Should skip python itself");
    }

    #[test]
    fn test_parse_pyproject_toml_scripts() {
        let content = r#"
[project.scripts]
myapp = "myapp.main:run"
"#;
        let deps = parse_pyproject_toml(content);
        // Scripts parsing deferred (TODO) — this just tests deps returns empty
        // Future: parse `myapp = "myapp.main:run"` → derive entry file `myapp/main.py`
        assert!(deps.is_empty());
    }

    #[test]
    fn test_parse_pipfile() {
        let content = r#"
[packages]
flask = "*"
uvicorn = ">=0.18"

[dev-packages]
pytest = "*"
"#;
        let deps = parse_pipfile(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
        assert!(!deps.contains(&"pytest".to_string()), "Should skip dev-packages");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib parse_pyproject 2>&1 | tail -10` and `cargo test --lib parse_pipfile 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Implement parse_pyproject_toml**

```rust
/// Parse pyproject.toml content and return normalized package names.
///
/// Handles two formats:
/// - PEP 621: `[project] dependencies = ["flask>=2.0", ...]` (may span multiple lines)
/// - Poetry: `[tool.poetry.dependencies] flask = "^2.0"` (key-value per line)
fn parse_pyproject_toml(content: &str) -> Vec<String> {
    static QUOTED_PKG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#""([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)"#).unwrap()
    });

    let mut deps = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // PEP 621: [project] section → look for dependencies = [...]
        if trimmed == "[project]" {
            i += 1;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.starts_with('[') { break; }
                if line.starts_with("dependencies") && line.contains('=') {
                    // Collect the full array (may span multiple lines)
                    let mut array_str = String::new();
                    let after_eq = line.splitn(2, '=').nth(1).unwrap_or("");
                    array_str.push_str(after_eq);
                    if !array_str.contains(']') {
                        i += 1;
                        while i < lines.len() {
                            array_str.push_str(lines[i]);
                            if lines[i].contains(']') { break; }
                            i += 1;
                        }
                    }
                    // Extract quoted package names
                    for caps in QUOTED_PKG_RE.captures_iter(&array_str) {
                        let name = caps.get(1).unwrap().as_str().to_lowercase();
                        // Strip version specifiers from inside quotes (e.g. "flask>=2.0")
                        let pkg = name.split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_' && c != '.').next().unwrap_or(&name);
                        if !pkg.is_empty() {
                            deps.push(pkg.to_string());
                        }
                    }
                }
                i += 1;
            }
            continue;
        }

        // Poetry: [tool.poetry.dependencies]
        if trimmed == "[tool.poetry.dependencies]" {
            i += 1;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.starts_with('[') { break; }
                if line.is_empty() || line.starts_with('#') {
                    i += 1;
                    continue;
                }
                if let Some(key) = line.split(|c: char| c == '=' || c.is_whitespace()).next() {
                    let name = key.trim().to_lowercase();
                    if !name.is_empty() && name != "python" {
                        deps.push(name);
                    }
                }
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    deps
}
```

- [ ] **Step 4: Implement parse_pipfile**

```rust
/// Parse Pipfile content and return normalized package names from [packages] section.
fn parse_pipfile(content: &str) -> Vec<String> {
    let mut deps = Vec::new();
    let mut in_packages = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "[packages]" {
            in_packages = true;
            continue;
        }
        if trimmed.starts_with('[') {
            in_packages = false;
            continue;
        }

        if in_packages && !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(key) = trimmed.split('=').next() {
                let name = key.trim().to_lowercase();
                if !name.is_empty() {
                    deps.push(name);
                }
            }
        }
    }

    deps
}
```

- [ ] **Step 5: Implement parse_python_deps (unified entry point)**

```rust
/// Parse Python dependency files from a project root.
/// Tries requirements.txt → pyproject.toml → Pipfile in order.
/// Returns None if no Python dependency file is found.
fn parse_python_deps(root: &Path) -> Option<Vec<String>> {
    // requirements.txt
    if let Ok(content) = std::fs::read_to_string(root.join("requirements.txt")) {
        let deps = parse_requirements_txt(&content);
        if !deps.is_empty() {
            return Some(deps);
        }
    }

    // pyproject.toml
    if let Ok(content) = std::fs::read_to_string(root.join("pyproject.toml")) {
        let deps = parse_pyproject_toml(&content);
        if !deps.is_empty() {
            return Some(deps);
        }
        // Even if deps is empty, the file exists — it's still a Python project
        // Return empty vec so caller knows it's Python
        return Some(deps);
    }

    // Pipfile
    if let Ok(content) = std::fs::read_to_string(root.join("Pipfile")) {
        let deps = parse_pipfile(&content);
        return Some(deps);
    }

    None
}
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `cargo test --lib parse_ 2>&1 | tail -15`
Expected: All 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): add pyproject.toml and Pipfile parsers for Python detection"
```

---

## Chunk 2: Framework Identification + Port Extraction

### Task 4: Python framework identification

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs`

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn test_identify_python_framework_django() {
        let deps = vec!["django".to_string(), "gunicorn".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Django");
    }

    #[test]
    fn test_identify_python_framework_flask() {
        let deps = vec!["flask".to_string(), "requests".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Flask");
    }

    #[test]
    fn test_identify_python_framework_fastapi() {
        let deps = vec!["fastapi".to_string(), "pydantic".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "FastAPI");
    }

    #[test]
    fn test_identify_python_framework_uvicorn_implies_fastapi() {
        let deps = vec!["uvicorn".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "FastAPI");
    }

    #[test]
    fn test_identify_python_framework_streamlit() {
        let deps = vec!["streamlit".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Streamlit");
    }

    #[test]
    fn test_identify_python_framework_gradio() {
        let deps = vec!["gradio".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Gradio");
    }

    #[test]
    fn test_identify_python_framework_priority_django_over_flask() {
        let deps = vec!["django".to_string(), "flask".to_string()];
        let fw = identify_python_framework(&deps);
        assert_eq!(fw.unwrap().name, "Django", "Django should win over Flask");
    }

    #[test]
    fn test_identify_python_framework_none() {
        let deps = vec!["requests".to_string(), "numpy".to_string()];
        assert!(identify_python_framework(&deps).is_none());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib identify_python_framework 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Implement framework identification**

```rust
/// A recognized Python web framework and its conventions.
struct PythonFramework {
    /// Framework display name (e.g. "Flask", "Django")
    name: &'static str,
    /// Dependency markers — if any of these appear in deps, this framework is detected
    markers: &'static [&'static str],
    /// Candidate entry files to look for, in priority order
    entry_candidates: &'static [&'static str],
    /// Default port if no port is found in source or .env
    default_port: u16,
}

/// All supported Python frameworks in detection priority order.
const PYTHON_FRAMEWORKS: &[PythonFramework] = &[
    PythonFramework {
        name: "Django",
        markers: &["django"],
        entry_candidates: &["manage.py"],
        default_port: 8000,
    },
    PythonFramework {
        name: "Flask",
        markers: &["flask"],
        entry_candidates: &["app.py", "run_ui.py", "server.py", "wsgi.py"],
        default_port: 5000,
    },
    PythonFramework {
        name: "FastAPI",
        markers: &["fastapi", "uvicorn"],
        entry_candidates: &["main.py", "app.py", "server.py"],
        default_port: 8000,
    },
    PythonFramework {
        name: "Streamlit",
        markers: &["streamlit"],
        entry_candidates: &["app.py", "main.py", "streamlit_app.py"],
        default_port: 8501,
    },
    PythonFramework {
        name: "Gradio",
        markers: &["gradio"],
        entry_candidates: &["app.py", "main.py", "demo.py"],
        default_port: 7860,
    },
];

/// Generic Python fallback entry file candidates (when no framework is identified).
const GENERIC_PYTHON_ENTRIES: &[&str] = &["run_ui.py", "server.py", "app.py", "main.py"];
const GENERIC_PYTHON_PORT: u16 = 8000;

/// Identify the Python web framework from dependency names.
/// Returns the first matching framework in priority order, or None.
fn identify_python_framework(deps: &[String]) -> Option<&'static PythonFramework> {
    for fw in PYTHON_FRAMEWORKS {
        if fw.markers.iter().any(|m| deps.contains(&m.to_string())) {
            return Some(fw);
        }
    }
    None
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib identify_python_framework 2>&1 | tail -15`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): add Python framework identification (Django/Flask/FastAPI/Streamlit/Gradio)"
```

---

### Task 5: Python port extraction

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs`

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn test_extract_python_port_assignment() {
        assert_eq!(extract_python_port_from_source("port = 5000\n"), Some(5000));
        assert_eq!(extract_python_port_from_source("port=8080\n"), Some(8080));
    }

    #[test]
    fn test_extract_python_port_json_style() {
        assert_eq!(extract_python_port_from_source(r#""port": 5000,"#), Some(5000));
    }

    #[test]
    fn test_extract_python_port_flask_run() {
        assert_eq!(extract_python_port_from_source("app.run(port=8080)\n"), Some(8080));
    }

    #[test]
    fn test_extract_python_port_environ_default() {
        assert_eq!(
            extract_python_port_from_source(r#"os.environ.get("PORT", "5000")"#),
            Some(5000)
        );
        assert_eq!(
            extract_python_port_from_source(r#"os.getenv("PORT", "3000")"#),
            Some(3000)
        );
    }

    #[test]
    fn test_extract_python_port_cli_flag() {
        assert_eq!(
            extract_python_port_from_source("subprocess.run(['uvicorn', '--port', '9000'])"),
            Some(9000)
        );
    }

    #[test]
    fn test_extract_python_port_no_false_positive() {
        // "transport" and "passport" should NOT match
        assert_eq!(extract_python_port_from_source("transport = 8080\n"), None);
        assert_eq!(extract_python_port_from_source("passport = 1234\n"), None);
    }

    #[test]
    fn test_extract_python_port_not_found() {
        assert_eq!(extract_python_port_from_source("print('hello')"), None);
    }

    #[test]
    fn test_extract_python_port_from_env_flask() {
        assert_eq!(extract_python_port_from_env_content("FLASK_RUN_PORT=5001\n"), Some(5001));
    }

    #[test]
    fn test_extract_python_port_from_env_uvicorn() {
        assert_eq!(extract_python_port_from_env_content("UVICORN_PORT=8001\n"), Some(8001));
    }

    #[test]
    fn test_extract_python_port_from_env_web_ui() {
        assert_eq!(extract_python_port_from_env_content("WEB_UI_PORT=5555\n"), Some(5555));
    }

    #[test]
    fn test_extract_python_port_from_env_streamlit() {
        assert_eq!(extract_python_port_from_env_content("STREAMLIT_SERVER_PORT=8502\n"), Some(8502));
    }

    #[test]
    fn test_extract_python_port_from_env_gradio() {
        assert_eq!(extract_python_port_from_env_content("GRADIO_SERVER_PORT=7861\n"), Some(7861));
    }

    #[test]
    fn test_extract_python_port_from_env_django() {
        assert_eq!(extract_python_port_from_env_content("DJANGO_PORT=8001\n"), Some(8001));
    }

    #[test]
    fn test_extract_python_port_from_env_none() {
        assert_eq!(extract_python_port_from_env_content("OTHER_VAR=123\n"), None);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib extract_python_port 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Implement port extraction from source**

```rust
/// Extract a port number from Python source file content.
///
/// Scans for common patterns:
/// - `port = 5000` or `port=5000`
/// - `"port": 5000` (JSON-style)
/// - `.run(port=8080)` (Flask)
/// - `os.environ.get("PORT", "5000")` or `os.getenv("PORT", "3000")`
fn extract_python_port_from_source(content: &str) -> Option<u16> {
    static PORT_PATTERNS: std::sync::LazyLock<Vec<regex::Regex>> = std::sync::LazyLock::new(|| {
        vec![
            // port = 5000 or port=5000 (word boundary to avoid matching "transport", "passport")
            regex::Regex::new(r#"\bport\s*=\s*(\d{2,5})"#).unwrap(),
            // "port": 5000
            regex::Regex::new(r#""port"\s*:\s*(\d{2,5})"#).unwrap(),
            // --port 8080 (in uvicorn/streamlit invocations within source)
            regex::Regex::new(r#"--port\s+(\d{2,5})"#).unwrap(),
            // os.environ.get("PORT", "5000") or os.getenv("PORT", "3000")
            regex::Regex::new(r#"os\.(?:environ\.get|getenv)\(\s*"[^"]*"\s*,\s*"(\d{2,5})"\s*\)"#).unwrap(),
        ]
    });

    for re in PORT_PATTERNS.iter() {
        if let Some(caps) = re.captures(content) {
            if let Some(port) = caps.get(1).and_then(|m| m.as_str().parse::<u16>().ok()) {
                return Some(port);
            }
        }
    }

    None
}
```

- [ ] **Step 4: Implement port extraction from .env**

```rust
/// Python-specific .env variable names that indicate a port.
const PYTHON_PORT_ENV_VARS: &[&str] = &[
    "FLASK_RUN_PORT=",
    "UVICORN_PORT=",
    "WEB_UI_PORT=",
    "DJANGO_PORT=",
    "GRADIO_SERVER_PORT=",
    "STREAMLIT_SERVER_PORT=",
];

/// Extract a port from .env content using Python-specific variable names.
///
/// Separate from the existing `extract_port_from_env()` which only handles
/// `PORT` and `VITE_PORT` and creates Vite-labeled servers.
fn extract_python_port_from_env_content(content: &str) -> Option<u16> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        for prefix in PYTHON_PORT_ENV_VARS {
            if let Some(val) = trimmed.strip_prefix(prefix) {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if let Ok(port) = val.parse::<u16>() {
                    return Some(port);
                }
            }
        }
    }
    None
}

/// Extract Python server port using the three-layer strategy:
/// 1. Entry file source parsing
/// 2. .env file scanning (Python-specific vars)
/// 3. Framework default
fn extract_python_port(root: &Path, entry_path: &Path, default_port: u16) -> u16 {
    // Layer 1: entry file source
    if let Ok(content) = std::fs::read_to_string(entry_path) {
        if let Some(port) = extract_python_port_from_source(&content) {
            return port;
        }
    }

    // Layer 2: .env files
    for env_file in &[".env", ".env.local"] {
        if let Ok(content) = std::fs::read_to_string(root.join(env_file)) {
            if let Some(port) = extract_python_port_from_env_content(&content) {
                return port;
            }
        }
    }

    // Layer 3: framework default
    default_port
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib extract_python_port 2>&1 | tail -15`
Expected: All 11 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): add Python port extraction (source parsing + .env vars)"
```

---

## Chunk 3: Venv Detection + Integration

### Task 6: Virtual environment detection

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs`

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn test_detect_python_venv_dot_venv() {
        let dir = std::env::temp_dir().join("vm_test_venv_dot");
        let _ = std::fs::create_dir_all(dir.join(".venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join(".venv").join("bin"));

        let prefix = detect_python_venv(&dir);
        if cfg!(windows) {
            assert!(prefix.contains(r".venv\Scripts\"), "Windows: {}", prefix);
        } else {
            assert!(prefix.contains(".venv/bin/"), "Unix: {}", prefix);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_venv() {
        let dir = std::env::temp_dir().join("vm_test_venv_plain");
        let _ = std::fs::create_dir_all(dir.join("venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join("venv").join("bin"));

        let prefix = detect_python_venv(&dir);
        if cfg!(windows) {
            assert!(prefix.contains(r"venv\Scripts\"), "Windows: {}", prefix);
        } else {
            assert!(prefix.contains("venv/bin/"), "Unix: {}", prefix);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_conda() {
        let dir = std::env::temp_dir().join("vm_test_venv_conda");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("environment.yml"), "name: myenv\ndependencies:\n  - flask\n").unwrap();

        let prefix = detect_python_venv(&dir);
        assert!(prefix.contains("conda run -n myenv"), "Conda: {}", prefix);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_pipenv() {
        let dir = std::env::temp_dir().join("vm_test_venv_pipenv");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("Pipfile"), "[packages]\nflask = \"*\"\n").unwrap();

        let prefix = detect_python_venv(&dir);
        assert_eq!(prefix, "pipenv run ");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_none() {
        let dir = std::env::temp_dir().join("vm_test_venv_none");
        let _ = std::fs::create_dir_all(&dir);

        let prefix = detect_python_venv(&dir);
        assert_eq!(prefix, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_conda_env_name() {
        let content = "name: myproject\ndependencies:\n  - python=3.12\n";
        assert_eq!(read_conda_env_name_from_content(content), Some("myproject".to_string()));
    }

    #[test]
    fn test_read_conda_env_name_missing() {
        assert_eq!(read_conda_env_name_from_content("dependencies:\n  - flask\n"), None);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib detect_python_venv 2>&1 | tail -10` and `cargo test --lib read_conda_env 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Implement venv detection**

```rust
/// Read the conda environment name from environment.yml content.
fn read_conda_env_name_from_content(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Detect the virtual environment type and return a command prefix.
///
/// Instead of shell-dependent activation commands, returns the path to the
/// venv's executables directly (works in cmd.exe, PowerShell, and bash).
///
/// Returns:
/// - `.venv\Scripts\` or `.venv/bin/` for venv directories
/// - `conda run -n {envname} ` for conda environments
/// - `pipenv run ` for Pipfile projects
/// - `""` if no venv found
fn detect_python_venv(root: &Path) -> String {
    // Check .venv/ and venv/ directories
    for venv_dir in &[".venv", "venv"] {
        let venv_path = root.join(venv_dir);
        if venv_path.is_dir() {
            if cfg!(windows) {
                return format!(r"{}\Scripts\", venv_dir);
            } else {
                return format!("{}/bin/", venv_dir);
            }
        }
    }

    // Check conda: environment.yml
    let env_yml = root.join("environment.yml");
    if env_yml.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_yml) {
            if let Some(name) = read_conda_env_name_from_content(&content) {
                return format!("conda run -n {} ", name);
            }
        }
    }

    // Check conda: .conda/ directory (fallback — use project dir name)
    if root.join(".conda").is_dir() {
        let dir_name = root.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("env");
        return format!("conda run -n {} ", dir_name);
    }

    // Check pipenv: Pipfile present
    if root.join("Pipfile").exists() {
        return "pipenv run ".to_string();
    }

    String::new()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib detect_python_venv 2>&1 | tail -10` and `cargo test --lib read_conda_env 2>&1 | tail -10`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): add Python venv detection (venv/conda/pipenv)"
```

---

### Task 7: Main Python detection function + pipeline integration

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs`

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn test_detect_python_servers_flask() {
        let dir = std::env::temp_dir().join("vm_test_py_flask");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "flask==2.0\nrequests\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\napp = Flask(__name__)\napp.run(port=5001)\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].framework, "Flask");
        assert_eq!(servers[0].port, 5001);
        assert!(servers[0].start_command.contains("app.py"));
        assert_eq!(servers[0].source, "requirements.txt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_django() {
        let dir = std::env::temp_dir().join("vm_test_py_django");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "django>=4.0\n").unwrap();
        std::fs::write(dir.join("manage.py"), "#!/usr/bin/env python\nimport os\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].framework, "Django");
        assert_eq!(servers[0].port, 8000);
        assert!(servers[0].start_command.contains("manage.py"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_with_env_port() {
        let dir = std::env::temp_dir().join("vm_test_py_env_port");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "flask\n").unwrap();
        std::fs::write(dir.join("run_ui.py"), "# main entry\n").unwrap();
        std::fs::write(dir.join(".env"), "WEB_UI_PORT=5555\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].port, 5555, "Should pick up WEB_UI_PORT from .env");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_generic_fallback() {
        let dir = std::env::temp_dir().join("vm_test_py_generic");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "requests\nnumpy\n").unwrap();
        std::fs::write(dir.join("run_ui.py"), "# server code\nport = 9000\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].framework, "Python");
        assert_eq!(servers[0].port, 9000);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_no_entry_file() {
        let dir = std::env::temp_dir().join("vm_test_py_no_entry");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        // Has requirements.txt but no recognized entry file
        std::fs::write(dir.join("requirements.txt"), "requests\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert!(servers.is_empty(), "No entry file → no detection");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_port_dedup() {
        let dir = std::env::temp_dir().join("vm_test_py_dedup");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        std::fs::write(dir.join("requirements.txt"), "flask\n").unwrap();
        std::fs::write(dir.join("app.py"), "app.run(port=3000)\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        seen.insert(3000u16); // Simulate Node.js already claimed port 3000

        let servers = detect_python_servers(&dir, &mut seen);
        assert!(servers.is_empty(), "Should be skipped due to port dedup");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_with_venv() {
        let dir = std::env::temp_dir().join("vm_test_py_venv");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join(".venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join(".venv").join("bin"));

        std::fs::write(dir.join("requirements.txt"), "flask\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        if cfg!(windows) {
            assert!(servers[0].start_command.contains(r".venv\Scripts\"), "Windows cmd: {}", servers[0].start_command);
        } else {
            assert!(servers[0].start_command.contains(".venv/bin/"), "Unix cmd: {}", servers[0].start_command);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib detect_python_servers 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Implement build_python_start_command helper**

```rust
/// Build the start command for a Python server, applying venv prefix.
///
/// For venv directories, replaces `python`/tool names with the venv path.
/// For conda/pipenv, prepends the runner prefix.
fn build_python_start_command(
    framework_name: &str,
    entry: &str,
    port: u16,
    venv_prefix: &str,
) -> String {
    match framework_name {
        "Django" => {
            format!("{}python manage.py runserver 0.0.0.0:{}", venv_prefix, port)
        }
        "FastAPI" => {
            // Derive module name from entry file: "main.py" → "main", "app.py" → "app"
            let module = entry.strip_suffix(".py").unwrap_or(entry);
            format!("{}uvicorn {}:app --host 0.0.0.0 --port {}", venv_prefix, module, port)
        }
        "Streamlit" => {
            format!("{}streamlit run {} --server.port {}", venv_prefix, entry, port)
        }
        _ => {
            // Flask, Gradio, Generic Python
            format!("{}python {}", venv_prefix, entry)
        }
    }
}
```

- [ ] **Step 4: Implement detect_python_servers**

```rust
/// Detect Python dev servers in a project directory.
///
/// Scans for requirements.txt/pyproject.toml/Pipfile, identifies framework,
/// locates entry file, extracts port, and builds venv-aware start command.
fn detect_python_servers(
    root: &Path,
    seen_ports: &mut std::collections::HashSet<u16>,
) -> Vec<DetectedDevServer> {
    let mut servers = Vec::new();

    // Step 1: Parse dependency files
    let deps = match parse_python_deps(root) {
        Some(d) => d,
        None => return servers, // Not a Python project
    };

    // Determine which dep file was found (for source field)
    let source = if root.join("requirements.txt").exists() {
        "requirements.txt"
    } else if root.join("pyproject.toml").exists() {
        "pyproject.toml"
    } else {
        "Pipfile"
    };

    // Step 2: Identify framework
    let (framework_name, entry_candidates, default_port) =
        if let Some(fw) = identify_python_framework(&deps) {
            (fw.name, fw.entry_candidates.to_vec(), fw.default_port)
        } else {
            // Generic Python fallback
            ("Python", GENERIC_PYTHON_ENTRIES.to_vec(), GENERIC_PYTHON_PORT)
        };

    // Step 3: Locate entry file
    let entry = match entry_candidates.iter().find(|f| root.join(f).exists()) {
        Some(e) => *e,
        None => return servers, // No entry file found
    };

    // Step 4: Extract port
    let port = extract_python_port(root, &root.join(entry), default_port);

    // Port dedup
    if !seen_ports.insert(port) {
        return servers;
    }

    // Step 5: Detect venv and build start command
    let venv_prefix = detect_python_venv(root);
    let start_command = build_python_start_command(framework_name, entry, port, &venv_prefix);

    servers.push(DetectedDevServer {
        framework: framework_name.to_string(),
        port,
        url: format!("http://localhost:{}", port),
        start_command,
        source: source.to_string(),
        running: false,
    });

    servers
}
```

- [ ] **Step 5: Wire into detect_dev_servers pipeline**

In the `detect_dev_servers()` function, add step 5 after the package.json block (after line 70) and before the port probing loop:

```rust
    // 5. Python project detection
    for server in detect_python_servers(root, &mut seen_ports) {
        servers.push(server);
    }
```

Also update the doc comment at the top of `detect_dev_servers()` to include step 5:

```rust
/// Detection priority:
/// 1. `tauri.conf.json` — exact devUrl
/// 2. `vite.config.js` / `vite.config.ts` — regex for port
/// 3. `.env` / `.env.local` — PORT or VITE_PORT
/// 4. `package.json` scripts — pattern matching
/// 5. Python project — requirements.txt / pyproject.toml / Pipfile
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `cargo test --lib 2>&1 | tail -15`
Expected: All existing + new tests PASS (should be ~60+ tests total)

- [ ] **Step 7: Run frontend tests too**

Run: `npm test 2>&1 | tail -10`
Expected: All pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/services/dev_server.rs src/lib/stores/dev-server-manager.svelte.js test/stores/dev-server-manager.test.cjs
git commit -m "feat(dev-server): add Python project detection (Flask/FastAPI/Django/Streamlit/Gradio)"
```

---

## Task Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Fix restartServer start_command preservation | `dev-server-manager.svelte.js`, test |
| 2 | requirements.txt parser | `dev_server.rs` |
| 3 | pyproject.toml + Pipfile parsers | `dev_server.rs` |
| 4 | Framework identification | `dev_server.rs` |
| 5 | Port extraction (source + .env) | `dev_server.rs` |
| 6 | Venv detection | `dev_server.rs` |
| 7 | Main detection function + pipeline integration | `dev_server.rs` |
