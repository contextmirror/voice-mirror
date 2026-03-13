//! Response formatting helpers for LSP results.
//!
//! Contains `normalize_location` (Location / LocationLink → simple `{uri, range}`)
//! and `quickinfo_to_markdown` (tsserver quickinfo → VS Code-style markdown).

use serde_json::Value;

/// Normalize a Location or LocationLink into a simple `{ uri, range }` object.
pub(crate) fn normalize_location(loc: &Value) -> Value {
    // LocationLink has targetUri/targetRange
    if let Some(target_uri) = loc.get("targetUri") {
        let range = loc
            .get("targetSelectionRange")
            .or_else(|| loc.get("targetRange"))
            .cloned()
            .unwrap_or(Value::Null);
        return serde_json::json!({ "uri": target_uri, "range": range });
    }

    // Location has uri/range
    serde_json::json!({
        "uri": loc.get("uri").cloned().unwrap_or(Value::Null),
        "range": loc.get("range").cloned().unwrap_or(Value::Null),
    })
}

/// Convert a tsserver `quickinfo` response body to markdown matching VS Code's format.
///
/// The response body contains:
/// - `displayString`: the type signature (wrapped in a TypeScript code block)
/// - `documentation`: `SymbolDisplayPart[]` (joined as plain text)
/// - `tags`: `JSDocTagInfo[]` (formatted as `*@name* \`param\` — description`)
#[allow(dead_code)]
pub(crate) fn quickinfo_to_markdown(body: &Value) -> String {
    // VS Code renders hover as separate markdown parts with --- dividers between them.
    // We replicate that: code block | --- | documentation | --- | tags
    let mut code_block = String::new();
    let mut doc_text = String::new();
    let mut tag_lines: Vec<String> = Vec::new();

    // displayString → ```typescript code block (matches VS Code hover.ts:89-90)
    if let Some(display) = body.get("displayString").and_then(|v| v.as_str()) {
        if !display.is_empty() {
            code_block = format!("```typescript\n{}\n```", display);
        }
    }

    // documentation → string or SymbolDisplayPart[] → text
    if let Some(doc_val) = body.get("documentation") {
        if let Some(s) = doc_val.as_str() {
            // Plain string format
            doc_text = s.trim().to_string();
        } else if let Some(docs) = doc_val.as_array() {
            // SymbolDisplayPart[] format
            let text: String = docs
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("");
            doc_text = text.trim().to_string();
        }
    }

    // tags → JSDocTagInfo[] → formatted markdown (matches VS Code textRendering.ts)
    if let Some(tags) = body.get("tags").and_then(|v| v.as_array()) {
        for tag in tags {
            let name = tag.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }

            let tag_text_val = tag.get("text");
            let label = format!("*@{}*", name);

            // Helper: extract the full text from either a string or SymbolDisplayPart[]
            let full_text = match tag_text_val {
                Some(v) if v.is_string() => v.as_str().unwrap_or("").to_string(),
                Some(v) if v.is_array() => {
                    v.as_array().unwrap()
                        .iter()
                        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join("")
                }
                _ => String::new(),
            };

            match name {
                "param" | "template" => {
                    // Extract parameter name and description.
                    // Array format: find parameterName/typeParameterName kind part
                    // String format: "paramName - description" or "paramName description"
                    if let Some(arr) = tag_text_val.and_then(|v| v.as_array()) {
                        let param_name = arr
                            .iter()
                            .find(|p| {
                                p.get("kind").and_then(|k| k.as_str())
                                    == Some("parameterName")
                                    || p.get("kind").and_then(|k| k.as_str())
                                        == Some("typeParameterName")
                            })
                            .and_then(|p| p.get("text").and_then(|t| t.as_str()))
                            .unwrap_or("");
                        let doc: String = arr
                            .iter()
                            .filter(|p| {
                                p.get("kind").and_then(|k| k.as_str()) == Some("text")
                            })
                            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("");
                        let doc = doc.trim_start_matches(|c: char| c == '-' || c == ' ');
                        if param_name.is_empty() {
                            tag_lines.push(label);
                        } else if doc.is_empty() {
                            tag_lines.push(format!("{} `{}`", label, param_name));
                        } else {
                            tag_lines.push(format!(
                                "{} `{}` \u{2014} {}",
                                label, param_name, doc
                            ));
                        }
                    } else if !full_text.is_empty() {
                        // String format: "paramName - description" or "paramName description"
                        let (pname, pdesc) = if let Some(dash_idx) = full_text.find(" - ") {
                            (&full_text[..dash_idx], full_text[dash_idx + 3..].trim())
                        } else if let Some(space_idx) = full_text.find(' ') {
                            (&full_text[..space_idx], full_text[space_idx + 1..].trim())
                        } else {
                            (full_text.as_str(), "")
                        };
                        if pdesc.is_empty() {
                            tag_lines.push(format!("{} `{}`", label, pname));
                        } else {
                            tag_lines.push(format!(
                                "{} `{}` \u{2014} {}",
                                label, pname, pdesc
                            ));
                        }
                    } else {
                        tag_lines.push(label);
                    }
                }
                "example" => {
                    if full_text.is_empty() {
                        tag_lines.push(label);
                    } else {
                        tag_lines.push(format!("{}\n```tsx\n{}\n```", label, full_text));
                    }
                }
                _ => {
                    if full_text.is_empty() {
                        tag_lines.push(label);
                    } else {
                        tag_lines.push(format!("{} \u{2014} {}", label, full_text));
                    }
                }
            }
        }
    }

    // Assemble with --- separators between sections (matching VS Code's hover rendering)
    let mut sections: Vec<String> = Vec::new();
    if !code_block.is_empty() {
        sections.push(code_block);
    }
    if !doc_text.is_empty() {
        sections.push(doc_text);
    }
    if !tag_lines.is_empty() {
        sections.push(tag_lines.join("\n\n"));
    }
    sections.join("\n\n---\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quickinfo_display_string_becomes_code_block() {
        let body = serde_json::json!({
            "displayString": "(parameter) options: CreateOptions",
            "documentation": [],
            "tags": []
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("```typescript\n(parameter) options: CreateOptions\n```"),
            "displayString should be wrapped in a typescript code block, got: {}",
            md
        );
    }

    #[test]
    fn quickinfo_documentation_joined_as_text() {
        let body = serde_json::json!({
            "displayString": "(parameter) x: number",
            "documentation": [
                { "text": "The x coordinate", "kind": "text" }
            ],
            "tags": []
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("The x coordinate"),
            "documentation text should appear in output, got: {}",
            md
        );
    }

    #[test]
    fn quickinfo_multi_part_documentation() {
        let body = serde_json::json!({
            "displayString": "function foo(): void",
            "documentation": [
                { "text": "Does ", "kind": "text" },
                { "text": "something", "kind": "text" },
                { "text": " useful.", "kind": "text" }
            ],
            "tags": []
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("Does something useful."),
            "multi-part documentation should be joined, got: {}",
            md
        );
    }

    #[test]
    fn quickinfo_param_tag_formatted() {
        let body = serde_json::json!({
            "displayString": "function greet(name: string): void",
            "documentation": [],
            "tags": [
                {
                    "name": "param",
                    "text": [
                        { "text": "name", "kind": "parameterName" },
                        { "text": " ", "kind": "space" },
                        { "text": "- The person's name", "kind": "text" }
                    ]
                }
            ]
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("*@param*") && md.contains("`name`"),
            "param tag should be formatted with italic label and code param, got: {}",
            md
        );
    }

    #[test]
    fn quickinfo_returns_tag_formatted() {
        let body = serde_json::json!({
            "displayString": "function add(a: number, b: number): number",
            "documentation": [],
            "tags": [
                {
                    "name": "returns",
                    "text": [
                        { "text": "The sum of a and b", "kind": "text" }
                    ]
                }
            ]
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("*@returns*"),
            "returns tag should have italic label, got: {}",
            md
        );
        assert!(
            md.contains("The sum of a and b"),
            "returns tag body should appear, got: {}",
            md
        );
    }

    #[test]
    fn quickinfo_empty_body_returns_empty() {
        let body = serde_json::json!({});
        let md = quickinfo_to_markdown(&body);
        assert!(md.is_empty(), "empty body should produce empty string, got: {}", md);
    }

    #[test]
    fn quickinfo_display_string_only() {
        let body = serde_json::json!({
            "displayString": "const MAX: number"
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("```typescript\nconst MAX: number\n```"),
            "should work with just displayString, got: {}",
            md
        );
        // Should not have trailing newlines or separators
        assert!(
            !md.ends_with("\n\n"),
            "should not have trailing double newline"
        );
    }

    #[test]
    fn quickinfo_example_tag_becomes_codeblock() {
        let body = serde_json::json!({
            "displayString": "function parse(s: string): Data",
            "documentation": [],
            "tags": [
                {
                    "name": "example",
                    "text": [
                        { "text": "parse('{\"a\":1}')", "kind": "text" }
                    ]
                }
            ]
        });
        let md = quickinfo_to_markdown(&body);
        assert!(
            md.contains("*@example*"),
            "example tag should have label, got: {}",
            md
        );
    }
}
