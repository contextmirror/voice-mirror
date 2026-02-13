# test/

Test suite for Voice Mirror Electron. Uses `node:test` runner with `node:assert/strict` assertions.

## Running Tests

```bash
npm test           # Run all unit tests
```

## Directory Structure

### `unit/` -- Unit Tests

Source-inspection style tests (no Electron runtime required). 36 test files covering:

- AI/LLM: `ai-manager`, `tool-calling`, `prompts`, `provider-detector`, `provider-display-name`, `context-usage`
- Browser: `browser-tools`, `browser-cookies-storage`, `dialog-handling`
- Config: `config-rw`, `config-safety`, `constants`, `settings-enhancements`
- System: `platform-paths`, `safe-path`, `desktop-shortcut`, `perf-monitor`, `logger-levels`
- Voice: `ptt-trigger`, `python-backend`, `python-backend-resilience`
- UI: `terminal-resize`, `window-bounds`, `screen-capture`, `theme-engine`, `notifications`, `startup-polish`
- Security: `api-key-detection`, `ipc-validators`, `username-required`
- Features: `memory-tools`, `search-utils`, `inbox`, `json-file-watcher`, `snapshot-efficiency`, `update-checker`

### `integration/` -- Integration Tests

End-to-end tests that exercise multiple services together. Run via `integration/runner.js`.

Suites: `config`, `log-audit`, `memory`, `messaging`, `provider-switch`, `screen`, `stress`, `tool-groups`

Support files in `integration/lib/` (harness, report generator).

### `browser-benchmark/` -- Browser Tool Benchmark

Automated evaluation of LLM browser-tool usage. 102 tests across 17 categories with 10-point scoring. Supports fixture replay (offline) and live mode. Generates Chart.js dashboards in `results/`.
