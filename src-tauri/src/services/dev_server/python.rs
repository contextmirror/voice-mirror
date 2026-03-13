//! Python framework detection.
//!
//! Scans requirements.txt, pyproject.toml, and Pipfile for known Python web
//! frameworks (Django, Flask, FastAPI, Streamlit, Gradio), detects virtual
//! environments, extracts ports, and generates setup commands.

use std::path::Path;

use super::DetectedDevServer;

// ---------------------------------------------------------------------------
// Python dependency file parsers
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
            if trimmed.is_empty()
                || trimmed.starts_with('#')
                || trimmed.starts_with('-')
                || trimmed.starts_with("http")
                || trimmed.starts_with('/')
                || trimmed.starts_with('.')
            {
                return None;
            }
            let before_comment = trimmed.split('#').next().unwrap_or("").trim();
            let before_extras = before_comment.split('[').next().unwrap_or("");
            PKG_RE.captures(before_extras).map(|caps| {
                caps.get(1).unwrap().as_str().to_lowercase()
            })
        })
        .collect()
}

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

        // PEP 621: [project] section
        if trimmed == "[project]" {
            i += 1;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.starts_with('[') { break; }
                if line.starts_with("dependencies") && line.contains('=') {
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
                    for caps in QUOTED_PKG_RE.captures_iter(&array_str) {
                        let name = caps.get(1).unwrap().as_str().to_lowercase();
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

/// Parse Python dependency files from a project root.
/// Tries requirements.txt -> pyproject.toml -> Pipfile in order.
/// Returns None if no Python dependency file is found.
fn parse_python_deps(root: &Path) -> Option<Vec<String>> {
    if let Ok(content) = std::fs::read_to_string(root.join("requirements.txt")) {
        let deps = parse_requirements_txt(&content);
        if !deps.is_empty() {
            return Some(deps);
        }
    }

    if let Ok(content) = std::fs::read_to_string(root.join("pyproject.toml")) {
        let deps = parse_pyproject_toml(&content);
        return Some(deps);
    }

    if let Ok(content) = std::fs::read_to_string(root.join("Pipfile")) {
        let deps = parse_pipfile(&content);
        return Some(deps);
    }

    None
}

// ---------------------------------------------------------------------------
// Python framework identification
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Python port extraction
// ---------------------------------------------------------------------------

/// Extract a port number from Python source file content.
///
/// Scans for common patterns:
/// - `port = 5000` or `port=5000` (word boundary to avoid "transport", "passport")
/// - `"port": 5000` (JSON-style)
/// - `--port 8080` in uvicorn/streamlit invocations
/// - `os.environ.get("PORT", "5000")` or `os.getenv("PORT", "3000")`
fn extract_python_port_from_source(content: &str) -> Option<u16> {
    static PORT_PATTERNS: std::sync::LazyLock<Vec<regex::Regex>> = std::sync::LazyLock::new(|| {
        vec![
            // port = 5000 or port=5000 (word boundary to avoid matching "transport", "passport")
            regex::Regex::new(r#"\bport\s*=\s*(\d{2,5})"#).unwrap(),
            // "port": 5000
            regex::Regex::new(r#""port"\s*:\s*(\d{2,5})"#).unwrap(),
            // --port 8080
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

// ---------------------------------------------------------------------------
// Python venv detection
// ---------------------------------------------------------------------------

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
/// - `.venv/Scripts/` or `.venv/bin/` for venv directories (forward slashes on Windows for Git Bash)
/// - `conda run -n {envname} ` for conda environments
/// - `pipenv run ` for Pipfile projects
/// - `""` if no venv found
fn detect_python_venv(root: &Path) -> String {
    // Check .venv/ and venv/ directories
    for venv_dir in &[".venv", "venv"] {
        let venv_path = root.join(venv_dir);
        if venv_path.is_dir() {
            if cfg!(windows) {
                // Use forward slashes — terminal is Git Bash, not cmd.exe
                return format!("{}/Scripts/", venv_dir);
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

// ---------------------------------------------------------------------------
// Python start command + full detection pipeline
// ---------------------------------------------------------------------------

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

/// Check if the framework's package is installed in .venv/site-packages.
/// Returns true if the package directory exists, false otherwise.
/// For unknown frameworks, returns true (assume installed).
fn check_framework_installed(root: &Path, framework_name: &str) -> bool {
    let package_name = match framework_name {
        "Django" => "django",
        "Flask" => "flask",
        "FastAPI" => "fastapi",
        "Streamlit" => "streamlit",
        "Gradio" => "gradio",
        _ => return true, // Unknown framework — skip check
    };

    if cfg!(target_os = "windows") {
        // Windows: .venv/Lib/site-packages/<package>/
        root.join(".venv").join("Lib").join("site-packages").join(package_name).is_dir()
    } else {
        // Unix: .venv/lib/python3.x/site-packages/<package>/
        let lib_dir = root.join(".venv").join("lib");
        if let Ok(entries) = std::fs::read_dir(&lib_dir) {
            for entry in entries.flatten() {
                if entry.path().join("site-packages").join(package_name).is_dir() {
                    return true;
                }
            }
        }
        false
    }
}

/// Detect Python dev servers in a project directory.
///
/// Scans for requirements.txt/pyproject.toml/Pipfile, identifies framework,
/// locates entry file, extracts port, and builds venv-aware start command.
pub(super) fn detect_python_servers(
    root: &Path,
    seen_ports: &mut std::collections::HashSet<u16>,
) -> Vec<DetectedDevServer> {
    let mut servers = Vec::new();

    // Step 1: Parse dependency files
    let deps = match parse_python_deps(root) {
        Some(d) => d,
        None => return servers,
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
            ("Python", GENERIC_PYTHON_ENTRIES.to_vec(), GENERIC_PYTHON_PORT)
        };

    // Step 3: Locate entry file
    let entry = match entry_candidates.iter().find(|f| root.join(f).exists()) {
        Some(e) => *e,
        None => return servers,
    };

    // Step 4: Extract port
    let port = extract_python_port(root, &root.join(entry), default_port);

    // Port dedup
    if !seen_ports.insert(port) {
        return servers;
    }

    // Step 5: Detect venv, check deps, and build start command
    let venv_prefix = detect_python_venv(root);
    let dot_venv_exists = root.join(".venv").is_dir();

    // Determine if setup is needed:
    // 1. No venv at all → full setup (create venv + install deps)
    // 2. .venv exists but framework not installed → partial setup (just pip install)
    // 3. .venv exists and framework present → no setup
    // 4. Other venv type (conda, pipenv, venv/) → no setup
    let needs_setup = if source == "Pipfile" {
        false // Pipenv manages its own venv
    } else if venv_prefix.is_empty() {
        true // No venv at all
    } else if dot_venv_exists {
        !check_framework_installed(root, framework_name)
    } else {
        false // Non-.venv venv type — assume OK
    };

    // When setup is needed and no venv exists, use .venv prefix for start_command
    // (anticipates the venv that setup_commands will create)
    let effective_prefix = if needs_setup && venv_prefix.is_empty() {
        if cfg!(target_os = "windows") {
            ".venv/Scripts/".to_string()
        } else {
            ".venv/bin/".to_string()
        }
    } else {
        venv_prefix
    };

    let start_command = build_python_start_command(framework_name, entry, port, &effective_prefix);

    let setup_commands = if needs_setup {
        let (python_cmd, pip_path) = if cfg!(target_os = "windows") {
            ("python", ".venv/Scripts/pip")
        } else {
            ("python3", ".venv/bin/pip")
        };

        let install_cmd = if source == "pyproject.toml" {
            format!("{} install --prefer-binary -e .", pip_path)
        } else {
            // Try full install first; on failure (e.g. scipy can't build from source),
            // fall back to installing each package individually so the rest still get installed.
            format!(
                "{pip} install --prefer-binary -r requirements.txt || \
                 (echo '[setup] Full install failed, retrying packages individually...' && \
                 grep -vE '^\\s*(#|$|-)' requirements.txt | \
                 xargs -L1 {pip} install --prefer-binary 2>/dev/null; true)",
                pip = pip_path
            )
        };

        let mut cmds = Vec::new();
        if !dot_venv_exists {
            cmds.push(format!("{} -m venv .venv", python_cmd));
        }
        cmds.push(install_cmd);
        cmds
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- Dependency parsing tests ---

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

    #[test]
    fn test_parse_pyproject_toml_pep621() {
        let content = "[project]\nname = \"myapp\"\ndependencies = [\n    \"flask>=2.0\",\n    \"uvicorn\",\n]\n";
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
    }

    #[test]
    fn test_parse_pyproject_toml_pep621_single_line() {
        let content = "[project]\ndependencies = [\"django>=4.0\", \"gunicorn\"]\n";
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"django".to_string()));
        assert!(deps.contains(&"gunicorn".to_string()));
    }

    #[test]
    fn test_parse_pyproject_toml_poetry() {
        let content = "[tool.poetry.dependencies]\npython = \"^3.12\"\nflask = \"^2.0\"\ngradio = {version = \"^4.0\"}\n";
        let deps = parse_pyproject_toml(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"gradio".to_string()));
        assert!(!deps.contains(&"python".to_string()), "Should skip python itself");
    }

    #[test]
    fn test_parse_pipfile() {
        let content = "[packages]\nflask = \"*\"\nuvicorn = \">=0.18\"\n\n[dev-packages]\npytest = \"*\"\n";
        let deps = parse_pipfile(content);
        assert!(deps.contains(&"flask".to_string()));
        assert!(deps.contains(&"uvicorn".to_string()));
        assert!(!deps.contains(&"pytest".to_string()), "Should skip dev-packages");
    }

    // --- Task 4: Framework identification tests ---

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

    // --- Task 5: Port extraction tests ---

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

    // --- Task 6: Venv detection tests ---

    #[test]
    fn test_detect_python_venv_dot_venv() {
        let dir = std::env::temp_dir().join("vm_test_venv_dot");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join(".venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join(".venv").join("bin"));

        let prefix = detect_python_venv(&dir);
        if cfg!(windows) {
            assert!(prefix.contains(".venv/Scripts/"), "Windows: {}", prefix);
        } else {
            assert!(prefix.contains(".venv/bin/"), "Unix: {}", prefix);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_venv() {
        let dir = std::env::temp_dir().join("vm_test_venv_plain");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join("venv").join("Scripts"));
        let _ = std::fs::create_dir_all(dir.join("venv").join("bin"));

        let prefix = detect_python_venv(&dir);
        if cfg!(windows) {
            assert!(prefix.contains("venv/Scripts/"), "Windows: {}", prefix);
        } else {
            assert!(prefix.contains("venv/bin/"), "Unix: {}", prefix);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_conda() {
        let dir = std::env::temp_dir().join("vm_test_venv_conda");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("environment.yml"), "name: myenv\ndependencies:\n  - flask\n").unwrap();

        let prefix = detect_python_venv(&dir);
        assert!(prefix.contains("conda run -n myenv"), "Conda: {}", prefix);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_pipenv() {
        let dir = std::env::temp_dir().join("vm_test_venv_pipenv");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("Pipfile"), "[packages]\nflask = \"*\"\n").unwrap();

        let prefix = detect_python_venv(&dir);
        assert_eq!(prefix, "pipenv run ");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_venv_none() {
        let dir = std::env::temp_dir().join("vm_test_venv_none");
        let _ = std::fs::remove_dir_all(&dir);
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

    // --- Task 7: Python detection pipeline integration tests ---

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

        std::fs::write(dir.join("requirements.txt"), "requests\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert!(servers.is_empty(), "No entry file should mean no detection");

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
        seen.insert(3000u16);

        let servers = detect_python_servers(&dir, &mut seen);
        assert!(servers.is_empty(), "Should be skipped due to port dedup");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_servers_with_venv() {
        let dir = std::env::temp_dir().join("vm_test_py_venv_int");
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
            assert!(servers[0].start_command.contains(".venv/Scripts/"), "Windows cmd: {}", servers[0].start_command);
        } else {
            assert!(servers[0].start_command.contains(".venv/bin/"), "Unix cmd: {}", servers[0].start_command);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

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
        // Create .venv directory with framework installed
        if cfg!(target_os = "windows") {
            std::fs::create_dir_all(dir.join(".venv").join("Scripts")).unwrap();
            std::fs::write(dir.join(".venv").join("Scripts").join("python.exe"), "").unwrap();
            std::fs::create_dir_all(dir.join(".venv").join("Lib").join("site-packages").join("flask")).unwrap();
        } else {
            std::fs::create_dir_all(dir.join(".venv").join("bin")).unwrap();
            std::fs::write(dir.join(".venv").join("bin").join("python"), "").unwrap();
            std::fs::create_dir_all(dir.join(".venv").join("lib").join("python3.12").join("site-packages").join("flask")).unwrap();
        }

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert!(!servers[0].needs_setup, "Should NOT need setup when venv and deps exist");
        assert!(servers[0].setup_commands.is_empty(), "Should have no setup commands");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_detect_python_needs_setup_venv_exists_deps_missing() {
        let dir = std::env::temp_dir().join("vm_test_py_deps_missing");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("requirements.txt"), "flask==2.0\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();
        // Create .venv directory WITHOUT the framework package in site-packages
        if cfg!(target_os = "windows") {
            std::fs::create_dir_all(dir.join(".venv").join("Scripts")).unwrap();
            std::fs::write(dir.join(".venv").join("Scripts").join("python.exe"), "").unwrap();
            std::fs::create_dir_all(dir.join(".venv").join("Lib").join("site-packages")).unwrap();
        } else {
            std::fs::create_dir_all(dir.join(".venv").join("bin")).unwrap();
            std::fs::write(dir.join(".venv").join("bin").join("python"), "").unwrap();
            std::fs::create_dir_all(dir.join(".venv").join("lib").join("python3.12").join("site-packages")).unwrap();
        }

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        assert!(servers[0].needs_setup, "Should need setup when venv exists but deps missing");
        // Should only have pip install (no venv creation since .venv exists)
        assert_eq!(servers[0].setup_commands.len(), 1, "Should skip venv creation");
        assert!(servers[0].setup_commands[0].contains("pip install"), "Should only pip install");
        let _ = std::fs::remove_dir_all(&dir);
    }

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
            assert!(servers[0].start_command.contains(".venv/Scripts/"), "start_command should use .venv prefix on Windows");
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
            assert!(cmds[1].contains(".venv/Scripts/pip"), "Windows pip path should use forward slashes (Git Bash)");
        } else {
            assert!(cmds[0].starts_with("python3 "), "Unix should use 'python3'");
            assert!(cmds[1].contains(".venv/bin/pip"), "Unix pip path should use forward slashes");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_requirements_txt_has_per_package_fallback() {
        let dir = std::env::temp_dir().join("vm_test_py_fallback");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("requirements.txt"), "flask==2.0\nscipy\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        let install_cmd = &servers[0].setup_commands.last().unwrap();
        // Should try full install first
        assert!(install_cmd.contains("-r requirements.txt"), "Should try full install first");
        // Should have per-package fallback with xargs
        assert!(install_cmd.contains("xargs -L1"), "Should fall back to per-package install");
        assert!(install_cmd.contains("|| ("), "Should use || for fallback");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_pyproject_toml_no_per_package_fallback() {
        let dir = std::env::temp_dir().join("vm_test_py_no_fallback");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("pyproject.toml"), "[project]\ndependencies = [\"flask\"]\n").unwrap();
        std::fs::write(dir.join("app.py"), "from flask import Flask\n").unwrap();

        let mut seen = std::collections::HashSet::new();
        let servers = detect_python_servers(&dir, &mut seen);
        assert_eq!(servers.len(), 1);
        let install_cmd = &servers[0].setup_commands.last().unwrap();
        assert!(install_cmd.contains("-e ."), "Should use editable install");
        assert!(!install_cmd.contains("xargs"), "pyproject.toml should NOT have per-package fallback");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
