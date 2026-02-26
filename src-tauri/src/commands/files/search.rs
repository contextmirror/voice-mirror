use super::super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use regex::Regex;
use tracing::info;

/// Build a regex from search parameters.
///
/// - Plain text queries are escaped. Regex queries are compiled as-is.
/// - `whole_word` wraps in `\b...\b`.
/// - `case_sensitive` controls the case-insensitive flag (default: insensitive).
fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    is_regex: bool,
    whole_word: bool,
) -> Result<Regex, String> {
    let pattern = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let pattern = if whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };

    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))
}

/// Check if a relative path matches a comma-separated glob pattern list.
///
/// Each pattern is trimmed. Patterns like `*.rs` match the file extension.
/// Patterns like `src/**` match path prefixes. Uses simple matching:
/// - `*.ext` matches files ending with `.ext`
/// - `dir/*` or `dir/**` matches paths starting with `dir/`
/// - Exact name matches anywhere in the path
fn matches_glob_list(rel_path: &str, pattern_list: &str) -> bool {
    let lower_path = rel_path.to_lowercase();
    for raw_pattern in pattern_list.split(',') {
        let pat = raw_pattern.trim();
        if pat.is_empty() {
            continue;
        }
        let lower_pat = pat.to_lowercase();
        // *.ext — extension match
        if let Some(ext) = lower_pat.strip_prefix("*.") {
            if lower_path.ends_with(&format!(".{}", ext)) {
                return true;
            }
        }
        // dir/* or dir/** — prefix match
        else if let Some(prefix) = lower_pat.strip_suffix("/**") {
            if lower_path.starts_with(&format!("{}/", prefix)) {
                return true;
            }
        } else if let Some(prefix) = lower_pat.strip_suffix("/*") {
            if lower_path.starts_with(&format!("{}/", prefix)) {
                return true;
            }
        }
        // Exact segment match (e.g. "node_modules" matches any path containing it)
        else if lower_path == lower_pat
            || lower_path.starts_with(&format!("{}/", lower_pat))
            || lower_path.contains(&format!("/{}/", lower_pat))
            || lower_path.ends_with(&format!("/{}", lower_pat))
        {
            return true;
        }
    }
    false
}

/// Search file contents across the project using regex.
///
/// Walks the project tree (gitignore-aware), reads each text file, and
/// finds all lines matching the query. Results are grouped by file with
/// line number, column range, and trimmed text for each match.
///
/// Caps: 200 files with matches, 5000 total matches. If either cap is hit,
/// `truncated` is set to true in the response.
#[tauri::command]
pub fn search_content(
    query: String,
    root: Option<String>,
    case_sensitive: Option<bool>,
    is_regex: Option<bool>,
    whole_word: Option<bool>,
    include_pattern: Option<String>,
    exclude_pattern: Option<String>,
) -> IpcResponse {
    if query.is_empty() {
        return IpcResponse::err("Search query cannot be empty");
    }

    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };

    let re = match build_search_regex(
        &query,
        case_sensitive.unwrap_or(false),
        is_regex.unwrap_or(false),
        whole_word.unwrap_or(false),
    ) {
        Ok(r) => r,
        Err(e) => return IpcResponse::err(e),
    };

    const MAX_FILES: usize = 200;
    const MAX_MATCHES: usize = 5000;
    const MAX_LINE_LEN: usize = 300;

    let mut file_results: Vec<serde_json::Value> = Vec::new();
    let mut total_matches: usize = 0;
    let mut truncated = false;

    let walker = ignore::WalkBuilder::new(&canon_root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build();

    for entry in walker.flatten() {
        if truncated {
            break;
        }

        // Skip directories
        if entry.file_type().map_or(true, |ft| ft.is_dir()) {
            continue;
        }

        let path = entry.path();
        let rel_path = match path.strip_prefix(&canon_root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        // Skip .git internals
        if rel_path.starts_with(".git/") || rel_path == ".git" {
            continue;
        }

        // Apply include pattern filter
        if let Some(ref include) = include_pattern {
            if !include.trim().is_empty() && !matches_glob_list(&rel_path, include) {
                continue;
            }
        }

        // Apply exclude pattern filter
        if let Some(ref exclude) = exclude_pattern {
            if !exclude.trim().is_empty() && matches_glob_list(&rel_path, exclude) {
                continue;
            }
        }

        // Read file, skip binary
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let content = match String::from_utf8(bytes) {
            Ok(c) => c,
            Err(_) => continue, // Skip binary files
        };

        let mut line_matches: Vec<serde_json::Value> = Vec::new();

        for (line_idx, line) in content.lines().enumerate() {
            if total_matches >= MAX_MATCHES {
                truncated = true;
                break;
            }

            for mat in re.find_iter(line) {
                if total_matches >= MAX_MATCHES {
                    truncated = true;
                    break;
                }

                // Trim long lines, keeping match visible.
                // Use char boundaries to avoid panicking on multi-byte UTF-8.
                let (display_text, col_start, col_end) = if line.len() > MAX_LINE_LEN {
                    // Center the trim window around the match
                    let match_mid = (mat.start() + mat.end()) / 2;
                    let window_start = match_mid.saturating_sub(MAX_LINE_LEN / 2);
                    let window_end = (window_start + MAX_LINE_LEN).min(line.len());
                    let window_start = if window_end == line.len() {
                        window_end.saturating_sub(MAX_LINE_LEN)
                    } else {
                        window_start
                    };

                    // Snap to char boundaries to avoid slicing mid-character
                    let safe_start = if line.is_char_boundary(window_start) {
                        window_start
                    } else {
                        line.ceil_char_boundary(window_start)
                    };
                    let safe_end = if line.is_char_boundary(window_end) {
                        window_end
                    } else {
                        line.floor_char_boundary(window_end)
                    };

                    let trimmed = &line[safe_start..safe_end];
                    let adj_start = mat.start().saturating_sub(safe_start);
                    let adj_end = mat.end().saturating_sub(safe_start).min(trimmed.len());
                    (trimmed.to_string(), adj_start as u32, adj_end as u32)
                } else {
                    (line.to_string(), mat.start() as u32, mat.end() as u32)
                };

                line_matches.push(serde_json::json!({
                    "line": (line_idx + 1) as u32,
                    "text": display_text,
                    "col_start": col_start,
                    "col_end": col_end,
                }));

                total_matches += 1;
            }
        }

        if !line_matches.is_empty() {
            if file_results.len() >= MAX_FILES {
                truncated = true;
                break;
            }

            file_results.push(serde_json::json!({
                "path": rel_path,
                "matches": line_matches,
            }));
        }
    }

    info!(
        "search_content: '{}' → {} matches in {} files{}",
        query,
        total_matches,
        file_results.len(),
        if truncated { " (truncated)" } else { "" }
    );

    IpcResponse::ok(serde_json::json!({
        "matches": file_results,
        "totalMatches": total_matches,
        "truncated": truncated,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_search_regex_literal() {
        let re = build_search_regex("hello", false, false, false).unwrap();
        assert!(re.is_match("say Hello world"));
        assert!(re.is_match("say hello world"));
    }

    #[test]
    fn test_build_search_regex_case_sensitive() {
        let re = build_search_regex("Hello", true, false, false).unwrap();
        assert!(re.is_match("say Hello world"));
        assert!(!re.is_match("say hello world"));
    }

    #[test]
    fn test_build_search_regex_whole_word() {
        let re = build_search_regex("test", false, false, true).unwrap();
        assert!(re.is_match("run test now"));
        assert!(!re.is_match("testing123"));
    }

    #[test]
    fn test_build_search_regex_regex_mode() {
        let re = build_search_regex(r"fn\s+\w+", false, true, false).unwrap();
        assert!(re.is_match("fn main() {"));
        assert!(!re.is_match("function main"));
    }

    #[test]
    fn test_build_search_regex_invalid() {
        let result = build_search_regex("[invalid", false, true, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid regex"));
    }

    #[test]
    fn test_build_search_regex_special_chars_escaped() {
        // In literal mode, regex special chars should be escaped
        let re = build_search_regex("foo.bar()", false, false, false).unwrap();
        assert!(re.is_match("foo.bar()"));
        assert!(!re.is_match("fooXbar!!"));
    }

    #[test]
    fn test_matches_glob_extension() {
        assert!(matches_glob_list("src/main.rs", "*.rs"));
        assert!(matches_glob_list("src/lib/utils.js", "*.js,*.ts"));
        assert!(!matches_glob_list("src/main.rs", "*.js"));
    }

    #[test]
    fn test_matches_glob_directory() {
        assert!(matches_glob_list("node_modules/foo/bar.js", "node_modules"));
        assert!(matches_glob_list("src/lib/test.js", "src/**"));
        assert!(!matches_glob_list("other/test.js", "src/**"));
    }

    #[test]
    fn test_matches_glob_empty() {
        assert!(!matches_glob_list("anything.rs", ""));
        assert!(!matches_glob_list("anything.rs", "  , ,"));
    }
}
