# Python Venv Auto-Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect missing Python virtual environments and offer one-click setup before starting dev servers.

**Architecture:** Add `needs_setup` and `setup_commands` fields to `DetectedDevServer` (Rust). When no venv exists, populate them with venv creation + pip install commands. Frontend shows a different toast and chains setup commands with `&&` before the start command.

**Tech Stack:** Rust (serde, std::path), Svelte 5, node:test source-inspection tests

**Spec:** `docs/superpowers/specs/2026-03-13-python-venv-auto-setup-design.md`

---

## File Structure

| File | Role | Change Type |
|------|------|-------------|
| `src-tauri/src/services/dev_server.rs` | Detection pipeline | Modify: struct + detect_python_servers() |
| `src/components/lens/LensPreview.svelte` | Toast UI | Modify: toast branching on needsSetup |
| `src/lib/stores/dev-server-manager.svelte.js` | Server lifecycle | Modify: setup command chaining in startServer() |
| `test/stores/dev-server-manager.test.cjs` | Tests | Modify: add setup command tests |
| `test/components/lens-preview.test.cjs` | Tests | Modify: add needsSetup toast tests |

---

## Chunk 1: Rust Backend

### Task 1: Add new fields to DetectedDevServer struct

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs:13-28`

- [ ] **Step 1: Write failing tests for needs_setup field**

Add to the test module (after existing tests, ~line 1740+):

```rust
#[test]
fn test_detect_python_needs_setup_no_venv() {
    let dir = std::env::temp_dir().join("vm_test_py_needs_setup");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    // Create requirements.txt with flask
    std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
    // Create entry file
    std::fs::write(dir.join("app.py"), "from flask import Flask\napp = Flask(__name__)\n").unwrap();
    // NO .venv directory

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    assert!(servers[0].needs_setup, "Should need setup when no venv exists");
    assert!(!servers[0].setup_commands.is_empty(), "Should have setup commands");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_detect_python_no_setup_with_venv() {
    let dir = std::env::temp_dir().join("vm_test_py_no_setup_venv");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
    std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();
    // Create .venv directory
    if cfg!(target_os = "windows") {
        std::fs::create_dir_all(dir.join(".venv").join("Scripts")).unwrap();
        std::fs::write(dir.join(".venv").join("Scripts").join("python.exe"), "").unwrap();
    } else {
        std::fs::create_dir_all(dir.join(".venv").join("bin")).unwrap();
        std::fs::write(dir.join(".venv").join("bin").join("python"), "").unwrap();
    }

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    assert!(!servers[0].needs_setup, "Should NOT need setup when venv exists");
    assert!(servers[0].setup_commands.is_empty(), "Should have no setup commands");
    let _ = std::fs::remove_dir_all(&dir);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo check --tests --lib 2>&1 | head -20`
Expected: Compilation error — `needs_setup` and `setup_commands` fields don't exist on `DetectedDevServer`. (`cargo check` verifies compilation only, not runtime behavior.)

- [ ] **Step 3: Add fields to DetectedDevServer struct**

Modify the struct at lines 13-28. Add `Default` derive and new fields with `#[serde(default)]`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectedDevServer {
    pub framework: String,
    pub port: u16,
    pub url: String,
    pub start_command: String,
    pub source: String,
    pub running: bool,
    #[serde(default)]
    pub needs_setup: bool,
    #[serde(default)]
    pub setup_commands: Vec<String>,
}
```

Then add `..Default::default()` to ALL existing Node.js construction sites (lines 207, 224, 243, 300, 312, 324, 336, 348, 360, 372, 384, 396, 409, 423, 436, 449, 467, 481). Pattern for each:

```rust
// Before:
DetectedDevServer {
    framework: "Vite".to_string(),
    port,
    url: format!("http://localhost:{}", port),
    start_command: cmd.to_string(),
    source: "vite.config".to_string(),
    running: false,
}

// After:
DetectedDevServer {
    framework: "Vite".to_string(),
    port,
    url: format!("http://localhost:{}", port),
    start_command: cmd.to_string(),
    source: "vite.config".to_string(),
    running: false,
    ..Default::default()
}
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check --tests --lib 2>&1 | head -20`
Expected: Compiles successfully. (`cargo check` only verifies compilation — the tests won't run, but the struct changes are validated.)

- [ ] **Step 5: Commit struct changes**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): add needs_setup and setup_commands fields to DetectedDevServer"
```

---

### Task 2: Implement setup logic in detect_python_servers()

**Files:**
- Modify: `src-tauri/src/services/dev_server.rs:1095-1152`

- [ ] **Step 1: Write additional tests for setup commands**

```rust
#[test]
fn test_setup_commands_requirements_txt() {
    let dir = std::env::temp_dir().join("vm_test_py_setup_req");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
    std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    let cmds = &servers[0].setup_commands;
    assert_eq!(cmds.len(), 2);
    assert!(cmds[0].contains("venv .venv"), "First cmd should create venv");
    assert!(cmds[1].contains("pip install"), "Second cmd should pip install");
    assert!(cmds[1].contains("--prefer-binary"), "Should use --prefer-binary");
    assert!(cmds[1].contains("requirements.txt"), "Should reference requirements.txt");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_setup_commands_pyproject_toml() {
    let dir = std::env::temp_dir().join("vm_test_py_setup_pyproj");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("pyproject.toml"), "[project]\ndependencies = [\"flask\"]\n").unwrap();
    std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    let cmds = &servers[0].setup_commands;
    assert_eq!(cmds.len(), 2);
    assert!(cmds[1].contains("-e ."), "Should use editable install for pyproject.toml");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_setup_commands_pipfile_skipped() {
    let dir = std::env::temp_dir().join("vm_test_py_setup_pipfile");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("Pipfile"), "[packages]\nflask = \"*\"\n").unwrap();
    std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    assert!(!servers[0].needs_setup, "Pipfile projects should NOT need setup (pipenv manages venv)");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_setup_start_command_uses_venv_prefix() {
    let dir = std::env::temp_dir().join("vm_test_py_setup_prefix");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
    std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();
    // No .venv

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    // start_command should anticipate the .venv that setup will create
    if cfg!(target_os = "windows") {
        assert!(servers[0].start_command.contains(".venv\\Scripts\\"), "start_command should use .venv prefix on Windows");
    } else {
        assert!(servers[0].start_command.contains(".venv/bin/"), "start_command should use .venv prefix on Unix");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_setup_commands_platform() {
    let dir = std::env::temp_dir().join("vm_test_py_setup_platform");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
    std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

    let mut seen = std::collections::HashSet::new();
    let servers = detect_python_servers(&dir, &mut seen);
    assert_eq!(servers.len(), 1);
    let cmds = &servers[0].setup_commands;
    if cfg!(target_os = "windows") {
        assert!(cmds[0].starts_with("python "), "Windows should use 'python' (not python3)");
        assert!(cmds[1].contains(".venv\\Scripts\\pip"), "Windows pip path should use backslashes");
    } else {
        assert!(cmds[0].starts_with("python3 "), "Unix should use 'python3'");
        assert!(cmds[1].contains(".venv/bin/pip"), "Unix pip path should use forward slashes");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_node_projects_no_setup() {
    let dir = std::env::temp_dir().join("vm_test_node_no_setup");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    // Create a minimal Node.js project (package.json with dev script)
    std::fs::write(
        dir.join("package.json"),
        r#"{"name":"test","scripts":{"dev":"vite"},"devDependencies":{"vite":"5.0.0"}}"#,
    ).unwrap();
    std::fs::create_dir_all(dir.join("node_modules/.package-lock.json")).ok();

    let mut seen = std::collections::HashSet::new();
    let servers = detect_dev_servers_in_dir(&dir, &mut seen);
    for server in &servers {
        assert!(!server.needs_setup, "Node.js projects should never have needs_setup=true");
        assert!(server.setup_commands.is_empty(), "Node.js projects should have empty setup_commands");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
```

- [ ] **Step 2: Verify tests compile**

Run: `cargo check --tests --lib 2>&1 | head -10`
Expected: Compiles successfully. (`cargo check` only verifies compilation — to confirm tests actually pass, run `cargo test --lib` after Step 3.)

- [ ] **Step 3: Implement setup logic in detect_python_servers()**

In `detect_python_servers()`, replace lines 1138-1149 only (the "Step 5: Detect venv" block through `servers.push(...)` — do NOT touch the port dedup at lines 1133-1136, which stays as-is):

**Lines to replace (1138-1149):**
```rust
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
```

**Replace with:**
```rust
    // Step 5: Detect venv and build start command
    let venv_prefix = detect_python_venv(root);
    let needs_setup = venv_prefix.is_empty() && source != "Pipfile";

    // When setup is needed, use .venv prefix for start_command
    // (anticipates the venv that setup_commands will create)
    let effective_prefix = if needs_setup {
        if cfg!(target_os = "windows") {
            ".venv\\Scripts\\".to_string()
        } else {
            ".venv/bin/".to_string()
        }
    } else {
        venv_prefix
    };

    let start_command = build_python_start_command(framework_name, entry, port, &effective_prefix);

    let setup_commands = if needs_setup {
        let (python_cmd, pip_path) = if cfg!(target_os = "windows") {
            ("python", ".venv\\Scripts\\pip")
        } else {
            ("python3", ".venv/bin/pip")
        };

        let install_cmd = if source == "pyproject.toml" {
            format!("{} install --prefer-binary -e .", pip_path)
        } else {
            format!("{} install --prefer-binary -r requirements.txt", pip_path)
        };

        vec![
            format!("{} -m venv .venv", python_cmd),
            install_cmd,
        ]
    } else {
        vec![]
    };

    servers.push(DetectedDevServer {
        framework: framework_name.to_string(),
        port,
        url: format!("http://localhost:{}", port),
        start_command,
        source: source.to_string(),
        running: false,
        needs_setup,
        setup_commands,
    });

    servers
```

- [ ] **Step 4: Verify compilation and run tests**

Run: `cargo check --tests --lib 2>&1 | head -10`
Expected: Compiles successfully.

Then try: `cargo test --lib test_detect_python_needs_setup test_detect_python_no_setup test_setup_commands test_setup_start_command test_setup_commands_platform test_node_projects_no_setup 2>&1 | tail -20`
Expected: All new tests pass. (Full `cargo test --lib` may fail on Windows due to WebView2 DLL — running specific tests avoids that.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/dev_server.rs
git commit -m "feat(dev-server): detect missing venv and generate setup commands"
```

---

## Chunk 2: Frontend Changes

### Task 3: Update LensPreview toast to branch on needsSetup

**Files:**
- Modify: `src/components/lens/LensPreview.svelte:208-232`
- Test: `test/components/lens-preview.test.cjs`

- [ ] **Step 1: Write failing test**

Append to `test/components/lens-preview.test.cjs`:

```javascript
describe('LensPreview.svelte: venv auto-setup toast', () => {
  it('checks needsSetup flag on stopped server', () => {
    assert.ok(src.includes('needsSetup'), 'Should check needsSetup on stopped server');
  });

  it('shows setup toast when needsSetup is true', () => {
    assert.ok(
      src.includes('Set up & start'),
      'Should show "Set up & start" action for setup toast'
    );
  });

  it('shows normal toast when needsSetup is false', () => {
    assert.ok(src.includes('Always start'), 'Should still have Always start for normal servers');
    assert.ok(src.includes('Start once'), 'Should still have Start once for normal servers');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "venv auto-setup" 2>&1 | tail -10`
Expected: FAIL — `needsSetup` not in source.

- [ ] **Step 3: Implement toast branching**

In `LensPreview.svelte`, replace the toast block at lines 208-232. Wrap the existing toast in a conditional:

```javascript
      if (stoppedServer.needsSetup) {
        // No venv — offer to set up environment
        toastStore.addToast({
          message: `${stoppedServer.framework || 'Python'} detected but no virtual environment. Set up & start?`,
          severity: 'warning',
          key: 'dev-server-consent-' + project.path,
          duration: 0,
          actions: [
            {
              label: 'Set up & start',
              callback: () => {
                devServerManager.startServer(stoppedServer, project.path, packageManager);
              },
            },
            {
              label: 'Not now',
              callback: () => {},
            },
          ],
        });
      } else {
        // Normal flow — venv exists or not a Python project
        toastStore.addToast({
          message: `${stoppedServer.framework || 'Dev server'} on :${stoppedServer.port} is not running. Start it?`,
          severity: 'warning',
          key: 'dev-server-consent-' + project.path,
          duration: 0,
          actions: [
            {
              label: 'Always start',
              callback: () => {
                projectStore.updateActiveField('autoStartServer', true);
                devServerManager.startServer(stoppedServer, project.path, packageManager);
              },
            },
            {
              label: 'Start once',
              callback: () => {
                devServerManager.startServer(stoppedServer, project.path, packageManager);
              },
            },
            {
              label: 'Not now',
              callback: () => {},
            },
          ],
        });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "venv auto-setup" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/lens/LensPreview.svelte test/components/lens-preview.test.cjs
git commit -m "feat(lens): show setup toast when Python venv is missing"
```

---

### Task 4: Chain setup commands in startServer()

**Files:**
- Modify: `src/lib/stores/dev-server-manager.svelte.js:260-268`
- Test: `test/stores/dev-server-manager.test.cjs`

- [ ] **Step 1: Write failing test**

Append to `test/stores/dev-server-manager.test.cjs`:

```javascript
describe('dev-server-manager.svelte.js -- setupCommands chaining', () => {
  it('checks for setupCommands before sending start command', () => {
    assert.ok(
      src.includes('setupCommands') && src.includes('server.setupCommands'),
      'Should check server.setupCommands'
    );
  });

  it('chains setup commands with && for shell sequencing', () => {
    assert.ok(
      src.includes(".join(' && ')"),
      'Should join setupCommands with && for fail-fast shell chaining'
    );
  });

  it('includes startCommand in the chained command', () => {
    // The chain should be: [...setupCommands, startCommand].join(' && ')
    const chainPattern = src.includes('setupCommands') && src.includes('startCommand');
    assert.ok(chainPattern, 'Should chain setupCommands with startCommand');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "setupCommands" 2>&1 | tail -10`
Expected: FAIL — `setupCommands` not in source.

- [ ] **Step 3: Implement setup command chaining**

In `dev-server-manager.svelte.js`, replace lines 260-268 (the start command building + sending block):

```javascript
      // Build start command with correct package manager prefix
      let startCommand = server.startCommand || 'npm run dev';
      if (packageManager && packageManager !== 'npm' && startCommand.startsWith('npm run ')) {
        const script = startCommand.replace('npm run ', '');
        startCommand = `${packageManager} run ${script}`;
      }

      // Chain setup commands (venv creation + pip install) with start command
      // using && so the shell handles sequencing and fails fast.
      // terminalInput() is fire-and-forget — cannot send commands one at a time.
      if (server.setupCommands && server.setupCommands.length > 0) {
        const fullCommand = [...server.setupCommands, startCommand].join(' && ');
        await terminalInput(shellId, fullCommand + '\n');
      } else {
        await terminalInput(shellId, startCommand + '\n');
      }
```

- [ ] **Step 4: Run all tests**

Run: `npm test 2>&1 | tail -10`
Expected: All tests PASS (6508+)

- [ ] **Step 5: Run Vite build**

Run: `npx vite build 2>&1 | tail -3`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/dev-server-manager.svelte.js test/stores/dev-server-manager.test.cjs
git commit -m "feat(dev-server): chain setup commands with && before start command"
```
