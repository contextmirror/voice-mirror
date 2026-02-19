//! Tool registry with dynamic group loading/unloading.
//!
//! Ports the tool definitions from `mcp-server/tool-groups.js` to Rust.
//! Each tool has a name, description, and JSON Schema for its input.
//! Tools are organized into groups that can be loaded/unloaded at runtime.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::info;

// Re-export the shared McpToolResult from handlers so server.rs can use it
pub use super::handlers::{McpContent, McpToolResult};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// A single MCP tool definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// Metadata for a tool group.
#[derive(Debug, Clone)]
pub struct ToolGroupDef {
    pub name: String,
    pub description: String,
    pub always_loaded: bool,
    pub keywords: Vec<String>,
    pub dependencies: Vec<String>,
    pub tools: Vec<ToolDef>,
}

/// A named tool profile (set of active groups).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolProfile {
    pub groups: Vec<String>,
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

/// Idle auto-unload threshold: if a group hasn't been used in this many calls,
/// it gets auto-unloaded (unless pinned by a tool profile).
const IDLE_CALLS_THRESHOLD: u64 = 15;

/// Global call counter (atomic for thread safety).
static TOTAL_CALL_COUNT: AtomicU64 = AtomicU64::new(0);

/// The tool registry manages all tool groups, tracks which are loaded,
/// and handles auto-load/unload by keyword intent.
pub struct ToolRegistry {
    /// All registered tool groups, keyed by group name.
    groups: HashMap<String, ToolGroupDef>,
    /// Currently loaded group names.
    loaded: HashSet<String>,
    /// Groups pinned by the active tool profile (exempt from auto-unload).
    allowed: Option<HashSet<String>>,
    /// Reverse lookup: tool name -> group name.
    tool_to_group: HashMap<String, String>,
    /// Last call count when each group was used.
    group_last_used: HashMap<String, u64>,
    /// Pre-compiled keyword patterns per group (group_name -> keywords).
    group_keywords: HashMap<String, Vec<String>>,
    /// Destructive tools requiring confirmation.
    destructive_tools: HashSet<String>,
}

impl ToolRegistry {
    /// Create a new registry with all built-in tool groups.
    pub fn new() -> Self {
        let groups = build_all_groups();

        // Build reverse lookup
        let mut tool_to_group = HashMap::new();
        for (group_name, group) in &groups {
            for tool in &group.tools {
                tool_to_group.insert(tool.name.clone(), group_name.clone());
            }
        }

        // Build keyword index
        let mut group_keywords = HashMap::new();
        for (name, group) in &groups {
            if !group.keywords.is_empty() {
                group_keywords.insert(name.clone(), group.keywords.clone());
            }
        }

        // Destructive tools
        let destructive_tools: HashSet<String> = [
            "memory_forget",
            "n8n_delete_workflow",
            "n8n_delete_credential",
            "n8n_delete_tag",
            "n8n_delete_execution",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        // Default: load core + meta
        let mut loaded = HashSet::new();
        loaded.insert("core".into());
        loaded.insert("meta".into());

        Self {
            groups,
            loaded,
            allowed: None,
            tool_to_group,
            group_last_used: HashMap::new(),
            group_keywords,
            destructive_tools,
        }
    }

    /// Apply a tool profile (restrict which groups can be loaded).
    pub fn apply_profile(&mut self, profile: &ToolProfile) {
        let allowed: HashSet<String> = profile.groups.iter().cloned().collect();
        self.loaded = allowed.clone();
        self.allowed = Some(allowed);
        info!(
            "[MCP] Tool profile applied: {}",
            profile.groups.join(", ")
        );
    }

    /// Apply an enabled-groups string (comma-separated).
    pub fn apply_enabled_groups(&mut self, groups_str: &str) {
        let names: Vec<String> = groups_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| self.groups.contains_key(s))
            .collect();

        if names.is_empty() {
            return;
        }

        let allowed: HashSet<String> = names.iter().cloned().collect();
        self.loaded = allowed.clone();
        self.allowed = Some(allowed);
        info!(
            "[MCP] Enabled groups set: {}",
            names.join(", ")
        );
    }

    /// Get all currently loaded tool definitions (for tools/list).
    pub fn list_tools(&self) -> Vec<ToolDef> {
        let mut tools = Vec::new();
        for group_name in &self.loaded {
            if let Some(group) = self.groups.get(group_name) {
                tools.extend(group.tools.iter().cloned());
            }
        }
        tools
    }

    /// Check if a tool is destructive (requires confirmation).
    pub fn is_destructive(&self, tool_name: &str) -> bool {
        self.destructive_tools.contains(tool_name)
    }

    /// Record that a tool was called (for idle tracking).
    pub fn record_tool_call(&mut self, tool_name: &str) {
        let count = TOTAL_CALL_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(group_name) = self.tool_to_group.get(tool_name) {
            self.group_last_used.insert(group_name.clone(), count);
        }
    }

    /// Get the group name for a tool.
    pub fn group_for_tool(&self, tool_name: &str) -> Option<&String> {
        self.tool_to_group.get(tool_name)
    }

    /// Check if a tool is currently available (its group is loaded).
    pub fn is_tool_loaded(&self, tool_name: &str) -> bool {
        if let Some(group_name) = self.tool_to_group.get(tool_name) {
            self.loaded.contains(group_name)
        } else {
            false
        }
    }

    /// Load a tool group by name. Returns tool names on success.
    pub fn load_group(&mut self, group_name: &str) -> Result<Vec<String>, String> {
        let group = self
            .groups
            .get(group_name)
            .ok_or_else(|| {
                let available: Vec<&String> = self
                    .groups
                    .keys()
                    .filter(|k| {
                        !self
                            .groups
                            .get(*k)
                            .map(|g| g.always_loaded)
                            .unwrap_or(false)
                    })
                    .collect();
                format!(
                    "Unknown group: \"{}\". Available: {}",
                    group_name,
                    available
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?
            .clone();

        if self.loaded.contains(group_name) {
            let tool_names: Vec<String> = group.tools.iter().map(|t| t.name.clone()).collect();
            return Ok(tool_names);
        }

        self.loaded.insert(group_name.to_string());
        let count = TOTAL_CALL_COUNT.load(Ordering::Relaxed);
        self.group_last_used.insert(group_name.to_string(), count);
        info!("[MCP] Loaded tool group: {}", group_name);

        // Also load dependencies
        for dep in &group.dependencies {
            if !self.loaded.contains(dep) {
                if self.groups.contains_key(dep) {
                    self.loaded.insert(dep.clone());
                    self.group_last_used.insert(dep.clone(), count);
                    info!("[MCP] Auto-loaded dependency \"{}\" (required by {})", dep, group_name);
                }
            }
        }

        let tool_names: Vec<String> = group.tools.iter().map(|t| t.name.clone()).collect();
        Ok(tool_names)
    }

    /// Unload a tool group. Returns error if group is always-loaded.
    pub fn unload_group(&mut self, group_name: &str) -> Result<usize, String> {
        if let Some(group) = self.groups.get(group_name) {
            if group.always_loaded {
                return Err(format!(
                    "Cannot unload \"{}\" -- it is always loaded.",
                    group_name
                ));
            }
        }

        if !self.loaded.contains(group_name) {
            return Err(format!("Group \"{}\" is not currently loaded.", group_name));
        }

        let tool_count = self
            .groups
            .get(group_name)
            .map(|g| g.tools.len())
            .unwrap_or(0);

        self.loaded.remove(group_name);
        info!("[MCP] Unloaded tool group: {}", group_name);
        Ok(tool_count)
    }

    /// Auto-load groups based on keyword intent detection.
    /// Returns list of newly loaded group names.
    pub fn auto_load_by_intent(&mut self, text: &str) -> Vec<String> {
        if text.is_empty() {
            return Vec::new();
        }

        let text_lower = text.to_lowercase();
        let mut loaded = Vec::new();

        // Collect candidates first to avoid borrow issues
        let candidates: Vec<(String, Vec<String>)> = self
            .group_keywords
            .iter()
            .filter(|(name, _)| {
                !self.loaded.contains(name.as_str())
                    && !self
                        .groups
                        .get(name.as_str())
                        .map(|g| g.always_loaded)
                        .unwrap_or(false)
            })
            .filter(|(name, _)| {
                // If a profile restricts groups, only auto-load allowed groups
                self.allowed
                    .as_ref()
                    .map(|a| a.contains(name.as_str()))
                    .unwrap_or(true)
            })
            .map(|(name, keywords)| (name.clone(), keywords.clone()))
            .collect();

        for (group_name, keywords) in candidates {
            let matched = keywords.iter().any(|kw| text_lower.contains(&kw.to_lowercase()));
            if !matched {
                continue;
            }

            self.loaded.insert(group_name.clone());
            loaded.push(group_name.clone());
            info!(
                "[MCP] Auto-loaded \"{}\" (intent: \"{}\")",
                group_name,
                &text[..text.len().min(60)]
            );

            // Load dependencies
            if let Some(group) = self.groups.get(&group_name) {
                let deps = group.dependencies.clone();
                for dep in deps {
                    if !self.loaded.contains(&dep) && self.groups.contains_key(&dep) {
                        self.loaded.insert(dep.clone());
                        loaded.push(dep.clone());
                        info!("[MCP] Auto-loaded \"{}\" (dependency of {})", dep, group_name);
                    }
                }
            }
        }

        loaded
    }

    /// Check for idle groups and auto-unload them.
    /// Returns list of unloaded group names.
    pub fn auto_unload_idle(&mut self) -> Vec<String> {
        let current_count = TOTAL_CALL_COUNT.load(Ordering::Relaxed);
        let mut to_unload = Vec::new();

        for group_name in self.loaded.iter() {
            if let Some(group) = self.groups.get(group_name) {
                if group.always_loaded {
                    continue;
                }
            }

            // Don't auto-unload groups pinned by profile
            if let Some(ref allowed) = self.allowed {
                if allowed.contains(group_name) {
                    continue;
                }
            }

            let last_used = self.group_last_used.get(group_name).copied().unwrap_or(0);
            if current_count - last_used > IDLE_CALLS_THRESHOLD {
                to_unload.push(group_name.clone());
            }
        }

        for name in &to_unload {
            self.loaded.remove(name);
            info!(
                "[MCP] Auto-unloaded \"{}\" (idle for {}+ calls)",
                name, IDLE_CALLS_THRESHOLD
            );
        }

        to_unload
    }

    /// List all groups with their status.
    pub fn list_groups(&self) -> Vec<ToolGroupStatus> {
        let mut result = Vec::new();
        // Sort by name for stable output
        let mut names: Vec<&String> = self.groups.keys().collect();
        names.sort();

        for name in names {
            if let Some(group) = self.groups.get(name) {
                let status = if group.always_loaded {
                    GroupStatus::AlwaysLoaded
                } else if self.loaded.contains(name) {
                    GroupStatus::Loaded
                } else {
                    GroupStatus::Unloaded
                };

                result.push(ToolGroupStatus {
                    name: name.clone(),
                    description: group.description.clone(),
                    tool_count: group.tools.len(),
                    tool_names: group.tools.iter().map(|t| t.name.clone()).collect(),
                    status,
                });
            }
        }

        result
    }
}

/// Status of a tool group.
#[derive(Debug, Clone, Serialize)]
pub struct ToolGroupStatus {
    pub name: String,
    pub description: String,
    pub tool_count: usize,
    pub tool_names: Vec<String>,
    pub status: GroupStatus,
}

#[derive(Debug, Clone, Serialize)]
pub enum GroupStatus {
    AlwaysLoaded,
    Loaded,
    Unloaded,
}

impl std::fmt::Display for GroupStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GroupStatus::AlwaysLoaded => write!(f, "ALWAYS LOADED"),
            GroupStatus::Loaded => write!(f, "LOADED"),
            GroupStatus::Unloaded => write!(f, "unloaded"),
        }
    }
}

// ---------------------------------------------------------------------------
// Built-in tool group definitions (ported from tool-groups.js)
// ---------------------------------------------------------------------------

fn build_all_groups() -> HashMap<String, ToolGroupDef> {
    let mut groups = HashMap::new();

    // ---- Core ----
    groups.insert(
        "core".into(),
        ToolGroupDef {
            name: "core".into(),
            description: "Core voice communication (send, inbox, listen, status)".into(),
            always_loaded: true,
            keywords: vec![],
            dependencies: vec![],
            tools: vec![
                ToolDef {
                    name: "voice_send".into(),
                    description: "Send a message to the Voice Mirror inbox. Use this to respond to voice queries - your message will be spoken aloud.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "instance_id": { "type": "string", "description": "Your instance ID (use \"voice-claude\" for Voice Mirror)" },
                            "message": { "type": "string", "description": "The message to send (will be spoken via TTS)" },
                            "thread_id": { "type": "string", "description": "Optional thread ID for grouping messages" },
                            "reply_to": { "type": "string", "description": "Optional message ID this replies to" }
                        },
                        "required": ["instance_id", "message"]
                    }),
                },
                ToolDef {
                    name: "voice_inbox".into(),
                    description: "Read messages from the Voice Mirror inbox. Voice queries from the user appear here.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "instance_id": { "type": "string", "description": "Your instance ID" },
                            "limit": { "type": "number", "description": "Max messages to return (default: 10)" },
                            "include_read": { "type": "boolean", "description": "Include already-read messages (default: false)" },
                            "mark_as_read": { "type": "boolean", "description": "Mark messages as read after viewing" }
                        },
                        "required": ["instance_id"]
                    }),
                },
                ToolDef {
                    name: "voice_listen".into(),
                    description: "Wait for new voice messages from the user. Blocks until a message arrives or timeout. This is the primary way to receive voice input.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "instance_id": { "type": "string", "description": "Your instance ID" },
                            "from_sender": { "type": "string", "description": "Sender to listen for (use the user's configured name for voice input)" },
                            "thread_id": { "type": "string", "description": "Optional thread filter" },
                            "timeout_seconds": { "type": "number", "description": "Max wait time (default: 300, max: 600)" }
                        },
                        "required": ["instance_id", "from_sender"]
                    }),
                },
                ToolDef {
                    name: "voice_status".into(),
                    description: "Update or list Claude instance status for presence tracking.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "instance_id": { "type": "string", "description": "Your instance ID" },
                            "action": { "type": "string", "enum": ["update", "list"], "description": "Action to perform" },
                            "status": { "type": "string", "enum": ["active", "idle"], "description": "Your current status" },
                            "current_task": { "type": "string", "description": "What you are working on" }
                        },
                        "required": ["instance_id"]
                    }),
                },
            ],
        },
    );

    // ---- Meta ----
    groups.insert(
        "meta".into(),
        ToolGroupDef {
            name: "meta".into(),
            description: "Tool management (load, unload, list groups)".into(),
            always_loaded: true,
            keywords: vec![],
            dependencies: vec![],
            tools: vec![
                ToolDef {
                    name: "load_tools".into(),
                    description: "Load a tool group to make its tools available. Call list_tool_groups first to see what groups exist. Groups: screen, memory, voice-clone, browser.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "group": { "type": "string", "description": "Tool group to load (e.g. \"browser\", \"memory\", \"screen\", \"voice-clone\")" }
                        },
                        "required": ["group"]
                    }),
                },
                ToolDef {
                    name: "unload_tools".into(),
                    description: "Unload a tool group to reduce context. Cannot unload core or meta groups.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "group": { "type": "string", "description": "Tool group to unload" }
                        },
                        "required": ["group"]
                    }),
                },
                ToolDef {
                    name: "list_tool_groups".into(),
                    description: "List all available tool groups and their loaded status.".into(),
                    input_schema: json!({ "type": "object", "properties": {} }),
                },
            ],
        },
    );

    // ---- Screen ----
    groups.insert(
        "screen".into(),
        ToolGroupDef {
            name: "screen".into(),
            description: "Screen capture and vision analysis".into(),
            always_loaded: false,
            keywords: vec![
                "screen".into(), "screenshot".into(), "look at".into(),
                "what do you see".into(), "my display".into(), "monitor".into(),
                "what's on".into(), "show me".into(),
            ],
            dependencies: vec![],
            tools: vec![ToolDef {
                name: "capture_screen".into(),
                description: "Capture a screenshot of the user's screen for visual analysis.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "display": { "description": "Display index (default: 0). Response includes displays_available count so you can request other monitors." }
                    }
                }),
            }],
        },
    );

    // ---- Memory ----
    groups.insert(
        "memory".into(),
        ToolGroupDef {
            name: "memory".into(),
            description: "Persistent memory system (search, store, recall, forget)".into(),
            always_loaded: false,
            keywords: vec![
                "remember".into(), "memory".into(), "recall".into(), "forget".into(),
                "what did i say".into(), "previously".into(), "last time".into(),
                "you told me".into(), "i mentioned".into(),
            ],
            dependencies: vec![],
            tools: vec![
                ToolDef {
                    name: "memory_search".into(),
                    description: "Mandatory recall step: search Voice Mirror memories using hybrid semantic + keyword search. You MUST call this before answering any question about prior work, decisions, dates, people, user preferences, todos, or previous conversations. If results are empty, say you checked but found nothing.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "query": { "type": "string", "description": "What to search for in memories" },
                            "max_results": { "type": "number", "description": "Maximum results to return (default: 5)" },
                            "min_score": { "type": "number", "description": "Minimum relevance score 0-1 (default: 0.3)" }
                        },
                        "required": ["query"]
                    }),
                },
                ToolDef {
                    name: "memory_get".into(),
                    description: "Read full content of a memory chunk or file. Use after memory_search to pull only the needed lines and keep context small.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "File path or chunk ID from search results" },
                            "from_line": { "type": "number", "description": "Start reading from this line (optional)" },
                            "lines": { "type": "number", "description": "Number of lines to read (optional)" }
                        },
                        "required": ["path"]
                    }),
                },
                ToolDef {
                    name: "memory_remember".into(),
                    description: "Store a persistent memory. You MUST proactively use this when the user shares preferences, makes decisions, states facts about themselves, or says \"remember this\". Also use it to save important outcomes of tasks you complete. Do NOT use for casual chat (greetings, thanks, acknowledgments) or vague observations. Only store concrete facts, preferences, or decisions. Tier guide: core=permanent facts, stable=decisions and context (7-day TTL), notes=temporary reminders (24h TTL).".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "content": { "type": "string", "description": "What to remember" },
                            "tier": { "type": "string", "enum": ["core", "stable", "notes"], "description": "Memory tier: core=permanent, stable=7 days, notes=temporary" }
                        },
                        "required": ["content"]
                    }),
                },
                ToolDef {
                    name: "memory_forget".into(),
                    description: "Delete a memory by content or chunk ID. Requires confirmed: true (ask user first).".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "content_or_id": { "type": "string", "description": "Memory content to match, or chunk_* ID" },
                            "confirmed": { "type": "boolean", "description": "Set to true after getting user confirmation" }
                        },
                        "required": ["content_or_id"]
                    }),
                },
                ToolDef {
                    name: "memory_stats".into(),
                    description: "Get memory system statistics including storage, index, and embedding info.".into(),
                    input_schema: json!({ "type": "object", "properties": {} }),
                },
                ToolDef {
                    name: "memory_flush".into(),
                    description: "Flush important context to persistent memory before context compaction. Call this before your context window is about to be compacted to preserve key decisions, topics, and action items.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "topics": { "type": "array", "items": { "type": "string" }, "description": "Key topics discussed in this session" },
                            "decisions": { "type": "array", "items": { "type": "string" }, "description": "Important decisions made" },
                            "action_items": { "type": "array", "items": { "type": "string" }, "description": "Action items or TODOs" },
                            "summary": { "type": "string", "description": "Brief summary of the session" }
                        }
                    }),
                },
            ],
        },
    );

    // ---- Voice Clone ----
    groups.insert(
        "voice-clone".into(),
        ToolGroupDef {
            name: "voice-clone".into(),
            description: "Voice cloning for TTS customization".into(),
            always_loaded: false,
            keywords: vec![
                "clone voice".into(), "voice clone".into(), "sound like".into(),
                "voice sample".into(), "mimic".into(), "change voice".into(),
                "my voice".into(),
            ],
            dependencies: vec![],
            tools: vec![
                ToolDef {
                    name: "clone_voice".into(),
                    description: "Clone a voice from an audio sample for TTS.".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "audio_url": { "type": "string", "description": "URL to download audio from" },
                            "audio_path": { "type": "string", "description": "Local file path to an audio file" },
                            "voice_name": { "type": "string", "description": "Name for this voice clone (default: \"custom\")" },
                            "transcript": { "type": "string", "description": "Optional transcript of what is said in the audio." }
                        }
                    }),
                },
                ToolDef {
                    name: "clear_voice_clone".into(),
                    description: "Clear the current voice clone and return to using preset speaker voices.".into(),
                    input_schema: json!({ "type": "object", "properties": {} }),
                },
                ToolDef {
                    name: "list_voice_clones".into(),
                    description: "List all saved voice clones.".into(),
                    input_schema: json!({ "type": "object", "properties": {} }),
                },
            ],
        },
    );

    // ---- Browser ----
    groups.insert(
        "browser".into(),
        ToolGroupDef {
            name: "browser".into(),
            description: "Chrome browser control and web research (16 tools)".into(),
            always_loaded: false,
            keywords: vec![
                "search".into(), "browse".into(), "website".into(), "web".into(),
                "google".into(), "open page".into(), "fetch url".into(),
                "look up".into(), "find online".into(), "what is".into(),
                "who is".into(), "latest news".into(),
            ],
            dependencies: vec!["screen".into()],
            tools: vec![
                ToolDef { name: "browser_start".into(), description: "Launch a managed Chrome browser instance with CDP debugging enabled.".into(), input_schema: json!({ "type": "object", "properties": { "profile": { "type": "string", "description": "Browser profile name (default: \"default\")" } } }) },
                ToolDef { name: "browser_stop".into(), description: "Stop the managed Chrome browser instance.".into(), input_schema: json!({ "type": "object", "properties": { "profile": { "type": "string" } } }) },
                ToolDef { name: "browser_status".into(), description: "Get the status of the browser.".into(), input_schema: json!({ "type": "object", "properties": { "profile": { "type": "string" } } }) },
                ToolDef { name: "browser_tabs".into(), description: "List all open browser tabs.".into(), input_schema: json!({ "type": "object", "properties": { "profile": { "type": "string" } } }) },
                ToolDef { name: "browser_open".into(), description: "Open a new browser tab with the given URL.".into(), input_schema: json!({ "type": "object", "properties": { "url": { "type": "string" }, "profile": { "type": "string" } }, "required": ["url"] }) },
                ToolDef { name: "browser_close_tab".into(), description: "Close a browser tab by its targetId.".into(), input_schema: json!({ "type": "object", "properties": { "targetId": { "type": "string" }, "profile": { "type": "string" } }, "required": ["targetId"] }) },
                ToolDef { name: "browser_focus".into(), description: "Focus/activate a browser tab by its targetId.".into(), input_schema: json!({ "type": "object", "properties": { "targetId": { "type": "string" }, "profile": { "type": "string" } }, "required": ["targetId"] }) },
                ToolDef { name: "browser_navigate".into(), description: "Navigate a browser tab to a new URL.".into(), input_schema: json!({ "type": "object", "properties": { "url": { "type": "string" }, "targetId": { "type": "string" }, "profile": { "type": "string" } }, "required": ["url"] }) },
                ToolDef { name: "browser_screenshot".into(), description: "Take a screenshot of a browser tab.".into(), input_schema: json!({ "type": "object", "properties": { "targetId": { "type": "string" }, "fullPage": { "type": "boolean" }, "ref": { "type": "string" }, "profile": { "type": "string" } } }) },
                ToolDef { name: "browser_snapshot".into(), description: "Take an accessibility snapshot of a browser tab.".into(), input_schema: json!({ "type": "object", "properties": { "targetId": { "type": "string" }, "format": { "type": "string", "enum": ["role", "aria", "ai"] }, "interactive": { "type": "boolean" }, "compact": { "type": "boolean" }, "selector": { "type": "string" }, "ifChanged": { "type": "boolean" }, "maxPageText": { "type": "number" }, "profile": { "type": "string" } } }) },
                ToolDef { name: "browser_act".into(), description: "Execute an action on a browser page element.".into(), input_schema: json!({ "type": "object", "properties": { "request": { "type": "object", "properties": { "kind": { "type": "string" }, "ref": { "type": "string" }, "text": { "type": "string" }, "key": { "type": "string" }, "expression": { "type": "string" }, "selector": { "type": "string" }, "value": { "type": "string" }, "startRef": { "type": "string" }, "endRef": { "type": "string" } }, "required": ["kind"] }, "targetId": { "type": "string" }, "profile": { "type": "string" }, "confirmed": { "type": "boolean" } }, "required": ["request"] }) },
                ToolDef { name: "browser_console".into(), description: "Get console logs and errors from a browser tab.".into(), input_schema: json!({ "type": "object", "properties": { "targetId": { "type": "string" }, "profile": { "type": "string" } } }) },
                ToolDef { name: "browser_search".into(), description: "Search Google using a headless browser.".into(), input_schema: json!({ "type": "object", "properties": { "query": { "type": "string" }, "max_results": { "type": "number" } }, "required": ["query"] }) },
                ToolDef { name: "browser_fetch".into(), description: "Fetch and extract text content from a URL.".into(), input_schema: json!({ "type": "object", "properties": { "url": { "type": "string" }, "timeout": { "type": "number" }, "max_length": { "type": "number" }, "include_links": { "type": "boolean" } }, "required": ["url"] }) },
                ToolDef { name: "browser_cookies".into(), description: "Manage browser cookies.".into(), input_schema: json!({ "type": "object", "properties": { "action": { "type": "string", "enum": ["list", "set", "delete", "clear"] }, "name": { "type": "string" }, "value": { "type": "string" }, "url": { "type": "string" }, "domain": { "type": "string" }, "path": { "type": "string" }, "secure": { "type": "boolean" }, "httpOnly": { "type": "boolean" }, "sameSite": { "type": "string", "enum": ["Strict", "Lax", "None"] }, "profile": { "type": "string" } }, "required": ["action"] }) },
                ToolDef { name: "browser_storage".into(), description: "Read/write browser localStorage or sessionStorage.".into(), input_schema: json!({ "type": "object", "properties": { "type": { "type": "string", "enum": ["localStorage", "sessionStorage"] }, "action": { "type": "string", "enum": ["get", "set", "delete", "clear"] }, "key": { "type": "string" }, "value": { "type": "string" }, "profile": { "type": "string" } }, "required": ["action"] }) },
            ],
        },
    );

    // ---- n8n ----
    groups.insert(
        "n8n".into(),
        ToolGroupDef {
            name: "n8n".into(),
            description: "n8n workflow automation (22 tools)".into(),
            always_loaded: false,
            keywords: vec![
                "n8n".into(), "workflow".into(), "automation".into(), "trigger".into(),
                "webhook".into(), "execution".into(), "credential".into(), "template".into(),
            ],
            dependencies: vec![],
            tools: vec![
                ToolDef { name: "n8n_search_nodes".into(), description: "Search for n8n nodes by keyword.".into(), input_schema: json!({ "type": "object", "properties": { "query": { "type": "string" }, "limit": { "type": "number" } }, "required": ["query"] }) },
                ToolDef { name: "n8n_get_node".into(), description: "Get detailed node info.".into(), input_schema: json!({ "type": "object", "properties": { "node_type": { "type": "string" }, "detail": { "type": "string", "enum": ["minimal", "standard", "full"] } }, "required": ["node_type"] }) },
                ToolDef { name: "n8n_list_workflows".into(), description: "List all workflows.".into(), input_schema: json!({ "type": "object", "properties": { "active_only": { "type": "boolean" } } }) },
                ToolDef { name: "n8n_get_workflow".into(), description: "Get workflow details.".into(), input_schema: json!({ "type": "object", "properties": { "workflow_id": { "type": "string" } }, "required": ["workflow_id"] }) },
                ToolDef { name: "n8n_create_workflow".into(), description: "Create a new workflow.".into(), input_schema: json!({ "type": "object", "properties": { "name": { "type": "string" }, "nodes": { "type": "array", "items": { "type": "object" } }, "connections": { "type": "object" } }, "required": ["name", "nodes", "connections"] }) },
                ToolDef { name: "n8n_update_workflow".into(), description: "Update workflow via operations.".into(), input_schema: json!({ "type": "object", "properties": { "workflow_id": { "type": "string" }, "operations": { "type": "array", "items": { "type": "object" } }, "workflow_data": { "type": "object" } }, "required": ["workflow_id"] }) },
                ToolDef { name: "n8n_delete_workflow".into(), description: "Delete a workflow by ID.".into(), input_schema: json!({ "type": "object", "properties": { "workflow_id": { "type": "string" }, "confirmed": { "type": "boolean" } }, "required": ["workflow_id"] }) },
                ToolDef { name: "n8n_validate_workflow".into(), description: "Validate a workflow configuration.".into(), input_schema: json!({ "type": "object", "properties": { "workflow_id": { "type": "string" }, "workflow_json": { "type": "object" } } }) },
                ToolDef { name: "n8n_trigger_workflow".into(), description: "Trigger a workflow execution.".into(), input_schema: json!({ "type": "object", "properties": { "workflow_id": { "type": "string" }, "webhook_path": { "type": "string" }, "data": { "type": "object" } }, "required": ["workflow_id"] }) },
                ToolDef { name: "n8n_deploy_template".into(), description: "Deploy a template from n8n.io.".into(), input_schema: json!({ "type": "object", "properties": { "template_id": { "type": "number" }, "name": { "type": "string" } }, "required": ["template_id"] }) },
                ToolDef { name: "n8n_get_executions".into(), description: "Get recent executions.".into(), input_schema: json!({ "type": "object", "properties": { "workflow_id": { "type": "string" }, "status": { "type": "string", "enum": ["success", "error", "waiting"] }, "limit": { "type": "number" } } }) },
                ToolDef { name: "n8n_get_execution".into(), description: "Get execution details.".into(), input_schema: json!({ "type": "object", "properties": { "execution_id": { "type": "string" }, "include_data": { "type": "boolean" } }, "required": ["execution_id"] }) },
                ToolDef { name: "n8n_delete_execution".into(), description: "Delete an execution.".into(), input_schema: json!({ "type": "object", "properties": { "execution_id": { "type": "string" }, "confirmed": { "type": "boolean" } }, "required": ["execution_id"] }) },
                ToolDef { name: "n8n_retry_execution".into(), description: "Retry a failed execution.".into(), input_schema: json!({ "type": "object", "properties": { "execution_id": { "type": "string" }, "load_workflow": { "type": "boolean" } }, "required": ["execution_id"] }) },
                ToolDef { name: "n8n_list_credentials".into(), description: "List credentials.".into(), input_schema: json!({ "type": "object", "properties": {} }) },
                ToolDef { name: "n8n_create_credential".into(), description: "Create a new credential.".into(), input_schema: json!({ "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "string" }, "data": { "type": "object" } }, "required": ["name", "type"] }) },
                ToolDef { name: "n8n_delete_credential".into(), description: "Delete a credential.".into(), input_schema: json!({ "type": "object", "properties": { "credential_id": { "type": "string" }, "confirmed": { "type": "boolean" } }, "required": ["credential_id"] }) },
                ToolDef { name: "n8n_get_credential_schema".into(), description: "Get schema for a credential type.".into(), input_schema: json!({ "type": "object", "properties": { "credential_type": { "type": "string" } }, "required": ["credential_type"] }) },
                ToolDef { name: "n8n_list_tags".into(), description: "List all tags.".into(), input_schema: json!({ "type": "object", "properties": {} }) },
                ToolDef { name: "n8n_create_tag".into(), description: "Create a new tag.".into(), input_schema: json!({ "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }) },
                ToolDef { name: "n8n_delete_tag".into(), description: "Delete a tag.".into(), input_schema: json!({ "type": "object", "properties": { "tag_id": { "type": "string" }, "confirmed": { "type": "boolean" } }, "required": ["tag_id"] }) },
                ToolDef { name: "n8n_list_variables".into(), description: "List global variables.".into(), input_schema: json!({ "type": "object", "properties": {} }) },
            ],
        },
    );

    // ---- Diagnostic ----
    groups.insert(
        "diagnostic".into(),
        ToolGroupDef {
            name: "diagnostic".into(),
            description: "Pipeline diagnostic tools".into(),
            always_loaded: false,
            keywords: vec![
                "diagnostic".into(), "trace".into(), "pipeline".into(),
                "debug".into(), "test pipeline".into(),
            ],
            dependencies: vec![],
            tools: vec![ToolDef {
                name: "pipeline_trace".into(),
                description: "Send a test message through the live Voice Mirror pipeline and trace every stage.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "message": { "type": "string", "description": "The test message to send through the pipeline" },
                        "timeout_seconds": { "type": "number", "description": "Max wait time (default: 30)" }
                    },
                    "required": ["message"]
                }),
            }],
        },
    );

    // ---- Facade groups (single-tool wrappers for voice mode) ----
    groups.insert(
        "memory-facade".into(),
        ToolGroupDef {
            name: "memory-facade".into(),
            description: "Memory system (single tool: memory_manage)".into(),
            always_loaded: false,
            keywords: vec![
                "remember".into(), "memory".into(), "recall".into(), "forget".into(),
                "what did i say".into(), "previously".into(), "last time".into(),
                "you told me".into(), "i mentioned".into(),
            ],
            dependencies: vec![],
            tools: vec![ToolDef {
                name: "memory_manage".into(),
                description: "Manage persistent memories. Actions: search, remember, forget, stats, flush.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "action": { "type": "string", "enum": ["search", "remember", "forget", "stats", "flush"], "description": "Action to perform" },
                        "query": { "type": "string" },
                        "content": { "type": "string" },
                        "tier": { "type": "string", "enum": ["core", "stable", "notes"] },
                        "content_or_id": { "type": "string" },
                        "confirmed": { "type": "boolean" },
                        "max_results": { "type": "number" },
                        "topics": { "type": "array", "items": { "type": "string" } },
                        "decisions": { "type": "array", "items": { "type": "string" } },
                        "action_items": { "type": "array", "items": { "type": "string" } },
                        "summary": { "type": "string" }
                    },
                    "required": ["action"]
                }),
            }],
        },
    );

    groups.insert(
        "n8n-facade".into(),
        ToolGroupDef {
            name: "n8n-facade".into(),
            description: "n8n workflow automation (single tool: n8n_manage)".into(),
            always_loaded: false,
            keywords: vec![
                "n8n".into(), "workflow".into(), "automation".into(),
                "trigger".into(), "webhook".into(),
            ],
            dependencies: vec![],
            tools: vec![ToolDef {
                name: "n8n_manage".into(),
                description: "Manage n8n workflows. Actions: list, get, create, trigger, status, delete.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "action": { "type": "string", "enum": ["list", "get", "create", "trigger", "status", "delete"] },
                        "workflow_id": { "type": "string" },
                        "name": { "type": "string" },
                        "nodes": { "type": "array", "items": { "type": "object" } },
                        "connections": { "type": "object" },
                        "data": { "type": "object" },
                        "confirmed": { "type": "boolean" },
                        "active_only": { "type": "boolean" }
                    },
                    "required": ["action"]
                }),
            }],
        },
    );

    groups.insert(
        "browser-facade".into(),
        ToolGroupDef {
            name: "browser-facade".into(),
            description: "Browser control and web research (single tool: browser_manage)".into(),
            always_loaded: false,
            keywords: vec![
                "search".into(), "browse".into(), "website".into(), "web".into(),
                "google".into(), "open page".into(), "fetch url".into(),
                "look up".into(), "find online".into(), "what is".into(),
                "who is".into(), "latest news".into(),
            ],
            dependencies: vec!["screen".into()],
            tools: vec![ToolDef {
                name: "browser_manage".into(),
                description: "Control Chrome browser and do web research. Actions: search, open, fetch, snapshot, screenshot, click, type, tabs, navigate, start, stop.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "action": { "type": "string", "enum": ["search", "open", "fetch", "snapshot", "screenshot", "click", "type", "tabs", "navigate", "start", "stop"] },
                        "query": { "type": "string" },
                        "url": { "type": "string" },
                        "ref": { "type": "string" },
                        "text": { "type": "string" },
                        "request": { "type": "object" },
                        "targetId": { "type": "string" },
                        "profile": { "type": "string" },
                        "max_results": { "type": "number" },
                        "timeout": { "type": "number" },
                        "max_length": { "type": "number" }
                    },
                    "required": ["action"]
                }),
            }],
        },
    );

    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_new() {
        let reg = ToolRegistry::new();
        // Core and meta should be loaded by default
        assert!(reg.is_tool_loaded("voice_send"));
        assert!(reg.is_tool_loaded("load_tools"));
        // Memory should not be loaded by default
        assert!(!reg.is_tool_loaded("memory_search"));
    }

    #[test]
    fn test_list_tools_default() {
        let reg = ToolRegistry::new();
        let tools = reg.list_tools();
        // Should have core (4) + meta (3) = 7 tools
        assert_eq!(tools.len(), 7);
    }

    #[test]
    fn test_load_unload_group() {
        let mut reg = ToolRegistry::new();
        assert!(!reg.is_tool_loaded("memory_search"));

        let names = reg.load_group("memory").unwrap();
        assert_eq!(names.len(), 6);
        assert!(reg.is_tool_loaded("memory_search"));

        let count = reg.unload_group("memory").unwrap();
        assert_eq!(count, 6);
        assert!(!reg.is_tool_loaded("memory_search"));
    }

    #[test]
    fn test_cannot_unload_core() {
        let mut reg = ToolRegistry::new();
        let result = reg.unload_group("core");
        assert!(result.is_err());
    }

    #[test]
    fn test_auto_load_by_intent() {
        let mut reg = ToolRegistry::new();
        assert!(!reg.is_tool_loaded("memory_search"));

        let loaded = reg.auto_load_by_intent("can you remember this for me?");
        assert!(loaded.contains(&"memory".to_string()));
        assert!(reg.is_tool_loaded("memory_search"));
    }

    #[test]
    fn test_browser_loads_screen_dependency() {
        let mut reg = ToolRegistry::new();
        assert!(!reg.is_tool_loaded("capture_screen"));

        let _names = reg.load_group("browser").unwrap();
        // Screen should have been loaded as a dependency
        assert!(reg.is_tool_loaded("capture_screen"));
        assert!(reg.is_tool_loaded("browser_start"));
    }

    #[test]
    fn test_apply_profile() {
        let mut reg = ToolRegistry::new();
        reg.apply_profile(&ToolProfile {
            groups: vec!["core".into(), "meta".into(), "memory".into()],
        });
        assert!(reg.is_tool_loaded("memory_search"));
        assert!(!reg.is_tool_loaded("browser_start"));
    }

    #[test]
    fn test_list_groups() {
        let reg = ToolRegistry::new();
        let groups = reg.list_groups();
        assert!(groups.len() >= 8); // core, meta, screen, memory, voice-clone, browser, n8n, diagnostic, facades
    }

    #[test]
    fn test_destructive_tool_check() {
        let reg = ToolRegistry::new();
        assert!(reg.is_destructive("memory_forget"));
        assert!(reg.is_destructive("n8n_delete_workflow"));
        assert!(!reg.is_destructive("voice_send"));
    }
}
