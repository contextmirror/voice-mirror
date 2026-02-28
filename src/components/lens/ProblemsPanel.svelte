<script>
  /**
   * ProblemsPanel.svelte -- VS Code-style unified Problems panel.
   *
   * Displays all LSP diagnostics grouped by file in a collapsible tree.
   * Supports severity filtering, text search, and click-to-navigate.
   */
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

  /** @type {{ showErrors: boolean, showWarnings: boolean, showInfos: boolean, filterText: string }} */
  let { showErrors = true, showWarnings = true, showInfos = true, filterText = '' } = $props();

  /** Track collapsed file groups */
  let collapsedFiles = $state(new Set());

  // -- Derived: grouped + filtered + sorted diagnostics --
  let fileGroups = $derived.by(() => {
    const rawDiags = lspDiagnosticsStore.rawDiagnostics ?? new Map();
    if (!rawDiags.size) return [];

    const groups = [];
    const lowerFilter = filterText.toLowerCase();

    for (const [filePath, diags] of rawDiags) {
      // Filter by severity and text
      const filtered = diags.filter((d) => {
        const sev = d.severity;
        const isError = sev === 'error' || sev === 1;
        const isWarning = sev === 'warning' || sev === 2;
        const isInfo = sev === 'information' || sev === 3 || sev === 'hint' || sev === 4;

        if (isError && !showErrors) return false;
        if (isWarning && !showWarnings) return false;
        if (isInfo && !showInfos) return false;

        if (lowerFilter) {
          const msg = (d.message || '').toLowerCase();
          const src = (d.source || '').toLowerCase();
          const code = String(d.code || '').toLowerCase();
          if (!msg.includes(lowerFilter) && !src.includes(lowerFilter) && !code.includes(lowerFilter)) {
            return false;
          }
        }
        return true;
      });

      if (filtered.length === 0) continue;

      // Sort: errors first, then warnings, then info; within same severity by line
      const sorted = filtered.sort((a, b) => {
        const sevA = typeof a.severity === 'number' ? a.severity : (a.severity === 'error' ? 1 : a.severity === 'warning' ? 2 : 3);
        const sevB = typeof b.severity === 'number' ? b.severity : (b.severity === 'error' ? 1 : b.severity === 'warning' ? 2 : 3);
        if (sevA !== sevB) return sevA - sevB;
        const lineA = a.range?.start?.line ?? 0;
        const lineB = b.range?.start?.line ?? 0;
        return lineA - lineB;
      });

      const errors = sorted.filter(d => (d.severity === 'error' || d.severity === 1)).length;
      const warnings = sorted.filter(d => (d.severity === 'warning' || d.severity === 2)).length;

      groups.push({ filePath, diagnostics: sorted, errors, warnings });
    }

    // Sort file groups: files with errors first, then warnings-only, then alpha
    groups.sort((a, b) => {
      if (a.errors > 0 && b.errors === 0) return -1;
      if (a.errors === 0 && b.errors > 0) return 1;
      return a.filePath.localeCompare(b.filePath);
    });

    return groups;
  });

  function toggleCollapse(filePath) {
    const next = new Set(collapsedFiles);
    if (next.has(filePath)) {
      next.delete(filePath);
    } else {
      next.add(filePath);
    }
    collapsedFiles = next;
  }

  function navigateToDiagnostic(filePath, diag) {
    const line = diag.range?.start?.line ?? 0;
    const character = diag.range?.start?.character ?? 0;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    tabsStore.setPendingCursor(filePath, line, character);
    tabsStore.openFile({ name: fileName, path: filePath });
  }

  function severityIcon(sev) {
    if (sev === 'error' || sev === 1) return 'error';
    if (sev === 'warning' || sev === 2) return 'warning';
    return 'info';
  }

  function severityLabel(sev) {
    if (sev === 'error' || sev === 1) return 'Error';
    if (sev === 'warning' || sev === 2) return 'Warning';
    return 'Info';
  }

  function formatSource(diag) {
    let parts = [];
    if (diag.source) parts.push(diag.source);
    if (diag.code != null) parts.push(`(${diag.code})`);
    return parts.join(' ');
  }
</script>

<div class="problems-panel">
  {#if fileGroups.length === 0}
    <div class="problems-empty">
      No problems have been detected in the workspace.
    </div>
  {:else}
    <div class="problems-list">
      {#each fileGroups as group (group.filePath)}
        <!-- File group header -->
        <button
          class="file-group-header"
          onclick={() => toggleCollapse(group.filePath)}
          title={group.filePath}
        >
          <svg
            class="chevron"
            class:collapsed={collapsedFiles.has(group.filePath)}
            viewBox="0 0 16 16" width="12" height="12" fill="currentColor"
          >
            <path d="M5.7 13.7L5 13l4.6-4.6L5 3.8l.7-.7 5.3 5.3-5.3 5.3z"/>
          </svg>
          <span class="file-name">{group.filePath}</span>
          <span class="file-counts">
            {#if group.errors > 0}
              <span class="count-errors">{group.errors}</span>
            {/if}
            {#if group.warnings > 0}
              <span class="count-warnings">{group.warnings}</span>
            {/if}
          </span>
        </button>

        <!-- Diagnostics under this file -->
        {#if !collapsedFiles.has(group.filePath)}
          {#each group.diagnostics as diag, i (i)}
            <button
              class="diag-row"
              class:diag-error={severityIcon(diag.severity) === 'error'}
              class:diag-warning={severityIcon(diag.severity) === 'warning'}
              class:diag-info={severityIcon(diag.severity) === 'info'}
              onclick={() => navigateToDiagnostic(group.filePath, diag)}
              title="{severityLabel(diag.severity)}: {diag.message}"
            >
              <!-- Severity icon -->
              <span class="diag-severity severity-{severityIcon(diag.severity)}">
                {#if severityIcon(diag.severity) === 'error'}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="currentColor" stroke-width="1.5"/>
                  </svg>
                {:else if severityIcon(diag.severity) === 'warning'}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12zM8 5v4M8 11v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                {:else}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="8" cy="11.5" r="0.8" fill="currentColor"/>
                  </svg>
                {/if}
              </span>

              <!-- Message -->
              <span class="diag-message">{diag.message}</span>

              <!-- Source + code -->
              {#if formatSource(diag)}
                <span class="diag-source">{formatSource(diag)}</span>
              {/if}

              <!-- Line:col -->
              <span class="diag-location">[Ln {(diag.range?.start?.line ?? 0) + 1}, Col {(diag.range?.start?.character ?? 0) + 1}]</span>
            </button>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .problems-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--font-family);
    font-size: 12px;
    color: var(--text);
    background: var(--bg);
  }

  .problems-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    user-select: none;
  }

  .problems-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* -- File group header -- */
  .file-group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 8px;
    border: none;
    background: color-mix(in srgb, var(--text) 5%, transparent);
    color: var(--text-strong);
    font-size: 12px;
    font-family: var(--font-family);
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    user-select: none;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .file-group-header:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-counts {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .count-errors {
    color: var(--danger);
    font-weight: 600;
    font-size: 11px;
  }

  .count-warnings {
    color: var(--warn);
    font-weight: 600;
    font-size: 11px;
  }

  /* -- Diagnostic row -- */
  .diag-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    padding: 2px 8px 2px 24px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    line-height: 1.4;
  }

  .diag-row:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .diag-severity {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .severity-error { color: var(--danger); }
  .severity-warning { color: var(--warn); }
  .severity-info { color: var(--accent); }

  .diag-message {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .diag-source {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .diag-location {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
