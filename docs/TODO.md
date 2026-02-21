# Voice Mirror -- TODO

Tracked items for future work. Check items off as they're completed.

---

## Release / Bundling

- [ ] **Bundle `voice-mirror-mcp` in installers** -- The MCP binary is a separate `[[bin]]` target (`src-tauri/src/bin/mcp.rs`) that must ship alongside the main app. Add it to `bundle.externalBin` in `src-tauri/tauri.conf.json` so Windows (.exe/.msi), macOS (.dmg/.app), and Linux (.deb/.AppImage) installers include it automatically. The desktop shortcut (`Voice Mirror.lnk`) doesn't need to change -- it points to the main exe, and `resolve_mcp_binary()` already searches adjacent to the running executable.

  **Context:** During development, `npm run dev` auto-rebuilds the MCP binary first (added in commit `24a04f9a`). But for installed/production builds, the binary must be bundled in the installer or it won't be found at runtime. Without it, CLI providers (Claude Code, OpenCode) can't start their MCP server.

  **Files involved:**
  - `src-tauri/tauri.conf.json` -- add `bundle.externalBin` config
  - `src-tauri/src/providers/cli/mcp_config.rs` -- `resolve_mcp_binary()` (already handles adjacent-to-exe lookup)
  - `.github/workflows/release.yml` -- verify MCP binary is included in release artifacts
