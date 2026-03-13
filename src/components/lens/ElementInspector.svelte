<script>
  import { designSelectByTreeId, designExpandTreeNode } from '../../lib/api.js';

  /** @type {{ elementData?: object, onClose?: () => void, onUpdateData?: (data: object) => void }} */
  let { elementData = null, onClose = () => {}, onUpdateData = () => {} } = $props();

  // --- Tree state ---
  let expandedNodes = $state(new Set());

  // Initialize expanded state from tree data
  $effect(() => {
    if (elementData?.domTree) {
      const newExpanded = new Set();
      walkTree(elementData.domTree, (node) => {
        if (node.isOnPath || node.isSelected) {
          newExpanded.add(node.nodeId);
        }
      });
      expandedNodes = newExpanded;
    }
  });

  function walkTree(node, fn) {
    if (!node) return;
    fn(node);
    if (node.children) {
      for (const child of node.children) {
        walkTree(child, fn);
      }
    }
  }

  async function toggleExpand(node) {
    const newSet = new Set(expandedNodes);
    if (newSet.has(node.nodeId)) {
      newSet.delete(node.nodeId);
    } else {
      newSet.add(node.nodeId);
      // Lazy-load children if not yet fetched
      if (node.childCount > 0 && (!node.children || node.children.length === 0)) {
        const result = await designExpandTreeNode(node.nodeId);
        if (result?.success && result.data) {
          // Update via parent callback — props are read-only in Svelte 5
          onUpdateData({ ...elementData, _expandedNodeId: node.nodeId, _expandedChildren: result.data });
        }
      }
    }
    expandedNodes = newSet;
  }

  async function selectTreeNode(nodeId) {
    const result = await designSelectByTreeId(nodeId);
    // Parent will handle updating elementData via the event flow
  }

  function formatNodeLabel(node) {
    let label = node.tagName;
    if (node.id) label += '#' + node.id;
    else if (node.classes) {
      const first = node.classes.split(' ')[0];
      if (first) label += '.' + first;
    }
    return label;
  }

  // --- Color swatch detection ---
  function isColorValue(value) {
    if (!value) return false;
    return /^(rgb|rgba|hsl|hsla|#)/.test(value.trim());
  }

  // --- Computed values ---
  let attributes = $derived(elementData?.attributes || {});
  let styles = $derived(elementData?.styles || {});
  let bounds = $derived(elementData?.bounds || {});
  let selector = $derived(elementData?.selector || '');
  let tagDisplay = $derived.by(() => {
    if (!elementData) return '';
    let s = '<' + elementData.tagName;
    if (elementData.id) s += ' id="' + elementData.id + '"';
    if (elementData.classes?.length) {
      const cls = Array.isArray(elementData.classes) ? elementData.classes.join(' ') : elementData.classes;
      if (cls) s += ' class="' + cls + '"';
    }
    s += '>';
    return s;
  });
</script>

<div class="element-inspector" role="complementary">
  <!-- COMPONENTS tree -->
  <div class="section tree-section">
    <div class="section-header">COMPONENTS</div>
    <div class="tree-scroll">
      {#if elementData?.domTree}
        {#snippet treeNode(node, depth)}
          <div
            class="tree-node"
            class:selected={node.isSelected}
            style="padding-left: {depth * 16}px"
          >
            {#if node.childCount > 0}
              <button class="expand-btn" onclick={() => toggleExpand(node)}>
                {expandedNodes.has(node.nodeId) ? '▼' : '▶'}
              </button>
            {:else}
              <span class="expand-spacer"></span>
            {/if}
            <button class="node-label" onclick={() => selectTreeNode(node.nodeId)}>
              {formatNodeLabel(node)}
            </button>
          </div>
          {#if expandedNodes.has(node.nodeId) && node.children}
            {#each node.children as child}
              {@render treeNode(child, depth + 1)}
            {/each}
          {/if}
        {/snippet}
        {@render treeNode(elementData.domTree, 0)}
      {/if}
    </div>
  </div>

  <!-- Detail sections -->
  <div class="detail-scroll">
    <!-- ELEMENT header -->
    <div class="section">
      <div class="section-header">
        ELEMENT
        <button class="close-btn" onclick={onClose} aria-label="Close inspector">&times;</button>
      </div>
      <div class="element-tag">{tagDisplay}</div>
    </div>

    <!-- PATH -->
    <div class="section">
      <div class="section-header">PATH</div>
      <div class="path-value">{selector}</div>
    </div>

    <!-- ATTRIBUTES -->
    <div class="section">
      <div class="section-header">ATTRIBUTES</div>
      <div class="kv-list">
        {#each Object.entries(attributes) as [key, value]}
          <div class="kv-row">
            <span class="kv-key">{key}:</span>
            <span class="kv-value">{value}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- COMPUTED STYLES -->
    <div class="section">
      <div class="section-header">COMPUTED STYLES</div>
      <div class="kv-list">
        {#each Object.entries(styles) as [key, value]}
          <div class="kv-row">
            <span class="kv-key">{key}:</span>
            <span class="kv-value">
              {#if isColorValue(value)}
                <span class="swatch" style="background: {value}"></span>
              {/if}
              {value}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- POSITION & SIZE -->
    <div class="section">
      <div class="section-header">POSITION & SIZE</div>
      <div class="kv-list">
        <div class="kv-row"><span class="kv-key">top:</span><span class="kv-value">{bounds.y}px</span></div>
        <div class="kv-row"><span class="kv-key">left:</span><span class="kv-value">{bounds.x}px</span></div>
        <div class="kv-row"><span class="kv-key">width:</span><span class="kv-value">{bounds.width}px</span></div>
        <div class="kv-row"><span class="kv-key">height:</span><span class="kv-value">{bounds.height}px</span></div>
      </div>
    </div>
  </div>
</div>

<style>
  .element-inspector {
    width: 300px;
    min-width: 300px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-left: 1px solid var(--border);
    color: var(--text);
    font-size: 12px;
    overflow: hidden;
  }

  .section {
    border-bottom: 1px solid var(--border);
    padding: 8px 10px;
  }

  .section-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* --- Tree section --- */
  .tree-section {
    flex: 0 0 auto;
    max-height: 40%;
    display: flex;
    flex-direction: column;
  }

  .tree-scroll {
    overflow-y: auto;
    flex: 1;
  }

  .tree-node {
    display: flex;
    align-items: center;
    height: 22px;
    cursor: default;
    white-space: nowrap;
  }

  .tree-node.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 10px;
    width: 16px;
    height: 16px;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expand-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .node-label {
    background: none;
    border: none;
    color: var(--text);
    font-family: monospace;
    font-size: 12px;
    padding: 0 4px;
    cursor: pointer;
    text-align: left;
  }

  .node-label:hover {
    color: var(--accent);
  }

  /* --- Detail sections --- */
  .detail-scroll {
    flex: 1;
    overflow-y: auto;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 16px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text);
  }

  .element-tag {
    font-family: monospace;
    font-size: 12px;
    color: var(--accent);
    word-break: break-all;
  }

  .path-value {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    word-break: break-all;
    line-height: 1.4;
  }

  .kv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .kv-row {
    display: flex;
    gap: 8px;
    line-height: 1.6;
  }

  .kv-key {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
    min-width: 100px;
  }

  .kv-value {
    font-family: monospace;
    font-size: 11px;
    color: var(--text);
    word-break: break-all;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 1px solid var(--border);
    border-radius: 2px;
    flex-shrink: 0;
  }
</style>
