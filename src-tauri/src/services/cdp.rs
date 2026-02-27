//! CDP accessibility tree parser.
//!
//! Converts Chrome DevTools Protocol `Accessibility.getFullAXTree` responses
//! into a human-readable tree string and a ref map (`@eN` → `RefEntry`).
//! Interactive and named content elements are assigned sequential refs that
//! MCP browser tools can use for element targeting.

use serde_json::Value;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single ref'd element from the accessibility tree.
#[derive(Debug, Clone)]
pub struct RefEntry {
    pub role: String,
    pub name: String,
    pub backend_node_id: Option<u32>,
    /// Disambiguation index when multiple elements share the same role+name.
    pub nth: Option<u32>,
}

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES: &[&str] = &[
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "treeitem",
];

const CONTENT_ROLES: &[&str] = &[
    "heading",
    "cell",
    "gridcell",
    "columnheader",
    "rowheader",
    "listitem",
    "article",
    "region",
    "main",
    "navigation",
];

/// Returns `true` if the role is interactive (always gets a ref).
pub fn is_interactive_role(role: &str) -> bool {
    INTERACTIVE_ROLES.contains(&role)
}

/// Returns `true` if the role is a content role (gets a ref only if named).
pub fn is_content_role(role: &str) -> bool {
    CONTENT_ROLES.contains(&role)
}

// ---------------------------------------------------------------------------
// JS selector builder
// ---------------------------------------------------------------------------

/// Escape single quotes for embedding in JS string literals.
fn js_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Build a JS expression (IIFE) that locates a DOM element by role + name.
///
/// Strategy:
/// 1. Try `querySelectorAll('[role="ROLE"]')` and match by `aria-label` or
///    `textContent`.
/// 2. Fall back to a tag-name mapping (button→`<button>`, link→`<a>`, etc.).
/// 3. Apply `nth` disambiguation if present.
/// 4. Return `null` if nothing matches.
pub fn build_js_selector(entry: &RefEntry) -> String {
    let role_esc = js_escape(&entry.role);
    let name_esc = js_escape(&entry.name);
    let nth_val = entry.nth.unwrap_or(0);

    // Tag-name fallback selectors per role.
    let tag_fallback = match entry.role.as_str() {
        "button" => "document.querySelectorAll('button')",
        "link" => "document.querySelectorAll('a')",
        "textbox" | "searchbox" => {
            "document.querySelectorAll('input, textarea')"
        }
        "heading" => "document.querySelectorAll('h1, h2, h3, h4, h5, h6')",
        "checkbox" => "document.querySelectorAll('input[type=\"checkbox\"]')",
        "radio" => "document.querySelectorAll('input[type=\"radio\"]')",
        "combobox" => "document.querySelectorAll('select')",
        "option" => "document.querySelectorAll('option')",
        "tab" => "document.querySelectorAll('[role=\"tab\"]')",
        _ => "null",
    };

    format!(
        r#"(function() {{
  var name = '{name_esc}';
  var nth = {nth_val};
  function matchName(el) {{
    var label = el.getAttribute('aria-label') || '';
    var text = (el.textContent || '').trim();
    return label === name || text === name;
  }}
  function pickNth(list) {{
    var matches = [];
    for (var i = 0; i < list.length; i++) {{
      if (matchName(list[i])) matches.push(list[i]);
    }}
    return matches[nth] || null;
  }}
  var byRole = document.querySelectorAll('[role="{role_esc}"]');
  var result = pickNth(byRole);
  if (result) return result;
  var fallback = {tag_fallback};
  if (fallback) return pickNth(fallback);
  return null;
}})()"#,
        name_esc = name_esc,
        nth_val = nth_val,
        role_esc = role_esc,
        tag_fallback = tag_fallback,
    )
}

// ---------------------------------------------------------------------------
// AX tree parser
// ---------------------------------------------------------------------------

/// Roles that are skipped entirely (structural / invisible).
const SKIP_ROLES: &[&str] = &[
    "WebArea",
    "RootWebArea",
    "none",
    "generic",
    "StaticText",
];

/// Parse a CDP `Accessibility.getFullAXTree` response into:
/// - A human-readable tree string (one line per notable element).
/// - A ref map (`"e1"` → `RefEntry`, `"e2"` → …).
///
/// Ref assignment rules:
/// - Interactive roles always get a ref.
/// - Content roles get a ref only if they have a non-empty name.
/// - Duplicate role+name pairs are disambiguated with `nth` (0, 1, 2, …).
/// - Structural / invisible roles are skipped.
pub fn parse_ax_tree(cdp_response: &Value) -> (String, HashMap<String, RefEntry>) {
    let empty_arr = Vec::new();
    let nodes = cdp_response
        .get("nodes")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_arr);

    // ------------------------------------------------------------------
    // First pass: collect candidate entries (role, name, backend_node_id)
    // ------------------------------------------------------------------
    struct Candidate {
        role: String,
        name: String,
        backend_node_id: Option<u32>,
    }

    let mut candidates: Vec<Candidate> = Vec::new();

    for node in nodes {
        let role = node
            .get("role")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if role.is_empty() || SKIP_ROLES.contains(&role) {
            continue;
        }

        let name = node
            .get("name")
            .and_then(|n| n.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let backend_node_id = node
            .get("backendDOMNodeId")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);

        let interactive = is_interactive_role(role);
        let content = is_content_role(role);

        if interactive || (content && !name.is_empty()) {
            candidates.push(Candidate {
                role: role.to_string(),
                name,
                backend_node_id,
            });
        } else if !name.is_empty() {
            // Named but neither interactive nor content — include in tree
            // text without a ref.
            candidates.push(Candidate {
                role: role.to_string(),
                name,
                backend_node_id: None,
            });
        }
    }

    // ------------------------------------------------------------------
    // Count role+name occurrences to detect duplicates
    // ------------------------------------------------------------------
    let mut pair_counts: HashMap<(String, String), u32> = HashMap::new();
    for c in &candidates {
        if is_interactive_role(&c.role) || is_content_role(&c.role) {
            *pair_counts
                .entry((c.role.clone(), c.name.clone()))
                .or_insert(0) += 1;
        }
    }

    // ------------------------------------------------------------------
    // Second pass: assign refs and build output
    // ------------------------------------------------------------------
    let mut ref_map: HashMap<String, RefEntry> = HashMap::new();
    let mut lines: Vec<String> = Vec::new();
    let mut counter: u32 = 1;
    // Track current nth index per role+name pair.
    let mut nth_tracker: HashMap<(String, String), u32> = HashMap::new();

    for c in &candidates {
        let gets_ref =
            is_interactive_role(&c.role) || (is_content_role(&c.role) && !c.name.is_empty());

        if gets_ref {
            let pair_key = (c.role.clone(), c.name.clone());
            let total = *pair_counts.get(&pair_key).unwrap_or(&1);
            let nth = if total > 1 {
                let idx = nth_tracker.entry(pair_key).or_insert(0);
                let val = *idx;
                *idx += 1;
                Some(val)
            } else {
                None
            };

            let ref_key = format!("e{}", counter);
            counter += 1;

            let nth_suffix = match nth {
                Some(n) => format!(" [nth={}]", n),
                None => String::new(),
            };
            lines.push(format!(
                "- {} \"{}\" @{}{}",
                c.role, c.name, ref_key, nth_suffix
            ));

            ref_map.insert(
                ref_key,
                RefEntry {
                    role: c.role.clone(),
                    name: c.name.clone(),
                    backend_node_id: c.backend_node_id,
                    nth,
                },
            );
        } else {
            // Named element without a ref.
            lines.push(format!("- {} \"{}\"", c.role, c.name));
        }
    }

    (lines.join("\n"), ref_map)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_ax_nodes_basic() {
        let response = json!({
            "nodes": [
                {
                    "nodeId": "1",
                    "role": { "type": "role", "value": "heading" },
                    "name": { "type": "computedString", "value": "Welcome" },
                    "backendDOMNodeId": 10,
                    "childIds": []
                },
                {
                    "nodeId": "2",
                    "role": { "type": "role", "value": "button" },
                    "name": { "type": "computedString", "value": "Submit" },
                    "backendDOMNodeId": 20,
                    "childIds": []
                },
                {
                    "nodeId": "3",
                    "role": { "type": "role", "value": "textbox" },
                    "name": { "type": "computedString", "value": "Email" },
                    "backendDOMNodeId": 30,
                    "childIds": []
                }
            ]
        });

        let (tree, refs) = parse_ax_tree(&response);

        assert_eq!(refs.len(), 3, "Expected 3 refs, got {}", refs.len());

        // Check each ref exists with the correct role and name.
        let e1 = refs.get("e1").expect("e1 missing");
        assert_eq!(e1.role, "heading");
        assert_eq!(e1.name, "Welcome");
        assert_eq!(e1.backend_node_id, Some(10));

        let e2 = refs.get("e2").expect("e2 missing");
        assert_eq!(e2.role, "button");
        assert_eq!(e2.name, "Submit");

        let e3 = refs.get("e3").expect("e3 missing");
        assert_eq!(e3.role, "textbox");
        assert_eq!(e3.name, "Email");

        // Tree text should contain all three refs.
        assert!(tree.contains("@e1"), "tree missing @e1");
        assert!(tree.contains("@e2"), "tree missing @e2");
        assert!(tree.contains("@e3"), "tree missing @e3");
    }

    #[test]
    fn test_is_interactive_role() {
        assert!(is_interactive_role("button"));
        assert!(is_interactive_role("link"));
        assert!(is_interactive_role("textbox"));

        assert!(!is_interactive_role("generic"));
        assert!(!is_interactive_role("none"));
        assert!(!is_interactive_role("StaticText"));
        assert!(!is_interactive_role("heading")); // content, not interactive
    }

    #[test]
    fn test_is_content_role() {
        assert!(is_content_role("heading"));
        assert!(is_content_role("cell"));

        assert!(!is_content_role("generic"));
        assert!(!is_content_role("group"));
        assert!(!is_content_role("button")); // interactive, not content
    }

    #[test]
    fn test_build_js_selector() {
        let entry = RefEntry {
            role: "button".to_string(),
            name: "Submit".to_string(),
            backend_node_id: Some(42),
            nth: None,
        };

        let js = build_js_selector(&entry);
        assert!(!js.is_empty(), "JS selector should not be empty");
        assert!(
            js.contains("button") || js.contains("Submit"),
            "JS should reference role or name"
        );
        assert!(js.contains("Submit"), "JS should contain the name");
    }

    #[test]
    fn test_duplicate_role_name_gets_nth() {
        let response = json!({
            "nodes": [
                {
                    "nodeId": "1",
                    "role": { "type": "role", "value": "button" },
                    "name": { "type": "computedString", "value": "Delete" },
                    "backendDOMNodeId": 50,
                    "childIds": []
                },
                {
                    "nodeId": "2",
                    "role": { "type": "role", "value": "button" },
                    "name": { "type": "computedString", "value": "Delete" },
                    "backendDOMNodeId": 51,
                    "childIds": []
                }
            ]
        });

        let (_tree, refs) = parse_ax_tree(&response);

        assert_eq!(refs.len(), 2, "Expected 2 refs for duplicate buttons");

        let e1 = refs.get("e1").expect("e1 missing");
        assert_eq!(e1.nth, Some(0), "First duplicate should have nth=0");

        let e2 = refs.get("e2").expect("e2 missing");
        assert_eq!(e2.nth, Some(1), "Second duplicate should have nth=1");

        // Both should be buttons named Delete.
        assert_eq!(e1.role, "button");
        assert_eq!(e1.name, "Delete");
        assert_eq!(e2.role, "button");
        assert_eq!(e2.name, "Delete");
    }

    #[test]
    fn test_parse_empty_tree() {
        let response = json!({ "nodes": [] });
        let (tree, refs) = parse_ax_tree(&response);
        assert!(refs.is_empty(), "Empty tree should produce no refs");
        assert!(tree.is_empty(), "Empty tree should produce empty text");
    }
}
