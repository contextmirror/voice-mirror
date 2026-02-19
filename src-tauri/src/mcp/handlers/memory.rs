//! Memory system tool handlers.
//!
//! Implements the 6 memory tools:
//! - `memory_search`   -- keyword-based search (semantic search can be added later)
//! - `memory_remember`  -- store a memory with tier
//! - `memory_forget`    -- delete a memory
//! - `memory_get`       -- read full content of a memory chunk
//! - `memory_stats`     -- system statistics
//! - `memory_flush`     -- batch save before context compaction
//!
//! Storage layout:
//! ```
//! {data_dir}/memory/
//!   index.json       -- Chunk index with metadata (tier, timestamps, etc.)
//!   MEMORY.md        -- Primary memory file (human-readable, append-only)
//!   daily/           -- Daily conversation logs (YYYY-MM-DD.md)
//! ```

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

use super::McpToolResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// TTL for memory tiers.
const NOTES_TTL_HOURS: u64 = 24;
const STABLE_TTL_HOURS: u64 = 7 * 24; // 7 days
// core = permanent (no TTL)

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// The memory index file stores metadata about all memory chunks.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemoryIndex {
    #[serde(default)]
    chunks: Vec<MemoryChunk>,
    #[serde(default)]
    version: u32,
}

impl Default for MemoryIndex {
    fn default() -> Self {
        Self {
            chunks: vec![],
            version: 1,
        }
    }
}

/// A single memory chunk with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemoryChunk {
    /// Unique chunk ID (e.g., "chunk_1718456789_a1b2c3").
    id: String,
    /// The memory content text.
    content: String,
    /// Memory tier: "core", "stable", or "notes".
    tier: String,
    /// When this memory was created (ISO 8601).
    created_at: String,
    /// When this memory expires (ISO 8601), or null for permanent.
    #[serde(default)]
    expires_at: Option<String>,
    /// Source file path (relative to memory dir).
    #[serde(default)]
    source_file: Option<String>,
    /// Start line in source file.
    #[serde(default)]
    start_line: Option<usize>,
    /// End line in source file.
    #[serde(default)]
    end_line: Option<usize>,
}

/// Search result with relevance scoring.
#[derive(Debug, Clone)]
struct SearchResult {
    chunk: MemoryChunk,
    score: f64,
    keyword_score: f64,
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

fn memory_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("memory")
}

fn index_path(data_dir: &Path) -> PathBuf {
    memory_dir(data_dir).join("index.json")
}

fn memory_file_path(data_dir: &Path) -> PathBuf {
    memory_dir(data_dir).join("MEMORY.md")
}

fn daily_dir(data_dir: &Path) -> PathBuf {
    memory_dir(data_dir).join("daily")
}

/// Read the memory index, creating it if it doesn't exist.
async fn read_index(data_dir: &Path) -> MemoryIndex {
    let path = index_path(data_dir);
    match tokio::fs::read_to_string(&path).await {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => MemoryIndex::default(),
    }
}

/// Write the memory index atomically.
async fn write_index(data_dir: &Path, index: &MemoryIndex) -> Result<(), String> {
    let path = index_path(data_dir);
    let json = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Failed to serialize index: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, &json)
        .await
        .map_err(|e| format!("Failed to write index: {}", e))?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| format!("Failed to rename index: {}", e))?;
    Ok(())
}

/// Ensure memory directories exist.
async fn ensure_dirs(data_dir: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(memory_dir(data_dir))
        .await
        .map_err(|e| format!("Failed to create memory dir: {}", e))?;
    tokio::fs::create_dir_all(daily_dir(data_dir))
        .await
        .map_err(|e| format!("Failed to create daily dir: {}", e))?;
    Ok(())
}

/// Get current time as ISO 8601 string.
fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let (year, month, day) = days_to_date(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_date(mut days: i64) -> (i64, u32, u32) {
    days += 719468;
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = (days - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Generate a unique chunk ID.
fn generate_chunk_id() -> String {
    let ts = now_ms();
    let ptr = Box::new(0u8);
    let addr = &*ptr as *const u8 as usize;
    let rand = ((addr as u64).wrapping_mul(6364136223846793005).wrapping_add(ts)) as u32;
    format!("chunk_{}_{:06x}", ts, rand & 0xFFFFFF)
}

/// Calculate future expiry time for a tier.
fn expiry_for_tier(tier: &str) -> Option<String> {
    let hours = match tier {
        "notes" => NOTES_TTL_HOURS,
        "stable" => STABLE_TTL_HOURS,
        "core" => return None, // permanent
        _ => STABLE_TTL_HOURS, // default to stable
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let expiry_secs = now.as_secs() + hours * 3600;
    let millis = now.subsec_millis();
    let days = expiry_secs / 86400;
    let tod = expiry_secs % 86400;
    let (year, month, day) = days_to_date(days as i64);
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60,
        millis
    ))
}

/// Parse ISO timestamp to epoch milliseconds.
fn parse_iso_to_ms(iso: &str) -> Option<u64> {
    let parts: Vec<&str> = iso.split('T').collect();
    if parts.len() != 2 {
        return None;
    }
    let date_parts: Vec<u64> = parts[0].split('-').filter_map(|s| s.parse().ok()).collect();
    if date_parts.len() != 3 {
        return None;
    }
    let time_str = parts[1].trim_end_matches('Z');
    let time_parts: Vec<&str> = time_str.split('.').collect();
    let hms: Vec<u64> = time_parts[0]
        .split(':')
        .filter_map(|s| s.parse().ok())
        .collect();
    if hms.len() != 3 {
        return None;
    }
    let millis = if time_parts.len() > 1 {
        time_parts[1].parse::<u64>().unwrap_or(0)
    } else {
        0
    };
    // Simple: days since epoch * 86400 + time of day
    // (This is a simplified calculation for the epoch-based format we produce)
    let y = date_parts[0] as i64;
    let m = date_parts[1] as u32;
    let d = date_parts[2] as u32;
    let days = date_to_days(y, m, d);
    let total_secs = days as u64 * 86400 + hms[0] * 3600 + hms[1] * 60 + hms[2];
    Some(total_secs * 1000 + millis)
}

fn date_to_days(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let m = month;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

/// Clean up expired memories from the index.
async fn cleanup_expired(data_dir: &Path) -> usize {
    let mut index = read_index(data_dir).await;
    let now = now_ms();
    let before = index.chunks.len();

    index.chunks.retain(|chunk| {
        if let Some(ref expires) = chunk.expires_at {
            if let Some(exp_ms) = parse_iso_to_ms(expires) {
                return exp_ms > now;
            }
        }
        true // no expiry = keep
    });

    let removed = before - index.chunks.len();
    if removed > 0 {
        if let Err(e) = write_index(data_dir, &index).await {
            warn!("[Memory] Failed to write cleaned index: {}", e);
        } else {
            info!("[Memory] Cleaned up {} expired memories", removed);
        }
    }
    removed
}

// ---------------------------------------------------------------------------
// Keyword search
// ---------------------------------------------------------------------------

/// Simple keyword-based search. Scores each chunk based on term frequency.
fn keyword_search(
    chunks: &[MemoryChunk],
    query: &str,
    max_results: usize,
    min_score: f64,
) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    let query_terms: Vec<&str> = query_lower.split_whitespace().collect();

    if query_terms.is_empty() {
        return vec![];
    }

    let mut results: Vec<SearchResult> = chunks
        .iter()
        .filter_map(|chunk| {
            let content_lower = chunk.content.to_lowercase();
            let mut matched_terms = 0usize;
            let mut total_hits = 0usize;

            for term in &query_terms {
                let count = content_lower.matches(term).count();
                if count > 0 {
                    matched_terms += 1;
                    total_hits += count;
                }
            }

            if matched_terms == 0 {
                return None;
            }

            // Score: combination of term coverage and frequency
            let coverage = matched_terms as f64 / query_terms.len() as f64;
            let frequency = (total_hits as f64).ln_1p() / 10.0; // diminishing returns
            let score = coverage * 0.7 + frequency * 0.3;

            // Boost exact phrase match
            let score = if content_lower.contains(&query_lower) {
                (score + 0.3).min(1.0)
            } else {
                score
            };

            if score >= min_score {
                Some(SearchResult {
                    chunk: chunk.clone(),
                    score,
                    keyword_score: score,
                })
            } else {
                None
            }
        })
        .collect();

    // Sort by score descending
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Limit results
    results.truncate(max_results);
    results
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/// `memory_search` -- Keyword search over memories.
pub async fn handle_memory_search(args: &Value, data_dir: &Path) -> McpToolResult {
    let query = match args.get("query").and_then(|v| v.as_str()) {
        Some(q) => q,
        None => return McpToolResult::error("Error: query is required"),
    };
    let max_results = args
        .get("max_results")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .min(100)
        .max(1) as usize;
    let min_score = args
        .get("min_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.3);

    if let Err(e) = ensure_dirs(data_dir).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    // Cleanup expired memories first
    cleanup_expired(data_dir).await;

    let index = read_index(data_dir).await;
    let results = keyword_search(&index.chunks, query, max_results, min_score);

    if results.is_empty() {
        return McpToolResult::text(format!("No memories found for: \"{}\"", query));
    }

    let formatted: Vec<String> = results
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let score_info = format!(
                "[score: {:.2} | kw: {:.2}]",
                r.score, r.keyword_score
            );
            let location = r
                .chunk
                .source_file
                .as_deref()
                .unwrap_or("inline");
            let line_info = match (r.chunk.start_line, r.chunk.end_line) {
                (Some(s), Some(e)) => format!(":{}:{}", s, e),
                _ => String::new(),
            };
            let preview = if r.chunk.content.len() > 200 {
                format!("{}...", &r.chunk.content[..200])
            } else {
                r.chunk.content.clone()
            };
            let preview = preview.replace('\n', "\n   ");
            format!(
                "{}. {}\n   ID: {}\n   Tier: {} | Location: {}{}\n   ---\n   {}",
                i + 1,
                score_info,
                r.chunk.id,
                r.chunk.tier,
                location,
                line_info,
                preview
            )
        })
        .collect();

    McpToolResult::text(format!(
        "=== Memory Search: \"{}\" ===\nFound {} result(s)\n\n{}",
        query,
        results.len(),
        formatted.join("\n\n")
    ))
}

/// `memory_get` -- Read full content of a memory chunk or file.
pub async fn handle_memory_get(args: &Value, data_dir: &Path) -> McpToolResult {
    let path_or_id = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return McpToolResult::error("Error: path is required"),
    };
    let from_line = args.get("from_line").and_then(|v| v.as_u64()).map(|v| v as usize);
    let lines_count = args.get("lines").and_then(|v| v.as_u64()).map(|v| v as usize);

    if let Err(e) = ensure_dirs(data_dir).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    // Check if it's a chunk ID
    if path_or_id.starts_with("chunk_") {
        let index = read_index(data_dir).await;
        if let Some(chunk) = index.chunks.iter().find(|c| c.id == path_or_id) {
            return McpToolResult::text(format!(
                "=== Chunk: {} ===\nTier: {}\nCreated: {}\n---\n{}",
                chunk.id, chunk.tier, chunk.created_at, chunk.content
            ));
        } else {
            return McpToolResult::error(format!("Chunk not found: {}", path_or_id));
        }
    }

    // It's a file path -- resolve relative to memory dir
    let file_path = if Path::new(path_or_id).is_absolute() {
        PathBuf::from(path_or_id)
    } else {
        memory_dir(data_dir).join(path_or_id)
    };

    match tokio::fs::read_to_string(&file_path).await {
        Ok(content) => {
            // Apply line range if specified
            if let Some(from) = from_line {
                let all_lines: Vec<&str> = content.lines().collect();
                let from = from.saturating_sub(1); // Convert 1-indexed to 0-indexed
                let count = lines_count.unwrap_or(all_lines.len() - from);
                let end = (from + count).min(all_lines.len());
                let excerpt: String = all_lines[from..end].join("\n");
                McpToolResult::text(format!(
                    "=== File Excerpt: {} ===\nFrom line {} ({} lines)\n---\n{}",
                    path_or_id,
                    from + 1,
                    end - from,
                    excerpt
                ))
            } else {
                let size = content.len();
                McpToolResult::text(format!(
                    "=== File: {} ===\nSize: {} bytes\n---\n{}",
                    path_or_id, size, content
                ))
            }
        }
        Err(e) => McpToolResult::error(format!("Error reading file: {}", e)),
    }
}

/// `memory_remember` -- Store a new memory.
pub async fn handle_memory_remember(args: &Value, data_dir: &Path) -> McpToolResult {
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return McpToolResult::error("Error: content is required"),
    };
    let tier = args
        .get("tier")
        .and_then(|v| v.as_str())
        .unwrap_or("stable");

    if !["core", "stable", "notes"].contains(&tier) {
        return McpToolResult::error("Error: tier must be core, stable, or notes");
    }

    if let Err(e) = ensure_dirs(data_dir).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    let chunk = MemoryChunk {
        id: generate_chunk_id(),
        content: content.to_string(),
        tier: tier.to_string(),
        created_at: now_iso(),
        expires_at: expiry_for_tier(tier),
        source_file: Some("MEMORY.md".to_string()),
        start_line: None,
        end_line: None,
    };

    // Add to index
    let mut index = read_index(data_dir).await;
    index.chunks.push(chunk.clone());
    if let Err(e) = write_index(data_dir, &index).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    // Also append to MEMORY.md for human readability
    let memory_file = memory_file_path(data_dir);
    let entry = format!(
        "\n## [{} | {}] {}\n{}\n",
        tier,
        now_iso(),
        chunk.id,
        content
    );
    let current = tokio::fs::read_to_string(&memory_file)
        .await
        .unwrap_or_else(|_| "# Voice Mirror Memories\n".to_string());
    let updated = format!("{}{}", current, entry);
    if let Err(e) = tokio::fs::write(&memory_file, &updated).await {
        warn!("[Memory] Failed to append to MEMORY.md: {}", e);
    }

    McpToolResult::text(format!(
        "Memory saved to {} tier:\n\"{}\"",
        tier, content
    ))
}

/// `memory_forget` -- Delete a memory by content or chunk ID.
pub async fn handle_memory_forget(args: &Value, data_dir: &Path) -> McpToolResult {
    let content_or_id = match args.get("content_or_id").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return McpToolResult::error("Error: content_or_id is required"),
    };

    if let Err(e) = ensure_dirs(data_dir).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    let mut index = read_index(data_dir).await;

    // Find the chunk to remove
    let found = if content_or_id.starts_with("chunk_") {
        // Match by ID
        index.chunks.iter().position(|c| c.id == content_or_id)
    } else {
        // Match by content (partial match)
        index
            .chunks
            .iter()
            .position(|c| c.content.contains(content_or_id))
    };

    if let Some(idx) = found {
        let removed = index.chunks.remove(idx);
        if let Err(e) = write_index(data_dir, &index).await {
            return McpToolResult::error(format!("Error: {}", e));
        }
        McpToolResult::text(format!("Memory deleted:\n\"{}\"", removed.content))
    } else {
        McpToolResult::text(format!(
            "Memory not found: \"{}\"",
            content_or_id
        ))
    }
}

/// `memory_stats` -- Get memory system statistics.
pub async fn handle_memory_stats(_args: &Value, data_dir: &Path) -> McpToolResult {
    if let Err(e) = ensure_dirs(data_dir).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    let index = read_index(data_dir).await;

    // Count memories by tier
    let total = index.chunks.len();
    let core_count = index.chunks.iter().filter(|c| c.tier == "core").count();
    let stable_count = index.chunks.iter().filter(|c| c.tier == "stable").count();
    let notes_count = index.chunks.iter().filter(|c| c.tier == "notes").count();

    // Count daily logs
    let daily_count = match tokio::fs::read_dir(daily_dir(data_dir)).await {
        Ok(mut entries) => {
            let mut count = 0;
            while let Ok(Some(_)) = entries.next_entry().await {
                count += 1;
            }
            count
        }
        Err(_) => 0,
    };

    // Check MEMORY.md existence and size
    let memory_file = memory_file_path(data_dir);
    let memory_file_info = match tokio::fs::metadata(&memory_file).await {
        Ok(meta) => format!("{} ({} bytes)", memory_file.display(), meta.len()),
        Err(_) => "not created yet".to_string(),
    };

    let output = format!(
        "=== Voice Mirror Memory Stats ===\n\
         \n\
         ## Storage\n\
         Memory file: {}\n\
         Daily logs: {} files\n\
         Memories: {} (core: {}, stable: {}, notes: {})\n\
         \n\
         ## Index\n\
         Index path: {}\n\
         Total chunks: {}\n\
         \n\
         ## Embedding\n\
         Provider: none (keyword search only -- semantic search not yet implemented)\n\
         \n\
         ## Config\n\
         Search: keyword-based (TF-IDF style scoring)\n\
         TTL: notes=24h, stable=7d, core=permanent",
        memory_file_info,
        daily_count,
        total,
        core_count,
        stable_count,
        notes_count,
        index_path(data_dir).display(),
        total,
    );

    McpToolResult::text(output)
}

/// `memory_flush` -- Flush context to persistent memory before compaction.
pub async fn handle_memory_flush(args: &Value, data_dir: &Path) -> McpToolResult {
    if let Err(e) = ensure_dirs(data_dir).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    let topics = args
        .get("topics")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let decisions = args
        .get("decisions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let action_items = args
        .get("action_items")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let summary = args.get("summary").and_then(|v| v.as_str());

    let mut flushed = 0usize;
    let now = now_iso();

    let mut index = read_index(data_dir).await;

    // Store each item as a stable memory
    if let Some(summary) = summary {
        if !summary.is_empty() {
            index.chunks.push(MemoryChunk {
                id: generate_chunk_id(),
                content: format!("[Session Summary] {}", summary),
                tier: "stable".to_string(),
                created_at: now.clone(),
                expires_at: expiry_for_tier("stable"),
                source_file: None,
                start_line: None,
                end_line: None,
            });
            flushed += 1;
        }
    }

    for topic in &topics {
        index.chunks.push(MemoryChunk {
            id: generate_chunk_id(),
            content: format!("[Topic] {}", topic),
            tier: "stable".to_string(),
            created_at: now.clone(),
            expires_at: expiry_for_tier("stable"),
            source_file: None,
            start_line: None,
            end_line: None,
        });
        flushed += 1;
    }

    for decision in &decisions {
        index.chunks.push(MemoryChunk {
            id: generate_chunk_id(),
            content: format!("[Decision] {}", decision),
            tier: "stable".to_string(),
            created_at: now.clone(),
            expires_at: expiry_for_tier("stable"),
            source_file: None,
            start_line: None,
            end_line: None,
        });
        flushed += 1;
    }

    for item in &action_items {
        index.chunks.push(MemoryChunk {
            id: generate_chunk_id(),
            content: format!("[Action Item] {}", item),
            tier: "notes".to_string(),
            created_at: now.clone(),
            expires_at: expiry_for_tier("notes"),
            source_file: None,
            start_line: None,
            end_line: None,
        });
        flushed += 1;
    }

    if flushed > 0 {
        if let Err(e) = write_index(data_dir, &index).await {
            return McpToolResult::error(format!("Error: {}", e));
        }
    }

    McpToolResult::text(format!(
        "Flushed {} item(s) to persistent memory before compaction.",
        flushed
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyword_search_basic() {
        let chunks = vec![
            MemoryChunk {
                id: "chunk_1".into(),
                content: "The user prefers dark mode themes".into(),
                tier: "core".into(),
                created_at: "2024-01-01T00:00:00.000Z".into(),
                expires_at: None,
                source_file: None,
                start_line: None,
                end_line: None,
            },
            MemoryChunk {
                id: "chunk_2".into(),
                content: "Meeting notes from Monday standup".into(),
                tier: "stable".into(),
                created_at: "2024-01-01T00:00:00.000Z".into(),
                expires_at: None,
                source_file: None,
                start_line: None,
                end_line: None,
            },
        ];

        let results = keyword_search(&chunks, "dark mode", 5, 0.1);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].chunk.id, "chunk_1");
    }

    #[test]
    fn test_keyword_search_no_match() {
        let chunks = vec![MemoryChunk {
            id: "chunk_1".into(),
            content: "Hello world".into(),
            tier: "core".into(),
            created_at: "2024-01-01T00:00:00.000Z".into(),
            expires_at: None,
            source_file: None,
            start_line: None,
            end_line: None,
        }];

        let results = keyword_search(&chunks, "quantum physics", 5, 0.1);
        assert!(results.is_empty());
    }

    #[test]
    fn test_expiry_for_tier() {
        assert!(expiry_for_tier("core").is_none());
        assert!(expiry_for_tier("stable").is_some());
        assert!(expiry_for_tier("notes").is_some());
    }

    #[test]
    fn test_generate_chunk_id() {
        let id = generate_chunk_id();
        assert!(id.starts_with("chunk_"));
    }

    #[tokio::test]
    async fn test_remember_and_search() {
        let data_dir = std::env::temp_dir().join("mcp_test_memory");
        let _ = tokio::fs::create_dir_all(&data_dir).await;

        // Remember something
        let args = serde_json::json!({
            "content": "The user's favorite color is blue",
            "tier": "core"
        });
        let result = handle_memory_remember(&args, &data_dir).await;
        assert!(!result.is_error);

        // Search for it
        let args = serde_json::json!({ "query": "favorite color" });
        let result = handle_memory_search(&args, &data_dir).await;
        assert!(!result.is_error);
        // Should find the memory
        if let Some(crate::mcp::handlers::McpContent::Text { text }) = result.content.first() {
            assert!(text.contains("blue"));
        }

        let _ = tokio::fs::remove_dir_all(&data_dir).await;
    }

    #[tokio::test]
    async fn test_memory_stats_empty() {
        let data_dir = std::env::temp_dir().join("mcp_test_memory_stats");
        let _ = tokio::fs::create_dir_all(&data_dir).await;

        let args = serde_json::json!({});
        let result = handle_memory_stats(&args, &data_dir).await;
        assert!(!result.is_error);

        let _ = tokio::fs::remove_dir_all(&data_dir).await;
    }

    #[tokio::test]
    async fn test_memory_flush() {
        let data_dir = std::env::temp_dir().join("mcp_test_memory_flush");
        let _ = tokio::fs::create_dir_all(&data_dir).await;

        let args = serde_json::json!({
            "topics": ["Tauri migration", "MCP rewrite"],
            "decisions": ["Use Rust for MCP server"],
            "summary": "Worked on Tauri migration wave 3"
        });
        let result = handle_memory_flush(&args, &data_dir).await;
        assert!(!result.is_error);
        if let Some(crate::mcp::handlers::McpContent::Text { text }) = result.content.first() {
            assert!(text.contains("4 item(s)")); // 2 topics + 1 decision + 1 summary
        }

        let _ = tokio::fs::remove_dir_all(&data_dir).await;
    }
}
