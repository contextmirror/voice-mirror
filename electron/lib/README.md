# electron/lib/

Shared utility modules used across the Electron main process.
Re-exported via `index.js` barrel file.

## File index

| Module | Type | Description |
|---|---|---|
| `index.js` | barrel | Re-exports all utilities from this directory |
| `json-file-watcher.js` | utility | Factory for fs.watch-based JSON file watchers with polling fallback |
| `ollama-launcher.js` | platform helper | Finds and spawns the Ollama server process (cross-platform) |
| `safe-path.js` | utility | Path traversal prevention (`ensureWithin`) |
| `windows-screen-capture.js` | platform helper | Windows-only screen capture via PowerShell + .NET GDI+ |
