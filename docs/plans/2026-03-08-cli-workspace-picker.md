# CLI Provider Workspace Picker

**Date:** 2026-03-08
**Status:** Design — not yet implemented
**Priority:** High (affects voice agent usability)

## Problem

When switching to a CLI provider (Claude Code, OpenCode, etc.), the terminal always spawns in Voice Mirror's own directory. This is because `find_project_root()` in `src-tauri/src/util.rs` resolves to Voice Mirror's root by finding `src-tauri/tauri.conf.json`.

This causes a critical limitation: **Claude Code's project memory is tied to the working directory.** The voice agent always gets Voice Mirror's memory context, even when the user wants to work on a different project. Claude Code stores auto-memory at `~/.claude/projects/{path-hash}/memory/`, so the wrong CWD means the wrong memory, wrong CLAUDE.md, and wrong project context.

## Current Flow

```
User selects CLI provider in Settings
  → AISettings.svelte: saveAISettings()
  → switchProvider(providerId, options)
  → api.setProvider(providerId, { model, cwd, ... })
  → Rust: set_provider command
  → AiManager.switch() → stops old, starts new
  → CLI provider: find_project_root() → always Voice Mirror
  → Terminal spawns in Voice Mirror directory
```

## Existing Plumbing (already works)

The `cwd` parameter already flows end-to-end:

1. **Frontend API** (`src/lib/api.js:200-212`): `setProvider()` accepts `cwd` option
2. **Rust command** (`src-tauri/src/commands/ai.rs:316-349`): `set_provider` accepts `cwd: Option<String>`
3. **ProviderConfig** has `cwd: Option<String>` field
4. **CLI provider** (`src-tauri/src/providers/cli/mod.rs:233-238`): Uses `config.cwd` with priority over `find_project_root()`

```rust
let work_dir = self.config.cwd.as_ref().map(PathBuf::from)
    .or_else(|| project_root.clone())
    .or_else(dirs::home_dir);
```

**The `cwd` just isn't being passed from the UI.**

## Proposed Solution

### Workspace Picker on CLI Provider Switch

When the user selects a CLI provider, instead of immediately switching, show a workspace picker dialog.

### Data Sources for Workspace List

1. **Open projects** — already tracked in `project.svelte.js` store
   - Each project has `path`, `name`, `color`
   - Displayed as colored avatars in `ProjectStrip.svelte`
   - Stored in config under `projects.entries[]`

2. **"Open folder..." option** — launches native folder picker dialog
   - For projects not yet in the sidebar

### UI Design Options

**Option A: Inline dropdown in AISettings**
- Add a "Workspace" dropdown below the provider selector
- Pre-populated with open projects + "Browse..." option
- Only visible when a CLI provider is selected
- Selected workspace path passed as `cwd` to `switchProvider()`

**Option B: Modal dialog on switch**
- When user clicks to switch to CLI provider, show a small modal
- Lists open projects as clickable items (with colored dots matching sidebar)
- "Open folder..." button at the bottom
- Selecting a project completes the switch

**Option C: Combined with provider button**
- Provider selector shows "Claude Code → Voice Mirror" with a small change button
- Clicking change shows the workspace picker

**Recommendation: Option A** — least disruptive, keeps everything in the settings panel flow.

### Implementation Steps

1. **AISettings.svelte** (~10 lines changed):
   - Import `projectStore`
   - Add workspace dropdown UI (only for CLI providers)
   - Track selected workspace path in component state
   - Pass `cwd: selectedWorkspace.path` in the `switchProvider()` call

2. **switchProvider() in ai-status.svelte.js** (~2 lines changed):
   - Accept `cwd` in options
   - Pass through to `setProvider()` API call

3. **No backend changes needed** — `cwd` parameter already works end-to-end

4. **Optional enhancement**: Remember last-used workspace per provider in config

### Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `src/components/settings/AISettings.svelte` | Add workspace dropdown, pass cwd | ~15-20 new lines |
| `src/lib/stores/ai-status.svelte.js` | Forward cwd option | ~2 lines |
| (Optional) Config schema | Persist last workspace per provider | ~5 lines |

### Edge Cases

- **No projects open**: Show only "Open folder..." option, or default to Voice Mirror
- **Project removed from sidebar**: Fall back to Voice Mirror directory
- **Non-existent path**: Validate path exists before passing to backend
- **Provider auto-start on app launch**: Use last-selected workspace from config

### MCP Config Consideration

The MCP binary path resolution (`resolve_mcp_binary()`) uses `project_root` to find the binary. If `cwd` points to a non-Voice-Mirror project, the MCP binary still needs to be found. Current search order handles this:
1. Adjacent to exe (works for installed app)
2. `target/release` (works for dev — relative to project_root, not cwd)
3. `target/debug` (works for dev)

`find_project_root()` is called independently of `cwd` for MCP resolution, so this should be fine.

### Voice Agent Implications

With this change:
- Voice agent terminal can be pointed at any project
- Claude Code loads the correct project's CLAUDE.md and auto-memory
- MCP tools still work (binary found via exe path, not cwd)
- Voice loop command still injected normally
- Only one voice agent terminal runs at a time (no parallel complexity)

## Stream Deck Integration (completed separately)

A separate PowerShell script (`C:\Users\georg\Documents\ClaudeCode.ps1`) was created to detect the focused Explorer window and launch standalone Claude Code sessions in that directory. This is independent of the Voice Mirror workspace picker — it's for launching Claude Code outside of Voice Mirror.
