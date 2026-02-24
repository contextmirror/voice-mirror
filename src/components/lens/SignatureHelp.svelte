<script>
  let {
    visible = false,
    data = null,
    cursorX = 0,
    cursorY = 0,
    onDismiss = () => {},
  } = $props();

  let activeSignature = $derived(data?.signatures?.[data?.activeSignature ?? 0] ?? null);
  let activeParamIndex = $derived(data?.activeParameter ?? 0);
  let activeParam = $derived(activeSignature?.parameters?.[activeParamIndex] ?? null);

  // Split signature label into parts with active parameter highlighted
  let labelParts = $derived.by(() => {
    if (!activeSignature) return [];
    const label = activeSignature.label;
    if (!activeParam) return [{ text: label, active: false }];

    const paramLabel = activeParam.label;

    // Handle offset tuple [start, end] from LSP
    if (Array.isArray(paramLabel)) {
      const [start, end] = paramLabel;
      return [
        { text: label.slice(0, start), active: false },
        { text: label.slice(start, end), active: true },
        { text: label.slice(end), active: false },
      ];
    }

    // Handle string label — find within signature
    if (typeof paramLabel === 'string') {
      const idx = label.indexOf(paramLabel);
      if (idx >= 0) {
        return [
          { text: label.slice(0, idx), active: false },
          { text: label.slice(idx, idx + paramLabel.length), active: true },
          { text: label.slice(idx + paramLabel.length), active: false },
        ];
      }
    }

    return [{ text: label, active: false }];
  });

  // Position tooltip above cursor (flip below if not enough room)
  let tooltipStyle = $derived.by(() => {
    const maxX = typeof window !== 'undefined' ? window.innerWidth - 400 : cursorX;
    const left = Math.max(8, Math.min(cursorX, maxX));
    const above = cursorY - 8;
    const below = cursorY + 20;
    const top = above > 120 ? above : below;
    const transform = above > 120 ? 'translateY(-100%)' : '';
    return `left: ${left}px; top: ${top}px; transform: ${transform};`;
  });

  // Escape key handler — dismiss but let the event continue so CodeMirror
  // can also dismiss autocomplete in the same keystroke
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      onDismiss();
      // Don't preventDefault or stopPropagation — let CodeMirror handle Escape too
    }
  }

  $effect(() => {
    if (visible) {
      document.addEventListener('keydown', handleKeydown, true);
      return () => {
        document.removeEventListener('keydown', handleKeydown, true);
      };
    }
  });
</script>

{#if visible && activeSignature}
  <div class="signature-help" style={tooltipStyle} role="tooltip">
    <div class="signature-label">
      {#each labelParts as part}
        {#if part.active}
          <span class="active-param">{part.text}</span>
        {:else}
          <span>{part.text}</span>
        {/if}
      {/each}
    </div>
    {#if activeParam?.documentation}
      <div class="param-doc">
        {typeof activeParam.documentation === 'string'
          ? activeParam.documentation
          : activeParam.documentation?.value ?? ''}
      </div>
    {/if}
    {#if data.signatures.length > 1}
      <div class="signature-count">{(data.activeSignature ?? 0) + 1}/{data.signatures.length}</div>
    {/if}
  </div>
{/if}

<style>
  .signature-help {
    position: fixed;
    z-index: 10003;
    max-width: 500px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
    pointer-events: none;
  }

  .signature-label {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .active-param {
    font-weight: 700;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .param-doc {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-family: var(--font-family);
    font-size: 11px;
  }

  .signature-count {
    margin-top: 2px;
    font-size: 10px;
    color: var(--muted);
    text-align: right;
  }
</style>
